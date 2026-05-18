import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthenticated } from "@/lib/auth";
import { getLive } from "@/lib/hub-client";
import { generateToken, hashToken } from "@/lib/token";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const server = await prisma.server.findUnique({ where: { id } });
  if (!server) return NextResponse.json({ error: "not found" }, { status: 404 });
  const live = await getLive(id);
  return NextResponse.json({
    id: server.id,
    name: server.name,
    host: server.host,
    description: server.description,
    active: server.active,
    lastSeenAt: server.lastSeenAt,
    os: server.os,
    cpuCores: server.cpuCores,
    totalMem: server.totalMem ? Number(server.totalMem) : null,
    online: live?.online ?? false,
    metrics: live?.metrics ?? null,
    processes: live?.processes ?? [],
  });
}

export async function PATCH(req: Request, { params }: Params) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const updated = await prisma.server.update({
    where: { id },
    data: {
      description: typeof body.description === "string" ? body.description : undefined,
      active: typeof body.active === "boolean" ? body.active : undefined,
    },
  });
  return NextResponse.json({ id: updated.id });
}

export async function DELETE(_req: Request, { params }: Params) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  await prisma.server.delete({ where: { id } });
  await prisma.auditLog.create({ data: { action: "server.deleted", target: id } });
  return NextResponse.json({ ok: true });
}

export async function POST(_req: Request, { params }: Params) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const token = generateToken();
  const tokenHash = await hashToken(token);
  await prisma.server.update({ where: { id }, data: { tokenHash } });
  await prisma.auditLog.create({ data: { serverId: id, action: "server.token_rotated" } });
  return NextResponse.json({ token });
}
