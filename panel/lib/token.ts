import { customAlphabet } from "nanoid";
import bcrypt from "bcryptjs";

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const generate = customAlphabet(alphabet, 40);

export function generateToken(): string {
  return `flt_${generate()}`;
}

export async function hashToken(token: string): Promise<string> {
  return bcrypt.hash(token, 8);
}
