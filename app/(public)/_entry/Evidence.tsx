import { Eyebrow } from "@/components/display";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * The argument column: measured numbers, then attributed quotes.
 *
 * Numbers first, deliberately. §08 says specific beats enthusiastic, and a
 * count somebody can check does more work than a sentence somebody was paid
 * for. The quotes are the softer half and sit under them.
 *
 * Both sections disappear rather than pad themselves — the home page's rule.
 * A fact whose count is zero is dropped by the caller, and a page with no
 * published quotes renders no quote heading at all.
 */

export interface CountedFact {
  /** The number. Already known to be non-zero. */
  value: number;
  /** What it counts, in words. */
  label: string;
}

export interface TestimonialView {
  id: string;
  body: string;
  attribution: string;
  context: string | null;
}

export function CountedFacts({ facts }: { facts: readonly CountedFact[] }) {
  if (facts.length === 0) return null;

  return (
    <section>
      <Eyebrow as="h2">{t("entry.facts_title")}</Eyebrow>
      <dl className="mt-3 grid gap-4 sm:grid-cols-2">
        {facts.map((fact) => (
          <div key={fact.label} className="border-t border-line pt-3">
            <dt className="text-body-sm text-muted">{fact.label}</dt>
            <dd className="mt-0.5 font-mono text-h2 tabular-nums text-ink">
              {formatCount(fact.value)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function Testimonials({ quotes }: { quotes: readonly TestimonialView[] }) {
  if (quotes.length === 0) return null;

  return (
    <section className="mt-8">
      <Eyebrow as="h2">{t("entry.quotes_title")}</Eyebrow>
      <ul className="mt-3 space-y-5">
        {quotes.map((quote) => (
          <li key={quote.id} className="border-t border-line pt-3">
            <figure>
              {/*
                A blockquote, not a styled paragraph. Somebody else said this
                and the markup should say so — it is the same argument as the
                attribution being NOT NULL in the table.
              */}
              <blockquote className="max-w-[var(--measure-prose)] text-prose text-prose">
                {quote.body}
              </blockquote>
              <figcaption className="mt-2 text-body-sm text-ink">
                {quote.attribution}
                {quote.context ? (
                  <span className="block text-caption text-muted">{quote.context}</span>
                ) : null}
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </section>
  );
}
