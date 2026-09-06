import type { CatalogueRow } from "@/lib/products/catalogue-query";

/**
 * The four states board 3f's spec says the SPECS cell has.
 *
 * A fixture rather than a screenshot, so the states stay true when the cell
 * changes. The third is the one worth looking at: a product that is live and
 * unsaveable at once is exactly what board 3h §5 intends, and it is the state
 * the original board had no way to express.
 */
const base: CatalogueRow = {
  id: "gallery",
  name: "Grooved butterfly valve DN100",
  slug: "grooved-butterfly-valve-dn100",
  sku: "AW-VLV-BF-100",
  categoryId: "c",
  categoryName: "Butterfly valves",
  templateName: "Industrial valve",
  status: "live",
  availability: "in_stock",
  stockQty: 240,
  photoCount: 2,
  watchers: 0,
  updatedAt: new Date(0),
  fromImport: false,
  gaps: { filled: 18, total: 22, requiredMissing: 0, filterGaps: 0 },
  untemplated: false,
  storedNotListed: false,
};

export const SPECS_CELL_STATES: readonly { caption: string; row: CatalogueRow }[] = [
  {
    caption: "Absent from two buyer filters",
    row: { ...base, gaps: { filled: 18, total: 22, requiredMissing: 0, filterGaps: 2 } },
  },
  {
    caption: "Gaps, none of which costs anything",
    row: { ...base, gaps: { filled: 11, total: 12, requiredMissing: 0, filterGaps: 0 } },
  },
  {
    caption: "Blocked on save, and absent from filters — live throughout",
    row: { ...base, gaps: { filled: 7, total: 22, requiredMissing: 2, filterGaps: 3 } },
  },
  {
    caption: "Nothing missing",
    row: { ...base, gaps: { filled: 22, total: 22, requiredMissing: 0, filterGaps: 0 } },
  },
  {
    caption: "No template, so nothing to publish",
    row: {
      ...base,
      templateName: null,
      untemplated: true,
      gaps: { filled: 0, total: 0, requiredMissing: 0, filterGaps: 0 },
    },
  },
];
