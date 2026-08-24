import { NextResponse, type NextRequest } from "next/server";
import { resolveOtpSender } from "@/lib/auth/otp";
import { verifyWebhook } from "@/lib/auth/webhook";
import { checkThrottle, recordAttempt } from "@/lib/auth/attempts";
import { OTP_EXPIRY_MINUTES } from "@/lib/auth/constants";
import { toE164 } from "@/lib/format/phone";

/**
 * Supabase's Send SMS Hook.
 *
 * Supabase generates and stores the OTP, then POSTs it here and lets us deliver
 * it however we like. The name says SMS; nothing in the payload does, which is
 * what makes WhatsApp possible without Supabase supporting Bird.
 *
 * Order matters and is deliberate:
 *   1. verify the signature, on the raw body, before anything parses it;
 *   2. check the per-number cooldown, because a WhatsApp authentication message
 *      to the UAE is priced per delivery and Supabase's own limit is not ours;
 *   3. only then deliver.
 *
 * Every failure answers with a status and no explanation. Telling an unverified
 * caller why it failed is telling them how to succeed.
 */
export const runtime = "nodejs";

interface HookPayload {
  user?: { id?: string; phone?: string };
  sms?: { otp?: string };
}

export async function POST(request: NextRequest) {
  const secret = process.env["AUTH_HOOK_SECRET"];
  if (!secret) {
    // Not configured is not the caller's business, and a 500 here is honest:
    // the endpoint exists and cannot do its job.
    console.error("[auth] send-otp hook called with no AUTH_HOOK_SECRET set");
    return new NextResponse(null, { status: 500 });
  }

  const rawBody = await request.text();
  const verified = verifyWebhook(
    rawBody,
    {
      id: request.headers.get("webhook-id"),
      timestamp: request.headers.get("webhook-timestamp"),
      signature: request.headers.get("webhook-signature"),
    },
    secret,
  );
  if (!verified.ok) {
    console.warn("[auth] rejected an unverified send-otp hook", { reason: verified.reason });
    return new NextResponse(null, { status: 401 });
  }

  let payload: HookPayload;
  try {
    payload = JSON.parse(rawBody) as HookPayload;
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const code = payload.sms?.otp;
  // Supabase hands the phone over without the leading plus.
  const phone = payload.user?.phone ? toE164(payload.user.phone) : null;
  if (!code || !phone) return new NextResponse(null, { status: 400 });

  const gate = await checkThrottle(phone, "otp_request");
  if (!gate.allowed) {
    // 429 tells Supabase not to retry. The user already has a countdown on the
    // verify screen from the same policy, so this is the backstop rather than
    // the message.
    return new NextResponse(null, {
      status: 429,
      headers: { "retry-after": String(Math.ceil(gate.retryAfterMs / 1000)) },
    });
  }

  const sender = resolveOtpSender();
  const result = await sender.send({ to: phone, code, expiresInMinutes: OTP_EXPIRY_MINUTES });

  await recordAttempt({ identifier: phone, kind: "otp_request", succeeded: result.delivered });

  if (!result.delivered) {
    console.error("[auth] OTP delivery failed", { sender: sender.name, detail: result.detail });
    // Supabase surfaces a non-2xx to the caller of signInWithOtp, which is what
    // turns into the "we could not send that" state rather than a silent wait.
    return new NextResponse(null, { status: 502 });
  }

  return new NextResponse(null, { status: 200 });
}
