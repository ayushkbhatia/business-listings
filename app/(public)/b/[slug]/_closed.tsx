import Link from "next/link";
import { buttonClassName } from "@/components/primitives";
import { Card, PublicShell } from "@/components/structure";
import { ReviewHeldRow } from "@/components/domain";
import { getReviewBoard, parseReviewQuery, REVIEWS_PAGE_SIZE } from "@/lib/db/queries";
import { formatCount, formatDate, formatRating } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { ClosedListing } from "@/lib/closure/public";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { ReviewRowItem } from "./reviews/_row";

/**
 * Board `11i` Q5 — the notice a closed business's URL serves.
 *
 * Three facts and the buyers' own words, and nothing that invites an action the
 * business can no longer take. No enquiry button, no contact card, no
 * catalogue: every seat is revoked, and a control that sends an enquiry to
 * nobody is the failure build note `B4` exists to prevent.
 *
 * The reviews are the reason this is not a 404. They were written by buyers
 * about work that happened, they are retained, and a buyer who bookmarked this
 * supplier should be able to read why. They render through board 1m's own row,
 * so a review reads identically here and on the reviews page it came from.
 *
 * `noindex` is set in the page's metadata, not here — the directory's search
 * and sitemap already drop the listing because `publishedAt` is null, and this
 * keeps the notice from being indexed in its place (Q1: reachable only by
 * direct link).
 */
export async function ClosedStorefront({
  listing,
  searchParams,
}: {
  listing: ClosedListing;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const query = { ...parseReviewQuery(searchParams), filter: "all" as const, sort: "recent" as const };
  const board = await getReviewBoard(listing.id, query);
  const shown = board.reviews.length;
  const remaining = board.total - shown;

  return (
    <PublicShell nav={<DirectoryNav />} footer={<DirectoryFooter />}>
      <div className="mx-auto flex w-full max-w-[48rem] flex-col gap-5 px-5 py-10">
        <Card padded>
          <p className="font-mono text-eyebrow uppercase tracking-[0.11em] text-muted">
            {t("closed.eyebrow")}
          </p>
          <h1 className="mt-2 text-h2 text-ink">{listing.displayName}</h1>
          <p className="mt-2 max-w-prose text-body-sm text-body-ink">
            {t("closed.body", { date: formatDate(listing.closedOn) })}
          </p>
          <p className="mt-2 max-w-prose text-body-sm text-muted">{t("closed.buyers")}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/search" className={buttonClassName({ size: "sm" })}>
              {t("closed.find_another")}
            </Link>
            <Link href="/account/enquiries" className={buttonClassName({ variant: "secondary", size: "sm" })}>
              {t("closed.your_enquiries")}
            </Link>
          </div>
        </Card>

        <section aria-labelledby="closed-reviews" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="closed-reviews" className="text-h3 text-ink">
              {t("closed.reviews_title")}
            </h2>
            {board.summary.count > 0 && board.summary.average !== null && (
              <p className="text-caption text-muted">
                {t("closed.reviews_summary", {
                  count: board.summary.count,
                  formatted: formatCount(board.summary.count),
                  rating: formatRating(board.summary.average),
                })}
              </p>
            )}
          </div>

          {board.total === 0 ? (
            /*
               A closed business with no reviews says so. Not an empty star row
               and not a rating of nought — CLAUDE.md, an unclaimed listing says
               plainly that nothing is there, and so does a closed one.
            */
            <Card padded>
              <p className="text-body-sm text-muted">{t("closed.no_reviews")}</p>
            </Card>
          ) : (
            <Card padded={false}>
              <ul className="divide-y divide-line">
                {board.reviews.map((review) => (
                  <ReviewRowItem key={review.id} review={review} sellerName={listing.displayName} />
                ))}
                {board.heldCount > 0 && remaining <= 0 && (
                  <ReviewHeldRow
                    label={t("reviewpage.held", {
                      count: board.heldCount,
                      formatted: formatCount(board.heldCount),
                    })}
                  />
                )}
              </ul>
              {remaining > 0 && (
                <div className="border-t border-line p-3">
                  <Link
                    href={`/b/${listing.slug}?page=${query.page + 1}`}
                    scroll={false}
                    className={buttonClassName({ variant: "secondary", size: "sm", block: true })}
                  >
                    {t("reviewpage.load_more", { count: Math.min(REVIEWS_PAGE_SIZE, remaining) })}
                  </Link>
                </div>
              )}
            </Card>
          )}
        </section>
      </div>
    </PublicShell>
  );
}
