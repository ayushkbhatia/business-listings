import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Staff invitation tokens. Board 4i.
 *
 * 256 random bits, base64url, in the link and nowhere else. The row keeps the
 * SHA-256 of it. A plain hash rather than a slow one is right here and would be
 * wrong for a password: the input is uniformly random and as long as the digest,
 * so there is nothing to brute-force that is smaller than the hash itself.
 *
 * Not `server-only`, so the seed can mint a known fixture. Nothing in it reads
 * the database or the environment.
 */

const TOKEN_BYTES = 32;

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function mintInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, tokenHash: hashInviteToken(token) };
}

/**
 * The shape a link token has, checked before any lookup.
 *
 * A path segment is attacker-controlled. Refusing anything that is not 43
 * base64url characters keeps the database from being asked about arbitrary
 * strings, and answers a malformed token exactly as it answers an unknown one.
 */
export function isWellFormedInviteToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

/** Constant-time comparison of two hex digests, for a caller holding both. */
export function sameTokenHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}
