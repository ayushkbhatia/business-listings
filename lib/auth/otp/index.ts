import "server-only";
import { BirdWhatsAppOtpSender } from "./bird";
import { ConsoleOtpSender } from "./console";
import type { OtpSender } from "./sender";

export type { OtpChannel, OtpMessage, OtpSendResult, OtpSender } from "./sender";
export { BirdWhatsAppOtpSender } from "./bird";
export { ConsoleOtpSender } from "./console";

/**
 * Which sender this deployment uses, decided once from the environment.
 *
 * Bird when it is fully configured — base, key and a Meta-approved template
 * name. The console otherwise, which is honest about the state of things: the
 * template is the long pole and until Meta approves it there is nothing to
 * send through.
 *
 * In production a missing configuration throws rather than falling back. A
 * silent downgrade to the console sender would be an authentication system that
 * has quietly stopped authenticating anybody, and it would look healthy.
 */
export function resolveOtpSender(env: NodeJS.ProcessEnv = process.env): OtpSender {
  const apiBase = env["BIRD_API_BASE"]?.trim();
  const apiKey = env["BIRD_API_KEY"]?.trim();
  const templateName = env["BIRD_WHATSAPP_OTP_TEMPLATE"]?.trim();
  const channelId = env["BIRD_WHATSAPP_CHANNEL_ID"]?.trim();

  if (apiBase && apiKey && templateName) {
    return new BirdWhatsAppOtpSender({
      apiBase,
      apiKey,
      templateName,
      ...(channelId ? { channelId } : {}),
    });
  }

  if (env["NODE_ENV"] === "production") {
    const missing = [
      !apiBase && "BIRD_API_BASE",
      !apiKey && "BIRD_API_KEY",
      !templateName && "BIRD_WHATSAPP_OTP_TEMPLATE",
    ].filter(Boolean);
    throw new Error(
      `No OTP sender is configured. Missing: ${missing.join(", ")}. ` +
        "Production will not fall back to the console sender.",
    );
  }

  return new ConsoleOtpSender(env["NODE_ENV"]);
}
