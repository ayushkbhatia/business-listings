import { formatCount } from "@/lib/format/count";
import { formatDuration } from "@/lib/format/date";
import { t } from "@/lib/i18n";
import type { LandingFacts } from "./facts";

/**
 * The FAQ block on a landing page — criterion 3.
 *
 *   "FAQ answers derive from platform data and update as the data does."
 *
 * Which is a rule about what may *not* be written as much as what may. Every
 * answer below is assembled from `landingFacts`, and an answer whose number is
 * missing is not written at all — an omitted question is honest, and a question
 * answered with a hedge is the spun text the whole handoff exists to avoid.
 *
 * Not `server-only`: this is a pure function over numbers the page already
 * shows, and the unit tests call it directly.
 */

export interface FaqItem {
  /** Stable across renders, for the DOM id the disclosure needs. */
  id: string;
  question: string;
  answer: string;
}

/**
 * Below this, the median is one or two suppliers' habits rather than the
 * category's. `MIN_SAMPLE` in `lib/metrics/response-time.ts` guards the same
 * thing for one business; this guards it for a page about hundreds.
 */
export const MIN_REPLY_SAMPLE = 5;

/** How many emirates the location answer names before it stops listing. */
const EMIRATES_NAMED = 3;

export interface FaqScope {
  /** "Valves and fittings", or "HVAC in Al Quoz" for an area page. */
  subject: string;
}

export function landingFaq(scope: FaqScope, facts: LandingFacts): FaqItem[] {
  const items: FaqItem[] = [];
  const subject = scope.subject.toLowerCase();

  if (facts.listings > 0) {
    items.push({
      id: "how-many",
      question: t("faq.how_many.q", { subject: scope.subject }),
      answer: t("faq.how_many.a", {
        listings: formatCount(facts.listings),
        subject,
        verified: formatCount(facts.verified),
      }),
    });
  }

  if (facts.emirates.length > 0) {
    const named = facts.emirates.slice(0, EMIRATES_NAMED);
    const list = named
      .map((row) =>
        t("faq.where.item", {
          emirate: t(`emirate.${row.emirate}` as never),
          count: formatCount(row.listings),
        }),
      )
      .join(", ");
    items.push({
      id: "where",
      question: t("faq.where.q", { subject: scope.subject }),
      answer:
        facts.emirates.length > named.length
          ? t("faq.where.a_more", {
              list,
              rest: formatCount(facts.emirates.length - named.length),
            })
          : t("faq.where.a", { list }),
    });
  }

  /*
     Measured, never claimed — non-negotiable 6. The sample size is in the
     sentence rather than behind it, because "4 h" drawn from three suppliers
     and "4 h" drawn from ninety are different facts and a reader deciding
     whether to trust us is entitled to know which one this is.
  */
  if (facts.replyMedianMs !== null && facts.replyMeasurable >= MIN_REPLY_SAMPLE) {
    items.push({
      id: "reply-time",
      question: t("faq.reply.q", { subject: scope.subject }),
      answer: t("faq.reply.a", {
        median: formatDuration(facts.replyMedianMs),
        measurable: formatCount(facts.replyMeasurable),
      }),
    });
  }

  const stocked = facts.availability.find((row) => row.availability === "in_stock");
  const madeToOrder = facts.availability.find((row) => row.availability === "made_to_order");
  if (facts.products > 0 && (stocked || madeToOrder)) {
    items.push({
      id: "availability",
      question: t("faq.availability.q", { subject: scope.subject }),
      answer: t("faq.availability.a", {
        products: formatCount(facts.products),
        stocked: formatCount(stocked?.products ?? 0),
        madeToOrder: formatCount(madeToOrder?.products ?? 0),
      }),
    });
  }

  /*
     The price question is asked on every page of this kind and the answer is a
     policy rather than a number, so it is written once and stated plainly. It
     is the one item here that does not move with the data — because the thing
     it describes does not move either.
  */
  if (facts.listings > 0) {
    items.push({ id: "price", question: t("faq.price.q"), answer: t("faq.price.a") });
  }

  return items;
}

/** `FAQPage` structured data, from exactly the items the page renders. */
export function faqJsonLd(items: readonly FaqItem[]): Record<string, unknown> {
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
