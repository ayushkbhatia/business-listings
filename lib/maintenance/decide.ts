import {
  isNeverIntercepted,
  MAINTENANCE_PATH,
  ownsPath,
  SYSTEM_ROUTES,
} from "./systems";
import { phaseAt, SITE_WIDE_WORK, type MaintenanceWindow, type WindowPhase } from "./window";

/**
 * Whether this request is answered with the maintenance page.
 *
 * Pure: a path, a record and a clock. The proxy supplies all three and does the
 * I/O; this decides. `pathname` is the path the app would route — for a seller's
 * own address that is already `/b/<label>/…`, so a storefront is judged as the
 * storefront it is.
 */
export function shouldServeMaintenance(
  pathname: string,
  window: MaintenanceWindow | null,
  now: Date,
): WindowPhase | null {
  if (!window) return null;
  const phase = phaseAt(window, now);
  if (phase === "lapsed") return null;

  // The page's own address shows the recorded window from the moment it is set,
  // so whoever set it can read it back before the work starts. Outside a window
  // it is an ordinary 404: there is nothing to say and nothing to index.
  if (pathname === MAINTENANCE_PATH) return phase;

  if (phase === "upcoming") return null;
  if (isNeverIntercepted(pathname)) return null;
  if (SITE_WIDE_WORK.has(window.work)) return phase;

  const takenDown = window.affected
    .filter((row) => row.state === "down")
    .some((row) => SYSTEM_ROUTES[row.system].some((prefix) => ownsPath(prefix, pathname)));
  return takenDown ? phase : null;
}

/** What a window takes down, in words, for the ops check and the logs. */
export function describeScope(window: MaintenanceWindow): string[] {
  if (SITE_WIDE_WORK.has(window.work)) {
    return ["every page, except /api, /dev and static files"];
  }
  return window.affected
    .filter((row) => row.state === "down")
    .flatMap((row) => SYSTEM_ROUTES[row.system].map((prefix) => `${prefix} (${row.system})`));
}
