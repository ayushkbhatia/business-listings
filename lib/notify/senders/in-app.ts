import "server-only";
import type { NotificationSendResult, NotificationSender } from "./sender";

/**
 * In-app. The one channel that always works.
 *
 * There is nothing to carry: the delivery row the service already writes *is*
 * the notification, and the seller's bell reads that table. So this sender
 * confirms rather than sends, and it is why in-app is never deferred by quiet
 * hours — nothing buzzes, and a list is the same list at 07:00 as at 22:00.
 */
export class InAppNotificationSender implements NotificationSender {
  readonly name = "in-app";
  readonly channel = "in_app" as const;

  // No parameter: there is genuinely nothing to read. The interface allows an
  // implementation to take fewer arguments than it is given.
  async send(): Promise<NotificationSendResult> {
    return { delivered: true, providerRef: "in_app" };
  }
}
