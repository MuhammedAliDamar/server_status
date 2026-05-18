import { NextResponse } from "next/server";
import { createSession, checkPassword } from "@/lib/auth";

export async function POST(req: Request) {
  const { password } = await req.json();
  if (!checkPassword(password)) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }
  await createSession();
  return NextResponse.json({ ok: true });
}
