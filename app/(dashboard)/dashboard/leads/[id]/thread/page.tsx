import { after } from "next/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/display/StatusBadge";
import { Card } from "@/components/structure";
import { PageEvent } from "@/components/telemetry";
import { buttonClassName } from "@/components/primitives";
import { prisma } from "@/lib/db/client";
import { markLeadOpened } from "@/lib/db/mutations/lead";
import { getLeadDetail } from "@/lib/db/queries/seller";
import {
  formatAED,
  formatCount,
  formatCountdown,
  formatDate,
  formatDateTime,
  formatMonth,
  formatRelative,
  isWithinRelativeWindow,
} from "@/lib/format";
import { t } from "@/lib/i18n";
import { getThread } from "@/lib/messaging/service";
import { toThreadQuotes } from "@/lib/messaging/thread-view";
import { getNavBadges, requireSellerSeat, SellerPage } from "../../../_shell";
import { FollowUp } from "./FollowUp";
import { SellerThread } from "./SellerThread";

/**
 * Board 11b — the seller's view of one conversation.
 *
 * The composer moved to `/dashboard/leads/:id` with board 3j, which is the
 * two-composer model §2 locks: an `RFQ` is priced on the inbox, an `ENQ` is
 * answered here, and both exits exist on both screens so a seller who decides a
 * quote needs a question first is never stuck.
 *
 * That move is also what makes the right rail possible. The previous version of
 * this page carried a note against a two-column layout — "the unit price column
 * fell off the end of a 1280 laptop and had to be scrolled to, and the price
 * field is the one thing a seller came here to fill in". True while the price
 * column was on this page; it no longer is, and a thread has no column to lose.
 */
export const metadata = { title: "Messages" };
export const dynamic = "force-dynamic";

export default async function LeadThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const seat = await requireSellerSeat();

  const [lead, badges, messages, recipient] = await Promise.all([
    getLeadDetail(seat.businessId, id),
    getNavBadges(seat.businessId),
    getThread(id, seat.businessId),
    prisma.enquiryRecipient.findUnique({
      where: { enquiryId_businessId: { enquiryId: id, businessId: seat.businessId } },
      select: {
        state: true,
        sellerNudgedAt: true,
        nudgeDueAt: true,
        outcome: true,
        enquiry: {
          select: {
            contactReleasedToBusinessId: true,
            _count: { select: { recipients: true } },
          },
        },
      },
    }),
  ]);
  if (!lead || !recipient) notFound();

  // A read should not block on a write. `openedAt` feeds the buyer's tracking
  // page and is not part of what this page renders.
  after(() => markLeadOpened(id, seat.businessId));

  // Read once, at the top, so every relative label measures from one instant.
  const now = new Date();

  const [buyerHistory, seatNames] = await Promise.all([
    buyerPanelFor(seat.businessId, id),
    sendersFor(messages ?? []),
  ]);

  const quoteViews = toThreadQuotes(
    lead.quotes.map((q) => ({
      id: q.id,
      ref: q.ref,
      revision: q.revision,
      lines: q.lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice })),
    })),
    (aed) => formatAED(aed),
    {
      down: (amount, percent) => t("thread.delta_down", { amount, percent }),
      up: (amount, percent) => t("thread.delta_up", { amount, percent }),
      same: t("thread.delta_same"),
    },
  );

  /*
     Read-only exactly where `postMessage` refuses.

     The previous version computed `closesAt < now && state !== "quoted"` while
     the service refused on `closed && not the accepted pair`, so a seller who
     quoted and did not win a closed enquiry met an enabled composer and got
     "closed" back on submit. One rule, in one place, and the screen follows it.
  */
  const closed = lead.closesAt.getTime() < now.getTime();
  const isAcceptedPair = recipient.enquiry.contactReleasedToBusinessId === seat.businessId;
  const readOnly = closed && !isAcceptedPair;

  const latestQuote = lead.quotes[0];
  const competing = recipient.enquiry._count.recipients;

  /*
     Buyer messages since the seller last wrote. Counted here from the thread
     already in hand rather than queried again — the rail computes the same
     number for its badge, and two queries for one fact is how the badge and the
     screen come to disagree.
  */
  const lastSellerAt = (messages ?? [])
    .filter((m) => m.fromSeller)
    .reduce<number>((latest, m) => Math.max(latest, m.createdAt.getTime()), 0);
  const unreadCount = (messages ?? []).filter(
    (m) => !m.fromSeller && m.createdAt.getTime() > lastSellerAt,
  ).length;

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/leads"
      eyebrow={t("lead.eyebrow", { ref: lead.ref })}
      title={
        lead.buyer.released && lead.buyer.companyName
          ? lead.buyer.companyName
          : lead.buyer.firstName
      }
      meta={
        <span className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={recipient.state === "quoted" ? "ok" : "info"} size="sm" shape="chip">
            {recipient.outcome === "won"
              ? t("thread.state.won")
              : recipient.outcome === "lost"
                ? t("thread.state.lost")
                : recipient.state === "quoted"
                  ? t("thread.state.quoted")
                  : t("thread.state.open")}
          </StatusBadge>
          {competing > 1 ? (
            <span className="text-caption text-muted">
              {t("thread.competing", {
                count: competing - 1,
                formatted: formatCount(competing - 1),
              })}
            </span>
          ) : null}
          <span className="text-caption text-muted">
            {closed
              ? t("leads.closed")
              : isWithinRelativeWindow(lead.closesAt, { now })
                ? t("leads.closes_in", { duration: formatCountdown(lead.closesAt, { now }) })
                : t("leads.closes_on", { when: formatDate(lead.closesAt) })}
          </span>
        </span>
      }
      breadcrumb={
        <Link
          href={`/dashboard/leads/${lead.enquiryId}`}
          className="rounded-tag text-caption text-muted underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("thread.back_to_inbox")}
        </Link>
      }
      actions={
        /*
           §2's other exit. This screen carries the way back into the composer,
           and the inbox carries the way in here. The label changes with what
           exists: there is nothing to revise before a first quote.
        */
        <Link
          href={`/dashboard/leads/${lead.enquiryId}`}
          className={buttonClassName({ variant: "secondary", size: "sm" })}
        >
          {latestQuote ? t("thread.revise_quote") : t("thread.send_quote")}
        </Link>
      }
    >
      {/*
         An attention fact. `unread` is what makes it useful: a thread opened
         with three buyer messages waiting is a different event from one opened
         to write into.
      */}
      <PageEvent
        name="thread_viewed"
        props={{
          state: recipient.outcome ?? recipient.state,
          messages: (messages ?? []).length,
          unread: unreadCount,
        }}
      />

      <div className="flex flex-col gap-[var(--gutter)] xl:flex-row">
        <div className="min-w-0 flex-1">
          <Card padded>
            <SellerThread
              enquiryId={lead.enquiryId}
              buyerFirstName={lead.buyer.firstName}
              readOnly={readOnly}
              notes={systemNotesFor(latestQuote, now)}
              messages={(messages ?? []).map((message) => {
                const quote = message.quoteRevisionId
                  ? quoteViews.get(message.quoteRevisionId)
                  : undefined;
                return {
                  id: message.id,
                  body: message.body,
                  fromMe: message.fromSeller,
                  /*
                     Which seat sent it, not the company name. Board 11b: a
                     shared inbox with anonymous replies makes a two-person
                     business unmanageable, and the previous version labelled
                     every seller message with the business.
                  */
                  senderLabel: message.fromSeller
                    ? (seatNames.get(message.senderId) ?? seat.businessName)
                    : lead.buyer.firstName,
                  at: formatDateTime(message.createdAt),
                  flagged: message.flagged,
                  automatic: message.automatic,
                  ...(quote ? { quote } : {}),
                };
              })}
            />
          </Card>
        </div>

        <aside className="w-full shrink-0 space-y-[var(--gutter)] xl:w-[326px]">
          <Card padded>
            <FollowUp
              enquiryId={lead.enquiryId}
              state={
                recipient.sellerNudgedAt
                  ? "sent"
                  : recipient.state !== "quoted"
                    ? "too_early"
                    : recipient.nudgeDueAt
                      ? "scheduled"
                      : "available"
              }
              sentLabel={
                recipient.sellerNudgedAt
                  ? t("thread.nudge_sent", {
                      when: formatRelative(recipient.sellerNudgedAt, { now }),
                    })
                  : null
              }
              scheduledLabel={
                recipient.nudgeDueAt
                  ? t("thread.nudge_scheduled", {
                      when: formatRelative(recipient.nudgeDueAt, { now }),
                    })
                  : null
              }
            />
          </Card>

          <Card padded>
            <BuyerPanel history={buyerHistory} termsWanted={lead.termsWanted} />
          </Card>

          {/*
            Already on screen before anybody tries. The enforcement path belongs
            to admin (board 4h); the detector behind it is real —
            lib/messaging/off-platform.ts raises a SupplierReport on an IBAN or a
            "transfer to", which is why this sentence is not a bluff.
          */}
          <div className="rounded-card border border-bad-line bg-bad-surface px-3 py-2.5">
            <p className="text-body-sm text-bad-ink">{t("thread.offplatform_title")}</p>
            <p className="mt-1 max-w-[var(--measure-prose)] text-caption text-bad-ink">
              {t("thread.offplatform_body")}
            </p>
          </div>
        </aside>
      </div>
    </SellerPage>
  );
}

/**
 * The read receipt, or nothing.
 *
 * Board 11b §6, and it says both directions out loud because a one-way receipt
 * is surveillance the buyer will discover. `Quote.readAt` had no writer until
 * lib/messaging/receipts.ts; before that this line would have said "not opened
 * yet" forever on every production row.
 */
function systemNotesFor(
  quote:
    | {
        readAt?: Date | null;
        sentAt: Date | null;
        expiresAt: Date | null;
        extensionCount?: number;
        extendedByName?: string | null;
      }
    | undefined,
  now: Date,
): string[] {
  if (!quote?.sentAt) return [];

  const notes = [
    quote.readAt
      ? t("thread.receipt_read", { when: formatRelative(quote.readAt, { now }) })
      : t("thread.receipt_unread"),
  ];

  /*
     Board 3k §5's audit line. Extending is silent — no message, no notification
     — but it moves a date the buyer is holding, so it goes on the record where
     both sides of a dispute can read it.

     Derived from the quote's own columns rather than written as a row: a
     `Message` would have been a notification, which is the one thing §5 says
     this action is not.
  */
  if (quote.extensionCount && quote.extensionCount > 0 && quote.expiresAt) {
    notes.push(
      quote.extendedByName
        ? t("quotes.extended_note", {
            when: formatDate(quote.expiresAt),
            name: quote.extendedByName,
          })
        : t("quotes.extended_note_unnamed", { when: formatDate(quote.expiresAt) }),
    );
  }

  return notes;
}

interface BuyerHistory {
  won: number;
  lastWonAt: Date | null;
  enquiries: number;
  firstAt: Date | null;
}

/**
 * This seller's own history with this buyer. Nothing else.
 *
 * Board 11b §5 cut two claims from the board: *"Pays on 30-day terms, on time"*
 * — we never take payment and never see an invoice, so it is unknowable — and
 * *"Accepts quotes 62% of the time"*, which aggregated the buyer's behaviour
 * across other suppliers inside a card whose own footer promised not to.
 *
 * Every figure below is scoped to `businessId`. The buyer's id is resolved and
 * used server-side and never leaves this function: lib/db/queries/
 * seller-visibility.ts is written so a seller surface cannot select it.
 */
async function buyerPanelFor(businessId: string, enquiryId: string): Promise<BuyerHistory> {
  const enquiry = await prisma.enquiry.findUnique({
    where: { id: enquiryId },
    select: { buyerId: true },
  });
  if (!enquiry) return { won: 0, lastWonAt: null, enquiries: 0, firstAt: null };

  const [won, lastWon, enquiries, first] = await Promise.all([
    prisma.enquiryRecipient.count({
      where: { businessId, outcome: "won", enquiry: { buyerId: enquiry.buyerId } },
    }),
    prisma.enquiryRecipient.findFirst({
      where: { businessId, outcome: "won", enquiry: { buyerId: enquiry.buyerId } },
      orderBy: { outcomeAt: "desc" },
      select: { outcomeAt: true },
    }),
    prisma.enquiryRecipient.count({
      where: { businessId, enquiry: { buyerId: enquiry.buyerId } },
    }),
    prisma.enquiryRecipient.findFirst({
      where: { businessId, enquiry: { buyerId: enquiry.buyerId } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
  ]);

  return {
    won,
    lastWonAt: lastWon?.outcomeAt ?? null,
    enquiries,
    firstAt: first?.createdAt ?? null,
  };
}

function BuyerPanel({
  history,
  termsWanted,
}: {
  history: BuyerHistory;
  termsWanted: string | null;
}) {
  const rows: { key: string; label: string; value: string }[] = [
    { key: "won", label: t("thread.buyer_won"), value: formatCount(history.won) },
    ...(history.lastWonAt
      ? [
          {
            key: "last",
            label: t("thread.buyer_last_won"),
            value: formatMonth(history.lastWonAt),
          },
        ]
      : []),
    {
      key: "enquiries",
      label: t("thread.buyer_enquiries"),
      value: formatCount(history.enquiries),
    },
    ...(history.firstAt
      ? [
          {
            key: "first",
            label: t("thread.buyer_first_seen"),
            value: formatMonth(history.firstAt),
          },
        ]
      : []),
    ...(termsWanted
      ? [
          {
            key: "terms",
            label: t("thread.buyer_terms"),
            value: t(`terms.${termsWanted}` as "terms.net_30"),
          },
        ]
      : []),
  ];

  return (
    <section aria-labelledby="buyer-panel" className="space-y-2.5">
      <h2
        id="buyer-panel"
        className="font-mono text-eyebrow uppercase tracking-wide text-muted"
      >
        {t("thread.buyer_heading")}
      </h2>

      {history.enquiries <= 1 && history.won === 0 ? (
        <p className="text-body-sm text-muted">{t("thread.buyer_new")}</p>
      ) : null}

      <dl className="space-y-1.5">
        {rows.map((row) => (
          <div key={row.key} className="flex items-baseline justify-between gap-3">
            <dt className="text-caption text-muted">{row.label}</dt>
            <dd className="font-mono text-body-sm tabular-nums text-ink">{row.value}</dd>
          </div>
        ))}
      </dl>

      {/* Load-bearing copy. Board 11b §5 keeps this sentence verbatim. */}
      <p className="max-w-[var(--measure-prose)] text-caption text-muted">
        {t("thread.buyer_footer")}
      </p>
    </section>
  );
}

/**
 * Which seat wrote each message.
 *
 * Board 11b: seller messages name the person, because a shared inbox with
 * anonymous replies makes a two-person business unmanageable. Only first names —
 * these are colleagues on one account, and the full name is not what a thread
 * needs.
 */
async function sendersFor(
  messages: readonly { senderId: string; fromSeller: boolean }[],
): Promise<Map<string, string>> {
  const ids = [...new Set(messages.filter((m) => m.fromSeller).map((m) => m.senderId))];
  if (ids.length === 0) return new Map();

  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, fullName: true },
  });

  return new Map(
    users.map((user) => [user.id, (user.fullName ?? "").trim().split(/\s+/)[0] ?? ""]),
  );
}
