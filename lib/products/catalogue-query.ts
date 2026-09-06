import type { GapKind, ProductGaps } from "./gaps";

/**
 * Board 3f's shapes and its query vocabulary, with no way to reach a database.
 *
 * Split out of `./catalogue.ts`, which is `server-only`, because the catalogue's
 * client half needs `CATALOGUE_SORTS` and `PAGE_SIZES` to render its controls —
 * and a client component importing a value from a server-only module pulls
 * Prisma into the browser bundle. Typecheck allows it and lint allows it; only
 * `next build` catches it, which is this repo's most repeated defect and the
 * reason `lib/catalogue/overlay.ts` exists apart from `lib/catalogue/template.ts`.
 *
 * Types alone would have been safe — they are erased. The two `const` arrays
 * are not, and they are exactly what the sort and rows controls are built from.
 */

export interface CatalogueRow {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  categoryId: string;
  categoryName: string;
  /** The seller's own name for the template governing this row. */
  templateName: string | null;
  status: string;
  availability: string;
  stockQty: number | null;
  photoCount: number;
  /** Buyers waiting for this line to come back into stock. */
  watchers: number;
  updatedAt: Date;
  fromImport: boolean;
  gaps: ProductGaps;
  /** No template resolves for this row's category, so it cannot be published. */
  untemplated: boolean;
  /**
   * Hidden by a plan drop rather than by the seller.
   *
   * Both are `draft`, because every public surface already excludes a draft and
   * hiding through the status means no read path has to learn a new rule. The
   * difference matters exactly here: the seller has to be able to tell a
   * product the platform unlisted from one they saved themselves.
   */
  storedNotListed: boolean;
}

export interface CatalogueSummary {
  /** Every product, whatever its state. The figure the pagination counts to. */
  total: number;
  live: number;
  draft: number;
  outOfStock: number;
  /** Products with an empty required field. Their next save is blocked. */
  blockedOnSave: number;
  /** Products absent from at least one buyer filter. */
  missingFilterValue: number;
  /** Products with no template at all, so nothing 1g could render. */
  untemplated: number;
  /** True when the seller has more products than one pass should judge. */
  approximate: boolean;
}

export interface CatalogueQuery {
  /** Matches name, SKU and spec values — one trigram query on `searchText`. */
  q?: string;
  categoryId?: string;
  status?: string;
  /**
   * The seller's own name for a template.
   *
   * Keyed by name rather than by id because a product has no template pointer —
   * it answers to whatever its category resolves to — so the name is the only
   * stable handle the filter and the row share.
   */
  template?: string;
  gap?: GapKind;
  sort?: CatalogueSort;
  page?: number;
  pageSize?: number;
}

export const CATALOGUE_SORTS = [
  "gaps",
  "name",
  "sku",
  "template",
  "stock",
  "specs",
  "status",
  "updated",
] as const;
export type CatalogueSort = (typeof CATALOGUE_SORTS)[number];

export const PAGE_SIZES = [10, 25, 50, 100] as const;
/**
 * Fifty, not ten.
 *
 * The render draws ten to match the board's density, which against 1,242
 * products is 125 pages of bulk work — and this is the only screen in the wave
 * that acts on many products at once.
 */
export const DEFAULT_PAGE_SIZE = 50;

export interface CatalogueView {
  rows: CatalogueRow[];
  summary: CatalogueSummary;
  /** Rows matching the current filters, before pagination. Board 3f's Q5. */
  filtered: number;
  page: number;
  pageSize: number;
  /** Every id in the filtered set, so `Select all N` means what it says. */
  filteredIds: string[];
  /** The categories and templates present, for the filter controls. */
  categories: { id: string; name: string; count: number }[];
  templates: { id: string; name: string; count: number }[];
}

/**
 * Whether publishing a selection would take the seller past their plan's cap.
 *
 * Pure, and here rather than inside the server action, because the arithmetic
 * is the interesting part and an action needing a seat and a session is an
 * awkward place to assert it from. The action supplies the two counts; this
 * decides.
 *
 * `adding` counts only the rows that are **not already live**. Republishing
 * something that is already listed costs no room, and refusing it would make
 * the action look broken to a seller who selected a whole page — most of which
 * is usually live already.
 *
 * A plan that caps nothing never refuses. A seller already over their cap after
 * a downgrade has `remaining: 0` rather than a negative, so they are refused
 * any addition and can still unpublish their way back — which is the picker the
 * spec asks for, made out of controls this screen already has.
 */
export interface PublishRoom {
  /** null when the plan caps nothing. */
  cap: number | null;
  listed: number;
  adding: number;
}

export function refusesPublish(room: PublishRoom): boolean {
  if (room.cap === null) return false;
  return room.listed + room.adding > room.cap;
}

export function roomLeft(room: PublishRoom): number | null {
  return room.cap === null ? null : Math.max(0, room.cap - room.listed);
}
