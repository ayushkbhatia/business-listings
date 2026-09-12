import { REQUIRED_FIELDS, type RequiredField } from "./scope-sheet";

/**
 * Scope templates — board `3h-s`, and the rule about what a template may not
 * hold.
 *
 * A marine surveyor inspects four different things and describes each one the
 * same way: same engagement shape, same fee basis, same deliverable, same
 * accreditation behind it. Only the words change. The template holds the shape
 * so the seller fills in the words.
 *
 * Pure, like `scope-sheet.ts` and `setup-sheet.ts` beside it, because the rule
 * about which fields travel leaves this screen — it decides what a clone
 * arrives at, which decides whether it counts toward `8c-s`'s three.
 *
 * ## The board is not the variant it says it is
 *
 * The handoff's premise is that `3h` — the goods spec template — is the same
 * interaction with a different field list. **It is not.** `3h` in this tree is
 * an *overlay*: one `SellerTemplate` per platform template per business
 * (`@@unique([businessId, platformTemplateId])`), storing only overrides, with
 * draft → apply → revision → rollback semantics and a history route. There is
 * no clone-into-many, no rename, no delete, no per-product offer and no usage
 * count anywhere in it.
 *
 * So this is a new build that borrows `3h`'s *vocabulary* rather than its code.
 * What it does borrow, deliberately, is the one idea worth keeping: a change is
 * proposed and reviewed before it lands, never written through.
 */

/* ── Which fields travel ─────────────────────────────────────────────────── */

/**
 * The five — four required and one optional.
 *
 * `regulator` is the board's *accreditation*: `3g-s` calls the row "regulator
 * or standard applied", and it is the one optional field that should travel
 * because a firm's IACS membership applies to every survey it does (`3h-s` Q1).
 * The other three optional rows — what the client provides, the sectors, the
 * languages — vary per engagement.
 */
export const TRAVELLING_FIELDS = [
  "engagementType",
  "feeBasis",
  "deliveredWhere",
  "deliverable",
  "regulator",
] as const;
export type TravellingField = (typeof TRAVELLING_FIELDS)[number];

export function isTravellingField(value: string): value is TravellingField {
  return (TRAVELLING_FIELDS as readonly string[]).includes(value);
}

/**
 * The four a template never carries, and the reason is one sentence of the
 * board's own.
 *
 * > Two inspections of the same class still differ in what they cover, and a
 * > pre-filled exclusions line is the one that ends up in a dispute.
 *
 * `scope` and `excluded` are `3g-s` B6. **`name` and `turnaround` are this
 * board's correction to it** — B6 reads *clone everything else; leave these two
 * empty by design*, naming only the first pair, and the four are right.
 *
 * Turnaround is the interesting one, and `3h-s` Q2 is the only real design
 * decision on the board. It is required, so templating it would make a clone
 * arrive complete at 6 of 6 rather than 4. It is also the field a buyer weighs
 * most heavily and the one that genuinely differs between a hull survey and a
 * pre-purchase inspection — so templating it produces four services claiming
 * the same turnaround, which is a worse document than one blank field.
 */
export const BLANK_FIELDS = ["name", "scope", "excluded", "turnaround"] as const;
export type BlankField = (typeof BLANK_FIELDS)[number];

/**
 * What a clone arrives at, and it is not an accident — `3h-s` §The arithmetic.
 *
 * Four of `3g-s`'s six required fields travel, so a clone lands at 4 of 6;
 * naming it makes 5; turnaround is the only one left. Four is exactly `8c-s`'s
 * `COUNTING_BAR`, so a cloned service counts toward the seller's three the
 * moment it is named — which is what makes the template worth having rather
 * than merely tidy.
 *
 * Asserted rather than described: if somebody adds a required field to `3g-s`
 * or moves the counting bar, this number moves with them and the test says so.
 */
export const CLONE_FILLS: number = REQUIRED_FIELDS.filter((field) =>
  (TRAVELLING_FIELDS as readonly string[]).includes(field),
).length;

/** The required fields a clone still owes, in the editor's order. */
export const CLONE_MISSING: readonly RequiredField[] = REQUIRED_FIELDS.filter(
  (field) => !(TRAVELLING_FIELDS as readonly string[]).includes(field),
);

/* ── What a template holds ───────────────────────────────────────────────── */

export type TemplateValues = Partial<Record<TravellingField, string>>;

/**
 * Keep only the travelling keys, and only where they say something.
 *
 * The database has the same whitelist as a CHECK, which is where B3 asks for it
 * — *UI-only avoidance will not survive the first import script.* This is the
 * layer above it, so a form that posts an extra key gets a clean save rather
 * than a 500, and the constraint stays the thing that makes the rule true.
 *
 * Blank strings are dropped rather than stored: a template holding `""` for
 * delivered-where would offer every service the empty value, which is an offer
 * to un-answer a question.
 */
export function travellingOnly(input: Readonly<Record<string, unknown>>): TemplateValues {
  const values: TemplateValues = {};
  for (const field of TRAVELLING_FIELDS) {
    const raw = input[field];
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (trimmed !== "") values[field] = trimmed;
  }
  return values;
}

/** How many of the five a template has answered — the card's own count. */
export function templateFilled(values: TemplateValues): number {
  return TRAVELLING_FIELDS.filter((field) => (values[field] ?? "").trim() !== "").length;
}

/* ── Offers ──────────────────────────────────────────────────────────────── */

/**
 * What one service currently holds, for the five fields that travel.
 *
 * `regulator` is a `ScopeFieldValue` row rather than a column, which is why
 * this is a flat shape rather than a `Service`: the caller flattens once and
 * the rule never has to know where a value is stored.
 */
export type ServiceValues = Partial<Record<TravellingField, string | null>>;

export interface Offer {
  field: TravellingField;
  /** What the service says now. Null where it has never answered. */
  before: string | null;
  /** What the template would set. Never blank — `travellingOnly` drops those. */
  after: string;
}

/**
 * The changes a template would make to one service — B4, AC3.
 *
 * **Derived, never stored.** A template edit does not write through to a live
 * service and does not enqueue anything: the offer *is* the difference between
 * the two, computed on read. A stored queue would be a second copy of the
 * template that goes stale the moment either side moves, and the board's own
 * reason for the rule is that three services quoting different clients must not
 * change shape because somebody tidied a template.
 *
 * `declined` is the one thing that cannot be derived — *I saw this and said no*
 * is a fact about the past. It is keyed by field and carries the refused
 * **value**, so a template edited again to something new offers again:
 * declining "Per certificate" says nothing about "Per day".
 */
export function offersFor(
  template: Readonly<TemplateValues>,
  service: Readonly<ServiceValues>,
  declined: Readonly<Partial<Record<TravellingField, string>>> = {},
): Offer[] {
  const offers: Offer[] = [];
  for (const field of TRAVELLING_FIELDS) {
    const after = (template[field] ?? "").trim();
    if (after === "") continue;

    const before = service[field] ?? null;
    if ((before ?? "").trim() === after) continue;
    if (declined[field] === after) continue;

    offers.push({ field, before, after });
  }
  return offers;
}

/**
 * The values a new service takes from its template.
 *
 * The same five, and nothing else — so a clone arrives as a draft at
 * `CLONE_FILLS` of six with scope and exclusions empty, which is B8 and
 * criterion 5. There is no branch here that could add a sixth: the loop is over
 * `TRAVELLING_FIELDS`, and adding a field to that list is the only way to
 * change what a clone carries.
 */
export function cloneValues(template: Readonly<TemplateValues>): TemplateValues {
  return travellingOnly(template);
}
