/**
 * Every route this product has, as a list you can click.
 *
 * `docs/routes.md` is the registry and it drifts — `/dashboard/questions` has
 * been built and in the nav since #68 and appears nowhere in it, while three
 * `/dashboard/setup/*` rows have been in it since handoff 3 and 404. Neither is
 * caught by anything, because nothing reads the file.
 *
 * This is not a second registry. It is a *rendered* one: the index marks every
 * row live or missing by asking the router, so the two lists disagree loudly
 * rather than quietly. Adding a row here that does not exist is how you record
 * that it should.
 *
 * No `t()`. This is a developer index of URLs, and a URL is not a translatable
 * string — the labels are the route names as the team says them out loud.
 */

export interface Surface {
  href: string;
  /** What is behind it, in one clause. */
  what: string;
  /** The board it came from, where there is one. */
  board?: string;
  /** Set where the route is named in docs/routes.md and does not exist yet. */
  planned?: boolean;
}

export interface SurfaceGroup {
  key: string;
  label: string;
  /** Which seat this group needs, matching a `SEAT_KINDS` key. */
  seat: string;
  surfaces: readonly Surface[];
}

export const SURFACE_GROUPS: readonly SurfaceGroup[] = [
  {
    key: "dev",
    label: "Developer surfaces",
    seat: "none",
    surfaces: [
      { href: "/dev/seat", what: "Sign in as any seat, on any business" },
      { href: "/dev/gallery", what: "Every component, in every documented state" },
      { href: "/dev/notifications", what: "Every notification template, rendered per channel" },
    ],
  },
  {
    key: "seller-setup",
    label: "Seller — after go-live",
    seat: "owner",
    surfaces: [
      { href: "/dashboard/setup", what: "The setup hub", board: "8a" },
      { href: "/dashboard/setup/photos", what: "Task 1, photos with guidance", board: "8b", planned: true },
      { href: "/dashboard/setup/products", what: "Task 2, template then first products", board: "8c", planned: true },
      { href: "/dashboard/setup/team", what: "Task 3, invite the team", board: "8d", planned: true },
    ],
  },
  {
    key: "seller",
    label: "Seller — dashboard",
    seat: "owner",
    surfaces: [
      { href: "/dashboard", what: "Overview: what needs a reply", board: "3a" },
      { href: "/dashboard/listing", what: "Listing profile", board: "3b" },
      { href: "/dashboard/locations", what: "Branches", board: "3c" },
      { href: "/dashboard/hours", what: "Trading hours" },
      { href: "/dashboard/verification", what: "Trade licence and tier" },
      { href: "/dashboard/products", what: "Catalogue", board: "3f" },
      { href: "/dashboard/products/import", what: "Spreadsheet import" },
      { href: "/dashboard/templates", what: "Spec templates" },
      { href: "/dashboard/media", what: "Media library", board: "3i" },
      { href: "/dashboard/leads", what: "Enquiries and RFQs", board: "3d" },
      { href: "/dashboard/quotes", what: "Quotes sent" },
      { href: "/dashboard/questions", what: "Buyer questions", board: "1g" },
      { href: "/dashboard/reviews", what: "Reviews and replies" },
      { href: "/dashboard/analytics", what: "Where enquiries come from" },
      { href: "/dashboard/promote", what: "Boosts and placements" },
      { href: "/dashboard/billing", what: "Subscription" },
      { href: "/dashboard/domain", what: "Custom domain" },
      { href: "/dashboard/team", what: "Seats, roles, lead routing", board: "7d" },
      { href: "/dashboard/settings", what: "Alerts and quiet hours" },
    ],
  },
  {
    key: "onboarding",
    label: "Seller — onboarding",
    seat: "owner",
    surfaces: [
      { href: "/onboarding/claim", what: "Find your listing", board: "2a" },
      { href: "/onboarding/verify", what: "Prove ownership", board: "2b" },
      { href: "/onboarding/profile", what: "Who you are", board: "2c" },
      { href: "/onboarding/locations", what: "Where you are — go-live", board: "2d" },
      { href: "/onboarding/plan", what: "Choose a plan, or stay on Free", board: "2e" },
    ],
  },
  {
    key: "admin",
    label: "Staff console",
    seat: "ops_lead",
    surfaces: [
      { href: "/admin", what: "Platform overview" },
      { href: "/admin/queue", what: "Moderation queue" },
      { href: "/admin/businesses", what: "Every listing" },
      { href: "/admin/reviews", what: "Reported reviews" },
      { href: "/admin/visits", what: "Site visit requests" },
      { href: "/admin/subscriptions", what: "Subscriptions" },
      { href: "/admin/revenue", what: "Revenue" },
      { href: "/admin/dunning", what: "Failed payments" },
      { href: "/admin/audit", what: "Audit log" },
      { href: "/admin/notifications", what: "Notification templates" },
      { href: "/admin/content/home", what: "Home page content" },
      { href: "/admin/spec-library", what: "Spec templates and fields" },
      { href: "/admin/storefront-templates", what: "Storefront templates" },
    ],
  },
  {
    key: "public",
    label: "Public",
    seat: "none",
    surfaces: [
      { href: "/", what: "Home" },
      { href: "/search", what: "Search results" },
      { href: "/pricing", what: "Plans" },
      { href: "/list-your-business", what: "Supplier entry point" },
      { href: "/for-buyers", what: "Buyer entry point" },
    ],
  },
];
