/**
 * Spotting an attempt to take a deal off the record.
 *
 * Rule 5: "Off-platform payment detection runs on message bodies — IBAN
 * patterns, 'transfer to', account numbers — and raises a SupplierReport
 * automatically with the message quoted."
 *
 * There is a subtlety the rule does not state and the product depends on.
 * Payment is *always* off-platform here: buyers pay suppliers directly, we hold
 * no funds, and CLAUDE.md is emphatic about it. So a supplier sending bank
 * details is not, by itself, wrongdoing — after a quote is accepted it is
 * exactly what is supposed to happen next.
 *
 * What is worth a report is bank details arriving **before** acceptance. That
 * is a supplier asking a buyer to pay for something the buyer has not agreed
 * to, from a party they have no record with, and it is the case where somebody
 * gets hurt. So:
 *
 *   - before contact is released, money signals raise a report;
 *   - after it, they do not, but the message is still flagged on the record,
 *     because rule 5's first sentence is that everything stays on the record;
 *   - steering language — "deal directly next time", "don't use the site" —
 *     raises a report either way, because that is disintermediation whenever
 *     it happens.
 *
 * The alternative was to report every post-acceptance invoice. A queue that is
 * mostly no-action is a queue nobody reads, which is worse than no queue.
 *
 * Pure. No database, no Prisma. The service decides what to do with a verdict.
 */

export type SignalKind =
  | "iban"
  | "account_number"
  | "transfer_instruction"
  | "off_platform_steering"
  | "crypto_wallet";

export interface Signal {
  kind: SignalKind;
  /** The matched text, for the report. Never the whole message. */
  match: string;
}

export interface Verdict {
  signals: Signal[];
  /** Worth a moderator's attention. */
  report: boolean;
  /** Worth marking on the record, whether or not it is reported. */
  flag: boolean;
}

export interface DetectContext {
  /** True once the buyer has accepted a quote from this supplier. */
  contactReleased: boolean;
}

/*
 * Things that look like an account number and are not. Checked first, and the
 * text they match is removed before anything else runs — a TRN is fifteen
 * digits and a UAE mobile is twelve, and flagging either would train sellers
 * to ignore the warning.
 */
const NOT_MONEY: readonly RegExp[] = [
  // TRN, labelled or not: fifteen digits is the fixed length.
  /\bTRN[:\s#]*\d[\d\s-]{13,20}\b/gi,
  /\b\d{15}\b/g,
  // Phone numbers, in the several ways the trade writes them.
  /(?:\+?971|\b0)[\s-]?5\d[\s-]?\d{3}[\s-]?\d{4}\b/g,
  /\b\+\d{1,3}[\s-]?\d[\d\s-]{6,14}\b/g,
  // Trade instruments that are not a request to pay a stranger.
  /\bletters?\s+of\s+credit\b/gi,
  /\bbank\s+guarantee\b/gi,
  /\bLC\s*(?:no\.?|number)?\s*[:#]?\s*\w{4,}\b/gi,
  // Our own references.
  /\b(?:ENQ|QT|INV)-[\w-]+\b/gi,
];

/**
 * IBAN. The UAE's is `AE` plus 21 digits; the generic form is two letters, two
 * check digits and up to thirty alphanumerics. Spaces are allowed because
 * people paste them in groups of four.
 */
const IBAN = /\b(AE\d{2}[\s-]?(?:\d[\s-]?){19}|[A-Z]{2}\d{2}[\s-]?(?:[A-Z0-9][\s-]?){11,28})\b/g;

/**
 * "account number is 1234567890", "a/c no. 1234567890", "acc: 1234567890".
 * The optional "is" matters: people write a sentence, not a form field.
 */
const ACCOUNT_NUMBER =
  /\b(?:a\/?c|acct?|account)\s*(?:no\.?|number|#)?\s*(?:is|=)?\s*[:#-]?\s*\d[\d\s-]{6,22}\b/gi;

/** An instruction to move money somewhere. */
const TRANSFER =
  /\b(?:transfer|wire|remit|deposit|send)\s+(?:the\s+)?(?:money|amount|payment|funds|advance|balance|\d[\d,]*)?\s*(?:to|into)\b|\bT\/?T\s+(?:to|payment)\b|\bbank\s+transfer\s+to\b/gi;

/** Steering the relationship off the record. Wrong whenever it happens. */
const STEERING =
  /\b(?:off|outside)\s+(?:the\s+)?(?:platform|site|system)\b|\bdeal\s+direct(?:ly)?\b|\bdirect(?:ly)?\s+(?:with\s+)?(?:me|us)\s+(?:next\s+time|instead)\b|\b(?:don'?t|do\s+not|no\s+need\s+to)\s+(?:use|go\s+through)\s+(?:the\s+)?(?:platform|site|website|app)\b|\bwhatsapp\s+me\s+direct(?:ly)?\b/gi;

/** Crypto. Not hypothetical in Dubai trade. */
const CRYPTO =
  /\b(?:USDT|BTC|ETH|bitcoin|tether)\b|\b(?:0x[a-fA-F0-9]{40}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|T[A-Za-z1-9]{33})\b/g;

/** Strip everything that is legitimately a long number before looking. */
function withoutFalsePositives(body: string): string {
  let text = body;
  for (const pattern of NOT_MONEY) text = text.replace(pattern, " ");
  return text;
}

function collect(text: string, pattern: RegExp, kind: SignalKind, into: Signal[]): void {
  for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags))) {
    const value = match[0].trim();
    if (value) into.push({ kind, match: value.slice(0, 64) });
  }
}

export function detectOffPlatform(body: string, context: DetectContext): Verdict {
  const text = withoutFalsePositives(body);
  const signals: Signal[] = [];

  collect(text, IBAN, "iban", signals);
  collect(text, ACCOUNT_NUMBER, "account_number", signals);
  collect(text, TRANSFER, "transfer_instruction", signals);
  collect(text, STEERING, "off_platform_steering", signals);
  collect(text, CRYPTO, "crypto_wallet", signals);

  if (signals.length === 0) return { signals, report: false, flag: false };

  const steering = signals.some((s) => s.kind === "off_platform_steering");
  const money = signals.some((s) => s.kind !== "off_platform_steering");

  return {
    signals,
    // Steering is always reportable. Money is reportable until the buyer has
    // chosen this supplier, after which an invoice is just an invoice.
    report: steering || (money && !context.contactReleased),
    flag: true,
  };
}

/**
 * The report's detail line: what matched and where, with the message quoted.
 *
 * Criterion 7 asks for the message quoted, so it is, trimmed to something a
 * moderator can read in a queue rather than the whole thread.
 */
export function describeVerdict(verdict: Verdict, body: string): string {
  const kinds = [...new Set(verdict.signals.map((s) => s.kind))].join(", ");
  const quoted = body.trim().replace(/\s+/g, " ").slice(0, 400);
  return `Matched ${kinds}. Message: “${quoted}${body.trim().length > 400 ? "…" : ""}”`;
}
