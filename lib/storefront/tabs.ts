/**
 * Which tabs a storefront has — one definition for the header, the routes and
 * the sitemap.
 *
 * Pure, so the rule is tested without a database and imported by all three
 * without dragging Prisma along. The sitemap already learned why there must be
 * one: it once submitted `/b/:slug/reviews` for sellers whose only reviews were
 * held, because it asked the question a second way. A tab the header hides and
 * a URL the sitemap submits are the same question.
 *
 * ## Board `1d-s`
 *
 * **B1 — a services business has no catalogue tab.** Not a disabled one and not
 * an empty one: the tab does not exist. A greyed tab tells a buyer something is
 * missing; four tabs tell them nothing is. That holds even when leftover product
 * rows exist — a firm that declared it sells work has said what its storefront
 * is, and a stale catalogue from before the declaration is not the page.
 *
 * **B2 — `both` gets both tabs**, catalogue and services, separately.
 *
 * **Credentials are a tab with a count** for anyone who sells work. A goods
 * seller's certificates are board 3e's documents, rendered as a section, and
 * are not this table.
 *
 * Every other tab keeps board 1d's criterion 9: hidden at zero, never empty.
 */

export type SellsKindValue = "unset" | "goods" | "services" | "both";

export type StorefrontTabKey =
  | "overview"
  | "products"
  | "services"
  | "credentials"
  | "branches"
  | "reviews";

export interface StorefrontTabCounts {
  products: number;
  services: number;
  credentials: number;
  locations: number;
  reviews: number;
}

/** Whether this business sells work — the half of the fork `1d-s` redraws. */
export function sellsWork(kind: SellsKindValue): boolean {
  return kind === "services" || kind === "both";
}

/** Whether this business has a catalogue at all — B1. */
export function sellsGoods(kind: SellsKindValue): boolean {
  return kind !== "services";
}

/** The visible tabs, in the order the row draws them. Overview is always first. */
export function storefrontTabs(
  kind: SellsKindValue,
  counts: StorefrontTabCounts,
): StorefrontTabKey[] {
  const tabs: StorefrontTabKey[] = ["overview"];
  if (sellsGoods(kind) && counts.products > 0) tabs.push("products");
  if (counts.services > 0) tabs.push("services");
  if (sellsWork(kind) && counts.credentials > 0) tabs.push("credentials");
  if (counts.locations > 0) tabs.push("branches");
  if (counts.reviews > 0) tabs.push("reviews");
  return tabs;
}

/** The tabs with a route of their own, for the sitemap. Overview is the page. */
export function tabRoutes(
  kind: SellsKindValue,
  counts: StorefrontTabCounts,
): Exclude<StorefrontTabKey, "overview">[] {
  return storefrontTabs(kind, counts).filter(
    (tab): tab is Exclude<StorefrontTabKey, "overview"> => tab !== "overview",
  );
}
