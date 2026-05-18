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
    label: server.label,
    host: server.host,
    publicIp: server.publicIp,
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
  const data: Record<string, unknown> = {};
  if (typeof body.label === "string") data.label = body.label.slice(0, 120);
  if (typeof body.description === "string") data.description = body.description.slice(0, 500);
  if (typeof body.active === "boolean") data.active = body.active;
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }
  const updated = await prisma.server.update({ where: { id }, data });
  await prisma.auditLog.create({
    data: { serverId: id, action: "server.updated", payload: JSON.stringify(Object.keys(data)) },
  }).catch(() => {});
  return NextResponse.json({ id: updated.id, label: updated.label });
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
