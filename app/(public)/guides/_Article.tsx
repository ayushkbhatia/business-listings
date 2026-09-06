import Link from "next/link";
import { buttonClassName } from "@/components/primitives";
import { blockItems, blockLine, guideBlockSpec, type GuideBlock } from "@/lib/guides/blocks";
import { t } from "@/lib/i18n";

/**
 * A guide's body, rendered — board 6d.
 *
 * Six kinds of paragraph. Nothing here queries anything: a guide is prose with
 * a destination, and the destination is the one piece of data on the page.
 *
 * A block whose kind has left the vocabulary is skipped rather than thrown on,
 * the same call `readGuideBlocks`, `readBlocks` and `resolveSections` all make.
 */

export interface GuideBodyProps {
  blocks: readonly GuideBlock[];
  /** Where the call-to-action block points. Null sends the reader to search. */
  cta: { slug: string; name: string } | null;
  /** Sellers with a licence checked and currently valid. A query, never a constant. */
  verifiedCount?: number;
}

/**
 * A paragraph, with `[label](/path)` links rendered as links.
 *
 * Acceptance 10 counts in-body links into the directory, and `directoryLinks`
 * reads exactly this syntax out of the prose — so it has to render, or the
 * publish gate would be counting something the reader never sees. That would be
 * the worst of both: an article held back for a link that does not exist on the
 * page, or passed for one.
 *
 * Deliberately only links. Not a markdown renderer: bold, headings and images
 * inside a paragraph all have block kinds of their own or are refused on
 * purpose, and a half-parser invites writers to try the rest.
 *
 * Internal paths only. `href` is matched against a leading slash, so a writer
 * cannot put an external destination into body prose by accident — an outbound
 * link from a guide is a decision, not a typo.
 */
const LINK = /\[([^\]]+)\]\((\/[^)\s]+)\)/g;

export function ProseText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;

  for (const match of text.matchAll(LINK)) {
    const at = match.index;
    if (at > last) parts.push(text.slice(last, at));
    parts.push(
      <Link
        key={`${at}-${match[2]}`}
        href={match[2] as string}
        className="rounded-tag text-brand underline underline-offset-2 hover:text-brand-ink focus-visible:outline-none focus-visible:shadow-focus"
      >
        {match[1]}
      </Link>,
    );
    last = at + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));

  return <>{parts}</>;
}

export function GuideBody({ blocks, cta, verifiedCount }: GuideBodyProps) {
  const ctaHref = cta ? `/c/${cta.slug}` : "/search";
  const ctaLabel = cta ? t("guides.cta_category", { category: cta.name }) : t("guides.cta_default");

  return (
    <div className="flex flex-col gap-5">
      {blocks.map((block) => {
        if (!guideBlockSpec(block.kind)) return null;

        switch (block.kind) {
          case "heading":
            return (
              /*
                 h2, not h1. The article title is the page's only h1 — a second
                 one costs the outline that the whole page type is built to
                 present, and it is the mistake the storefront page route made
                 in handoff 4 step 3.
              */
              /*
                 The anchor is the block id, matching `guideHeadings`. Not a
                 slug of the text: renaming a heading would change its anchor
                 and break every link anybody had shared into that section.
              */
              /*
                 The offset is the site bar, and the site bar has two heights.

                 `PublicNav` states its own arithmetic: 68px while it is one row
                 and 112px once it wraps, which it does below `sm` because the
                 search field cannot share a row with the wordmark and the
                 action button on a phone. With the bottom border that is 69px
                 and 113px. A flat `scroll-mt-24` was 96px — 27px of clearance
                 over the one-row bar, and 17px *underneath* the wrapped one, so
                 following a contents entry on a phone landed the heading behind
                 the bar. 140px keeps the same 27px on the taller bar.
              */
              <h2
                id={`s-${block.id}`}
                key={block.id}
                className="mt-4 scroll-mt-35 text-h2 text-ink sm:scroll-mt-24"
              >
                {blockLine(block, "text")}
              </h2>
            );

          case "text":
            return (
              <p
                key={block.id}
                className="max-w-[var(--measure-article)] text-article text-[color:var(--text-prose)]"
              >
                <ProseText text={blockLine(block, "body")} />
              </p>
            );

          case "list":
            return (
              <ul
                key={block.id}
                className="flex max-w-[var(--measure-article)] list-disc flex-col gap-2 ps-5 text-article text-[color:var(--text-prose)]"
              >
                {blockItems(block, "items").map((item, i) => (
                  <li key={`${block.id}-${i}`}>{item}</li>
                ))}
              </ul>
            );

          case "steps":
            return (
              /*
                 §4: an ink disc with a mono numeral, for a procedure rather than
                 a list of considerations. `list-none`, because the disc *is* the
                 marker — a decimal marker beside it would number every step
                 twice.

                 The step titles are deliberately not headings. Four `h3`s named
                 "Ask for the licence…" would compete with the article's `h2`s in
                 the outline, and the contents rail is built from those.
              */
              <ol
                key={block.id}
                className="flex max-w-[var(--measure-article)] list-none flex-col gap-4"
              >
                {blockItems(block, "items").map((item, i) => (
                  <li key={`${block.id}-${i}`} className="flex gap-4">
                    <span
                      aria-hidden
                      className="mt-0.5 flex size-[26px] shrink-0 items-center justify-center rounded-pill bg-ink-surface font-mono text-eyebrow tabular-nums text-on-ink"
                    >
                      {i + 1}
                    </span>
                    <span className="text-article text-[color:var(--text-prose)]">{item}</span>
                  </li>
                ))}
              </ol>
            );

          case "quote":
            return (
              /*
                 §4's pull quote: a 2px moss left border on a card fill. For the
                 one sentence a reader should leave with.

                 A `blockquote`, not a styled paragraph — it is a quotation in
                 the document's structure whether or not it is attributed, and
                 the element is what says so to a reader who cannot see the rule.
              */
              <blockquote
                key={block.id}
                className="max-w-[var(--measure-article)] border-s-2 border-moss bg-card px-5 py-5 text-[length:var(--t-prose)] leading-relaxed text-[color:var(--text-prose)]"
              >
                {blockLine(block, "body")}
              </blockquote>
            );

          case "callout":
            return (
              <aside
                key={block.id}
                className="max-w-[var(--measure-prose)] rounded-card border border-line bg-card px-5 py-4"
              >
                {blockLine(block, "label") && (
                  <p className="font-mono text-eyebrow uppercase text-muted">
                    {blockLine(block, "label")}
                  </p>
                )}
                <p className="mt-1.5 text-article text-[color:var(--text-prose)]">
                  {blockLine(block, "body")}
                </p>
              </aside>
            );

          case "cta":
            return (
              /*
                 Every guide ends in the directory — that is what a guide is
                 for. Two ways in: the trade the article is about, and the
                 requirement form for a reader who does not know which trade
                 they need. Both are real links to pages that return results.
              */
              <aside
                key={block.id}
                className="max-w-[var(--measure-prose)] rounded-card border border-brand-line bg-brand-wash px-5 py-4"
              >
                <p className="text-article text-[color:var(--text-prose)]">
                  {blockLine(block, "body") || t("guides.cta_fallback")}
                </p>
                {/*
                   One destination, not two.

                   This carried a second link to the RFQ composer. Board 6d Q5
                   removes it: *"No RFQ on guides. The closing CTA sends them to
                   the directory, which is the right next step for someone still
                   learning. Adding a fan-out composer to an article about due
                   diligence would contradict the article."*

                   A reader of this page has not chosen a trade yet. `6a` and
                   `6b` both carry the prompt because their readers have.
                */}
                <div className="mt-3.5">
                  <Link href={ctaHref} className={buttonClassName({ size: "sm" })}>
                    {blockLine(block, "label") || ctaLabel}
                  </Link>
                </div>
                {verifiedCount !== undefined && (
                  /*
                     Acceptance 9. A query, and it says what it counts — the nav
                     counts listings plus catalogue products and this counts
                     sellers whose licence is checked and current. The two are
                     not comparable, and the sentence is written so nothing
                     invites the comparison.
                  */
                  <p data-caption className="mt-2.5 text-caption text-muted">
                    {t("guides.cta_count", { count: verifiedCount })}
                  </p>
                )}
              </aside>
            );

          default:
            return null;
        }
      })}
    </div>
  );
}
