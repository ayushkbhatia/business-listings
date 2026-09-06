import { Eyebrow } from "@/components/display";
import { t } from "@/lib/i18n";
import type { GuideHeading } from "@/lib/guides/blocks";

/**
 * Board 6d §3 — the contents rail, derived and never authored.
 *
 * The board carried a hand-written list of six against an article with three
 * headings: two entries pointed at nothing and one pointed at a different
 * guide entirely. §3 is blunt about why that must not be an authored field —
 * *"a hand-maintained contents list drifts from the article on the first
 * edit, and every entry is an anchor link, so drift means broken in-page
 * navigation on the page class we most want crawled."*
 *
 * So the headings come from the rendered blocks and the anchors are the block
 * ids, which means renaming a heading cannot break a link somebody shared.
 *
 * ## No current-section highlight
 *
 * The board draws the current entry at 500 weight. Doing that honestly needs an
 * `IntersectionObserver` and a client component, on a page whose whole value is
 * that it is a fast static article — and the alternative, highlighting the
 * first entry always, would be decoration claiming to be state. Left out until
 * it is worth a client boundary.
 */
export function Contents({ headings }: { headings: readonly GuideHeading[] }) {
  return (
    <nav
      aria-labelledby="on-this-page"
      className="border-s border-line ps-3.5 lg:sticky lg:top-24"
    >
      <Eyebrow as="h2" id="on-this-page">
        {t("guides.on_this_page")}
      </Eyebrow>
      <ol className="mt-3 flex flex-col gap-2.5">
        {headings.map((heading) => (
          <li key={heading.id}>
            <a
              href={`#${heading.id}`}
              className="rounded-tag text-caption leading-snug text-body underline-offset-2 hover:text-ink hover:underline focus-visible:outline-none focus-visible:shadow-focus"
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * The same list under 1024, as a disclosure closed by default.
 *
 * §Responsive: *"contents rail becomes a collapsed 'On this page' disclosure
 * above the standfirst, closed by default."* One list in the markup either way
 * would have been better still, but a sticky rail and a disclosure are
 * different elements and CSS cannot turn one into the other — so both render
 * and the one that does not apply is hidden, which is what the breakpoints in
 * `className` say.
 */
export function ContentsDisclosure({ headings }: { headings: readonly GuideHeading[] }) {
  return (
    <details className="rounded-card border border-line bg-card px-4 py-3 lg:hidden">
      <summary className="cursor-pointer font-mono text-eyebrow uppercase text-muted marker:content-none [&::-webkit-details-marker]:hidden">
        {t("guides.on_this_page")}
      </summary>
      <ol className="mt-3 flex flex-col gap-2.5">
        {headings.map((heading) => (
          <li key={heading.id}>
            <a
              href={`#${heading.id}`}
              className="rounded-tag text-caption leading-snug text-body underline-offset-2 hover:text-ink hover:underline focus-visible:outline-none focus-visible:shadow-focus"
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ol>
    </details>
  );
}
