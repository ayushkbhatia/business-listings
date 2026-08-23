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
