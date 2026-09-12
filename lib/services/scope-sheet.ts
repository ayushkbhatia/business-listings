import type { DeliveredWhere, EngagementType } from "@/lib/db/generated/enums";

/**
 * The scope sheet — boards `3g-s`, `3f-s` and `1g-s`, in the one place all
 * three read.
 *
 * The product editor asks for a SKU, a price, a stock level and a spec table.
 * None of those exist for an engagement. What a buyer needs before enquiring is
 * what does this cover, what does it not cover, how is it charged, how fast,
 * and what do I get at the end — and the sheet is that, as a fixed field list
 * so that two firms in the same trade are comparable at all.
 *
 * Pure, with no database import, for the same reason `lib/enquiry/fanout.ts` is:
 * the completeness rule leaves this screen — it is a column on `3f-s`, a gap
 * report to the seller and the intended ranking input on `12c` — so it is
 * tested without a database standing behind it.
 *
 * ## Two numbers, and they are not the same number
 *
 * **`n of 6`** is completeness: how many of the six required fields are filled.
 * It is what `3f-s` puts in a column and what `12c` is meant to score.
 *
 * **`n of 9`** is the public table: how many of the renderable rows a firm has
 * answered. It is nine and not eleven because the name is the page's heading
 * and the indicative fee is private.
 *
 * Conflating them was the first mistake available here, and it produces a
 * screen that tells a seller they are at 9 of 12 while the column beside it
 * says 6 of 6.
 */

/* ── The fields ──────────────────────────────────────────────────────────── */

/**
 * The six that make two firms comparable — board `3g-s`.
 *
 * In the order the editor asks them, which is also the order they appear in a
 * refusal, so a seller reading "turnaround and deliverable" finds them in that
 * order down the form.
 */
export const REQUIRED_FIELDS = [
  "name",
  "engagementType",
  "feeBasis",
  "turnaround",
  "deliveredWhere",
  "deliverable",
] as const;
export type RequiredField = (typeof REQUIRED_FIELDS)[number];

export const REQUIRED_COUNT = REQUIRED_FIELDS.length;

/**
 * The optional half, stored as `ScopeFieldValue` rows.
 *
 * **Four, not five, and `capacity` is the one missing.** Board `3g-s` offers it
 * and marks it "under review"; D11 closed as no on 11 Sep, on the ground that a
 * listed business is taking work and a stale *accepting clients* flag is worse
 * than no flag — a buyer who acts on one and gets no reply blames the
 * directory, not the firm. The field, the `1g-s` chip and the matcher column
 * went together, which is what the board asked for if D11 confirmed.
 *
 * `indicativeFee` is the fifth optional field and is a column rather than a row
 * here, because it is never rendered and the safest place for a field that must
 * not leak is outside the structure that gets mapped over.
 */
export const OPTIONAL_FIELD_KEYS = [
  "regulator",
  "requires_from_client",
  "sectors",
  "languages",
] as const;
export type OptionalFieldKey = (typeof OPTIONAL_FIELD_KEYS)[number];

export function isOptionalFieldKey(value: string): value is OptionalFieldKey {
  return (OPTIONAL_FIELD_KEYS as readonly string[]).includes(value);
}

/**
 * Every row the public scope table can carry, and the order is the family's.
 *
 * Name is absent because it is the page's `h1`, and `indicativeFee` is absent
 * because it is private. Nine rows, which is what the audit render shows.
 */
export const ROW_KEYS = [
  "engagement_type",
  "turnaround",
  "fee_basis",
  "deliverable",
  "delivered_where",
  "regulator",
  "requires_from_client",
  "sectors",
  "languages",
] as const;
export type RowKey = (typeof ROW_KEYS)[number];

export const ROW_COUNT = ROW_KEYS.length;

/**
 * Soft guidance on the scope block, and deliberately not a cap — `3g-s` Q3.
 *
 * About six hundred characters reads well: long enough to be specific, short
 * enough to read before enquiring. Firms that write more are not the problem,
 * and a hard limit would cut a sentence mid-word on the one field where the
 * detail is the value.
 */
export const SCOPE_GUIDANCE = 600;

export const ENGAGEMENT_TYPES = ["ongoing_contract", "one_off_job", "call_off"] as const;
export const DELIVERED_WHERE = ["remote", "at_our_office", "on_site"] as const;

export function isEngagementType(value: string): value is EngagementType {
  return (ENGAGEMENT_TYPES as readonly string[]).includes(value);
}

export function isDeliveredWhere(value: string): value is DeliveredWhere {
  return (DELIVERED_WHERE as readonly string[]).includes(value);
}

/* ── Completeness, measured and never declared ───────────────────────────── */

/** The six required fields of one service, as far as the rule cares. */
export interface RequiredFieldValues {
  name: string | null;
  engagementType: EngagementType | null;
  feeBasis: string | null;
  turnaround: string | null;
  deliveredWhere: DeliveredWhere | null;
  deliverable: string | null;
}

export interface Completeness {
  filled: number;
  total: number;
  /** In the order the editor asks them. Empty when the sheet is complete. */
  missing: RequiredField[];
}

/**
 * `n of 6`, computed on read — board `3g-s` B3, `3f-s` B2.
 *
 * Computed rather than stored, and there is no writable path to it anywhere.
 * The number leaves the screen: it is a column on `3f-s`, a gap report, and the
 * intended replacement for `12c`'s spec-completeness term, which a services
 * business can never earn. A seller-settable flag would be worth nothing to any
 * of the three.
 *
 * Whitespace does not count as filled. A field holding three spaces is a field
 * the seller has not answered, and scoring it would make the number gameable by
 * accident before anybody tried on purpose.
 */
export function completeness(service: RequiredFieldValues): Completeness {
  const missing = REQUIRED_FIELDS.filter((field) => !filled(service[field]));
  return { filled: REQUIRED_COUNT - missing.length, total: REQUIRED_COUNT, missing };
}

function filled(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Board `3g-s` B4, `3f-s` B3, and the rule both boards spend a paragraph on.
 *
 * A function rather than a comment, so that anything reaching for a
 * completeness gate has to delete this to get one. Six required fields make a
 * sheet *complete*, not *publishable*: gate publishing on the score and sellers
 * type "TBC" into six fields to clear it, which destroys the comparison the
 * fields exist to create.
 */
export function mayPublish(): true {
  return true;
}

/* ── The public table ────────────────────────────────────────────────────── */

/** One row of the family's table definition. */
export interface FamilyRow {
  key: string;
  label: string;
  position: number;
  filterable: boolean;
}

export interface ScopeRow {
  key: RowKey;
  label: string;
  /** Null where the firm has not answered. Never an empty string. */
  value: string | null;
  filterable: boolean;
}

/**
 * The scope table, in family order.
 *
 * Every firm in a family renders the same rows in the same order — that is the
 * comparison instrument, and sorting per service would destroy it. Rows the
 * family does not define are dropped; rows the family defines and the code does
 * not know are dropped too, because a label with nowhere to read a value from
 * renders an empty row for ever.
 *
 * ### Unfilled rows carry `null` rather than being absent
 *
 * Board `1g-s` B2 asks for unfilled rows to be omitted from the DOM. This
 * returns them, and the divergence is deliberate and stated in
 * `docs/services-build-plan.md`: `CLAUDE.md` § Interface honesty says *"Unfilled
 * data stays visible. Unfilled spec rows render grey reading 'Not provided',
 * never hidden. The buyer sees what is unanswered and the request becomes
 * high-intent."* The scope table is the spec table's replacement in the same
 * slot on the same kind of page.
 *
 * The board's own render also settles it on its own terms: it prints *"9 of 12
 * rows on the audit sheet are filled"* under a table with the unfilled ones
 * removed — so the buyer is told there are three unanswered rows and cannot see
 * which. That is the abandoned-form signal the board is trying to avoid, with
 * less information attached.
 *
 * The caller decides what to do with a null. Returning the row either way keeps
 * that a rendering decision rather than a data one.
 */
export function scopeRows(
  family: readonly FamilyRow[],
  values: Readonly<Partial<Record<RowKey, string | null>>>,
): ScopeRow[] {
  return [...family]
    .sort((a, b) => a.position - b.position || a.key.localeCompare(b.key))
    .filter((row): row is FamilyRow & { key: RowKey } =>
      (ROW_KEYS as readonly string[]).includes(row.key),
    )
    .map((row) => {
      const raw = values[row.key];
      return {
        key: row.key,
        label: row.label,
        value: typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null,
        filterable: row.filterable,
      };
    });
}

/** How many of the nine the firm has answered — the sentence under the table. */
export function rowsFilled(rows: readonly ScopeRow[]): number {
  return rows.filter((row) => row.value !== null).length;
}

/* ── The slug ────────────────────────────────────────────────────────────── */

/**
 * The public path segment, derived from the name once and then left alone.
 *
 * Stable after creation on purpose: a seller renaming *Statutory audit* to
 * *Statutory audit (IFRS)* must not silently break every link a buyer has, and
 * a redirect table for a rename nobody asked for is a lot of machinery to
 * un-break something that need not break.
 *
 * Falls back to `service` when a name reduces to nothing — a name in Arabic
 * alone is a real case, and an empty path segment is a 404 rather than a page.
 * The caller de-duplicates against the business's existing slugs.
 */
export function serviceSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug.length > 0 ? slug : "service";
}

/** `statutory-audit`, `statutory-audit-2`, `statutory-audit-3`. */
export function uniqueServiceSlug(name: string, taken: readonly string[]): string {
  const base = serviceSlug(name);
  if (!taken.includes(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.includes(candidate)) return candidate;
  }
  // A business with 999 services of one name has a different problem.
  return `${base}-${taken.length + 1}`;
}
