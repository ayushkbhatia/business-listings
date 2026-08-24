import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhook } from "./webhook";

/**
 * An unverified hook request is an open OTP oracle: anybody who can POST to the
 * endpoint gets a code of their choosing delivered to a number of their
 * choosing, on our WhatsApp account and our bill. These are the cases that
 * matter.
 */
const SECRET_BYTES = Buffer.from("a-thirty-two-byte-test-secret!!!");
const SECRET = `v1,whsec_${SECRET_BYTES.toString("base64")}`;
const BODY = JSON.stringify({ user: { phone: "971506412288" }, sms: { otp: "481920" } });
const NOW = new Date("2026-08-24T12:00:00Z");
const TS = String(Math.floor(NOW.getTime() / 1000));
const ID = "msg_2abc";

function sign(body: string, id = ID, timestamp = TS, key = SECRET_BYTES): string {
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
}

const headers = (over: Partial<{ id: string; timestamp: string; signature: string }> = {}) => ({
  id: ID,
  timestamp: TS,
  signature: sign(BODY),
  ...over,
});

describe("verifyWebhook", () => {
  it("accepts a correctly signed request", () => {
    expect(verifyWebhook(BODY, headers(), SECRET, NOW)).toEqual({ ok: true });
  });

  it("accepts a bare whsec_ secret and a v1, prefixed one alike", () => {
    const bare = `whsec_${SECRET_BYTES.toString("base64")}`;
    expect(verifyWebhook(BODY, headers(), bare, NOW)).toEqual({ ok: true });
  });

  it("rejects a body that changed after signing", () => {
    const tampered = JSON.stringify({ user: { phone: "971500000000" }, sms: { otp: "481920" } });
    expect(verifyWebhook(tampered, headers(), SECRET, NOW)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects a signature made with another secret", () => {
    const other = sign(BODY, ID, TS, Buffer.from("a-different-thirty-two-byte-key!"));
    expect(verifyWebhook(BODY, headers({ signature: other }), SECRET, NOW)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects a replay from outside the tolerance", () => {
    const old = String(Math.floor(NOW.getTime() / 1000) - 301);
    const replayed = headers({ timestamp: old, signature: sign(BODY, ID, old) });
    expect(verifyWebhook(BODY, replayed, SECRET, NOW)).toEqual({ ok: false, reason: "stale" });
  });

  it("accepts one just inside the tolerance", () => {
    const recent = String(Math.floor(NOW.getTime() / 1000) - 299);
    const ok = headers({ timestamp: recent, signature: sign(BODY, ID, recent) });
    expect(verifyWebhook(BODY, ok, SECRET, NOW)).toEqual({ ok: true });
  });

  it("rejects a signature bound to a different message id", () => {
    // Without the id in the signed payload, a signature could be lifted from
    // one delivery onto another.
    expect(verifyWebhook(BODY, headers({ id: "msg_other" }), SECRET, NOW)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects when a header is missing", () => {
    for (const missing of ["id", "timestamp", "signature"] as const) {
      expect(verifyWebhook(BODY, { ...headers(), [missing]: null }, SECRET, NOW)).toEqual({
        ok: false,
        reason: "missing_headers",
      });
    }
  });

  it("accepts either signature during a secret rotation", () => {
    // Standard Webhooks sends several, space separated, while a secret rotates.
    const other = createHmac("sha256", Buffer.from("some-other-key-entirely-32-bytes"))
      .update(`${ID}.${TS}.${BODY}`)
      .digest("base64");
    const both = `v1,${other} ${sign(BODY).replace(/^v1,/, "")}`;
    expect(verifyWebhook(BODY, headers({ signature: both }), SECRET, NOW)).toEqual({ ok: true });
  });

  it("rejects an empty secret rather than treating it as a key", () => {
    expect(verifyWebhook(BODY, headers(), "v1,", NOW)).toEqual({ ok: false, reason: "bad_secret" });
  });

  it("rejects a non-numeric timestamp", () => {
    expect(verifyWebhook(BODY, headers({ timestamp: "yesterday" }), SECRET, NOW)).toEqual({
      ok: false,
      reason: "stale",
    });
  });
});
