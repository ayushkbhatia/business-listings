import { classifyDocument, type DocumentVerdict } from "./document";
import { normaliseLicenceNumber } from "./number";

/**
 * Pull a licence number and an expiry out of extracted text.
 *
 * Separate from whatever produced the text. An OCR provider's job is bytes to
 * characters; this is characters to two fields, and it is the half worth testing
 * — the parsing is where a UAE licence's own conventions live, and they do not
 * change when the provider does.
 *
 * Everything here reports a confidence and nothing here is trusted. Board 2b:
 * "OCR on a photographed licence is unreliable, and a locked wrong value is
 * worse than an empty one." Both fields stay editable on screen, and what was
 * read is stored beside what was submitted so a reviewer can see the difference.
 *
 * Pure.
 */

export interface Extraction {
  licenceNumber: string | null;
  /** Midnight UTC on the printed day. */
  licenceExpiry: Date | null;
  /** 0..1. What the caller renders as "we could not read this". */
  confidence: number;
  document: DocumentVerdict;
}

/** Below this the screen shows empty fields and asks the claimant to type. */
export const LOW_CONFIDENCE = 0.5;

/**
 * Dates on a UAE licence are printed day-first — `14/04/2027`.
 *
 * That matters more than it looks: `04/05/2027` is the fourth of May here and
 * the fifth of April to an American parser, and a licence read eleven months
 * wrong is a badge granted or withheld for eleven months. Day-first only, and a
 * value that cannot be day-first is refused rather than guessed.
 */
const NUMERIC_DATE = /\b(\d{1,2})\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{4})\b/g;

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
const WRITTEN_DATE = /\b(\d{1,2})[\s-]+([a-z]{3,9})[\s-]+(\d{4})\b/gi;

/** The words a licence prints beside the date that ends it. */
const EXPIRY_CUE = /(expiry|expires?|valid\s*(un)?til|valid\s*to|انتهاء)/i;
/** And beside the one it started on, which must not be mistaken for it. */
const ISSUE_CUE = /(issue[ds]?|issuance|from|إصدار)/i;

export function extractLicence(text: string | null | undefined, authority: string): Extraction {
  const body = (text ?? "").replace(/\r/g, "");
  const document = classifyDocument(body);

  const licenceNumber = findNumber(body, authority);
  const licenceExpiry = findExpiry(body);

  /*
     Confidence is about how much was found, and then about whether the document
     is the right one at all. A perfectly legible VAT certificate should not
     hand a claimant two confident fields off the wrong paper.
  */
  let confidence = 0;
  if (licenceNumber) confidence += 0.5;
  if (licenceExpiry) confidence += 0.4;
  if (document.kind === "trade_licence") confidence += 0.1;
  if (document.kind === "other") confidence = Math.min(confidence, LOW_CONFIDENCE - 0.01);

  return {
    licenceNumber,
    licenceExpiry,
    confidence: Math.round(Math.min(1, confidence) * 100) / 100,
    document,
  };
}

/**
 * The number, preferring one that follows the word "licence".
 *
 * A licence carries other numbers — a TRN, a P.O. box, a phone. Anchoring on
 * the label first is what keeps a fifteen-digit TRN out of a six-digit field.
 */
function findNumber(body: string, authority: string): string | null {
  const labelled =
    /licen[cs]e\s*(?:no\.?|number|#)?\s*[:.\-]?\s*([A-Z]{0,8}[\s\-–—]?\d[\d\s\-–—]{2,})/i.exec(body);
  const candidate = labelled?.[1] ?? new RegExp(`\\b${escape(authority)}[\\s\\-–—]?\\d[\\d\\s\\-–—]{2,}`, "i").exec(body)?.[0];
  if (!candidate) return null;

  const result = normaliseLicenceNumber(candidate.trim(), authority);
  return result.ok ? result.value : null;
}

/**
 * The expiry, and never the issue date.
 *
 * A licence prints both, usually a line apart. Taking the later of two dates
 * would be a rule that works until somebody's licence was issued after a
 * back-dated renewal, so the cue words decide: a date on a line mentioning
 * issuance is skipped outright, and one on a line mentioning expiry wins. With
 * neither cue, the latest remaining date is the best available guess and the
 * confidence says so.
 */
function findExpiry(body: string): Date | null {
  const cued: Date[] = [];
  const uncued: Date[] = [];

  for (const line of body.split("\n")) {
    const dates = datesIn(line);
    if (dates.length === 0) continue;
    if (EXPIRY_CUE.test(line)) cued.push(...dates);
    else if (!ISSUE_CUE.test(line)) uncued.push(...dates);
  }

  const pool = cued.length > 0 ? cued : uncued;
  if (pool.length === 0) return null;
  return pool.reduce((latest, date) => (date > latest ? date : latest));
}

function datesIn(line: string): Date[] {
  const found: Date[] = [];

  for (const match of line.matchAll(NUMERIC_DATE)) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    // Day-first, or nothing. A month above twelve is a parser's clue that the
    // fields are the other way round, and guessing is what this refuses to do.
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    found.push(utc(year, month - 1, day));
  }

  for (const match of line.matchAll(WRITTEN_DATE)) {
    const month = MONTHS[(match[2] ?? "").slice(0, 3).toLowerCase()];
    if (month === undefined) continue;
    found.push(utc(Number(match[3]), month, Number(match[1])));
  }

  return found;
}

/** Midnight UTC, so a licence does not expire an hour early in one timezone. */
function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
