/**
 * Carrying a rendered notification to one channel.
 *
 * The same shape as the OTP sender in lib/auth/otp, and for the same reason:
 * the carrier is the part most likely to change, and three of the four are
 * blocked on somebody else's approval. An interface lets the whole layer be
 * built and tested while WhatsApp waits on Meta and email waits on an SMTP
 * provider that is not the development one.
 */
import type { NotificationChannel } from "../routing";

export interface OutboundNotification {
  channel: NotificationChannel;
  /** E.164 for whatsapp and sms, an address for email, a user id for in_app. */
  to: string;
  subject: string | null;
  body: string;
  actionLabel: string | null;
  /** Absolute by the time it reaches a sender. A relative link in an SMS is a dead link. */
  actionUrl: string | null;
  /** WhatsApp only: the Meta-approved template this maps to. */
  metaTemplateName?: string | null;
  /** For the in-app sender, which writes a row rather than sending anything. */
  recipientUserId?: string | null;
  businessId?: string | null;
  enquiryId?: string | null;
}

export interface NotificationSendResult {
  delivered: boolean;
  providerRef?: string;
  /** Safe to log and to show staff. Never the body, which can carry detail. */
  detail?: string;
}

export interface NotificationSender {
  readonly name: string;
  readonly channel: NotificationChannel;
  send(message: OutboundNotification): Promise<NotificationSendResult>;
}
