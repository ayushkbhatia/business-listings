import { sizeAliases } from "../trade/nominal-size";

/**
 * The match surface: what a row is findable by, built at write time.
 *
 * Board 1c's first requirement is that `chilled water pumps` finds a supplier
 * whose products carry `Application: chilled water` — not merely one with those
 * three words in their description. That cannot be done at read time. A query
 * that has to normalise sizes across every row it scans is a sequential scan
 * with a regex in it, and the trigram index exists precisely so it is not.
 *
 * So the normalising happens once, on write, and the index stores the result.
 *
 * ## Why this module exists at all
 *
 * `buildSearchText` lived in `prisma/seed.mts`. The seed was therefore the only
 * writer: `lib/import/service.ts` — which the schema calls the widest path into
 * the product table — created rows with `search_text` null, and the dashboard's
 * edit action never refreshed it. Every product a seller actually added was
 * invisible to spec search, and every product they edited kept whatever the
 * seed had written about the older version of it.
 *
 * `nominal-size.ts` already carries a note about this table having been written
 * twice. This is the other half of that move.
 *
 * ## What goes in
 *
 * Names, codes, and every spec value flattened **with its field label**. The
 * label matters: `chilled water` alone is a phrase that could belong to any
 * field, and `application chilled water` is the thing the buyer actually typed
 * a fragment of. Values are indexed both ways so neither phrasing misses.
 *
 * Sizes are expanded through `sizeAliases`, so a seller who typed `4"` is found
 * by `DN100` and the reverse. Trade abbreviations are expanded the same way,
 * because a buyer types `AMC` and a seller writes it out.
 */

/**
 * Abbreviations the trade writes both ways.
 *
 * Deliberately short. Every entry here is a term where the long and short forms
 * are the *same* thing to a buyer — not merely related — because an index that
 * expands loosely returns a supplier of something adjacent and calls it a
 * match. `PN16` and `16 bar` are one pressure rating; `pump` and `pumping` are
 * a stemmer's job and not this table's.
 */
const TRADE_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  amc: ["annual maintenance contract", "maintenance contract"],
  mep: ["mechanical electrical plumbing", "mechanical electrical and plumbing"],
  hvac: ["heating ventilation and air conditioning", "air conditioning"],
  vrf: ["variable refrigerant flow"],
  ahu: ["air handling unit"],
  fcu: ["fan coil unit"],
  vfd: ["variable frequency drive", "variable speed drive"],
  ss316: ["stainless steel 316", "316 stainless"],
  ss304: ["stainless steel 304", "304 stainless"],
  gi: ["galvanised iron", "galvanized iron"],
  ms: ["mild steel"],
  ppr: ["polypropylene random"],
  upvc: ["unplasticised pvc", "unplasticized pvc"],
};

/** The reverse direction, so the long form also reaches the short one. */
const PHRASE_TO_ABBREVIATION: ReadonlyMap<string, string> = new Map(
  Object.entries(TRADE_SYNONYMS).flatMap(([short, longs]) =>
    longs.map((long) => [long, short] as const),
  ),
);

/**
 * Pressure classes, the one unit pair that is not a nominal bore.
 *
 * `PN16` is 232 psi and the trade rounds it to 230. Both spellings are indexed
 * rather than converted, for the same reason `nominal-size` keeps a table
 * instead of doing arithmetic: these are grades, and a buyer searching `PN16`
 * wants the grade, not everything within a few psi of it.
 */
const PN_TO_PSI: Readonly<Record<string, string>> = {
  pn6: "87 psi",
  pn10: "145 psi",
  pn16: "232 psi",
  pn25: "363 psi",
  pn40: "580 psi",
};

/**
 * Every way one written value can be found.
 *
 * Sizes first, then trade abbreviations, then pressure classes. A value that is
 * none of those comes back as itself, lowercased — `sizeAliases` already
 * promises that, which is why `600 CFM` needs no special case here.
 */
export function valueAliases(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  const input = String(raw).trim();
  if (!input) return [];

  const out = new Set<string>(sizeAliases(input));
  const lower = input.toLowerCase();
  out.add(lower);

  for (const long of TRADE_SYNONYMS[lower] ?? []) out.add(long);
  const short = PHRASE_TO_ABBREVIATION.get(lower);
  if (short) {
    out.add(short);
    for (const long of TRADE_SYNONYMS[short] ?? []) out.add(long);
  }

  const psi = PN_TO_PSI[lower.replace(/\s+/g, "")];
  if (psi) out.add(psi);

  return [...out];
}

/** A spec field, as much of one as the index needs. */
export interface IndexableField {
  id: string;
  label: string;
  unit?: string | null;
}

export interface ProductIndexInput {
  name: string;
  sku?: string | null;
  description?: string | null;
  categoryName?: string | null;
  /** Keyed by `SpecField.id`, as the column stores it. */
  specValues?: Record<string, unknown> | null;
  /** The template's fields, so a value can be indexed under its label. */
  fields?: readonly IndexableField[];
}

function collect(add: (value: unknown) => void, input: ProductIndexInput): void {
  add(input.name);
  add(input.sku);
  add(input.description);
  add(input.categoryName);

  const labelById = new Map((input.fields ?? []).map((field) => [field.id, field]));

  for (const [fieldId, value] of Object.entries(input.specValues ?? {})) {
    const field = labelById.get(fieldId);
    const values = Array.isArray(value) ? value : [value];

    for (const one of values) {
      for (const alias of valueAliases(one)) {
        add(alias);
        /*
           The value under its label, which is the phrase a buyer types.
           Indexed alongside the bare value rather than instead of it: somebody
           searching `chilled water` should still find this, and somebody
           searching `application chilled water` should find it too.
        */
        if (field) add(`${field.label} ${alias}`);
      }
      // The unit spelled out, so `16 bar` reaches a value stored as `16`.
      if (field?.unit) add(`${String(one).trim()} ${field.unit}`);
    }

    if (field) add(field.label);
  }
}

/**
 * Join tokens into the stored column, padded at both ends.
 *
 * The padding is load-bearing, and criterion 2 is the reason. The column is
 * matched with `contains`, which is a substring test, so an unpadded
 * `"… dn100 …"` matches a search for `dn10` — silently, and in the direction
 * that quotes the wrong part. With a space at each end a code can be matched as
 * `" dn10 "` and only a whole token satisfies it.
 *
 * Names still match as bare substrings, which is what makes `pump` find
 * `pumps`. That asymmetry is the whole of "typo tolerance on names, never on
 * codes" — see `isCode`.
 */
function pack(tokens: Set<string>): string {
  return tokens.size === 0 ? "" : ` ${[...tokens].join(" ")} `;
}

/**
 * One product's match surface.
 *
 * Tokens are deduplicated. The column is matched with a trigram index, so what
 * matters is that every findable spelling is present; order and grammar are not
 * read by anything.
 */
export function buildProductSearchText(input: ProductIndexInput): string {
  const tokens = new Set<string>();
  const add = (value: unknown) => {
    if (value === null || value === undefined) return;
    const text = String(value).trim().toLowerCase();
    if (text) tokens.add(text);
  };
  collect(add, input);
  return pack(tokens);
}

export interface BusinessIndexInput {
  displayName: string;
  tradeName?: string | null;
  description?: string | null;
  /** Primary and secondary category names, plus their synonyms. */
  categoryNames?: readonly string[];
  synonyms?: readonly string[];
  /** The business's own products, already narrowed to the published ones. */
  products?: readonly ProductIndexInput[];
}

/**
 * One business's match surface, including what its catalogue can supply.
 *
 * This is the column that makes criterion 1 reachable. Business search matched
 * names, trade names and category synonyms and nothing else, so a query naming
 * a *specification* — `chilled water pumps` — could only ever find suppliers
 * who happened to have written those words about themselves. Folding the
 * products' own surface in is what lets the specification find the supplier.
 *
 * It is denormalised, and so it goes stale: a product write has to refresh its
 * business's row as well as its own. That cost is paid on write, where there is
 * one row to fix, rather than on read, where there are two hundred to join.
 */
export function buildBusinessSearchText(input: BusinessIndexInput): string {
  const tokens = new Set<string>();
  const add = (value: unknown) => {
    if (value === null || value === undefined) return;
    const text = String(value).trim().toLowerCase();
    if (text) tokens.add(text);
  };

  add(input.displayName);
  add(input.tradeName);
  add(input.description);
  for (const name of input.categoryNames ?? []) add(name);
  for (const synonym of input.synonyms ?? []) add(synonym);
  for (const product of input.products ?? []) collect(add, product);

  return pack(tokens);
}

/**
 * How one query token must be matched against a stored surface.
 *
 * Codes are matched whole, names as substrings. Returns the string to hand to
 * a `contains`, which is why the padding on the stored column and the padding
 * here have to be decided together and therefore live in the same file.
 */
export function matchNeedle(token: string): string {
  return isCode(token) ? ` ${token.toLowerCase()} ` : token.toLowerCase();
}

/**
 * Is this token a code rather than a name?
 *
 * Criterion 2: typo tolerance applies to names, never to codes. `technopmp`
 * should reach Technopump; `DN10` must never reach `DN100`, and `6205-2RS` must
 * never reach `6205-2RZ`. The rule is deliberately blunt — anything containing
 * a digit is a code — because the failure directions are not symmetric. A code
 * treated as a name quotes the wrong part; a name treated as a code merely
 * fails to forgive a typo, and the buyer retypes it.
 */
export function isCode(token: string): boolean {
  return /\d/.test(token);
}
