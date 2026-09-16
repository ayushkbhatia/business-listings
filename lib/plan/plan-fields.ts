import type { MessageKey } from "@/lib/i18n";

/**
 * Every configurable field on a plan — one list, read by the matrix that draws
 * the cells, by the action that reads them back, and by the diff that names
 * what moved.
 *
 * ## Why it is not three lists
 *
 * It was two, and they disagreed. `PlanEditor`'s `CAPS` decided what rendered
 * and `saveEntitlements` carried its own array of field names: `serviceLimit`
 * had a box from the day board `2e-s` shipped and was not in the action's list,
 * so a staff member typed the services cap, pressed Save, and got "nothing
 * changed" — a control that collects a number, discards it, and reports
 * success. `publicPhotoLimit` had neither and could only be changed by writing
 * the row by hand, which skips the audit row every other change writes.
 *
 * Board 12e widens the surface from seven caps to the whole config: *"every
 * numeric cell across Free, Basic and Pro is now an editable input, so the
 * admin has full control of the config rather than three columns where some
 * numbers were typed and some were prose."* Widening it made the one-list rule
 * load-bearing rather than tidy — there are fourteen fields now, and the diff
 * the ops lead confirms before committing is generated from this array.
 *
 * ## `empty` is the whole of `B6`
 *
 * *"`Unlimited` is a config value, not a typed string. Null or a toggle; an
 * admin cannot type it."* The board's render put the word `Unlimited` inside a
 * bordered mono field that otherwise holds numbers, which is a string somebody
 * can misspell into a cap of `NaN`. So a cell whose field has an `empty` clause
 * draws a checkbox beside the number and disables the box when it is ticked;
 * one whose `empty` is null draws a number and nothing else.
 *
 * What the empty value *means* differs per field and cannot be one label:
 * `productLimit` empty is unlimited, `annualMonthsCharged` empty is "this plan
 * is not sold by the year", and `teamSeats` empty is not a legal state at all.
 * A single "empty means unlimited" hint across all three would have been wrong
 * on two of them.
 *
 * ## What is deliberately absent
 *
 * `rankingMultiplier`. Board 12e correction 1, and `B2`: *"no ranking field on
 * this screen. Plan tier is one of `12c`'s six weights, capped at 10, and `12c`
 * is its only home."* The column exists, `lib/search/ranking.ts` reads it
 * through `scorePlan`, and an editable field in billing ops would be a second
 * writer for a model whose single source is that file. It is stated on the
 * screen rather than silently missing.
 */

/** How a cell draws, and how the action reads it back. */
export type PlanFieldKind = "money" | "count" | "switch";

/** Which band of the matrix a row sits in. */
export type PlanFieldGroup = "price" | "caps" | "features";

export interface PlanFieldSpec {
  field: PlanEditableField;
  kind: PlanFieldKind;
  group: PlanFieldGroup;
  labelKey: MessageKey;
  /**
   * What an empty cell means, or null where empty is not a value this field
   * has. The label is what the cell reads when it is empty; the hint names the
   * checkbox that empties it.
   */
  empty: { labelKey: MessageKey; hintKey: MessageKey } | null;
  /** A unit rendered inside the box — mono, never interactive. */
  suffix?: string;
}

const UNLIMITED = {
  labelKey: "admin.plans.unlimited",
  hintKey: "admin.plans.unlimited_hint",
} as const satisfies PlanFieldSpec["empty"];

export const PLAN_FIELDS = [
  /*
     Board 12e correction 3, and `B3`. The label carries `ex-VAT` because the
     `3m`/`11f` pair's largest correction was this exact ambiguity: a
     `AED 299 / month` headline against a `Then AED 313.95 incl. VAT` footnote
     with nothing marking which was which. Prices are stored and quoted ex-VAT;
     VAT 5% is always its own line; every total is labelled `incl. VAT`.

     Never empty. A plan with no price is not a free plan — Free is `0`, which
     is a number somebody chose — and an empty price box would read as
     "unlimited price", which is not a thing.
  */
  {
    field: "monthlyPriceAed",
    kind: "money",
    group: "price",
    labelKey: "admin.plans.row.price",
    empty: null,
  },
  /*
     Months charged for a year, not a second price column. `Plan` has one price
     and a second would be a second number to keep in step, which is the drift
     the one column exists to prevent — so annual Pro is `monthlyPriceAed ×
     annualMonthsCharged`, and `3m`'s "that number should come from the config
     rather than from arithmetic on the page" is satisfied by the config
     carrying the multiplier rather than the product.

     Empty means monthly-only, which is why it cannot share the "unlimited"
     label: an empty box here sells no year at all, and `offersAnnual` reads it
     to keep the yearly toggle off a card that cannot honour one.
  */
  {
    field: "annualMonthsCharged",
    kind: "count",
    group: "price",
    labelKey: "admin.plans.row.annual_months",
    empty: {
      labelKey: "admin.plans.monthly_only",
      hintKey: "admin.plans.monthly_only_hint",
    },
    suffix: "of 12",
  },

  /*
     `B10`, and the reason this row is not only a billing number. `1h-s`'s RFQ
     matcher excludes a free-plan supplier who is at their cap **silently** —
     the buyer is not shown a supplier who cannot reply — so editing this
     changes who receives demand on the buyer side, not only what a seller may
     send.
  */
  { field: "enquiriesPerMonth", kind: "count", group: "caps", labelKey: "admin.plans.row.enquiries", empty: UNLIMITED },
  /*
     Board 12e correction 2. The board's config drew `Products · Free` as `0`;
     the shipped cap is `10`, from `3m`/`11f` acceptance criterion 9 — *on Free,
     10 products stay live and the seller chooses which*, the rest stored
     unlisted (`3f` §6). `10` is the number a seller has already been shown, so
     it is the number in the database and this screen renders the database.
     Lowering it never deletes: `B9`.
  */
  { field: "productLimit", kind: "count", group: "caps", labelKey: "admin.plans.row.products", empty: UNLIMITED },
  /*
     Board `2e-s`. `serviceLimit` is what `productLimit` is for a firm that
     sells work, and the numbers it shipped with — three, fifteen, unlimited —
     are proposed rather than ratified: D1 settled seven plan numbers and
     services were not their own model yet. It needs an editor from the first
     day it exists, or the eighth number is the one only the database can
     change.
  */
  { field: "serviceLimit", kind: "count", group: "caps", labelKey: "admin.plans.row.services", empty: UNLIMITED },
  { field: "locationLimit", kind: "count", group: "caps", labelKey: "admin.plans.row.locations", empty: UNLIMITED },
  { field: "photoLimit", kind: "count", group: "caps", labelKey: "admin.plans.row.photos", empty: UNLIMITED },
  /*
     `photoLimit` is what a seller may upload; `publicPhotoLimit` is how many a
     visitor is shown, and only the second one is visible to a buyer. It is
     deliberately not in the entitlement snapshot — it is a rule about what a
     visitor sees today, not something a seller bought — so a change to it
     reaches every account on the plan whether or not apply-to-existing is
     ticked. The preview says so.
  */
  { field: "publicPhotoLimit", kind: "count", group: "caps", labelKey: "admin.plans.row.public_photos", empty: UNLIMITED },
  { field: "storageMb", kind: "count", group: "caps", labelKey: "admin.plans.row.storage", empty: UNLIMITED, suffix: "MB" },
  /*
     Board 11f renders `categoryLimit` as its own comparison row, so a seller
     reads it against the plan they are considering. It counts the primary
     category, so the extras a seller may add on board 2c are this minus one.
  */
  { field: "categoryLimit", kind: "count", group: "caps", labelKey: "admin.plans.row.categories", empty: UNLIMITED },
  /*
     Never empty, and the cell says so by drawing no checkbox. A plan with
     unlimited seats is a plan with no seat pricing, which is a commercial
     decision and not a field.
  */
  { field: "teamSeats", kind: "count", group: "caps", labelKey: "admin.plans.row.seats", empty: null },

  /*
     The four on/off entitlements board 11f's grid renders beside the caps.

     Each gates real code — `customDomain` the domain screen, `analytics` the
     analytics page and its CSV export, `csvImport` the import mapper,
     `sponsoredEligible` the placement screen — and each is a row on 11f's
     comparison. `customDomain` is the board's fifth row and was the one with a
     column, five readers and no writer.
  */
  { field: "customDomain", kind: "switch", group: "features", labelKey: "admin.plans.row.custom_domain", empty: null },
  { field: "analytics", kind: "switch", group: "features", labelKey: "admin.plans.row.analytics", empty: null },
  { field: "csvImport", kind: "switch", group: "features", labelKey: "admin.plans.row.csv", empty: null },
  { field: "sponsoredEligible", kind: "switch", group: "features", labelKey: "admin.plans.row.sponsored", empty: null },
] as const satisfies readonly PlanFieldSpec[];

/** Every field the console may write. */
export type PlanEditableField =
  | "monthlyPriceAed"
  | "annualMonthsCharged"
  | "enquiriesPerMonth"
  | "productLimit"
  | "serviceLimit"
  | "locationLimit"
  | "photoLimit"
  | "publicPhotoLimit"
  | "storageMb"
  | "categoryLimit"
  | "teamSeats"
  | "customDomain"
  | "analytics"
  | "csvImport"
  | "sponsoredEligible";

/** The numeric fields, in matrix order. */
export const NUMERIC_PLAN_FIELDS = PLAN_FIELDS.filter(
  (spec) => spec.kind !== "switch",
).map((spec) => spec.field);

/** The on/off fields, in matrix order. */
export const SWITCH_PLAN_FIELDS = PLAN_FIELDS.filter(
  (spec) => spec.kind === "switch",
).map((spec) => spec.field);

/** The numeric fields an empty box may set to null. */
export const NULLABLE_PLAN_FIELDS = PLAN_FIELDS.filter(
  (spec) => spec.kind !== "switch" && spec.empty !== null,
).map((spec) => spec.field);

const BY_FIELD = new Map<string, PlanFieldSpec>(PLAN_FIELDS.map((spec) => [spec.field, spec]));

/** One field's spec, by name. Null for anything not on the list. */
export function planFieldSpec(field: string): PlanFieldSpec | null {
  return BY_FIELD.get(field) ?? null;
}

export function isPlanField(field: string): field is PlanEditableField {
  return BY_FIELD.has(field);
}

/**
 * The pseudo-field the "On sale" row posts under.
 *
 * Withdrawal is not an entitlement: it changes nothing for anybody already on
 * the plan and must never reach `snapshotOf`. What it changes is whether the
 * plan can be *bought*. It rides the same form and the same diff so the ops
 * lead confirms one change set, and the service takes it beside `changes`
 * rather than inside them.
 */
export const ON_SALE_FIELD = "onSale";
