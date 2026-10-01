import { OverviewView } from "@/app/(admin)/admin/_overview/OverviewView";
import { SnapshotLine, StatusChip } from "@/app/(admin)/admin/_overview/HeaderBits";
import { presentOverview } from "@/app/(admin)/admin/_overview/present";
import type { Actor } from "@/lib/auth/roles";
import { mrrComposition } from "@/lib/billing/mrr-composition";
import type { ChartMonth } from "@/lib/console/overview-model";
import { assembleOverview, type OverviewLive, type OverviewSnapshot } from "@/lib/console/overview-view";
import { mayOpen } from "@/lib/console/visibility";
import { Section, States } from "../_kit";

/**
 * Board `4a` — the platform overview in every state its spec names: as drawn,
 * a past month, a system down, the queue empty, nothing needing a human, no
 * supply gap, no search without a good result, a moderator's seat, figures
 * gone stale, and the cold start the directory launches in.
 *
 * Every specimen goes through `assembleOverview` and `presentOverview` — the
 * functions the page uses — on the handoff's own figures, so a state that
 * reads wrong here reads wrong on the console. Drawn without landmarks
 * (`specimen`): ten copies of the screen on one page would be ten regions named
 * *Plan mix*.
 */

const EVERY_ROLE: Actor = { id: "gallery", roles: ["staff_ops_lead", "staff_moderator", "staff_finance"] };
const MODERATOR: Actor = { id: "gallery", roles: ["staff_moderator"] };

const PLANS = [
  { id: "basic", name: "Basic", monthlyPriceAed: 99, annualMonthsCharged: 10 },
  { id: "pro", name: "Pro", monthlyPriceAed: 299, annualMonthsCharged: 10 },
];

function month(key: string, partial = false) {
  const [year, number] = key.split("-").map(Number) as [number, number];
  const next = number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, "0")}`;
  return {
    key,
    from: `${key}-01T00:00:00+04:00`,
    to: partial ? `${key}-12T10:40:00+04:00` : `${next}-01T00:00:00+04:00`,
    monthEnd: `${next}-01T00:00:00+04:00`,
    partial,
    daysElapsed: partial ? 12 : 31,
    daysInMonth: 31,
  };
}

/** Twelve months to August 2026, growing, with churn below the axis and demand beside supply. */
function chart(endKey = "2026-08"): ChartMonth[] {
  const keys = ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];
  const end = keys.indexOf(endKey);
  const take = keys.slice(Math.max(0, end - 11), end + 1);
  return take.map((key, index) => ({
    key,
    from: `${key}-01T00:00:00+04:00`,
    claims: 390 + index * 42,
    upgrades: 60 + index * 26,
    churn: 22 + (index % 4) * 5 + index * 2,
    rfqs: 1_480 + index * 190,
    partial: false,
  }));
}

const BOOK = [
  ...Array.from({ length: 1_284 }, () => ({ planId: "basic", mrrFils: 9_900 })),
  ...Array.from({ length: 762 }, () => ({ planId: "pro", mrrFils: 29_900 })),
];

function snapshot(overrides: Partial<OverviewSnapshot> = {}): OverviewSnapshot {
  return {
    period: month("2026-08"),
    previous: month("2026-07"),
    computedAt: "2026-09-12T06:38:00.000Z",
    publishedInPeriod: 842,
    claimsApproved: 852,
    paid: { atEnd: 2_046, atStart: 1_928 },
    mrr: { endingFils: 35_495_400, startingFils: 32_448_000, composition: mrrComposition(BOOK, PLANS) },
    quoted: {
      current: { fils: 1_840_000_000, quotes: 1_210, proposals: 14 },
      previous: { fils: 1_508_196_721, quotes: 1_002, proposals: 9 },
    },
    chart: chart(),
    rfqWindow: { from: "2026-08-02T00:00:00+04:00", to: "2026-09-01T00:00:00+04:00" },
    sectorRfqs: { hvac: 2_884, health: 412, mep: 3_104, beauty: 88, construction: 1_960, food: 640, auto: 1_204 },
    noGoodResult: {
      rows: [
        { query: "chiller rental dubai", normalised: "chiller rental dubai", searches: 1_284, suppliersToday: 6 },
        { query: "scaffolding hire sharjah", normalised: "scaffolding hire sharjah", searches: 906, suppliersToday: 2 },
        { query: "crane operator supply", normalised: "crane operator supply", searches: 742, suppliersToday: 0 },
      ],
      checked: 20,
    },
    conversion: { cohort: 0, converted: 0, rate: null, claimedFrom: null, claimedTo: null },
    ...overrides,
  };
}

function live(overrides: Partial<OverviewLive> = {}): OverviewLive {
  return {
    now: "2026-09-12T06:40:00.000Z",
    listingsLive: 41_204,
    claimed: 11_388,
    claimedLive: 11_388,
    planMix: [
      { planId: "basic", planName: "Basic", listPriceFils: 9_900, accounts: 1_284 },
      { planId: "pro", planName: "Pro", listPriceFils: 29_900, accounts: 762 },
    ],
    sectors: [
      { id: "hvac", name: "HVAC & refrigeration", listings: 1_196, claimed: 490 },
      { id: "health", name: "Healthcare clinics & labs", listings: 1_455, claimed: 902 },
      { id: "mep", name: "Industrial & MEP supplies", listings: 1_842, claimed: 1_068 },
      { id: "beauty", name: "Beauty, salons & spas", listings: 2_918, claimed: 2_072 },
      { id: "construction", name: "Construction & building materials", listings: 5_108, claimed: 1_840 },
      { id: "food", name: "Food, catering & F&B supply", listings: 3_890, claimed: 1_210 },
      { id: "auto", name: "Auto parts & garages", listings: 3_412, claimed: 1_806 },
    ],
    queue: { open: 318, overSla: 41, conflicts: 6, lastDecidedAt: "2026-09-12T06:31:00.000Z" },
    reports: {
      open: 46,
      overSla: 3,
      types: [
        { type: "off_platform_payment", count: 2 },
        { type: "review_dispute", count: 23 },
        { type: "wrong_details", count: 12 },
        { type: "closed", count: 9 },
      ],
    },
    status: { state: "normal" },
    otherQueues: [
      { key: "import_runs", count: 2 },
      { key: "records_to_categorise", count: 186 },
      { key: "products_without_specs", count: 1_412 },
      { key: "open_calls", count: 41 },
      { key: "past_due", count: 19 },
      { key: "invoices_outstanding", count: 27, amountFils: 1_104_565 },
      { key: "licences_expiring", count: 64 },
    ],
    warnings: [],
    opens: [
      { figure: "queue_over_sla", count: 41 },
      { figure: "conflicts", count: 17 },
      { figure: "recruit", count: 9 },
    ],
    ...overrides,
  };
}

function Specimen({
  label,
  snap = snapshot(),
  block = live(),
  seat = EVERY_ROLE,
}: {
  label: string;
  snap?: OverviewSnapshot;
  block?: OverviewLive;
  seat?: Actor;
}) {
  const screen = presentOverview(assembleOverview(snap, block, (navKey) => mayOpen(seat, navKey)));
  return (
    <States label={label} stack>
      <div className="w-full rounded-panel border border-line bg-paper p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <StatusChip status={screen.status} />
          <SnapshotLine note={screen.snapshotNote} />
        </div>
        <OverviewView screen={screen} periodKey={snap.period.key} allSectorsHref="#platform-overview" specimen />
      </div>
    </States>
  );
}

const QUIET_SECTORS = live().sectors.map((sector) => ({ ...sector, claimed: Math.max(sector.claimed, 900) }));

export function PlatformOverviewGallery() {
  return (
    <Section id="platform-overview" title="4a · Platform overview" note="The handoff's figures, through the page's own functions">
      <Specimen label="As drawn" />
      <Specimen
        label="Past month"
        snap={snapshot({
          period: month("2026-07"),
          previous: month("2026-06"),
          publishedInPeriod: 791,
          paid: { atEnd: 1_928, atStart: 1_874 },
          mrr: { endingFils: 32_448_000, startingFils: 31_002_000, composition: mrrComposition(BOOK.slice(0, 1_928), PLANS) },
          chart: chart("2026-07"),
        })}
      />
      <Specimen
        label="System down"
        block={live({ status: { state: "down", since: "2026-09-12T05:12:00.000Z", endsAt: "2026-09-12T06:00:00.000Z", systems: ["search"], overrun: false } })}
      />
      <Specimen label="Queue empty" block={live({ queue: { open: 0, overSla: 0, conflicts: 0, lastDecidedAt: "2026-09-12T10:20:00.000Z" } })} />
      <Specimen
        label="Nothing overdue"
        block={live({
          queue: { open: 12, overSla: 0, conflicts: 0, lastDecidedAt: "2026-09-12T06:31:00.000Z" },
          reports: { open: 4, overSla: 0, types: [{ type: "wrong_details", count: 4 }] },
        })}
      />
      <Specimen label="No supply gap" block={live({ sectors: QUIET_SECTORS })} />
      <Specimen label="Every search good" snap={snapshot({ noGoodResult: { rows: [], checked: 20 } })} />
      <Specimen label="Moderator's seat" seat={MODERATOR} />
      <Specimen
        label="Figures stale, boards disagree"
        snap={snapshot({ computedAt: "2026-09-12T02:00:00.000Z", period: month("2026-09", true), previous: month("2026-08") })}
        block={live({
          warnings: [
            { kind: "paying_ledger", tile: "paid", ours: 2_046, theirs: 2_051 },
            { kind: "plan_column", tile: "paid", ours: 2_046, theirs: 2_143 },
          ],
        })}
      />
      <Specimen
        label="Cold start"
        snap={snapshot({
          publishedInPeriod: 40,
          claimsApproved: 3,
          paid: { atEnd: 0, atStart: 0 },
          mrr: { endingFils: 0, startingFils: 0, composition: mrrComposition([], PLANS) },
          quoted: { current: { fils: 0, quotes: 0, proposals: 0 }, previous: { fils: 0, quotes: 0, proposals: 0 } },
          chart: chart().map((point) => ({ ...point, claims: 0, upgrades: 0, churn: 0, rfqs: 0 })),
          sectorRfqs: {},
          noGoodResult: { rows: [], checked: 0 },
        })}
        block={live({
          listingsLive: 40,
          claimed: 3,
          claimedLive: 3,
          planMix: [],
          sectors: [
            { id: "hvac", name: "HVAC & refrigeration", listings: 22, claimed: 2 },
            { id: "mep", name: "Industrial & MEP supplies", listings: 18, claimed: 1 },
          ],
          queue: { open: 0, overSla: 0, conflicts: 0, lastDecidedAt: null },
          reports: { open: 0, overSla: 0, types: [] },
          otherQueues: [{ key: "licences_expiring", count: 0 }],
          opens: [],
        })}
      />
    </Section>
  );
}
