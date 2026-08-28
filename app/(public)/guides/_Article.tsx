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
}

export function GuideBody({ blocks, cta }: GuideBodyProps) {
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
              <h2 key={block.id} className="mt-2 text-h2 text-ink">
                {blockLine(block, "text")}
              </h2>
            );

          case "text":
            return (
              <p key={block.id} className="max-w-[var(--measure-prose)] text-prose text-prose">
                {blockLine(block, "body")}
              </p>
            );

          case "list":
            return (
              <ul
                key={block.id}
                className="flex max-w-[var(--measure-prose)] list-disc flex-col gap-2 ps-5 text-prose text-prose"
              >
                {blockItems(block, "items").map((item, i) => (
                  <li key={`${block.id}-${i}`}>{item}</li>
                ))}
              </ul>
            );

          case "steps":
            return (
              <ol
                key={block.id}
                className="flex max-w-[var(--measure-prose)] list-decimal flex-col gap-2 ps-5 text-prose text-prose"
              >
                {blockItems(block, "items").map((item, i) => (
                  <li key={`${block.id}-${i}`}>{item}</li>
                ))}
              </ol>
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
                <p className="mt-1.5 text-body-sm text-prose">{blockLine(block, "body")}</p>
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
                <p className="text-body-sm text-prose">
                  {blockLine(block, "body") || t("guides.cta_fallback")}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <Link href={ctaHref} className={buttonClassName({ size: "sm" })}>
                    {blockLine(block, "label") || ctaLabel}
                  </Link>
                  <a
                    href="/rfq/new"
                    className="rounded-tag text-body-sm text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                  >
                    {t("guides.cta_rfq")}
                  </a>
                </div>
              </aside>
            );

          default:
            return null;
        }
      })}
    </div>
  );
}
