import { EMIRATES } from "@/lib/uae";

/**
 * Board 13e — what a maintenance window can say is down, and what each claim
 * takes down.
 *
 * ## One record, two readers
 *
 * The page's status table is a set of claims: *Search and filters — DOWN*,
 * *Quotes already in flight — RUNNING*. The handoff calls the second of those
 * "a claim about the architecture, and it has to stay true". A table authored
 * separately from what the proxy actually refuses would drift the first time
 * somebody edited one and not the other — a row reading RUNNING over a route
 * serving 503 is exactly the lie the page exists to avoid.
 *
 * So a row is not free text. It names a system from this vocabulary, and the
 * system owns its routes here. The proxy takes down the routes of every system
 * the window marks down, and nothing else; the page renders the same list. The
 * two cannot disagree because there is only one list.
 *
 * ## Why four
 *
 * These are the four rows board 13e draws. A window that needs to say something
 * else — storefronts, sign-in — adds a system here, with its routes and its
 * label in `en.ts`, in a change somebody reviews. Free-text rows would skip the
 * review and the translation both (B7: every string through `t()`).
 *
 * `notifications` owns no page. The notification job runs from `/api/jobs/*`,
 * which no window ever intercepts — that is what makes *Seller notifications —
 * RUNNING* true while the pages are down.
 */

export const SYSTEMS = ["search", "requirements", "quotes", "notifications"] as const;
export type SystemKey = (typeof SYSTEMS)[number];

export const SYSTEM_STATES = ["down", "running"] as const;
export type SystemState = (typeof SYSTEM_STATES)[number];

/**
 * Route prefixes, matched on a whole segment: `/c` owns `/c` and `/c/valves`,
 * never `/cookies`.
 *
 * `search` carries every page that reads the search index — `lib/search` or
 * `lib/db/queries/search` — which is `/search`, both category shelves, the
 * comparison tray, the curated lists and both landing-page classes. The landing
 * pages sit at `/:emirate/...`, so the emirate values are the prefixes.
 *
 * `quotes` carries both sides of an enquiry already sent: the buyer's tracking,
 * thread, comparison and accepted record, and the seller's leads and quotes.
 */
export const SYSTEM_ROUTES: Readonly<Record<SystemKey, readonly string[]>> = {
  search: ["/search", "/c", "/categories", "/compare", "/best", ...EMIRATES.map((e) => `/${e.value}`)],
  requirements: ["/rfq"],
  quotes: ["/enquiry", "/account/enquiries", "/dashboard/leads", "/dashboard/quotes"],
  notifications: [],
};

/**
 * Never intercepted, by any window.
 *
 * `/api` is the cron routes, the OTP hook and the event beacon: the background
 * work the RUNNING rows describe. `/dev` is a loopback-only surface, and the
 * gallery has to keep rendering this page's states while a window is set
 * locally. The rest are files — the page's own stylesheet among them, which
 * would otherwise be answered with the page.
 */
const NEVER = ["/api", "/_next", "/dev", "/fonts", "/maplibre", "/maintenance/", "/robots.txt", "/favicon.ico"];

/** The page's own address. Served whenever a window is recorded and not lapsed. */
export const MAINTENANCE_PATH = "/maintenance";

export function ownsPath(prefix: string, pathname: string): boolean {
  if (prefix.endsWith("/")) return pathname.startsWith(prefix);
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isNeverIntercepted(pathname: string): boolean {
  return NEVER.some((prefix) => ownsPath(prefix, pathname));
}

/** The system a path belongs to, or null for a page no system owns. */
export function systemForPath(pathname: string): SystemKey | null {
  for (const system of SYSTEMS) {
    if (SYSTEM_ROUTES[system].some((prefix) => ownsPath(prefix, pathname))) return system;
  }
  return null;
}
