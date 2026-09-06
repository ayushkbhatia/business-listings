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
  /**
   * The column that selects a subcategory, and with it the spec template.
   *
   * Board 11d's structural correction. The board carried a single
   * `Template: Valves v3` chip over a 412-row file spanning three
   * subcategories; templates attach to subcategories many-to-many (`3h`, `4e`),
   * so one badge either applies the wrong field set to two thirds of the file
   * or drops the values it cannot place. The template is resolved per row from
   * this column instead.
   */
  | "subcategory"
  /**
   * Filenames, resolved against the media library as references.
   *
   * The board had no photo column at all, on the only route in the product that
   * can bulk-attach media. One filename on forty rows attaches one file to
   * forty products — `3i`'s reference model, not forty copies.
   */
  | "photo"
  | "ignore"
  | "blocked";

export interface ColumnTarget {
  kind: TargetKind;
  /**
   * For `spec`: the SpecField **key** this column fills — `nominal_size`, not
   * a cuid.
   *
   * A key and not an id, because the template is resolved per row now. Two
   * subcategories in one file both have a `nominal_size` field and those are
   * two different `SpecField` rows with two different ids; the column means the
   * same thing in both. Writing `specValues` still keys by id — that invariant
   * is untouched — but the id is looked up per row, from the template that row
   * resolved to.
   */
  specFieldKey?: string;
  /**
   * The id, as older saved mappings stored it.
   *
   * Kept readable rather than migrated. An `ImportMapping` is a row a seller
   * saved months ago to make next month's file one click, and silently failing
   * to apply it would be worse than the drift. `resolveTargetKey` below turns
   * one into a key when the plan is applied.
   */
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
    /*
       `material` was here and is not a name.
   
       In a valves and fittings directory it is the single most common spec
       field — body material, disc material, seat material — and a column headed
       `Material` mapped to the product name with `certain` confidence, ahead of
       any spec field, because an exact match on this list beat the fuzzy pass.
       Board 11d's own render maps `Material` to two spec fields via a split.
    */
    words: ["productname", "itemname", "description", "item", "product", "name", "title"],
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
  {
    kind: "subcategory",
    /*
       Not `type`. It is the most tempting word on this list and the most
       dangerous: `Type` in a valves file is `Butterfly / Gate / Ball`, which is
       a spec field on the template, and mapping it to the taxonomy would file
       every row under a subcategory that does not exist and error the lot.
    */
    words: [
      "category", "subcategory", "categoryname", "productcategory", "productgroup",
      "group", "family", "range", "section", "producttype",
    ],
    reason: "Chooses the subcategory, and with it the spec fields for that row.",
  },
  {
    kind: "photo",
    words: [
      "photo", "photos", "photofile", "photofilename", "image", "images",
      "imagefile", "imagefilename", "picture", "pictures", "img", "filename",
      "file",
    ],
    reason: "Matched by filename against your media library. Nothing is uploaded from here.",
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
      target: { kind: "spec", specFieldKey: exactSpec.key },
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
      target: { kind: "spec", specFieldKey: partialSpec.key },
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
  /*
     Three words, not two.

     `Qty on hand` is three words and one of the most common stock headings
     there is; at two it fell through to `ignore` and the running screen offered
     to drop it. The reason the limit exists at all is that a long header
     carrying one incidental match is not that field — `Internal notes ref 4` is
     four words and still excluded — and the guess is now checked against the
     rest of the file as well, in `bestTargets` below, so a wrong one loses to a
     confident column rather than standing.
  */
  const shortEnoughToGuess = words.length <= 3;
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

/**
 * The spec key a column fills, whichever way the plan spells it.
 *
 * A plan built by this build carries `specFieldKey`. One restored from an
 * `ImportMapping` saved before board 11d carries `specFieldId`, and the id
 * belongs to whichever template was current when the seller pressed Save — so
 * it is translated through the field list rather than trusted.
 *
 * An id that no longer resolves returns undefined, and the caller treats the
 * column as unmapped. That is the honest outcome: the field it named has been
 * deleted from the template, and guessing a replacement by position or by name
 * is how a saved mapping quietly starts filling the wrong column.
 */
export function resolveTargetKey(
  target: ColumnTarget,
  keyById: ReadonlyMap<string, string>,
): string | undefined {
  if (target.specFieldKey) return target.specFieldKey;
  if (target.specFieldId) return keyById.get(target.specFieldId);
  return undefined;
}

/**
 * What the seller reads in the STATUS column, and what the tally counts.
 *
 * Four states, and the board's own header has to sum to them: `5 matched ·
 * 2 need you · 1 blocked · 1 ignored` over nine columns. The board printed
 * `Auto-matched 7 of 9` above statuses showing four matched, which is the same
 * defect `3f` §1 corrected — a breakdown that does not sum to its own total.
 */
export type ColumnStatus = "matched" | "needs_you" | "blocked" | "ignored";

export interface ColumnStatusInput {
  target: ColumnTarget;
  confidence?: ColumnSuggestion["confidence"];
  /** A split was offered and the seller has not answered yet. */
  splitPending?: boolean;
  /** Values in this column that resolved to nothing — filenames, categories. */
  unresolved?: number;
}

/**
 * `needs_you` is not "we are unsure". It is "this column carries a decision
 * only you can make, and importing without it would silently do the wrong
 * thing".
 *
 * Three sources of one: a split whose delimiter is a guess, a value that
 * resolved to nothing, and a low-confidence match. Everything else is matched
 * — including a column the seller has explicitly set, which is why confidence
 * is optional here.
 */
export function statusOf(input: ColumnStatusInput): ColumnStatus {
  if (input.target.kind === "blocked") return "blocked";

  /*
     A column we could not place must not read the same as one the seller
     dropped on purpose.

     Both were `Ignored`. On the running screen a `Size` column the matcher had
     no field for sat in the table looking exactly like `Supplier Ref`, which
     the seller means to discard — and on a forty-column file that is how a
     column goes missing without anyone noticing. `guess` confidence is the
     matcher saying it does not know; the seller setting the column explicitly
     clears the confidence, and then `Ignored` means what it says.
  */
  if (input.target.kind === "ignore") {
    return input.confidence === "guess" ? "needs_you" : "ignored";
  }

  if (input.splitPending) return "needs_you";
  if ((input.unresolved ?? 0) > 0) return "needs_you";
  if (input.confidence === "guess") return "needs_you";
  return "matched";
}

export type ColumnTally = Record<ColumnStatus, number>;

/**
 * The tally, which must sum to the column count.
 *
 * Returned as a record rather than a sentence so the caller cannot render a
 * total that disagrees with its own parts — `total` here is derived from the
 * same array the parts are.
 */
export function tallyOf(statuses: readonly ColumnStatus[]): ColumnTally & { total: number } {
  const tally: ColumnTally = { matched: 0, needs_you: 0, blocked: 0, ignored: 0 };
  for (const status of statuses) tally[status] += 1;
  return { ...tally, total: statuses.length };
}


/**
 * One column per single-valued target, and the confident one wins.
 *
 * On the running screen `Part No` matched `sku` outright and `Supplier Ref`
 * matched it too, on the word `ref`, at `guess` confidence — so the table told
 * the seller both columns were `Your reference` while the import would read the
 * first and silently drop the second. A screen whose entire job is to be exact
 * about where a column lands cannot have two columns claiming one field.
 *
 * The loser is demoted to `ignore` at `guess` confidence, which reads as
 * `Needs you` rather than `Ignored` — we do not know what that column is, and
 * saying so is the honest version of the same answer.
 *
 * `spec` and `photo` are exempt. A file legitimately carries `photo_1…photo_6`,
 * and two spec columns are two different fields.
 */
const SINGLE_VALUED: readonly TargetKind[] = [
  "name",
  "sku",
  "description",
  "availability",
  "stock_qty",
  "lead_time_days",
  "min_order_qty",
  "subcategory",
];

const RANK: Record<ColumnSuggestion["confidence"], number> = {
  certain: 2,
  likely: 1,
  guess: 0,
};

export function resolveConflicts(
  suggestions: readonly ColumnSuggestion[],
): ColumnSuggestion[] {
  const winner = new Map<TargetKind, number>();
  suggestions.forEach((suggestion, index) => {
    const kind = suggestion.target.kind;
    if (!SINGLE_VALUED.includes(kind)) return;
    const held = winner.get(kind);
    if (held === undefined) {
      winner.set(kind, index);
      return;
    }
    // Strictly better wins. A tie keeps the earlier column, which is the one
    // the seller sees first in a table rendered in file order.
    if (RANK[suggestion.confidence] > RANK[suggestions[held]!.confidence]) {
      winner.set(kind, index);
    }
  });

  return suggestions.map((suggestion, index) => {
    const kind = suggestion.target.kind;
    if (!SINGLE_VALUED.includes(kind)) return suggestion;
    if (winner.get(kind) === index) return suggestion;
    const { reason: _dropped, ...rest } = suggestion;
    return { ...rest, target: { kind: "ignore" as const }, confidence: "guess" as const };
  });
}
