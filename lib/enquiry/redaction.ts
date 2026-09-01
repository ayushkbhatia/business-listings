/**
 * Deciding whether an open RFQ is safe to show a stranger.
 *
 * Board 1a puts four live requirements on the home page — the most-crawled,
 * least-authenticated surface the platform has — and the panel's own note calls
 * it "the most sensitive thing on the page". The rule it states is absolute:
 * no buyer identity at any granularity finer than an emirate, and a requirement
 * carrying a phone number, an email, an IBAN or a company name is suppressed
 * rather than masked.
 *
 * Suppressed, not masked, and that is the whole design. Masking leaves the
 * shape of what was removed — "call me on +971 5• ••• ••88" still says a mobile
 * was there, and enough masked fragments across four rows reconstruct a person.
 * Dropping the row costs one of four slots and leaks nothing. The panel's other
 * rule, never pad, is what makes that affordable: three rows is a fine panel.
 *
 * ## Why this is not `detectOffPlatform`
 *
 * The spec says "the same detector as the message thread", and the two share a
 * purpose — spotting contact details in free text — but not a definition of a
 * hit. `lib/messaging/off-platform.ts` deliberately *strips* phone numbers and
 * TRNs before it looks, because a supplier's own number in a quote thread is
 * not wrongdoing and flagging it would train sellers to ignore the warning.
 *
 * Here a phone number is the single most identifying thing a requirement can
 * carry. Reusing that detector unchanged would pass "call Ahmed on 050 641 2288
 * at Gulf Cool" as clean. So the IBAN and crypto patterns are reused from it,
 * and everything else is inverted: what that file treats as a false positive,
 * this one treats as the signal.
 *
 * Pure, and no database. The caller decides what to do with a verdict, and the
 * unit tests can therefore cover the whole rule without a fixture.
 */

import { detectOffPlatform } from "@/lib/messaging/off-platform";

export type LeakKind =
  | "phone"
  | "email"
  | "url"
  | "handle"
  | "iban"
  | "company_name"
  | "trn";

export interface LeakVerdict {
  /** True when the text must not be shown to a stranger. */
  leaks: boolean;
  kinds: LeakKind[];
}

/**
 * Any run of digits long enough to be a phone number, in the several ways the
 * trade writes one. Deliberately loose: a false positive costs one row on a
 * panel that is allowed to show three, and a false negative publishes a
 * buyer's mobile.
 */
const PHONE: readonly RegExp[] = [
  // +971 50 641 2288, 00971506412288, 0506412288, 04 885 1122.
  /(?:\+|00)\s?\d{1,3}[\s.-]?\d[\d\s.()-]{6,16}\d/,
  /\b0\d[\d\s.()-]{6,12}\d\b/,
  // A bare run of 7 or more digits. A quantity is written "120×" or "500
  // units"; a seven-digit bare number in a requirement is a number to call.
  /\b\d{7,}\b/,
];

const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;

/** A website is a way to identify a company, and often is the company. */
const URL = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:ae|com|net|org|co)\b/i;

/** "@algulf", "wa.me/...", "t.me/..." — a handle is a contact detail. */
const HANDLE = /(?:^|\s)@[a-z0-9._-]{3,}|\b(?:wa\.me|t\.me|instagram\.com|linkedin\.com)\b/i;

/** Fifteen digits, labelled or not. A TRN identifies a company exactly. */
const TRN = /\bTRN[:\s#]*\d[\d\s-]{13,20}|\b\d{15}\b/i;

/**
 * Legal forms, not company names.
 *
 * A general-purpose company-name detector does not exist — "Gulf Cool" is two
 * ordinary words — so this looks for the tokens a UAE company name is legally
 * obliged to carry. It catches "Al Waha Industrial Supplies LLC" and misses
 * "Al Waha", which is the right trade: the miss is a fragment a stranger cannot
 * resolve, and widening it to ordinary nouns would suppress every requirement
 * mentioning a brand of valve.
 *
 * Word-bounded and case-insensitive. `\bEst\b` would fire on "established", so
 * the abbreviations that are also English words carry their full stop.
 */
const COMPANY_FORM =
  /\b(?:L\.?L\.?C|F\.?Z\.?E|F\.?Z\.?C\.?O|FZ-?LLC|W\.?L\.?L|P\.?J\.?S\.?C|P\.?S\.?C|LTD|LIMITED|CO\.|COMPANY|CORPORATION|ENTERPRISES|ESTABLISHMENT|EST\.|SOLE\s+PROPRIETORSHIP|GENERAL\s+TRADING|TRADING\s+L)\b/i;

/**
 * Does this requirement identify anybody?
 *
 * Returns every kind that matched rather than the first, because the admin
 * screen that lists suppressed requirements has to say why — "suppressed" with
 * no reason is a moderation decision nobody can check.
 */
export function detectIdentityLeak(text: string): LeakVerdict {
  const kinds: LeakKind[] = [];

  if (EMAIL.test(text)) kinds.push("email");
  if (TRN.test(text)) kinds.push("trn");
  if (PHONE.some((pattern) => pattern.test(text))) kinds.push("phone");
  if (URL.test(text)) kinds.push("url");
  if (HANDLE.test(text)) kinds.push("handle");
  if (COMPANY_FORM.test(text)) kinds.push("company_name");

  /*
   * The money half, borrowed rather than rewritten. `contactReleased: false`
   * is the strict reading — before any acceptance — which is what an open RFQ
   * on a public page is by definition.
   */
  const money = detectOffPlatform(text, { contactReleased: false });
  if (money.signals.some((signal) => signal.kind === "iban")) kinds.push("iban");

  return { leaks: kinds.length > 0, kinds };
}

/** The panel's own question, said the way the panel asks it. */
export function isSafeToPublish(text: string): boolean {
  return !detectIdentityLeak(text).leaks;
}
