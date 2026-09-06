import { describe, expect, it } from "vitest";
import { previewRows } from "./preview-rows";
import type { TemplateField } from "@/lib/spec";
import { formatSize } from "@/lib/format";

/**
 * The spec table board 1g renders and board 3g previews.
 *
 * One composer for both, so the rail's caption — "spec table as buyers see it"
 * — is structural rather than a claim somebody has to keep true by hand. These
 * assertions are the parts of that claim a refactor could break silently.
 */

const FIELDS: TemplateField[] = [
  { id: "f1", key: "nominal_diameter", label: "Nominal diameter", unit: "DN", type: "select", isFilterable: true },
  { id: "f2", key: "pressure_rating", label: "Pressure rating", unit: null, type: "select", isFilterable: true },
  { id: "f3", key: "part_no", label: "Manufacturer part no.", unit: null, type: "text", isFilterable: false },
  { id: "f4", key: "temperature_max", label: "Maximum temperature", unit: "°C", type: "number", isFilterable: false },
];

describe("the buyer's spec rows", () => {
  it("renders one row per template field, empties included", () => {
    /*
       Pinned so nobody re-fixes it to board 3g's wording.

       That handoff asks for empty rows to be omitted. CLAUDE.md says the
       opposite in so many words — "unfilled spec rows render grey reading 'Not
       provided', never hidden … the seller sees the same grey rows in their
       editor" — and board 1g's own criterion agrees. The criterion asking for
       the omission also contradicts itself: it wants the preview's row count to
       match what 1g shows, and a preview of two rows cannot match a page of
       four.
    */
    const { rows, total, filled } = previewRows(FIELDS, null, { f1: "DN100", f2: "PN16" });
    expect(rows).toHaveLength(4);
    expect(total).toBe(4);
    expect(filled).toBe(2);
    expect(rows.filter((row) => row.value === null)).toHaveLength(2);
  });

  it("pairs a size with its imperial equivalent, through the one formatter", () => {
    // `DN100 · 4 inch` is a unit conversion. A second implementation of it in
    // the editor would drift from the page it claims to preview.
    const { rows } = previewRows(FIELDS, null, { f1: "DN100" });
    // Compared against the formatter rather than a literal: the separator it
    // uses is not an ordinary space, and a hand-typed expectation here would
    // pin a character rather than the pairing.
    expect(rows[0]?.value).toBe(formatSize({ dn: 100 }));
    // Loosely, because the formatter joins with non-breaking spaces: the
    // pairing is what matters, not which space character it uses.
    expect(rows[0]?.value).toMatch(/^DN100\D+4\D+inch$/);
  });

  it("renders a pressure rating verbatim", () => {
    /*
       Asserted so nobody adds a `PN16 · 232 psi` pairing here. Board 3g's
       render draws one; board 1g performs no such conversion, and a preview
       that formats a value the page does not is a preview of a different page.
    */
    const { rows } = previewRows(FIELDS, null, { f2: "PN16" });
    expect(rows[1]?.value).toBe("PN16");
  });

  it("keeps the seller's label whole", () => {
    /*
       The formatter formats values, never labels. A preview that shortens
       "Manufacturer part no." to "Part no." is not a preview — the seller owns
       that string, and it is what the buyer reads.
    */
    const { rows } = previewRows(FIELDS, null, { f3: "BFV-100-GR" });
    expect(rows[2]?.label).toBe("Manufacturer part no.");
  });

  it("applies the seller's own label and order", () => {
    const { rows } = previewRows(
      FIELDS,
      { f1: { label: "Bore size", sortOrder: 3 }, f2: { sortOrder: 0 } },
      { f1: "DN100", f2: "PN16" },
    );
    /*
       f2 is pulled to the front and f1 pushed to 3. The two fields with no
       override keep their platform index — 2 and 3 — and the sort is stable, so
       f1 and f4 both sitting at 3 stay in the order the array arrived in.
    */
    expect(rows.map((row) => row.label)).toEqual([
      "Pressure rating",
      "Manufacturer part no.",
      "Bore size",
      "Maximum temperature",
    ]);
  });

  it("joins a multiselect the way the buyer's page joins it", () => {
    const { rows } = previewRows(FIELDS, null, { f3: ["WRAS", "UL listed"] });
    expect(rows[2]?.value).toBe("WRAS, UL listed");
  });

  it("marks the filterable rows, so the seller sees which ones carry a filter", () => {
    const { rows } = previewRows(FIELDS, null, {});
    expect(rows.map((row) => row.filterable)).toEqual([true, true, false, false]);
  });

  it("returns the overlaid fields, because 1g needs more than the rows", () => {
    // The page derives its filterable ids, its comparison labels and its
    // "request these specs" list from this array. A composer returning rows
    // alone would not be a drop-in for it.
    const { fields } = previewRows(FIELDS, { f1: { label: "Bore size" } }, {});
    expect(fields.map((f) => f.label)).toContain("Bore size");
    expect(fields).toHaveLength(4);
  });
});
