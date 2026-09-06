import Link from "next/link";
import { Eyebrow } from "@/components/display";
import { t } from "@/lib/i18n";
import type { GuideRelatedCard } from "@/lib/guides/queries";

/**
 * Board 6d §6 — the right rail, two cards.
 */

/**
 * RELATED GUIDES — three, chosen by an editor rather than by tag similarity.
 *
 * §6 gives the sharp reason: *"A guide that covers a section this article does
 * not must appear here."* That is how "Free zone vs mainland" resolved — it is
 * a separate article, so it is a link rather than a heading in this one, and
 * two of our own pages never target the same query.
 *
 * Absent rather than empty on the first article published. §States: it does not
 * render an empty card or placeholder links.
 */
export function RelatedGuides({ guides }: { guides: readonly GuideRelatedCard[] }) {
  if (guides.length === 0) return null;

  return (
    <nav aria-labelledby="related-guides" className="rounded-card border border-line bg-card p-4">
      <Eyebrow as="h2" id="related-guides">
        {t("guides.related")}
      </Eyebrow>
      <ul className="mt-3 flex flex-col gap-3">
        {guides.map((guide) => (
          <li key={guide.slug}>
            <Link
              href={`/guides/${guide.slug}`}
              className="rounded-tag text-caption font-medium leading-snug text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
            >
              {guide.title}
            </Link>
            {/* Computed from that article's own word count, never authored. */}
            <p className="mt-1 font-mono text-eyebrow uppercase text-muted">
              {t("guides.related_minutes", { minutes: guide.readMinutes })}
            </p>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * §6's second card — the acquisition purpose, stated plainly.
 *
 * The same move `6b`'s "why we publish the criteria" card makes: the page
 * saying what it is for, rather than leaving a reader to work out why a
 * directory is publishing an article about trade licences.
 */
export function WhyWeWrite() {
  return (
    <section
      aria-labelledby="why-we-write"
      className="rounded-card border border-line bg-paper-sunk p-4"
    >
      <h2 id="why-we-write" className="text-body-sm font-medium text-ink">
        {t("guides.why_title")}
      </h2>
      <p className="mt-2 text-caption leading-relaxed text-body">{t("guides.why_body")}</p>
    </section>
  );
}
