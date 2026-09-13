/**
 * Whether a piece of builder prose states a price, a fee or a rate — board
 * `5c-s` B4 and acceptance criterion 4. Pure.
 *
 * Every other public surface keeps non-negotiable 1 by having no price field.
 * The builder is the exception: its free-text fields — a hero headline, an
 * offer body, a template page's blocks — exist to put words on a page that
 * lands on every storefront in a sector. So this is the check those words pass.
 *
 * ## What it catches, and what it deliberately does not
 *
 * A money figure is a currency beside a number, either way round — *AED 5,000*,
 * *5k dirhams*, *Dhs 40*. A rate is a number per unit — *350/hour*, *120 per
 * visit*. A price word within a short reach of a number — *fees from 2,500*.
 * A discount is a percentage beside *off*, *discount* or *save*.
 *
 * It does **not** catch a bare percentage (*98% filed on time* is a measured
 * claim, not a rate), a year, a count (*218 suppliers*), or a currency named
 * without a figure (*invoiced in AED*). A check that refused every number would
 * be routed around by writing numbers as words, which is the one outcome worse
 * than the check missing something.
 */

const CURRENCY = String.raw`(?:aed|dhs?\.?|dirhams?|usd|us\$|eur|gbp|sar|\$|€|£)`;
const NUMBER = String.raw`\d[\d,.]*\s*(?:k|m|mn|bn|thousand|million)?`;

const PATTERNS: readonly RegExp[] = [
  // AED 5,000 · Dhs. 40 · $300
  new RegExp(String.raw`(?:^|[^a-z])${CURRENCY}\s*${NUMBER}`, "i"),
  // 5,000 AED · 5k dirhams
  new RegExp(String.raw`${NUMBER}\s*${CURRENCY}(?![a-z])`, "i"),
  // 350/hour · 120 per visit · 40 a metre
  new RegExp(
    String.raw`\d[\d,.]*\s*(?:\/|per\s+|an?\s+)(?:hour|hr|day|week|month|year|visit|return|filing|job|metre|meter|sq\.?\s*(?:ft|m)|sqm|m2|kg|unit|piece)\b`,
    "i",
  ),
  /*
     fees from 2,500 · price: 40 · rates starting at 90

     The number has to follow the word through a connector, not merely sit in
     the same sentence: *first-rate work since 2009* and *response rate within
     2 hours* are not prices, and a looser reach refused both.
  */
  /\b(?:prices?|priced|pricing|fees?|rates?|costs?|charges?|tariffs?)\s*(?:from|starting\s+(?:at|from)|start\s+(?:at|from)|of|at|:|=|is|are)?\s*(?:only\s+|just\s+)?\d/i,
  // 20% off · 15 percent discount
  /\d+(?:\.\d+)?\s*(?:%|percent|per\s*cent)\s*(?:off|discount|cheaper|less|saving)/i,
  // save 20% · up to 30% off
  /\b(?:save|discount|off)\s*(?:up\s*to\s*)?\d+(?:\.\d+)?\s*(?:%|percent)/i,
];

export function statesAPrice(text: string): boolean {
  const flat = text.normalize("NFKC");
  return PATTERNS.some((pattern) => pattern.test(flat));
}

/** The first string among many that states one, for a refusal that can say where. */
export function firstPriced(texts: Iterable<string>): string | null {
  for (const text of texts) if (statesAPrice(text)) return text;
  return null;
}
