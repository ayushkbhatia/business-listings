import "server-only";
import { trayItemFor } from "@/lib/db/queries/compare";
import {
  COMPARE_COOKIE,
  EMPTY_TRAY,
  addToTray,
  removeFromTray,
  serialiseTray,
  type CompareChange,
  type CompareIntent,
  type Tray,
} from "./tray";

/**
 * Board `10d` — one change to a tray, decided on the server.
 *
 * The two rules that make a tray — four at most (`B7`) and one trade at a time
 * — are enforced here and nowhere else, so a tick drawn before the tray filled
 * up in another tab still cannot add a fifth, and a hand-built request cannot
 * put a product from another trade beside the rest.
 *
 * Every add reads the product fresh. A product delisted since the page was
 * drawn, or an id somebody typed, adds nothing; the answer says the product is
 * no longer listed rather than holding a column that will not render.
 */
export async function changeTray(
  tray: Tray,
  intent: CompareIntent,
  productId: string | null,
): Promise<CompareChange> {
  if (intent === "clear") return { outcome: "cleared", tray: EMPTY_TRAY, dropped: 0, productId: null };
  if (!productId) return { outcome: "unavailable", tray, dropped: 0, productId: null };

  if (intent === "remove") {
    return { outcome: "removed", tray: removeFromTray(tray, productId), dropped: 0, productId };
  }

  const found = await trayItemFor(productId);
  if (!found) return { outcome: "unavailable", tray, dropped: 0, productId };
  const result = addToTray(tray, found.item, found.trade);
  return { outcome: result.outcome, tray: result.tray, dropped: result.dropped, productId };
}

/**
 * The cookie a tray is stored in — or `null`, meaning delete it.
 *
 * `docs/telemetry.md` §4b is the reasoning, and these attributes are the claims
 * it makes, so change one and that section in the same commit:
 *
 *   · **session** — no `maxAge`, so it ends with the browser. The durable form
 *     of a comparison is its URL (`B10`);
 *   · **readable by script** — the tray is drawn on statically rendered pages,
 *     which cannot read a cookie on the server without becoming dynamic. It
 *     carries ids and names the buyer chose and grants nothing: `/compare`
 *     reads every column from the database;
 *   · **`SameSite=Lax`, first-party, path `/`** — the tray follows the buyer
 *     across the public site and nowhere else.
 */
export function trayCookie(tray: Tray): { name: string; value: string; options: CookieOptions } | null {
  if (tray.items.length === 0) return null;
  return {
    name: COMPARE_COOKIE,
    value: serialiseTray(tray),
    options: {
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      httpOnly: false,
    },
  };
}

export interface CookieOptions {
  path: string;
  sameSite: "lax";
  secure: boolean;
  httpOnly: boolean;
}
