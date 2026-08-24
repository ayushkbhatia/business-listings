/**
 * The last mile of an OTP: delivering a code somebody else generated.
 *
 * Supabase Auth generates, stores, expires and verifies the code — see
 * docs/auth-whatsapp-otp.md for why that stays true. All this layer does is
 * carry six digits to a handset, and it is an interface because the carrier is
 * the part most likely to change: Bird today, an SMS fallback the day the key
 * gets an `sms` scope, and a console in development where nothing should be
 * spending money on a WhatsApp authentication message.
 *
 * Nothing here reads the environment. `resolveSender` does that, once.
 */

export type OtpChannel = "whatsapp" | "sms" | "email";

export interface OtpMessage {
  /** E.164, with the leading plus. `toE164` in lib/format guarantees it. */
  to: string;
  /** The code Supabase generated. Never logged by a production sender. */
  code: string;
  /** Minutes until Supabase stops accepting it. For the message body. */
  expiresInMinutes: number;
}

export interface OtpSendResult {
  /** False is an expected outcome, not an exception. The caller decides. */
  delivered: boolean;
  /** Provider's id, for tracing a complaint back to a send. */
  providerRef?: string;
  /**
   * Safe to log and safe to show staff. Never contains the code, and never the
   * raw provider body, which can echo the payload back.
   */
  detail?: string;
}

export interface OtpSender {
  /** Stable, for logs and for the delivery record. */
  readonly name: string;
  readonly channel: OtpChannel;
  /**
   * Accepting is not delivering. Bird answers 202 and delivers asynchronously,
   * so `delivered: true` means "accepted for delivery" and nothing stronger.
   */
  send(message: OtpMessage): Promise<OtpSendResult>;
}
