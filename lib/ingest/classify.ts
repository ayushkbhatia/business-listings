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

const MONTHS_24_MS = 24 * 30 * 86_400_000;

export function categorySlugFor(activity: string | null | undefined): string | null {
  if (!activity) return null;
  const text = activity.toLowerCase();
  for (const signal of CATEGORY_SIGNALS) {
    if (signal.words.some((word) => text.includes(word))) return signal.slug;
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

  if (record.licenceExpiry && record.licenceExpiry.getTime() < now.getTime() - MONTHS_24_MS) {
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
  staged: number;
  categorised: number;
  queued: number;
  rejected: number;
  byGround: Record<RejectionGround, number>;
}

export function tally(classifications: readonly Classification[]): RunTotals {
  const byGround: Record<RejectionGround, number> = {
    licence_expired_24_months: 0,
    no_readable_trade_name: 0,
    activity_out_of_scope: 0,
    address_outside_uae: 0,
  };

  let categorised = 0;
  let queued = 0;
  let rejected = 0;

  for (const item of classifications) {
    if (item.disposition === "rejected") {
      rejected += 1;
      if (item.ground) byGround[item.ground] += 1;
    } else if (item.disposition === "ready") categorised += 1;
    else queued += 1;
  }

  return {
    rows: classifications.length,
    staged: categorised + queued,
    categorised,
    queued,
    rejected,
    byGround,
  };
}
