import type { SpecFieldRule } from "@/lib/metrics/spec-completeness";
import { requiredNow } from "@/lib/metrics/spec-completeness";

/**
 * Board 8c's arithmetic, with no database in it.
 *
 * The row editor asks three questions of every line — is it live, does it count
 * towards the ten, and how full are its specs — and all three are the sort of
 * thing that goes quietly wrong. They are here so they can be tested without a
 * request, and so the screen and the service cannot answer them differently.
 */

/**
 * One field on the sheet, as this screen needs it.
 *
 * `SpecFieldRule` deliberately carries only what completeness arithmetic needs,
 * and it is shared with the nightly strength job — widening it to give this
 * screen a label and a unit would put rendering concerns into a metric. So this
 * extends it instead, and every function below that only counts still takes the
 * narrower type.
 */
export interface SheetField extends SpecFieldRule {
  label: string;
  unit: string | null;
  type: string;
  options: readonly string[];
}

/** Board 8c §3: name, size and availability. Nothing else gates publishing. */
export interface PublishableTrio {
  name: string;
  size: string;
  availability: string | null;
}

/**
 * What the task is counting towards. Board 8a §3 and 8c §3.
 *
 * Ten products, each with at least 60% of its sheet's required attributes.
 */
export const PRODUCT_TARGET = 10;

/** Below this a product is live and findable, and does not count. §3. */
export const QUALIFY_RATIO = 0.6;

/** At or above this the row is complete enough for spec-filtered search. §3. */
export const STRONG_RATIO = 0.8;

/** Twelve minutes, from the work. The hub's card states the same number. */
export const PRODUCT_MINUTES = 12;

/**
 * A row is live when the publishable trio is present. Board 8c §4.
 *
 * No publish button, no draft column, no review step — the same commit-as-you-go
 * model board 8b uses for photographs. A row with a name and nothing else is
 * saved, private, and excluded from every count; it shows in this table and
 * nowhere else.
 */
export function isPublishable(trio: PublishableTrio): boolean {
  return (
    trio.name.trim().length >= NAME_MIN &&
    trio.size.trim().length > 0 &&
    trio.availability !== null &&
    trio.availability !== ""
  );
}

export const NAME_MIN = 3;
export const NAME_MAX = 120;

export type RowTone = "strong" | "thin" | "short";

export interface SpecStanding {
  filled: number;
  required: number;
  /** Nought to one. One when the sheet requires nothing — see below. */
  ratio: number;
  /** Whether this row counts towards the ten. */
  qualifies: boolean;
  tone: RowTone;
}

/**
 * How full one row's required specs are, and whether that is enough.
 *
 * Required means `requiredNow` — required, filterable, and past its
 * `requiredFrom` — which is the definition `lib/metrics/spec-completeness.ts`
 * already uses for the profile-strength job and the catalogue banner. There were
 * three definitions of "spec coverage" in this codebase and they disagreed;
 * this is deliberately not a fourth.
 *
 * A sheet that requires nothing is satisfied by anything. That is a statement
 * about the sheet rather than about the product, and inventing a failure would
 * punish a seller for our gap — the same reasoning `productIsComplete` gives.
 */
export function specStanding(
  values: Record<string, unknown> | null,
  fields: readonly SpecFieldRule[],
  now: Date = new Date(),
): SpecStanding {
  const required = requiredNow(fields, now);
  if (required.length === 0) {
    return { filled: 0, required: 0, ratio: 1, qualifies: true, tone: "strong" };
  }

  const held = values ?? {};
  const filled = required.filter((field) => isFilled(held[field.id])).length;
  const ratio = filled / required.length;

  return {
    filled,
    required: required.length,
    ratio,
    // Live and findable either way. This decides only whether it helps the task.
    qualifies: ratio >= QUALIFY_RATIO,
    tone: ratio >= STRONG_RATIO ? "strong" : ratio >= QUALIFY_RATIO ? "thin" : "short",
  };
}

function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * Which field on a sheet is the one the render calls "size".
 *
 * There is no `size` column on `Product` and no field keyed `size` on any
 * seeded sheet — on Valves it is `nominal_diameter`, carrying the unit `DN`.
 * So "size" is a role rather than a name: the first field that carries a unit,
 * because a unit is what makes an attribute a measurement, and failing that the
 * first field the sheet requires.
 *
 * The column is headed with the field's own label rather than the word "size".
 * The render is generic because it was drawn without a sheet in front of it; a
 * supplier looking at a valve sheet and reading "Nominal diameter" knows what to
 * type, and reading "Size" has to guess whether we mean the bore or the box.
 */
export function sizeFieldOf(fields: readonly SheetField[]): SheetField | undefined {
  return fields.find((field) => field.unit !== null && field.unit !== undefined)
    ?? fields.find((field) => field.required);
}

/**
 * A URL-safe slug for a product name.
 *
 * The fifth copy of this function in the repo — `lib/import/service.ts`,
 * `lib/ingest/service.ts`, `lib/moderation/service.ts` and `lib/taxonomy` each
 * have one. It is copied rather than shared here on purpose: unifying them is a
 * change to four services that generate slugs already in production, where a
 * changed slug is a changed URL, and that is its own piece of work rather than
 * a side effect of this board.
 */
export function productSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "product"
  );
}

/**
 * Board 8c §6 — a block pasted out of a spreadsheet.
 *
 * Tab-separated, newline-delimited, in the table's own column order. No mapping
 * step and no file handling: the expensive version of this is the importer, and
 * §6 is explicit that the two share one visual weight in the render and are not
 * the same feature.
 *
 * Excel quotes any cell containing a tab or a newline, so quoted cells are
 * unwrapped and doubled quotes collapsed. A row with no name is dropped rather
 * than saved empty — a trailing newline is the commonest thing in a paste.
 */
export interface PastedRow {
  name: string;
  size: string;
  availability: string;
}

export function parsePaste(text: string, limit: number): PastedRow[] {
  const rows: PastedRow[] = [];

  for (const line of text.split(/\r\n|\r|\n/)) {
    if (rows.length >= limit) break;
    if (line.trim() === "") continue;

    const cells = line.split("\t").map(unquote);
    const name = (cells[0] ?? "").slice(0, NAME_MAX);
    if (name.trim().length < NAME_MIN) continue;

    rows.push({
      name: name.trim(),
      size: (cells[1] ?? "").trim().slice(0, 80),
      availability: (cells[2] ?? "").trim().slice(0, 40),
    });
  }

  return rows;
}

function unquote(cell: string): string {
  const trimmed = cell.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"');
  }
  return trimmed;
}
