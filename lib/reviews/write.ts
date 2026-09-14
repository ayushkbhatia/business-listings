import { detectIdentityLeak, type LeakKind } from "@/lib/enquiry/redaction";
import { safeName } from "@/lib/storage/buckets";
import { DIMENSIONS, type Dimension } from "./eligibility";

/**
 * Board 10f — what a review has to be before it can be posted.
 *
 * Pure, and imported by both ends: the form disables Post on exactly the rules
 * the service refuses on, so a buyer is never shown a button that the server
 * then turns down (`B1`'s argument, applied to the fields rather than the gate).
 */

/** `B5`: the floor. A rating with a sentence under it, not a number somebody clicked past. */
export const REVIEW_BODY_MIN = 40;
/** `B5`: the ceiling. */
export const REVIEW_BODY_MAX = 800;

/** `B6`. */
export const MAX_REVIEW_PHOTOS = 6;
/** `B6`: what the buyer may pick. The browser shrinks it before it leaves the phone. */
export const REVIEW_PHOTO_INPUT_BYTES = 8 * 1024 * 1024;
/** `B6`: JPG or PNG from the buyer's side; stored as whatever the canvas encodes. */
export const REVIEW_PHOTO_INPUT_TYPES = ["image/jpeg", "image/png"] as const;
/**
 * The long-edge floor for a review photograph.
 *
 * Lower than a storefront's 800: a buyer's photo of a delivered pallet is
 * corroboration shown at 66×52 in a row, not a hero image, and refusing a
 * reasonable phone crop would lose evidence for a presentation reason.
 */
export const REVIEW_PHOTO_MIN_EDGE = 400;

/**
 * Graphemes, not UTF-16 units (`B5`).
 *
 * `"é".length` is 1 or 2 depending on how it was typed, and an Arabic body with
 * diacritics or an emoji-bearing one counts wrong by `.length` in both
 * directions. `Intl.Segmenter` is the user-perceived character, which is what
 * a counter reading `148 / 800` has to mean.
 */
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function graphemeCount(text: string): number {
  return Array.from(segmenter.segment(text)).length;
}

/**
 * Contact details, which a review may not carry.
 *
 * The board's chips say *No contact details* and step 1 of *what happens after
 * you post* says the text is checked for them. The detector is the one the home
 * page's live requirements use (`lib/enquiry/redaction.ts`), narrowed to the
 * kinds that are a way to reach somebody. A company name and a TRN are not:
 * a review naming the supplier's legal entity is describing who it dealt with.
 */
export type ContactKind = Extract<LeakKind, "phone" | "email" | "url" | "handle">;

const CONTACT_KINDS: readonly ContactKind[] = ["phone", "email", "url", "handle"];

/**
 * A phone number written the ways the trade writes one — with a country code,
 * or with the leading zero of a UAE number.
 *
 * Narrower than the home page's rule, which also treats any bare run of seven
 * digits as a number to call: that is right for a stranger-facing requirement,
 * where a false positive costs one panel slot, and wrong here, where it refuses
 * a buyer's review for quoting a PO or an invoice number.
 */
const PHONE: readonly RegExp[] = [
  /(?:\+|00)\s?\d{1,3}[\s.-]?\d[\d\s.()-]{6,16}\d/,
  /\b0\d[\d\s.()-]{6,12}\d\b/,
];

export function contactDetailsIn(text: string): ContactKind[] {
  const { kinds } = detectIdentityLeak(text);
  const found = new Set<ContactKind>(CONTACT_KINDS.filter((kind) => kind !== "phone" && kinds.includes(kind)));
  if (PHONE.some((pattern) => pattern.test(text))) found.add("phone");
  return CONTACT_KINDS.filter((kind) => found.has(kind));
}

/** A photograph the buyer uploaded, after the server stripped it. */
export interface ReviewPhotoRef {
  path: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
}

/** Everything the form holds. A draft is this with nothing required. */
export interface ReviewFields {
  overall: number | null;
  quotedAccurate: number | null;
  onTime: number | null;
  asDescribed: number | null;
  responsiveness: number | null;
  body: string;
  showCompanyName: boolean;
  photos: ReviewPhotoRef[];
}

export const EMPTY_REVIEW_FIELDS: ReviewFields = {
  overall: null,
  quotedAccurate: null,
  onTime: null,
  asDescribed: null,
  responsiveness: null,
  body: "",
  showCompanyName: true,
  photos: [],
};

export type ReviewProblem =
  | { code: "overall_missing" }
  | { code: "invalid_score" }
  | { code: "body_short"; count: number }
  | { code: "body_long"; count: number }
  | { code: "contact_details"; kinds: ContactKind[] }
  | { code: "too_many_photos" };

function scoreOrNull(value: unknown): boolean {
  return value === null || (Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 5);
}

/**
 * Every reason this cannot be posted yet, in the order the form reads.
 *
 * Empty means Post is enabled and the service will accept it (subject to the
 * gate). The service calls the same function, so the two cannot disagree.
 */
export function reviewProblems(fields: ReviewFields): ReviewProblem[] {
  const problems: ReviewProblem[] = [];
  if (fields.overall === null) problems.push({ code: "overall_missing" });
  const scores = [fields.overall, ...DIMENSIONS.map((key) => fields[key])];
  if (!scores.every(scoreOrNull)) problems.push({ code: "invalid_score" });

  const count = graphemeCount(fields.body.trim());
  if (count < REVIEW_BODY_MIN) problems.push({ code: "body_short", count });
  if (count > REVIEW_BODY_MAX) problems.push({ code: "body_long", count });

  const kinds = contactDetailsIn(fields.body);
  if (kinds.length > 0) problems.push({ code: "contact_details", kinds });

  if (fields.photos.length > MAX_REVIEW_PHOTOS) problems.push({ code: "too_many_photos" });
  return problems;
}

/**
 * Where a review photograph is stored.
 *
 * Under the supplier the review is about, like everything else in the media
 * bucket (`mediaPath`), then the enquiry — so a path names exactly one review's
 * subject, and a signed upload for one enquiry cannot be referenced from
 * another's review.
 */
export function reviewPhotoPath(businessId: string, enquiryId: string, filename: string): string {
  return `${businessId}/review/${enquiryId}/${safeName(filename)}`;
}

export function isReviewPhotoPath(businessId: string, enquiryId: string, path: string): boolean {
  const prefix = `${businessId}/review/${enquiryId}/`;
  if (!path.startsWith(prefix)) return false;
  const name = path.slice(prefix.length);
  return /^[a-z0-9][a-z0-9.-]{0,120}$/.test(name) && !name.includes("..");
}

/** A draft's stored `photos` column, read defensively: it is JSON a buyer's browser shaped. */
export function parsePhotoRefs(value: unknown): ReviewPhotoRef[] {
  if (!Array.isArray(value)) return [];
  const refs: ReviewPhotoRef[] = [];
  for (const item of value.slice(0, MAX_REVIEW_PHOTOS)) {
    if (!item || typeof item !== "object") continue;
    const { path, width, height, bytes } = item as Record<string, unknown>;
    if (typeof path !== "string" || path.length === 0) continue;
    const int = (n: unknown) => (Number.isInteger(n) && (n as number) > 0 ? (n as number) : null);
    refs.push({ path, width: int(width), height: int(height), bytes: int(bytes) });
  }
  return refs;
}

/**
 * The four dimension labels — board 1m's, in 1m's order. Board 10f `B2`.
 *
 * One map, and every surface that names a dimension reads it: this form, 1m's
 * RATED ON card and 11c's seller page. There were three: the form asked
 * *"It arrived when they said"*, the public card read *"Quote was accurate"*,
 * and the seller's rail read *"Answered quickly"* — the same four columns under
 * three sets of names, which is the defect the 10f handoff was exported to
 * correct.
 */
export const DIMENSION_LABEL = {
  quotedAccurate: "review.dimension.quotedAccurate",
  onTime: "review.dimension.onTime",
  asDescribed: "review.dimension.asDescribed",
  responsiveness: "review.dimension.responsiveness",
} as const satisfies Record<Dimension, string>;

/** The question under each label, on the form only. */
export const DIMENSION_HINT = {
  quotedAccurate: "reviewwrite.hint.quotedAccurate",
  onTime: "reviewwrite.hint.onTime",
  asDescribed: "reviewwrite.hint.asDescribed",
  responsiveness: "reviewwrite.hint.responsiveness",
} as const satisfies Record<Dimension, string>;

export const SCORES = [1, 2, 3, 4, 5] as const;

/** The word under each overall score, and the sentence beside a chosen one. */
export const OVERALL_WORD = {
  1: "reviewwrite.overall.word.1",
  2: "reviewwrite.overall.word.2",
  3: "reviewwrite.overall.word.3",
  4: "reviewwrite.overall.word.4",
  5: "reviewwrite.overall.word.5",
} as const;

export const OVERALL_SENTENCE = {
  1: "reviewwrite.overall.sentence.1",
  2: "reviewwrite.overall.sentence.2",
  3: "reviewwrite.overall.sentence.3",
  4: "reviewwrite.overall.sentence.4",
  5: "reviewwrite.overall.sentence.5",
} as const;
