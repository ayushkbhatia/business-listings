import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClassName } from "@/components/primitives";
import { Alert, StatusBadge, type StatusTone } from "@/components/display";
import { Card, Panel } from "@/components/structure";
import { prisma } from "@/lib/db/client";
import { billingSummary, type BillingSummary } from "@/lib/billing/summary";
import { FILS_PER_AED } from "@/lib/billing/proration";
import { ISSUER } from "@/lib/billing/invoice";
import { formatAED, formatCount, formatDate, formatTRN } from "@/lib/format";
import { mayChangePlan, mayManageBilling } from "@/lib/auth/guards";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../_shell";
import { CancelCard } from "./CancelCard";
import { ResumeButton } from "./ResumeButton";

/**
 * Board 3m — the subscription, what it costs, and what VAT is in the number.
 *
 * ## Money is stated one way
 *
 * Prices ex-VAT, VAT always its own line, every total labelled `incl. VAT`, and
 * nothing rounded. The pair's second correction was a `THIS PERIOD` panel
 * reading `AED 1,784` over two lines summing to 1,699 — a seller could not
 * reproduce the number they owed, because the 84.95 of VAT had been folded in
 * and then rounded away. `formatAED(…, { style: "exact" })` is what keeps the
 * fils; `display` rounds and must not be used on this screen.
 *
 * ## Every figure is a query
 *
 * `billingSummary` is the single read. Nothing here computes a total: invoice
 * rows render `storedTotals`, which is the one reader, so criterion 1 — one
 * invoice, one total, everywhere it appears — holds because there is one place
 * that could be wrong rather than four that happen to agree.
 */
export const metadata = { title: t("billing.page_title") };
export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, StatusTone> = {
  paid: "ok",
  issued: "info",
  overdue: "bad",
  draft: "neutral",
  void: "neutral",
};

/** `1,783.95` with the currency and the fils. Criterion 3. */
function aed(fils: number): string {
  return formatAED(fils / FILS_PER_AED, { style: "exact" });
}

export default async function BillingPage() {
  const seat = await requireSellerSeat();

  /*
     Owner and finance, and nobody else.

     `billingSummary` asserts the same capability and would throw, but a throw is
     a 500 and this is a nav row a manager can see. `notFound` is the honest
     answer: for them, this screen does not exist. Q6 — billing is the one board
     in the lane that is not owner-and-admin, because it exposes the company card.
  */
  if (!mayManageBilling(seat.actor)) notFound();

  const [summary, badges, business] = await Promise.all([
    billingSummary(seat.actor, seat.businessId),
    getNavBadges(seat.businessId),
    prisma.business.findUniqueOrThrow({
      where: { id: seat.businessId },
      select: { trn: true },
    }),
  ]);

  const mayChange = mayChangePlan(seat.actor);
  const isFree = summary.plan.monthlyPriceAed === 0 || !summary.term;

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/billing"
      eyebrow={t("billing.eyebrow")}
      title={t("billing.page_title")}
      meta={
        <span className="text-caption text-muted">
          {/*
             In full, never masked. Criterion 14, and the pair's ninth
             correction: `3m` masked the TRN while the invoice printed it whole.
             A TRN is a legal requirement on a tax invoice, not a secret.
          */}
          {business.trn
            ? t("billing.trn_on_invoices", { trn: formatTRN(business.trn) })
            : t("billing.trn_missing")}
        </span>
      }
    >
      <div className="flex flex-col gap-[var(--gutter)]">
        {summary.failedPayment && <FailedPaymentBanner summary={summary} />}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_21.5rem]">
          <div className="flex min-w-0 flex-col gap-4">
            <PlanCard summary={summary} mayChange={mayChange} isFree={isFree} />
            <InvoicesPanel summary={summary} />
          </div>

          <div className="flex flex-col gap-3.5">
            {summary.period && <PeriodPanel summary={summary} />}
            {!isFree && <PaymentMethodPanel summary={summary} />}
            {!isFree && mayChange && (
              <CancelCard
                keeps={formatCount(summary.freeKeepsProducts)}
                used={formatCount(summary.usage.products)}
                enquiries={formatCount(summary.freeEnquiriesPerMonth ?? 0)}
                withinFreeCap={summary.freeKeepsProducts >= summary.usage.products}
                endsAt={summary.endsAt ? formatDate(summary.endsAt) : null}
                resume={<ResumeButton label={t("billing.cancelling.resume", { plan: summary.plan.name })} />}
              />
            )}
          </div>
        </div>
      </div>
    </SellerPage>
  );
}

/**
 * The state neither board had.
 *
 * Criterion 12 is a promise about what does *not* happen — no downgrade and no
 * listing change during the grace period — so the banner has to be able to say
 * when the grace ends. `dropsOn` comes from the same `SCHEDULE` the job runs on
 * rather than from a sentence written beside it. A seller whose card expired has
 * not decided to leave.
 */
function FailedPaymentBanner({ summary }: { summary: BillingSummary }) {
  const failed = summary.failedPayment;
  if (!failed) return null;

  return (
    <Alert
      tone="bad"
      title={t("billing.failed.title", {
        amount: aed(failed.amountFils),
        when: formatDate(failed.failedOn),
      })}
      action={
        <Link href="/dashboard/billing#payment-method" className={buttonClassName({ variant: "primary", size: "sm" })}>
          {t("billing.failed.update")}
        </Link>
      }
    >
      <p>{failed.reason ? t("billing.failed.reason", { reason: failed.reason }) : t("billing.failed.no_reason")}</p>
      {failed.retryAt && (
        <p className="mt-1">{t("billing.failed.retry", { when: formatDate(failed.retryAt) })}</p>
      )}
      {/*
         Always, not only on a retry step. Criterion 12 promises the plan does
         not downgrade and the listing does not change during the grace period,
         and a promise the seller cannot see the end of is not one they can act
         on. `dropsOn` comes from the same `SCHEDULE` the job runs on.
      */}
      <p className="mt-1">{t("billing.failed.grace", { deadline: formatDate(failed.dropsOn) })}</p>
    </Alert>
  );
}

/** The plan, its price, and the four meters. */
function PlanCard({
  summary,
  mayChange,
  isFree,
}: {
  summary: BillingSummary;
  mayChange: boolean;
  isFree: boolean;
}) {
  const { plan, annual, term } = summary;

  return (
    <Card surface="card" padded>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-eyebrow uppercase tracking-[0.12em] text-moss">
              {plan.name}
            </span>
            {summary.endsAt ? (
              <StatusBadge tone="warn">{t("billing.status.ending_badge")}</StatusBadge>
            ) : (
              <StatusBadge tone="ok">{t("billing.status.active")}</StatusBadge>
            )}
          </div>

          <p className="mt-2.5 text-h1 font-medium tracking-[-0.02em] text-ink">
            {/*
               Ex-VAT, and it says so. Rule 1 of the convention: a plan price is
               quoted ex-VAT and every *total* carries `incl. VAT`, so the two
               can never be read for each other.
            */}
            {term === "annual" && annual
              ? t("billing.plan_price_annual", { price: formatAED(annual.priceAed) })
              : t("billing.plan_price", { price: formatAED(plan.monthlyPriceAed) })}
          </p>

          <p className="mt-1.5 text-caption text-muted">
            {summary.renewsAt === null
              ? t("billing.free_forever")
              : summary.endsAt
                ? t("billing.ending", { when: formatDate(summary.endsAt) })
                : annual && term === "monthly"
                  ? t("billing.annual_offer", {
                      when: formatDate(summary.renewsAt),
                      price: formatAED(annual.priceAed),
                      saving: formatAED(annual.savingAed),
                    })
                  : t("billing.renews_on", { when: formatDate(summary.renewsAt) })}
          </p>
        </div>

        {mayChange && (
          <div className="flex shrink-0 flex-wrap gap-2">
            {/*
               Absent on an annual plan — there is nothing to switch to — and
               absent while a change is already scheduled, because 11f reached
               again before the date offers to withdraw rather than to schedule
               a second one. Q8.
            */}
            {annual && term === "monthly" && !summary.pendingChange && (
              <Link
                href="/dashboard/billing/change?term=annual"
                className={buttonClassName({ variant: "secondary", size: "sm" })}
              >
                {t("billing.switch_annual")}
              </Link>
            )}
            <Link
              href="/dashboard/billing/change"
              className={buttonClassName({ variant: "secondary", size: "sm" })}
            >
              {summary.pendingChange ? t("billing.scheduled.review") : t("billing.change")}
            </Link>
          </div>
        )}
      </div>

      {summary.pendingChange && (
        <p className="mt-4 rounded-ctl border border-warn-line bg-warn-surface px-3.5 py-2.5 text-caption text-warn-ink">
          {t("billing.scheduled.downgrade", {
            plan: summary.pendingChange.toPlan.name,
            when: formatDate(summary.pendingChange.effectiveAt),
          })}
        </p>
      )}

      {!isFree && <UsageGrid summary={summary} />}
    </Card>
  );
}

/**
 * Four meters, read from the plan-limit config.
 *
 * No number here is written down. `allowances` comes from `capFor`, which reads
 * the `Plan` row through the seller's own entitlement snapshot — so a
 * grandfathered account shows the caps it was sold rather than today's.
 */
function UsageGrid({ summary }: { summary: BillingSummary }) {
  const rows = [
    { key: "products", label: t("billing.usage.products"), used: summary.usage.products, cap: summary.allowances.products.cap },
    { key: "branches", label: t("billing.usage.branches"), used: summary.usage.locations, cap: summary.allowances.locations.cap },
    { key: "seats", label: t("billing.usage.seats"), used: summary.usage.seats, cap: summary.allowances.seats.cap },
    { key: "storage", label: t("billing.usage.storage"), used: summary.usage.storageMb, cap: summary.allowances.storage.cap, storage: true },
  ];

  return (
    <dl className="mt-5 grid grid-cols-2 gap-3.5 border-t border-line-soft pt-4 md:grid-cols-4">
      {rows.map((row) => (
        <div key={row.key}>
          <dt className="text-caption text-muted">{row.label}</dt>
          <dd className="mt-1 text-body font-medium text-ink">
            {row.storage ? storageLabel(row.used) : formatCount(row.used)}{" "}
            <span className="text-caption font-normal text-muted">
              {row.cap === null
                ? t("billing.usage.unlimited")
                : t("billing.usage.of", {
                    cap: row.storage ? storageLabel(row.cap) : formatCount(row.cap),
                  })}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Megabytes in, `2.1 GB` or `640 MB` out. Same rendering board 11f's row uses. */
function storageLabel(mb: number): string {
  if (mb < 1024) return t("change.storage_mb", { value: formatCount(mb) });
  return t("change.storage_gb", { value: (mb / 1024).toFixed(1).replace(/\.0$/, "") });
}

/**
 * What falls due at the end of this period, and what VAT is in it.
 *
 * Every line ex-VAT, VAT on its own row, the total labelled. A placement carries
 * its own dates rather than the subscription's — Q7 settles that it is a
 * separately-termed booking, and `3m` billing it inside the 14 Aug – 13 Sep cycle
 * while `11f` ran it to 30 Sep is the conflict that answer resolves.
 */
function PeriodPanel({ summary }: { summary: BillingSummary }) {
  const period = summary.period;
  if (!period) return null;

  return (
    <Panel eyebrow={t("billing.period.eyebrow")} padded>
      <dl className="flex flex-col gap-2.5">
        {period.lines.map((line) => (
          <div key={line.key} className="flex items-baseline justify-between gap-3 text-caption">
            <dt className="min-w-0 text-body-ink">
              {line.key === "subscription"
                ? t("billing.period.subscription", { plan: line.label })
                : t("billing.period.placement", { what: line.label })}
              {line.to && line.key !== "subscription" && (
                <span className="mt-0.5 block text-caption text-muted">
                  {t("billing.period.placement_dates", {
                    from: formatDate(line.from ?? period.dueAt),
                    to: formatDate(line.to),
                  })}
                </span>
              )}
            </dt>
            <dd className="shrink-0 tabular-nums text-ink">{aed(line.fils)}</dd>
          </div>
        ))}

        <div className="my-0.5 h-px bg-line" />

        <div className="flex items-baseline justify-between gap-3 text-caption">
          <dt className="text-body-ink">{t("billing.period.subtotal")}</dt>
          <dd className="tabular-nums text-ink">{aed(period.subtotalFils)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 text-caption">
          <dt className="text-body-ink">
            {t("billing.period.vat", { rate: `${(period.vatRate * 100).toFixed(0)}%` })}
          </dt>
          <dd className="tabular-nums text-ink">{aed(period.vatFils)}</dd>
        </div>

        <div className="my-0.5 h-px bg-line" />

        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-caption font-medium text-ink">
            {t("billing.period.due", { when: formatDate(period.dueAt) })}{" "}
            <span className="font-normal text-muted">{t("billing.period.incl_vat")}</span>
          </dt>
          <dd className="text-h2 font-medium tracking-[-0.02em] tabular-nums text-ink">
            {aed(period.totalFils)}
          </dd>
        </div>
      </dl>

      {/* The thing sellers assume a directory does, said before they ask. */}
      <p className="mt-3 text-caption text-muted">{t("billing.period.no_commission")}</p>
    </Panel>
  );
}

/** Brand, last four and expiry. Criterion 13 — nothing else is stored. */
function PaymentMethodPanel({ summary }: { summary: BillingSummary }) {
  return (
    <Panel eyebrow={t("billing.method.eyebrow")} padded>
      <div id="payment-method" className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="h-[26px] w-[38px] shrink-0 rounded-tag border border-line bg-fill"
        />
        {summary.card ? (
          <div className="min-w-0">
            <p className="font-mono text-caption text-ink">
              {t("billing.method.card", { last4: summary.card.last4 })}
            </p>
            <p className="mt-0.5 text-caption text-muted">
              {t("billing.method.detail", {
                brand: summary.card.brand,
                expiry: summary.card.expiry,
              })}
            </p>
          </div>
        ) : (
          <p className="text-caption text-muted">{t("billing.method.none")}</p>
        )}
      </div>

      {/*
         No card capture here. Criterion 13 — card details never reach our
         servers — so this is a hand-off to the PSP's own form, which does not
         exist yet. Saying so beats a button that opens nothing.
      */}
      <p className="mt-3.5 border-t border-line-soft pt-3 text-caption text-muted">
        {summary.providerIsLive ? t("billing.method.direct") : t("billing.not_live")}
      </p>
    </Panel>
  );
}

/**
 * The invoice history. A real table, because it is one.
 *
 * Rows render `storedTotals` and never recompute — criterion 2. A row whose
 * figures were derived rather than stored says so on the row: an invoice issued
 * before the totals column existed is honestly a derived number, and the whole
 * point of criterion 2 is that a reader can tell the difference.
 */
function InvoicesPanel({ summary }: { summary: BillingSummary }) {
  if (summary.invoices.length === 0) {
    return (
      <Panel title={t("billing.invoices")} padded>
        <p className="text-caption text-muted">
          {summary.period
            ? t("billing.invoices.none_yet", { when: formatDate(summary.period.dueAt) })
            : t("billing.no_invoices")}
        </p>
      </Panel>
    );
  }

  /*
     No `Download all as ZIP`, and that is deliberate.

     The board draws it, and what it bundles is the invoice PDFs — which board
     `11g` owns and which are not exported. Shipping the control now means
     shipping a link to a 404: it was one, and clicking it is how that was found
     rather than reading the diff. A dead action on a billing screen is worse
     than an absent one, and it comes back with the document it downloads.
  */
  return (
    <Panel title={t("billing.invoices")}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-caption">
          <caption className="sr-only">{t("billing.invoice_caption")}</caption>
          <thead>
            <tr className="border-b border-line bg-paper-sunk">
              <th scope="col" className="px-4 py-2.5 text-left font-mono text-eyebrow uppercase tracking-[0.09em] text-muted">
                {t("billing.invoices.col.invoice")}
              </th>
              <th scope="col" className="px-3 py-2.5 text-left font-mono text-eyebrow uppercase tracking-[0.09em] text-muted">
                {t("billing.col.issued")}
              </th>
              <th scope="col" className="px-3 py-2.5 text-left font-mono text-eyebrow uppercase tracking-[0.09em] text-muted">
                {t("billing.invoices.col.description")}
              </th>
              <th scope="col" className="px-3 py-2.5 text-right font-mono text-eyebrow uppercase tracking-[0.09em] text-muted">
                {t("billing.col.amount")}
              </th>
              <th scope="col" className="px-4 py-2.5 text-left font-mono text-eyebrow uppercase tracking-[0.09em] text-muted">
                {t("billing.col.status")}
              </th>
            </tr>
          </thead>
          <tbody>
            {summary.invoices.map((invoice) => (
              <tr key={invoice.id} className="border-b border-line-soft last:border-0">
                <th scope="row" className="px-4 py-2.5 text-left font-mono text-caption font-normal text-ink">
                  {/*
                     `11g` owns the document. Until it lands the reference is a
                     reference and not a link — a link to a 404 is worse than a
                     figure that does not move.
                  */}
                  {invoice.ref}
                </th>
                <td className="px-3 py-2.5 text-body-ink">
                  {invoice.issuedAt ? formatDate(invoice.issuedAt) : "—"}
                </td>
                <td className="px-3 py-2.5 text-body-ink">
                  {invoice.isCreditNote && invoice.correctsRef
                    ? t("billing.invoices.credit_note", { ref: invoice.correctsRef })
                    : invoice.description}
                </td>
                <td className="px-3 py-2.5 text-right font-medium tabular-nums text-ink">
                  {aed(invoice.totalFils)}
                </td>
                <td className="px-4 py-2.5">
                  <StatusBadge tone={STATUS_TONE[invoice.status] ?? "neutral"} shape="chip">
                    {t(`billing.status.${invoice.status}` as "billing.status.paid")}
                  </StatusBadge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="border-t border-line-soft px-4 py-2.5 text-caption text-muted">
        {t("billing.our_trn", { trn: ISSUER.trn })}
      </p>
    </Panel>
  );
}
