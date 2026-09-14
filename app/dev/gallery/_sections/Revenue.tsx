import {
  EmiratesBody,
  ReasonsBody,
  RevenueCards,
  WaterfallBody,
} from "@/app/(admin)/admin/revenue/RevenueBoardView";
import { PlanMixTable } from "@/app/(admin)/admin/revenue/PlanMixTable";
import { presentRevenue } from "@/app/(admin)/admin/revenue/present";
import type { EmirateRow, PeriodFigures, PlanRow, ReasonRow, RevenueBoard } from "@/lib/billing/revenue-board";
import {
  emptyLines,
  endingFils,
  periodFor,
  ratiosOf,
  type LedgerMonth,
  type Lines,
  type ReplyFinding,
} from "@/lib/billing/revenue-period";
import { Section, States } from "../_kit";

/**
 * Board `4g` — the revenue board in the states its spec names: a closed month
 * on the handoff's own figures, a month in progress, a month that shrank with
 * no cancellations in it, and the cold start.
 *
 * Every specimen goes through `presentRevenue`, the function the page uses, so
 * a formula that reads wrong here reads wrong on the console. Rendered as the
 * panel bodies and never as the titled panels: a titled panel is a landmark,
 * and four states of one would be four landmarks with one name.
 */

const NOW = new Date("2026-09-14T08:00:00Z");
const FILS = 100;

function figures(
  key: string,
  month: Omit<LedgerMonth, "lines"> & { lines: Partial<Lines> },
  extra: { placement?: [number, number]; failed?: [number, number] } = {},
): PeriodFigures {
  const lines = { ...emptyLines(), ...month.lines };
  const full: LedgerMonth = { ...month, lines };
  const ending = endingFils(full);
  return {
    period: periodFor(key, NOW),
    month: full,
    endingFils: ending,
    ledgerEndingFils: ending,
    ratios: ratiosOf(full),
    movements: [],
    placement: { fils: (extra.placement?.[0] ?? 0) * FILS, slots: extra.placement?.[1] ?? 0 },
    failedPayments: { accounts: extra.failed?.[0] ?? 0, atRiskFils: (extra.failed?.[1] ?? 0) * FILS },
    stateAtEnd: [],
  };
}

function board(input: {
  current: PeriodFigures;
  previous: PeriodFigures;
  reasons?: ReasonRow[];
  finding?: ReplyFinding;
  emirates?: EmirateRow[];
  plans?: PlanRow[];
  closures?: number;
}): RevenueBoard {
  const reasons = input.reasons ?? [];
  return {
    current: input.current,
    previous: input.previous,
    cancellations: reasons.reduce((sum, row) => sum + row.count, 0),
    reasons,
    replyFinding: input.finding ?? { total: 0, below: 0, atOrAbove: 0, unmeasured: 0 },
    byEmirate: input.emirates ?? [],
    byPlan: input.plans ?? [],
    closures: input.closures ?? 0,
  };
}

const emirates = (rows: [EmirateRow["emirate"], number, number][]): EmirateRow[] =>
  rows.map(([emirate, aed, accounts]) => ({ emirate, mrrFils: aed * FILS, accounts }));

/** The render's August, with the handoff's correction applied. */
const TYPICAL = board({
  current: figures(
    "2026-08",
    {
      startingFils: 354_880 * FILS,
      lines: { new_business: 38_220 * FILS, upgrades: 14_400 * FILS, downgrades: -5_200 * FILS, cancellations: -14_046 * FILS },
      payingAtStart: 2_046,
      payingAtEnd: 2_046,
      cancelledAccounts: 48,
      lapsedAccounts: 0,
    },
    { placement: [188_400, 142], failed: [64, 12_880] },
  ),
  previous: figures(
    "2026-07",
    {
      startingFils: 340_600 * FILS,
      lines: { new_business: 30_100 * FILS, upgrades: 9_900 * FILS, downgrades: -4_000 * FILS, cancellations: -12_120 * FILS },
      payingAtStart: 1_990,
      payingAtEnd: 1_990,
      cancelledAccounts: 44,
      lapsedAccounts: 0,
    },
    { placement: [165_300, 128] },
  ),
  reasons: [
    { reason: "too_expensive", count: 11 },
    { reason: "not_enough_enquiries", count: 19 },
    { reason: "poor_quality_enquiries", count: 9 },
    { reason: "another_platform", count: 6 },
    { reason: "something_else", count: 3 },
  ],
  finding: { total: 19, below: 17, atOrAbove: 2, unmeasured: 0 },
  emirates: emirates([
    ["dubai", 240_718, 1_268],
    ["abu_dhabi", 66_003, 348],
    ["sharjah", 46_591, 245],
    ["ajman", 17_470, 92],
    ["ras_al_khaimah", 9_706, 51],
    ["umm_al_quwain", 3_883, 21],
    ["fujairah", 3_883, 21],
  ]),
  plans: [
    { planId: "basic", planName: "Basic", accounts: 1_582, mrrFils: 219_500 * FILS },
    { planId: "pro", planName: "Pro", accounts: 464, mrrFils: 168_754 * FILS },
  ],
  closures: 6,
});

const PARTIAL = board({
  current: figures(
    "2026-09",
    {
      startingFils: 388_254 * FILS,
      lines: { new_business: 14_210 * FILS, upgrades: 5_394 * FILS, cancellations: -4_188 * FILS },
      payingAtStart: 2_046,
      payingAtEnd: 2_071,
      cancelledAccounts: 12,
      lapsedAccounts: 0,
    },
    { placement: [86_100, 131], failed: [58, 11_320] },
  ),
  previous: TYPICAL.current,
  reasons: [
    { reason: "too_expensive", count: 3 },
    { reason: "not_enough_enquiries", count: 5 },
    { reason: "poor_quality_enquiries", count: 2 },
    { reason: "another_platform", count: 1 },
    { reason: "something_else", count: 1 },
  ],
  finding: { total: 5, below: 3, atOrAbove: 1, unmeasured: 1 },
  emirates: emirates([["dubai", 242_020, 1_281], ["abu_dhabi", 67_880, 355], ["sharjah", 47_904, 250], ["ajman", 17_470, 92], ["ras_al_khaimah", 10_451, 55], ["umm_al_quwain", 4_371, 19], ["fujairah", 3_574, 19]]),
});

const SHRANK = board({
  current: figures(
    "2026-06",
    {
      startingFils: 102_300 * FILS,
      lines: { downgrades: -6_000 * FILS, term_changes: -1_480 * FILS, lapsed: -2_094 * FILS },
      payingAtStart: 318,
      payingAtEnd: 312,
      cancelledAccounts: 0,
      lapsedAccounts: 6,
    },
    { failed: [9, 1_947] },
  ),
  previous: figures("2026-05", {
    startingFils: 99_100 * FILS,
    lines: { new_business: 3_200 * FILS },
    payingAtStart: 309,
    payingAtEnd: 318,
    cancelledAccounts: 0,
    lapsedAccounts: 0,
  }),
  emirates: emirates([["dubai", 60_100, 201], ["abu_dhabi", 20_026, 60], ["sharjah", 12_600, 51], ["ajman", 0, 0], ["ras_al_khaimah", 0, 0], ["umm_al_quwain", 0, 0], ["fujairah", 0, 0]]),
});

const COLD = board({
  current: figures("2026-08", { startingFils: 0, lines: {}, payingAtStart: 0, payingAtEnd: 0, cancelledAccounts: 0, lapsedAccounts: 0 }),
  previous: figures("2026-07", { startingFils: 0, lines: {}, payingAtStart: 0, payingAtEnd: 0, cancelledAccounts: 0, lapsedAccounts: 0 }),
  emirates: emirates([["dubai", 0, 0], ["abu_dhabi", 0, 0], ["sharjah", 0, 0], ["ajman", 0, 0], ["ras_al_khaimah", 0, 0], ["umm_al_quwain", 0, 0], ["fujairah", 0, 0]]),
});

function Specimen({ name, value }: { name: string; value: RevenueBoard }) {
  const view = presentRevenue(value);
  return (
    <div className="flex w-full flex-col gap-4">
      <p className="text-caption text-muted">{view.periodMeta}</p>
      <RevenueCards cards={view.cards} />
      <div className="grid w-full gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="rounded-panel border border-line bg-card p-4">
          <p className="mb-3 text-body-sm font-medium text-ink">{view.waterfall.title}</p>
          <WaterfallBody waterfall={view.waterfall} />
          <p className="mt-3 border-t border-line pt-3 text-body-sm text-body">{view.waterfall.nrr}</p>
        </div>
        <div className="flex flex-col gap-4">
          <div className="rounded-panel border border-line bg-card p-4">
            <p className="mb-3 text-body-sm font-medium text-ink">{view.reasons.title}</p>
            <ReasonsBody reasons={view.reasons} />
          </div>
          <div className="rounded-panel border border-line bg-card p-4">
            <p className="mb-3 text-body-sm font-medium text-ink">{view.emirates.title}</p>
            <EmiratesBody emirates={view.emirates} caption={`${view.emirates.title}, ${name}`} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function RevenueGallery() {
  const typical = presentRevenue(TYPICAL);
  return (
    <Section
      id="revenue"
      title="Subscriptions & revenue"
      note="Board 4g. Every ratio prints its formula; NRR excludes new business; reasons sum to the cancellations line; placement stays out of MRR and ARPA."
    >
      <States label="Closed month · the handoff's figures" stack>
        <Specimen name="closed month" value={TYPICAL} />
      </States>
      <States label="Month in progress" stack>
        <Specimen name="month in progress" value={PARTIAL} />
      </States>
      <States label="Shrank · no cancellations" stack>
        <Specimen name="shrank" value={SHRANK} />
      </States>
      <States label="Cold start" stack>
        <Specimen name="cold start" value={COLD} />
      </States>
      <States label="By plan" stack>
        <PlanMixTable rows={typical.plans.rows} caption="By plan, gallery specimen" />
      </States>
    </Section>
  );
}
