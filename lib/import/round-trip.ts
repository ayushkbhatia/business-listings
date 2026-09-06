/**
 * The one schema the export writes and the import reads.
 *
 * Board `3f` Q3 asked whether `Export ▾` produces the file `11d` can read back.
 * The answer this board carries is yes, and §5 states it as a table. The way to
 * make that answer survive is for both halves to be generated from this module
 * rather than agreed by hand — a round trip that is two lists of column names
 * in two files drifts on the first field anybody adds.
 *
 * ## What comes back, and what does not
 *
 * | Exported | Comes back |
 * |---|---|
 * | `sku`, `name`, `subcategory`, `description`, `stock_status`, `stock_qty`, `lead_time_days` | Yes |
 * | `spec:<field-key>` — one per template field | Yes |
 * | `photo_1…photo_6`, `doc_1…doc_3` — filenames | Yes, resolved against the media library |
 * | `price` | **Never.** There is none to export and none to import |
 * | `url`, `enquiries`, `completeness`, `updated_at` | Exported for reference, ignored on import |
 *
 * Two notes on that table, both of which are the difference between the spec
 * and what this codebase can honestly produce:
 *
 * **`price` is not a column that is refused on the way back in. It is a column
 * that does not exist in either direction.** `Product` has no price field —
 * CLAUDE.md non-negotiable 1 — so there is nothing for the export to write.
 * `lib/import/columns.ts` still refuses one on import, because the file being
 * read may not have come from here.
 *
 * **`views` is not exported.** §5 lists it among the reference columns. There is
 * no per-product view count in this schema: `StorefrontDailyStat` rolls views up
 * per business per day, and no table attributes one to a product. A `views`
 * column would therefore be a column of zeros presented as a measurement, which
 * is the one thing a directory cannot afford — "every number is a query, not a
 * constant". The other four reference columns are real and are exported.
 */

import type { ColumnPlan, ColumnTarget } from "./columns";

export const SPEC_PREFIX = "spec:";
export const PHOTO_COLUMNS = ["photo_1", "photo_2", "photo_3", "photo_4", "photo_5", "photo_6"] as const;
export const DOC_COLUMNS = ["doc_1", "doc_2", "doc_3"] as const;

/** The columns that come back, in the order the file writes them. */
export const CORE_COLUMNS = [
  "sku",
  "name",
  "subcategory",
  "description",
  "stock_status",
  "stock_qty",
  "lead_time_days",
] as const;

/**
 * Written so the seller can read the file, ignored when it comes back.
 *
 * `url` is where the product is; the rest are measurements. None of them has a
 * writable path — "derived metrics have no writable path" — so importing one
 * would be accepting a number the platform is supposed to compute.
 */
export const REFERENCE_COLUMNS = ["url", "enquiries", "completeness", "updated_at"] as const;

export function specColumn(fieldKey: string): string {
  return `${SPEC_PREFIX}${fieldKey}`;
}

export function specKeyOf(header: string): string | null {
  const trimmed = header.trim();
  if (!trimmed.toLowerCase().startsWith(SPEC_PREFIX)) return null;
  const key = trimmed.slice(SPEC_PREFIX.length).trim();
  return key === "" ? null : key;
}

/** The full header row for an export carrying these template fields. */
export function exportHeaders(specKeys: readonly string[]): string[] {
  return [
    ...CORE_COLUMNS,
    ...specKeys.map(specColumn),
    ...PHOTO_COLUMNS,
    ...DOC_COLUMNS,
    ...REFERENCE_COLUMNS,
  ];
}

/**
 * The name the seller sees in `Mappings you can reuse`.
 *
 * A real saved mapping is a row in `import_mapping`; this one is not, because
 * it is not the seller's and cannot be renamed or deleted. It is recognised
 * from the headers each time — which is also what makes it correct after a
 * template gains a field, where a stored plan would be stale.
 */
export const ROUND_TRIP_MAPPING_NAME = "Business Listings export";

/**
 * Does this file look like one of ours?
 *
 * Judged on the core columns rather than the whole header row, and on a subset
 * of those. A seller who exported, deleted the columns they do not maintain and
 * re-imported still has one of our files — insisting on an exact header row
 * would refuse the most useful version of the round trip, which is the bulk
 * edit §5 describes.
 */
export function looksLikeExport(headers: readonly string[]): boolean {
  const present = new Set(headers.map((h) => h.trim().toLowerCase()));
  if (!present.has("name")) return false;
  const core = CORE_COLUMNS.filter((column) => present.has(column)).length;
  const hasSpec = headers.some((header) => specKeyOf(header) !== null);
  // Three of seven, or two plus a spec column. `sku` and `name` alone is any
  // stock file in the world; `sku`, `name` and `stock_status` is ours.
  return core >= 3 || (core >= 2 && hasSpec);
}

/**
 * The 1:1 plan, derived from the headers rather than stored.
 *
 * Every column of ours goes where it came from; anything else in the file is
 * left for the ordinary suggestion pass, so a seller who added a column of
 * their own to our export still gets a guess at it rather than silence.
 */
export function roundTripTargetFor(header: string): ColumnTarget | null {
  const name = header.trim().toLowerCase();

  const specKey = specKeyOf(header);
  if (specKey) return { kind: "spec", specFieldKey: specKey };

  if ((PHOTO_COLUMNS as readonly string[]).includes(name)) return { kind: "photo" };
  // Documents are references in the library exactly as photos are, and the
  // photo target is what resolves a filename. The distinction between an image
  // and a datasheet is the library's to make, not the mapper's.
  if ((DOC_COLUMNS as readonly string[]).includes(name)) return { kind: "photo" };
  if ((REFERENCE_COLUMNS as readonly string[]).includes(name)) return { kind: "ignore" };

  switch (name) {
    case "sku":
      return { kind: "sku" };
    case "name":
      return { kind: "name" };
    case "subcategory":
      return { kind: "subcategory" };
    case "description":
      return { kind: "description" };
    case "stock_status":
      return { kind: "availability" };
    case "stock_qty":
      return { kind: "stock_qty" };
    case "lead_time_days":
      return { kind: "lead_time_days" };
    default:
      return null;
  }
}

/** Apply the round trip to a header row, leaving unknown columns undecided. */
export function roundTripPlan(headers: readonly string[]): {
  plan: ColumnPlan;
  matched: number;
  unknown: string[];
} {
  const unknown: string[] = [];
  const columns = headers.map((header) => {
    const target = roundTripTargetFor(header);
    if (target) return { header, target };
    unknown.push(header);
    return { header, target: { kind: "ignore" } as ColumnTarget };
  });
  return { plan: { columns }, matched: headers.length - unknown.length, unknown };
}
