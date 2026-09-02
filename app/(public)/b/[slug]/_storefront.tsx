import { Tabs } from "@/components/structure";
import { ImagePlaceholder, LogoTile, StatusBadge } from "@/components/display";
import { ResponseTime, VerificationBadge, tierSpec } from "@/components/domain";
import { formatCount, formatDate, formatDuration } from "@/lib/format";
import { MEDIA_BUCKET, publicUrl } from "@/lib/storage";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { PublicBusiness } from "@/lib/db/queries";

/**
 * The cover, the identity block and the tab row — board 1d sections 2 to 4.
 *
 * Shared by all five storefront routes rather than being the overview's alone.
 * This is the storefront's identity, not the overview's: a buyer who lands on
 * the catalogue tab needs the same name, the same badge and the same way to
 * enquire, and a header that changed between tabs would read as two sites.
 *
 * `data-theme` is applied by the page, not here, and it recolours the band,
 * headings, links and buttons. It does not reach the verification badge — that
 * component draws only from the status palette, and a test measures it.
 */

/** Board 1d: the logo overlaps the cover by about a third of its 104px. */
const LOGO_OVERLAP = "-34px";

export function StorefrontHeader({
  business,
  active,
  pages = [],
  actions,
  photoHref,
  now = new Date(),
}: {
  business: PublicBusiness;
  /** A page slug where a template page is the active tab. */
  active: string;
  /**
   * Template pages marked for the nav, from `navPages`.
   *
   * Passed in rather than loaded here: this renders on five routes and a query
   * inside it would be five queries nobody asked for. The routes that have the
   * sector already loaded pass them; the ones that do not, do not.
   */
  pages?: readonly { slug: string; title: string }[];
  /**
   * The action row — quote, WhatsApp, the masked number, save.
   *
   * A slot because every one of those needs client state and this is a server
   * component. `ContactCard` takes its composer trigger the same way and for
   * the same reason: the island is the caller's, the layout is ours.
   */
  actions?: React.ReactNode;
  /**
   * Where "View all N photos" goes.
   *
   * Absent means the button does not render, however many photos exist. A
   * count that is not a way to see them is a claim with no door behind it, and
   * the overview is currently the only route that has somewhere to send them.
   */
  photoHref?: string;
  /** A parameter, not a call in the body — the purity rule, and it is right. */
  now?: Date;
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

  /*
     Criterion 10: an expired licence takes the badge off the same day.

     The schema says the tier "drops to 2 automatically the day licenceExpiry
     passes — a scheduled job, no grace period". No such job exists; nothing in
     the codebase reads `licenceExpiry` to move a tier. So the badge was
     outliving the licence, which is the one direction a verification signal
     must never fail in.

     Checked here rather than waiting for a job to be written, because a render
     that asks "is this licence valid now" cannot be late. The page stays live
     and the verification panel states the renewal in warn: an expired licence
     is grounds for de-badging, not for delisting.
  */
  const licenceExpired = business.licenceExpiry.getTime() < now.getTime();

  const head = business.locations[0];
  const cover = business.media.find((item) => item.kind === "cover");
  const photos = business.media.filter((item) => item.kind === "gallery").length;

  /*
     The plan chip is Pro and nothing else.

     Board 1d is blunt about why: a "Free storefront" badge is an insult to a
     paying customer's competitor. Basic shows nothing either — the chip says
     "this supplier bought the best storefront we sell", and it only means that
     if the tiers below it are silent.
  */
  const proChip = business.plan?.id === "pro";

  return (
    <header>
      {/* ── 2 · Cover ─────────────────────────────────────────────────────── */}
      <div className="relative h-[140px] w-full overflow-hidden border-b border-line bg-paper-sunk md:h-[200px]">
        {cover ? (
          /*
             A fixed crop, not the seller's arbitrary framing. The media library
             enforces the aspect at upload, so this only has to fill it.
          */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={publicUrl(MEDIA_BUCKET, cover.storagePath)}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <ImagePlaceholder kind="loading" className="absolute inset-0 h-full w-full" />
        )}

        {/*
           Hidden at zero, as the board asks, and hidden again when there is
           nowhere to go. Both conditions are the same promise: the number is
           only worth printing if a buyer can act on it.
        */}
        {photos > 0 && photoHref && (
          <a
            href={photoHref}
            className={cn(
              "absolute bottom-3 right-4 rounded-ctl border border-line px-3 py-1.5",
              "bg-card/92 text-body-sm font-medium text-ink backdrop-blur-sm",
              "hover:bg-card focus-visible:outline-none focus-visible:shadow-focus",
            )}
          >
            {t("storefront.view_photos", { count: photos, formatted: formatCount(photos) })}
          </a>
        )}
      </div>

      {/* ── 3 · Identity block ────────────────────────────────────────────── */}
      <div className="border-b border-line bg-card">
        {/*
           The cover bleeds; everything under it lines up with the page. The
           header owns both because it straddles the boundary — a shell that
           bled the whole storefront would leave every section to re-indent
           itself.
        */}
        <div className="mx-auto max-w-7xl px-5 pb-5">
          <div className="flex flex-wrap items-start gap-x-5 gap-y-4">
            {/*
               Overlapping the cover by about a third, with a ring that is the
               page background rather than a literal white — the board says
               "4px solid white" and means "cut out of the surface it sits on",
               which is what keeps the shape reading at any theme.

               An earlier draft of the board had this at -46px and bled the logo
               into the cover. -34px is the corrected figure and is deliberate.
            */}
            <div className="relative z-[2] shrink-0" style={{ marginTop: LOGO_OVERLAP }}>
              <div className="rounded-panel bg-card p-1 shadow-overlay">
                <LogoTile
                  name={business.displayName}
                  categoryCode={business.primaryCategory.code}
                  size="lg"
                  rounded="card"
                />
              </div>
            </div>

            <div className="min-w-0 flex-1 pt-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                {/*
                   The display name, never the trade name. Criterion 5: the
                   legal name carries the entity suffix and lives in the details
                   panel, and an h1 carrying it would make this page disagree
                   with every card that links here.
                */}
                <h1 className="min-w-0 font-serif text-display text-brand">
                  {business.displayName}
                </h1>
                {proChip && (
                  <StatusBadge tone="neutral" size="sm">
                    {t("storefront.plan_chip")}
                  </StatusBadge>
                )}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                {!licenceExpired && (
                <VerificationBadge
                  tier={business.verificationTier}
                  label={t(spec.labelKey as never)}
                  checked={t(spec.checkedKey as never)}
                  date={badgeDate}
                  tierLabel={t("verify.tier", { tier: business.verificationTier })}
                />
                )}
              </div>

              {/*
                 The meta row. Every clause is dropped rather than rendered
                 empty — "· ·" with nothing between reads as a broken page, and
                 a supplier with no rating yet is not a supplier with a bad one.
              */}
              <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm text-muted">
                <span>{business.primaryCategory.name}</span>
                {head && (
                  <>
                    <span aria-hidden>·</span>
                    <span>
                      {head.area.name}, {t(`emirate.${head.emirate}` as never)}
                    </span>
                  </>
                )}
                {business.ratingOverall !== null && business.reviewCount > 0 && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="tabular-nums">
                      {business.ratingOverall.toFixed(1)}{" "}
                      {t("listing.reviews", { count: business.reviewCount })}
                    </span>
                  </>
                )}
                <span aria-hidden>·</span>
                <ResponseTime
                  size="sm"
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
                {business.establishedYear && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="tabular-nums">
                      {t("listing.years", { year: business.establishedYear })}
                    </span>
                  </>
                )}
              </p>
            </div>

            {/*
               Hidden below `md`, where the sticky bar carries the same actions.
               `hidden` rather than a visual trick, so only one set is exposed.
            */}
            {actions && <div className="hidden shrink-0 pt-2 md:block">{actions}</div>}
          </div>
        </div>
      </div>

      {/* ── 4 · Tab row ───────────────────────────────────────────────────── */}
      <div className="border-b border-line">
        <div className="mx-auto max-w-7xl px-5">
          <Tabs
            as="a"
            label={t("gallery.tabs_label")}
            active={active}
            items={tabsFor(business, pages)}
          />
        </div>
      </div>
    </header>
  );
}

/**
 * The tabs, with the empty ones removed.
 *
 * Criterion 9: "a tab with a zero count is hidden, not shown empty." Overview
 * is always there because it is this page. The others earn their place by
 * having something behind them — a Products tab reading 0 invites a click that
 * lands on an apology, and a storefront that offers four of those looks
 * abandoned rather than new.
 */
function tabsFor(
  business: PublicBusiness,
  pages: readonly { slug: string; title: string }[],
) {
  const items: { key: string; label: string; href: string; badge?: number }[] = [
    { key: "overview", label: t("storefront.overview"), href: `/b/${business.slug}` },
  ];

  if (business._count.products > 0) {
    items.push({
      key: "products",
      label: t("storefront.products"),
      href: `/b/${business.slug}/products`,
      badge: business._count.products,
    });
  }

  if (business.locations.length > 0) {
    items.push({
      key: "branches",
      label: t("storefront.branches"),
      href: `/b/${business.slug}/branches`,
      badge: business.locations.length,
    });
  }

  if (business._count.reviews > 0) {
    items.push({
      key: "reviews",
      label: t("storefront.reviews"),
      href: `/b/${business.slug}/reviews`,
      badge: business._count.reviews,
    });
  }

  /*
   * Template pages last, after the ones the storefront always has. A
   * staff-authored About should not push the catalogue along.
   */
  for (const page of pages) {
    items.push({
      key: page.slug,
      label: page.title,
      href: `/b/${business.slug}/${page.slug}`,
    });
  }

  return items;
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
