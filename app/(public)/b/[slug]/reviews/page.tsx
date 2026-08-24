import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumb, Card, PublicShell } from "@/components/structure";
import { ProgressBar } from "@/components/display";
import { getBusinessBySlug, getBusinessReviews, getReviewSummary } from "@/lib/db/queries";
import { formatDate, formatDecimal } from "@/lib/format";
import { t } from "@/lib/i18n";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { StorefrontHeader, storefrontCrumbs } from "../_storefront";

export const revalidate = 300;

interface Params {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) return {};
  return {
    title: `${t("storefront.reviews")} — ${business.displayName}`,
    description: t("seo.reviews_description", { name: business.displayName }),
    alternates: { canonical: `/b/${slug}/reviews` },
  };
}

const DIMENSIONS = [
  { key: "quotedAccurate", labelKey: "storefront.rating_quoted" },
  { key: "onTime", labelKey: "storefront.rating_on_time" },
  { key: "asDescribed", labelKey: "storefront.rating_described" },
  { key: "responsiveness", labelKey: "storefront.rating_responsive" },
] as const;

export default async function ReviewsPage({ params }: Params) {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business || business.claimStatus === "unclaimed") notFound();

  const [reviews, summary] = await Promise.all([
    getBusinessReviews(business.id),
    getReviewSummary(business.id),
  ]);

  return (
    <PublicShell
      nav={<DirectoryNav />}
      breadcrumb={
        <Breadcrumb
          label={t("gallery.breadcrumb_label")}
          items={storefrontCrumbs(business, t("storefront.reviews"))}
        />
      }
      footer={<DirectoryFooter />}
    >
      <div data-theme={business.themePreset ?? "default"}>
        <StorefrontHeader business={business} active="reviews" />

        {/*
          An empty review list is a first-run empty state, not a failure. It
          says why there are so few — the gate is a real enquiry — because that
          is the reason to trust the ones that exist. It renders no zero rating
          and no empty star row.
        */}
        {summary.count === 0 ? (
          <div className="mt-6 max-w-[var(--measure-prose)]">
            <h2 className="text-h2 text-brand-ink">{t("storefront.no_reviews_title")}</h2>
            <p className="mt-2 text-prose text-prose">{t("storefront.no_reviews_body")}</p>
          </div>
        ) : (
          <div className="mt-5 grid gap-[var(--gutter)] lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
            <aside className="min-w-0">
              <Card>
                <p className="font-mono text-eyebrow uppercase text-faint">
                  {t("storefront.rating_overall")}
                </p>
                <p className="font-serif text-display tabular-nums text-brand-ink">
                  {formatDecimal(summary.averages.overall ?? 0)}
                </p>
                <p className="text-caption text-muted">
                  {t("listing.reviews", { count: summary.count })}
                </p>

                <div className="mt-4 flex flex-col gap-2.5">
                  {DIMENSIONS.map((dimension) => {
                    const value = summary.averages[dimension.key] ?? 0;
                    return (
                      <ProgressBar
                        key={dimension.key}
                        label={t(dimension.labelKey)}
                        value={value}
                        max={5}
                        valueLabel={formatDecimal(value)}
                        size="sm"
                      />
                    );
                  })}
                </div>
              </Card>
            </aside>

            <div className="flex min-w-0 flex-col gap-3">
              {reviews.map((review) => (
                <Card key={review.id} as="article">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-body-sm text-ink">
                      {review.showCompanyName
                        ? (review.buyer.buyerCompany?.name ?? review.buyer.fullName ?? "")
                        : t("storefront.review_anonymous")}
                    </p>
                    <span className="font-mono text-eyebrow tabular-nums text-muted">
                      {formatDecimal(review.overall)} · {formatDate(review.createdAt)}
                    </span>
                  </div>

                  <p className="mt-2 max-w-[var(--measure-prose)] text-prose text-prose">
                    {review.body}
                  </p>

                  {review.sellerReply && (
                    <div className="mt-3 rounded-chip border-s-2 border-brand bg-paper-sunk p-3">
                      <p className="font-mono text-eyebrow uppercase text-faint">
                        {t("storefront.seller_reply")}
                      </p>
                      <p className="mt-1 text-body-sm text-body">{review.sellerReply}</p>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </PublicShell>
  );
}
