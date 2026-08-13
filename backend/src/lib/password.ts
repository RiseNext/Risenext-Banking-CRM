import argon2 from "argon2";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Argon2id at the OWASP 2024 low-memory baseline, which fits inside a small
 * Railway container without blowing the memory limit under concurrent logins.
 */
const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { ...OPTIONS });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

export function randomToken(bytes = 48): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function peppered(value: string, pepper: string): string {
  return createHash("sha256").update(`${pepper}:${value}`).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

const PASSWORD_MIN = 12;

export function passwordProblems(plain: string): string[] {
  const problems: string[] = [];
  if (plain.length < PASSWORD_MIN) problems.push(`must be at least ${PASSWORD_MIN} characters`);
  if (!/[a-z]/.test(plain)) problems.push("must contain a lowercase letter");
  if (!/[A-Z]/.test(plain)) problems.push("must contain an uppercase letter");
  if (!/[0-9]/.test(plain)) problems.push("must contain a digit");
  return problems;
}
