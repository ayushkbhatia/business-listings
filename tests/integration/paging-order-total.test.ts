import { describe, expect, it } from "vitest";
import { comparatorFor } from "@/lib/products/catalogue";
import { CATALOGUE_SORTS, type CatalogueRow } from "@/lib/products/catalogue-query";
import { newestSentFirst } from "@/lib/quotes/pipeline";

/**
 * Two lists that are paged in memory, held to one property: the same rows in
 * any input order sort into one order.
 *
 * Both pages are cut with `slice`, and a cut is only well defined over a total
 * order. `Array.prototype.sort` is stable, so wherever a comparator returned 0
 * the result kept its *input* order — and the input was a database read whose
 * order for tied rows nobody had specified. The catalogue was deterministic by
 * accident, because its fetch happened to be pinned; the quote pipeline's fetch
 * had no `orderBy` at all, and `exportPipeline` re-runs it once per page.
 *
 * No database: these are the comparators themselves. Here rather than in the
 * unit project because both modules import `server-only`, which only this
 * project stubs. Every row ties on everything but its id, so any comparator
 * that stops short of the id hands back two different orders for the two
 * inputs.
 */

const SAME_MS = new Date("2026-05-01T08:00:00.000Z");

function catalogueRow(id: string): CatalogueRow {
  return {
    id,
    name: "Gate valve DN100 PN16",
    slug: `gate-valve-${id}`,
    sku: "GV-100",
    categoryId: "cat",
    categoryName: "Valves",
    templateName: "Valves",
    status: "live",
    availability: "in_stock",
    stockQty: 12,
    photoCount: 1,
    watchers: 0,
    updatedAt: SAME_MS,
    fromImport: true,
    gaps: { filled: 4, total: 6, requiredMissing: 1, filterGaps: 1 },
    untemplated: false,
    storedNotListed: false,
  };
}

const IDS = ["cm00000a", "cm00000b", "cm00000c", "cm00000d", "cm00000e", "cm00000f"];
const ORDERINGS = [IDS, [...IDS].reverse(), ["cm00000c", "cm00000f", "cm00000a", "cm00000e", "cm00000b", "cm00000d"]];

describe("the catalogue's sorts", () => {
  it.each(CATALOGUE_SORTS)("orders a tie the same way whatever order it arrives in — %s", (sort) => {
    const results = ORDERINGS.map((ids) =>
      ids
        .map(catalogueRow)
        .sort(comparatorFor(sort))
        .map((row) => row.id),
    );
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    // Newest-edited first is the fallback, so a tie resolves highest id first —
    // the direction the fetch in `getCatalogueView` already uses.
    expect(results[0]).toEqual([...IDS].reverse());
  });
});

describe("the quote pipeline", () => {
  it("orders quotes sent in one millisecond the same way whatever order they arrive in", () => {
    const rows = (ids: string[]) => ids.map((quoteId) => ({ quoteId, sentAt: SAME_MS }));
    const results = ORDERINGS.map((ids) => rows(ids).sort(newestSentFirst).map((row) => row.quoteId));
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    expect(results[0]).toEqual([...IDS].reverse());
  });

  it("still puts a later quote above an earlier one before the tiebreak is reached", () => {
    const later = { quoteId: "cm00000a", sentAt: new Date(SAME_MS.getTime() + 1) };
    const earlier = { quoteId: "cm00000z", sentAt: SAME_MS };
    expect([earlier, later].sort(newestSentFirst).map((row) => row.quoteId)).toEqual(["cm00000a", "cm00000z"]);
  });
});
