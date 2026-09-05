import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/display/StatusBadge";
import { PageEvent } from "@/components/telemetry";
import { Card, Panel } from "@/components/structure";
import type { MatchReason, QuoteLineDraft } from "@/components/domain/QuoteLineEditor";
import { can } from "@/lib/auth/can";
import { prisma } from "@/lib/db/client";
import { getLeadDetail, type LeadDetail } from "@/lib/db/queries/seller";
import {
  formatAED,
  formatCount,
  formatCountdown,
  formatDate,
  formatDuration,
  formatRelative,
  isWithinRelativeWindow,
} from "@/lib/format";
import { t } from "@/lib/i18n";
import { getInbox, type LeadRailRow, type LeadScope, type LeadTab } from "@/lib/leads/inbox";
import { assignableSeats } from "@/lib/leads/assign";
import { findDraft } from "@/lib/quote/draft";
import { getNavBadges, requireSellerSeat, SellerPage, type SellerSeat } from "../_shell";
import { LeadRail, railHref } from "./_rail";
import { Composer } from "./Composer";
import { LeadActions } from "./LeadActions";
import { ScopeFilter } from "./ScopeFilter";

/**
 * Board 3j — the inbox, rendered by both `/dashboard/leads` and
 * `/dashboard/leads/:id`.
 *
 * One component for two routes because they are one screen: the rail is
 * identical either way and the second route only adds a selection. Two page
 * files rendering two copies is how a tab count comes to differ between them.
 *
 * ## The routes did not move
 *
 * The composer moves here from the thread, which is what §2 asks — an `RFQ` is
 * priced, an `ENQ` is answered — but `/dashboard/leads/:id/thread` stays exactly
 * where it is. Nine call sites hard-code it, including both notification deep
 * links and `tests/e2e/auth.setup.ts`, which lands every signed-in seat on
 * `/dashboard/leads` and asserts an h1 containing "Leads". That h1 is load
 * bearing for five Playwright projects.
 */

const AVAILABILITY_LABEL = {
  in_stock: "availability.in_stock",
  made_to_order: "availability.made_to_order",
  indent: "availability.indent",
  out_of_stock: "availability.out_of_stock",
} as const;

export interface InboxProps {
  selectedId: string | null;
  search: Record<string, string | string[] | undefined>;
}

/** One querystring value, or nothing. Arrays are a repeated param, not a choice. */
function one(search: InboxProps["search"], key: string): string | undefined {
  const value = search[key];
  return typeof value === "string" ? value : undefined;
}

function parseTab(raw: string | undefined): LeadTab {
  return raw === "quoted" || raw === "won" || raw === "lost" ? raw : "open";
}

/**
 * Whose leads, defaulting by role.
 *
 * §1: the board defaulted every user to `Assigned to me`, which hides the queue
 * from the person answerable for it. An owner or a manager opens on everything;
 * a sales seat opens on their own and can widen it.
 */
function parseScope(raw: string | undefined, seat: SellerSeat): LeadScope {
  if (raw === "all") return { kind: "all" };
  if (raw === "mine") return { kind: "mine", userId: seat.actor.id };
  if (raw === "unassigned") return { kind: "unassigned" };
  if (raw?.startsWith("seat:")) {
    const userId = raw.slice("seat:".length);
    return userId ? { kind: "seat", userId } : { kind: "all" };
  }
  return can(seat.actor, "routing.manage")
    ? { kind: "all" }
    : { kind: "mine", userId: seat.actor.id };
}

export async function Inbox({ selectedId, search }: InboxProps) {
  const seat = await requireSellerSeat();
  const tab = parseTab(one(search, "tab"));
  const scope = parseScope(one(search, "scope"), seat);
  const cursor = one(search, "cursor") ?? null;

  const [page, badges, seats, business] = await Promise.all([
    getInbox({ businessId: seat.businessId, tab, scope, cursor }),
    getNavBadges(seat.businessId),
    assignableSeats(seat.actor, seat.businessId),
    prisma.business.findUniqueOrThrow({
      where: { id: seat.businessId },
      select: { responseTimeMedianMs: true, suspendedAt: true },
    }),
  ]);

  // Read once, at the top, so every relative label on this page measures from
  // the same instant.
  const now = new Date();

  const scopeOptions = [
    { value: "all", label: t("leads.scope.all") },
    { value: "mine", label: t("leads.scope.mine") },
    { value: "unassigned", label: t("leads.scope.unassigned") },
    ...(can(seat.actor, "routing.manage")
      ? seats
          .filter((s) => !s.isSelf)
          .map((s) => ({
            value: `seat:${s.id}`,
            label: s.name || t("lead.assign_unnamed"),
          }))
      : []),
  ];

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/leads"
      title={t("leads.title")}
      meta={
        <span className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={page.counts.overdue > 0 ? "bad" : "neutral"} size="sm" shape="chip">
            {page.counts.overdue > 0
              ? t("leads.overdue_pill", {
                  count: page.counts.overdue,
                  formatted: formatCount(page.counts.overdue),
                })
              : t("leads.none_overdue")}
          </StatusBadge>
          {/*
            The same figure board 3a shows, including its unmeasured branch.
            `responseTimeMedianMs` is null below three replies, and a pill with
            no null case would render "Median reply " over nothing.
          */}
          <span className="text-caption text-muted">
            {business.responseTimeMedianMs === null
              ? t("leads.median_unmeasured")
              : t("leads.median_reply", {
                  duration: formatDuration(business.responseTimeMedianMs),
                })}
          </span>
        </span>
      }
      actions={
        <ScopeFilter
          label={t("leads.scope_label")}
          value={scopeValue(scope)}
          options={scopeOptions}
        />
      }
    >
      {/*
        An attention fact, so the browser owns it: nothing on the server knows a
        screen was looked at. The tab and the scope are what the funnel groups
        by — whether sellers work the queue they were given or narrow it first.
      */}
      <PageEvent
        name="inbox_viewed"
        props={{
          tab,
          scope: scope.kind,
          open: page.counts.open,
          overdue: page.counts.overdue,
        }}
      />

      {business.suspendedAt ? <SuspendedNotice /> : null}

      {/*
        Two panes that scroll independently inside the shell's own scroll
        region. `min-h-0` on both is what stops a flex child refusing to shrink
        and pushing the whole page into one long scroll — the failure that makes
        a master-detail layout feel broken rather than merely tall.
      */}
      <div className="flex h-full min-h-0 gap-[var(--gutter)]">
        <aside className="hidden w-[352px] shrink-0 overflow-hidden rounded-card border border-line bg-card lg:flex lg:flex-col">
          <LeadRail page={page} tab={tab} scope={scope} selectedId={selectedId} />
        </aside>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          {/* Below the split, the rail is the page. */}
          <div className="mb-[var(--gutter)] overflow-hidden rounded-card border border-line bg-card lg:hidden">
            <LeadRail page={page} tab={tab} scope={scope} selectedId={selectedId} />
          </div>

          {selectedId ? (
            <LeadDetailPane
              seat={seat}
              enquiryId={selectedId}
              tab={tab}
              scope={scope}
              now={now}
              seats={seats}
              suspended={business.suspendedAt !== null}
              /*
                 The rail already computed this row's band and where it sits.
                 Recomputing either here would be a second answer to a question
                 the list has already answered — and a deep link opens a lead the
                 current page may not contain, which is why both are optional
                 rather than defaulted to something.
              */
              railRow={page.rows.find((row) => row.enquiryId === selectedId) ?? null}
              railPosition={page.rows.findIndex((row) => row.enquiryId === selectedId)}
            />
          ) : (
            <div className="hidden lg:block">
              <NothingSelected />
            </div>
          )}
        </div>
      </div>
    </SellerPage>
  );
}

function scopeValue(scope: LeadScope): string {
  return scope.kind === "seat" ? `seat:${scope.userId}` : scope.kind;
}

function SuspendedNotice() {
  return (
    <div className="mb-[var(--gutter)]">
      <Card padded>
        <h2 className="text-body-sm text-ink">{t("leads.suspended_title")}</h2>
        <p className="mt-1 max-w-[var(--measure-prose)] text-caption text-muted">
          {t("leads.suspended_body")}
        </p>
      </Card>
    </div>
  );
}

function NothingSelected() {
  return (
    <Card padded>
      <h2 className="text-h3 text-ink">{t("leads.select_prompt")}</h2>
      <p className="mt-2 max-w-[var(--measure-prose)] text-body-sm text-muted">
        {t("leads.select_body")}
      </p>
    </Card>
  );
}

async function LeadDetailPane({
  seat,
  enquiryId,
  tab,
  scope,
  now,
  seats,
  suspended,
  railRow,
  railPosition,
}: {
  seat: SellerSeat;
  enquiryId: string;
  tab: LeadTab;
  scope: LeadScope;
  now: Date;
  seats: Awaited<ReturnType<typeof assignableSeats>>;
  suspended: boolean;
  railRow: LeadRailRow | null;
  /** -1 when the lead was reached by a link rather than from this page. */
  railPosition: number;
}) {
  const [lead, recipient, draft] = await Promise.all([
    getLeadDetail(seat.businessId, enquiryId),
    prisma.enquiryRecipient.findUnique({
      where: { enquiryId_businessId: { enquiryId, businessId: seat.businessId } },
      select: {
        assignedToId: true,
        outcome: true,
        outcomeAt: true,
        outcomeReason: true,
        outcomeBy: { select: { fullName: true } },
        enquiry: { select: { contactReleasedToBusinessId: true, _count: { select: { recipients: true } } } },
      },
    }),
    findDraft(enquiryId, seat.businessId),
  ]);
  if (!lead || !recipient) notFound();

  const observedWin = recipient.enquiry.contactReleasedToBusinessId === seat.businessId;
  const observedLoss = lead.state === "declined";
  const outcome = recipient.outcome ?? (observedWin ? "won" : observedLoss ? "lost" : null);
  const observed = recipient.outcome === null && (observedWin || observedLoss);

  const closed = lead.closesAt.getTime() <= now.getTime();
  /*
     §7: a marked outcome, a suspended listing or a closed enquiry all make the
     composer read-only. The same three conditions the service refuses on, so a
     seller never meets an enabled control that errors on submit — the mismatch
     the shipped thread page had, where a quoted-and-lost seller saw a live
     composer and got "closed" back.
  */
  const readOnly = outcome !== null || suspended || closed;

  return (
    <div className="space-y-[var(--gutter)]">
      {/*
         Which band a seller actually opened, and where it sat. The ordering
         exists to put the overdue work at the top; this is how we find out
         whether anybody works down it. Position is omitted rather than faked
         when the lead was reached by a link.
      */}
      <PageEvent
        name="lead_opened"
        props={{
          band: railRow?.band ?? (lead.firstReplyAt ? "answered" : "waiting"),
          quoted: lead.state === "quoted",
          ...(railPosition >= 0 ? { position: railPosition } : {}),
        }}
      />

      <RequestHeader
        lead={lead}
        seat={seat}
        tab={tab}
        scope={scope}
        now={now}
        seats={seats}
        assignedToId={recipient.assignedToId}
        outcome={outcome}
        observed={observed}
        outcomeAt={recipient.outcomeAt}
        outcomeReason={recipient.outcomeReason}
        outcomeByName={recipient.outcomeBy?.fullName ?? null}
        competing={recipient.enquiry._count.recipients}
      />

      {lead.lines.length === 0 ? (
        /*
           §2: an enquiry with no quantities has nothing to price, and forcing it
           through a line-item composer produces a quote nobody asked for. It
           opens the thread instead.

           No enquiry can reach this state today — `createEnquiry` refuses zero
           lines and has one caller — so the branch is the rule rather than a
           population. It is here because the moment a question-shaped enquiry
           can exist, this is where it must not be priced.
        */
        <Panel title={t("lead.no_lines_title")}>
          <p className="max-w-[var(--measure-prose)] text-body-sm text-muted">
            {t("lead.no_lines_body")}
          </p>
        </Panel>
      ) : readOnly ? (
        <SentQuotes lead={lead} now={now} readOnlyReason={outcome !== null ? "outcome" : closed ? "closed" : "suspended"} />
      ) : (
        <Panel
          title={t("lead.compose_title")}
          description={t("lead.compose_description")}
          eyebrow={
            lead.quotes.length > 0
              ? t("lead.revision_title", { revision: (lead.quotes[0]?.revision ?? 0) + 1 })
              : t("lead.type.rfq")
          }
        >
          <Composer
            enquiryId={lead.enquiryId}
            lines={toDrafts(lead, draft)}
            initialNote={draft?.note ?? lead.quotes[0]?.note ?? ""}
            initialValidityDays={draft?.validityDays ?? lead.quotes[0]?.validityDays ?? 14}
            restored={draft !== null}
            {...(draft ? { restoredAt: draft.updatedAt.getTime() } : {})}
          />
        </Panel>
      )}

      {lead.quotes.length > 0 && !readOnly ? <SentQuotes lead={lead} now={now} /> : null}
    </div>
  );
}

function RequestHeader({
  lead,
  seat,
  tab,
  scope,
  now,
  seats,
  assignedToId,
  outcome,
  observed,
  outcomeAt,
  outcomeReason,
  outcomeByName,
  competing,
}: {
  lead: LeadDetail;
  seat: SellerSeat;
  tab: LeadTab;
  scope: LeadScope;
  now: Date;
  seats: Awaited<ReturnType<typeof assignableSeats>>;
  assignedToId: string | null;
  outcome: "won" | "lost" | null;
  observed: boolean;
  outcomeAt: Date | null;
  outcomeReason: string | null;
  outcomeByName: string | null;
  competing: number;
}) {
  const canAssign = can(seat.actor, "routing.manage");
  const canMark =
    can(seat.actor, "enquiry.respond") && (canAssign || assignedToId === seat.actor.id);

  const facts: { key: string; label: string; value: string }[] = [
    { key: "deliver", label: t("lead.deliver_to"), value: lead.deliverToArea ?? t("table.not_provided") },
    {
      key: "needed",
      label: t("lead.needed_by"),
      value: lead.neededBy ? formatDate(lead.neededBy) : t("table.not_provided"),
    },
    {
      key: "terms",
      label: t("lead.terms_wanted"),
      value: lead.termsWanted
        ? t(`terms.${lead.termsWanted}` as "terms.net_30")
        : t("table.not_provided"),
    },
    {
      key: "closes",
      label: t("lead.closes_label"),
      value:
        lead.closesAt.getTime() <= now.getTime()
          ? t("leads.closed")
          : isWithinRelativeWindow(lead.closesAt, { now })
            ? t("leads.closes_in", { duration: formatCountdown(lead.closesAt, { now }) })
            : formatDate(lead.closesAt),
    },
  ];

  return (
    <Card padded>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-h3 text-ink">{lead.requirement.split(/[.?!]\s/)[0] ?? lead.ref}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted">
            {/*
              A first name until acceptance. The board renders the buyer's
              company and full name on an unaccepted RFQ; rule 1 is that one
              enquiry must not become five cold calls, and the query layer never
              selects the columns that would let it.
            */}
            <span className="text-ink">
              {lead.buyer.released && lead.buyer.companyName
                ? lead.buyer.companyName
                : lead.buyer.firstName}
            </span>
            <span className="font-mono text-eyebrow uppercase">{lead.ref}</span>
            {competing > 1 ? (
              <span>
                {t("leads.competing", {
                  count: competing - 1,
                  formatted: formatCount(competing - 1),
                })}
              </span>
            ) : null}
          </p>
        </div>

        <LeadActions
          enquiryId={lead.enquiryId}
          threadHref={`/dashboard/leads/${lead.enquiryId}/thread`}
          seats={[
            { value: "", label: t("lead.assign_nobody") },
            ...seats.map((s) => ({
              value: s.id,
              label: s.isSelf
                ? t("lead.assign_self", { name: s.name || t("lead.assign_unnamed") })
                : s.name || t("lead.assign_unnamed"),
            })),
          ]}
          assignedToId={assignedToId}
          outcome={outcome}
          canAssign={canAssign}
          canMark={canMark}
          labels={{
            assign: t("lead.assign"),
            assignLabel: t("lead.assign_label"),
            messageBuyer: t("lead.message_buyer"),
            markWon: t("lead.mark_won"),
            markLost: t("lead.mark_lost"),
            reopen: t("lead.reopen"),
            lostTitle: t("lead.mark_lost"),
            lostReasonLabel: t("lead.lost_reason_label"),
            lostReasonPlaceholder: t("lead.lost_reason_placeholder"),
            lostReasonOptional: t("lead.lost_reason_optional"),
            lostConfirm: t("lead.lost_confirm"),
            cancel: t("lead.cancel"),
            closeLabel: t("lead.close"),
            noValueNote: t("lead.outcome_no_value"),
          }}
        />
      </div>

      {outcome ? (
        <p className="mt-3">
          <StatusBadge tone={outcome === "won" ? "ok" : "neutral"} size="sm" shape="chip">
            {observed
              ? outcome === "won"
                ? t("lead.outcome.observed_won")
                : t("lead.outcome.observed_lost")
              : outcome === "won"
                ? t("lead.outcome.won")
                : t("lead.outcome.lost")}
          </StatusBadge>
          {!observed && outcomeAt ? (
            <span className="ml-2 text-caption text-muted">
              {t("lead.outcome_marked_by", {
                name: outcomeByName ?? t("lead.assign_unnamed"),
                when: formatRelative(outcomeAt, { now }),
              })}
            </span>
          ) : null}
          {outcomeReason ? (
            <span className="mt-1 block text-caption text-muted">{outcomeReason}</span>
          ) : null}
        </p>
      ) : null}

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {facts.map((fact) => (
          <div key={fact.key}>
            <dt className="font-mono text-eyebrow uppercase text-muted">{fact.label}</dt>
            <dd className="mt-0.5 text-body-sm text-ink">{fact.value}</dd>
          </div>
        ))}
      </dl>

      {/*
        The buyer's text as submitted. §4: do not paraphrase or summarise —
        sellers price off details a summary loses ("UL/FM listed", "two drops").
      */}
      <blockquote className="mt-4 rounded-ctl border-l-2 border-line-strong bg-paper-sunk px-3 py-2.5">
        <p className="max-w-[var(--measure-prose)] whitespace-pre-wrap text-body-sm text-prose">
          {lead.requirement}
        </p>
      </blockquote>

      <ContactBlock lead={lead} />

      <p className="mt-2 flex flex-wrap items-center gap-2 text-caption text-muted">
        <span>{t("lead.buyer_words_note")}</span>
        <Link
          href={railHref({ tab, scope })}
          className="rounded-tag text-moss underline-offset-4 hover:underline focus-visible:shadow-focus focus-visible:outline-none lg:hidden"
        >
          {t("leads.title")}
        </Link>
      </p>
    </Card>
  );
}

/**
 * Rule 1, stated to the seller rather than merely enforced behind them.
 *
 * A seller who does not know why there is no phone number assumes the product is
 * broken. A seller who knows the number arrives on acceptance has a reason to
 * quote well. It moved here with the composer, from the thread page, because it
 * is a fact about the buyer and this is where the buyer is described.
 */
function ContactBlock({ lead }: { lead: LeadDetail }) {
  if (!lead.buyer.released) {
    return (
      <p className="mt-3 max-w-[var(--measure-prose)] text-caption text-muted">
        <span className="text-ink">{t("contact.withheld_title")}</span>{" "}
        {t("contact.withheld_body", { name: lead.buyer.firstName })}
      </p>
    );
  }

  return (
    <div className="mt-3 rounded-ctl border border-ok-line bg-ok-surface px-3 py-2.5">
      <p className="text-body-sm text-ok-ink">{t("contact.released_title")}</p>
      {/*
         The acceptance date, not the enquiry's.

         This line read `formatDate(lead.createdAt)` for the whole of handoff 2 —
         "{name} accepted your quote on {when}" over the day the buyer first
         wrote in, which on a three-week enquiry is a fortnight out. The buyer's
         own side had it right all along, from `acceptedAt ?? contactReleasedAt`.

         Where neither is set the sentence drops its date rather than reaching
         for today's. A wrong date on a record is worse than no date.
      */}
      <p className="mt-1 text-caption text-ok-ink">
        {lead.acceptedAt
          ? t("contact.released_body", {
              name: lead.buyer.firstName,
              when: formatDate(lead.acceptedAt),
            })
          : t("contact.released_undated", { name: lead.buyer.firstName })}
      </p>
      <dl className="mt-2 space-y-0.5 text-body-sm">
        {lead.buyer.companyName ? <dd className="text-ink">{lead.buyer.companyName}</dd> : null}
        {lead.buyer.phone ? <dd className="font-mono text-ink">{lead.buyer.phone}</dd> : null}
        {lead.buyer.email ? <dd className="text-ink">{lead.buyer.email}</dd> : null}
      </dl>
    </div>
  );
}

function SentQuotes({
  lead,
  now,
  readOnlyReason,
}: {
  lead: LeadDetail;
  now: Date;
  readOnlyReason?: "outcome" | "closed" | "suspended";
}) {
  return (
    <Panel
      title={t("lead.previous_quotes")}
      {...(readOnlyReason
        ? {
            description:
              readOnlyReason === "outcome"
                ? t("lead.readonly_outcome")
                : readOnlyReason === "closed"
                  ? t("lead.readonly_closed")
                  : t("lead.readonly_suspended"),
          }
        : {})}
    >
      {lead.quotes.length === 0 ? (
        <p className="text-body-sm text-muted">{t("leads.no_quote_yet")}</p>
      ) : (
        <ul className="space-y-2">
          {lead.quotes.map((quote) => (
            <li key={quote.id} className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-mono text-body-sm text-ink">{quote.ref}</span>
              <span className="text-caption text-muted">
                {quote.sentAt
                  ? t("lead.quote_sent_at", { when: formatRelative(quote.sentAt, { now }) })
                  : ""}
              </span>
              <span className="font-mono tabular-nums text-body-sm text-ink">
                {formatAED(quote.totalAed)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * The composer's opening state.
 *
 * Three sources, in order: the autosaved draft, then the last quote sent, then
 * nothing. A draft is matched by `enquiryLineId` rather than by description —
 * ENQ-8841 carries two lines reading "Resilient seated gate valve, flanged",
 * separated only by size, and matching on words put the DN150 price on the
 * DN100 row.
 */
function toDrafts(
  lead: LeadDetail,
  draft: Awaited<ReturnType<typeof findDraft>>,
): QuoteLineDraft[] {
  const last = lead.quotes[0];

  return lead.lines.map((line) => {
    const saved = draft?.lines.find((l) => l.enquiryLineId === line.id);
    const previous =
      saved ??
      last?.lines.find((l) => l.enquiryLineId === line.id) ??
      last?.lines.find((l) => l.description === line.description);

    return {
      key: line.id,
      description: line.description,
      qty: line.qty,
      unit: line.unit,
      size: line.size,
      targetUnitPriceAed: line.targetUnitPriceAed,
      suggested: line.match.best ? candidateOf(line.match.best) : null,
      alternatives: line.match.alternatives.map(candidateOf),
      ...(previous
        ? {
            initialUnitPrice: String(previous.unitPrice),
            initialLeadTimeDays: previous.leadTimeDays,
            initialProductId: previous.productId,
          }
        : {}),
    };
  });
}

function candidateOf(match: LeadDetail["lines"][number]["match"]["alternatives"][number]) {
  return {
    productId: match.product.id,
    name: match.product.name,
    sku: match.product.sku,
    availabilityLabel: t(
      AVAILABILITY_LABEL[match.product.availability as keyof typeof AVAILABILITY_LABEL] ??
        "availability.in_stock",
    ),
    stockLabel:
      match.product.stockQty !== null
        ? t("product.in_stock_qty", { qty: formatCount(match.product.stockQty) })
        : null,
    leadTimeDays: match.product.leadTimeDays,
    reasons: match.reasons as MatchReason[],
  };
}
