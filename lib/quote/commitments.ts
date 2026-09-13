/**
 * What the supplier committed to — board `7c`'s right rail, `B4`.
 *
 * *"Commitments are extracted from thread messages and attributed to the
 * supplier. No promised-date field for sellers to fill in — a form implies
 * tracking the platform does not do."*
 *
 * ## What "extracted" means here, and what it deliberately does not
 *
 * This **selects** sentences; it never **interprets** them. A sentence the
 * supplier wrote that carries a time — *"One drop, 40 valves and 120 couplings,
 * on 4 Sep"*, *"gaskets within 2 days of the drop"* — is shown word for word,
 * with the date the supplier said it.
 *
 * It does not parse *4 Sep* into a date and print that. A parser that reads
 * *"the 4th"* in a message sent on 30 August as 4 August has put a date on the
 * record that nobody said, on the one page whose whole claim is that it is what
 * was agreed. A wrong selection costs a sentence that is not a commitment; a
 * wrong interpretation costs the evidence. So the page shows the supplier's own
 * words and lets the buyer read them, which is also what *attributed, never
 * verified* asks for.
 *
 * Pure, with no database import, so the rules are tested rather than trusted.
 */

export interface CommitmentMessage {
  id: string;
  body: string;
  createdAt: Date;
}

export interface Commitment {
  /** The message the sentence came from — the evidence behind the line. */
  messageId: string;
  /** The supplier's sentence, verbatim apart from collapsed whitespace. */
  text: string;
  /** When the supplier said it. Not when it is due: see the module comment. */
  saidAt: Date;
}

/** Enough to be a statement, short enough to sit in a rail. */
const MAX_CHARS = 200;

/** The rail shows the most recent few, in the order they were said. */
export const MAX_COMMITMENTS = 5;

const MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
// Full names, and only the abbreviations that are not also English words:
// *sat*, *sun* and *mon* read as a verb, a noun and half a month.
const WEEKDAY = "(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day|tue|tues|wed|thu|thur|thurs|fri)";
const UNIT = "(?:hours?|hrs?|days?|weeks?|wks?|months?)";

/**
 * A sentence carries a time when it names one of these. Each alternative is a
 * shape a supplier in this trade actually writes; the tests hold one example of
 * each and one near-miss that must not match.
 */
const TIME_EXPRESSIONS: readonly RegExp[] = [
  // 4 Sep · 4th September · Sep 4 · September 4th
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}\\b`, "i"),
  new RegExp(`\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, "i"),
  // 04/09 · 04-09-26 — a day and a month, never a bare number, and never a pipe
  // size: *3/4 inch* and *1/2"* are fittings, not dates.
  /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b(?!\s*(?:inch|"|”|mm|bsp|npt))/i,
  // 4.9.2026 — with a year only. Two parts and a point is a price: *46.00*.
  /\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/,
  // Thursday · by Sun
  new RegExp(`\\b${WEEKDAY}\\b`, "i"),
  // today · tomorrow · tonight
  /\b(?:today|tomorrow|tonight)\b/i,
  // next week · this month · end of the week · end of month
  /\b(?:next|this|coming)\s+(?:week|month)\b/i,
  /\bend\s+of\s+(?:the\s+)?(?:week|month)\b/i,
  // within 2 days · in 3 weeks · 48 hours · 7 working days · 2-3 weeks · 2 to 3 days
  new RegExp(`\\b(?:within|in)\\s+\\d+(?:\\s*(?:-|to)\\s*\\d+)?\\s+(?:working\\s+|business\\s+)?${UNIT}\\b`, "i"),
  new RegExp(`\\b\\d+(?:\\s*(?:-|to)\\s*\\d+)?\\s+(?:working\\s+|business\\s+)?${UNIT}\\b`, "i"),
  // ex-stock · ex stock · same day
  /\bex[\s-]?stock\b/i,
  /\bsame[\s-]day\b/i,
];

/**
 * Split a message into sentences.
 *
 * On a full stop, question mark or exclamation followed by a space, and on line
 * breaks — suppliers write lists. A decimal (*191.00*) and a date (*4.9.26*)
 * have no space after the point, so they survive intact.
 */
export function sentencesOf(body: string): string[] {
  return body
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter((sentence) => sentence.length > 0);
}

/** Whether a single sentence reads as a statement with a time in it. */
export function isCommitment(sentence: string): boolean {
  // A question is the supplier asking, not stating. "Can you take delivery on
  // Thursday?" is not something they committed to.
  if (sentence.endsWith("?")) return false;
  return TIME_EXPRESSIONS.some((expression) => expression.test(sentence));
}

/**
 * The supplier's dated statements, oldest first, at most `MAX_COMMITMENTS`.
 *
 * The caller passes only the supplier's own messages — never the buyer's, never
 * an automatic follow-up, never one the off-platform detector flagged. Which
 * messages count is a question about the thread; this answers only which of
 * their sentences carry a time.
 *
 * When there are more than the rail holds, the most recent win: the last thing
 * a supplier said about a date is the one a buyer holds them to.
 */
export function extractCommitments(messages: readonly CommitmentMessage[]): Commitment[] {
  const seen = new Set<string>();
  const found: Commitment[] = [];

  const ordered = [...messages].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );

  for (const message of ordered) {
    for (const sentence of sentencesOf(message.body)) {
      if (!isCommitment(sentence)) continue;
      const text = sentence.length > MAX_CHARS ? `${sentence.slice(0, MAX_CHARS - 1).trimEnd()}…` : sentence;
      // The same sentence repeated in a later message is one statement, dated
      // the first time it was made.
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ messageId: message.id, text, saidAt: message.createdAt });
    }
  }

  return found.slice(-MAX_COMMITMENTS);
}
