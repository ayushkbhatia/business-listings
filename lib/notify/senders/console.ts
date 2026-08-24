import type { NotificationChannel } from "../routing";
import type { NotificationSendResult, NotificationSender, OutboundNotification } from "./sender";

/**
 * Writes the notification to the server log instead of sending it.
 *
 * For every channel that has nowhere to go yet, which today is WhatsApp
 * (waiting on Meta) and SMS (the Bird key has no sms scope). The rest of the
 * layer — routing, quiet hours, templates, the delivery log — is exercised
 * exactly as it will be in production; only the handset is missing.
 *
 * Refuses to construct in production, like its counterpart in lib/auth/otp. A
 * console sender that reaches production is a notification system that has
 * quietly stopped notifying anybody and still looks healthy.
 */
export class ConsoleNotificationSender implements NotificationSender {
  readonly name: string;

  constructor(
    readonly channel: NotificationChannel,
    nodeEnv: string | undefined = process.env.NODE_ENV,
  ) {
    if (nodeEnv === "production") {
      throw new Error(
        `ConsoleNotificationSender must not run in production: the ${channel} channel would deliver nothing.`,
      );
    }
    this.name = `console:${channel}`;
  }

  async send(message: OutboundNotification): Promise<NotificationSendResult> {
    console.info(
      `\n  ┌─ ${this.channel} (console sender, nothing was sent)\n` +
        `  │  to     ${message.to}\n` +
        (message.subject ? `  │  subject ${message.subject}\n` : "") +
        `  │  body   ${message.body}\n` +
        (message.actionUrl ? `  │  action ${message.actionLabel ?? "Open"} ${message.actionUrl}\n` : "") +
        `  └─\n`,
    );
    return { delivered: true, providerRef: "console", detail: "printed to the server log" };
  }
}
