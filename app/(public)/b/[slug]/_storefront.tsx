import { Tabs } from "@/components/structure";
import { LogoTile } from "@/components/display";
import { ResponseTime, VerificationBadge, tierSpec } from "@/components/domain";
import { formatDate, formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { PublicBusiness } from "@/lib/db/queries";

/**
 * The header every claimed storefront page shares.
 *
 * `data-theme` is applied by the page, not here, and it recolours the header
 * band, headings, links and buttons. It does not reach the verification badge —
 * that component draws only from the status palette, and a test measures it.
 */
export function StorefrontHeader({
  business,
  active,
}: {
  business: PublicBusiness;
  active: "overview" | "products" | "branches" | "reviews";
}) {
  const spec = tierSpec(business.verificationTier);
  const badgeDate =
    spec.dateField === "none"
      ? undefined
      : spec.dateField === "visitedAt"
        ? business.visitedAt
          ? formatDate(business.visitedAt)
          : undefined
        : business.verifiedAt
          ? formatDate(business.verifiedAt)
          : undefined;

  const head = business.locations[0];

  return (
    <header className="border-b border-line pb-5">
      <div className="flex flex-wrap items-start gap-4">
        <LogoTile
          name={business.displayName}
          categoryCode={business.primaryCategory.code}
          size="lg"
          rounded="card"
        />

        <div className="min-w-0 flex-1">
          <p className="font-mono text-eyebrow uppercase text-faint">
            {business.primaryCategory.name}
          </p>
          <h1 className="mt-0.5 font-serif text-display text-brand">{business.displayName}</h1>
          {head && (
            <p className="mt-1 text-body-sm text-muted">
              {head.area.name} · {t(`emirate.${head.emirate}` as never)}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-start gap-x-5 gap-y-2">
            <VerificationBadge
              tier={business.verificationTier}
              label={t(spec.labelKey as never)}
              checked={t(spec.checkedKey as never)}
              date={badgeDate}
              tierLabel={t("verify.tier", { tier: business.verificationTier })}
            />
            <ResponseTime
              medianMs={business.responseTimeMedianMs}
              durationLabel={
                business.responseTimeMedianMs
                  ? formatDuration(business.responseTimeMedianMs)
                  : undefined
              }
              label={
                business.responseTimeMedianMs
                  ? t("response.median", {
                      duration: formatDuration(business.responseTimeMedianMs),
                    })
                  : undefined
              }
              unmeasuredLabel={t("response.unmeasured")}
            />
          </div>
        </div>
      </div>

      <div className="mt-5">
        <Tabs
          as="a"
          label={t("gallery.tabs_label")}
          active={active}
          items={[
            { key: "overview", label: t("storefront.overview"), href: `/b/${business.slug}` },
            {
              key: "products",
              label: t("storefront.products"),
              href: `/b/${business.slug}/products`,
              badge: business._count.products,
            },
            {
              key: "branches",
              label: t("storefront.branches"),
              href: `/b/${business.slug}/branches`,
              badge: business.locations.length,
            },
            {
              key: "reviews",
              label: t("storefront.reviews"),
              href: `/b/${business.slug}/reviews`,
              badge: business._count.reviews,
            },
          ]}
        />
      </div>
    </header>
  );
}

/** The crumbs above every storefront page. */
export function storefrontCrumbs(business: PublicBusiness, leaf?: string) {
  const crumbs = [
    { label: t("chrome.directory"), href: "/" },
    { label: business.primaryCategory.name, href: `/c/${business.primaryCategory.slug}` },
    leaf
      ? { label: business.displayName, href: `/b/${business.slug}` }
      : { label: business.displayName },
  ];
  return leaf ? [...crumbs, { label: leaf }] : crumbs;
}
