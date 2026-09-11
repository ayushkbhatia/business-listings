import type { TradeKind } from "@/lib/db/generated/enums";

/**
 * Whether a trade is sold by the item or by the job — decision D5.
 *
 * `Category.tradeKind` is nullable and most rows are null, because null means
 * "inherit from the parent". That is what makes 440 rows setable in an
 * afternoon: a sector set once covers every child that does not disagree, and
 * only the disagreements are typed. It also means no caller may read the column
 * directly — a subcategory's own value is usually not its answer.
 *
 * WHY THIS IS NOT `sectorFor`
 *
 * `lib/taxonomy/sector.ts` walks `parentId` to the root and both planning
 * documents cite it as the precedent for this file. It is the precedent for the
 * *shape* and not for the work: it looks for the top of the tree and returns an
 * id, where this looks for the nearest ancestor holding a value and returns
 * that value — a different question, with a different stopping condition. And
 * it issues one `findUnique` per level, which is two round trips for a
 * two-level taxonomy and sixty times that if a caller asks about sixty
 * candidates. This loads the taxonomy once and walks it in memory.
 *
 * 440 rows of three small columns is about 20 KB. Resolving one id and
 * resolving every id cost the same query.
 *
 * Pure, with no database import, so the inheritance rule is unit-tested the way
 * `lib/enquiry/fanout.ts` is: the query half lives in `./service.ts` and the
 * rule lives here. The `unit` project runs under jsdom and does not stub
 * `server-only`, so a rule that imported Prisma could only ever be tested with
 * a database standing behind it.
 */

/** The three columns the walk needs, and nothing else. */
export interface TradeKindRow {
  id: string;
  parentId: string | null;
  tradeKind: TradeKind | null;
}

/**
 * What a tree with nothing set anywhere resolves to.
 *
 * `goods` rather than null, because it is what every surface assumed before the
 * column existed: the setup hub counts products, the storefront heads a section
 * "Catalogue", search offers an availability facet. An unset taxonomy must not
 * change what the site does, so the day this column ships and holds 440 nulls
 * the product behaves exactly as it did the day before.
 *
 * It lives here rather than as a column default deliberately. A default would
 * write `goods` into all 440 rows and the ops screen could then never tell a
 * sector somebody decided about from one nobody has opened — which is the whole
 * job that screen exists to do.
 */
export const DEFAULT_TRADE_KIND: TradeKind = "goods";

/** How far up the tree to walk before concluding the parents form a cycle. */
const MAX_DEPTH = 8;



/**
 * Resolve one category against an already-loaded taxonomy.
 *
 * Pure, so the inheritance rule is tested without a database. Returns the
 * nearest ancestor's value, or `DEFAULT_TRADE_KIND` when nothing on the chain
 * has one — including when the id is not in the map at all, which is the same
 * answer for the same reason.
 */
export function resolveTradeKind(
  rows: ReadonlyMap<string, TradeKindRow>,
  categoryId: string,
): TradeKind {
  let current: string | null = categoryId;
  for (let depth = 0; depth < MAX_DEPTH && current; depth += 1) {
    const row: TradeKindRow | undefined = rows.get(current);
    if (!row) break;
    if (row.tradeKind !== null) return row.tradeKind;
    current = row.parentId;
  }
  return DEFAULT_TRADE_KIND;
}

/**
 * Whether this category was answered on its own row, inherited, or never set.
 *
 * Three states rather than two, because the ops screen has to show the
 * difference. `inherited` carries the ancestor it came from so the screen can
 * name it — "from Logistics & freight forwarding" is a reason to leave a row
 * alone; a bare "services" is not.
 */
export type TradeKindOrigin =
  | { kind: TradeKind; from: "own" }
  | { kind: TradeKind; from: "inherited"; ancestorId: string }
  | { kind: TradeKind; from: "default" };

/** `resolveTradeKind`, with where the answer came from. */
export function tradeKindOrigin(
  rows: ReadonlyMap<string, TradeKindRow>,
  categoryId: string,
): TradeKindOrigin {
  let current: string | null = categoryId;
  for (let depth = 0; depth < MAX_DEPTH && current; depth += 1) {
    const row: TradeKindRow | undefined = rows.get(current);
    if (!row) break;
    if (row.tradeKind !== null) {
      return current === categoryId
        ? { kind: row.tradeKind, from: "own" }
        : { kind: row.tradeKind, from: "inherited", ancestorId: current };
    }
    current = row.parentId;
  }
  return { kind: DEFAULT_TRADE_KIND, from: "default" };
}

/**
 * A resolution that reached the root without finding a value.
 *
 * Board `4d-s` AC2: the root fallback "is a data defect, not a valid state, and
 * it should be visible". Returned rather than logged from in here, because this
 * module is pure and a resolver that writes to a log is a resolver that cannot
 * be called from a test or a render without a side effect. `tradeKindOrigin`
 * reports `from: "default"` and the screen counts them; `loadTradeKindBoard`
 * turns that count into the figure ops acts on.
 *
 * It is expected and harmless on the day the column ships, when every row is
 * null. It stops being either once the 13 sectors are set.
 */
export const ROOT_FALLBACK: TradeKindOrigin["from"] = "default";
