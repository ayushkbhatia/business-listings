import "server-only";
import { prisma } from "@/lib/db/client";
import { absoluteUrl } from "@/lib/site";
import { render, type RenderParams } from "./render";
import {
  route,
  type NotificationChannel,
  type NotificationEvent,
  type RoutingPreference,
} from "./routing";
import { resolveNotificationSenders } from "./senders";

/**
 * Sending a notification.
 *
 * The order is deliberate and each step can stop the next:
 *
 *   1. read the seller's matrix and quiet hours;
 *   2. decide per channel — send, defer, or skip;
 *   3. resolve the live template for that event and channel;
 *   4. render it, which refuses a value that looks like contact details;
 *   5. write a delivery row, then hand it to the carrier.
 *
 * The delivery row is written whatever happens, including for a skip and its
 * reason. A seller asking "why did I not hear about that enquiry" deserves an
 * answer, and the answer is usually one of their own settings.
 *
 * Nothing here throws for an ordinary failure. A carrier being down must not
 * roll back an enquiry.
 */

export interface NotifyInput {
  event: NotificationEvent;
  businessId: string;
  /** Whose handset. Read at send time and never written to the log. */
  recipientUserId: string;
  enquiryId?: string | null;
  /** For the high-value quiet-hours override. */
  valueAed?: number | null;
  params: RenderParams;
  now?: Date;
}

export interface NotifyOutcome {
  channel: NotificationChannel;
  status: "sent" | "deferred" | "skipped" | "failed";
  reason?: string;
  deliveryId: string;
}

/** A template a seller has switched off is not an error, so these are reasons. */
const NO_TEMPLATE = "no_live_template";
const NO_SENDER = "no_carrier_configured";
const NO_ADDRESS = "recipient_has_no_address_for_this_channel";

export async function notify(input: NotifyInput): Promise<NotifyOutcome[]> {
  const now = input.now ?? new Date();

  const [preference, recipient] = await Promise.all([
    prisma.notificationPreference.findUnique({ where: { businessId: input.businessId } }),
    prisma.user.findUnique({
      where: { id: input.recipientUserId },
      select: { id: true, phone: true, email: true },
    }),
  ]);
  if (!preference || !recipient) return [];

  const routing: RoutingPreference = {
    matrix: (preference.routing ?? {}) as RoutingPreference["matrix"],
    quiet: {
      enabled: preference.quietHoursEnabled,
      fromHour: preference.quietFromHour,
      toHour: preference.quietToHour,
      onSunday: preference.quietOnSunday,
    },
    highValueOverrideAed: preference.highValueOverrideAed,
  };

  const decisions = route(routing, {
    event: input.event,
    now,
    ...(input.valueAed === undefined ? {} : { valueAed: input.valueAed }),
  });
  if (decisions.length === 0) return [];

  const senders = resolveNotificationSenders();
  // One query for every channel, not one per channel. A fan-out to eight
  // suppliers across four channels was thirty-two identical round trips.
  const templates = await liveTemplates(input.event);
  const outcomes: NotifyOutcome[] = [];

  for (const decision of decisions) {
    const template = templates.get(decision.channel) ?? null;

    if (!template) {
      // Usually a WhatsApp template still waiting on Meta. Recorded, so the
      // gap is visible rather than silent.
      outcomes.push(await record(input, decision.channel, null, "skipped", NO_TEMPLATE, now));
      continue;
    }

    if (decision.action === "skip") {
      outcomes.push(
        await record(input, decision.channel, template.id, "skipped", decision.reason, now),
      );
      continue;
    }

    if (decision.action === "defer") {
      outcomes.push(
        await record(input, decision.channel, template.id, "deferred", decision.reason, now, decision.at),
      );
      continue;
    }

    const sender = senders[decision.channel];
    if (!sender) {
      outcomes.push(await record(input, decision.channel, template.id, "skipped", NO_SENDER, now));
      continue;
    }

    const to = addressFor(decision.channel, recipient);
    if (!to) {
      outcomes.push(await record(input, decision.channel, template.id, "skipped", NO_ADDRESS, now));
      continue;
    }

    // Throws on a value that looks like contact details, which is a bug rather
    // than a delivery failure — so it is not caught here.
    const rendered = render(template, input.params);

    const result = await sender.send({
      channel: decision.channel,
      to,
      subject: rendered.subject,
      body: rendered.body,
      actionLabel: rendered.actionLabel,
      actionUrl: rendered.actionPath ? absoluteUrl(rendered.actionPath) : null,
      metaTemplateName: template.metaTemplateName,
      recipientUserId: recipient.id,
      businessId: input.businessId,
      enquiryId: input.enquiryId ?? null,
    });

    outcomes.push(
      await record(
        input,
        decision.channel,
        template.id,
        result.delivered ? "sent" : "failed",
        result.detail,
        now,
      ),
    );
  }

  return outcomes;
}

/**
 * Every live template for an event, by channel.
 *
 * Highest version wins, and only `live` counts. A `pending_meta` WhatsApp
 * template is one Meta has not approved: sending against it is rejected at the
 * carrier, so it is not a template as far as this layer is concerned.
 *
 * Fetched in one query for all four channels. Per-channel it was thirty-two
 * identical round trips for a fan-out to eight suppliers, which is the kind of
 * cost that only shows up once the thing is actually wired to something.
 */
export type LiveTemplate = {
  id: string;
  body: string;
  subject: string | null;
  actionLabel: string | null;
  actionPath: string | null;
  metaTemplateName: string | null;
};

async function liveTemplates(
  event: NotificationEvent,
): Promise<Map<NotificationChannel, LiveTemplate>> {
  const rows = await prisma.notificationTemplate.findMany({
    where: { event, status: "live", locale: "en" },
    orderBy: { version: "asc" },
    select: {
      channel: true,
      id: true,
      body: true,
      subject: true,
      actionLabel: true,
      actionPath: true,
      metaTemplateName: true,
    },
  });

  // Ascending, so the last write per channel is the highest version.
  const byChannel = new Map<NotificationChannel, LiveTemplate>();
  for (const { channel, ...template } of rows) byChannel.set(channel, template);
  return byChannel;
}

function addressFor(
  channel: NotificationChannel,
  recipient: { id: string; phone: string | null; email: string | null },
): string | null {
  switch (channel) {
    case "whatsapp":
    case "sms":
      return recipient.phone;
    case "email":
      return recipient.email;
    case "in_app":
      return recipient.id;
  }
}

/** Never throws. A delivery log that takes the send down is worse than no log. */
async function record(
  input: NotifyInput,
  channel: NotificationChannel,
  templateId: string | null,
  status: "sent" | "deferred" | "skipped" | "failed",
  reason: string | undefined,
  now: Date,
  scheduledFor?: Date,
): Promise<NotifyOutcome> {
  try {
    const row = await prisma.notificationDelivery.create({
      data: {
        templateId,
        event: input.event,
        channel,
        status: status === "deferred" ? "deferred" : status,
        // A user id, never a number. The number is read at send time and the
        // log is a record of what happened, not a copy of the address book.
        recipientUserId: input.recipientUserId,
        businessId: input.businessId,
        enquiryId: input.enquiryId ?? null,
        reason: reason ?? null,
        scheduledFor: scheduledFor ?? null,
        sentAt: status === "sent" ? now : null,
      },
      select: { id: true },
    });
    return { channel, status, ...(reason ? { reason } : {}), deliveryId: row.id };
  } catch (cause) {
    console.error("[notify] could not write a delivery row", { event: input.event, channel, cause });
    return { channel, status, ...(reason ? { reason } : {}), deliveryId: "" };
  }
}

/**
 * Send what quiet hours held.
 *
 * Called by a scheduled job. Deferred rows carry the instant the window lifts,
 * so this is a query rather than a calculation — and a row whose window lifted
 * while the job was not running still goes out, late, rather than never.
 */
export async function flushDeferred(now: Date = new Date()): Promise<number> {
  const due = await prisma.notificationDelivery.findMany({
    where: { status: "deferred", scheduledFor: { lte: now } },
    select: { id: true },
    take: 200,
  });
  if (due.length === 0) return 0;

  // Marked queued rather than sent: the carrier has not been called yet, and
  // claiming otherwise would make the log lie.
  await prisma.notificationDelivery.updateMany({
    where: { id: { in: due.map((d) => d.id) } },
    data: { status: "queued", reason: "quiet_hours_lifted" },
  });
  return due.length;
}
