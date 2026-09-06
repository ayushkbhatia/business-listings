import Link from "next/link";
import { Eyebrow } from "@/components/display";
import { buttonClassName } from "@/components/primitives";
import { formatCount, formatDate } from "@/lib/format";
import type { GuideIndex, GuideIndexCard, GuideShelf } from "@/lib/guides/queries";
import { t } from "@/lib/i18n";

/**
 * Board 10b — the guide index, and the internal link hub for the programme.
 *
 * One structural obligation: **link to everything it is the hub for.** The
 * board showed one featured article plus six cards and then a `Show all 22`
 * button, so fifteen articles were absent from the document and had no inbound
 * link from their own index. Every published guide is a plain `<a href>` here,
 * server-rendered, and there is no disclosure anywhere on the page — on mobile
 * either, where a collapsed index would be the button this board exists to
 * remove.
 *
 * The rich cards and the `Every guide` block deliberately overlap. That is
 * ordinary internal linking and it costs nothing; what matters is that no guide
 * is reachable only through JavaScript.
 *
 * **The metadata tones are `--text-body`, not `--text-muted`.** Criterion 14
 * asks for every tone at 4.5:1 or better, and `--text-muted` is 4.23:1 on paper
 * and 4.46:1 on card — the gap `docs/design-system.md` §09.2 has open across the
 * system. This page carries more small mono metadata than any other public
 * surface: a read time and a review date on every row, twice over. Rather than
 * ship eight axe violations and call the token gap pre-existing, these use
 * `--text-body` at 9.4:1, which is the token for "body at small sizes" and is
 * what these lines are. It is a page choice and moves no token, so it lands
 * nowhere else.
 *
 * **There is no lead image.** The board draws one on the featured slot and one
 * per card, and board 6b — the sibling surface on this same handoff — already
 * settled the same question the other way: *"the layout must not reserve an
 * empty 220×160 box."* Today no guide has an image and nothing can give one
 * one, so a "typographic fallback at the same dimensions" would be a decorative
 * empty rectangle on every card on the page. When images have an owner, the
 * slot goes back where 6b's comment says it goes back.
 */

const CARDS = 6;

export function GuideIndexView({
  index,
  subject,
}: {
  /**
   * The whole index, always — never the filtered subset.
   *
   * The chips, the `All` count and the author strip describe the programme, so
   * a subject view that handed this the shelf's guides made `All 0` render on a
   * page where the answer was two. The filter narrows what is listed below and
   * nothing else.
   */
  index: GuideIndex;
  /** The chip in force, or null for the whole index. */
  subject: { slug: string; name: string; blurb: string | null } | null;
}) {
  const total = index.all.length;
  const visible = subject
    ? (index.shelves.find((shelf) => shelf.slug === subject.slug)?.guides ?? [])
    : index.all;
  const count = visible.length;

  /*
     §States: "A subject filter with one result — renders as a single card, not
     a featured layout", and a featured hero belongs to the whole index rather
     than to one shelf. So the hero is the unfiltered view's only.
  */
  const featured = subject === null ? index.featured : null;
  const rest = visible.filter((card) => card.slug !== featured?.slug);

  return (
    <>
      {/* ── 2 · Hero, on ink ─────────────────────────────────────────── */}
      <section className="bg-ink-surface px-[var(--gutter)] pb-8 pt-7">
        <div className="mx-auto max-w-7xl">
          <Eyebrow as="p" onInk>
            {t("guides.eyebrow")}
          </Eyebrow>

          <h1 className="mt-4 max-w-[760px] font-serif text-display text-on-ink">
            {subject ? t("guides.subject_title", { subject: subject.name }) : t("guides.index_h1")}
          </h1>

          {/*
             Both halves arbitrary, for the reason board 6b writes out at
             length: `--text-prose` is defined twice in globals.css — once as a
             colour and once as a size — so `text-prose` matches both
             namespaces and pairing it with a second colour utility is decided
             by Tailwind's ordering rather than by the class list. On ink the
             coin lands on the dark one.
          */}
          <p className="mt-4 max-w-[620px] text-[length:var(--t-prose)] leading-relaxed text-[color:var(--text-on-ink-muted)]">
            {subject?.blurb ??
              (total === 0
                ? t("guides.index_lede_empty")
                : t("guides.index_lede", { count: total }))}
          </p>

          {/*
             The strip claims the checking, not the authorship.

             The board's headline named the verification team as the authors
             while every article ships without a byline — board 6d Q1, open.
             What is true and recorded is the check: every date on this page is
             an audited `recordRegulatoryCheck`, and the two numbers below are
             queries over those dates.
          */}
          {total > 0 && (
            <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-ink-line pt-4">
              <div>
                <p className="text-body-sm text-on-ink">{t("guides.strip_claim")}</p>
                <p className="mt-1 font-mono text-eyebrow uppercase tabular-nums text-on-ink-muted">
                  {index.lastReviewPass
                    ? t("guides.strip_meta", {
                        date: formatDate(index.lastReviewPass),
                        guides: t("guides.meta", { count: total }),
                        // §States: never suppressed when it reads nought —
                        // that is the number that makes 6f's queue get worked.
                        reviewed: formatCount(index.reviewedThisQuarter),
                      })
                    : t("guides.strip_meta_unchecked", {
                        guides: t("guides.meta", { count: total }),
                      })}
                </p>
              </div>
              <Link
                href="/guides/how-we-check"
                className="rounded-tag text-body-sm text-on-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus-on-ink"
              >
                {t("guides.strip_link")} →
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* ── 3 · Chips ────────────────────────────────────────────────── */}
      {/*
         Rendered whenever a shelf has a name, including when there is only
         one. Criterion 9 asks for the subject views to be "reachable from the
         chips", and a page whose only route to them is a heading inside the
         index block meets that by accident rather than by design. §States
         settles the other end: a subject with no guides has no chip, which
         falls out of `shelves` carrying only subjects that have any.
      */}
      {index.shelves.some((shelf) => shelf.slug !== null) && (
        <nav aria-label={t("guides.chips_label")} className="border-b border-line bg-paper">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-[var(--gutter)] py-3">
            {/*
               Real anchors, not buttons. §3: "each is also a real URL so the
               subject views are crawlable and linkable" — and the count on
               every chip is the same query as the heading and the standfirst,
               so unpublishing one guide moves all of them together.
            */}
            <Chip href="/guides" active={subject === null}>
              {t("guides.chip_all", { count: total })}
            </Chip>
            {index.shelves.map((shelf) => (
              <Chip
                key={shelf.slug ?? "unfiled"}
                href={shelf.slug ? `/guides/${shelf.slug}` : undefined}
                active={subject?.slug === shelf.slug}
              >
                {shelfName(shelf)} <span className="tabular-nums">{shelf.guides.length}</span>
              </Chip>
            ))}
          </div>
        </nav>
      )}

      <div className="mx-auto max-w-7xl px-[var(--gutter)]">
        {count === 0 ? (
          <div className="my-8 max-w-[var(--measure-prose)] rounded-card border border-line bg-card px-5 py-4">
            <p className="text-body-sm text-ink">
              {subject ? t("guides.subject_empty") : t("guides.empty")}
            </p>
            <p className="mt-1.5 text-body-sm text-prose">{t("guides.empty_body")}</p>
            <Link
              href="/"
              className="mt-3 inline-block rounded-tag text-body-sm text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
            >
              {t("notfound.home")}
            </Link>
          </div>
        ) : (
          <>
            {featured && <Featured card={featured} />}

            {/*
               §States: "One guide published — no featured slot, no card grid,
               no Every guide block. Just the article, presented as the
               article. A hub over one item is not a hub."
            */}
            {count === 1 && !featured && <Solo card={visible[0] as GuideIndexCard} />}

            {rest.length > 0 && count > 1 && (
              <ul className="mt-8 grid gap-x-8 gap-y-7 border-t border-line pt-7 md:grid-cols-2 lg:grid-cols-3">
                {rest.slice(0, CARDS).map((card) => (
                  <Card key={card.slug} card={card} />
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {/* ── 6 · Every guide ──────────────────────────────────────────── */}
      {/*
         Rendered when it adds a link, not when it repeats one.

         At twenty-two guides the block is the page's link structure: the
         featured slot and six cards reach seven of them and this reaches the
         other fifteen. At two it reaches nothing the reader cannot already see
         a few centimetres higher, and printing both articles twice under a
         heading reading "Nothing here is behind a button" is the twenty-two
         layout worn at a size it was not drawn for. Nothing is hidden either
         way — that is the test, and it is the same test criterion 1 asserts.
      */}
      {total > CARDS + 1 && (
        <section className="mt-9 border-t border-line bg-card">
          <div className="mx-auto max-w-7xl px-[var(--gutter)] py-8">
            <h2 className="text-h2 text-ink">
              {t("guides.every_guide")}{" "}
              <span className="text-body-sm font-normal text-body">
                {t("guides.every_guide_note")}
              </span>
            </h2>

            {/* §Responsive: 4 columns at 1440, 3 from 1280, 2 from 768, one below. */}
            <div className="mt-6 grid gap-x-8 gap-y-8 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {index.shelves.map((shelf) => (
                <Shelf key={shelf.slug ?? "unfiled"} shelf={shelf} />
              ))}
            </div>

            <div className="mt-8 flex flex-wrap items-start justify-between gap-4 border-t border-line pt-4">
              <p className="max-w-[var(--measure-prose)] text-caption text-body">
                {t("guides.dates_note")}
              </p>
              {/*
                 The second link into the directory. §SEO: the page links into
                 it at least twice — the featured CTA and this line — because
                 that is what the guide programme is for.
              */}
              <Link
                href="/search"
                className="shrink-0 rounded-tag text-body-sm text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
              >
                {t("guides.browse_directory")} →
              </Link>
            </div>
          </div>
        </section>
      )}
    </>
  );
}

function shelfName(shelf: GuideShelf): string {
  return shelf.slug === null ? t("guides.unfiled") : shelf.name;
}

function Chip({
  href,
  active,
  children,
}: {
  href?: string;
  active: boolean;
  children: React.ReactNode;
}) {
  const className = `inline-flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-body-sm ${
    active ? "border-ink bg-ink text-on-ink" : "border-line bg-paper text-ink hover:border-brand-line"
  } focus-visible:outline-none focus-visible:shadow-focus`;

  /*
     The unfiled shelf has no URL because it is not a subject — it is the
     absence of one. It still gets a chip so the count is visible, and the
     guides under it are still linked in the block below.
  */
  if (!href) return <span className={className}>{children}</span>;
  return (
    <Link href={href} className={className} aria-current={active ? "page" : undefined}>
      {children}
    </Link>
  );
}

/** §4 — the editorial slot. The label says editorial, because it is. */
function Featured({ card }: { card: GuideIndexCard }) {
  return (
    <article className="border-b border-line py-8">
      <p className="flex flex-wrap items-center gap-2">
        <span className="rounded-pill bg-ink px-2 py-0.5 font-mono text-eyebrow uppercase tracking-wide text-on-ink">
          {t("guides.start_here")}
        </span>
        <Meta card={card} />
      </p>

      <h2 className="mt-3 max-w-[840px] font-serif text-h1-serif text-ink">
        <Link
          href={`/guides/${card.slug}`}
          className="rounded-tag underline-offset-4 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
        >
          {card.title}
        </Link>
      </h2>

      <p className="mt-3 max-w-[var(--measure-prose)] text-prose text-prose">{card.standfirst}</p>
      {/*
         The editor's sentence, not a constant.

         It said "read this one first: it is where we set out what our
         verification badge covers" beside whatever article held the slot — true
         of the trade-licence guide and false the moment somebody moved the slot
         to another one. It travels with the slot now, and an empty one renders
         nothing rather than something generic.
      */}
      {card.featuredNote && (
        <p className="mt-2.5 max-w-[var(--measure-prose)] text-body-sm text-body">
          {card.featuredNote}
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-3">
        <Link href={`/guides/${card.slug}`} className={buttonClassName({ size: "md" })}>
          {t("guides.read_the_guide")}
        </Link>
        {/* §4: the directory CTA, and no RFQ composer — 6d Q5 settled that a
            reader this early has not chosen a trade yet. */}
        <Link href="/search" className={buttonClassName({ variant: "secondary", size: "md" })}>
          {t("guides.browse_suppliers")}
        </Link>
      </div>
    </article>
  );
}

/** The whole page when there is one guide. A hub over one item is not a hub. */
function Solo({ card }: { card: GuideIndexCard }) {
  return (
    <>
      <Featured card={card} />
      <p className="mt-4 max-w-[var(--measure-prose)] text-caption text-body">
        {t("guides.one_guide_note")}
      </p>
    </>
  );
}

/** §5 — a card. No image: see the file docblock. */
function Card({ card }: { card: GuideIndexCard }) {
  return (
    <li>
      <p>
        <Meta card={card} />
      </p>
      {/* §SEO: card titles are not headings. The featured heading and the
          subject headings are the page's only `h2`s. */}
      <p className="mt-2 text-body-sm font-medium text-ink">
        <Link
          href={`/guides/${card.slug}`}
          className="rounded-tag underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
        >
          {card.title}
        </Link>
      </p>
      <p className="mt-1.5 text-caption leading-relaxed text-prose">{card.summary}</p>
    </li>
  );
}

/** One column of the index — a subject, its count, and every guide under it. */
function Shelf({ shelf }: { shelf: GuideShelf }) {
  const headingId = `shelf-${shelf.slug ?? "unfiled"}`;
  return (
    <section aria-labelledby={headingId}>
      <h2
        id={headingId}
        className="flex items-baseline gap-2 border-b border-line pb-2 font-mono text-eyebrow uppercase text-body"
      >
        {shelf.slug ? (
          <Link
            href={`/guides/${shelf.slug}`}
            className="rounded-tag underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
          >
            {shelf.name}
          </Link>
        ) : (
          shelfName(shelf)
        )}
        <span className="tabular-nums">· {shelf.guides.length}</span>
      </h2>

      {shelf.slug === null && (
        <p className="mt-2 text-caption text-body">{t("guides.unfiled_blurb")}</p>
      )}

      <ul className="mt-1">
        {shelf.guides.map((card) => (
          <li key={card.slug} className="border-b border-line py-2.5">
            <Link
              href={`/guides/${card.slug}`}
              className="rounded-tag text-body-sm text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
            >
              {card.title}
            </Link>
            <p className="mt-1">
              <Meta card={card} short />
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Read time, review date, and overdue — as text.
 *
 * Criterion 5: overdue is conveyed as text, not colour alone. `--warn-ink`
 * carries the tone the board draws and the words carry the meaning, so a reader
 * who cannot separate the two colours reads the same sentence.
 */
function Meta({ card, short = false }: { card: GuideIndexCard; short?: boolean }) {
  const { checkedAt, overdue } = card.freshness;
  const subject = card.subject?.name;

  const label = checkedAt
    ? short || !subject
      ? t("guides.entry_meta", { minutes: card.readMinutes, date: formatDate(checkedAt) })
      : t("guides.card_meta", {
          subject,
          minutes: card.readMinutes,
          date: formatDate(checkedAt),
        })
    : short || !subject
      ? t("guides.entry_meta_unchecked", { minutes: card.readMinutes })
      : t("guides.card_meta_unchecked", { subject, minutes: card.readMinutes });

  return (
    <>
      {/*
         `text-caption`, not `text-eyebrow`.

         Criterion 14 reserves 9.5px mono for eyebrows and pill labels and puts
         metadata at 10px and prose at 11.5px; §Responsive closes with "body
         text never below 12.5px in the index rows". A read time and a review
         date are metadata, and "Review overdue" is the one phrase on the page
         that admits a fact against us — setting it in the smallest type the
         system has would be the quiet version of hiding it.
      */}
      <span className="font-mono text-caption uppercase tabular-nums text-body">{label}</span>
      {overdue && (
        <>
          {" · "}
          <span className="font-mono text-caption uppercase text-warn-ink">
            {t("guides.entry_overdue")}
          </span>
        </>
      )}
    </>
  );
}
