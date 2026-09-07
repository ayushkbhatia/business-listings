import { capFor, type Metered, type PlanCaps } from "@/lib/plan/entitlements";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Board 11f — what each plan holds, measured against what this seller has.
 *
 * Pure, and that is the point: the grid is nine rows of arithmetic over the
 * plan-limit config and four usage counts, and it is where criterion 4 either
 * holds or does not. Testing it needs no database.
 *
 * ## One denominator per row
 *
 * The board's first correction. Team seats read `1 of 3` on Free, `2 of 3` on
 * Basic and `3 of 5 used` on Pro — the first two counting against the seller's
 * three seats and the third against Pro's cap of five. Two denominators in one
 * row, and a reader comparing them across is comparing nothing.
 *
 * So every metered cell answers exactly one question: **what would this plan
 * keep, out of what you have now?** The denominator is the seller's usage and
 * it is the same in all three columns. A plan that holds everything says `All
 * 1,204` rather than restating its own cap, because the cap is not what the
 * seller is deciding about.
 *
 * That also makes the shortfall computable rather than described: `keeps` and
 * `used` are on the cell, so the "you choose what stays live" panel reads the
 * same numbers the grid printed instead of deriving its own.
 *
 * ## Caps and entitlements are different rows
 *
 * The spec: *"the distinction matters more than the layout."* A cap has a
 * current value and a meter behind it. An entitlement is on or off and has
 * neither — rendering analytics through `allowance()` would produce "0 of 1",
 * which is a meter where there is none. `METERED` and `ENTITLEMENTS` in
 * lib/plan/entitlements.ts are the two lists, and this module draws from both
 * without merging them.
 *
 * Enquiries sits with the entitlements even though it is metered, because a
 * monthly allowance that resets is not a thing the seller picks what to keep
 * from. The board renders it `3 a month` / `25 a month` / `Unlimited`.
 */

/** Bytes in a megabyte, and megabytes in a gigabyte. `storageMb` is megabytes. */
const MB_PER_GB = 1024;

export type GridCellState =
  /** The plan holds everything the seller has. */
  | "keeps_all"
  /** The plan holds less, and the difference is what the seller must choose. */
  | "shortfall"
  /** An entitlement this plan carries. */
  | "included"
  /** An entitlement it does not. */
  | "absent"
  /** A stated allowance, such as enquiries a month. */
  | "value";

export interface GridCell {
  planId: string;
  /** What the cell reads. Already localised and already formatted. */
  label: string;
  state: GridCellState;
  /**
   * How many of the seller's current items this plan would keep, on a metered
   * row. Null on an entitlement row, where there is nothing to count.
   */
  keeps: number | null;
}

export type GridRowKind = "meter" | "entitlement";

export interface GridRow {
  key: string;
  header: string;
  kind: GridRowKind;
  cells: GridCell[];
}

/** What the seller has right now. Every figure is a query at the call site. */
export interface Usage {
  /** Products with status `live`. The catalogue as buyers see it. */
  products: number;
  /** Published locations. A branch the seller hid is not published — see below. */
  locations: number;
  /** Team seats taken, including pending invitations. */
  seats: number;
  /** Megabytes of media stored. */
  storageMb: number;
}

/**
 * The metered rows, in the board's order.
 *
 * `storage` is last of the four because it is the one that does not resolve into
 * a list of things to pick from — see `shortfallsOf`.
 */
const METER_ROWS = [
  { key: "products", metered: "products" as Metered, header: "change.row.products" },
  { key: "locations", metered: "locations" as Metered, header: "change.row.branches" },
  { key: "seats", metered: "seats" as Metered, header: "change.row.seats" },
  { key: "storage", metered: "storage" as Metered, header: "change.row.storage" },
] as const;

const ENTITLEMENT_ROWS = [
  { key: "analytics", field: "analytics", header: "change.row.analytics" },
  { key: "csv_import", field: "csvImport", header: "change.row.csv_import" },
  { key: "custom_domain", field: "customDomain", header: "change.row.custom_domain" },
  { key: "sponsored", field: "sponsoredEligible", header: "change.row.sponsored" },
] as const;

/** Which `Usage` field a metered row counts. */
const USED_BY: Record<string, (usage: Usage) => number> = {
  products: (u) => u.products,
  locations: (u) => u.locations,
  seats: (u) => u.seats,
  storage: (u) => u.storageMb,
};

/**
 * How many of `used` this plan keeps. `null` cap is unlimited and keeps all.
 *
 * Never more than the seller has: a Pro cap of ten seats against three taken
 * keeps three, not ten. That is the whole of the first correction.
 */
export function keepsOf(plan: PlanCaps, what: Metered, used: number): number {
  const cap = capFor(plan, what);
  return cap === null ? used : Math.min(cap, used);
}

/** `2.1 GB`, `0.5 GB`, `12 MB`. Megabytes in, one decimal at gigabyte scale. */
export function formatStorage(mb: number): string {
  if (mb < MB_PER_GB) return t("change.storage_mb", { value: formatCount(mb) });
  const gb = mb / MB_PER_GB;
  // One decimal, and no trailing `.0`: `2.1 GB` and `10 GB`, matching the board.
  const rendered = gb.toFixed(1).replace(/\.0$/, "");
  return t("change.storage_gb", { value: rendered });
}

/** The label for one metered cell. Storage reads in its own unit. */
function meterLabel(key: string, keeps: number, used: number): string {
  /*
     Nothing to keep, so no denominator.

     `All 0 MB` and `All 0` are what the general case produces for a seller who
     has not uploaded anything or has no live products, and neither is a
     sentence. The row still renders — an unfilled meter stays visible rather
     than being hidden — it just says what it is.
  */
  if (used === 0) return t("change.cell.keeps_none");

  const all = keeps >= used;
  if (key === "storage") {
    return all
      ? t("change.cell.keeps_all_storage", { used: formatStorage(used) })
      : t("change.cell.keeps_storage", {
          keeps: formatStorage(keeps),
          used: formatStorage(used),
        });
  }
  return all
    ? t("change.cell.keeps_all", { used: formatCount(used) })
    : t("change.cell.keeps", { keeps: formatCount(keeps), used: formatCount(used) });
}

/**
 * The whole grid: four metered rows, then five entitlement rows.
 *
 * `plans` arrives in `sortOrder`, which is the column order on screen. Nothing
 * here filters a plan out — a withdrawn plan the seller is *on* still has to
 * render, or the column they are standing in disappears.
 */
export function planGrid(plans: readonly PlanCaps[], usage: Usage): GridRow[] {
  const meters: GridRow[] = METER_ROWS.map((row) => {
    const used = USED_BY[row.key]?.(usage) ?? 0;
    return {
      key: row.key,
      header: t(row.header as never),
      kind: "meter" as const,
      cells: plans.map((plan) => {
        const keeps = keepsOf(plan, row.metered, used);
        return {
          planId: plan.id,
          label: meterLabel(row.key, keeps, used),
          state: (keeps >= used ? "keeps_all" : "shortfall") as GridCellState,
          keeps,
        };
      }),
    };
  });

  /*
     Enquiries, stated as the allowance it is.

     Metered in the model — `enquiriesPerMonth` is a cap and `allowance()` reads
     it — and an entitlement on this screen, because it resets every month and
     there is nothing to pick what to keep from. Rendering it in the `keeps of
     used` frame would say "3 of 86 enquiries", which reads as losing 83 the
     seller already has rather than as a monthly ceiling.
  */
  const enquiries: GridRow = {
    key: "enquiries",
    header: t("change.row.enquiries"),
    kind: "entitlement",
    cells: plans.map((plan) => {
      const cap = capFor(plan, "enquiries");
      return {
        planId: plan.id,
        label:
          cap === null
            ? t("change.cell.unlimited")
            : t("change.cell.per_month", { count: cap, formatted: formatCount(cap) }),
        state: "value" as GridCellState,
        keeps: null,
      };
    }),
  };

  const entitlements: GridRow[] = ENTITLEMENT_ROWS.map((row) => ({
    key: row.key,
    header: t(row.header as never),
    kind: "entitlement" as const,
    cells: plans.map((plan) => ({
      planId: plan.id,
      label: plan[row.field] ? t("change.cell.included") : t("change.cell.absent"),
      state: (plan[row.field] ? "included" : "absent") as GridCellState,
      keeps: null,
    })),
  }));

  return [...meters, enquiries, ...entitlements];
}

export interface Shortfall {
  /** `products`, `locations`, `seats`, `storage`. */
  key: string;
  keeps: number;
  used: number;
  /**
   * Whether the seller picks which items survive.
   *
   * True for products, branches and seats — each resolves to a list of rows with
   * ids, and board 11f gives each a `Choose`. False for storage, which does not:
   * see `lib/billing/keep.ts` for what happens there instead.
   */
  choosable: boolean;
}

/**
 * What the target plan holds less of than the seller has.
 *
 * Reads the grid rather than recomputing from the caps, so the panel and the
 * table cannot disagree — the board's whole argument for a joint handoff is two
 * surfaces deriving one number twice.
 */
export function shortfallsOf(
  grid: readonly GridRow[],
  toPlanId: string,
  usage: Usage,
): Shortfall[] {
  const shortfalls: Shortfall[] = [];

  for (const row of grid) {
    if (row.kind !== "meter") continue;
    const cell = row.cells.find((c) => c.planId === toPlanId);
    if (!cell || cell.state !== "shortfall" || cell.keeps === null) continue;

    shortfalls.push({
      key: row.key,
      keeps: cell.keeps,
      used: USED_BY[row.key]?.(usage) ?? 0,
      /*
         Storage is the one that is not a choice, and saying so is the honest
         answer to Q4 rather than a `Choose` that opens nothing.

         The other three resolve to rows the seller can pick between — this
         product or that one — and picking is a real act with a real result. A
         gigabyte does not: files are removed on board 3i and a downgrade removes
         none of them. What actually happens is that the media library refuses
         the next upload until the seller is back under the cap, which is
         already true today in `app/(dashboard)/dashboard/media/actions.ts` and
         is what the panel says instead of offering a chooser.
      */
      choosable: row.key !== "storage",
    });
  }

  return shortfalls;
}

/**
 * What ends outright, rather than shrinking.
 *
 * Board 11f lists these apart from the caps and the spec says why: they are not
 * a shortfall the seller can choose their way through. The custom domain stops
 * resolving; a sponsored placement runs to its own end date and then ends —
 * which is Q7's answer, and the reason the date here is the booking's rather
 * than the subscription's.
 */
export interface EndingEntitlement {
  key: "custom_domain" | "sponsored";
  /** Rendered by the screen, which holds the domain and the placement. */
  detail: string;
  endsOn: Date;
}
