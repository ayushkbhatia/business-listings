import "server-only";
import { prisma } from "@/lib/db/client";
import { t } from "@/lib/i18n";
import { openNow } from "@/lib/trade/open-now";
import type { Day, RamadanHours, WeekHours } from "@/lib/trade/hours";
import { readRamadanCalendar } from "@/lib/trade/ramadan-calendar";
import { postMessage } from "./service";

/**
 * Board 7e §4 — the acknowledgement sent when a lead lands out of hours.
 *
 * ## It does not stop the clock, and that is the whole design
 *
 * The board's card said an auto-reply "counts as a first response". It cannot,
 * and this is the most consequential correction in either screen. Board 3j
 * stamps `firstReplyAt` when a composer sends. If an automated acknowledgement
 * stamped it instead:
 *
 *   - the median first reply buyers read as a band on boards 1b and 1c would be
 *     measuring a robot;
 *   - the reply-time weight in search ranking would be won by installing a
 *     template;
 *   - board 3a's median card, 3k's speed card and 7d's per-seat medians would
 *     all report a number no human produced.
 *
 * Every seller would switch it on for that reason alone and the metric would be
 * worthless inside a month. The guard is in `lib/messaging/service.ts` — a
 * message marked `automatic` never stamps `firstReplyAt` — so the rule holds for
 * anything else that ever sends automatically, not only for this.
 *
 * ## Where it runs
 *
 * Inline, at the end of the fan-out, rather than on a sweep. §4 asks for "within
 * 60 seconds", and immediately is inside sixty seconds — a job would add a
 * schedule, a dedupe key and a window in which the buyer is told nothing, to
 * arrive later at the same message. It cannot fail the enquiry: every path here
 * swallows its own error, the same contract every other post-fan-out step has.
 *
 * ## Out of hours means the Hours page
 *
 * The same `openNow` the storefront badge reads, the same one quiet hours and
 * board 7d's routing skip read. §4 and §5 both insist on one copy of the working
 * week, and a business with no published hours is never "out of hours" here —
 * it has no week to be outside of, and guessing would send a shut-counter
 * message from a supplier who was sitting at the desk.
 */

/** What a seller may put in the body. Anything else is refused on save. */
export const AUTO_REPLY_TOKENS = ["buyer_name", "next_open_time", "whatsapp_number"] as const;
export type AutoReplyToken = (typeof AUTO_REPLY_TOKENS)[number];

/**
 * The copy sent when a seller has written none of their own.
 *
 * The tokens are passed as parameters rather than written into the catalogue
 * string, because `t()` reads `{…}` as its own placeholder: a literal
 * `{next_open_time}` in the message throws in development and prints the raw
 * key to a buyer in production. One function, so the screen and the sender
 * cannot end up with two versions of the default.
 */
export function defaultAutoReplyBody(): string {
  return t("autoreply.default_body", {
    openToken: "{next_open_time}",
    phoneToken: "{whatsapp_number}",
  });
}

/** A buyer reads this on a phone, under a supplier's name. */
export const AUTO_REPLY_MAX = 600;

/** Fire and forget. Never throws, never blocks the caller. */
export async function sendAutoReplies(input: {
  enquiryId: string;
  businessIds: readonly string[];
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  await Promise.all(
    input.businessIds.map(async (businessId) => {
      try {
        await sendAutoReply({ enquiryId: input.enquiryId, businessId, now });
      } catch (cause) {
        console.error("[auto-reply] failed", { enquiryId: input.enquiryId, businessId, cause });
      }
    }),
  );
}

export type AutoReplyOutcome =
  | { sent: true; messageId: string }
  | { sent: false; reason: "off" | "open" | "no_hours" | "no_seat" | "refused" };

/** One business. Exported for the test that has to assert each refusal. */
export async function sendAutoReply(input: {
  enquiryId: string;
  businessId: string;
  now?: Date;
}): Promise<AutoReplyOutcome> {
  const now = input.now ?? new Date();

  const business = await prisma.business.findUnique({
    where: { id: input.businessId },
    select: {
      autoReplyEnabled: true,
      autoReplyBody: true,
      locations: {
        where: { published: true },
        select: { hours: true, ramadanHours: true, whatsapp: true, phone: true },
      },
    },
  });
  if (!business?.autoReplyEnabled) return { sent: false, reason: "off" };
  if (business.locations.length === 0) return { sent: false, reason: "no_hours" };

  const ramadan = await readRamadanCalendar();
  const states = business.locations.map((location) =>
    openNow(
      location.hours as WeekHours | null,
      location.ramadanHours as RamadanHours | null,
      now,
      ramadan,
    ),
  );
  const known = states.filter((state) => state.state !== "unknown");
  // A business with no stated hours anywhere has no week to be outside of. The
  // same rule `lib/leads/router.ts` applies to the routing skip.
  if (known.length === 0) return { sent: false, reason: "no_hours" };
  if (known.some((state) => state.state === "open")) return { sent: false, reason: "open" };

  /*
     Sent by the owner's seat, because a message needs a sender and nothing here
     is a person. `Message.automatic` is what the thread renders and what the
     first-reply guard reads, so the seat on the row is a record of which
     business spoke rather than a claim that somebody typed it.
  */
  const owner = await prisma.user.findFirst({
    where: { businessId: input.businessId, roles: { has: "seller_owner" } },
    select: { id: true },
  });
  if (!owner) return { sent: false, reason: "no_seat" };

  const enquiry = await prisma.enquiry.findUnique({
    where: { id: input.enquiryId },
    select: { buyer: { select: { fullName: true } } },
  });

  const body = fill(business.autoReplyBody ?? defaultAutoReplyBody(), {
    // A first name and no more. Rule 1 does not relax because the sender is a
    // template: the seller has not been given the buyer's identity, and this
    // message goes out under the seller's name.
    buyer_name: firstName(enquiry?.buyer.fullName ?? null),
    next_open_time: nextOpenLabel(states),
    whatsapp_number:
      business.locations.find((location) => location.whatsapp)?.whatsapp ??
      business.locations.find((location) => location.phone)?.phone ??
      "",
  });

  const result = await postMessage({
    enquiryId: input.enquiryId,
    businessId: input.businessId,
    senderId: owner.id,
    sender: "seller",
    body,
    // The line this whole file exists for.
    automatic: true,
  });

  return result.ok ? { sent: true, messageId: result.messageId } : { sent: false, reason: "refused" };
}

/**
 * Fill the three tokens and nothing else.
 *
 * Not `t()`'s interpolation: this is a seller's own string from the database,
 * and running arbitrary stored text through the catalogue's placeholder
 * machinery would turn any `{word}` a supplier typed into a missing-parameter
 * report in production. An unknown token is left exactly as typed, which reads
 * as the mistake it is rather than as a blank.
 */
export function fill(template: string, values: Record<AutoReplyToken, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    (AUTO_REPLY_TOKENS as readonly string[]).includes(name)
      ? values[name as AutoReplyToken]
      : whole,
  );
}

/** Every token in a body that is not one of the three. For the save guard. */
export function unknownTokens(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)]
    .map((match) => match[1] as string)
    .filter((name) => !(AUTO_REPLY_TOKENS as readonly string[]).includes(name));
}

/** "08:00 on Sunday", or the plain time when it is later today. */
function nextOpenLabel(states: readonly ReturnType<typeof openNow>[]): string {
  for (const state of states) {
    if (state.state === "closed" && state.opensAt) {
      return state.opensDay
        ? t("autoreply.opens_on", { time: state.opensAt, day: dayName(state.opensDay) })
        : state.opensAt;
    }
  }
  return t("autoreply.opens_unknown");
}

function dayName(day: Day): string {
  return t(`storefront.day.${day}` as "storefront.day.sun");
}

/** The first word of a name, or nothing. Never a fabricated greeting. */
function firstName(full: string | null): string {
  return (full ?? "").trim().split(/\s+/)[0] ?? "";
}
