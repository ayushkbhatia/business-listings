import type { Metadata } from "next";
import Link from "next/link";
import { CategoryMark, Eyebrow } from "@/components/display";
import { PublicShell } from "@/components/structure";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { emirateMatrix, emiratePagePath, MATRIX_EMIRATES } from "@/lib/seo/emirate";
import { categoryIndex } from "@/lib/seo/taxonomy";
import { DEFAULT_THRESHOLDS } from "@/lib/publish-threshold";
import { absoluteUrl } from "@/lib/site";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { JsonLd } from "@/app/(public)/_json-ld";

/**
 * Board 6c — the category index.
 *
 * Two jobs, and the second is the reason it exists. A buyer who does not know
 * which trade their need falls under scans twelve sectors and picks one; and
 * this is the crawlable spine, the page that links to every published
 * subcategory and every published emirate×sector page. Without it those pages
 * are orphans and most of them are never crawled.
 *
 * Everything about the layout follows from the second job. It is a link surface
 * with enough structure to be useful to a person, not a marketing page with
 * links added — so there is no pagination, no "load more", and nothing that
 * needs JavaScript to produce an anchor. A crawler sees every link in one
 * response.
 *
 * ## The rule this page makes visible
 *
 * A generated page publishes only above three floors: listings, verified share
 * and words of intro copy. Everywhere else that rule is invisible. Here it is
 * the difference between a number that is a link and a number that is not, and
 * criterion 3 is emphatic about the form that takes — a below-threshold cell
 * contains **no anchor element at all**. Not a disabled link, not `href="#"`.
 *
 * Both halves read `emirateMatrix`, and so does `sitemap.ts`. That is what
 * makes the set of links here and the set of URLs there identical rather than
 * merely intended to be.
 */

export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const [sectors, matrix] = await Promise.all([categoryIndex(), emirateMatrix()]);
  const published = sectors.reduce(
    (total, sector) => total + sector.children.filter((child) => child.publishable).length,
    0,
  );
  const listings = matrix.reduce((total, row) => total + row.listings, 0);

  return {
    title: t("categories.seo_title", {
      sectors: sectors.length,
      subcategories: formatCount(published),
    }),
    description: t("categories.seo_description", {
      sectors: sectors.length,
      subcategories: formatCount(published),
      listings: formatCount(listings),
    }),
    alternates: { canonical: absoluteUrl("/categories") },
  };
}

export default async function CategoriesPage() {
  const [sectors, matrix] = await Promise.all([categoryIndex(), emirateMatrix()]);

  /*
     Published subcategories only, everywhere on this page.

     "An unpublished one is not listed at all — not greyed, not shown. It does
     not exist to a crawler." So the header count, the five links in each block
     and the overflow number all count the same set, and none of them can
     advertise a page that would tell Google not to index it.
  */
  const publishedChildren = new Map(
    sectors.map((sector) => [
      sector.id,
      [...sector.children]
        .filter((child) => child.publishable)
        .sort((a, b) => b.listings - a.listings || a.name.localeCompare(b.name)),
    ]),
  );
  const publishedCount = [...publishedChildren.values()].reduce(
    (total, children) => total + children.length,
    0,
  );

  const listings = matrix.reduce((total, row) => total + row.listings, 0);
  const livePages = matrix.reduce(
    (total, row) => total + row.cells.filter((cell) => cell.live).length,
    0,
  );
  // Sectors in the order the matrix put them: by size, biggest first.
  const ordered = matrix.map((row) => ({
    row,
    sector: sectors.find((sector) => sector.id === row.id),
  }));

  return (
    <PublicShell bleed nav={<DirectoryNav active="categories" />} footer={<DirectoryFooter />}>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: t("chrome.directory"), item: absoluteUrl("/") },
            {
              "@type": "ListItem",
              position: 2,
              name: t("categories.title"),
              item: absoluteUrl("/categories"),
            },
          ],
        }}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: t("categories.title"),
          url: absoluteUrl("/categories"),
          hasPart: matrix.map((row) => ({
            "@type": "CollectionPage",
            name: row.name,
            url: absoluteUrl(`/c/${row.slug}`),
          })),
        }}
      />

      {/* ── 2 · Header ────────────────────────────────────────────────── */}
      <section className="border-b border-line bg-paper">
        <div className="mx-auto max-w-7xl px-5 pt-9 pb-6">
          <h1 className="font-serif text-[2.125rem] leading-[1.15] tracking-[-0.015em] text-ink">
            {t("categories.title")}
          </h1>
          <p className="mt-2.5 text-body text-body">
            {/*
               Four live numbers. The subcategory count is published
               subcategories rather than rows in the table — the spec is blunt
               about it: "do not advertise pages that 404."
            */}
            {t("categories.lede", {
              sectors: sectors.length,
              subcategories: formatCount(publishedCount),
              emirates: MATRIX_EMIRATES.length,
              listings: formatCount(listings),
            })}
          </p>
        </div>
      </section>

      {/* ── 3 · Sector grid ───────────────────────────────────────────── */}
      <section className="border-b border-line bg-card">
        <div className="mx-auto grid max-w-7xl gap-x-10 gap-y-8 px-5 py-8 md:grid-cols-2 xl:grid-cols-3">
          {ordered.map(({ row, sector }) => {
            const children = publishedChildren.get(row.id) ?? [];
            const shown = children.slice(0, 5);
            const overflow = children.length - shown.length;

            return (
              <div key={row.id}>
                <div className="flex items-center gap-2.5 border-b border-line pb-3">
                  <CategoryMark code={row.code} size="md" />
                  {/*
                     An h2 per sector, and the sector name is the link. The
                     block as a whole is deliberately not clickable: the
                     subcategory links inside it are the point of the page.
                  */}
                  <h2 className="min-w-0 text-body font-medium text-ink">
                    <Link
                      href={`/c/${row.slug}`}
                      className="rounded-tag underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                    >
                      {row.name}
                    </Link>
                  </h2>
                  <span className="ms-auto shrink-0 font-mono text-eyebrow tabular-nums text-muted">
                    {formatCount(sector?.listings ?? row.listings)}
                  </span>
                </div>

                {shown.length > 0 ? (
                  <ul className="mt-3 flex flex-col gap-2">
                    {shown.map((child) => (
                      <li key={child.id}>
                        <Link
                          href={`/c/${row.slug}/${child.slug}`}
                          className="rounded-tag text-body-sm text-moss underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                        >
                          {child.name}{" "}
                          <span className="font-mono text-eyebrow tabular-nums text-muted">
                            {formatCount(child.listings)}
                          </span>
                        </Link>
                      </li>
                    ))}
                    {overflow > 0 && (
                      <li>
                        <Link
                          href={`/c/${row.slug}`}
                          className="rounded-tag text-caption text-muted underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                        >
                          {t("categories.more_subcategories", { count: overflow })}
                        </Link>
                      </li>
                    )}
                  </ul>
                ) : (
                  /*
                     A sector with nothing published under it yet. The block
                     still renders and the sector link still works — what it
                     must not do is pad itself to five or link to a page that
                     would carry a noindex.
                  */
                  <p className="mt-3 text-caption text-muted">{t("categories.no_subcategories")}</p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── 4 · Emirate matrix ────────────────────────────────────────── */}
      <section className="bg-paper">
        <div className="mx-auto max-w-7xl px-5 pt-7 pb-9">
          <Eyebrow as="h2" className="mb-4 block">
            {t("categories.matrix_eyebrow", { pages: livePages })}
          </Eyebrow>

          {/*
             Every sector, never truncated — a hidden row is an orphaned page.

             Below 1024px the same table restructures into one block per sector
             with the emirate counts as a wrapping row, which §Responsive asks
             for and criterion 11 checks. It is done in CSS on one DOM rather
             than by rendering a second markup tree: "same anchors, different
             layout" means the crawler and the screen reader see each link
             once, and a phone-width horizontal scroll would hide half of them
             behind a gesture no keyboard has.
          */}
          <div className="rounded-card-lg border border-line bg-card max-lg:border-0 lg:overflow-x-auto">
            <table className="w-full border-collapse max-lg:block">
              <caption className="sr-only">{t("categories.matrix_caption")}</caption>
              <thead className="max-lg:hidden">
                <tr className="border-b border-line bg-paper-sunk">
                  <th
                    scope="col"
                    className="w-[250px] px-4 py-2.5 text-start font-mono text-colhead uppercase text-muted"
                  >
                    {t("categories.col_sector")}
                  </th>
                  {MATRIX_EMIRATES.map((emirate) => (
                    <th
                      key={emirate}
                      scope="col"
                      className="px-2.5 py-2.5 text-center font-mono text-colhead uppercase text-muted"
                    >
                      {t(`emirate.${emirate}` as never)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="max-lg:flex max-lg:flex-col max-lg:gap-3">
                {matrix.map((row) => (
                  // Zebra striping, per the 6c render. Reserved elsewhere in the
                  // product for row state — here nothing carries state and the
                  // table is seven numeric columns wide, which is exactly the
                  // case the stripe is for.
                  <tr
                    key={row.id}
                    className={
                      "border-b border-line-mid last:border-b-0 even:bg-paper " +
                      "max-lg:block max-lg:rounded-card max-lg:border max-lg:border-line max-lg:p-3 max-lg:even:bg-paper"
                    }
                  >
                    <th
                      scope="row"
                      className="px-4 py-2.5 text-start text-body-sm font-normal text-ink max-lg:block max-lg:px-0 max-lg:pt-0 max-lg:pb-2 max-lg:font-medium"
                    >
                      {row.name}
                    </th>
                    {/* One wrapping row of cells below 1024px. */}
                    {row.cells.map((cell) => (
                      <td
                        key={cell.emirate}
                        className={
                          "px-2.5 py-2.5 text-center font-mono text-caption tabular-nums " +
                          "max-lg:inline-flex max-lg:items-baseline max-lg:gap-1.5 max-lg:px-0 max-lg:py-0 max-lg:pe-3.5"
                        }
                      >
                        {/* The column head, carried into the cell where the
                            head row is hidden. */}
                        <span className="hidden font-sans text-eyebrow uppercase text-muted max-lg:inline">
                          {t(`emirate.${cell.emirate}` as never)}
                        </span>
                        {cell.live ? (
                          <Link
                            href={emiratePagePath(cell.emirate, row.slug)}
                            className="rounded-tag text-moss underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                          >
                            {formatCount(cell.listings)}
                          </Link>
                        ) : (
                          /*
                             Criterion 3: no anchor element at all. Not a
                             disabled link, not href="#". A crawler must not
                             find a route to a page we are not publishing.
                          */
                          <span className="text-muted">{formatCount(cell.listings)}</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3.5 text-caption text-muted">
            {/* The real threshold, from config rather than a hardcoded 60. */}
            {t("categories.threshold_note", { count: threshold(matrix) })}
          </p>
        </div>
      </section>
    </PublicShell>
  );
}

/**
 * The listing floor to quote in the footnote.
 *
 * Each category carries its own `Category.publishThreshold`, so there is not
 * necessarily one number to state. Where they agree — the seeded state, and
 * the expected one — the footnote says it; where they do not it says the
 * lowest, because that is the only figure a reader can rely on being true of
 * every greyed cell on the page.
 *
 * Read from the rows rather than from `DEFAULT_THRESHOLDS`, which is the
 * fallback and not the answer: the spec asks for "the real threshold from
 * config, not a hardcoded 60".
 */
function threshold(rows: readonly { publishThreshold: number }[]): number {
  return rows.length > 0
    ? Math.min(...rows.map((row) => row.publishThreshold))
    : DEFAULT_THRESHOLDS.minListings;
}
