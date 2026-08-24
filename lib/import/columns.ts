/**
 * What a CSV column is allowed to become.
 *
 * CLAUDE.md non-negotiable 1: `Product` has no price field, and prices exist
 * only inside a `QuoteLine`, private to one buyer and one seller. Every other
 * path into the product table is a typed form with no price input on it. A CSV
 * importer is the one path wide enough to smuggle one in, because the seller
 * brings their own column names — and a supplier's own export almost always has
 * a price column in it, because it was written for their accounting system.
 *
 * So this module's job is not validation. It is the fence. A column that looks
 * like money is refused by name, the refusal says why in the seller's own
 * words, and there is no target it can be mapped to even if somebody tries.
 *
 * Acceptance criterion 7: "A CSV with a price column cannot import prices — the
 * mapper blocks it with the reason shown."
 */

/** Where a column's values can go. `blocked` and `ignore` are not the same. */
export type TargetKind =
  | "name"
  | "sku"
  | "description"
  | "availability"
  | "stock_qty"
  | "lead_time_days"
  | "min_order_qty"
  | "spec"
  | "ignore"
  | "blocked";

export interface ColumnTarget {
  kind: TargetKind;
  /** For `spec`: the platform SpecField id this column fills. */
  specFieldId?: string;
}

export interface ColumnSuggestion {
  /** The header exactly as it appeared in the file. */
  header: string;
  target: ColumnTarget;
  /**
   * Why, in a sentence the seller can act on. Always present for `blocked`;
   * present for a confident guess so the mapper is explaining, not asserting.
   */
  reason?: string;
  /** How sure the guess is. A low one renders as a question, not a decision. */
  confidence: "certain" | "likely" | "guess";
  /**
   * Two fields in one column — "DI / SS316". The mapper offers a split rather
   * than making the seller re-export.
   */
  splittable?: { on: string; parts: number };
}

/* ── The fence ────────────────────────────────────────────────────────────── */

/**
 * Header patterns that mean money.
 *
 * Deliberately broad, and deliberately not anchored on the word "price" alone.
 * A supplier's export says "Unit Price AED", "List", "MRP", "Rate", "Cost",
 * "Landed", "Ex-Works", "Selling Price (USD)". Matching only "price" would
 * catch the first and wave through the rest, and the rest are the same field.
 *
 * A false positive here costs the seller one column they map by hand. A false
 * negative puts a price on a public product row, which is a migration to undo.
 * The asymmetry is the whole argument for erring wide.
 */
const MONEY_WORDS = [
  "price", "prices", "pricing", "rate", "rates", "cost", "costs", "amount",
  "value", "mrp", "rrp", "msrp", "list", "listprice", "netprice", "unitprice",
  "sellingprice", "salesprice", "purchaseprice", "landed", "landedcost",
  "exworks", "exw", "fob", "cif", "cip", "dap", "ddp", "margin", "markup",
  "discount", "tariff", "charge", "charges", "fee", "fees", "total", "subtotal",
  "vat", "tax", "aed", "usd", "eur", "gbp", "sar", "inr", "dirham", "dirhams",
  "currency", "money", "budget", "quotation", "quote",
] as const;

/**
 * Words that contain a money word but are not about money.
 *
 * "Stock Value" is money. "Nominal Value" and "K Value" are engineering terms,
 * and a valves directory sees them constantly — a Kv value is a flow
 * coefficient, and refusing it would be refusing a spec.
 */
const NOT_MONEY: readonly (readonly string[])[] = [
  ["k", "value"], ["kv", "value"], ["cv", "value"], ["ph", "value"],
  ["nominal", "value"], ["calorific", "value"], ["set", "value"],
  ["flow", "rate"], ["feed", "rate"], ["leak", "rate"], ["failure", "rate"],
  ["torque", "rate"], ["cycle", "rate"], ["rated", "flow"], ["rated", "power"],
  ["rated", "voltage"], ["rated", "current"], ["rated", "speed"],
  ["rated", "load"], ["rated", "pressure"], ["rated", "torque"],
  ["total", "weight"], ["total", "length"], ["total", "height"],
  ["total", "quantity"], ["total", "qty"], ["total", "pieces"],
  ["total", "items"], ["total", "sets"],
];

/** Lower case, letters and digits only. "Unit Price (AED)" becomes "unitpriceaed". */
export function normaliseHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The header as words. "Unit Price (AED)" becomes ["unit", "price", "aed"].
 *
 * Matching on the squashed string alone is how "Stock Value" ended up exempt:
 * `stockvalue` contains `kvalue`, so an exception written for a flow
 * coefficient silently waved a money column through. Substring matching on
 * squashed identifiers is the same bug handoff 2 fixed in the quote matcher,
 * where `as` matched inside `cast`.
 */
export function headerWords(header: string): string[] {
  return header
    .toLowerCase()
    .replace(/([a-z])([0-9])/g, "$1 $2")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Do `words` contain `phrase` as consecutive tokens? */
function hasPhrase(words: readonly string[], phrase: readonly string[]): boolean {
  if (phrase.length === 0 || phrase.length > words.length) return false;
  for (let i = 0; i + phrase.length <= words.length; i += 1) {
    if (phrase.every((token, j) => words[i + j] === token)) return true;
  }
  return false;
}

/**
 * Does this header name a price?
 *
 * Exceptions first, and both sides match whole words. A column called
 * "K Value" survives; "Stock Value" does not.
 */
export function looksLikeMoney(header: string): boolean {
  const words = headerWords(header);
  if (words.length === 0) return false;
  if (NOT_MONEY.some((phrase) => hasPhrase(words, phrase))) return false;
  // A squashed header still counts: "unitprice" as one token is one word here,
  // and a supplier's export writes it both ways.
  const squashed = normaliseHeader(header);
  return (
    words.some((word) => MONEY_WORDS.includes(word as (typeof MONEY_WORDS)[number])) ||
    MONEY_WORDS.some((word) => word.length >= 5 && squashed.includes(word))
  );
}

/**
 * A currency symbol or an amount-shaped value, for the case the header hides
 * it. "Col 7" holding "AED 1,240.00" is a price column whatever it is called.
 */
export function valuesLookLikeMoney(values: readonly string[]): boolean {
  const sample = values.filter((v) => v.trim() !== "").slice(0, 20);
  if (sample.length < 3) return false;

  const moneyish = sample.filter((raw) => {
    const v = raw.trim();
    if (/[$€£₹]|(^|\s)(aed|usd|eur|gbp|sar|inr|dhs?)(\s|$)/i.test(v)) return true;
    // 1,240.00 — thousands separators and exactly two decimals. A bare integer
    // is not enough: quantities and lead times look the same.
    return /^\d{1,3}(,\d{3})+(\.\d{2})?$/.test(v) || /^\d+\.\d{2}$/.test(v);
  });

  return moneyish.length / sample.length >= 0.6;
}

export const BLOCKED_REASON =
  "This looks like a price. Prices are never stored on a product here — they " +
  "belong on a quote, where only the buyer you send it to can see them. Nothing " +
  "in this column will be imported.";

/* ── Everything else ──────────────────────────────────────────────────────── */

interface FieldPattern {
  kind: Exclude<TargetKind, "spec" | "ignore" | "blocked">;
  words: readonly string[];
  reason: string;
}

const FIELDS: readonly FieldPattern[] = [
  {
    kind: "name",
    words: ["productname", "itemname", "description", "item", "product", "name", "title", "material"],
    reason: "Used as the product name buyers see.",
  },
  {
    kind: "sku",
    words: ["sku", "partno", "partnumber", "itemcode", "itemno", "code", "ref", "reference", "model", "mpn", "articleno"],
    reason: "Used as your own reference. Buyers see it on the product page.",
  },
  {
    kind: "stock_qty",
    words: ["stock", "qty", "quantity", "onhand", "available", "instock", "balance"],
    reason: "How many you hold. Shown as availability, never as a number buyers can order against.",
  },
  {
    kind: "lead_time_days",
    words: ["leadtime", "lead", "delivery", "deliverydays", "eta", "days"],
    reason: "Days to supply. Shown on the product where a price would sit elsewhere.",
  },
  {
    kind: "min_order_qty",
    words: ["moq", "minorder", "minimumorder", "minqty", "minimumqty", "packsize"],
    reason: "Your minimum order quantity. This describes your own process, not ours.",
  },
  {
    kind: "availability",
    words: ["availability", "status", "madetoorder", "indent", "stockstatus"],
    reason: "In stock, made to order, indent or out of stock.",
  },
];

/** The separators worth offering a split on. Two values in one cell is common. */
const SPLIT_CANDIDATES = [" / ", "/", " | ", "|", ";"] as const;

function detectSplit(values: readonly string[]): ColumnSuggestion["splittable"] {
  const sample = values.filter((v) => v.trim() !== "").slice(0, 20);
  if (sample.length < 3) return undefined;

  for (const on of SPLIT_CANDIDATES) {
    const split = sample.filter((v) => v.includes(on));
    if (split.length / sample.length < 0.7) continue;
    const parts = split[0]!.split(on).length;
    // Only when every row splits the same way. A ragged column is one field
    // containing a slash, not two fields sharing a cell.
    if (split.every((v) => v.split(on).length === parts) && parts >= 2) {
      return { on, parts };
    }
  }
  return undefined;
}

export interface SpecFieldOption {
  id: string;
  key: string;
  label: string;
  isFilterable: boolean;
}

/**
 * Suggest a target for one column.
 *
 * The order matters and is the point: money is checked before anything else, so
 * a column called "Unit Price" can never be read as a product name just because
 * "price" was not in the name list. A blocked column is blocked before any
 * other rule gets a chance to claim it.
 */
export function suggestColumn(
  header: string,
  values: readonly string[],
  specFields: readonly SpecFieldOption[],
): ColumnSuggestion {
  const key = normaliseHeader(header);

  if (looksLikeMoney(header)) {
    return {
      header,
      target: { kind: "blocked" },
      reason: BLOCKED_REASON,
      confidence: "certain",
    };
  }

  if (valuesLookLikeMoney(values)) {
    return {
      header,
      target: { kind: "blocked" },
      reason:
        `The values in this column are amounts of money — ${sampleOf(values)}. ` + BLOCKED_REASON,
      confidence: "likely",
    };
  }

  const splittable = detectSplit(values);

  // An exact spec-field match beats a fuzzy product-field one: a column called
  // "Body Material" is the template's body_material, not the product name.
  const exactSpec = specFields.find(
    (f) => normaliseHeader(f.label) === key || normaliseHeader(f.key) === key,
  );
  if (exactSpec) {
    return {
      header,
      target: { kind: "spec", specFieldId: exactSpec.id },
      reason: exactSpec.isFilterable
        ? "Buyers filter on this field. Filling it is what makes you findable."
        : "Shown on the product's spec table.",
      confidence: "certain",
      ...(splittable ? { splittable } : {}),
    };
  }

  const words = headerWords(header);

  for (const field of FIELDS) {
    const hit = field.words.find((word) => key === word);
    if (hit) {
      return {
        header,
        target: { kind: field.kind },
        reason: field.reason,
        confidence: "certain",
        ...(splittable ? { splittable } : {}),
      };
    }
  }

  const partialSpec = specFields.find(
    (f) => key.includes(normaliseHeader(f.key)) || normaliseHeader(f.label).includes(key),
  );
  if (partialSpec && key.length >= 3) {
    return {
      header,
      target: { kind: "spec", specFieldId: partialSpec.id },
      reason: partialSpec.isFilterable
        ? "Buyers filter on this field. Filling it is what makes you findable."
        : "Shown on the product's spec table.",
      confidence: "likely",
      ...(splittable ? { splittable } : {}),
    };
  }

  /*
   * The last-resort tier matches whole words, and only in a short header.
   *
   * `key.includes(word)` read "Internal notes ref 4" as a SKU because `ref`
   * sat inside `notesref` — the same substring bug handoff 2 fixed in the
   * quote matcher. Whole words alone were not enough either: `ref` is a real
   * word in that header and the guess was still wrong. A header of four words
   * carrying one incidental match is not that field.
   *
   * A wrong column mapped to SKU is worse than a column left alone. The seller
   * has to notice a bad guess in order to undo it, and has to notice nothing
   * at all to fill in one that was left blank.
   */
  const shortEnoughToGuess = words.length <= 2;
  for (const field of FIELDS) {
    if (shortEnoughToGuess && field.words.some((word) => words.includes(word))) {
      return {
        header,
        target: { kind: field.kind },
        reason: field.reason,
        confidence: "guess",
        ...(splittable ? { splittable } : {}),
      };
    }
  }

  return {
    header,
    target: { kind: "ignore" },
    confidence: "guess",
    ...(splittable ? { splittable } : {}),
  };
}

function sampleOf(values: readonly string[]): string {
  const first = values.find((v) => v.trim() !== "");
  return first ? `"${first.trim()}"` : "for example";
}

/**
 * The mapping the seller ends up with, as applied.
 *
 * A blocked column stays in the plan rather than being dropped. The import
 * screen has to be able to say "we did not import this, and here is why", and a
 * saved mapping reused next month has to refuse the same column again without
 * re-deriving why.
 */
export interface ColumnPlan {
  columns: { header: string; target: ColumnTarget; reason?: string }[];
}

/**
 * A plan is only usable if it produces a product name. Everything else on a
 * product is optional; a row with no name is not a product.
 */
export function planIsUsable(plan: ColumnPlan): boolean {
  return plan.columns.some((c) => c.target.kind === "name");
}

/**
 * Refuse to apply a plan that maps a money column anywhere but `blocked`.
 *
 * The mapper's UI will not offer it, but the plan travels through a form and a
 * saved mapping, and both are strings the seller could edit. This is the check
 * the service runs before writing anything, and it throws rather than warning:
 * there is no partial success worth having here.
 */
export class PriceColumnError extends Error {
  constructor(readonly header: string) {
    super(
      `The column "${header}" looks like a price and cannot be imported. ` +
        "Prices belong on a quote, never on a product.",
    );
    this.name = "PriceColumnError";
  }
}

export function assertNoPriceEscapes(plan: ColumnPlan): void {
  for (const column of plan.columns) {
    if (column.target.kind === "blocked" || column.target.kind === "ignore") continue;
    if (looksLikeMoney(column.header)) throw new PriceColumnError(column.header);
  }
}
