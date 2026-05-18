import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthenticated } from "@/lib/auth";
import { sendCommand } from "@/lib/hub-client";
import { z } from "zod";
import { nanoid } from "nanoid";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  action: z.enum(["start", "stop", "restart"]),
  pm2Id: z.number().int(),
});

export async function POST(req: Request, { params }: Params) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });

  const result = await sendCommand(id, {
    id: nanoid(),
    action: parsed.data.action,
    pm2Id: parsed.data.pm2Id,
  });

  await prisma.auditLog.create({
    data: {
      serverId: id,
      action: `pm2.${parsed.data.action}`,
      target: String(parsed.data.pm2Id),
      success: result.success,
      error: result.error,
      payload: result.output?.slice(0, 1000),
    },
  });

  return NextResponse.json(result);
}
