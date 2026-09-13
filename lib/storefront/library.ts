import { resolveTradeKind, type TradeKindRow } from "@/lib/taxonomy/trade-kind";
import { SECTION_TYPES, type SectionType, type TradeScope } from "./section-types";

/**
 * The section library, filtered by trade kind — board `5c-s`. Pure.
 *
 * Everywhere else the platform decides what renders. A template is where staff
 * compose freely, so every decision the storefront pages made has to be made
 * again here, or it can be put back by adding a section: the map `1f-s` took
 * out, the catalogue `1d-s` took out, the product grid on a firm with nothing
 * to put in it.
 *
 * ## The one rule
 *
 * A type is **available** to a template when it is shared, or when the
 * template governs a listing of its kind. Everything else is **unavailable**
 * and is listed with its reason rather than filtered out (B1). A type waiting
 * on a decision is **held**, and is listed with the decision.
 */

/** What one listing sells, as far as a section is concerned. */
export type ListingKind = "goods" | "services";

/**
 * Whether a type can be populated for a template of this scope.
 *
 * `both` sees both sets with neither marked unavailable (B9).
 */
export function isAvailable(type: Pick<SectionType, "availableFor">, scope: TradeScope): boolean {
  return type.availableFor === "both" || scope === "both" || type.availableFor === scope;
}

/**
 * Whether a section renders for one listing on the public page.
 *
 * The template can hold a scope grid and a catalogue grid at once — a sector
 * whose stores sell either — and each storefront shows the half it has
 * something for. `unset` is a listing that has not said, which the rest of the
 * site treats as goods (`lib/taxonomy/trade-kind.ts` `DEFAULT_TRADE_KIND`).
 */
export function rendersFor(
  type: Pick<SectionType, "availableFor">,
  sellsKind: "unset" | "goods" | "services" | "both",
): boolean {
  if (type.availableFor === "both" || sellsKind === "both") return true;
  if (type.availableFor === "services") return sellsKind === "services";
  return sellsKind !== "services";
}

/** The union of what a set of listings sells. Empty is goods, for the same reason `unset` is. */
export function scopeOf(kinds: Iterable<TradeScope>): TradeScope {
  let goods = false;
  let services = false;
  for (const kind of kinds) {
    if (kind === "goods" || kind === "both") goods = true;
    if (kind === "services" || kind === "both") services = true;
  }
  if (goods && services) return "both";
  return services ? "services" : "goods";
}

/**
 * What a sector template governs, from the taxonomy and from its stores.
 *
 * **The leaves of the sector, resolved.** A sector's own `tradeKind` is not its
 * answer when its children disagree — `4d-s` classified 169 services
 * subcategories, many under goods sectors — and a listing is filed under a
 * subcategory, so the leaves are where a listing's kind comes from. A sector
 * with no children answers for itself.
 *
 * **And what its published stores have said.** A seller may overrule the
 * taxonomy in `2b-s`; a firm that sells work filed under a goods sector is still
 * a storefront this template governs, and a library that offered it nothing
 * would be wrong about a real page. `unset` says nothing and counts for
 * nothing.
 */
export function templateScope(
  taxonomy: ReadonlyMap<string, TradeKindRow>,
  sectorId: string,
  storeKinds: readonly ("unset" | "goods" | "services" | "both")[],
): TradeScope {
  const children = new Map<string, string[]>();
  for (const row of taxonomy.values()) {
    if (!row.parentId) continue;
    const list = children.get(row.parentId) ?? [];
    list.push(row.id);
    children.set(row.parentId, list);
  }

  const leaves: string[] = [];
  const stack = [sectorId];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const id = stack.pop()!;
    // A parent cycle is a data defect `trade-kind.ts` already bounds; here it
    // must not be an infinite loop.
    if (seen.has(id)) continue;
    seen.add(id);
    const below = children.get(id) ?? [];
    if (below.length === 0) leaves.push(id);
    else stack.push(...below);
  }

  const kinds: TradeScope[] = leaves.map((id) => resolveTradeKind(taxonomy, id));
  for (const kind of storeKinds) if (kind !== "unset") kinds.push(kind);
  return scopeOf(kinds);
}

export type LibraryGroupKey = "services" | "goods" | "shared" | "unavailable";

export type LibraryState = "available" | "in_use" | "held" | "unavailable";

export interface LibraryEntry {
  type: SectionType;
  state: LibraryState;
  /** Whether the template already carries one, whatever the state. */
  inUse: boolean;
  /** The reason line, where the state has one. */
  reasonKey: string | null;
}

export interface LibraryGroup {
  key: LibraryGroupKey;
  entries: LibraryEntry[];
}

/**
 * The library as the screen lists it: grouped, in order, every type present.
 *
 * - **services** — *For service listings*, first on a services template
 * - **goods** — *For product listings*, first on a goods one
 * - **shared** — shared in layout, not in copy (B5)
 * - **unavailable** — *Unavailable here*, disabled with the reason (B1)
 *
 * A `both` template gets the goods and services groups labelled and no
 * unavailable group (B9). Fixed types are chrome, not a choice, and are not
 * listed.
 */
export function sectionLibrary(
  scope: TradeScope,
  inUse: readonly { type: string }[],
): LibraryGroup[] {
  const used = new Set(inUse.map((section) => section.type));

  const entry = (type: SectionType): LibraryEntry => {
    const present = used.has(type.key);
    if (!isAvailable(type, scope)) {
      return { type, state: "unavailable", inUse: present, reasonKey: type.unavailableKey };
    }
    if (type.heldKey) return { type, state: "held", inUse: present, reasonKey: type.heldKey };
    return { type, state: present ? "in_use" : "available", inUse: present, reasonKey: null };
  };

  const listed = SECTION_TYPES.filter((type) => !type.fixed).map(entry);
  const of = (predicate: (entry: LibraryEntry) => boolean): LibraryEntry[] =>
    listed.filter(predicate);

  const services = of((e) => e.type.availableFor === "services" && e.state !== "unavailable");
  const goods = of((e) => e.type.availableFor === "goods" && e.state !== "unavailable");
  const shared = of((e) => e.type.availableFor === "both");
  const unavailable = of((e) => e.state === "unavailable");

  const groups: LibraryGroup[] =
    scope === "services"
      ? [
          { key: "services", entries: services },
          { key: "shared", entries: shared },
          { key: "unavailable", entries: unavailable },
        ]
      : scope === "goods"
        ? [
            { key: "goods", entries: goods },
            { key: "shared", entries: shared },
            { key: "unavailable", entries: unavailable },
          ]
        : [
            { key: "goods", entries: goods },
            { key: "services", entries: services },
            { key: "shared", entries: shared },
          ];

  return groups.filter((group) => group.entries.length > 0);
}

/** What the builder's add list may offer: available, and not a singleton already there. */
export function addableTypes(scope: TradeScope, inUse: readonly { type: string }[]): SectionType[] {
  return sectionLibrary(scope, inUse)
    .flatMap((group) => group.entries)
    .filter((entry) => entry.state === "available" || (entry.state === "in_use" && !entry.type.singleton))
    .map((entry) => entry.type);
}

/** Types that are listed for this scope and cannot be added — held or unavailable. */
export function refusedCount(scope: TradeScope): number {
  return sectionLibrary(scope, [])
    .flatMap((group) => group.entries)
    .filter((entry) => entry.state === "held" || entry.state === "unavailable").length;
}
