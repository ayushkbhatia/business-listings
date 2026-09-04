import "server-only";
import { prisma } from "@/lib/db/client";
import { formatAED, formatDate } from "@/lib/format";
import { notify, type NotifyOutcome } from "./service";
import { route, type RoutingPreference } from "./routing";
import { render } from "./render";
import { resolveNotificationSenders } from "./senders";
import { absoluteUrl } from "@/lib/site";
import { withParams } from "./params";

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
 * One per recipient, to the owner seat. The whole point of the WhatsApp
 * template is two taps from here to a quote in progress, so the deep link
 * lands on the composer.
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

    const owners = await prisma.user.findMany({
      where: { businessId: { in: [...input.businessIds] }, roles: { has: "seller_owner" } },
      select: { id: true, businessId: true },
    });

    for (const owner of owners) {
      if (!owner.businessId) continue;
      await notify({
        event: "enquiry_received",
        businessId: owner.businessId,
        recipientUserId: owner.id,
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
          shortLink: absoluteUrl(`/dashboard/leads/${enquiry.id}/thread`),
        }),
      });
    }
  });
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
        shortLink: absoluteUrl(`/dashboard/leads/${input.enquiryId}/thread`),
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
      select: { id: true, ref: true, buyer: { select: { id: true, phone: true, email: true } } },
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

async function deliver(
  channel: "whatsapp" | "sms" | "email" | "in_app",
  senders: ReturnType<typeof resolveNotificationSenders>,
  rendered: ReturnType<typeof render>,
  buyer: { id: string; phone: string | null; email: string | null },
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
    actionUrl: rendered.actionPath ? absoluteUrl(rendered.actionPath) : null,
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
