import type { OtpMessage, OtpSendResult, OtpSender } from "./sender";

/**
 * Writes the code to the server log instead of sending it.
 *
 * For development, and for any environment where WhatsApp is not yet wired —
 * which is every environment until Meta approves the authentication template.
 * The whole flow stays exercisable: Supabase still generates and verifies the
 * code, the hook still fires, only the handset is missing.
 *
 * Refuses to construct in production. A console sender that reaches production
 * is an authentication system that silently stops authenticating anybody.
 */
export class ConsoleOtpSender implements OtpSender {
  readonly name = "console";
  readonly channel = "whatsapp" as const;

  constructor(nodeEnv: string | undefined = process.env.NODE_ENV) {
    if (nodeEnv === "production") {
      throw new Error(
        "ConsoleOtpSender must not run in production: it prints the code to the log and delivers nothing.",
      );
    }
  }

  async send(message: OtpMessage): Promise<OtpSendResult> {
    console.info(
      `\n  ┌─ OTP (console sender, nothing was sent)\n  │  to      ${message.to}\n  │  code    ${message.code}\n  │  expires in ${message.expiresInMinutes} min\n  └─\n`,
    );
    return { delivered: true, providerRef: "console", detail: "printed to the server log" };
  }
}
