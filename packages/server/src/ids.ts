import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Opaque, unguessable ID: `<prefix>_<16 random bytes, base64url>`. */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString("base64url")}`;
}

export const sha256Hex = (s: string): string => createHash("sha256").update(s).digest("hex");

/** Constant-time string comparison (for secret hashes). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * API key format: `verid_<prefix>_<secret>`.
 *  - `prefix` (8 chars) is public and used for lookup / display.
 *  - `secret` is 32 random bytes; only its sha256 is stored.
 * The full key is shown exactly once, at creation.
 */
export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const prefix = randomBytes(6).toString("base64url"); // 8 chars
  const secret = randomBytes(32).toString("base64url");
  return { key: `verid_${prefix}_${secret}`, prefix, hash: sha256Hex(secret) };
}

export function parseApiKey(key: string): { prefix: string; secret: string } | null {
  const m = /^verid_([A-Za-z0-9_-]{8})_([A-Za-z0-9_-]{43})$/.exec(key);
  return m ? { prefix: m[1]!, secret: m[2]! } : null;
}
