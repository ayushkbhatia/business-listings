import { shouldServeMaintenance } from "./decide";
import { readMaintenanceWindow } from "./source";
import { viewAt } from "./window";

/**
 * The proxy's one call: a 503 response when a window covers this path, or null.
 *
 * Headers, per B2:
 * - `Retry-After` in seconds — to the end time, or five minutes once it has passed.
 * - `Cache-Control: no-store`. A cached 503 outlives its window; a cached copy of
 *   *back at 03:00* is the drifting page B5 warns about.
 * - `X-Robots-Tag: noindex`. A 503 is not indexed anyway; this stops the page
 *   being indexed if anything between here and a crawler ever rewrites the status.
 *
 * The document module carries the string catalogue, so it is imported only when
 * a page is actually served — every other request pays for a record read and
 * nothing more.
 */
export async function maintenanceResponse(
  request: Request,
  pathname: string,
  now: Date = new Date(),
): Promise<Response | null> {
  const window = await readMaintenanceWindow(now.getTime());
  const phase = shouldServeMaintenance(pathname, window, now);
  if (!window || !phase) return null;

  const view = viewAt(window, now);
  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
    "retry-after": String(view.retryAfter),
    "cache-control": "no-store",
    "x-robots-tag": "noindex",
  });

  if (request.method === "HEAD") return new Response(null, { status: 503, headers });

  const { renderMaintenanceDocument } = await import("./document");
  return new Response(renderMaintenanceDocument(view), { status: 503, headers });
}
