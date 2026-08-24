/**
 * Nominal sizes, and the fact that the trade writes each of them two ways.
 *
 * DN100 and 4" are one size to a buyer and two strings to Postgres. This table
 * was written twice — once in the seed's search-text builder, once here — which
 * is one time too many for a table that decides whether a quote line matches a
 * product. It lives here now and the seed imports it.
 *
 * These are trade sizes, not conversions. DN100 is called four inch and
 * measures 114.3 mm, and nobody on the counter in Al Quoz cares.
 */

/** Canonical DN name to every imperial spelling the trade uses for it. */
export const DN_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  DN15: ['1/2"', "1/2 inch", "half inch"],
  DN20: ['3/4"', "3/4 inch"],
  DN25: ['1"', "1 inch"],
  DN32: ['1-1/4"', "1.25 inch"],
  DN40: ['1-1/2"', "1.5 inch"],
  DN50: ['2"', "2 inch"],
  DN65: ['2-1/2"', "2.5 inch"],
  DN80: ['3"', "3 inch"],
  DN100: ['4"', "4 inch"],
  DN125: ['5"', "5 inch"],
  DN150: ['6"', "6 inch"],
  DN200: ['8"', "8 inch"],
  DN250: ['10"', "10 inch"],
  DN300: ['12"', "12 inch"],
  DN350: ['14"', "14 inch"],
  DN400: ['16"', "16 inch"],
  DN450: ['18"', "18 inch"],
  DN500: ['20"', "20 inch"],
  DN600: ['24"', "24 inch"],
};

/** The reverse: an imperial spelling back to its DN name. */
const ALIAS_TO_DN: ReadonlyMap<string, string> = new Map(
  Object.entries(DN_SYNONYMS).flatMap(([dn, names]) =>
    names.map((n) => [n.toLowerCase(), dn] as const),
  ),
);

/**
 * Reduce one written size to a comparable form.
 *
 * Accepts `DN100`, `dn 100`, `100`, `4"`, `4 inch`, `4in`, `4″` and the smart
 * quote a phone keyboard produces. Returns the DN name, or null when the string
 * is not a nominal bore at all — `600 CFM` and `35 mm²` are sizes too, and
 * pretending they are pipe diameters is worse than admitting they are not.
 */
export function canonicalSize(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;

  // DN100 · dn 100 · dn-100
  const dn = /^dn[\s-]*(\d{1,4})$/.exec(s);
  if (dn) return dnKeyIfKnown(`DN${dn[1]}`);

  // Straight to the alias table, after normalising the several inch marks.
  const inchNormalised = s.replace(/[″”“']/g, '"').replace(/\s+/g, " ").trim();
  const direct = ALIAS_TO_DN.get(inchNormalised);
  if (direct) return direct;

  // 4in · 4 in · 4" · 4 inch, including 1-1/4 and 1.5 spellings.
  const inch = /^(\d+(?:[.-]\d+(?:\/\d+)?)?|\d+\/\d+)\s*(?:"|in|inch|inches)$/.exec(inchNormalised);
  if (inch?.[1]) {
    const key = ALIAS_TO_DN.get(`${inch[1]}"`) ?? ALIAS_TO_DN.get(`${inch[1]} inch`);
    if (key) return key;
  }

  // A bare number is a DN in a valve context, which is the only context that
  // calls this. `100` on a gate valve line means DN100 and never 100 inches.
  const bare = /^(\d{1,4})$/.exec(s);
  if (bare) return dnKeyIfKnown(`DN${bare[1]}`);

  return null;
}

function dnKeyIfKnown(key: string): string | null {
  return key in DN_SYNONYMS ? key : null;
}

/**
 * Every spelling of a size, for a denormalised match surface.
 * Returns the input itself even when the size is not a nominal bore, so a
 * caller can index `600 CFM` without special-casing.
 */
export function sizeAliases(raw: string | null | undefined): string[] {
  const input = (raw ?? "").trim();
  if (!input) return [];

  const out = new Set<string>([input.toLowerCase()]);
  const dn = canonicalSize(input);
  if (dn) {
    out.add(dn.toLowerCase());
    for (const alias of DN_SYNONYMS[dn] ?? []) out.add(alias.toLowerCase());
  }
  return [...out];
}

/**
 * Do two written sizes name the same bore?
 *
 * Unknown on either side is `false`, not `true`. A matcher that treats "I could
 * not read this" as "these agree" will quote a DN600 line at the DN100 price.
 */
export function sameNominalSize(a: string | null | undefined, b: string | null | undefined): boolean {
  const ca = canonicalSize(a);
  const cb = canonicalSize(b);
  return ca !== null && cb !== null && ca === cb;
}
