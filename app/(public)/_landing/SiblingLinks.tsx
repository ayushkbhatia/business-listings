import { Eyebrow } from "@/components/display";
import type { LandingLink } from "@/lib/seo/landing";

/**
 * Board 6a §6 — three equal columns of inline links, and the internal link
 * graph for the whole page class.
 *
 * *"This block is the internal link graph for the whole page class and the
 * reason a new area page gets crawled at all."*
 *
 * The rule that governs it is one sentence and it is absolute: **no entry is
 * ever rendered for an unpublished page** — not greyed, not plain text, not a
 * `span`. `lib/seo/landing/links.ts` decides; nothing here filters, so there is
 * one place the rule lives.
 *
 * A column with nothing in it does not render its heading either. An eyebrow
 * over an empty row is a section announcing that it has nothing, which is the
 * cold-start state reading as broken rather than as honest.
 */

export interface SiblingColumn {
  key: string;
  heading: string;
  links: readonly LandingLink[];
}

export function SiblingLinks({ columns }: { columns: readonly SiblingColumn[] }) {
  const filled = columns.filter((column) => column.links.length > 0);
  if (filled.length === 0) return null;

  return (
    <section className="bg-card px-[var(--gutter)] py-6">
      <div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-3 md:gap-10">
        {filled.map((column) => (
          <nav key={column.key} aria-labelledby={`siblings-${column.key}`}>
            <Eyebrow as="p" id={`siblings-${column.key}`}>
              {column.heading}
            </Eyebrow>
            {/*
               A list, separated by a rendered `·`. The separator is a list
               style rather than content, so it is `aria-hidden` — a screen
               reader announcing "middle dot" eight times between eight links is
               the punctuation being read as the page.
            */}
            <ul className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2">
              {column.links.map((link, index) => (
                <li key={link.href} className="flex items-center gap-2">
                  {index > 0 && (
                    <span aria-hidden className="text-line-strong">
                      ·
                    </span>
                  )}
                  <a
                    href={link.href}
                    className="rounded-tag text-caption text-moss underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
    </section>
  );
}
