/**
 * Board `10d` — the comparison tray, as a value.
 *
 * Pure, with no database, no `cookies()` and no `document`, because three
 * places read and write it and they must agree to the byte: the server action
 * that changes it, the sticky tray that draws it on every public page, and
 * `/compare`, which falls back to it when a buyer opens the page with no `?p=`.
 *
 * ## Why a cookie, and why a session one
 *
 * The tray has to follow a buyer from a search to a storefront to a product
 * page — the fourth product is usually added from a page the first three were
 * not on. A query string dies at the first storefront link, so the tray lives
 * in a first-party cookie, `bl_cmp`, which the buyer's own tick writes and
 * nothing else does (`docs/telemetry.md` §4b).
 *
 * It is a **browser-session** cookie. The durable form of a comparison is its
 * URL — `/compare?p=…` is shareable and bookmarkable (`B10`) — so nothing a
 * buyer wants to keep depends on the cookie outliving the tab.
 *
 * It is readable by script because every public page that is statically
 * rendered still shows the tray: reading `cookies()` in a layout would make
 * every page in the group dynamic and throw away its cache.
 *
 * ## What it holds
 *
 * Ids, and just enough to draw the tray without a round trip: each product's
 * name and seller, and the one trade the comparison is in. The names are a
 * label, not a record — `/compare` reads every column fresh from the database —
 * so a product renamed after it was added reads its old name in the tray until
 * the buyer opens the comparison, and never anywhere that matters.
 */

/** B7 — the most columns a comparison holds. Enforced at add time. */
export const COMPARE_MAX = 4;

/** The cookie the tray lives in. */
export const COMPARE_COOKIE = "bl_cmp";

/** A name as stored in the cookie. Long enough to read, short enough to fit four. */
const NAME_MAX = 80;

export interface TrayItem {
  id: string;
  name: string;
  /** The seller's `displayName` — identity is never the trade name. */
  seller: string;
}

export interface TrayTrade {
  id: string;
  name: string;
}

export interface Tray {
  /** The one trade every item is in — B1's shared template. Null when empty. */
  trade: TrayTrade | null;
  items: TrayItem[];
}

export const EMPTY_TRAY: Tray = { trade: null, items: [] };

/** A cuid, loosely — the same bound `SPEC_KEY` uses in `lib/search/query.ts`. */
const ID = /^c[a-z0-9]{20,30}$/;

function clip(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > 0 ? trimmed.slice(0, NAME_MAX) : null;
}

/**
 * The tray a cookie holds, or an empty one.
 *
 * Takes the cookie's value **decoded** — JSON, as `serialiseTray` wrote it.
 * Next's cookie store percent-encodes on `set` and decodes on `get`, so the
 * server hands this JSON already; the browser reads `document.cookie` raw and
 * decodes once before calling (`_compare/store.ts`). Encoding here as well is
 * what once made the server read a tray the browser could not.
 *
 * Every field is checked rather than trusted. The cookie is readable and
 * writable by script, so a malformed one is a thing that happens — a stale
 * shape from an earlier deploy, or somebody's own experiment — and the answer
 * to any of it is an empty tray, never a thrown error on a public page.
 */
export function parseTray(json: string | undefined | null): Tray {
  if (!json) return EMPTY_TRAY;
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return EMPTY_TRAY;
  }
  if (typeof data !== "object" || data === null) return EMPTY_TRAY;
  const record = data as { trade?: unknown; items?: unknown };

  const tradeRecord = record.trade as { id?: unknown; name?: unknown } | null | undefined;
  const tradeId = typeof tradeRecord?.id === "string" && ID.test(tradeRecord.id) ? tradeRecord.id : null;
  const tradeName = clip(tradeRecord?.name);
  if (!tradeId || !tradeName) return EMPTY_TRAY;

  const seen = new Set<string>();
  const items: TrayItem[] = [];
  for (const entry of Array.isArray(record.items) ? record.items : []) {
    const item = entry as { id?: unknown; name?: unknown; seller?: unknown };
    if (typeof item.id !== "string" || !ID.test(item.id) || seen.has(item.id)) continue;
    const name = clip(item.name);
    const seller = clip(item.seller);
    if (!name || !seller) continue;
    seen.add(item.id);
    items.push({ id: item.id, name, seller });
    if (items.length === COMPARE_MAX) break;
  }
  return items.length > 0 ? { trade: { id: tradeId, name: tradeName }, items } : EMPTY_TRAY;
}

/**
 * The cookie value for a tray, as JSON. Empty trays are deleted, not stored.
 *
 * Not percent-encoded: the cookie store does that on the way out, once.
 */
export function serialiseTray(tray: Tray): string {
  return JSON.stringify({
    trade: tray.trade ? { id: tray.trade.id, name: tray.trade.name.slice(0, NAME_MAX) } : null,
    items: tray.items.slice(0, COMPARE_MAX).map((item) => ({
      id: item.id,
      name: item.name.slice(0, NAME_MAX),
      seller: item.seller.slice(0, NAME_MAX),
    })),
  });
}

export type AddOutcome =
  /** Added to a comparison already in this trade, or to an empty one. */
  | "added"
  /** Already in the tray — adding is idempotent. */
  | "already"
  /** B7 — four held, the fifth refused. The tray is unchanged. */
  | "full"
  /**
   * The product is in another trade, so it started a fresh comparison and the
   * old one is gone. One comparison, one trade: the heading sentence — *these
   * are genuinely the same fields* — is only true inside one template.
   */
  | "replaced";

export interface AddResult {
  outcome: AddOutcome;
  tray: Tray;
  /** For `replaced`: how many products the old comparison held. */
  dropped: number;
}

/**
 * B7 and the one-trade rule, in the order they are decided.
 *
 * Trade first, then the cap: a fifth product from another trade is not refused
 * for a full tray it would not have joined — it starts a new comparison, which
 * is what the tick said it would do before it was pressed.
 */
export function addToTray(tray: Tray, item: TrayItem, trade: TrayTrade): AddResult {
  if (tray.items.some((held) => held.id === item.id)) {
    return { outcome: "already", tray, dropped: 0 };
  }
  if (tray.trade && tray.trade.id !== trade.id && tray.items.length > 0) {
    return { outcome: "replaced", tray: { trade, items: [item] }, dropped: tray.items.length };
  }
  if (tray.items.length >= COMPARE_MAX) {
    return { outcome: "full", tray, dropped: 0 };
  }
  return { outcome: "added", tray: { trade, items: [...tray.items, item] }, dropped: 0 };
}

/** What one change to the tray did — returned to the tick, and read by the tray's notice. */
export type CompareOutcome = AddOutcome | "removed" | "cleared" | "unavailable";

export interface CompareChange {
  outcome: CompareOutcome;
  tray: Tray;
  /** For `replaced`: how many products the comparison it replaced held. */
  dropped: number;
  /** The product the change was about. */
  productId: string | null;
}

export type CompareIntent = "add" | "remove" | "clear";

export function isCompareIntent(value: unknown): value is CompareIntent {
  return value === "add" || value === "remove" || value === "clear";
}

export function removeFromTray(tray: Tray, id: string): Tray {
  const items = tray.items.filter((item) => item.id !== id);
  return items.length > 0 ? { trade: tray.trade, items } : EMPTY_TRAY;
}

/**
 * What a tick should offer for one product, given the tray.
 *
 * Decided here rather than in the component so the server-rendered tick, the
 * hydrated one and the action that runs when it is pressed read one rule.
 */
export type TickState =
  | { kind: "in" }
  | { kind: "add" }
  /** Another trade: pressing it starts a new comparison, and the label says so first. */
  | { kind: "switch"; heldTrade: string; held: number }
  /** B7: full, and this one is not in it. Disabled, naming what is held. */
  | { kind: "full"; held: readonly TrayItem[] };

export function tickState(tray: Tray, productId: string, tradeId: string): TickState {
  if (tray.items.some((item) => item.id === productId)) return { kind: "in" };
  if (tray.trade && tray.items.length > 0 && tray.trade.id !== tradeId) {
    return { kind: "switch", heldTrade: tray.trade.name, held: tray.items.length };
  }
  if (tray.items.length >= COMPARE_MAX) return { kind: "full", held: tray.items };
  return { kind: "add" };
}

/** The shareable URL for a set of products, in the order the buyer chose them. */
export function compareHref(ids: readonly string[]): string {
  return ids.length > 0 ? `/compare?p=${ids.join(",")}` : "/compare";
}

/**
 * `?p=` as ids — B10, the set a comparison URL carries.
 *
 * Deduplicated and shape-checked in the order written. Anything that is not an
 * id is dropped here rather than reaching a query, which is the same refusal
 * `SPEC_KEY` makes for the search facets: a URL parameter nobody defined must
 * not become a lookup.
 *
 * Capped at `COMPARE_MAX`, and **the cap is counted rather than silent** (`B7`):
 * a hand-edited or old link carrying six products renders the first four and
 * says two were left out, rather than showing four and letting the buyer think
 * that was the set.
 */
export function idsFromParam(value: string | string[] | undefined): { ids: string[]; overflow: number } {
  if (!value) return { ids: [], overflow: 0 };
  const seen: string[] = [];
  for (const part of (Array.isArray(value) ? value : [value]).flatMap((entry) => entry.split(","))) {
    const id = part.trim();
    if (!ID.test(id) || seen.includes(id)) continue;
    seen.push(id);
    /* A bound on the work a URL can ask for, well past any real comparison. */
    if (seen.length === 20) break;
  }
  return { ids: seen.slice(0, COMPARE_MAX), overflow: Math.max(0, seen.length - COMPARE_MAX) };
}
