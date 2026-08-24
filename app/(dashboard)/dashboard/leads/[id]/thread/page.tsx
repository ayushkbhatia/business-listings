import { after } from "next/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/display/StatusBadge";
import { Card, KeyValuePanel, Panel } from "@/components/structure";
import type { MatchReason, QuoteLineDraft } from "@/components/domain/QuoteLineEditor";
import { getLeadDetail, type LeadDetail } from "@/lib/db/queries/seller";
import {
  formatAED,
  formatCount,
  formatCountdown,
  formatDate,
  formatDateTime,
  formatRelative,
  isWithinRelativeWindow,
} from "@/lib/format";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../../../_shell";
import { markLeadOpened } from "@/lib/db/mutations/lead";
import { prisma } from "@/lib/db/client";
import { getThread } from "@/lib/messaging/service";
import { toThreadQuotes } from "@/lib/messaging/thread-view";
import { SellerThread } from "./SellerThread";
import { QuoteComposer } from "./QuoteComposer";

/**
 * Board 11b — the seller's view of one enquiry, and the quote composer on it.
 *
 * Two halves. The quote composer came first in step 1, because the quote model
 * is far easier to get right while the enquiry is a fixture; the thread lands
 * here in step 4 beside it. They share a page because a seller pricing a line
 * and a seller answering a question about it are the same person in the same
 * minute.
 */
export const dynamic = "force-dynamic";

const AVAILABILITY_LABEL = {
  in_stock: "availability.in_stock",
  made_to_order: "availability.made_to_order",
  indent: "availability.indent",
  out_of_stock: "availability.out_of_stock",
} as const;

export default async function LeadThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const seat = await requireSellerSeat();
  const [lead, badges, messages, recipient] = await Promise.all([
    getLeadDetail(seat.businessId, id),
    getNavBadges(seat.businessId),
    getThread(id, seat.businessId),
    prisma.enquiryRecipient.findUnique({
      where: { enquiryId_businessId: { enquiryId: id, businessId: seat.businessId } },
      select: { nudgedAt: true, state: true },
    }),
  ]);
  if (!lead) notFound();

  // A read should not block on a write. `openedAt` feeds the buyer's tracking
  // page and is not part of what this page renders.
  after(() => markLeadOpened(id, seat.businessId));

  const nextRevision = (lead.quotes[0]?.revision ?? 0) + 1;
  // Read once, at the top, rather than during render. Every relative label on
  // this page then measures from the same instant.
  const now = new Date();

  // Every revision this seller has sent, so the thread can strike the previous
  // total through. Computed by the same helper the buyer's side uses.
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
   * A closed enquiry still lets the accepted pair talk: that is delivery being
   * arranged, and cutting it off pushes exactly the conversation this platform
   * wants on the record onto WhatsApp.
   */
  const closedToUs =
    lead.closesAt.getTime() < now.getTime() && lead.state !== "quoted";

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/leads"
      eyebrow={t("lead.eyebrow", { ref: lead.ref })}
      title={lead.requirement.split(".")[0] ?? lead.ref}
      meta={
        <span className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={lead.state === "quoted" ? "ok" : "info"} size="sm" shape="chip">
            {t(`leads.state.${lead.state}` as "leads.state.delivered")}
          </StatusBadge>
          <span className="text-caption text-muted">
            {lead.closesAt.getTime() <= now.getTime()
              ? t("leads.closed")
              : isWithinRelativeWindow(lead.closesAt, { now })
                ? t("leads.closes_in", { duration: formatCountdown(lead.closesAt, { now }) })
                : t("leads.closes_on", { when: formatDate(lead.closesAt) })}
          </span>
        </span>
      }
      breadcrumb={
        <Link
          href="/dashboard/leads"
          className="rounded-tag text-caption text-muted underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("lead.back_to_leads")}
        </Link>
      }
    >
      {/*
        * The composer takes the full width. In a two-column layout the unit
        * price column fell off the end of a 1280 laptop and had to be scrolled
        * to — and the price field is the one thing a seller came here to fill
        * in. The enquiry facts read fine underneath; the price does not read
        * fine sideways.
        */}
      <div className="space-y-[var(--gutter)]">
        <ContactNotice lead={lead} />

        <Panel
          title={t("lead.compose_title")}
          description={t("lead.compose_description")}
          eyebrow={nextRevision > 1 ? t("lead.revision_title", { revision: nextRevision }) : undefined}
        >
          <QuoteComposer enquiryId={lead.enquiryId} lines={toDrafts(lead)} />
        </Panel>

        <Panel title={t("thread.heading")}>
          <SellerThread
            enquiryId={lead.enquiryId}
            buyerFirstName={lead.buyer.firstName}
            readOnly={closedToUs}
            canNudge={recipient?.state === "quoted" && !recipient.nudgedAt}
            nudgedLabel={
              recipient?.nudgedAt
                ? t("thread.nudge_sent", { when: formatRelative(recipient.nudgedAt, { now }) })
                : null
            }
            messages={(messages ?? []).map((message) => {
              const quote = message.quoteRevisionId
                ? quoteViews.get(message.quoteRevisionId)
                : undefined;
              return {
                id: message.id,
                body: message.body,
                fromMe: message.fromSeller,
                senderLabel: message.fromSeller
                  ? seat.businessName
                  : lead.buyer.firstName,
                at: formatDateTime(message.createdAt),
                flagged: message.flagged,
                ...(quote ? { quote } : {}),
              };
            })}
          />
        </Panel>

        <div className="grid gap-[var(--gutter)] md:grid-cols-2 xl:grid-cols-3">
          <Panel title={t("lead.requirement")}>
            <p className="text-body-sm text-prose">{lead.requirement}</p>
          </Panel>

          <Panel title={t("term.enquiry")}>
            <KeyValuePanel
              columns={1}
              notProvidedLabel={t("table.not_provided")}
              entries={[
                { key: "buyer", label: t("lead.buyer"), value: lead.buyer.firstName },
                { key: "area", label: t("lead.deliver_to"), value: lead.deliverToArea ?? undefined },
                {
                  key: "needed",
                  label: t("lead.needed_by"),
                  value: lead.neededBy ? formatDate(lead.neededBy) : undefined,
                },
                {
                  key: "terms",
                  label: t("lead.terms_wanted"),
                  value: lead.termsWanted ? t(`terms.${lead.termsWanted}` as "terms.net_30") : undefined,
                },
                { key: "received", label: t("lead.received"), value: formatRelative(lead.createdAt, { now }) },
                { key: "closes", label: t("lead.closes"), value: formatDate(lead.closesAt) },
              ]}
            />
          </Panel>

          {lead.quotes.length > 0 ? <PreviousQuotes lead={lead} now={now} /> : null}
        </div>
      </div>
    </SellerPage>
  );
}

/**
 * Rule 1, stated to the seller rather than merely enforced behind them.
 *
 * A seller who does not know why there is no phone number assumes the platform
 * is broken. A seller who knows the number arrives on acceptance has a reason
 * to quote well.
 */
function ContactNotice({ lead }: { lead: LeadDetail }) {
  if (lead.buyer.released) {
    return (
      <Card padded>
        <h2 className="text-body-sm text-ink">{t("contact.released_title")}</h2>
        <p className="mt-1 text-caption text-muted">
          {t("contact.released_body", {
            name: lead.buyer.firstName,
            when: formatDate(lead.createdAt),
          })}
        </p>
        <dl className="mt-3 space-y-1 text-body-sm">
          {lead.buyer.companyName ? <dd className="text-ink">{lead.buyer.companyName}</dd> : null}
          {lead.buyer.phone ? <dd className="font-mono text-ink">{lead.buyer.phone}</dd> : null}
          {lead.buyer.email ? <dd className="text-ink">{lead.buyer.email}</dd> : null}
        </dl>
      </Card>
    );
  }

  return (
    <Card padded>
      <h2 className="text-body-sm text-ink">{t("contact.withheld_title")}</h2>
      <p className="mt-1 text-caption text-muted">
        {t("contact.withheld_body", { name: lead.buyer.firstName })}
      </p>
    </Card>
  );
}

function PreviousQuotes({ lead, now }: { lead: LeadDetail; now: Date }) {
  return (
    <Panel title={t("lead.previous_quotes")}>
      <ul className="space-y-2">
        {lead.quotes.map((quote) => (
          <li key={quote.id} className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-mono text-body-sm text-ink">{quote.ref}</span>
            <span className="text-caption text-muted">
              {quote.sentAt ? t("lead.quote_sent_at", { when: formatRelative(quote.sentAt, { now }) }) : ""}
            </span>
            <span className="font-mono tabular-nums text-body-sm text-ink">
              {formatAED(quote.totalAed)}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function toDrafts(lead: LeadDetail): QuoteLineDraft[] {
  // A revision starts from what was last sent, matched by enquiry line where
  // the previous quote recorded one.
  const last = lead.quotes[0];

  return lead.lines.map((line) => {
    const previous = last?.lines.find((l) => l.description === line.description);
    return {
      key: line.id,
      description: line.description,
      qty: line.qty,
      unit: line.unit,
      size: line.size,
      targetUnitPriceAed: line.targetUnitPriceAed,
      suggested: line.match.best
        ? {
            productId: line.match.best.product.id,
            name: line.match.best.product.name,
            sku: line.match.best.product.sku,
            availabilityLabel: t(
              AVAILABILITY_LABEL[line.match.best.product.availability as keyof typeof AVAILABILITY_LABEL] ??
                "availability.in_stock",
            ),
            stockLabel:
              line.match.best.product.stockQty !== null
                ? t("product.in_stock_qty", { qty: formatCount(line.match.best.product.stockQty) })
                : null,
            leadTimeDays: line.match.best.product.leadTimeDays,
            reasons: line.match.best.reasons as MatchReason[],
          }
        : null,
      alternatives: line.match.alternatives.map((alt) => ({
        productId: alt.product.id,
        name: alt.product.name,
        sku: alt.product.sku,
        availabilityLabel: t(
          AVAILABILITY_LABEL[alt.product.availability as keyof typeof AVAILABILITY_LABEL] ??
            "availability.in_stock",
        ),
        stockLabel:
          alt.product.stockQty !== null
            ? t("product.in_stock_qty", { qty: formatCount(alt.product.stockQty) })
            : null,
        leadTimeDays: alt.product.leadTimeDays,
        reasons: alt.reasons as MatchReason[],
      })),
      ...(previous
        ? {
            initialUnitPrice: previous.unitPrice,
            initialLeadTimeDays: previous.leadTimeDays,
            initialProductId: previous.productId,
          }
        : {}),
    };
  });
}
