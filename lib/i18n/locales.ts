/**
 * English is the only locale today. The layer exists anyway.
 *
 * Arabic is a translation project, not a rebuild — which only holds if every
 * string already goes through t() and no layout assumes a direction. Adding
 * "ar" here must be a data change and a stylesheet review, never a refactor.
 */
export const LOCALES = ["en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

const RTL: ReadonlySet<string> = new Set(["ar", "he", "fa", "ur"]);

export type Direction = "ltr" | "rtl";

/** Feed this to <html dir>. It is a variable, never a constant. */
export function dir(locale: string = DEFAULT_LOCALE): Direction {
  return RTL.has(locale.split("-")[0] ?? "") ? "rtl" : "ltr";
}

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * The path segment a translated landing page will be served under — board
 * `6a-s` D-AR, and `6a` Q4 before it: *decide the URL shape now, because
 * retrofitting `hreflang` across a few hundred pages is the expensive version.*
 *
 * Decided: a locale prefix in front of the unchanged English path.
 * `/dubai/business-bay/vat-and-tax` pairs with
 * `/ar/dubai/business-bay/vat-and-tax`, and `hreflang` links the two — both
 * published or neither, per scope. Nothing is served under it yet; English is
 * the only locale.
 *
 * Reserved rather than merely planned, and the reservation is structural: the
 * first segment of a landing URL is an emirate, which is a fixed enum, and no
 * other public route takes a bare two-letter segment. `locales.test.ts` holds
 * that true, so the prefix is free on the day Arabic ships.
 */
export const LOCALE_PATH_PREFIX = { ar: "ar" } as const;
