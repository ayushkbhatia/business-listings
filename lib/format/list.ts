import { UAE_LOCALE } from "./locale";

/**
 * *Dubai, Sharjah and Abu Dhabi* — a list in the locale's own words.
 *
 * `Intl.ListFormat` rather than `join(", ")` with a hand-placed *and*: the
 * conjunction, the serial comma and, later, the Arabic *و* are the locale's,
 * and a sentence assembled in a component is one no translation can fix.
 */
export function formatList(items: readonly string[]): string {
  return new Intl.ListFormat(UAE_LOCALE, { style: "long", type: "conjunction" }).format(items);
}
