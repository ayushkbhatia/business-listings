import { filsToAed, parseAedToFils } from "./money";

/**
 * Board `1n-s` — putting proposals on a twelve-month footing, and saying how.
 *
 * Pure, and the only place in the product that multiplies a fee. `1h-s` sent one
 * brief to several firms and no two need use the same unit: per month, per visit,
 * per square foot a year, a fixed fee. There is no common unit to sort on, and
 * **inventing one is the entire risk this board manages** — so every figure this
 * returns carries the operation that produced it (B2), and every case the
 * platform cannot honestly compute returns a reason instead of a number (B5).
 *
 * ## The rules
 *
 * - **Only an ongoing contract has a twelve-month footing.** A one-off job and a
 *   call-off have no year to put a fee on; the row is not shown for them.
 * - **Mobilisation is part of every footing** (B3, the first correction at
 *   export): a cost the supplier declared and the platform's sums leave out is
 *   worse than no sums.
 * - **Per month** is × 12.
 * - **Per visit** is × visits a year: the buyer's figure if they gave one on the
 *   page, else the brief's cadence (monthly 12, quarterly 4, annually 1), else
 *   not computable. Reactive work is never priced in (Q3).
 * - **Per sq ft a year** is × an area the **buyer states on the page**. The
 *   brief's scale line is free text and is never parsed (`1h-s` B6, `3j-s` AC9):
 *   the board's own data model says to parse it, and its own correction 2 is the
 *   case against — *12 floors, about 40,000 sq ft* over a brief for two towers.
 *   So the words are shown and the buyer supplies the number (Q2).
 * - **A fixed fee** is as proposed when the term is twelve months. Over any other
 *   term, or none, it is not a twelve-month figure and is not turned into one.
 * - **Every other basis** — per hour, per return, per container, on assessment —
 *   depends on a quantity nobody has stated, and says so.
 *
 * Nothing here ranks. The caller receives figures to print beside each other,
 * never an order to print them in (B7).
 */

/** How much of a year the row covers. */
export const FOOTING_MONTHS = 12;

/** A buyer-stated area, in square feet: whole, positive, and short of a city. */
export const AREA_MAX = 50_000_000;
/** A buyer-stated number of visits a year. */
export const VISITS_MAX = 366;

const CADENCE_VISITS: Record<string, number> = { monthly: 12, quarterly: 4, annually: 1 };

export interface FootingInput {
  feeBasis: string;
  feeAed: string;
  mobilisationAed: string | null;
  termMonths: number | null;
}

export interface FootingContext {
  /** `ServiceBrief.engagementType`; null for an enquiry with no brief. */
  engagementType: string | null;
  /** `ServiceBrief.cadence`. */
  cadence: string | null;
  /** Visits a year the buyer typed on the page, already read. */
  visitsPerYear: number | null;
  /** Square feet the buyer typed on the page, already read. */
  areaSqFt: number | null;
}

/** One step of the working, worded by the caller. */
export type WorkingStep =
  | { op: "months"; count: number }
  | { op: "visits"; count: number; source: "cadence" | "entered"; cadence?: string }
  | { op: "area"; sqft: number }
  | { op: "as_proposed" }
  | { op: "mobilisation"; aed: string }
  | { op: "no_mobilisation_stated" }
  | { op: "term_shorter"; termMonths: number };

export type NotComputable =
  /** Per visit, and neither a cadence nor a figure says how many. */
  | "needs_visits"
  /** Per sq ft a year, and the buyer has not stated an area. */
  | "needs_area"
  /** A fixed fee over a term that is not twelve months, or no term at all. */
  | "fixed_fee_term"
  /** A unit — hour, return, container — with no stated volume. */
  | "unknown_volume";

export type Footing =
  | { kind: "figure"; totalAed: string; working: WorkingStep[]; usesBuyerFigure: boolean }
  | { kind: "not_computable"; reason: NotComputable; working: WorkingStep[] };

/** Whether the twelve-month row exists at all for this enquiry. */
export function hasTwelveMonthFooting(context: Pick<FootingContext, "engagementType">): boolean {
  return context.engagementType === "ongoing_contract";
}

/**
 * Whether the row is worth showing for this set of proposals.
 *
 * §States: *all on the same basis → normalisation row suppressed, there is
 * nothing to reconcile.* One proposal alone still shows its working (*first
 * reply only*), because the working is information even with nothing beside it.
 */
export function footingRowShown(
  proposals: readonly Pick<FootingInput, "feeBasis">[],
  context: Pick<FootingContext, "engagementType">,
): boolean {
  if (!hasTwelveMonthFooting(context) || proposals.length === 0) return false;
  if (proposals.length === 1) return true;
  return new Set(proposals.map((p) => p.feeBasis)).size > 1;
}

export function twelveMonthFooting(proposal: FootingInput, context: FootingContext): Footing {
  const fee = parseAedToFils(proposal.feeAed);
  const mobilisation = proposal.mobilisationAed === null ? null : parseAedToFils(proposal.mobilisationAed);

  // The one-off, named in the working whichever way the multiplication went.
  const tail: WorkingStep[] =
    mobilisation === null
      ? [{ op: "no_mobilisation_stated" }]
      : mobilisation > 0n
        ? [{ op: "mobilisation", aed: filsToAed(mobilisation) }]
        : [];
  const plusMobilisation = mobilisation ?? 0n;
  const figure = (base: bigint, steps: WorkingStep[], usesBuyerFigure = false): Footing => ({
    kind: "figure",
    totalAed: filsToAed(base + plusMobilisation),
    working: [...steps, ...tail],
    usesBuyerFigure,
  });

  switch (proposal.feeBasis) {
    case "per_month": {
      const shorter =
        proposal.termMonths !== null && proposal.termMonths < FOOTING_MONTHS
          ? [{ op: "term_shorter" as const, termMonths: proposal.termMonths }]
          : [];
      return figure(fee * BigInt(FOOTING_MONTHS), [{ op: "months", count: FOOTING_MONTHS }, ...shorter]);
    }

    case "per_visit": {
      if (context.visitsPerYear !== null) {
        return figure(
          fee * BigInt(context.visitsPerYear),
          [{ op: "visits", count: context.visitsPerYear, source: "entered" }],
          true,
        );
      }
      const fromCadence = context.cadence ? CADENCE_VISITS[context.cadence] : undefined;
      if (fromCadence !== undefined) {
        return figure(fee * BigInt(fromCadence), [
          { op: "visits", count: fromCadence, source: "cadence", cadence: context.cadence! },
        ]);
      }
      return { kind: "not_computable", reason: "needs_visits", working: tail };
    }

    case "per_sqft_yr": {
      if (context.areaSqFt === null) return { kind: "not_computable", reason: "needs_area", working: tail };
      return figure(fee * BigInt(context.areaSqFt), [{ op: "area", sqft: context.areaSqFt }], true);
    }

    case "fixed_fee": {
      if (proposal.termMonths !== FOOTING_MONTHS) {
        return { kind: "not_computable", reason: "fixed_fee_term", working: tail };
      }
      return figure(fee, [{ op: "as_proposed" }]);
    }

    default:
      return { kind: "not_computable", reason: "unknown_volume", working: tail };
  }
}

/**
 * Which buyer figures the page should ask for: an area when any column is per
 * sq ft a year, visits when any is per visit and the brief's cadence does not
 * say. Nothing is asked that no column needs.
 */
export function figuresWanted(
  proposals: readonly Pick<FootingInput, "feeBasis">[],
  context: Pick<FootingContext, "engagementType" | "cadence">,
): { area: boolean; visits: boolean } {
  if (!hasTwelveMonthFooting(context)) return { area: false, visits: false };
  const bases = new Set(proposals.map((p) => p.feeBasis));
  return {
    area: bases.has("per_sqft_yr"),
    visits: bases.has("per_visit"),
  };
}

/** A figure typed into the page's query string, or null. Whole numbers only. */
export function readFigure(raw: string | undefined, max: number): number | null {
  if (raw === undefined) return null;
  const cleaned = raw.replace(/[\s,]/g, "");
  if (!/^\d{1,9}$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return value >= 1 && value <= max ? value : null;
}
