/**
 * What each row in the file becomes.
 *
 * Pure, and deliberately so: everything the decision needs — the taxonomy, the
 * templates, the seller's SKUs, the media library — is resolved once by the
 * service and handed in as a lookup. A 412-row file then costs no queries per
 * row, and the rules that decide what an import does can be tested without a
 * database.
 *
 * Three things here are board 11d's corrections rather than plumbing:
 *
 *   1. **The template is per row.** A row's subcategory selects it, and a row
 *      whose subcategory matches nothing is an error row — never a
 *      default-template import, which would file valve rows against a pump
 *      sheet and drop every value that did not fit (§"One template badge").
 *   2. **An existing SKU updates.** The board's table says so —
 *      *"Existing SKUs update instead of duplicating — 18 rows match"* — and
 *      the previous implementation skipped those rows as duplicates.
 *   3. **`new + updated + errors == rows`,** asserted rather than rendered.
 *      `assertSums` throws, because a summary that does not add up is the one
 *      thing an import screen must never show.
 */

import { FilenameIndex, splitFilenames, type FilenameMatch } from "./filenames";
import { resolveTargetKey, type ColumnPlan, type TargetKind } from "./columns";

export type Availability = "in_stock" | "made_to_order" | "indent" | "out_of_stock";

/** "Made to Order", "MTO", "made_to_order" all mean the same on somebody's export. */
export function readAvailability(raw: string): Availability {
  const key = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (key.includes("madetoorder") || key === "mto") return "made_to_order";
  if (key.includes("indent")) return "indent";
  if (key.includes("out") || key.includes("nostock") || key === "no") return "out_of_stock";
  return "in_stock";
}

export function readInt(raw: string): number | null {
  const digits = raw.replace(/[^0-9-]/g, "");
  if (digits === "" || digits === "-") return null;
  const value = Number(digits);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

/** Lower case, letters and digits — how a category name in a file is compared. */
export function categoryKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/* ── What the service resolves for us ─────────────────────────────────────── */

export interface RowContext {
  /** Subcategory name **and** slug, keyed by `categoryKey`, to a category id. */
  categoryByKey: ReadonlyMap<string, string>;
  /**
   * For each category id, that category's template fields as key -> SpecField
   * id.
   *
   * The whole point of the per-row template. `specValues` is still keyed by
   * `SpecField.id` — the spec subsystem's load-bearing invariant — and this is
   * where a column's stable key becomes the id for *this* row's template.
   * A category whose template has no such field simply does not receive the
   * value; the column is not an error, it is not applicable here.
   */
  fieldIdsByCategory: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** SKU (trimmed, case-folded) to the seller's existing product. */
  productBySku: ReadonlyMap<string, { id: string; slug: string }>;
  /** Slugs already taken in this catalogue. */
  takenSlugs: ReadonlySet<string>;
  photos: FilenameIndex;
  /** Legacy saved mappings name a SpecField id; this turns one back into a key. */
  keyById: ReadonlyMap<string, string>;
  /**
   * The one category every row falls back to when the file has no subcategory
   * column at all.
   *
   * Not a default *template* — a default *category*, which is the seller's own
   * primary one and the same category the editor would have used. A file with
   * no category column is not the case §"One template badge" is about; that
   * case is a file that names categories which do not exist, and it errors.
   */
  fallbackCategoryId: string;
}

export interface ProductFields {
  name: string;
  slug: string;
  sku: string | null;
  description: string | null;
  availability: Availability;
  stockQty: number | null;
  leadTimeDays: number | null;
  minOrderQty: number | null;
}

export type RowError =
  | { reason: "no_name" }
  | { reason: "unknown_category"; value: string }
  | { reason: "duplicate_name"; name: string };

export interface PhotoOutcome {
  ids: string[];
  unmatched: string[];
  ambiguous: string[];
}

export type RowVerdict =
  | {
      kind: "create";
      rowNumber: number;
      categoryId: string;
      fields: ProductFields;
      specValues: Record<string, string>;
      photos: PhotoOutcome;
    }
  | {
      kind: "update";
      rowNumber: number;
      productId: string;
      categoryId: string;
      fields: ProductFields;
      specValues: Record<string, string>;
      photos: PhotoOutcome;
    }
  | { kind: "error"; rowNumber: number; error: RowError };

export interface Analysis {
  verdicts: RowVerdict[];
  created: number;
  updated: number;
  errors: number;
  rowCount: number;
  /** Filenames that resolved, did not, and resolved to more than one file. */
  photosMatched: number;
  photosUnmatched: number;
  photosAmbiguous: number;
  /** Distinct category values in the file that matched no subcategory. */
  unknownCategories: string[];
}

/**
 * Where each mapped kind sits in the file.
 *
 * A file can carry two columns claiming the same target — a seller's export
 * with both `Description` and `Long Description`. The first wins for the
 * single-valued kinds, which is the order the seller sees them in the table.
 */
function indexesOf(headers: readonly string[], plan: ColumnPlan) {
  const byHeader = new Map(plan.columns.map((c) => [c.header, c.target]));
  const first = (kind: TargetKind) =>
    headers.findIndex((header) => byHeader.get(header)?.kind === kind);
  return {
    byHeader,
    name: first("name"),
    sku: first("sku"),
    description: first("description"),
    availability: first("availability"),
    stock: first("stock_qty"),
    lead: first("lead_time_days"),
    moq: first("min_order_qty"),
    subcategory: first("subcategory"),
    // Every photo column, not the first: the export writes `photo_1…photo_6`.
    photos: headers
      .map((header, index) => ({ index, kind: byHeader.get(header)?.kind }))
      .filter((c) => c.kind === "photo")
      .map((c) => c.index),
  };
}

export function analyseRows(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  plan: ColumnPlan,
  context: RowContext,
): Analysis {
  const at = indexesOf(headers, plan);

  const specColumns = headers
    .map((header, index) => ({ index, target: at.byHeader.get(header) }))
    .filter((c) => c.target?.kind === "spec")
    .map((c) => ({ index: c.index, key: resolveTargetKey(c.target!, context.keyById) }))
    .filter((c): c is { index: number; key: string } => c.key !== undefined);

  const verdicts: RowVerdict[] = [];
  const unknownCategories = new Set<string>();
  /*
     The catalogue's slugs plus the ones this file has already used, so a file
     repeating a row does not collide with itself. Copied rather than mutated in
     place — the caller's set describes the catalogue, and an analysis must not
     change what it was given.
  */
  const taken = new Set(context.takenSlugs);
  const seenSku = new Set<string>();

  let photosMatched = 0;
  let photosUnmatched = 0;
  let photosAmbiguous = 0;

  for (const [i, row] of rows.entries()) {
    const rowNumber = i + 2; // 1-based, and row 1 is the header.
    const cell = (index: number) => (index >= 0 ? (row[index] ?? "").trim() : "");

    const name = cell(at.name);
    if (name === "") {
      verdicts.push({ kind: "error", rowNumber, error: { reason: "no_name" } });
      continue;
    }

    /*
       The subcategory, and the refusal that is this board's structural
       correction. A value naming no subcategory does not fall back to a default
       template — it is an error row the seller resolves with a picker, because
       an import that files rows under the wrong sheet drops every spec value
       that sheet does not have and reports success.
    */
    let categoryId = context.fallbackCategoryId;
    if (at.subcategory >= 0) {
      const raw = cell(at.subcategory);
      if (raw !== "") {
        const found = context.categoryByKey.get(categoryKey(raw));
        if (!found) {
          unknownCategories.add(raw);
          verdicts.push({
            kind: "error",
            rowNumber,
            error: { reason: "unknown_category", value: raw },
          });
          continue;
        }
        categoryId = found;
      }
    }

    const fieldIds = context.fieldIdsByCategory.get(categoryId);
    const specValues: Record<string, string> = {};
    for (const column of specColumns) {
      const value = cell(column.index);
      if (value === "") continue;
      // No template field with that key in *this* row's template: the column
      // does not apply here. Not an error, and not written under some other id.
      const fieldId = fieldIds?.get(column.key);
      if (fieldId) specValues[fieldId] = value;
    }

    const photos: PhotoOutcome = { ids: [], unmatched: [], ambiguous: [] };
    for (const index of at.photos) {
      for (const filename of splitFilenames(cell(index))) {
        const match: FilenameMatch = context.photos.match(filename);
        if (match.kind === "matched") {
          // One file, once, however many columns name it.
          if (!photos.ids.includes(match.id)) photos.ids.push(match.id);
          photosMatched += 1;
        } else if (match.kind === "ambiguous") {
          photos.ambiguous.push(filename);
          photosAmbiguous += 1;
        } else {
          photos.unmatched.push(filename);
          photosUnmatched += 1;
        }
      }
    }

    const sku = cell(at.sku) || null;
    const skuKey = sku ? sku.toLowerCase() : null;
    const existing = skuKey ? context.productBySku.get(skuKey) : undefined;

    if (existing && skuKey && !seenSku.has(skuKey)) {
      seenSku.add(skuKey);
      verdicts.push({
        kind: "update",
        rowNumber,
        productId: existing.id,
        categoryId,
        fields: {
          name,
          slug: existing.slug, // Its URL is already published. An import does not move it.
          sku,
          description: cell(at.description) || null,
          availability: at.availability >= 0 ? readAvailability(cell(at.availability)) : "in_stock",
          stockQty: at.stock >= 0 ? readInt(cell(at.stock)) : null,
          leadTimeDays: at.lead >= 0 ? readInt(cell(at.lead)) : null,
          minOrderQty: at.moq >= 0 ? readInt(cell(at.moq)) : null,
        },
        specValues,
        photos,
      });
      continue;
    }

    const slug = slugify(name) || `product-${rowNumber}`;
    if (taken.has(slug)) {
      /*
         A row that names a product the seller already has, and carries no SKU
         to say it is that product.

         An error rather than a second copy. The seller's own file is
         authoritative about their catalogue, but "authoritative" cannot mean
         "create a second product with the same name and no way to tell them
         apart" — which is what a de-duplicated slug would do on every repeat
         upload of the same file. Adding a SKU column makes the same file update
         instead, and the error says so.
      */
      verdicts.push({ kind: "error", rowNumber, error: { reason: "duplicate_name", name } });
      continue;
    }
    taken.add(slug);
    if (skuKey) seenSku.add(skuKey);

    verdicts.push({
      kind: "create",
      rowNumber,
      categoryId,
      fields: {
        name,
        slug,
        sku,
        description: cell(at.description) || null,
        availability: at.availability >= 0 ? readAvailability(cell(at.availability)) : "in_stock",
        stockQty: at.stock >= 0 ? readInt(cell(at.stock)) : null,
        leadTimeDays: at.lead >= 0 ? readInt(cell(at.lead)) : null,
        minOrderQty: at.moq >= 0 ? readInt(cell(at.moq)) : null,
      },
      specValues,
      photos,
    });
  }

  const analysis: Analysis = {
    verdicts,
    created: verdicts.filter((v) => v.kind === "create").length,
    updated: verdicts.filter((v) => v.kind === "update").length,
    errors: verdicts.filter((v) => v.kind === "error").length,
    rowCount: rows.length,
    photosMatched,
    photosUnmatched,
    photosAmbiguous,
    unknownCategories: [...unknownCategories],
  };
  assertSums(analysis);
  return analysis;
}

/**
 * Criterion 3, as an assertion rather than a rendering.
 *
 * `New + updated + errors` equals the row count. The board rendered 386, 18 and
 * 8 over 412 rows from constants, and the same handoff's `3f` shipped a header
 * whose breakdown summed to 1,256 over a total of 1,242. A sum that can drift
 * will; this one throws instead, in the one place that computes all four.
 */
export function assertSums(analysis: Analysis): void {
  const sum = analysis.created + analysis.updated + analysis.errors;
  if (sum !== analysis.rowCount) {
    throw new Error(
      `Import analysis does not add up: ${analysis.created} new + ${analysis.updated} updated + ` +
        `${analysis.errors} errors is ${sum}, over ${analysis.rowCount} rows.`,
    );
  }
}

/**
 * How many of the new products the plan has room to list, per §4.
 *
 * The import is never refused and no row is ever dropped — that is the whole of
 * criterion 10, and the previous implementation refused the file outright. Over
 * the cap, the rest are stored unlisted, which is exactly what a downgrade does
 * on `3f` §6: a plan limit never destroys a record.
 *
 * Updates do not count against it. Those products already exist and are already
 * listed or not; an import that rewrote eighteen live products must not unlist
 * some of them for arriving in the same file as four hundred new ones.
 */
export function listableCount(created: number, roomRemaining: number | null): number {
  if (roomRemaining === null) return created;
  return Math.max(0, Math.min(created, roomRemaining));
}
