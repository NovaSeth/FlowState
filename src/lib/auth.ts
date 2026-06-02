import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * API keys: a token has the form `fsk_<prefix>.<secret>`. In the database we keep
 * only the secret hash (sha-256) and the plaintext `prefix` (for identification in
 * the UI). We show the full token to the user ONCE, at creation. This is a local
 * tool - sha-256 is sufficient hygiene here (we don't store plaintext); for a hosted
 * setup it can be swapped for bcrypt/argon without changing the data shape.
 */

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function generateKey(): {
  prefix: string;
  secret: string;
  token: string;
  secretHash: string;
} {
  const prefix = "fsk_" + randomBytes(4).toString("hex"); // fsk_ + 8 hex
  const secret = randomBytes(24).toString("base64url");
  return { prefix, secret, token: `${prefix}.${secret}`, secretHash: hashSecret(secret) };
}

/** Split the token `fsk_xxxx.secret` into prefix + secret. null when invalid. */
export function splitToken(token: string): { prefix: string; secret: string } | null {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  return { prefix: token.slice(0, dot), secret: token.slice(dot + 1) };
}

/** Timing-safe hash comparison. */
export function secretMatches(secret: string, secretHash: string): boolean {
  const a = Buffer.from(hashSecret(secret));
  const b = Buffer.from(secretHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Constant-time, length-independent comparison of two strings (e.g. admin token ==
 *  FS_API_KEY). We sha-256 both sides first so the buffers are always equal length
 *  (32 bytes) - this avoids leaking the admin token length via an early
 *  length-mismatch return (like secretMatches already does). */
export function safeEqual(a: string, b: string): boolean {
  const ah = Buffer.from(hashSecret(a), "hex");
  const bh = Buffer.from(hashSecret(b), "hex");
  return timingSafeEqual(ah, bh);
}
