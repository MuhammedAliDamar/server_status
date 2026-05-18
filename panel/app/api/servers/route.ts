import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthenticated } from "@/lib/auth";
import { getAllLive } from "@/lib/hub-client";
import { generateToken, hashToken } from "@/lib/token";
import { z } from "zod";

export async function GET() {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [servers, live] = await Promise.all([
    prisma.server.findMany({ orderBy: { createdAt: "asc" } }),
    getAllLive(),
  ]);
  const result = servers.map((s) => {
    const l = live[s.id];
    return {
      id: s.id,
      name: s.name,
      label: s.label,
      host: s.host,
      publicIp: s.publicIp,
      description: s.description,
      active: s.active,
      lastSeenAt: s.lastSeenAt,
      os: s.os,
      cpuCores: s.cpuCores,
      totalMem: s.totalMem ? Number(s.totalMem) : null,
      online: l?.online ?? false,
      metrics: l?.metrics ? {
        cpu: l.metrics.cpu,
        memUsed: l.metrics.memUsed,
        memTotal: l.metrics.memTotal,
        diskUsed: l.metrics.diskUsed,
        diskTotal: l.metrics.diskTotal,
        uptime: l.metrics.uptime,
      } : null,
      processCount: l?.processes.length ?? 0,
    };
  });
  return NextResponse.json(result);
}

const createSchema = z.object({
  label: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
});

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ğ]/g, "g").replace(/[ü]/g, "u").replace(/[ş]/g, "s")
    .replace(/[ı]/g, "i").replace(/[ö]/g, "o").replace(/[ç]/g, "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "server";
}

function randomSuffix(n = 4): string {
  return Math.random().toString(36).slice(2, 2 + n);
}

export async function POST(req: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "invalid input" }, { status: 400 });

  // Label'dan unique name türet
  const base = slug(parsed.data.label);
  let name = base;
  let tries = 0;
  while (await prisma.server.findUnique({ where: { name } })) {
    tries++;
    name = `${base}-${randomSuffix()}`;
    if (tries > 5) { name = `${base}-${Date.now().toString(36).slice(-6)}`; break; }
  }

  const token = generateToken();
  const tokenHash = await hashToken(token);
  const server = await prisma.server.create({
    data: {
      name,
      label: parsed.data.label,
      description: parsed.data.description,
      tokenHash,
    },
  });
  await prisma.auditLog.create({
    data: { serverId: server.id, action: "server.created", target: server.name },
  });

  // Hazır install komutunu kur
  const hostHeader = req.headers.get("host") || "localhost";
  const proto = req.headers.get("x-forwarded-proto") || "http";
  const wsExternal = process.env.PANEL_EXTERNAL_WS_URL;

  let panelArg: string;
  if (wsExternal) {
    // nginx + TLS arkasında: --panel <https://domain>  (installer auto-derives wss)
    panelArg = wsExternal.replace(/\/agent$/, "").replace(/^wss?:\/\//, proto === "https" ? "https://" : "http://");
  } else {
    // Raw IP/port: agent direkt WS_PORT'a bağlanır
    const wsPort = process.env.WS_PORT || "2589";
    const host = hostHeader.split(":")[0];
    panelArg = `ws://${host}:${wsPort}`;
  }

  const installCommand = `curl -fsSL https://raw.githubusercontent.com/MuhammedAliDamar/server_status/main/install-agent.sh | sudo bash -s -- --panel ${panelArg} --token ${token}`;

  return NextResponse.json({
    id: server.id,
    name: server.name,
    label: server.label,
    token,
    installCommand,
  });
}
