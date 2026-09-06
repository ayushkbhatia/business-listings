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
    /*
       Overview heads the storefront group rather than sitting in a group of
       its own, which is how board 8a's render draws it — a one-item group is a
       heading with nothing to organise, and it cost the rail a whole row of
       vertical space to say "Overview" twice.

       No `setup` row, deliberately. Board 8a: the hub is a temporary surface
       and a permanent nav entry for it would still be there a year later
       reading "nothing left". It is reached from the banner on the overview and
       from the strength figure in the sidebar footer — both of which disappear
       at a hundred per cent, as does the route itself, which redirects once the
       last task lands. A nav row cannot disappear without the nav lying about
       its own shape.
    */
    key: "storefront",
    labelKey: "nav.group.storefront",
    items: [
      { key: "dashboard", labelKey: "nav.dashboard", href: "/dashboard" },
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
      /*
         Board 1g. In `demand` rather than `catalogue`, because an unanswered
         question is a buyer waiting with their intent already written down —
         the same thing a lead is, arriving by a different door.
      */
      { key: "questions", labelKey: "nav.questions", href: "/dashboard/questions" },
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
      { key: "domain", labelKey: "nav.domain", href: "/dashboard/domain", capability: "billing.manage" },
      { key: "team", labelKey: "nav.team", href: "/dashboard/team", capability: "team.manage" },
      /*
         No capability. Board 7e §1 gives every seat its own contact channels
         here, and a sales seat that cannot reach the screen can never verify a
         number — which makes it permanently unroutable, and the routing rule on
         board 7d permanently unfixable from the seat it applies to. The
         business-wide half of the screen is gated inside it, and `saveAlerts`
         asserts `routing.manage` again, because a server action is a URL.
      */
      { key: "settings", labelKey: "nav.settings", href: "/dashboard/settings" },
    ],
  },
];

/**
 * /admin — staff. Seven groups covering every route in the docs/routes.md admin
 * block, plus `/admin/invoices`, which the handoff-4 README names and the route
 * table did not.
 *
 * It carried twenty of the thirty-one and three invented badge counts —
 * `badge: 34` on the queue, `3` on reports, `5` on dunning — which were
 * placeholders from before there was anything to count. They are gone. A
 * fabricated number on a queue is the same lie as a fabricated response time,
 * and this one sits on the screen whose entire job is saying what is behind.
 * Real counts come from `getAdminNavBadges`.
 *
 * Every item except the console overview is still `later`: named, not linked,
 * so the shape is visible and nothing is a dead link. Each step of handoff 4
 * drops `later` from the rows it builds.
 */
/**
 * The capability that gates one nav key, or undefined where nothing does.
 *
 * Declared once, in the nav, and read by anything else that shows a number
 * pointing at a screen. The console overview links every count to the queue
 * that fixes it, and a link an ops lead follows into a 404 is what happens when
 * the two lists are maintained separately — which they were, until the revenue
 * screens made `/admin/dunning` real and finance-only.
 */
export function capabilityForNavKey(
  key: string,
  groups: readonly NavGroup[] = ADMIN_NAV,
): Capability | undefined {
  for (const group of groups) {
    for (const item of group.items) {
      if (item.key === key) return item.capability;
    }
  }
  return undefined;
}

export const ADMIN_NAV: readonly NavGroup[] = [
  {
    key: "overview",
    labelKey: "nav.group.overview",
    items: [
      { key: "admin", labelKey: "nav.platform", href: "/admin" },
      { key: "queue", labelKey: "nav.queue", href: "/admin/queue", capability: "queue.decide" },
      { key: "reports", labelKey: "nav.reports", href: "/admin/reports", capability: "report.resolve" },
      /*
         Ops lead alone. A moderator holds `report.resolve` and sees the row
         above; removing a buyer's published words is held one rung higher, so
         this row is absent for them entirely rather than linking into a 404.
      */
      { key: "reviews", labelKey: "nav.reviews", href: "/admin/reviews", capability: "review.remove" },
      /* Same rung as reviews, and gated on its own capability so the matrix
         answers for it rather than the screen. */
      { key: "questions", labelKey: "nav.questions", href: "/admin/questions", capability: "question.remove" },
    ],
  },
  {
    key: "supply",
    labelKey: "nav.group.supply",
    items: [
      { key: "businesses", labelKey: "nav.businesses", href: "/admin/businesses" },
      { key: "ingest", labelKey: "nav.ingest", href: "/admin/ingest", capability: "queue.decide" },
      { key: "dedupe", labelKey: "nav.dedupe", href: "/admin/ingest/dedupe", capability: "business.merge" },
      /*
         Board 12i. `queue.decide` because that is what the screen and
         `lib/catalogue-import/service.ts` both assert; gating the row any
         narrower would show a moderator a link into their own `notFound()`,
         which is the defect `/admin/dunning` produced for an ops lead.

         In `supply` rather than `taxonomy`, where docs/routes.md lists the
         route. What waits here is one seller's price list needing somebody to
         key it in — the same intake job as the two rows above, not a decision
         about the shape of the catalogue.
      */
      {
        key: "catalogue-imports",
        labelKey: "nav.catalogue_imports",
        href: "/admin/catalogue-imports",
        capability: "queue.decide",
      },
      { key: "crm", labelKey: "nav.crm", href: "/admin/crm" },
    ],
  },
  {
    key: "taxonomy",
    labelKey: "nav.group.taxonomy",
    items: [
      { key: "categories", labelKey: "nav.categories", href: "/admin/categories", capability: "taxonomy.write" },
      { key: "spec-library", labelKey: "nav.spec_library", href: "/admin/spec-library", capability: "taxonomy.write" },
      { key: "areas", labelKey: "nav.areas", href: "/admin/areas", capability: "taxonomy.write", later: true },
      { key: "attributes", labelKey: "nav.attributes", href: "/admin/attributes", capability: "taxonomy.write", later: true },
    ],
  },
  {
    key: "demand",
    labelKey: "nav.group.demand",
    items: [
      { key: "search", labelKey: "nav.search_ranking", href: "/admin/search", capability: "search.ranking.write" },
      {
        key: "storefront-templates",
        labelKey: "nav.storefront_templates",
        href: "/admin/storefront-templates",
        capability: "storefront.template.write",
      },
    ],
  },
  {
    key: "commercial",
    labelKey: "nav.group.commercial",
    items: [
      { key: "subscriptions", labelKey: "nav.subscriptions", href: "/admin/subscriptions", capability: "revenue.read" },
      { key: "revenue", labelKey: "nav.revenue", href: "/admin/revenue", capability: "revenue.read" },
      { key: "plans", labelKey: "nav.plans", href: "/admin/plans", capability: "plan.entitlements.write" },
      { key: "invoices", labelKey: "nav.invoices", href: "/admin/invoices", capability: "subscription.credit" },
      { key: "dunning", labelKey: "nav.dunning", href: "/admin/dunning", capability: "revenue.read" },
      { key: "tax", labelKey: "nav.tax", href: "/admin/tax", capability: "revenue.read" },
    ],
  },
  /*
     Board 6f §1. The page matrix was filed under DEMAND, between search
     ranking and storefront templates, and the four screens that report into it
     were scattered across two other groups — so the board that decides which
     eight thousand pages exist was three headings away from the queues it
     works. Four items, in the order the header's tabs list them.

     The rest of what was one CONTENT group stays together as EDITORIAL:
     notification templates, the string catalogue, attribution, homepage
     curation and testimonials are not SEO, and folding them in would have made
     an eight-row group whose heading was true of half of it.
  */
  {
    key: "content-seo",
    labelKey: "nav.group.content_seo",
    items: [
      { key: "content", labelKey: "nav.content", href: "/admin/content/matrix", capability: "taxonomy.write" },
      { key: "content-lists", labelKey: "nav.content_lists", href: "/admin/content/lists", capability: "taxonomy.write" },
      { key: "content-guides", labelKey: "nav.content_guides", href: "/admin/content/guides", capability: "taxonomy.write" },
      { key: "content-guide-subjects", labelKey: "nav.content_guide_subjects", href: "/admin/content/guide-subjects", capability: "taxonomy.write" },
      { key: "content-redirects", labelKey: "nav.content_redirects", href: "/admin/content/redirects", capability: "taxonomy.write" },
    ],
  },
  {
    key: "content",
    labelKey: "nav.group.content",
    items: [
      { key: "notifications", labelKey: "nav.notifications", href: "/admin/notifications", capability: "taxonomy.write" },
      { key: "strings", labelKey: "nav.strings", href: "/admin/strings", capability: "taxonomy.write" },
      { key: "content-attribution", labelKey: "nav.content_attribution", href: "/admin/content/attribution", capability: "taxonomy.write" },
      { key: "content-home", labelKey: "nav.content_home", href: "/admin/content/home", capability: "taxonomy.write" },
      { key: "content-testimonials", labelKey: "nav.content_testimonials", href: "/admin/content/testimonials", capability: "taxonomy.write" },
    ],
  },
  {
    key: "platform",
    labelKey: "nav.group.platform",
    items: [
      { key: "staff", labelKey: "nav.staff", href: "/admin/staff", capability: "staff.manage", later: true },
      { key: "audit", labelKey: "nav.audit", href: "/admin/audit", capability: "audit.read" },
      { key: "support", labelKey: "nav.support", href: "/admin/support", capability: "support.view_as" },
      { key: "users", labelKey: "nav.users", href: "/admin/users", capability: "staff.manage", later: true },
      { key: "compliance", labelKey: "nav.compliance", href: "/admin/compliance", capability: "staff.manage", later: true },
      { key: "api", labelKey: "nav.api", href: "/admin/api", capability: "staff.manage", later: true },
    ],
  },
];

