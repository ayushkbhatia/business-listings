import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/structure";
import { StatusBadge } from "@/components/display";
import { prisma } from "@/lib/db/client";
import { mayChangePlan } from "@/lib/auth/guards";
import { billingSummary, type BillingSummary } from "@/lib/billing/summary";
import {
  quotePlanChange,
  quoteTermChange,
  type QuoteResult,
  type TermQuoteResult,
} from "@/lib/billing/service";
import { planGrid, shortfallsOf, formatStorage, type GridRow } from "@/lib/billing/plan-grid";
import { lastPaidDay } from "@/lib/billing/cancel-table";
import { monthsFree, offersAnnual, periodPriceAed, type BillingTerm } from "@/lib/billing/period";
import { FILS_PER_AED } from "@/lib/billing/proration";
import type { PlanCaps } from "@/lib/plan/entitlements";
import { formatAED, formatCount, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../../_shell";
import { ChangeRail, type ChangeRailProps, type KeepRow } from "./ChangeRail";

/**
 * Board 11f — what each plan holds, against what this seller has.
 *
 * ## One denominator per row
 *
 * Criterion 4, and the board's first correction. Team seats read `1 of 3` on
 * Free, `2 of 3` on Basic and `3 of 5 used` on Pro — the first two against the
 * seller's three seats, the third against Pro's cap of five. Two denominators in
 * one row, and a reader comparing across is comparing nothing. Every cell here
 * answers *what would this plan keep, out of what you have now*, and the
 * arithmetic lives in `lib/billing/plan-grid.ts` so it is testable without a
 * database.
 *
 * ## No placeholder ships
 *
 * Criterion 5. The board says on its own face that Free and Basic are invented
 * numbers; this renders `Plan` rows. That is the whole reason the plan-limit
 * config was blocking rather than overdue — four board families read the same
 * table and this is the surface that renders all of it.
 *
 * ## A downgrade is scheduled, not applied
 *
 * Criterion 6. Nothing is charged today, the effective date is stated twice, and
 * it is withdrawable until then. An upgrade is the other direction on the same
 * grid and behaves differently: it applies on payment and pro-rates.
 */
export const metadata = { title: t("change.title") };
export const dynamic = "force-dynamic";

const PLAN_SELECT = {
  id: true, name: true, monthlyPriceAed: true, enquiriesPerMonth: true, productLimit: true,
  locationLimit: true, photoLimit: true, categoryLimit: true, storageMb: true, teamSeats: true,
  rankingMultiplier: true, customDomain: true, analytics: true, csvImport: true,
  sponsoredEligible: true, sortOrder: true, annualMonthsCharged: true, withdrawnAt: true,
} as const;

type GridPlan = PlanCaps & { annualMonthsCharged: number | null };

interface SearchParams {
  /** `?plan=basic` — the column the seller is considering. */
  plan?: string;
  /** `?term=annual` — `3m`'s `Switch to annual` opens the toggle already flipped. */
  term?: string;
}

export default async function ChangePlanPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const seat = await requireSellerSeat();
  /*
     Owner only, and this is the fence rather than a hidden button.

     A finance seat reads the invoices and does not decide what the business
     buys — board 7d separates the two rows and Q6 answers owner-only. The
     service asserts the same capability, so a posted form is refused there too;
     this is what stops the screen rendering for somebody who could not use it.
  */
  if (!mayChangePlan(seat.actor)) notFound();

  const params = await searchParams;
  const [summary, badges, planRows] = await Promise.all([
    billingSummary(seat.actor, seat.businessId),
    getNavBadges(seat.businessId),
    prisma.plan.findMany({ orderBy: { sortOrder: "asc" }, select: PLAN_SELECT }),
  ]);

  /*
     Every plan still sold, plus the one the seller is on.

     A withdrawn plan does not appear on `/pricing` and everybody already on it
     keeps it — board 1l criterion 12. Filtering unconditionally would delete the
     column the seller is standing in, so their own is the exception.
  */
  const plans: GridPlan[] = planRows
    .filter((plan) => plan.withdrawnAt === null || plan.id === summary.plan.id)
    .map((plan) => ({
      ...plan,
      monthlyPriceAed: Number(plan.monthlyPriceAed),
      rankingMultiplier: Number(plan.rankingMultiplier),
    }));

  const term: BillingTerm =
    params.term === "annual" || (params.term !== "monthly" && summary.term === "annual")
      ? "annual"
      : "monthly";

  /*
     A cancellation is a pending row in this table and is **not** a pending plan
     change.

     `11h` owns it, the banner on `3m` carries it, and offering `Withdraw` here
     would take back half of it — the row goes, `subscription.endsAt` stays, and
     the period end arrives with nothing scheduled to act on it. So the rail
     states it and sends the seller to the banner, which is where resuming lives.
  */
  const cancelling = summary.pendingChange?.kind === "cancellation";
  const pending = summary.pendingChange?.kind === "plan_change" ? summary.pendingChange : null;
  /*
     A pending change wins over the query string.

     `11f` reached again before the date shows the scheduled change and offers to
     withdraw it, not to schedule a second one — Q8, which the partial unique
     index enforces one layer down.
  */
  const selectedId = cancelling ? null : (pending?.toPlan.id ?? params.plan ?? null);
  const selected =
    plans.find((plan) => plan.id === selectedId && plan.id !== summary.plan.id) ?? null;

  const grid = planGrid(plans, summary.usage);
  const quote = selected ? await quotePlanChange(seat.actor, seat.businessId, selected.id) : null;

  /*
     The toggle on a term the seller is not paying on, with no plan selected.

     `3m`'s `Switch to annual` links here with `?term=annual`, which the spec
     describes as "the same screen with the billing-period toggle already
     flipped". Without this the rail fell through to its idle state and the
     button on `3m` went nowhere.

     Only when nothing else is going on: a pending change holds the rail, and a
     selected plan is the thing the seller came to decide. A plan change never
     moves the term, so the two are never quoted together.
  */
  const termQuote =
    !selected && !pending && !cancelling && summary.term && term !== summary.term
      ? await quoteTermChange(seat.actor, seat.businessId, term)
      : null;

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/billing"
      eyebrow={t("billing.eyebrow")}
      title={t("change.title")}
      breadcrumb={
        <Link
          href="/dashboard/billing"
          className="rounded-tag text-caption font-medium text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("change.back_short")}
        </Link>
      }
      actions={<TermToggle current={term} plans={plans} selectedId={selectedId} />}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20.625rem]">
        <div className="min-w-0">
          <ComparisonGrid
            plans={plans}
            grid={grid}
            term={term}
            currentId={summary.plan.id}
            selectedId={selected?.id ?? null}
            locked={Boolean(pending) || cancelling}
          />
        </div>

        <ChangeRail
          {...(cancelling
            ? {
                state: "idle" as const,
                intro: t("change.cancelling", {
                  when: formatDate(lastPaidDay(summary.endsAt ?? summary.renewsAt ?? new Date())),
                }),
              }
            : railProps(summary, selected, quote, termQuote, grid, term, pending))}
        />
      </div>
    </SellerPage>
  );
}

/**
 * `Monthly` / `Annual · 2 months free`.
 *
 * Links rather than a client control. The toggle re-prices every column and the
 * change summary, all of which is server-rendered, so a round trip is the honest
 * implementation — and it keeps the state in the URL, which is where `3m`'s
 * `Switch to annual` points.
 */
function TermToggle({
  current,
  plans,
  selectedId,
}: {
  current: BillingTerm;
  plans: readonly GridPlan[];
  selectedId: string | null;
}) {
  /*
     One discount figure across the ladder, taken from whichever plan sells a
     year rather than named per column. Naming one plan's saving above all three
     is the drift the pricing page took out of its own copy.
  */
  const annualPlan = plans.find((plan) => offersAnnual(plan));
  if (!annualPlan) return null;

  const item = (term: BillingTerm, label: string) => (
    <Link
      key={term}
      href={`/dashboard/billing/change?term=${term}${selectedId ? `&plan=${selectedId}` : ""}`}
      aria-current={current === term ? "true" : undefined}
      className={[
        "inline-flex h-[26px] items-center rounded-[5px] px-3 text-caption",
        current === term ? "bg-card font-medium text-ink" : "text-body-ink hover:text-ink",
        "focus-visible:shadow-focus focus-visible:outline-none",
      ].join(" ")}
    >
      {label}
    </Link>
  );

  return (
    <div className="flex gap-0.5 rounded-ctl bg-fill p-[3px]">
      {item("monthly", t("change.term.monthly"))}
      {item("annual", t("change.term.annual", { months: formatCount(monthsFree(annualPlan)) }))}
    </div>
  );
}

/**
 * The table. A real one — `<table>`, `<thead>`, `<th scope>`.
 *
 * It scrolls horizontally below 1280 rather than reflowing into stacked cards:
 * the spec is explicit that a price table which stacks stops being a comparison.
 */
function ComparisonGrid({
  plans,
  grid,
  term,
  currentId,
  selectedId,
  locked,
}: {
  plans: readonly GridPlan[];
  grid: readonly GridRow[];
  term: BillingTerm;
  currentId: string;
  selectedId: string | null;
  locked: boolean;
}) {
  return (
    <Card surface="card" padded={false}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[38rem] border-collapse text-left">
          <caption className="sr-only">{t("change.grid_caption")}</caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="w-[11.625rem] border-b border-line px-3.5 py-4 align-top text-caption font-normal text-muted"
              >
                {t("change.col.feature")}
              </th>
              {plans.map((plan) => (
                <th
                  key={plan.id}
                  scope="col"
                  className={[
                    "border-b border-line px-3.5 py-4 align-top",
                    plan.id === selectedId ? "bg-moss-wash" : "",
                  ].join(" ")}
                >
                  <PlanHeader
                    plan={plan}
                    term={term}
                    isCurrent={plan.id === currentId}
                    isSelected={plan.id === selectedId}
                    locked={locked}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row) => (
              <tr key={row.key} className="border-b border-line-soft last:border-0">
                <th scope="row" className="px-3.5 py-3 text-left text-caption font-normal text-muted">
                  {row.header}
                </th>
                {row.cells.map((cell) => (
                  <td
                    key={cell.planId}
                    className={[
                      "px-3.5 py-3 text-caption",
                      cell.planId === selectedId ? "bg-moss-wash" : "",
                    ].join(" ")}
                  >
                    <CellBody state={cell.state} label={cell.label} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/**
 * One cell.
 *
 * A shortfall is the only state that takes emphasis, and it takes warn ink
 * rather than bad: dropping to a plan that holds less is a consequence the
 * seller is choosing, not an error they have made.
 *
 * The tick and the dash are `aria-hidden` with the words beside them, because a
 * screen reader announcing "tick" in a column of nine rows says nothing about
 * which row it is in.
 */
function CellBody({ state, label }: { state: string; label: string }) {
  if (state === "included") {
    return (
      <span className="font-medium text-ok-ink">
        <span aria-hidden="true">✓</span> <span className="sr-only">{label}</span>
      </span>
    );
  }
  if (state === "absent") {
    return (
      <span className="text-muted">
        <span aria-hidden="true">—</span> <span className="sr-only">{label}</span>
      </span>
    );
  }
  if (state === "shortfall") {
    // `100 of 1,204` — the kept figure carries the weight, because it is the
    // number the seller is deciding about.
    const [keeps, ...rest] = label.split(" ");
    return (
      <span className="text-body-ink">
        <span className="font-medium text-warn-ink">{keeps}</span>{" "}
        <span className="text-muted">{rest.join(" ")}</span>
      </span>
    );
  }
  return <span className="text-body-ink">{label}</span>;
}

function PlanHeader({
  plan,
  term,
  isCurrent,
  isSelected,
  locked,
}: {
  plan: GridPlan;
  term: BillingTerm;
  isCurrent: boolean;
  isSelected: boolean;
  locked: boolean;
}) {
  const priceAed =
    plan.monthlyPriceAed === 0
      ? 0
      : term === "annual" && offersAnnual(plan)
        ? periodPriceAed(plan, "annual")
        : plan.monthlyPriceAed;

  return (
    <div className="flex flex-col items-start gap-[7px]">
      <span className="font-mono text-eyebrow uppercase tracking-[0.12em] text-moss">
        {plan.name}
      </span>
      <span className="text-body font-medium tracking-[-0.01em] text-ink">
        {formatAED(priceAed)}
        {/* Ex-VAT, and it says so on every paid column. Rule 1 of the convention. */}
        {priceAed > 0 && (
          <span className="ml-1 text-caption font-normal text-muted">{t("change.price_vat")}</span>
        )}
      </span>

      {isCurrent ? (
        <StatusBadge tone="ok">{t("change.current")}</StatusBadge>
      ) : isSelected ? (
        <StatusBadge tone="ok" shape="chip">
          {t("change.selected")}
        </StatusBadge>
      ) : locked ? (
        /*
           A pending change holds the rail, so this is a label rather than a
           link. Offering a second `Select` would be offering something the
           service refuses — Q8 — and a control that reports a refusal it could
           have predicted is worse than no control.
        */
        <span className="text-caption text-muted">{t("change.select", { plan: plan.name })}</span>
      ) : (
        <Link
          href={`/dashboard/billing/change?plan=${plan.id}&term=${term}`}
          className="inline-flex h-[26px] items-center rounded-ctl border border-line-strong px-2.5 text-caption text-body-ink hover:border-line-mid hover:text-ink focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("change.select", { plan: plan.name })}
        </Link>
      )}
    </div>
  );
}

/**
 * Everything the rail needs, resolved on the server.
 *
 * Every figure is a string by the time it crosses into the client component and
 * every label is a string rather than a function. That boundary is the repo's
 * most repeated defect, and `tests/unit/client-labels` fails the build on it.
 */
function railProps(
  summary: BillingSummary,
  selected: GridPlan | null,
  quote: QuoteResult | null,
  termQuote: TermQuoteResult | null,
  grid: readonly GridRow[],
  term: BillingTerm,
  pending: BillingSummary["pendingChange"],
): ChangeRailProps {
  const aed = (fils: number) => formatAED(fils / FILS_PER_AED, { style: "exact" });

  if (!selected && termQuote?.ok) {
    const { quote: tq } = termQuote;
    return {
      state: "term",
      summaryEyebrow: t("change.summary.eyebrow"),
      fromTo: t("change.summary.from_to", {
        from: t(`change.term_name.${tq.from}` as "change.term_name.monthly"),
        to: t(`change.term_name.${tq.to}` as "change.term_name.monthly"),
      }),
      // A term change **does** move the renewal, which is the opposite of what a
      // plan change promises. Saying so is the whole point of a separate state.
      explanation: t("change.summary.term", { when: formatDate(tq.renewsAt) }),
      lines: [
        {
          key: "charge",
          // The whole new period, not a slice of one.
          label: t(tq.to === "annual" ? "change.summary.line_year" : "change.summary.line_month", {
            plan: tq.planName,
          }),
          amount: aed(tq.proration.chargeLine.fils),
          credit: false,
        },
        ...(tq.proration.creditLine.fils > 0
          ? [
              {
                key: "credit",
                label: t("change.summary.line_credit", {
                  plan: tq.planName,
                  days: formatCount(tq.proration.creditLine.days),
                }),
                amount: `-${aed(tq.proration.creditLine.fils)}`,
                credit: true,
              },
            ]
          : []),
        {
          key: "vat",
          label: t("change.summary.line_vat", {
            rate: `${(tq.proration.vatRate * 100).toFixed(0)}%`,
          }),
          amount: aed(tq.proration.vatFils),
          credit: false,
        },
      ],
      dueTodayLabel: t("change.summary.due_today"),
      dueTodayAmount: aed(tq.proration.dueFils),
      inclVat: t("billing.period.incl_vat"),
      term,
      primaryLabel: t("change.switch_term", {
        term: t(`change.term_name.${term}` as "change.term_name.monthly"),
        amount: aed(tq.proration.dueFils),
      }),
      keepCurrentLabel: t("change.keep_current", { plan: summary.plan.name }),
      providerNote: tq.providerIsLive ? null : t("change.provider_not_live"),
    };
  }

  if (!selected || !quote?.ok) {
    return { state: "idle", intro: t("change.intro") };
  }

  const { quote: q } = quote;
  const shortfalls = shortfallsOf(grid, selected.id, summary.usage);

  const keepRows: KeepRow[] = shortfalls
    .filter((shortfall) => shortfall.choosable)
    .map((shortfall) => ({
      kind: shortfall.key as KeepRow["kind"],
      label: t(
        shortfall.key === "products"
          ? "change.keep.products"
          : shortfall.key === "locations"
            ? "change.keep.locations"
            : "change.keep.seats",
        { keeps: formatCount(shortfall.keeps), used: formatCount(shortfall.used) },
      ),
      href: `/dashboard/billing/change/keep/${shortfall.key}`,
      chosenLabel: chosenLabel(shortfall.key, pending),
      /*
         Only a scheduled change has somewhere to record the choice. Before that
         the row states the shortfall and the link is inert — the alternative is
         a chooser that saves into nothing and reports success.
      */
      ready: Boolean(pending),
    }));

  const storage = shortfalls.find((shortfall) => shortfall.key === "storage") ?? null;
  const paidTo = q.effectiveAt ? lastPaidDay(q.effectiveAt) : null;

  return {
    state: q.direction,
    selectedPlanId: selected.id,
    summaryEyebrow: t("change.summary.eyebrow"),
    fromTo: t("change.summary.from_to", { from: summary.plan.name, to: selected.name }),
    explanation:
      q.direction === "upgrade"
        ? t("change.summary.upgrade", { plan: selected.name })
        : t("change.summary.downgrade", {
            plan: summary.plan.name,
            when: formatDate(paidTo ?? q.nextDueAt),
          }),
    dueTodayLabel: t("change.summary.due_today"),
    dueTodayAmount: aed(q.proration?.dueFils ?? 0),
    fromDateLabel: t("change.summary.from_date", { when: formatDate(q.nextDueAt) }),
    fromDateAmount: aed(q.nextPeriodFils),
    inclVat: t("billing.period.incl_vat"),
    lines:
      q.proration && q.direction === "upgrade"
        ? [
            {
              key: "charge",
              // The day count belongs on the line: a pro-rated charge a seller
              // cannot check is a charge they dispute.
              label: t("change.summary.line_charge", {
                plan: selected.name,
                days: formatCount(q.proration.chargeLine.days),
                total: formatCount(periodDaysOf(q.periodStartedAt, q.proration.renewsAt)),
              }),
              amount: aed(q.proration.chargeLine.fils),
              credit: false,
            },
            ...(q.proration.creditLine.fils > 0
              ? [
                  {
                    key: "credit",
                    label: t("change.summary.line_credit", {
                      plan: summary.plan.name,
                      days: formatCount(q.proration.creditLine.days),
                    }),
                    amount: `-${aed(q.proration.creditLine.fils)}`,
                    credit: true,
                  },
                ]
              : []),
            {
              key: "vat",
              label: t("change.summary.line_vat", {
                rate: `${(q.proration.vatRate * 100).toFixed(0)}%`,
              }),
              amount: aed(q.proration.vatFils),
              credit: false,
            },
          ]
        : [],
    /*
       The toggle is on a term this change will not be charged on.

       A plan change is always quoted on the subscription's own term —
       `quotePlanChange` reads it at lib/billing/service.ts:163 and there is no
       shape for changing both in one transaction. So when the columns are
       comparing annual prices and the seller is paying monthly, the rail says
       which one the button is about and offers the other as its own step, which
       is the `quoteTermChange` branch above with the selection cleared.
    */
    termMismatch:
      summary.term && term !== summary.term
        ? {
            /*
               Keyed by the term rather than interpolated.

               `change.term_name.*` are toggle labels — "Monthly", "Annual" —
               and reading them into a sentence produced "Quoted Monthly,
               because…", which is a capital in the middle of a sentence.
               Design system §08 is sentence case, and there are exactly two
               combinations, so two strings say it properly.
            */
            note: t(
              `change.term_mismatch.${summary.term}` as "change.term_mismatch.monthly",
            ),
            linkLabel: t(
              `change.term_mismatch_link.${term}` as "change.term_mismatch_link.monthly",
            ),
            href: `/dashboard/billing/change?term=${term}`,
          }
        : null,
    keepEyebrow: t("change.keep.eyebrow"),
    keepIntro: keepRows.length > 0 ? t("change.keep.intro", { plan: selected.name }) : null,
    keepRows,
    chooseLabel: t("change.keep.choose"),
    /*
       Storage states what actually happens rather than offering a chooser.

       Q4. A downgrade removes no files: the cap is enforced on upload, so an
       over-quota seller cannot add more until they are back under it — which is
       already how the media library behaves. A `Choose` here would open a screen
       that could not do anything, which is the unenforced limit the spec warns
       about wearing the opposite disguise.
    */
    storageNote: storage
      ? {
          label: t("change.keep.storage", {
            used: formatStorage(storage.used),
            cap: formatStorage(storage.keeps),
            plan: selected.name,
          }),
          note: t("change.keep.storage_note", { cap: formatStorage(storage.keeps) }),
          linkLabel: t("change.keep.storage_link"),
        }
      : null,
    endsEyebrow: t("change.ends.eyebrow", { plan: summary.plan.name }),
    ends: endsWith(summary, selected, q.effectiveAt),
    /*
       A downgrade to Free is a cancellation, and it goes through the flow that
       records one.

       This column was selectable and scheduled a plain plan change: no reason
       asked, `cancelledAt` never set, and so no banner, no confirmation email
       and no churn signal. Two routes to one outcome, one of which quietly
       skipped every promise the other makes. Boards `11h` and `11j` are that
       route, so the button goes there instead — the rail still prices the move
       and states what ends, because that is what the seller came to read.
    */
    ...(selected.monthlyPriceAed === 0 && summary.term
      ? { primaryHref: "/dashboard/billing/cancel" }
      : {}),
    primaryLabel:
      selected.monthlyPriceAed === 0 && summary.term
        ? t("cancel.continue")
        : q.direction === "downgrade"
        ? t("change.schedule", { plan: selected.name })
        : (q.proration?.dueFils ?? 0) > 0
          ? t("change.upgrade_now", {
              amount: aed(q.proration?.dueFils ?? 0),
              plan: selected.name,
            })
          : t("change.upgrade_free", { plan: selected.name }),
    keepCurrentLabel: t("change.keep_current", { plan: summary.plan.name }),
    withdrawLabel: t("change.withdraw"),
    withdrawNote: paidTo ? t("change.withdraw_note", { when: formatDate(paidTo) }) : null,
    // Posted back and re-verified against a fresh quote. A number shown on a
    // button is a promise — criterion 7.
    dueFils: q.proration?.dueFils ?? 0,
    isPending: Boolean(pending),
    providerNote: q.providerIsLive ? null : t("change.provider_not_live"),
  };
}

/** Whole days in the period, for `24 of 31 days`. */
function periodDaysOf(from: Date, to: Date): number {
  return Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000));
}

/** How many the seller has already picked, where they have. */
function chosenLabel(key: string, pending: BillingSummary["pendingChange"]): string {
  const ids =
    key === "products"
      ? pending?.keepProductIds
      : key === "locations"
        ? pending?.keepLocationIds
        : pending?.keepSeatIds;

  /*
     Absent means we choose, and the row says which way.

     The oldest products stay, matching `hideOverPlanCap` and the cancel path.
     Seats are the exception: the oldest colleague is not a defensible thing to
     keep, so nobody is removed and the team screen refuses the next invitation
     instead.
  */
  if (!ids) return key === "seats" ? t("change.keep.auto_seats") : t("change.keep.auto");
  return t("change.keep.chosen", { count: formatCount(ids.length) });
}

/**
 * What ends outright rather than shrinking.
 *
 * Listed apart from the caps because it is not a shortfall the seller can choose
 * their way through. The placement carries its own end date — Q7 — which is why
 * `11f` could say it "runs to 30 Sep" while `3m` billed it inside a cycle ending
 * on the 13th: it is a separately-termed booking, and both dates were right
 * about different things.
 */
function endsWith(
  summary: BillingSummary,
  selected: PlanCaps,
  effectiveAt: Date | null,
): { key: string; text: string }[] {
  const when = effectiveAt ?? summary.renewsAt;
  if (!when) return [];

  const ends: { key: string; text: string }[] = [];

  if (summary.plan.customDomain && !selected.customDomain && summary.domain) {
    ends.push({
      key: "domain",
      text: t("change.ends.domain", { domain: summary.domain, when: formatDate(when) }),
    });
  }

  if (summary.plan.sponsoredEligible && !selected.sponsoredEligible) {
    for (const placement of summary.placements) {
      ends.push({
        key: `placement:${placement.label}`,
        // The booking's own end, not the subscription's.
        text: t("change.ends.placement", {
          what: placement.label,
          when: formatDate(placement.endsOn ?? when),
        }),
      });
    }
  }

  return ends;
}
