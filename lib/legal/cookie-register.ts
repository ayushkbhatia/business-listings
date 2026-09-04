import type { MessageKey } from "@/lib/i18n";

/**
 * Board 13h §2 — the register, as data.
 *
 * The page is the contract: it names every cookie the application is permitted
 * to set, and 13h §3 asks for a crawl that asserts `Set-Cookie` across the
 * public routes and a signed-in dashboard, in three consent states, equals this
 * set. That test cannot read prose, so the nine names live here and the page
 * renders them — one source, and a new cookie means editing the register first.
 *
 * `bl_consent` is essential and set whatever the answer is. A "no" that is not
 * remembered means asking again on every page, which is worse than the cookie.
 *
 * Preferences are set on use, not on consent: the banner does not gate them,
 * and using the language switch is the consent. A seller who declines
 * everything and then switches to Arabic gets `bl_lang`. §01 says so on the
 * page, which is the only reason it is defensible.
 */
export type CookieCategory = "essential" | "preferences" | "analytics" | "advertising";

export interface RegisteredCookie {
  name: string;
  category: CookieCategory;
  /** Copy keys rather than copy: the register is data, the page is a render. */
  purposeKey: MessageKey;
  lifeKey: MessageKey;
}

export const COOKIE_CATEGORIES: readonly {
  category: CookieCategory;
  labelKey: MessageKey;
}[] = [
  { category: "essential", labelKey: "legal.cookies.02.band.essential" },
  { category: "preferences", labelKey: "legal.cookies.02.band.preferences" },
  { category: "analytics", labelKey: "legal.cookies.02.band.analytics" },
  { category: "advertising", labelKey: "legal.cookies.02.band.advertising" },
];

export const COOKIE_REGISTER: readonly RegisteredCookie[] = [
  {
    name: "bl_session",
    category: "essential",
    purposeKey: "legal.cookies.02.bl_session.purpose",
    lifeKey: "legal.cookies.02.bl_session.life",
  },
  {
    name: "bl_csrf",
    category: "essential",
    purposeKey: "legal.cookies.02.bl_csrf.purpose",
    lifeKey: "legal.cookies.02.bl_csrf.life",
  },
  {
    name: "bl_consent",
    category: "essential",
    purposeKey: "legal.cookies.02.bl_consent.purpose",
    lifeKey: "legal.cookies.02.bl_consent.life",
  },
  {
    name: "bl_lang",
    category: "preferences",
    purposeKey: "legal.cookies.02.bl_lang.purpose",
    lifeKey: "legal.cookies.02.bl_lang.life",
  },
  {
    name: "bl_emirate",
    category: "preferences",
    purposeKey: "legal.cookies.02.bl_emirate.purpose",
    lifeKey: "legal.cookies.02.bl_emirate.life",
  },
  {
    name: "bl_recent",
    category: "preferences",
    purposeKey: "legal.cookies.02.bl_recent.purpose",
    lifeKey: "legal.cookies.02.bl_recent.life",
  },
  {
    name: "bl_a_id",
    category: "analytics",
    purposeKey: "legal.cookies.02.bl_a_id.purpose",
    lifeKey: "legal.cookies.02.bl_a_id.life",
  },
  {
    name: "bl_a_ses",
    category: "analytics",
    purposeKey: "legal.cookies.02.bl_a_ses.purpose",
    lifeKey: "legal.cookies.02.bl_a_ses.life",
  },
  {
    name: "bl_sp",
    category: "advertising",
    purposeKey: "legal.cookies.02.bl_sp.purpose",
    lifeKey: "legal.cookies.02.bl_sp.life",
  },
];

/** The set a `Set-Cookie` crawl is allowed to observe. */
export const REGISTERED_COOKIE_NAMES: ReadonlySet<string> = new Set(
  COOKIE_REGISTER.map((cookie) => cookie.name),
);
