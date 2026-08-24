import "server-only";
import { BirdWhatsAppNotificationSender } from "./bird-whatsapp";
import { ConsoleNotificationSender } from "./console";
import { InAppNotificationSender } from "./in-app";
import type { NotificationChannel } from "../routing";
import type { NotificationSender } from "./sender";

export type { NotificationSendResult, NotificationSender, OutboundNotification } from "./sender";
export { BirdWhatsAppNotificationSender } from "./bird-whatsapp";
export { ConsoleNotificationSender } from "./console";
export { InAppNotificationSender } from "./in-app";

/**
 * One sender per channel, decided once from the environment.
 *
 * In-app always works: the delivery row is the notification. WhatsApp goes to
 * Bird when it is configured. SMS and email have no carrier yet — the Bird key
 * has no `sms` scope and the Supabase SMTP sends two messages an hour — so in
 * development they print and in production they are absent, which the service
 * records as a skip with a reason rather than pretending to have sent.
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

  // No carrier for either yet. Absent in production is the honest state: the
  // service writes a skip with a reason, which is auditable, rather than a
  // sent it cannot back up.
  if (!production) {
    senders.sms = new ConsoleNotificationSender("sms", env["NODE_ENV"]);
    senders.email = new ConsoleNotificationSender("email", env["NODE_ENV"]);
  }

  return senders;
}
