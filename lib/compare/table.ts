import { valueAliases } from "@/lib/search/index-text";
import { toSpecRows, type TemplateField } from "@/lib/spec";

/**
 * Board `10d` — four products against one set of fields.
 *
 * Pure, so the page and the gallery build the same table from the same rule,
 * and so the one decision that makes or breaks this screen — *which cells
 * differ* — is tested without a database.
 *
 * ## B1 — the template makes the rows
 *
 * Every field the category's template defines is a row, in the template's
 * order, whether or not any column fills it. That is the whole claim under the
 * heading: *these are genuinely the same fields, not each seller's own wording.*
 * A row driven by the products instead would drop the field nobody filled,
 * which is the field a buyer most needs to see nobody filled.
 *
 * ## B4–B6 — a tint is a claim, so it is computed, not guessed
 *
 * A tinted row tells a buyer *these products differ here*. Computed on display
 * strings, `4"` against `DN100` would tint a row where every product is the
 * same size. So agreement is decided per field, on what the field is:
 *
 *   · **A closed vocabulary** — a field with declared options — compares the
 *     options chosen. Two sellers picking from one list cannot spell the same
 *     option two ways, and two different options are two different things, so
 *     exact is right and nothing is inferred.
 *   · **Free text and numbers** compare through `valueAliases`, the normaliser
 *     `10c`'s spec match already runs on every write (`B5`): nominal sizes both
 *     ways, trade abbreviations, pressure classes. Two cells agree when their
 *     alias sets meet.
 *
 * What is **not** done is guessing that two different words mean one thing.
 * `Ductile iron GGG40` beside `Ductile iron` is a grade stated beside a grade
 * not stated; the platform has no materials thesaurus and inventing one here
 * would put a comparison claim on the screen nobody can check. Where a trade's
 * sellers write one material two ways, the fix is the template offering it as
 * an option (`4e`), and the comparison follows on its own.
 *
 * **`Not provided` is not a value** (`B6`). It never tints, and it never makes
 * a row differ: three `EPDM` and one blank is a row where every product that
 * says anything says the same thing.
 *
 * ## Which rows may tint at all
 *
 * The spec rows and availability — facts about the *product*. The two rows at
 * the foot describe the *seller*: how fast they answer, and how much of the
 * template they filled. Those never tint and never take a colour (`B11`):
 * spec completeness is a seller diagnostic, and on a buyer's screen a red
 * `7 / 22` marks a seller down for a data problem rather than a product one.
 * The `Not provided` cells already say it where it matters.
 */

/** A template field, with what agreement needs beyond what rendering does. */
export interface CompareField extends TemplateField {
  /** The declared options. Non-empty means a closed vocabulary. */
  options: readonly string[];
}

export type AvailabilityValue = "in_stock" | "made_to_order" | "indent" | "out_of_stock";

export interface CompareProduct {
  id: string;
  specValues: unknown;
  availability: AvailabilityValue;
  stockQty: number | null;
  leadTimeDays: number | null;
  /** Measured median, or null. Never claimed (`B9`). */
  replyMs: number | null;
}

export type CellTone = "ok" | "info" | "warn" | "neutral";

export interface CompareCell {
  /** What the cell says, already rendered — `DN100 · 4 inch`. Null is `Not provided`. */
  text: string | null;
  /** The unit that follows a value, where the field has one and the value does not carry it. */
  unit: string | null;
  mono: boolean;
  /** For availability, the status tone the rest of the platform gives it. */
  tone?: CellTone;
  /** Availability's own facts, for the page to word — `240 in stock`, `Lead time 14 days`. */
  stockQty?: number | null;
  leadTimeDays?: number | null;
  /** For the seller rows: the raw figures the page formats. */
  replyMs?: number | null;
  filled?: number;
  total?: number;
}

export type RowKind = "spec" | "availability" | "reply" | "completeness";

export interface CompareRow {
  key: string;
  label: string;
  kind: RowKind;
  cells: CompareCell[];
  /**
   * The products differ here — at least two cells say something, and not the
   * same thing. Always false on a seller row, which never tints.
   */
  differs: boolean;
  /** No column fills it. Rendered anyway (`B1`); hidden with the matching rows. */
  empty: boolean;
}

export interface Comparison {
  rows: CompareRow[];
  /** The rows that decide it — spec and availability rows that differ. The summary counts these. */
  deciding: number;
}

const AVAILABILITY_TONE: Record<AvailabilityValue, CellTone> = {
  in_stock: "ok",
  made_to_order: "info",
  indent: "warn",
  out_of_stock: "neutral",
};

/** The raw values a product stores for one field, as strings. Empty is none. */
export function storedValues(specValues: unknown, fieldId: string): string[] {
  const raw = ((specValues ?? {}) as Record<string, unknown>)[fieldId];
  if (raw === null || raw === undefined || raw === "") return [];
  return (Array.isArray(raw) ? raw : [raw])
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map((value) => String(value).trim())
    .filter((value) => value.length > 0);
}

/** One value's comparison key set: itself for a closed list, its aliases otherwise. */
function keysOf(value: string, closed: boolean): Set<string> {
  if (closed) return new Set([value.toLowerCase().replace(/\s+/g, " ")]);
  return new Set(valueAliases(value).map((alias) => alias.toLowerCase().replace(/\s+/g, " ")));
}

function meets(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  for (const key of a) if (b.has(key)) return true;
  return false;
}

/**
 * Whether two products say the same thing for one field.
 *
 * Both sides must be filled — a blank is never compared (`B6`). A multi-valued
 * field agrees when every value on each side is met by a value on the other,
 * so `UL, FM` beside `FM, UL` agrees and `UL` beside `UL, FM` does not: the
 * second product states a certification the first does not.
 */
export function sameValues(a: readonly string[], b: readonly string[], closed: boolean): boolean {
  if (a.length === 0 || b.length === 0) return true;
  const left = a.map((value) => keysOf(value, closed));
  const right = b.map((value) => keysOf(value, closed));
  return (
    left.every((keys) => right.some((other) => meets(keys, other))) &&
    right.every((keys) => left.some((other) => meets(keys, other)))
  );
}

/** A row differs when at least two filled cells disagree. */
function rowDiffers(values: readonly (readonly string[])[], closed: boolean): boolean {
  const filled = values.filter((entry) => entry.length > 0);
  for (let i = 0; i < filled.length; i += 1) {
    for (let j = i + 1; j < filled.length; j += 1) {
      if (!sameValues(filled[i]!, filled[j]!, closed)) return true;
    }
  }
  return false;
}

export interface ComparisonLabels {
  availability: string;
  reply: string;
  completeness: string;
}

/**
 * The table, from a template and the products in the order the buyer chose
 * them — `B12`: nothing here reorders, ranks or promotes a column.
 */
export function buildComparison(
  fields: readonly CompareField[],
  products: readonly CompareProduct[],
  labels: ComparisonLabels,
): Comparison {
  const rendered = products.map((product) => toSpecRows(fields, product.specValues));

  const specRows: CompareRow[] = fields.map((field, index) => {
    const closed = field.options.length > 0;
    const values = products.map((product) => storedValues(product.specValues, field.id));
    const cells: CompareCell[] = products.map((_, column) => {
      const spec = rendered[column]![index]!;
      return { text: spec.value ?? null, unit: spec.unit ?? null, mono: spec.mono ?? false };
    });
    return {
      key: `spec:${field.id}`,
      label: field.label,
      kind: "spec",
      cells,
      differs: rowDiffers(values, closed),
      empty: values.every((entry) => entry.length === 0),
    };
  });

  const availability: CompareRow = {
    key: "availability",
    label: labels.availability,
    kind: "availability",
    cells: products.map((product) => ({
      text: product.availability,
      unit: null,
      mono: false,
      tone: AVAILABILITY_TONE[product.availability],
      stockQty: product.availability === "in_stock" ? product.stockQty : null,
      leadTimeDays: product.availability === "in_stock" ? null : product.leadTimeDays,
    })),
    /*
       Compared on the state, not on the quantity beside it. `In stock · 240`
       and `In stock` are both in stock; the count is a detail of one seller's
       warehouse, and tinting a row for it would tell a buyer the products
       differ when they do not.
    */
    differs: new Set(products.map((product) => product.availability)).size > 1,
    empty: false,
  };

  const reply: CompareRow = {
    key: "reply",
    label: labels.reply,
    kind: "reply",
    cells: products.map((product) => ({ text: null, unit: null, mono: false, replyMs: product.replyMs })),
    differs: false,
    empty: false,
  };

  const total = fields.length;
  const completeness: CompareRow = {
    key: "completeness",
    label: labels.completeness,
    kind: "completeness",
    cells: products.map((product) => ({
      text: null,
      unit: null,
      mono: true,
      filled: fields.filter((field) => storedValues(product.specValues, field.id).length > 0).length,
      total,
    })),
    differs: false,
    empty: false,
  };

  const rows = [...specRows, availability, reply, completeness];
  return {
    rows,
    deciding: [...specRows, availability].filter((row) => row.differs).length,
  };
}

/**
 * `Hide matching rows` — the rows that do not decide anything.
 *
 * A spec row stays when the products differ in it. A row nobody filled goes
 * too: it is a gap in every listing, not a difference between them, and a buyer
 * who asked to see only the differences asked not to read it. The two seller
 * rows always stay, because they are not a question of matching.
 */
export function visibleRows(comparison: Comparison, hideMatching: boolean): CompareRow[] {
  if (!hideMatching) return comparison.rows;
  return comparison.rows.filter(
    (row) => row.kind === "reply" || row.kind === "completeness" || row.differs,
  );
}
