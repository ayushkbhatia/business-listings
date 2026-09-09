import "server-only";
import { prisma } from "@/lib/db/client";
import { formatAED, formatCount, formatDate, UAE_LOCALE } from "@/lib/format";
/*
   Type-only, and written as `import type` rather than an inline `type` marker.

   `scripts/check-audit-coverage.mts` follows value imports out of the admin
   screens to find modules that mutate without an audit row, and it strips
   `import type { … }` before it looks. An inline marker is not stripped, so the
   shorter form would drag `lib/onboarding/service.ts` into that graph and fail
   a check about staff decisions with a module that makes none.
*/
import type { Task } from "@/lib/onboarding/service";
import { t } from "@/lib/i18n";
import { notify, type NotifyOutcome } from "./service";
import { route, type RoutingPreference } from "./routing";
import { render } from "./render";
import { resolveNotificationSenders } from "./senders";
import { absoluteUrl } from "@/lib/site";
import { withParams } from "./params";
import { reachabilityOf } from "@/lib/team/reachability";
import { recordEvent } from "@/lib/telemetry/record";

/**
 * The events, wired to the things that cause them.
 *
 * Each of these is called from the service that already did the work — the
 * fan-out, the quote send, the acceptance — and none of them can fail that
 * work. A carrier being down must not roll back an enquiry, so every one
 * swallows its own errors and says so in the log.
 *
 * Sellers route through their matrix on board 7e. Buyers have no matrix: 7e is
 * the seller's control panel and nothing in this handoff gives a buyer one, so
 * buyer-facing events use the default below. Quiet hours still apply to them —
 * a WhatsApp at two in the morning is rude whoever receives it — and there is
 * no high-value override, because a buyer set no threshold to override.
 */
const BUYER_DEFAULT: RoutingPreference = {
  matrix: {
    quote_received: ["whatsapp", "in_app"],
    quote_revised: ["in_app"],
    quote_expiring: ["in_app"],
    /*
       In-app only, deliberately. Board 11b caps the seller at one follow-up
       because a second loses more deals than it wins; putting that one on
       WhatsApp would make the cap a formality — the interruption is the part
       that costs the deal, not the message. A buyer weighing four quotes gets
       it where they are already comparing them.
    */
    message_received: ["in_app"],
  },
  quiet: { enabled: true, fromHour: 21, toHour: 7, onSunday: true },
  highValueOverrideAed: null,
};

/** Fire and forget. Never throws, never blocks the caller's transaction. */
async function safely(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (cause) {
    console.error(`[notify] ${what} failed`, { cause });
  }
}

/**
 * A new enquiry reached a supplier.
 *
 * One per recipient, and — since board 7e — to the seat the router chose rather
 * than always to the owner. The whole point of the WhatsApp template is two taps
 * from here to a quote in progress, so the deep link lands on the composer,
 * which moved to `/dashboard/leads/:id` with board 3j. It pointed at `/thread`
 * for as long as the composer lived there; the sentence and the destination move
 * together or one of them becomes untrue.
 *
 * ## Nothing is dropped
 *
 * 7e §2.1, and it is the rule that makes the `GOES TO` column mean anything:
 * "if nobody is assigned, or the assigned seat has no verified channel, the
 * event goes to the owner." Both halves happen here, and both are counted —
 * `fallback_to_owner` with `reason: unassigned | unreachable` is one of the two
 * numbers §9 says are the only evidence that a lead arrived and nobody heard it.
 *
 * A business whose owner is themselves unreachable still gets the notification
 * written: `notify` records a skipped delivery per channel with the reason, and
 * in-app is never suppressed, so the lead appears in the list either way. The
 * dead end this pair of screens closes is silence, not the absence of a buzz.
 */
export async function onEnquiryDelivered(input: {
  enquiryId: string;
  businessIds: readonly string[];
  valueAed?: number | null;
}): Promise<void> {
  await safely("enquiry_received", async () => {
    const enquiry = await prisma.enquiry.findUnique({
      where: { id: input.enquiryId },
      select: {
        id: true,
        ref: true,
        requirement: true,
        deliverToArea: true,
        neededBy: true,
        closesAt: true,
        _count: { select: { lines: true } },
      },
    });
    if (!enquiry) return;

    const [owners, recipients] = await Promise.all([
      prisma.user.findMany({
        where: { businessId: { in: [...input.businessIds] }, roles: { has: "seller_owner" } },
        select: { id: true, businessId: true },
      }),
      /*
         Read after routing, which is where `lib/enquiry/service.ts` calls this
         from — assign, then notify. Reading it before would find every row
         unassigned and send every lead to the owner, which is what this
         function did before board 7e and why the `GOES TO` column had nothing
         behind it.
      */
      prisma.enquiryRecipient.findMany({
        where: { enquiryId: input.enquiryId, businessId: { in: [...input.businessIds] } },
        select: { businessId: true, assignedToId: true },
      }),
    ]);

    const assignee = new Map(recipients.map((row) => [row.businessId, row.assignedToId]));

    for (const owner of owners) {
      if (!owner.businessId) continue;
      const target = await recipientFor(owner.businessId, assignee.get(owner.businessId) ?? null, owner.id);

      await notify({
        event: "enquiry_received",
        businessId: owner.businessId,
        recipientUserId: target,
        enquiryId: enquiry.id,
        ...(input.valueAed === undefined ? {} : { valueAed: input.valueAed }),
        params: withParams("enquiry_received", {
          ref: enquiry.ref,
          summary: firstClause(enquiry.requirement),
          neededBy: enquiry.neededBy ? formatDate(enquiry.neededBy) : "no date given",
          closesAt: formatDate(enquiry.closesAt),
          area: enquiry.deliverToArea ?? "the UAE",
          lineCount: enquiry._count.lines,
          enquiryId: enquiry.id,
          shortLink: absoluteUrl(`/dashboard/leads/${enquiry.id}`),
        }),
      });
    }
  });
}

/**
 * A quote is about to run out of time. Board 7e §2, added.
 *
 * "3k ships the expiry window and had nothing notifying it" — the pipeline draws
 * an `Expiring soon` tab and an extend action, and until now the only way a
 * seller met either was by opening the screen. A quote that lapses unnoticed is
 * a deal that ended because nobody looked.
 *
 * To the seat that owns the lead, through the same fallback as a new enquiry:
 * a notification about a quote is useless to somebody who cannot open it.
 *
 * Once per quote, guarded by the caller in `lib/quotes/expiry-job.ts` —
 * `notify()` deduplicates nothing, and a daily sweep would otherwise send this
 * every day of the window.
 */
export async function onQuoteExpiring(input: {
  enquiryId: string;
  businessId: string;
  quoteRef: string;
  expiresAt: Date;
}): Promise<void> {
  await safely("quote_expiring", async () => {
    const [owner, recipient] = await Promise.all([
      prisma.user.findFirst({
        where: { businessId: input.businessId, roles: { has: "seller_owner" } },
        select: { id: true },
      }),
      prisma.enquiryRecipient.findUnique({
        where: { enquiryId_businessId: { enquiryId: input.enquiryId, businessId: input.businessId } },
        select: { assignedToId: true },
      }),
    ]);
    if (!owner) return;

    await notify({
      event: "quote_expiring",
      businessId: input.businessId,
      enquiryId: input.enquiryId,
      recipientUserId: await recipientFor(
        input.businessId,
        recipient?.assignedToId ?? null,
        owner.id,
      ),
      params: withParams("quote_expiring", {
        quoteRef: input.quoteRef,
        expiresAt: formatDate(input.expiresAt),
      }),
    });
  });
}

/**
 * Who actually hears about this lead. Board 7e §2.1.
 *
 * The assigned seat where there is one and it can be reached; the owner
 * otherwise, with the reason recorded. The two reasons are different problems —
 * `unassigned` is a routing question and `unreachable` is a channel question —
 * and a seller looking at a rising count needs to know which screen to open.
 */
async function recipientFor(
  businessId: string,
  assignedToId: string | null,
  ownerId: string,
): Promise<string> {
  if (assignedToId === null) {
    /*
       Not a failure under `everyone`, which is the default mode and what most
       suppliers run — the lead was never meant to have an owner. It is still
       counted, because the same null under round-robin means the router looked
       and found nobody, and `EnquiryRecipient.unroutedReason` is what tells the
       two apart for anybody reading the rows.
    */
    await countFallback(businessId, "unassigned");
    return ownerId;
  }
  if (assignedToId === ownerId) return ownerId;

  const reach = await reachabilityOf(businessId, assignedToId);
  if (reach?.reachable) return assignedToId;

  await countFallback(businessId, "unreachable");
  return ownerId;
}

async function countFallback(businessId: string, reason: "unassigned" | "unreachable"): Promise<void> {
  try {
    await recordEvent({ name: "fallback_to_owner", businessId, props: { reason } });
  } catch (cause) {
    // A telemetry write must never cost a notification.
    console.error("[notify] fallback_to_owner failed", { cause });
  }
}

/** A buyer accepted a quote. The one event a seller most wants to hear. */
export async function onQuoteAccepted(input: {
  enquiryId: string;
  businessId: string;
  quoteRef: string;
  totalAed: string;
}): Promise<void> {
  await safely("quote_accepted", async () => {
    const [owner, enquiry] = await Promise.all([
      prisma.user.findFirst({
        where: { businessId: input.businessId, roles: { has: "seller_owner" } },
        select: { id: true },
      }),
      /*
       * The enquiry ref, which the email template asks for and this did not
       * supply. It read "your quote {quoteRef} for enquiry {ref}" and would
       * have thrown `MissingParamError` rather than sending — caught by the
       * placeholder check in `lib/notify/params.ts`, which is what that check
       * is for. A seller thinks in enquiry refs, so the copy is right and the
       * emitter was wrong.
       */
      prisma.enquiry.findUnique({
        where: { id: input.enquiryId },
        select: { ref: true },
      }),
    ]);
    if (!owner || !enquiry) return;

    await notify({
      event: "quote_accepted",
      businessId: input.businessId,
      recipientUserId: owner.id,
      enquiryId: input.enquiryId,
      valueAed: Number(input.totalAed),
      params: withParams("quote_accepted", {
        ref: enquiry.ref,
        quoteRef: input.quoteRef,
        amount: formatAED(input.totalAed),
        enquiryId: input.enquiryId,
        shortLink: absoluteUrl(`/dashboard/leads/${input.enquiryId}`),
      }),
    });
  });
}

/**
 * A quote reached a buyer.
 *
 * Buyer-side, so it routes through BUYER_DEFAULT rather than a matrix. Written
 * out here rather than reusing `notify` because that function reads a
 * NotificationPreference row, and a buyer has none.
 */
export async function onQuoteSent(input: {
  enquiryId: string;
  businessId: string;
  revision: number;
}): Promise<void> {
  await safely("quote_received", async () => {
    const enquiry = await prisma.enquiry.findUnique({
      where: { id: input.enquiryId },
      select: { id: true, ref: true, buyer: {
        select: {
          id: true,
          phone: true,
          email: true,
          // `buyerActionUrl` needs both: the token, and whether it still works.
          claimToken: true,
          isProvisional: true,
        },
      } },
    });
    const business = await prisma.business.findUnique({
      where: { id: input.businessId },
      select: { displayName: true, slug: true },
    });
    if (!enquiry || !business) return;

    const event = input.revision > 1 ? "quote_revised" : "quote_received";
    const decisions = route(BUYER_DEFAULT, { event, now: new Date() });
    const senders = resolveNotificationSenders();

    for (const decision of decisions) {
      const template = await prisma.notificationTemplate.findFirst({
        where: { event, channel: decision.channel, status: "live", locale: "en" },
        orderBy: { version: "desc" },
      });
      if (!template) continue;

      const rendered = render(
        template,
        withParams(event, {
          ref: enquiry.ref,
          businessName: business.displayName,
          businessSlug: business.slug,
          revision: input.revision,
          enquiryId: enquiry.id,
          shortLink: absoluteUrl(`/enquiry/${enquiry.id}/compare`),
        }),
      );

      const status =
        decision.action !== "send"
          ? decision.action === "defer"
            ? "deferred"
            : "skipped"
          : await deliver(decision.channel, senders, rendered, enquiry.buyer);

      await prisma.notificationDelivery.create({
        data: {
          templateId: template.id,
          event,
          channel: decision.channel,
          status,
          recipientUserId: enquiry.buyer.id,
          enquiryId: enquiry.id,
          reason: decision.action === "send" ? null : decision.reason,
          scheduledFor: decision.action === "defer" ? decision.at : null,
          sentAt: status === "sent" ? new Date() : null,
        },
      });
    }
  });
}

/**
 * A seller's follow-up reached a buyer who had gone quiet.
 *
 * The only message-shaped notification in the product, and it exists because
 * board 11b's follow-up is aimed at somebody who by definition is not looking at
 * the thread. Every other notification here is about a quote.
 *
 * Buyer-side, so it routes through BUYER_DEFAULT like `onQuoteSent` — a buyer
 * has no `NotificationPreference` row to read.
 *
 * `preview` is the seller's own words, truncated. Nothing here summarises them:
 * 11b's rule is that we suggest the act and never the number, and a body
 * composed on this side would be the platform writing a commitment on a carrier
 * the supplier cannot see.
 */
export async function onSellerMessage(input: {
  enquiryId: string;
  businessId: string;
  body: string;
}): Promise<void> {
  await safely("message_received", async () => {
    const enquiry = await prisma.enquiry.findUnique({
      where: { id: input.enquiryId },
      select: { id: true, buyer: {
        select: {
          id: true,
          phone: true,
          email: true,
          // `buyerActionUrl` needs both: the token, and whether it still works.
          claimToken: true,
          isProvisional: true,
        },
      } },
    });
    const business = await prisma.business.findUnique({
      where: { id: input.businessId },
      select: { displayName: true, slug: true },
    });
    if (!enquiry || !business) return;

    const event = "message_received" as const;
    const decisions = route(BUYER_DEFAULT, { event, now: new Date() });
    const senders = resolveNotificationSenders();

    for (const decision of decisions) {
      const template = await prisma.notificationTemplate.findFirst({
        where: { event, channel: decision.channel, status: "live", locale: "en" },
        orderBy: { version: "desc" },
      });
      if (!template) continue;

      const rendered = render(
        template,
        withParams(event, {
          businessName: business.displayName,
          preview: preview(input.body),
          enquiryId: enquiry.id,
          shortLink: absoluteUrl(`/enquiry/${enquiry.id}/thread/${business.slug}`),
        }),
      );

      const status =
        decision.action !== "send"
          ? decision.action === "defer"
            ? "deferred"
            : "skipped"
          : await deliver(decision.channel, senders, rendered, enquiry.buyer);

      await prisma.notificationDelivery.create({
        data: {
          templateId: template.id,
          event,
          channel: decision.channel,
          status,
          recipientUserId: enquiry.buyer.id,
          enquiryId: enquiry.id,
          reason: decision.action === "send" ? null : decision.reason,
          scheduledFor: decision.action === "defer" ? decision.at : null,
          sentAt: status === "sent" ? new Date() : null,
        },
      });
    }
  });
}

/**
 * A seller asked a buyer for a review. Board 11c, `B2`.
 *
 * ## The channel is decided per buyer, not per event
 *
 * Every other emitter in this file reads a routing matrix: a static list of
 * channels for the event, the same for everybody. This one cannot. Board 11c's
 * panel promises *"WhatsApp where we have a number, email otherwise"*, which is
 * a fact about the buyer rather than about the event — and `User.phone` and
 * `User.email` are both nullable, so a fixed matrix would either send twice to
 * the buyers we hold both for, or send nothing to the ones we hold only an
 * email for. `lib/reviews/channel.ts` makes the choice; this delivers it.
 *
 * So `channel` arrives as an argument. `requestReview` resolves it before it
 * writes the `ReviewRequest` row and refuses when there is none — because the
 * row is the one-per-buyer rule, and a request that recorded the ask and sent
 * nothing would have spent a seller's single chance at that buyer on silence.
 *
 * Quiet hours still apply, through `route()` on a one-event matrix. A WhatsApp
 * at two in the morning asking for a review is rude in a way the request itself
 * is not, and this is the least urgent message the platform sends.
 *
 * No in-app companion, deliberately: this goes to somebody who finished a deal
 * weeks ago and has no reason to open the site. See `requestChannelFor`.
 */
export async function onReviewRequested(input: {
  enquiryId: string;
  businessId: string;
  channel: "whatsapp" | "email";
}): Promise<void> {
  await safely("review_requested", async () => {
    const enquiry = await prisma.enquiry.findUnique({
      where: { id: input.enquiryId },
      select: { id: true, ref: true, buyer: {
        select: {
          id: true,
          phone: true,
          email: true,
          // `buyerActionUrl` needs both: the token, and whether it still works.
          claimToken: true,
          isProvisional: true,
        },
      } },
    });
    const business = await prisma.business.findUnique({
      where: { id: input.businessId },
      select: { displayName: true },
    });
    if (!enquiry || !business) return;

    const event = "review_requested" as const;
    const decisions = route(
      { ...BUYER_DEFAULT, matrix: { [event]: [input.channel] } },
      { event, now: new Date() },
    );
    const senders = resolveNotificationSenders();

    for (const decision of decisions) {
      const template = await prisma.notificationTemplate.findFirst({
        where: { event, channel: decision.channel, status: "live", locale: "en" },
        orderBy: { version: "desc" },
      });
      /*
         Nothing to render on the one channel we chose.

         `requestReview` asked the same table which channels were live before it
         picked, so reaching this means a template was retired between that read
         and this one. Recording the skip is the whole point: the seller has
         spent their one request on this buyer either way, and a delivery row
         saying `no_template` is how anybody finds out.
      */
      if (!template) {
        await prisma.notificationDelivery.create({
          data: {
            event,
            channel: decision.channel,
            status: "skipped",
            recipientUserId: enquiry.buyer.id,
            businessId: input.businessId,
            enquiryId: enquiry.id,
            reason: "no_template",
          },
        });
        continue;
      }

      const rendered = render(
        template,
        withParams(event, {
          businessName: business.displayName,
          ref: enquiry.ref,
          enquiryId: enquiry.id,
        }),
      );

      const status =
        decision.action !== "send"
          ? decision.action === "defer"
            ? "deferred"
            : "skipped"
          : await deliver(decision.channel, senders, rendered, enquiry.buyer);

      await prisma.notificationDelivery.create({
        data: {
          templateId: template.id,
          event,
          channel: decision.channel,
          status,
          recipientUserId: enquiry.buyer.id,
          businessId: input.businessId,
          enquiryId: enquiry.id,
          reason: decision.action === "send" ? null : decision.reason,
          scheduledFor: decision.action === "defer" ? decision.at : null,
          sentAt: status === "sent" ? new Date() : null,
        },
      });
    }
  });
}

/**
 * A buyer published a review. Board 11c.
 *
 * The half of this board's loop that had no emitter. A seller has twenty-eight
 * days to reply — `REPLY_WINDOW_DAYS`, measured from the review date — and the
 * window was running against a review nobody had told them about. The seeded
 * `review_posted` email has said *"You may reply once, and the reply cannot be
 * edited afterwards"* since handoff 2 and had never been sent; it also carried
 * three placeholders against an event that declared no params, so the first
 * thing to call it would have thrown rather than sent.
 *
 * Seller-side, so it goes through `notify` and the business's own matrix on
 * board 7e — and to the **owner**, not through `recipientFor`. A review is
 * about the business rather than about a lead in somebody's inbox, and
 * `review.reply` is owner and manager only (docs/permissions.md §2), so routing
 * it to the sales seat that handled the enquiry would tell the one person who
 * cannot answer it.
 *
 * The rating and not the words. A notification carrying a two-star review's
 * body puts the complaint in a WhatsApp before the seller has opened the page
 * where they can answer it, and there is no reply box in a notification.
 */
export async function onReviewPosted(input: { reviewId: string }): Promise<void> {
  await safely("review_posted", async () => {
    const review = await prisma.review.findUnique({
      where: { id: input.reviewId },
      select: {
        overall: true,
        businessId: true,
        enquiryId: true,
        enquiry: { select: { ref: true } },
      },
    });
    if (!review) return;

    const owner = await prisma.user.findFirst({
      where: { businessId: review.businessId, roles: { has: "seller_owner" } },
      select: { id: true },
    });
    if (!owner) return;

    await notify({
      event: "review_posted",
      businessId: review.businessId,
      recipientUserId: owner.id,
      enquiryId: review.enquiryId,
      params: withParams("review_posted", {
        rating: review.overall,
        ref: review.enquiry.ref,
        enquiryId: review.enquiryId,
      }),
    });
  });
}

/**
 * A review dispute was decided. Board 11c `B5`.
 *
 * The rail tells a seller the decision takes about two working days and that
 * *"the outcome and the reason are logged and sent to you"*. The log was the
 * easy half; this is the half that makes the sentence true, and without it the
 * seller's only way to find out would be to keep reopening the page.
 *
 * ## The outcome, not the reasoning
 *
 * Two params and no more. `render()` refuses a value that looks like contact
 * details, and a moderator's reason is prose about a review that may itself be
 * a private-information complaint — *"the body carried the buyer's mobile"* is
 * a legitimate reason and a `MissingParamError`'s cousin waiting to happen. So
 * the reason lives on the review card, which the action link opens, and this
 * carries what a seller needs to know before they open it.
 *
 * To the **owner**, because `review.dispute` is owner-only: the seat that
 * raised it is the only seat that could have.
 */
export async function onReviewDisputeDecided(input: { disputeId: string }): Promise<void> {
  await safely("review_dispute_decided", async () => {
    const dispute = await prisma.reviewDispute.findUnique({
      where: { id: input.disputeId },
      select: { businessId: true, ground: true, outcome: true, raisedById: true },
    });
    if (!dispute || !dispute.outcome) return;

    /*
       The owner rather than the raiser.

       They are the same person today — `review.dispute` is owner-only — and
       they will not be if 7d ever widens the row. A decision about the
       business's public page belongs to whoever holds the business, not to
       whoever happened to be at the keyboard.
    */
    const owner = await prisma.user.findFirst({
      where: { businessId: dispute.businessId, roles: { has: "seller_owner" } },
      select: { id: true },
    });
    if (!owner) return;

    await notify({
      event: "review_dispute_decided",
      businessId: dispute.businessId,
      recipientUserId: owner.id,
      params: withParams("review_dispute_decided", {
        outcome: t(`reviews.dispute.outcome.${dispute.outcome}` as "reviews.dispute.outcome.upheld"),
        ground: t(`moderation.ground.${dispute.ground}` as "moderation.ground.abuse"),
      }),
    });
  });
}

/**
 * Enough of a message to decide whether to open it, and no more.
 *
 * Cut on a word boundary rather than mid-syllable, and never padded — a preview
 * shorter than the limit is the whole message and gets no ellipsis, so a buyer
 * can tell a complete short note from a truncated long one.
 */
const PREVIEW_CHARS = 140;

function preview(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= PREVIEW_CHARS) return flat;
  const cut = flat.slice(0, PREVIEW_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > PREVIEW_CHARS * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * A subscription was charged for another period.
 *
 * The first notification any scheduled job sends. Everything about it is
 * ordinary except where it is called from: `notify()` reads no request context —
 * no `headers()`, no `cookies()`, no actor — so a cron may call it, and the only
 * reason none ever had is that nothing in the product renewed anything.
 *
 * Seller-side, so it routes through the business's own matrix on board 7e and
 * respects their quiet hours. A seller with no `NotificationPreference` row gets
 * nothing and `notify` returns an empty list, which is the same graceful nothing
 * every other emitter gets in that case.
 *
 * A receipt and not a warning. There is no advance notice before a renewal:
 * that was considered and left out, and if it is wanted later it belongs beside
 * the job that knows the date rather than bolted to this one.
 */
export async function onSubscriptionRenewed(input: {
  businessId: string;
  planName: string;
  /** Already formatted by `filsToAed` — "8990.00". */
  amountAed: string;
  renewsAt: Date;
}): Promise<void> {
  await safely("subscription_renewed", async () => {
    const owner = await prisma.user.findFirst({
      where: { businessId: input.businessId, roles: { has: "seller_owner" } },
      select: { id: true },
    });
    if (!owner) return;

    await notify({
      event: "subscription_renewed",
      businessId: input.businessId,
      recipientUserId: owner.id,
      params: withParams("subscription_renewed", {
        planName: input.planName,
        amount: formatAED(input.amountAed),
        renewsAt: formatDate(input.renewsAt),
        shortLink: absoluteUrl("/dashboard/billing"),
      }),
    });
  });
}

/**
 * An enquiry nobody answered, escalated to the owner. Board 8d §8.
 *
 * The one promise on the invite screen that needed a job rather than a
 * sentence, and the reason §8 says an unkept version is worse here than
 * elsewhere: it sits next to a paragraph telling the seller their ranking
 * depends on reply time.
 *
 * To the owner, because that is what the screen says — "escalates to you".
 * `NotificationPreference.escalateToUserId` exists and would let a supplier
 * name somebody else; it is read by nothing yet, and honouring it here without
 * a screen to set it would be a behaviour nobody could see or change.
 *
 * Once per enquiry, guarded by the caller in `lib/enquiry/escalation-job.ts` —
 * `notify()` deduplicates nothing, and an owner paged hourly about one slow
 * enquiry turns notifications off.
 */
export async function onEnquiryEscalated(input: {
  enquiryId: string;
  businessId: string;
  /** The threshold that was passed, so the message can say how long. */
  minutes: number;
}): Promise<void> {
  await safely("enquiry_escalated", async () => {
    const [enquiry, owner] = await Promise.all([
      prisma.enquiry.findUnique({
        where: { id: input.enquiryId },
        select: { id: true, ref: true, closesAt: true },
      }),
      prisma.user.findFirst({
        where: { businessId: input.businessId, roles: { has: "seller_owner" } },
        select: { id: true },
      }),
    ]);
    if (!enquiry || !owner) return;

    await notify({
      event: "enquiry_escalated",
      businessId: input.businessId,
      enquiryId: input.enquiryId,
      recipientUserId: owner.id,
      params: withParams("enquiry_escalated", {
        ref: enquiry.ref,
        // The seeded templates say "hours", and a threshold a seller set in
        // minutes reads badly as "120 hours". Rounded up, so a 90-minute
        // threshold reads as two rather than as one it has not reached.
        hours: formatCount(Math.max(1, Math.ceil(input.minutes / 60))),
        closesAt: formatDate(enquiry.closesAt),
        enquiryId: enquiry.id,
      }),
    });
  });
}

/**
 * The one setup nudge, 72 hours after a listing went live.
 *
 * Board 8a states the promise on the hub in so many words — one WhatsApp three
 * days after go-live if anything is still open, then nothing — and a panel that
 * makes a promise on a job's behalf is a panel the job has to honour. The
 * once-ever guard therefore lives in `lib/setup/nudge-job.ts` rather than here:
 * `notify()` reads no `NotificationDelivery` before it writes one, so nothing
 * in this layer deduplicates anything.
 *
 * What this function owns is what the message says. The open tasks and their
 * estimate arrive from the sweep, which read them out of the same
 * `setupStateFor` the hub is built on, and the names come from the same
 * `setup.task.*` strings the cards render — so the message and the screen it
 * links to cannot name different work or a different number.
 *
 * Seller-side, so it routes through the business's own matrix on board 7e and
 * respects quiet hours. A seller who has turned WhatsApp off for alerts gets no
 * reminder, which is exactly what `setup.reminder.opted_out` tells them on the
 * hub, and a seller with no `NotificationPreference` row at all gets the same
 * graceful nothing every other emitter gets.
 */
export async function onSetupUnfinished(input: {
  businessId: string;
  /** Still open, and the seller's own to finish. Never empty. */
  openTasks: readonly Task[];
  /** What those tasks are estimated to take, added up. */
  minutes: number;
}): Promise<void> {
  await safely("setup_nudge", async () => {
    if (input.openTasks.length === 0) return;

    const owner = await prisma.user.findFirst({
      where: { businessId: input.businessId, roles: { has: "seller_owner" } },
      select: { id: true },
    });
    if (!owner) return;

    await notify({
      event: "setup_nudge",
      businessId: input.businessId,
      recipientUserId: owner.id,
      params: withParams("setup_nudge", {
        taskList: taskList(input.openTasks),
        minutes: formatCount(input.minutes),
      }),
    });
  });
}

/**
 * "Add photographs and Invite somebody".
 *
 * `Intl.ListFormat` rather than `join(", ")`, because the conjunction is a
 * translation and the catalogue has no key for one. The task names are the
 * hub's own, so a seller reads the same words in the message and on the screen
 * it sends them to.
 */
function taskList(tasks: readonly Task[]): string {
  const names = tasks.map((task) => t(`setup.task.${task}` as "setup.task.photos"));
  return new Intl.ListFormat(UAE_LOCALE, { style: "long", type: "conjunction" }).format(names);
}

/** The buyer surfaces that resolve a provisional identity from `?t=`. */
const TOKENED_PREFIXES = ["/enquiry/", "/review/"] as const;

/**
 * The claim token, onto the link the buyer is about to be sent.
 *
 * Most buyers have no account — that is the product's stated default, and
 * `lib/auth/flow.ts` treats it as the normal case rather than the exception.
 * Every buyer surface identifies them by the claim token their enquiry was
 * created with, read from `?t=` by `resolveBuyerId`, and a page reached without
 * one calls `notFound()`.
 *
 * Every link in every buyer notification was built without it. So the live
 * review-request email pointed at `/review/new?enq=…` and 404'd for exactly the
 * buyer it was written for — and `tests/e2e/reviews.spec.ts` asserted that 404
 * as the expected behaviour, which is why it survived. The tracking page had
 * the same `withToken` helper inline all along; the notifications never got it.
 *
 * Stamped here rather than in each template, because the templates are rows in
 * a database and the ones in production cannot be edited by a commit. Here it
 * covers every buyer event, including the ones not seeded yet.
 *
 * Only on the two buyer prefixes, and only while the buyer is provisional: a
 * bearer secret does not belong on a link to a page that has no use for it, and
 * the token stops working the moment the account is claimed.
 */
export function buyerActionUrl(
  actionPath: string,
  buyer: { claimToken: string | null; isProvisional: boolean },
): string {
  const tokened =
    buyer.isProvisional &&
    buyer.claimToken &&
    TOKENED_PREFIXES.some((prefix) => actionPath.startsWith(prefix))
      ? `${actionPath}${actionPath.includes("?") ? "&" : "?"}t=${buyer.claimToken}`
      : actionPath;
  return absoluteUrl(tokened);
}

async function deliver(
  channel: "whatsapp" | "sms" | "email" | "in_app",
  senders: ReturnType<typeof resolveNotificationSenders>,
  rendered: ReturnType<typeof render>,
  buyer: {
    id: string;
    phone: string | null;
    email: string | null;
    claimToken: string | null;
    isProvisional: boolean;
  },
): Promise<"sent" | "failed" | "skipped"> {
  const sender = senders[channel];
  if (!sender) return "skipped";
  const to = channel === "email" ? buyer.email : channel === "in_app" ? buyer.id : buyer.phone;
  if (!to) return "skipped";

  const result = await sender.send({
    channel,
    to,
    subject: rendered.subject,
    body: rendered.body,
    actionLabel: rendered.actionLabel,
    actionUrl: rendered.actionPath ? buyerActionUrl(rendered.actionPath, buyer) : null,
    recipientUserId: buyer.id,
  });
  return result.delivered ? "sent" : "failed";
}

/** The first sentence of a requirement, for a one-line summary. */
function firstClause(requirement: string): string {
  const first = requirement.trim().split(/(?<=\.)\s/)[0] ?? requirement;
  return first.length > 90 ? `${first.slice(0, 87).trimEnd()}…` : first;
}

export type { NotifyOutcome };

/**
 * A trade licence is about to expire. Board 3e §5.
 *
 * The sequence the verification screen writes down, and the half of it that
 * leaves the platform: an email at sixty days and again at fourteen. The third
 * point in that sequence is not a message — it is `sweepExpiredLicences`
 * dropping the tier, which the seller sees as the badge coming off.
 *
 * To the **owner**, and not through `recipientFor`. Every other seller-side
 * emitter routes to whoever holds the lead, because a message about an enquiry
 * is useless to somebody who cannot open it. A licence renewal is the opposite
 * shape: `listing.edit` is owner and manager only — docs/permissions.md §2,
 * "Upload verification documents" — so a sales seat told about it can do
 * nothing but forward the mail.
 *
 * Once per stage, guarded by the caller in
 * `lib/verification/licence-notice-job.ts`. `notify()` deduplicates nothing,
 * and a daily sweep would otherwise send this on all sixty days.
 */
export async function onLicenceExpiring(input: {
  businessId: string;
  expiresAt: Date;
  /** Whole days left, at the stage that fired. 60 or 14. */
  days: number;
}): Promise<void> {
  await safely("document_expiring", async () => {
    const owner = await prisma.user.findFirst({
      where: { businessId: input.businessId, roles: { has: "seller_owner" } },
      select: { id: true },
    });
    if (!owner) return;

    await notify({
      event: "document_expiring",
      businessId: input.businessId,
      recipientUserId: owner.id,
      params: withParams("document_expiring", {
        expiresAt: formatDate(input.expiresAt),
        days: formatCount(input.days),
      }),
    });
  });
}

/**
 * The Ramadan window we publish has moved.
 *
 * Board 3d's card makes a promise on the platform's behalf — *"The dates are
 * ours to get right: they follow the official UAE announcement, usually
 * confirmed a day or two before. We shift them and email you when they move."*
 * A commitment in shipped copy with no emitter behind it is the shape board 4e
 * Q2 already got wrong once, so this is the emitter.
 *
 * **It does not touch the seller's hours, and the mail says so.** The shift is
 * ours; re-opening their confirmation because we corrected our own estimate
 * would be asking them a question they have already answered. Board 3d's
 * "dates shifted after confirmation" state, in one function.
 *
 * Once per business per year, guarded by the caller in
 * `lib/trade/ramadan-shift-job.ts` — `notify()` deduplicates nothing, and the
 * sweep runs daily.
 */
export async function onRamadanDatesMoved(input: {
  businessId: string;
  year: number;
  from: Date;
  to: Date;
}): Promise<void> {
  await safely("ramadan_dates_moved", async () => {
    const owner = await prisma.user.findFirst({
      where: { businessId: input.businessId, roles: { has: "seller_owner" } },
      select: { id: true },
    });
    if (!owner) return;

    await notify({
      event: "ramadan_dates_moved",
      businessId: input.businessId,
      recipientUserId: owner.id,
      params: withParams("ramadan_dates_moved", {
        year: String(input.year),
        from: formatDate(input.from),
        to: formatDate(input.to),
      }),
    });
  });
}
