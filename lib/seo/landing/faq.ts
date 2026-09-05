import "server-only";
import { formatCount } from "@/lib/format/count";
import { t } from "@/lib/i18n";
import { QUOTE_RANGE_TOKEN } from "./limits";
import { quoteRangeFor } from "./quote-range";
import type { LandingFaqRow, LandingScope } from "./scope";

/**
 * Board 6a §5 — the FAQ block, and the one number in it that is measured.
 *
 * *"The questions are per-scope editorial, not a shared list with the area name
 * substituted in. Two of them should be answerable only for this area."*
 *
 * Which is why this function does not write questions. It takes the rows a
 * person wrote and resolves the one live token they may carry — and drops any
 * row whose token has no number behind it.
 *
 * ## Why a token at all
 *
 * The board's first question is *"What does a chiller AMC cost in Dubai?"*, and
 * the honest answer contains a range, a sample size and a window. All three
 * move. A writer who typed the numbers into the answer would be writing a fact
 * with a shelf life and nothing to remind them when it expired; a generated
 * sentence would be the spun text the gate exists to keep out. So the person
 * writes the sentence and says where the number goes, and the number is
 * measured at render.
 *
 * ## Why the whole row disappears
 *
 * §States: *"below the 30-quote minimum sample the row **does not render**. It
 * does not render a range from 4 quotes and it does not say 'not enough
 * data'."* A missing question is honest. A question answered with a hedge tells
 * the reader we will hedge, which is the thing a directory cannot afford.
 *
 * The dropped row still counts towards the publish gate, and that is
 * deliberate: the gate is about whether a person wrote four questions for this
 * scope, and they did. What renders is four minus whatever cannot be answered
 * today, which is the same discipline as a reply band that is absent rather
 * than "unknown".
 */

export interface ResolvedFaqItem {
  /** Stable across renders, for the heading id the block needs. */
  id: string;
  question: string;
  answer: string;
}

export { QUOTE_RANGE_TOKEN } from "./limits";

/** `{quote_range}` — the placeholder a writer types into the answer. */
const TOKEN_PATTERN = /\{quote_range\}/g;

export async function resolveLandingFaq(
  scope: LandingScope,
  rows: readonly LandingFaqRow[],
  now = new Date(),
): Promise<ResolvedFaqItem[]> {
  const needsRange = rows.some((row) => row.liveToken === QUOTE_RANGE_TOKEN);
  const range = needsRange ? await quoteRangeFor(scope, now) : null;

  const items: ResolvedFaqItem[] = [];
  for (const row of rows) {
    if (row.liveToken === QUOTE_RANGE_TOKEN) {
      // No number, no row. Criterion 11.
      if (!range) continue;
      items.push({
        id: `faq-${row.position}`,
        question: row.question,
        answer: row.answer.replace(
          TOKEN_PATTERN,
          t("landing.faq.quote_range", {
            low: formatCount(range.low),
            high: formatCount(range.high),
            sample: formatCount(range.sample),
            months: range.windowMonths,
          }),
        ),
      });
      continue;
    }

    /*
       An unrecognised token is a row a writer half-finished. Dropped rather
       than rendered with braces in it: the failure of shipping it is a page
       that visibly leaks its own template, on the surface a stranger meets
       first.
    */
    if (row.liveToken !== null) continue;
    items.push({ id: `faq-${row.position}`, question: row.question, answer: row.answer });
  }
  return items;
}

/** `FAQPage` structured data, from exactly the items the page renders. */
export function landingFaqJsonLd(items: readonly ResolvedFaqItem[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}
