import "server-only";
import { BirdWhatsAppNotificationSender } from "./bird-whatsapp";
import { ConsoleNotificationSender } from "./console";
import { InAppNotificationSender } from "./in-app";
import { ResendEmailNotificationSender } from "./resend-email";
import type { NotificationChannel } from "../routing";
import type { NotificationSender } from "./sender";

export type { NotificationSendResult, NotificationSender, OutboundNotification } from "./sender";
export { BirdWhatsAppNotificationSender } from "./bird-whatsapp";
export { ConsoleNotificationSender } from "./console";
export { InAppNotificationSender } from "./in-app";
export { ResendEmailNotificationSender } from "./resend-email";

/**
 * One sender per channel, decided once from the environment.
 *
 * In-app always works: the delivery row is the notification. WhatsApp goes to
 * Bird when it is configured, and email to Resend when it is. SMS still has no
 * carrier — the Bird key has no `sms` scope — so in development it prints and
 * in production it is absent, which the service records as a skip with a reason
 * rather than pretending to have sent.
 *
 * A missing carrier is never a silent success. See docs/auth-whatsapp-otp.md
 * for what remains switched off and who has to switch it on.
 */
export function resolveNotificationSenders(
  env: NodeJS.ProcessEnv = process.env,
): Partial<Record<NotificationChannel, NotificationSender>> {
  const production = env["NODE_ENV"] === "production";
  const senders: Partial<Record<NotificationChannel, NotificationSender>> = {
    in_app: new InAppNotificationSender(),
  };

  const apiBase = env["BIRD_API_BASE"]?.trim();
  const apiKey = env["BIRD_API_KEY"]?.trim();
  if (apiBase && apiKey) {
    const channelId = env["BIRD_WHATSAPP_CHANNEL_ID"]?.trim();
    senders.whatsapp = new BirdWhatsAppNotificationSender({
      apiBase,
      apiKey,
      ...(channelId ? { channelId } : {}),
    });
  } else if (!production) {
    senders.whatsapp = new ConsoleNotificationSender("whatsapp", env["NODE_ENV"]);
  }

  /*
     Email, when Resend is configured.

     Both parts are required. A `from` on a domain Resend has not verified is
     accepted by the API and then not delivered, so treating the key alone as
     enough would turn a configuration mistake into silent non-delivery — which
     is the one failure this layer is built to avoid.
  */
  const resendKey = env["RESEND_API_KEY"]?.trim();
  const resendFrom = env["RESEND_FROM"]?.trim();
  if (resendKey && resendFrom) {
    const replyTo = env["RESEND_REPLY_TO"]?.trim();
    senders.email = new ResendEmailNotificationSender({
      apiKey: resendKey,
      from: resendFrom,
      ...(replyTo ? { replyTo } : {}),
    });
  } else if (!production) {
    senders.email = new ConsoleNotificationSender("email", env["NODE_ENV"]);
  }

  // SMS still has no carrier. Absent in production is the honest state: the
  // service writes a skip with a reason, which is auditable, rather than a
  // sent it cannot back up.
  if (!production) {
    senders.sms = new ConsoleNotificationSender("sms", env["NODE_ENV"]);
  }

  return senders;
}
