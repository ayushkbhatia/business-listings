import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Standard Webhooks signature verification, for Supabase's Send SMS Hook.
 *
 * An unverified hook request is an open OTP oracle: anybody who can POST to the
 * endpoint can have a code of their choosing delivered to a number of their
 * choosing, on our WhatsApp account and our bill. So this runs on the raw body
 * before anything parses it, and rejects without saying why.
 *
 * The scheme, from the Standard Webhooks specification:
 *
 *   signed payload = `${id}.${timestamp}.${body}`
 *   signature      = base64(hmac_sha256(secret, signed payload))
 *   header         = `v1,<signature>` — possibly several, space separated,
 *                    because a secret rotation publishes both for a while.
 *
 * The secret arrives from Supabase as `v1,whsec_…`; the `v1,` prefix is a
 * scheme marker on the secret, not part of it, and the remainder is base64.
 */

export interface WebhookHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "missing_headers" | "stale" | "bad_signature" | "bad_secret" };

/** Five minutes either way. Bounds how long a captured request can be replayed. */
const TOLERANCE_SECONDS = 300;

export function verifyWebhook(
  rawBody: string,
  headers: WebhookHeaders,
  secret: string,
  now: Date = new Date(),
): VerifyResult {
  if (!headers.id || !headers.timestamp || !headers.signature) {
    return { ok: false, reason: "missing_headers" };
  }

  const sentAt = Number(headers.timestamp);
  if (!Number.isFinite(sentAt)) return { ok: false, reason: "stale" };
  if (Math.abs(Math.floor(now.getTime() / 1000) - sentAt) > TOLERANCE_SECONDS) {
    return { ok: false, reason: "stale" };
  }

  let key: Buffer;
  try {
    key = Buffer.from(secret.replace(/^v1,/, "").replace(/^whsec_/, ""), "base64");
    if (key.length === 0) return { ok: false, reason: "bad_secret" };
  } catch {
    return { ok: false, reason: "bad_secret" };
  }

  const expected = createHmac("sha256", key)
    .update(`${headers.id}.${headers.timestamp}.${rawBody}`)
    .digest("base64");

  // Several signatures during a rotation. Any one matching is a pass, and each
  // comparison is constant time — a fast reject on the first differing byte
  // leaks the signature one byte at a time.
  const offered = headers.signature.split(" ").map((part) => part.replace(/^v1,/, ""));
  const matched = offered.some((candidate) => constantTimeEqual(candidate, expected));

  return matched ? { ok: true } : { ok: false, reason: "bad_signature" };
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual throws on a length mismatch, which would itself be a
  // timing signal. Compare against a padded copy so every path costs the same.
  if (left.length !== right.length) {
    timingSafeEqual(right, right);
    return false;
  }
  return timingSafeEqual(left, right);
}
