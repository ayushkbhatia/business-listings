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
import { openNow } from "@/lib/trade/open-now";
import type { RamadanHours, WeekHours } from "@/lib/trade/hours";
import { readRamadanCalendar } from "@/lib/trade/ramadan-calendar";

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
/**
 * Board 7e §3, the half the board left out.
 *
 * "An unverified number is hidden from buyers **and receives nothing**. Both
 * halves matter: an unverified number that still received alerts would make
 * reachability a lie, and the routing rule in 7d §4 depends on it being true."
 *
 * Recorded as its own reason rather than folded into `NO_ADDRESS`, because the
 * two send a seller to different places: no address is "add one", unverified is
 * "finish the one you added".
 */
const NOT_VERIFIED = "channel_entered_but_not_verified";

export async function notify(input: NotifyInput): Promise<NotifyOutcome[]> {
  const now = input.now ?? new Date();

  const [preference, recipient, channels, hours] = await Promise.all([
    prisma.notificationPreference.findUnique({ where: { businessId: input.businessId } }),
    prisma.user.findUnique({
      where: { id: input.recipientUserId },
      select: { id: true },
    }),
    /*
       Where this notification is actually allowed to go.

       Verified rows only. Before board 7e this read `user.phone` and
       `user.email` straight off the seat, which made "reachable on" a label
       rather than a rule — a seat could sit amber on two screens and still
       receive on the channel both screens said it could not.
    */
    prisma.seatChannel.findMany({
      where: { userId: input.recipientUserId, businessId: input.businessId, verifiedAt: { not: null } },
      select: { kind: true, address: true },
    }),
    quietFromHours(input.businessId, now),
  ]);
  if (!preference || !recipient) return [];

  const routing: RoutingPreference = {
    matrix: (preference.routing ?? {}) as RoutingPreference["matrix"],
    quiet: {
      enabled: preference.quietHoursEnabled,
      fromHour: preference.quietFromHour,
      toHour: preference.quietToHour,
      onSunday: preference.quietOnSunday,
      /*
         7e §5: "Source — the Hours page. Same source as the auto-reply and as
         7d's routing skip. One copy." Null where the supplier has published no
         hours at all, and then the stored window applies — which is the only
         thing it can mean for a business with no week to be outside of.
      */
      hours,
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
      /*
         Rendered now, not when it goes out.

         The row carries the recipient, the event and the channel and not a word
         of what the message said, so a deferred delivery could never be sent —
         which is why `queued` had no consumer. Rendering here also means a
         message held overnight says what was true when it happened: re-rendering
         at send would quietly describe a quote that had since been amended.

         `render` throws on a value shaped like contact details, and that guard
         is worth keeping on this path too.
      */
      outcomes.push(
        await record(
          input,
          decision.channel,
          template.id,
          "deferred",
          decision.reason,
          now,
          decision.at,
          heldPayload(render(template, input.params), template.metaTemplateName),
        ),
      );
      continue;
    }

    const sender = senders[decision.channel];
    if (!sender) {
      outcomes.push(await record(input, decision.channel, template.id, "skipped", NO_SENDER, now));
      continue;
    }

    const to = addressFor(decision.channel, recipient.id, channels);
    if (!to) {
      /*
         Unverified and absent are different facts and the log says which. A
         seller asking "why did I not hear about that enquiry" is owed the
         answer, and the two answers are different actions.
      */
      const entered = await prisma.seatChannel.count({
        where: {
          userId: input.recipientUserId,
          businessId: input.businessId,
          kind: decision.channel === "in_app" ? undefined : decision.channel,
          verifiedAt: null,
        },
      });
      outcomes.push(
        await record(
          input,
          decision.channel,
          template.id,
          "skipped",
          entered > 0 ? NOT_VERIFIED : NO_ADDRESS,
          now,
        ),
      );
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

/**
 * Where this channel actually delivers, or nothing.
 *
 * In-app needs no address and no proof — 7e §2 keeps it always on for anything
 * with a deadline, so a seller who has verified nothing still has a place the
 * work appears. Everything else comes from a verified `SeatChannel` row and
 * from nowhere else: an address on the `User` row is how somebody signs in, and
 * it stopped being how they are notified the moment "reachable on" became a
 * column two screens make promises about.
 */
function addressFor(
  channel: NotificationChannel,
  recipientId: string,
  channels: readonly { kind: string; address: string }[],
): string | null {
  if (channel === "in_app") return recipientId;
  return channels.find((row) => row.kind === channel)?.address ?? null;
}

/**
 * Whether the seller's own counter is shut, and when it next opens.
 *
 * The same `openNow` the storefront's badge reads, over the same published
 * hours, Ramadan and all. 7e §5 and 7d §4 both insist on one copy of the working
 * week, and a second one on the alerts screen is the contradiction that would
 * surface first during Ramadan — quiet hours running to 07:00 while the counter
 * opened at 09:00 and the routing skip agreed with neither.
 *
 * Null when nobody has published hours. That is not "always open" and not
 * "always shut": it is "this business has no week", and the stored 21:00–07:00
 * window is what the seller is left with until the Hours page is filled in.
 */
async function quietFromHours(
  businessId: string,
  now: Date,
): Promise<{ closedNow: boolean; opensAt: Date | null } | null> {
  const [locations, ramadan] = await Promise.all([
    prisma.location.findMany({
      where: { businessId, published: true },
      select: { hours: true, ramadanHours: true },
    }),
    readRamadanCalendar(),
  ]);
  if (locations.length === 0) return null;

  const states = locations.map((location) =>
    openNow(
      location.hours as WeekHours | null,
      location.ramadanHours as RamadanHours | null,
      now,
      ramadan,
    ),
  );
  const known = states.filter((state) => state.state !== "unknown");
  if (known.length === 0) return null;

  if (known.some((state) => state.state === "open")) return { closedNow: false, opensAt: null };
  return { closedNow: true, opensAt: nextOpeningAt(businessId, locations, ramadan, now) };
}

/**
 * The next instant any branch opens, walked hour by hour.
 *
 * The same shape `quietLiftsAt` uses and for the same reason: a wrapping window
 * crossed with a Ramadan block and a branch that trades Saturdays is two
 * overlapping rules, and the arithmetic for that is where the off-by-one lives.
 * A week of hours is 168 iterations and this runs once per notification on a
 * business that is shut.
 */
function nextOpeningAt(
  _businessId: string,
  locations: readonly { hours: unknown; ramadanHours: unknown }[],
  ramadan: Awaited<ReturnType<typeof readRamadanCalendar>>,
  now: Date,
): Date | null {
  const HOUR = 3_600_000;
  let cursor = new Date(Math.ceil(now.getTime() / HOUR) * HOUR);
  for (let i = 0; i < 24 * 8; i += 1) {
    const open = locations.some(
      (location) =>
        openNow(
          location.hours as WeekHours | null,
          location.ramadanHours as RamadanHours | null,
          cursor,
          ramadan,
        ).state === "open",
    );
    if (open) return cursor;
    cursor = new Date(cursor.getTime() + HOUR);
  }
  return null;
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
  payload?: HeldPayload,
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
        payload: (payload ?? null) as never,
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
 * What a held delivery needs to be sent later, and nothing more.
 *
 * Deliberately no address. The number or the email is read from the user when
 * the message actually goes out — the delivery log is a record of what
 * happened, not a copy of the address book, and a held row is still a log row.
 */
export interface HeldPayload {
  subject: string | null;
  body: string;
  actionLabel: string | null;
  actionUrl: string | null;
  metaTemplateName: string | null;
}

function heldPayload(
  rendered: ReturnType<typeof render>,
  metaTemplateName: string | null,
): HeldPayload {
  return {
    subject: rendered.subject,
    body: rendered.body,
    actionLabel: rendered.actionLabel,
    // Absolute here, because by the time this is sent there is no request to
    // resolve a relative path against.
    actionUrl: rendered.actionPath ? absoluteUrl(rendered.actionPath) : null,
    metaTemplateName,
  };
}

function readHeldPayload(value: unknown): HeldPayload | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Record<string, unknown>;
  if (typeof p["body"] !== "string") return null;
  return {
    subject: typeof p["subject"] === "string" ? p["subject"] : null,
    body: p["body"],
    actionLabel: typeof p["actionLabel"] === "string" ? p["actionLabel"] : null,
    actionUrl: typeof p["actionUrl"] === "string" ? p["actionUrl"] : null,
    metaTemplateName: typeof p["metaTemplateName"] === "string" ? p["metaTemplateName"] : null,
  };
}

export interface DeliverQueuedResult {
  sent: number;
  failed: number;
  /** Queued before the payload column existed, so there is nothing to send. */
  unsendable: number;
}

/**
 * Send what `flushDeferred` released.
 *
 * The half that was missing. `flushDeferred` moved a row from `deferred` to
 * `queued` and **nothing read `queued`**, so a notification held for quiet
 * hours moved from one waiting state to another and reached nobody. Scheduling
 * the flush was necessary and never sufficient.
 *
 * `queued` stays as the claim rather than being collapsed away: the flush marks
 * a batch, this sends it, and a row that crashes between the two is still
 * `queued` and gets picked up on the next run instead of being lost. It also
 * means two runs cannot send the same row twice.
 *
 * The address is read from the user here, never from the row.
 */
export async function deliverQueued(limit = 200): Promise<DeliverQueuedResult> {
  const due = await prisma.notificationDelivery.findMany({
    where: { status: "queued" },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: {
      id: true,
      channel: true,
      payload: true,
      recipientUserId: true,
      businessId: true,
      enquiryId: true,
    },
  });
  if (due.length === 0) return { sent: 0, failed: 0, unsendable: 0 };

  /*
     One query for the addresses, not one per row. `recipientUserId` is a plain
     column with no relation declared, which is deliberate — the log points at a
     user rather than owning one — so the lookup is explicit.
  */
  const ids = [...new Set(due.map((row) => row.recipientUserId).filter((id): id is string => !!id))];
  /*
     Verified channels, the same rule the live path applies.

     A message held overnight is sent in the morning against whatever is proven
     then — so a seat whose WhatsApp was revoked or never verified while the
     message waited does not receive it at dawn on a channel two screens say it
     cannot be reached on.
  */
  const channelsByUser = new Map<string, { kind: string; address: string }[]>();
  for (const row of await prisma.seatChannel.findMany({
    where: { userId: { in: ids }, verifiedAt: { not: null } },
    select: { userId: true, kind: true, address: true },
  })) {
    const list = channelsByUser.get(row.userId) ?? [];
    list.push({ kind: row.kind, address: row.address });
    channelsByUser.set(row.userId, list);
  }

  const senders = resolveNotificationSenders();
  let sent = 0;
  let failed = 0;
  let unsendable = 0;

  for (const row of due) {
    const payload = readHeldPayload(row.payload);
    const sender = senders[row.channel];
    const to = row.recipientUserId
      ? addressFor(row.channel, row.recipientUserId, channelsByUser.get(row.recipientUserId) ?? [])
      : null;

    /*
       No payload, no carrier, or no address. Marked failed with the reason
       rather than left queued, because a row that can never be sent and is
       never marked is a row this job retries for ever.
    */
    if (!payload || !sender || !to) {
      const reason = !payload ? "no_payload" : !sender ? NO_SENDER : NO_ADDRESS;
      if (!payload) unsendable += 1;
      else failed += 1;
      await prisma.notificationDelivery.update({
        where: { id: row.id },
        data: { status: "failed", reason },
      });
      continue;
    }

    const result = await sender.send({
      channel: row.channel,
      to,
      subject: payload.subject,
      body: payload.body,
      actionLabel: payload.actionLabel,
      actionUrl: payload.actionUrl,
      metaTemplateName: payload.metaTemplateName,
      recipientUserId: row.recipientUserId,
      businessId: row.businessId,
      enquiryId: row.enquiryId,
    });

    if (result.delivered) sent += 1;
    else failed += 1;

    await prisma.notificationDelivery.update({
      where: { id: row.id },
      data: {
        status: result.delivered ? "sent" : "failed",
        sentAt: result.delivered ? new Date() : null,
        ...(result.detail ? { reason: result.detail } : {}),
      },
    });
  }

  return { sent, failed, unsendable };
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
