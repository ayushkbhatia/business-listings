/**
 * What a licence record is, before anything is written.
 *
 * Pure. The importer, the tests and the fixture generator all read this, so a
 * rejection is the same rejection wherever it is decided.
 *
 * Criterion 1: *"an import run of 8,000 records stages without publishing,
 * categorises what it can, queues what it cannot, and lists rejections by
 * countable reason."* The four grounds are the README's, they are an enum in
 * the database, and this is where a row is sorted into one of them.
 *
 * The bias throughout is toward **queueing rather than rejecting**. A record we
 * cannot categorise is a person's afternoon; a record we wrongly reject is a
 * supplier who is not in the directory and will never know why. So "activity
 * out of scope" fires only on activities that are positively something else,
 * never on activities we simply do not recognise.
 */

export type RejectionGround =
  | "licence_expired_24_months"
  | "no_readable_trade_name"
  | "activity_out_of_scope"
  | "address_outside_uae";

export type Disposition = "ready" | "needs_category" | "rejected";

export interface LicenceRecord {
  tradeName?: string | null;
  licenceNumber?: string | null;
  licenceAuthority?: string | null;
  licenceExpiry?: Date | null;
  emirate?: string | null;
  areaName?: string | null;
  activity?: string | null;
  phone?: string | null;
}

export interface Classification {
  disposition: Disposition;
  ground: RejectionGround | null;
  /** The category slug this activity maps to, where one does. */
  categorySlug: string | null;
}

/** The seven emirates, and nothing else is a UAE address. */
export const EMIRATE_KEYS = [
  "dubai",
  "abu_dhabi",
  "sharjah",
  "ajman",
  "umm_al_quwain",
  "ras_al_khaimah",
  "fujairah",
] as const;

const EMIRATE_ALIASES: Record<string, string> = {
  dubai: "dubai",
  dxb: "dubai",
  "abu dhabi": "abu_dhabi",
  abudhabi: "abu_dhabi",
  auh: "abu_dhabi",
  abu_dhabi: "abu_dhabi",
  sharjah: "sharjah",
  shj: "sharjah",
  ajman: "ajman",
  ajm: "ajman",
  "umm al quwain": "umm_al_quwain",
  uaq: "umm_al_quwain",
  umm_al_quwain: "umm_al_quwain",
  "ras al khaimah": "ras_al_khaimah",
  rak: "ras_al_khaimah",
  ras_al_khaimah: "ras_al_khaimah",
  fujairah: "fujairah",
  fuj: "fujairah",
};

export function normaliseEmirate(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = value.trim().toLowerCase().replace(/\s+/g, " ");
  return EMIRATE_ALIASES[key] ?? null;
}

/**
 * Activity text to category slug.
 *
 * Deliberately a small list of strong signals rather than a clever matcher. A
 * licence activity is a legal phrase — "Trading in Valves & Pipe Fittings" —
 * and the words that identify the trade are the nouns. Anything unrecognised
 * queues for a person; nothing here rejects.
 */
const CATEGORY_SIGNALS: { slug: string; words: readonly string[] }[] = [
  { slug: "valves-and-fittings", words: ["valve", "fitting", "flange", "صمام"] },
  { slug: "pipes-and-tubing", words: ["pipe", "tube", "tubing", "أنابيب", "مواسير"] },
  {
    slug: "hvac-and-ventilation",
    words: ["hvac", "air condition", "ventilat", "chiller", "duct", "تكييف"],
  },
  {
    slug: "electrical-and-cable",
    words: ["electric", "cable", "switchgear", "busbar", "كهرباء", "كابل"],
  },
  {
    slug: "safety-and-ppe",
    words: ["safety", "protective", "ppe", "fire extinguish", "سلامة"],
  },
  {
    slug: "packaging-and-materials",
    words: ["packag", "carton", "pallet", "strapping", "تغليف"],
  },
];

/**
 * Activities that are positively a different business.
 *
 * Only phrases that could not be a trade supplier. "Restaurant" is not a
 * borderline case; "General Trading" very much is, and stays out of this list
 * on purpose — a general trading licence covers half the suppliers in Dubai.
 */
const OUT_OF_SCOPE = [
  "restaurant",
  "cafeteria",
  "beauty salon",
  "barber",
  "laundry",
  "tailoring",
  "travel agency",
  "real estate broker",
  "recruitment agency",
  "nursery",
  "driving school",
  "car rental",
  "money exchange",
  "advocate",
  "legal consultan",
] as const;

/**
 * The expiry floor, in calendar months.
 *
 * This was `24 * 30` days, which is 720 — ten days short of two years. A
 * licence that lapsed 725 days ago is inside the floor the README names and
 * was rejected, which is the one direction this file is written to avoid: a
 * wrongly rejected supplier is not in the directory and never learns why.
 */
export const EXPIRY_FLOOR_MONTHS = 24;

export function expiryFloor(now: Date): Date {
  const floor = new Date(now.getTime());
  floor.setUTCMonth(floor.getUTCMonth() - EXPIRY_FLOOR_MONTHS);
  return floor;
}

/**
 * Whether a signal word begins a word of the activity.
 *
 * A bare substring test filed "Copper Wire Trading" under Safety & PPE (co-ppe-r),
 * "Food Products Trading" under HVAC (pro-duct-s) and "Tipper Truck Rental"
 * under PPE again — every one a confident, wrong category on a record that
 * should have queued for a person. So a Latin signal has to start a word; it
 * may still be a stem ("ventilat", "packag") because licence phrasing inflects.
 *
 * Arabic signals keep the substring test. The definite article and the
 * prepositions attach to the noun — الصمامات, بالصمامات — so a word-start rule
 * would miss the very activity it names.
 */
function startsAWord(text: string, word: string): boolean {
  if (!/[a-z]/.test(word)) return text.includes(word);
  let from = text.indexOf(word);
  while (from !== -1) {
    const before = from === 0 ? "" : text[from - 1]!;
    if (!/[\p{Letter}\p{Number}]/u.test(before)) return true;
    from = text.indexOf(word, from + 1);
  }
  return false;
}

export function categorySlugFor(activity: string | null | undefined): string | null {
  if (!activity) return null;
  const text = activity.toLowerCase();
  for (const signal of CATEGORY_SIGNALS) {
    if (signal.words.some((word) => startsAWord(text, word))) return signal.slug;
  }
  return null;
}

export function isOutOfScope(activity: string | null | undefined): boolean {
  if (!activity) return false;
  const text = activity.toLowerCase();
  return OUT_OF_SCOPE.some((phrase) => text.includes(phrase));
}

/**
 * A trade name has to be something a buyer could read on a sign.
 *
 * Exports carry blanks, placeholders and the odd row of punctuation where a
 * name should be. Two letters is the floor and it has to contain letters —
 * "-" and "N/A" are not names.
 */
export function hasReadableTradeName(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length < 2) return false;
  if (/^(n\/?a|none|nil|unknown|-+)$/i.test(trimmed)) return false;
  return /\p{Letter}{2}/u.test(trimmed);
}

export function classify(record: LicenceRecord, now: Date = new Date()): Classification {
  const reject = (ground: RejectionGround): Classification => ({
    disposition: "rejected",
    ground,
    categorySlug: null,
  });

  /*
   * Order matters, and it is the order somebody reading the rejection would
   * want. A record with no readable name cannot be argued about, so it is
   * checked first; an expired licence is a fact about a real company and comes
   * next; scope is a judgement and comes last.
   */
  if (!hasReadableTradeName(record.tradeName)) return reject("no_readable_trade_name");

  if (record.licenceExpiry && record.licenceExpiry.getTime() < expiryFloor(now).getTime()) {
    // Expired *recently* is not a rejection: a licence renewed late is the most
    // ordinary thing in this market, and the ladder already drops the tier.
    return reject("licence_expired_24_months");
  }

  if (normaliseEmirate(record.emirate) === null) return reject("address_outside_uae");

  if (isOutOfScope(record.activity)) return reject("activity_out_of_scope");

  const categorySlug = categorySlugFor(record.activity);
  return {
    // Categorised or queued. Never published — that is a person's decision, and
    // it is the first half of criterion 1.
    disposition: categorySlug ? "ready" : "needs_category",
    ground: null,
    categorySlug,
  };
}

/** The counts the run screen renders, from the rows it staged. */
export interface RunTotals {
  rows: number;
  /** Everything that is neither rejected nor a duplicate: the new listings. */
  staged: number;
  categorised: number;
  queued: number;
  rejected: number;
  duplicates: number;
  byGround: Record<RejectionGround, number>;
}

/** Anything carrying a disposition and a ground — a verdict or a staged row. */
export interface Tallied {
  disposition: StagedOutcome["disposition"] | "published";
  ground?: RejectionGround | null;
}

export function tally(items: readonly Tallied[]): RunTotals {
  const byGround: Record<RejectionGround, number> = {
    licence_expired_24_months: 0,
    no_readable_trade_name: 0,
    activity_out_of_scope: 0,
    address_outside_uae: 0,
  };

  let categorised = 0;
  let queued = 0;
  let rejected = 0;
  let duplicates = 0;

  for (const item of items) {
    if (item.disposition === "rejected") {
      rejected += 1;
      if (item.ground) byGround[item.ground] += 1;
    } else if (item.disposition === "duplicate") duplicates += 1;
    else if (item.disposition === "needs_category") queued += 1;
    else categorised += 1;
  }

  return {
    rows: items.length,
    staged: categorised + queued,
    categorised,
    queued,
    rejected,
    duplicates,
    byGround,
  };
}

/* ── Board 12a, board-level pass ─────────────────────────────────────────── */

/**
 * The four grounds in the order the board lists them, and what happens to each.
 *
 * B2: a closed enum whose counts sum to the stat card. The order is the
 * board's rather than by count, so a ground with nothing in it still has its
 * row — a zero is a finding, and a table that drops it cannot be audited
 * against the card above it.
 */
export const REJECTION_GROUNDS: readonly RejectionGround[] = [
  "licence_expired_24_months",
  "no_readable_trade_name",
  "activity_out_of_scope",
  "address_outside_uae",
];

/**
 * An expired licence is a real company we will not publish; the other three
 * are not listings at all. The difference is what a re-import may do: a
 * renewed licence arrives in next month's file and stages normally.
 */
export const REJECTION_ACTION: Record<RejectionGround, "never_publish" | "discard"> = {
  licence_expired_24_months: "never_publish",
  no_readable_trade_name: "discard",
  activity_out_of_scope: "discard",
  address_outside_uae: "discard",
};

/**
 * The phrase a queue groups by and a remembered decision matches on.
 *
 * ASCII whitespace only, collapsed, trimmed, lower-cased — and nothing else.
 * The migration backfilled existing rows with the same expression in SQL, and
 * JavaScript's `\s` and `trim()` also eat non-breaking and ideographic spaces
 * that Postgres's `[[:space:]]` does not, so using them here would give one
 * phrase two keys depending on which side computed it.
 */
export function activityKey(activity: string | null | undefined): string {
  return (activity ?? "")
    .replace(/[ \t\n\r\f\v]+/g, " ")
    .replace(/^ | $/g, "")
    .toLowerCase();
}

/**
 * A licence's identity: its authority and its digits.
 *
 * Compared the way `sameLicenceNumber` compares a claimant's typing — a stored
 * `DED-618402` and an export's `618402` are one licence. Null when there are no
 * digits to compare, which is not a match with every other licence that has
 * none.
 */
export function licenceKey(
  authority: string | null | undefined,
  licenceNumber: string | null | undefined,
): string | null {
  const digits = (licenceNumber ?? "").replace(/\D/g, "");
  const code = (authority ?? "").trim().toUpperCase();
  if (!digits || !code) return null;
  return `${code}:${digits}`;
}

/**
 * Which authority a record is licensed by.
 *
 * The record's own column where it names one, and the run's source where it is
 * blank — the staging form asks which authority the file came from, so a DED
 * extract with no authority column is DED throughout. A column naming an
 * authority we have no code for is **not** overridden by the run: the record
 * disagrees with the file, and that is a thing for a person to see.
 */
export function effectiveAuthority(
  recordAuthority: string | null | undefined,
  runSource: string,
  known: ReadonlySet<string>,
): { code: string | null; stated: string | null } {
  const stated = recordAuthority?.trim() ? recordAuthority.trim().toUpperCase() : null;
  const candidate = stated ?? runSource.trim().toUpperCase();
  return { code: known.has(candidate) ? candidate : null, stated };
}

/**
 * Why a record that is not rejected cannot become a listing yet.
 *
 * B3, widened. A category is the reason the board names, and three more were
 * found in the tree, each of which the old approval either skipped in silence
 * or papered over with an invented value:
 *
 *  - an authority we have no code for was skipped, and the row stranded as
 *    `ready` for ever once the run was approved;
 *  - a missing licence number became `PENDING-XXXXXXXX` on a public page;
 *  - a missing expiry became "a year from today" — a fact about a real
 *    company's licence that nobody had, published as though somebody did (B6).
 *
 * None of these is a rejection, and none may become a fifth ground (B2). They
 * are held: counted, stated beside the publish control, and published by the
 * next approval once they are fixed.
 */
export type HeldReason =
  | "needs_category"
  | "authority_unrecognised"
  | "licence_number_missing"
  | "expiry_missing";

export const HELD_REASONS: readonly HeldReason[] = [
  "needs_category",
  "authority_unrecognised",
  "licence_number_missing",
  "expiry_missing",
];

export interface PublishCandidate {
  disposition: string;
  categoryId: string | null;
  licenceAuthority: string | null;
  licenceNumber: string | null;
  licenceExpiry: Date | null;
}

export function heldReasons(
  row: PublishCandidate,
  runSource: string,
  known: ReadonlySet<string>,
): HeldReason[] {
  const reasons: HeldReason[] = [];
  if (row.disposition === "needs_category" || row.categoryId === null) reasons.push("needs_category");
  if (effectiveAuthority(row.licenceAuthority, runSource, known).code === null) {
    reasons.push("authority_unrecognised");
  }
  if (!(row.licenceNumber ?? "").replace(/\D/g, "")) reasons.push("licence_number_missing");
  if (row.licenceExpiry === null) reasons.push("expiry_missing");
  return reasons;
}

/** Only these dispositions can still become a listing. */
export function isOpenRecord(disposition: string): boolean {
  return disposition === "ready" || disposition === "needs_category";
}

/**
 * Where a staged record lands, in the pipeline order Q1 argues for.
 *
 * **Reject, then dedupe, then categorise.** Categorising first measured
 * "matched to a category" over records about to be discarded or merged, and
 * put them in the manual queue — the most expensive thing on the screen — for
 * nothing. A remembered decision outranks a keyword, because a person made it
 * about exactly this phrase.
 */
export interface StagedOutcome {
  disposition: "ready" | "needs_category" | "rejected" | "duplicate";
  ground: RejectionGround | null;
  categoryId: string | null;
  categorySource: "signal" | "mapping" | null;
}

export function stagedOutcome(input: {
  verdict: Classification;
  duplicate: boolean;
  mappedCategoryId: string | null;
  signalCategoryId: string | null;
}): StagedOutcome {
  const { verdict } = input;
  if (verdict.disposition === "rejected") {
    return { disposition: "rejected", ground: verdict.ground, categoryId: null, categorySource: null };
  }
  if (input.duplicate) {
    return { disposition: "duplicate", ground: null, categoryId: null, categorySource: null };
  }
  if (input.mappedCategoryId) {
    return {
      disposition: "ready",
      ground: null,
      categoryId: input.mappedCategoryId,
      categorySource: "mapping",
    };
  }
  /*
     A signal whose slug is not in this database is not a category. The old
     staging wrote `ready` with a null category in that case, and approval —
     which only took rows with a category — stranded it as ready for ever.
  */
  if (input.signalCategoryId) {
    return {
      disposition: "ready",
      ground: null,
      categoryId: input.signalCategoryId,
      categorySource: "signal",
    };
  }
  return { disposition: "needs_category", ground: null, categoryId: null, categorySource: null };
}

/**
 * The name a buyer reads, from the name on the licence.
 *
 * The legal suffix is dropped and nothing else is changed: `displayName` is
 * seller identity on every surface, and an importer that rewrote a company's
 * name would be the platform inventing one.
 */
export function displayNameFor(tradeName: string): string {
  const stripped = tradeName
    .trim()
    .replace(/[\s,]+(L\.?\s?L\.?\s?C\.?|F\.?Z\.?E\.?|FZCO|FZ[-\s]?LLC|FZC|W\.?L\.?L\.?)$/i, "")
    .trim();
  return stripped || tradeName.trim();
}

/**
 * Why a listing survives the rollback of the run that created it.
 *
 * B4: "a rollback must never delete a claimed listing — it has to detach the
 * imported record and leave the claim, its verification, its content and its
 * subscription standing." Nothing here deletes anything, claimed or not; the
 * question is only which listings come off the directory.
 *
 * A listing somebody has started to make theirs stays, and "started" is read
 * widely on purpose. A claim in flight, a team seat, a subscription, a merge
 * that references it — each is a person or a record that would be stranded by
 * the listing vanishing, and none of them had anything to do with the source
 * file being bad.
 */
export type KeptBecause = "claimed" | "claim_in_progress" | "subscribed" | "team" | "merged";

export const KEPT_BECAUSE: readonly KeptBecause[] = [
  "claimed",
  "claim_in_progress",
  "subscribed",
  "team",
  "merged",
];

export interface RollbackManifest {
  withdrawn: string[];
  kept: { id: string; why: KeptBecause }[];
}
