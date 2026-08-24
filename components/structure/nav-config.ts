import type { Capability } from "@/lib/auth/capabilities";

/**
 * The sidebar is one component driven by a config, not two copies. Dashboard
 * and admin differ in their data, not their code.
 *
 * `capability` gates an item. An item the actor cannot use is rendered locked
 * rather than removed — a staff member needs to know a queue exists before
 * they can ask for access, and a seller cannot want what they cannot see.
 */
export interface NavItem {
  key: string;
  /** Catalogue key. Resolved through t() at render, never a literal. */
  labelKey: string;
  href: string;
  /** Count badge. A live number, not a dot. */
  badge?: number;
  capability?: Capability;
  /** Named in docs/routes.md but 404 until its handoff. */
  later?: boolean;
}

export interface NavGroup {
  key: string;
  labelKey: string;
  items: readonly NavItem[];
}

/**
 * The same shape with its labels already resolved.
 *
 * AppSidebar is a client component and a server page cannot hand a client
 * component a function, so `translate` cannot cross that boundary. Rather than
 * make the sidebar import t() — which is what the config exists to avoid — the
 * caller resolves the labels once and passes strings, as every other component
 * in this codebase receives them.
 */
export interface ResolvedNavItem extends Omit<NavItem, "labelKey"> {
  label: string;
}

export interface ResolvedNavGroup extends Omit<NavGroup, "labelKey" | "items"> {
  label: string;
  items: readonly ResolvedNavItem[];
}

/**
 * @param badges Live counts by item key, overriding whatever the config holds.
 *   A badge is a promise about what is behind the link; a placeholder that says
 *   7 above a page listing 2 is worse than no badge at all. Pass a count for
 *   every item whose screen exists, and delete the placeholder from the config
 *   as each one lands.
 */
export function resolveNav(
  groups: readonly NavGroup[],
  translate: (key: string) => string,
  badges: Readonly<Record<string, number>> = {},
): ResolvedNavGroup[] {
  return groups.map(({ labelKey, items, ...group }) => ({
    ...group,
    label: translate(labelKey),
    items: items.map(({ labelKey: itemKey, ...item }) => ({
      ...item,
      label: translate(itemKey),
      ...(item.key in badges ? { badge: badges[item.key] } : {}),
    })),
  }));
}

/**
 * /dashboard — seller. Six groups, matching docs/routes.md.
 *
 * Four screens exist: leads, quotes, reviews and settings. Everything else is
 * marked `later`, which renders it named but not linked — the rule handoff 1
 * set and AppSidebar already implements. It was not applied here, so the
 * sidebar carried a dozen dead links; a browser test signed in as a seller
 * found them the first time one existed.
 */
export const DASHBOARD_NAV: readonly NavGroup[] = [
  {
    key: "overview",
    labelKey: "nav.group.overview",
    items: [
      { key: "dashboard", labelKey: "nav.dashboard", href: "/dashboard" },
      { key: "setup", labelKey: "nav.setup", href: "/dashboard/setup" , later: true },
    ],
  },
  {
    key: "listing",
    labelKey: "nav.group.listing",
    items: [
      { key: "listing", labelKey: "nav.listing", href: "/dashboard/listing", capability: "listing.edit" },
      { key: "locations", labelKey: "nav.locations", href: "/dashboard/locations", capability: "listing.edit" },
      { key: "hours", labelKey: "nav.hours", href: "/dashboard/hours", capability: "listing.edit" },
      { key: "verification", labelKey: "nav.verification", href: "/dashboard/verification" },
    ],
  },
  {
    key: "catalogue",
    labelKey: "nav.group.catalogue",
    items: [
      { key: "products", labelKey: "nav.products", href: "/dashboard/products", capability: "product.edit" },
      { key: "media", labelKey: "nav.media", href: "/dashboard/media", capability: "listing.edit" },
    ],
  },
  {
    key: "demand",
    labelKey: "nav.group.demand",
    items: [
      // No placeholder counts: these two screens exist, so the shell passes
      // the real numbers through resolveNav.
      { key: "leads", labelKey: "nav.leads", href: "/dashboard/leads", capability: "enquiry.respond" },
      { key: "quotes", labelKey: "nav.quotes", href: "/dashboard/quotes", capability: "quote.send" },
      { key: "reviews", labelKey: "nav.reviews", href: "/dashboard/reviews" },
    ],
  },
  {
    key: "growth",
    labelKey: "nav.group.growth",
    items: [
      { key: "analytics", labelKey: "nav.analytics", href: "/dashboard/analytics" },
      { key: "promote", labelKey: "nav.promote", href: "/dashboard/promote" },
    ],
  },
  {
    key: "account",
    labelKey: "nav.group.account",
    items: [
      { key: "billing", labelKey: "nav.billing", href: "/dashboard/billing", capability: "billing.manage" },
      { key: "team", labelKey: "nav.team", href: "/dashboard/team", capability: "team.manage" },
      { key: "settings", labelKey: "nav.settings", href: "/dashboard/settings" },
    ],
  },
];

/**
 * /admin — staff. Six groups, per docs/routes.md.
 *
 * None of it is built; the admin surface is handoff 4. Every item is `later`
 * so the shape is visible and nothing is a dead link.
 */
export const ADMIN_NAV: readonly NavGroup[] = [
  {
    key: "overview",
    labelKey: "nav.group.overview",
    items: [
      { key: "admin", labelKey: "nav.platform", href: "/admin" , later: true },
      { key: "queue", labelKey: "nav.queue", href: "/admin/queue", badge: 34, capability: "queue.decide" , later: true },
      { key: "reports", labelKey: "nav.reports", href: "/admin/reports", badge: 3, capability: "report.resolve" , later: true },
    ],
  },
  {
    key: "supply",
    labelKey: "nav.group.supply",
    items: [
      { key: "businesses", labelKey: "nav.businesses", href: "/admin/businesses" , later: true },
      { key: "ingest", labelKey: "nav.ingest", href: "/admin/ingest" , later: true },
      { key: "visits", labelKey: "nav.visits", href: "/admin/visits", capability: "visit.record" , later: true },
      { key: "crm", labelKey: "nav.crm", href: "/admin/crm" , later: true },
    ],
  },
  {
    key: "taxonomy",
    labelKey: "nav.group.taxonomy",
    items: [
      { key: "categories", labelKey: "nav.categories", href: "/admin/categories", capability: "taxonomy.write" , later: true },
      { key: "spec-library", labelKey: "nav.spec_library", href: "/admin/spec-library", capability: "taxonomy.write" , later: true },
      { key: "areas", labelKey: "nav.areas", href: "/admin/areas", capability: "taxonomy.write" , later: true },
      { key: "attributes", labelKey: "nav.attributes", href: "/admin/attributes", later: true },
    ],
  },
  {
    key: "demand",
    labelKey: "nav.group.demand",
    items: [
      { key: "search", labelKey: "nav.search_ranking", href: "/admin/search" , later: true },
      { key: "content", labelKey: "nav.content", href: "/admin/content/matrix" , later: true },
    ],
  },
  {
    key: "commercial",
    labelKey: "nav.group.commercial",
    items: [
      { key: "subscriptions", labelKey: "nav.subscriptions", href: "/admin/subscriptions", capability: "revenue.read" , later: true },
      { key: "revenue", labelKey: "nav.revenue", href: "/admin/revenue", capability: "revenue.read" , later: true },
      { key: "dunning", labelKey: "nav.dunning", href: "/admin/dunning", badge: 5, capability: "revenue.read" , later: true },
    ],
  },
  {
    key: "platform",
    labelKey: "nav.group.platform",
    items: [
      { key: "staff", labelKey: "nav.staff", href: "/admin/staff", capability: "staff.manage" , later: true },
      { key: "audit", labelKey: "nav.audit", href: "/admin/audit", capability: "audit.read" , later: true },
      { key: "support", labelKey: "nav.support", href: "/admin/support", capability: "support.view_as" , later: true },
      { key: "compliance", labelKey: "nav.compliance", href: "/admin/compliance" , later: true },
    ],
  },
];
