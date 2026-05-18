// Agent auto-registration endpoint
// Agent installer'ı registration secret ile çağırır, panel agent token döner
// Aynı fingerprint tekrar register olursa: token rotate (idempotent re-install)

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateToken, hashToken } from "@/lib/token";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";

const schema = z.object({
  registerSecret: z.string().min(20).max(200),
  fingerprint: z.string().regex(/^[a-f0-9]{8,64}$/, "fingerprint must be hex 8-64 chars"),
  hostname: z.string().min(1).max(120),
  os: z.string().max(120).optional(),
  cpuCores: z.number().int().min(1).max(512).optional(),
  totalMem: z.number().int().min(0).max(2 ** 53 - 1).optional(),
});

// IP başına basit rate limit (in-memory)
const rateBucket = new Map<string, number[]>();
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 5;

function rateOk(ip: string): boolean {
  const now = Date.now();
  const arr = (rateBucket.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_LIMIT) return false;
  arr.push(now);
  rateBucket.set(ip, arr);
  return true;
}

async function checkRegisterSecret(input: string): Promise<boolean> {
  const expected = process.env.AGENT_REGISTRATION_SECRET;
  if (!expected || expected.length < 20) return false;
  // Timing-safe karşılaştırma
  try {
    const a = Buffer.from(input);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function safeName(hostname: string, fingerprint: string): string {
  const cleaned = hostname.toLowerCase().replace(/[^a-z0-9._-]/g, "-").slice(0, 40);
  const suffix = fingerprint.slice(0, 6);
  return `${cleaned || "host"}-${suffix}`;
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  if (!rateOk(ip)) {
    return NextResponse.json({ error: "rate limit exceeded" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "invalid input" }, { status: 400 });
  }

  if (!(await checkRegisterSecret(parsed.data.registerSecret))) {
    // Log failed attempt
    await prisma.auditLog.create({
      data: {
        action: "agent.register.invalid_secret",
        target: ip,
        success: false,
        error: `fingerprint=${parsed.data.fingerprint.slice(0, 12)}`,
      },
    }).catch(() => {});
    return NextResponse.json({ error: "invalid registration secret" }, { status: 401 });
  }

  const { fingerprint, hostname, os, cpuCores, totalMem } = parsed.data;

  // Aynı fingerprint zaten kayıtlı mı?
  const existing = await prisma.server.findUnique({ where: { fingerprint } });

  const token = generateToken();
  const tokenHash = await hashToken(token);

  let server;
  if (existing) {
    // Token rotate, lastSeen update
    server = await prisma.server.update({
      where: { id: existing.id },
      data: {
        tokenHash,
        host: hostname,
        os,
        cpuCores,
        totalMem: totalMem != null ? BigInt(totalMem) : undefined,
        active: true,
      },
    });
    await prisma.auditLog.create({
      data: { serverId: server.id, action: "agent.register.re_registered", target: ip },
    });
  } else {
    // Yeni kayıt — name çakışmasını fingerprint suffix'i çözer
    let name = safeName(hostname, fingerprint);
    let attempt = 0;
    while (await prisma.server.findUnique({ where: { name } })) {
      attempt++;
      if (attempt > 5) {
        name = `host-${fingerprint.slice(0, 12)}-${Date.now().toString(36).slice(-4)}`;
        break;
      }
      name = `${safeName(hostname, fingerprint)}-${attempt}`;
    }

    server = await prisma.server.create({
      data: {
        name,
        fingerprint,
        host: hostname,
        os,
        cpuCores,
        totalMem: totalMem != null ? BigInt(totalMem) : undefined,
        tokenHash,
        autoRegistered: true,
      },
    });
    await prisma.auditLog.create({
      data: { serverId: server.id, action: "agent.register.created", target: ip },
    });
  }

  // Agent'a WS endpoint'ini döndür
  // Reverse proxy arkasında ise PANEL_EXTERNAL_WS_URL env'i kullan
  let wsUrl: string;
  if (process.env.PANEL_EXTERNAL_WS_URL) {
    const ext = process.env.PANEL_EXTERNAL_WS_URL.replace(/\/$/, "");
    wsUrl = ext.endsWith("/agent") ? ext : `${ext}/agent`;
  } else {
    const hostHeader = req.headers.get("host") || "localhost";
    const wsHost = hostHeader.split(":")[0];
    const wsPort = process.env.WS_PORT || "2589";
    const wsProtocol = req.headers.get("x-forwarded-proto") === "https" ? "wss" : "ws";
    wsUrl = `${wsProtocol}://${wsHost}:${wsPort}/agent`;
  }

  return NextResponse.json({
    serverId: server.id,
    name: server.name,
    token,
    wsUrl,
  });
}
