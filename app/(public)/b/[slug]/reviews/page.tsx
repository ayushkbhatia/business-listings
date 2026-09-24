import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { redirectIfClosed, redirectIfMoved, absorbedInto } from "@/lib/listing/redirect";
import { Breadcrumb, PublicShell } from "@/components/structure";
import { buttonClassName } from "@/components/primitives";
import { ReviewHeldRow } from "@/components/domain";
import {
  getBusinessBySlug,
  getReviewBoard,
  isReviewFiltered,
  parseReviewQuery,
  toReviewParams,
  REVIEWS_PAGE_SIZE,
} from "@/lib/db/queries";
import { formatCount, formatRating } from "@/lib/format";
import { t } from "@/lib/i18n";
import { writeReviewLinkFor } from "@/lib/reviews/write-server";
import { getActor } from "@/lib/auth/session";
import { mayWriteReview } from "@/lib/auth/guards";
import { absoluteUrl } from "@/lib/site";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { JsonLd } from "@/app/(public)/_json-ld";
import { StorefrontHeader, storefrontCrumbs } from "../_storefront";
import { ProvenanceCard, RatedOnCard, RatingCard } from "./_summary";
import { ReviewToolbar } from "./_toolbar";
import { ReviewRowItem } from "./_row";

/**
 * Board 1m — reviews and ratings.
 *
 * The page a buyer opens last, to decide whether to believe everything else.
 * Its value is entirely a function of how hard it is to get a review onto it,
 * which makes **provenance the product** rather than the star rating: 4.6 means
 * nothing on its own, and "4.6 from 34 reviews, 21 of them from accepted
 * quotes" means something no competitor can fake.
 *
 * Every figure here is a query. There is no stored average on this route — see
 * `getBusinessBySlug`, which measures the header's rating for the same reason.
 */
export const revalidate = 300;

interface Params {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** The provenance ladder, as a badge tone. Never "Verified purchase". */
export async function generateMetadata({ params, searchParams }: Params): Promise<Metadata> {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) return {};

  const filtered = isReviewFiltered(parseReviewQuery(await searchParams));

  const count = business._count.reviews;
  const rating = business.ratingOverall;

  return {
    title:
      count > 0 && rating !== null
        ? t("seo.reviews_title", {
            name: business.displayName,
            rating: formatRating(rating),
            formatted: formatCount(count),
          })
        : `${t("storefront.reviews")} — ${business.displayName}`,
    description: t("seo.reviews_description", { name: business.displayName }),
    /*
       A narrowed view is not the page worth ranking, and `follow` because the
       reviews themselves are. Sixteen filter-and-sort permutations of one list
       is the doorway-page shape the catalogue's criterion 11 rules out, for the
       same reason and at a smaller scale.
    */
    ...(filtered ? { robots: { index: false, follow: true } } : {}),
    /*
       One canonical, whatever the filter and sort.

       A filtered view is the same reviews in a different order — four filters
       by four sorts is sixteen URLs of one page, and the review text is the
       thing worth ranking. Criterion 11's catalogue reasoning, applied to a
       smaller permutation space for the same reason.
    */
    /*
       From `business.slug`, never from the route parameter.

       A storefront answers on two paths since 9 Sep 2026: its slug, and the
       label on the seller's own web address, which `proxy.ts` rewrites to
       `/b/<label>`. Building the canonical from the parameter would have each
       address declare itself canonical, which is the whole of what a canonical
       is for. `metadataBase` is `NEXT_PUBLIC_SITE_URL`, so this resolves to the
       directory's host whichever one served the page.
    */
    alternates: { canonical: `/b/${business.slug}/reviews` },
  };
}

export default async function ReviewsPage({ params, searchParams }: Params) {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) {
    /*
     * Before the 404, the two ways a listing legitimately moves: a rename wrote
     * a redirect, or a merge absorbed it. Both wrote rows nothing read until
     * handoff 4 step 2.
     */
    await redirectIfMoved(`/b/${slug}`);
    // Board 11i: a closed business's subpages go to its notice.
    await redirectIfClosed(slug);
    notFound();
  }

  const movedTo = await absorbedInto(slug);
  if (movedTo) permanentRedirect(`/b/${movedTo}`);

  // An unclaimed listing has no subpages. It is a licence record, not a
  // storefront, and there is nothing here for it to show.
  if (business.claimStatus === "unclaimed") notFound();

  /*
     Zero reviews is a 404, not an empty page.

     `StorefrontHeader` already hides a tab with a zero count, and board 1d
     omits the rating from the identity line entirely rather than rendering a
     zero as a rating. A tab that does not exist should not have a URL that
     renders — the same rule the Products tab follows one route along.
  */
  if (business._count.reviews === 0) notFound();

  const query = parseReviewQuery(await searchParams);
  const basePath = `/b/${business.slug}/reviews`;

  const [board, actor] = await Promise.all([
    getReviewBoard(business.id, query),
    getActor(),
  ]);

  /*
     Build plan 9.4: `createReview` asks `review.create` before it reads the
     enquiry, so a seat it refuses — a staff role with no buyer one — gets no
     button, the same absence an ineligible visitor gets. A signed-in session is
     never provisional, so the session actor answers what the record would.

     Then the gate, which is also what takes the button off a supplier's own
     reviews page for everyone on its team: no supplier reviews itself.
  */
  const writeReviewHref =
    actor && mayWriteReview(actor) ? await writeReviewLinkFor(actor.id, business.id) : null;

  const shown = board.reviews.length;
  const remaining = Math.max(0, board.total - shown);

  /*
     One figure, one provenance label.

     The 21 appears three times on this page — the sub-line, the filter chip and
     the badge on each row — and all three read `counts.accepted`, which is one
     query. Labelling the same number "accepted quotes" in one place and
     "verified enquiries" in another is the defect this page shipped with on the
     board, in the spot a buyer reads first.
  */
  const subline =
    board.counts.accepted > 0
      ? t("reviewpage.subline", {
          count: board.summary.count,
          formatted: formatCount(board.summary.count),
          accepted: formatCount(board.counts.accepted),
        })
      : t("reviewpage.subline_none_accepted", {
          count: board.summary.count,
          formatted: formatCount(board.summary.count),
        });

  return (
    <PublicShell
      bleed
      nav={<DirectoryNav />}
      breadcrumb={
        <Breadcrumb
          label={t("gallery.breadcrumb_label")}
          items={storefrontCrumbs(business, t("storefront.reviews"))}
        />
      }
      footer={<DirectoryFooter />}
    >
      <div data-theme="default">
        <StorefrontHeader
          business={business}
          active="reviews"
          subline={subline}
          actions={
            /*
               Absent for an ineligible visitor, not disabled.

               A visible button that rejects you teaches the wrong thing about
               the platform — that reviews are open and you were refused, rather
               than that they are gated and you have not been through the gate.
            */
            writeReviewHref ? (
              <Link
                href={writeReviewHref}
                className={buttonClassName({ size: "sm" })}
              >
                {t("reviewpage.write")}
              </Link>
            ) : undefined
          }
        />

        <ReviewsJsonLd
          business={business}
          board={board}
          crumbs={storefrontCrumbs(business, t("storefront.reviews"))}
        />

        <div className="mx-auto mt-5 grid max-w-7xl gap-[var(--gutter)] px-5 pb-[var(--section-pad)] lg:grid-cols-[minmax(0,17.5rem)_minmax(0,1fr)] xl:grid-cols-[19.25rem_minmax(0,1fr)]">
          {/*
             Above the list below 1024, beside it above.

             The rating card and the dimensions sit side by side in the tablet
             band and stack below 768; the provenance card runs full width under
             both, because it is the one thing on this page that is prose.
          */}
          <aside className="min-w-0">
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-1">
              <RatingCard summary={board.summary} />
              <RatedOnCard summary={board.summary} />
            </div>
            <div className="mt-3">
              <ProvenanceCard />
            </div>
          </aside>

          <div className="min-w-0">
            <ReviewToolbar counts={board.counts} query={query} basePath={basePath} />

            {board.reviews.length === 0 ? (
              /*
                 Filtered to zero, which is a different empty state from
                 first-run and says so. Nothing is hidden and the way back is
                 one click, named.
              */
              <div className="mt-6 max-w-[var(--measure-prose)]">
                <h2 className="text-h3 text-ink">{t("reviewpage.filtered_zero_title")}</h2>
                <p className="mt-2 text-body-sm text-body">
                  {t("reviewpage.filtered_zero_body", {
                    formatted: formatCount(board.summary.count),
                  })}
                </p>
                <Link
                  href={basePath}
                  className="mt-3 inline-block rounded-ctl border border-line bg-card px-3 py-2 text-body-sm font-medium text-ink hover:bg-paper focus-visible:shadow-focus focus-visible:outline-none"
                >
                  {t("reviewpage.filtered_zero_cta")}
                </Link>
              </div>
            ) : (
              <>
                <h2 className="sr-only">{t("reviewpage.title")}</h2>
                <ul>
                  {board.reviews.map((review) => (
                    <ReviewRowItem
                      key={review.id}
                      review={review}
                      sellerName={business.displayName}
                    />
                  ))}

                  {/*
                     Held reviews sit at the foot of the list as one line.

                     They are already out of every average above. The line exists
                     because a buyer counting rows against the headline count
                     should find the difference explained rather than assume the
                     page is hiding something — which is the assumption a
                     reviews page cannot afford.
                  */}
                  {board.heldCount > 0 && query.page * REVIEWS_PAGE_SIZE >= board.total && (
                    <ReviewHeldRow
                      label={t("reviewpage.held", {
                        count: board.heldCount,
                        formatted: formatCount(board.heldCount),
                      })}
                    />
                  )}
                </ul>

                {/*
                   The label states what one click delivers, not what remains.

                   Derived from the page size, and narrowed to the remainder when
                   fewer are left. The control disappears at zero rather than
                   going disabled: the count is already in the headline and the
                   chips, so a dead button would only be repeating it.
                */}
                {remaining > 0 && (
                  <div className="mt-5">
                    <Link
                      href={`${basePath}?${toReviewParams(query, { page: query.page + 1 })}`}
                      className="block rounded-ctl border border-line bg-card px-4 py-2.5 text-center text-body-sm font-medium text-ink hover:bg-paper focus-visible:shadow-focus focus-visible:outline-none"
                    >
                      {t("reviewpage.load_more", {
                        count: Math.min(REVIEWS_PAGE_SIZE, remaining),
                      })}
                    </Link>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/*
           The eligible buyer's action, again, on a phone.

           `md:hidden` so only one of the two is ever exposed — the header's copy
           carries it from `md` up, exactly as the storefront's own action row
           does.
        */}
        {writeReviewHref && (
          <div className="sticky bottom-[var(--compare-tray-h,0px)] z-10 border-t border-line bg-card/95 p-3 backdrop-blur-sm md:hidden">
            <Link
              href={writeReviewHref}
              className={buttonClassName({ block: true })}
            >
              {t("reviewpage.write")}
            </Link>
          </div>
        )}
      </div>
    </PublicShell>
  );
}

/**
 * `AggregateRating`, the individual `Review` items, and the breadcrumb.
 *
 * The aggregate is emitted only when reviews exist, and only from reviews on
 * this platform — nothing imported, nothing blended in from elsewhere. It reads
 * `board.summary`, which is the same held-and-removed-excluded figure the page
 * renders, so the markup cannot claim an average the page does not show.
 */
function ReviewsJsonLd({
  business,
  board,
  crumbs,
}: {
  business: { displayName: string; slug: string };
  board: Awaited<ReturnType<typeof getReviewBoard>>;
  crumbs: { label: string; href?: string }[];
}) {
  const { summary } = board;

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "LocalBusiness",
          name: business.displayName,
          url: absoluteUrl(`/b/${business.slug}`),
          ...(summary.count > 0 && summary.average !== null
            ? {
                aggregateRating: {
                  "@type": "AggregateRating",
                  ratingValue: Number(summary.average.toFixed(2)),
                  reviewCount: summary.count,
                  bestRating: 5,
                  worstRating: 1,
                },
              }
            : {}),
          review: board.reviews.map((review) => ({
            "@type": "Review",
            /*
               The same name the row prints, resolved the same way. A crawler
               reading a company name the page does not show — or a person's
               name it deliberately withholds — is the page disagreeing with its
               own markup about who wrote this.
            */
            author:
              review.showCompanyName && review.buyer.buyerCompany
                ? { "@type": "Organization", name: review.buyer.buyerCompany.name }
                : { "@type": "Person", name: t("storefront.review_anonymous") },
            datePublished: review.createdAt.toISOString().slice(0, 10),
            reviewRating: {
              "@type": "Rating",
              ratingValue: review.overall,
              bestRating: 5,
              worstRating: 1,
            },
            reviewBody: review.body,
          })),
        }}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: crumbs.map((crumb, index) => ({
            "@type": "ListItem",
            position: index + 1,
            name: crumb.label,
            item: crumb.href,
          })),
        }}
      />
    </>
  );
}
