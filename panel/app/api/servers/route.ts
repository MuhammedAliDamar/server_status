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
      host: s.host,
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
  name: z.string().min(1).max(64).regex(/^[a-zA-Z0-9._-]+$/, "alphanumeric, dot, dash, underscore"),
  description: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "invalid input" }, { status: 400 });
  const exists = await prisma.server.findUnique({ where: { name: parsed.data.name } });
  if (exists) return NextResponse.json({ error: "name already in use" }, { status: 409 });

  const token = generateToken();
  const tokenHash = await hashToken(token);
  const server = await prisma.server.create({
    data: { name: parsed.data.name, description: parsed.data.description, tokenHash },
  });
  await prisma.auditLog.create({ data: { serverId: server.id, action: "server.created", target: server.name } });
  return NextResponse.json({ id: server.id, name: server.name, token });
}
