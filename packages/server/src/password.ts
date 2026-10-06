import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number, opts: object) => Promise<Buffer>;

/** OWASP-recommended scrypt work factor (N=2^15, r=8, p=1) ≈ 32 MiB, ~50–100 ms. */
export const DEFAULT_SCRYPT_N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 64;

/**
 * Hash a password: `scrypt$N$r$p$<salt b64>$<hash b64>`. Cost parameters are
 * stored with the hash so they can be raised later without breaking old hashes.
 */
export async function hashPassword(password: string, n = DEFAULT_SCRYPT_N): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, KEYLEN, { N: n, r: R, p: P, maxmem: 256 * n * R });
  return `scrypt$${n}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [n, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (![n, r, p].every(Number.isInteger) || n < 1024 || n > 1 << 20) return false;
  const salt = Buffer.from(parts[4]!, "base64");
  const expected = Buffer.from(parts[5]!, "base64");
  const actual = await scrypt(password.normalize("NFKC"), salt, expected.length, { N: n, r, p, maxmem: 256 * n * r });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Matches the policy shown in the UI: 8+ chars, an uppercase letter, a digit. Max 128 to bound hashing cost. */
export const passwordSchema = z
  .string()
  .min(8, "at least 8 characters")
  .max(128, "at most 128 characters")
  .refine((v) => /[A-Z]/.test(v), "include an uppercase letter")
  .refine((v) => /[0-9]/.test(v), "include a number");
