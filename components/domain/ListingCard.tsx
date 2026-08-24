import { cn } from "@/lib/cn";
import { Card } from "@/components/structure";
import { LogoTile, StatusBadge, Tag } from "@/components/display";
import { Button, buttonClassName } from "@/components/primitives";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { ResponseTime } from "./ResponseTime";
import { VerificationBadge } from "./VerificationBadge";
import { tierSpec } from "./verification";

/**
 * One supplier, in four places. A `context` prop, never four components — the
 * verification treatment and the no-price rule have to be identical in all
 * four, and four components is four chances for one of them to drift.
 *
 *   search      a wide row in the results list
 *   map         a compact card beside or over the map
 *   grid        a tile on the home page and category pages
 *   unclaimed   the licence-import composition, board 10g
 *
 * Tier 4 imports t() directly. Tiers 1 to 3 stay generic and take their strings
 * as props; a domain component is domain-specific by definition, and threading
 * twenty catalogue keys through props would be ceremony.
 *
 * The unclaimed context is not a lesser version of the others. It states
 * plainly that nothing is verified, shows only what the licence record holds,
 * and never invents hours, a rating or an empty star row. Roughly three in four
 * listings are unclaimed, so this is a large share of what Google sees.
 */
export type ListingContext = "search" | "map" | "grid" | "unclaimed";

export interface ListingCardBusiness {
  slug: string;
  displayName: string;
  categoryName: string;
  categoryCode: string;
  areaName: string;
  emirateName: string;
  verificationTier: number;
  verifiedAt?: Date | string | null;
  visitedAt?: Date | string | null;
  logoUrl?: string | null;
  productCount?: number;
  reviewCount?: number;
  ratingOverall?: number | null;
  responseTimeMedianMs?: number | null;
  responseDurationLabel?: string;
  establishedYear?: number | null;
  branchCount?: number;
  /** Sponsored placement. Always labelled, never silent. */
  sponsored?: boolean;
}

export interface ListingCardProps {
  business: ListingCardBusiness;
  context?: ListingContext;
  href?: string;
  selected?: boolean;
  /** Labelled sponsor mark, already localised. */
  sponsoredLabel?: string;
  /**
   * Where "Compare" goes. Compare is a real feature this handoff — only the
   * "Enquire with all 4" action on the tray is disabled — so this is a link,
   * not a dead button. Defaults to starting a fresh tray with this supplier.
   */
  compareHref?: string;
  /**
   * Where the enquiry affordance goes. Absent leaves it disabled, which is the
   * state handoff 1 shipped and the one the gallery still shows.
   */
  enquireHref?: string;
  /** Already in the tray: the control says so and removes instead. */
  inCompare?: boolean;
  compareLabel?: string;
}

function badgeDate(business: ListingCardBusiness): string | undefined {
  const spec = tierSpec(business.verificationTier);
  const value = spec.dateField === "visitedAt" ? business.visitedAt : business.verifiedAt;
  if (spec.dateField === "none" || !value) return undefined;
  return formatDate(value);
}

export function ListingCard({
  business,
  context = "search",
  href,
  selected = false,
  sponsoredLabel,
  compareHref,
  enquireHref,
  inCompare = false,
  compareLabel,
}: ListingCardProps) {
  const spec = tierSpec(business.verificationTier);
  const link = href ?? `/b/${business.slug}`;
  const unclaimed = context === "unclaimed";

  const verification = (
    <VerificationBadge
      compact
      size={context === "map" ? "sm" : "md"}
      tier={business.verificationTier}
      label={t(spec.labelKey as never)}
      checked={t(spec.checkedKey as never)}
      date={badgeDate(business)}
      tierLabel={t("verify.tier", { tier: business.verificationTier })}
    />
  );

  const place = (
    <span className="truncate text-caption text-muted">
      {business.areaName} · {business.emirateName}
    </span>
  );

  return (
    <Card
      as="article"
      elevation={context === "grid" ? "flat" : "flat"}
      interactive={!unclaimed}
      selected={selected}
      padded={false}
    >
      <div className={cn("flex gap-3 p-4", context === "map" && "gap-2.5 p-3")}>
        <LogoTile
          src={business.logoUrl}
          name={business.displayName}
          categoryCode={business.categoryCode}
          size={context === "map" ? "sm" : "md"}
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className={cn("min-w-0 text-ink", context === "map" ? "text-body-sm" : "text-h3")}>
              <a
                href={link}
                className={cn(
                  "rounded-tag underline-offset-2 hover:underline",
                  "focus-visible:outline-none focus-visible:shadow-focus",
                )}
              >
                {business.displayName}
              </a>
            </h3>
            {business.sponsored && sponsoredLabel && (
              <StatusBadge tone="neutral" size="sm">
                {sponsoredLabel}
              </StatusBadge>
            )}
          </div>

          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            {place}
            {context !== "map" && <Tag size="sm">{business.categoryName}</Tag>}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {verification}

            {/*
              An unclaimed listing shows no rating, no review count and no
              response time. There is no data behind any of them, and a zero
              rendered as "0.0" or an empty star row reads as a bad supplier
              rather than an unclaimed one.
            */}
            {!unclaimed && (
              <>
                {business.responseTimeMedianMs !== undefined && (
                  <ResponseTime
                    size="sm"
                    medianMs={business.responseTimeMedianMs}
                    durationLabel={business.responseDurationLabel}
                    label={
                      business.responseDurationLabel
                        ? t("response.median", { duration: business.responseDurationLabel })
                        : undefined
                    }
                    unmeasuredLabel={t("response.unmeasured")}
                  />
                )}

                {business.productCount !== undefined && business.productCount > 0 && (
                  <span className="font-mono text-eyebrow tabular-nums text-muted">
                    {t("listing.products", { count: business.productCount })}
                  </span>
                )}

                {business.reviewCount !== undefined && (
                  <span className="font-mono text-eyebrow tabular-nums text-muted">
                    {business.reviewCount > 0
                      ? t("listing.reviews", { count: business.reviewCount })
                      : t("listing.no_reviews")}
                  </span>
                )}
              </>
            )}
          </div>

          {unclaimed && (
            <div className="mt-3 rounded-chip border border-line bg-paper-sunk p-3">
              <p className="text-caption text-body">{t("listing.unclaimed_title")}</p>
              <p className="mt-1 text-caption text-muted">{t("listing.unclaimed_body")}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" disabled title={t("enquiry.disabled")}>
                  {t("listing.claim_cta")}
                </Button>
                <Button size="sm" variant="link" disabled title={t("enquiry.disabled")}>
                  {t("listing.report")}
                </Button>
              </div>
            </div>
          )}

          {context === "search" && !unclaimed && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {/*
                Live from handoff 2 step 3. Without an href it stays disabled,
                which is how the gallery still shows the state handoff 1 shipped
                and how a surface that has nowhere to send the buyer degrades.
              */}
              {enquireHref ? (
                <a href={enquireHref} className={buttonClassName({ size: "sm" })}>
                  {t("product.enquire")}
                </a>
              ) : (
                <Button size="sm" disabled title={t("enquiry.disabled")}>
                  {t("product.enquire")}
                </Button>
              )}
              <a
                href={compareHref ?? `/compare?p=${business.slug}`}
                className={cn(
                  "inline-flex h-8 items-center justify-center rounded-ctl border px-3 text-caption font-medium",
                  "transition-colors duration-120 ease-out",
                  "focus-visible:outline-none focus-visible:shadow-focus",
                  inCompare
                    ? "border-[1.5px] border-moss bg-moss-wash text-moss-deep"
                    : "border-line-strong bg-card text-ink hover:bg-fill",
                )}
              >
                {compareLabel ?? t("action.compare")}
              </a>
              {business.establishedYear && (
                <span className="font-mono text-eyebrow tabular-nums text-faint">
                  {t("listing.years", { year: business.establishedYear })}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
