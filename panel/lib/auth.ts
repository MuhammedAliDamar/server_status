// Minimal session — admin password + signed cookie
import { cookies } from "next/headers";
import crypto from "node:crypto";

const SECRET = process.env.SESSION_SECRET || "dev-only-change-me";
const COOKIE_NAME = "fleet_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 gün

function sign(value: string): string {
  return crypto.createHmac("sha256", SECRET).update(value).digest("hex");
}

export async function createSession() {
  const issued = Date.now().toString();
  const sig = sign(issued);
  const c = await cookies();
  c.set(COOKIE_NAME, `${issued}.${sig}`, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: MAX_AGE,
    path: "/",
  });
}

export async function destroySession() {
  const c = await cookies();
  c.delete(COOKIE_NAME);
}

export async function isAuthenticated(): Promise<boolean> {
  const c = await cookies();
  const raw = c.get(COOKIE_NAME)?.value;
  if (!raw) return false;
  const [issued, sig] = raw.split(".");
  if (!issued || !sig) return false;
  if (sign(issued) !== sig) return false;
  const age = (Date.now() - parseInt(issued, 10)) / 1000;
  return age < MAX_AGE;
}

export function checkPassword(input: string): boolean {
  return input === (process.env.ADMIN_PASSWORD || "admin");
}
