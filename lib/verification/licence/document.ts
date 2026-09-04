/**
 * Is this a trade licence, or something else with a stamp on it?
 *
 * Board 2b, criterion 8: a DHA card or a municipality permit uploaded instead
 * of a trade licence is caught on upload, with a notice naming what is needed.
 * Board `4b` lists it as a real queue reason, so catching it here saves a round
 * trip that currently costs a supplier four working hours and a second visit to
 * a screen they had finished with.
 *
 * Positive and negative evidence, and the negative wins. A Dubai Health
 * Authority professional licence says "licence" all over it, so looking only for
 * the word would pass every one of them. What tells them apart is the issuer and
 * the document's own title.
 *
 * Deliberately not a rejection. A low-confidence guess about somebody's document
 * is not grounds for refusing an upload — this returns a *warning* the screen
 * shows beside a file that is still there, and the claimant can submit anyway.
 * A reviewer sees the same signal. Being wrong here must cost a sentence, not a
 * claim.
 *
 * Pure, so the rules are testable without a file.
 */

export type DocumentVerdict =
  /** Reads like a trade licence. */
  | { kind: "trade_licence" }
  /** Reads like a different document, named. */
  | { kind: "other"; document: OtherDocument }
  /** Nothing to go on — no text extracted, or too little of it. */
  | { kind: "unknown" };

export type OtherDocument =
  | "health_authority"
  | "municipality_permit"
  | "vat_certificate"
  | "establishment_card"
  | "chamber_certificate"
  | "passport_or_id";

/**
 * What each looks like in the text of the document itself.
 *
 * Ordered by how often it is uploaded here by mistake, which is roughly how
 * often the issuer's name appears on something a supplier keeps in the same
 * folder as their licence.
 */
const OTHERS: readonly { document: OtherDocument; patterns: readonly RegExp[] }[] = [
  {
    document: "health_authority",
    patterns: [
      /\bdubai health authority\b/i,
      /\bdepartment of health\b/i,
      /\bministry of health\b/i,
      /\bprofessional licence\b/i,
      /\bprofessional license\b/i,
      /\bDHA\b/,
      /\bMOHAP\b/i,
    ],
  },
  {
    document: "municipality_permit",
    patterns: [/\bmunicipality\b/i, /\bbaladiya\b/i, /\bfood (safety|permit)\b/i, /\bhealth permit\b/i],
  },
  {
    document: "vat_certificate",
    patterns: [
      /\btax registration certificate\b/i,
      /\bfederal tax authority\b/i,
      /\bVAT registration\b/i,
      /\bTRN certificate\b/i,
    ],
  },
  {
    document: "establishment_card",
    patterns: [/\bestablishment card\b/i, /\bimmigration card\b/i, /\blabour card\b/i, /\bwork permit\b/i],
  },
  {
    document: "chamber_certificate",
    patterns: [/\bchamber of commerce\b/i, /\bcertificate of (membership|origin)\b/i],
  },
  {
    document: "passport_or_id",
    patterns: [/\bemirates id\b/i, /\bpassport no\b/i, /\bP<[A-Z]{3}/, /\bnationality\b/i],
  },
];

/** What a trade licence says that the others do not. */
const TRADE_LICENCE: readonly RegExp[] = [
  /\btrade licen[cs]e\b/i,
  /\bcommercial licen[cs]e\b/i,
  /\blicence details\b/i,
  /\bdepartment of economic development\b/i,
  /\beconomic development\b/i,
  /\blegal (form|status)\b/i,
  /\blicense activities\b/i,
  /\blicence activities\b/i,
  /\bfree zone (company|establishment)\b/i,
];

/** Below this there is not enough text to say anything, so it says nothing. */
const MIN_TEXT = 40;

export function classifyDocument(text: string | null | undefined): DocumentVerdict {
  const body = (text ?? "").trim();
  if (body.length < MIN_TEXT) return { kind: "unknown" };

  const tradeHits = TRADE_LICENCE.filter((pattern) => pattern.test(body)).length;

  /*
     The negative wins on a tie, and on more than a tie.

     A DHA professional licence carries "licence" and often an activity list, so
     a document scoring one trade-licence hit and a health-authority hit is far
     more likely to be the DHA card. Requiring the trade evidence to *beat* the
     other issuer keeps the common mistake caught, and the cost of being wrong
     is one dismissible sentence.
  */
  for (const other of OTHERS) {
    const hits = other.patterns.filter((pattern) => pattern.test(body)).length;
    if (hits > 0 && hits >= tradeHits) return { kind: "other", document: other.document };
  }

  return tradeHits > 0 ? { kind: "trade_licence" } : { kind: "unknown" };
}
