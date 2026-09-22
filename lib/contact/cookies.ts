/**
 * Board `1d` — the contact reveal's two cookies, by name.
 *
 * Here rather than in `service.ts` so something that is not a server module —
 * the cookie policy's register test — can check the names the code actually
 * sets against the names the policy lists. `service.ts` re-exports all three.
 * What each one gates is described there, and why each is strictly necessary
 * in `docs/telemetry.md` §4a.
 */

export const VISITOR_COOKIE = "bl_vid";
export const SESSION_COOKIE = "bl_rsid";

/**
 * How long the form stays answered for one browser. Half a year: long enough
 * that a buyer comparing the same suppliers next quarter is not asked again,
 * short enough that a shared office machine forgets.
 *
 * The cookie policy states this as `180 days`; the register test holds the two
 * to each other.
 */
export const VISITOR_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 180;
