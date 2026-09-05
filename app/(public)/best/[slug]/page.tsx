import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Eyebrow } from "@/components/display";
import { PublicShell } from "@/components/structure";
import { formatCount, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import {
  curatedList,
  MAX_REPLY_MS,
  MIN_REVIEWS,
  rfqRecipients,
  type Criterion,
  type CuratedListView,
} from "@/lib/seo/curated";
import { absoluteUrl } from "@/lib/site";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { JsonLd } from "@/app/(public)/_json-ld";
import { ListEntry } from "./ListEntry";
import { MethodPanel } from "./MethodPanel";
import { RfqCard, WhyWePublish } from "./Rail";

/**
 * Board 6b — a curated list.
 *
 * The entire value of this page rests on one claim about our own conduct being
 * verifiable by a reader who assumes we are lying. That is why the method is
 * printed in the hero rather than buried in a policy page, and it is why most of
 * what governs this file is in `lib/seo/curated/` rather than here.
 *
 * ## Nothing on this page is live
 *
 * Every figure comes from the snapshot taken on the audit date, and the page
 * states that date twice — the hero eyebrow and the method panel (acceptance 5).
 * The one exception is the RFQ recipient set, which is live because `1h`'s
 * free-plan cap rule is live and a card naming eight recipients the composer is
 * about to drop would be worse than one that named none.
 *
 * ## No sponsored slot, and not by configuration
 *
 * §5 makes this a route-level prohibition: no ad or sponsored component may
 * render under `/best/*`, asserted by a test on the rendered tree. The
 * enforcement is that this page does not compose `Results` — it has no filter
 * rail, no sponsored slot and no placement lookup — and
 * `tests/e2e/curated.spec.ts` fails if one appears.
 *
 * The other half of that is upstream: `lib/seo/curated/` does not reference
 * plan tier, ranking multiplier, boost or placement at all, and
 * `no-placement.test.ts` asserts the *absence* rather than a weight of zero.
 */

export const revalidate = 3600;

interface Props {
  params: Promise<{ slug: string }>;
}

/** §2: three Required and one Never, from the list's own record. */
function criterionLabel(criterion: Criterion): string {
  switch (criterion.key) {
    case "verified":
      return t("best.criterion.verified");
    case "reply":
      return t("best.criterion.reply", { hours: MAX_REPLY_MS / 3_600_000 });
    case "reviews":
      return t("best.criterion.reviews", { count: MIN_REVIEWS });
    case "placement":
      return t("best.criterion.placement");
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const list = await curatedList((await params).slug);
  if (!list) return {};

  return {
    title: list.title,
    description:
      list.standfirst ??
      t("best.considered", { considered: formatCount(list.consideredCount) }),
    alternates: { canonical: absoluteUrl(`/best/${list.slug}`) },
  };
}

export default async function CuratedListPage({ params }: Props) {
  const list = await curatedList((await params).slug);
  if (!list) notFound();

  /*
     §3 states: below the floor a list does not publish. `liveLists` keeps such
     a list out of the sitemap, and this keeps it off the web — a "best of" page
     naming three companies says the trade has almost nobody worth naming, which
     is never what we mean.
  */
  if (list.members.length === 0) notFound();

  const rfq = await rfqRecipients(list.members);
  const crumbs = [
    { label: t("chrome.directory"), href: "/" },
    { label: list.categoryName, href: `/c/${list.categorySlug}` },
    { label: list.title },
  ];

  /* §3: all twelve are server-rendered; the band expands in place. */
  const SHOWN = 3;
  const shown = list.members.slice(0, SHOWN);
  const rest = list.members.slice(SHOWN);

  /*
     §SEO, acceptance 14: a curated list with no link to the underlying area page
     strands the reader who wants the other two hundred companies. The board has
     no such link and it should.
  */
  const sourceHref =
    list.areaSlug && list.emirate
      ? `/${list.emirate}/${list.areaSlug}/${list.categorySlug}`
      : `/c/${list.categorySlug}`;
  const sourceLabel =
    list.areaName !== null
      ? t("best.area_link", {
          count: formatCount(list.consideredCount),
          category: list.categoryName,
          area: list.areaName,
        })
      : t("best.category_link", { category: list.categoryName });

  return (
    <PublicShell
      bleed
      /*
         §1: no active nav item. A curated list belongs to no top-level section
         and search is unscoped here — the reader arrived for a recommendation,
         not to browse an area. Deliberate; do not "fix" it by activating
         Categories.
      */
      nav={<DirectoryNav />}
      footer={<DirectoryFooter />}
    >
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: crumbs.map((crumb, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: crumb.label,
            ...("href" in crumb && crumb.href ? { item: absoluteUrl(crumb.href) } : {}),
          })),
        }}
      />
      {/*
         Acceptance 11: `ItemList` covers **all twelve**, including the ones
         behind "Continue the list". They are in the DOM either way — the band
         is a disclosure, not a fetch — and a list that marked up only what was
         open would describe a different page from the one served.

         Acceptance 12: no `FAQPage`. The method panel is not a FAQ, and marking
         it up as one to chase a rich result would be exactly the behaviour this
         page exists to distinguish us from.

         No `Review` or `aggregateRating` for the list either: the ratings belong
         to the members and are already on their storefronts.
      */}
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: list.title,
          numberOfItems: list.members.length,
          itemListElement: list.members.map((member) => ({
            "@type": "ListItem",
            position: member.rank,
            item: {
              "@type": "LocalBusiness",
              name: member.displayName,
              url: absoluteUrl(`/b/${member.slug}`),
              ...(member.areaName
                ? {
                    address: {
                      "@type": "PostalAddress",
                      addressLocality: member.areaName,
                      addressCountry: "AE",
                    },
                  }
                : {}),
            },
          })),
        }}
      />

      {/* ── Hero, on ink ───────────────────────────────────────────────── */}
      <section className="bg-ink-surface px-[var(--gutter)] pb-8 pt-6">
        <div className="mx-auto flex max-w-7xl flex-col items-start gap-8 lg:flex-row lg:items-end lg:gap-11">
          <div className="min-w-0 flex-1">
            <Eyebrow as="p" onInk>
              {t("best.eyebrow", {
                date: list.auditedAt ? formatDate(list.auditedAt) : "—",
              })}
              {list.entryRemovedAt !== null &&
                ` · ${t("best.entry_removed", { date: formatDate(list.entryRemovedAt) })}`}
            </Eyebrow>

            <h1 className="mt-4 max-w-[700px] font-serif text-display text-on-ink">
              {list.title}
            </h1>

            {/*
               §2: the criteria in a sentence, then "No one paid to be here."
               Four words, own sentence, load-bearing. Never soften it, never
               merge it into the preceding clause, never move it below the fold.
            */}
            {/*
               `text-[color:...]`, not `text-on-ink-muted`.

               `text-prose` is ambiguous: globals.css defines `--text-prose`
               twice, once as the long-form reading colour and once as a font
               size. Tailwind matches `text-prose` against both
               namespaces, so pairing it with a second `text-*` colour utility
               is a coin toss — and on ink the coin landed on the dark one and
               made the standfirst unreadable. `Blocks.tsx` writes
               `text-prose text-prose` for the same reason without saying so.

               So both halves are arbitrary here: the size names `--t-prose`
               and the colour names `--text-on-ink-muted`, and neither can be
               read as the other. Pairing `text-prose` with an arbitrary colour
               was not enough — the two utilities both set `color` and the one
               that wins is decided by Tailwind's own ordering, not by the class
               list. The token collision is noted where it lives.
            */}
            <p className="mt-4 max-w-[620px] text-[length:var(--t-prose)] leading-relaxed text-[color:var(--text-on-ink-muted)]">
              {list.standfirst ??
                t("best.considered", { considered: formatCount(list.consideredCount) })}
            </p>
          </div>

          <MethodPanel
            criteria={list.criteria}
            label={criterionLabel}
            auditedAt={list.auditedAt}
          />
        </div>
      </section>

      {/* ── Entries + rail ─────────────────────────────────────────────── */}
      <section className="bg-paper px-[var(--gutter)] py-9">
        <div className="mx-auto flex max-w-7xl flex-col gap-9 lg:flex-row lg:gap-11">
          <div className="min-w-0 flex-1">
            {/*
               §SEO: entry names are `h3` under an implicit `h2` for the list
               section; where the visible design has no `h2`, add one visually
               hidden rather than promoting the entries.
            */}
            <h2 className="sr-only">{t("best.list_heading")}</h2>

            <ol className="flex flex-col">
              {shown.map((member) => (
                <ListEntry key={member.id} member={member} />
              ))}
            </ol>

            {rest.length > 0 && (
              /*
                 §3: all twelve on one URL, expanding in place. Never
                 `/best/:slug/2` — splitting a curated list across URLs halves
                 the link equity that is the whole point of the page and leaves
                 the `ItemList` incomplete.

                 `<details>`, so it works with no JavaScript and every entry is
                 in the markup a crawler reads whether or not it is open.
              */
              <details className="group mt-5">
                <summary className="flex cursor-pointer flex-wrap items-center gap-4 rounded-card border border-line bg-card px-4 py-3.5 text-body-sm text-body marker:content-none group-open:hidden [&::-webkit-details-marker]:hidden">
                  <span className="font-mono text-eyebrow uppercase text-muted">
                    {t("best.remaining", {
                      from: String(SHOWN + 1).padStart(2, "0"),
                      to: String(list.members.length).padStart(2, "0"),
                    })}
                  </span>
                  <span>{t("best.remaining_body", { count: formatCount(rest.length) })}</span>
                  <span className="ms-auto rounded-ctl border border-line-strong bg-paper px-4 py-2 text-body-sm font-medium text-ink">
                    {t("best.continue")}
                  </span>
                </summary>
                <ol className="flex flex-col">
                  {rest.map((member) => (
                    <ListEntry key={member.id} member={member} />
                  ))}
                </ol>
              </details>
            )}

            {/* Acceptance 14. The reader who wants the other two hundred. */}
            <p className="mt-6 border-t border-line pt-5 text-body-sm">
              <a
                href={sourceHref}
                className="rounded-tag text-moss underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
              >
                {sourceLabel}
              </a>
            </p>
          </div>

          <div className="flex w-full shrink-0 flex-col gap-3.5 lg:w-[312px]">
            <RfqCard
              slug={list.slug}
              recipients={rfq.recipients.length}
              members={list.members.length}
            />
            <InThisList list={list} />
            {list.intro && <WhyWePublish intro={list.intro} />}
          </div>
        </div>
      </section>
    </PublicShell>
  );
}

/** §3's second rail card: jump links, first five plus the remainder. */
function InThisList({ list }: { list: CuratedListView }) {
  const SHOWN = 5;
  const rest = list.members.length - SHOWN;
  return (
    <nav
      aria-labelledby="in-this-list"
      className="rounded-card border border-line bg-card p-4"
    >
      <Eyebrow as="h2" id="in-this-list">
        {t("best.in_this_list")}
      </Eyebrow>
      <ol className="mt-3 flex flex-col gap-2">
        {list.members.slice(0, SHOWN).map((member) => (
          <li key={member.id}>
            <a
              href={`#entry-${member.rank}`}
              className="rounded-tag text-caption text-body underline-offset-2 hover:text-ink hover:underline focus-visible:outline-none focus-visible:shadow-focus"
            >
              <span className="font-mono tabular-nums text-muted">
                {String(member.rank).padStart(2, "0")}
              </span>{" "}
              {member.displayName}
            </a>
          </li>
        ))}
      </ol>
      {rest > 0 && (
        <p className="mt-2.5 text-caption text-muted">
          {t("best.more", { count: formatCount(rest) })}
        </p>
      )}
    </nav>
  );
}
