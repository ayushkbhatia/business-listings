import { cn } from "@/lib/cn";
import { crawlRel } from "@/lib/seo/crawl-policy";
import { Card } from "@/components/structure";
import { ImagePlaceholder, LogoTile, StatusBadge, Tag } from "@/components/display";
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
  /** The 214px photo on a search row. Placeholder where a seller has none. */
  coverImageUrl?: string | null;
  /** The seller's own words, trimmed by the caller. */
  description?: string | null;
  /** "Valves & actuators · Pumps & motors", from the categories they carry. */
  tradeLine?: string;
  /** A TRN on the record. One of the attribute chips, never a number shown. */
  trnOnFile?: boolean;
  productCount?: number;
  reviewCount?: number;
  ratingOverall?: number | null;
  responseTimeMedianMs?: number | null;
  responseDurationLabel?: string;
  establishedYear?: number | null;
  branchCount?: number;
  /** Sponsored placement. Always labelled, never silent. */
  sponsored?: boolean;

  /* ── Board 1c, the map row ────────────────────────────────────────────── */

  /**
   * Position in the list, matching the number on the map pin.
   *
   * The board draws the two together, and that is the whole point of it: a
   * buyer looking at a pin in Jebel Ali needs to find its row without reading
   * twenty names. Absent outside the map context.
   */
  rank?: number;
  /**
   * "2.1 km". Already formatted, and deliberately a string.
   *
   * Distance is computed from the buyer's filters on the server. Formatting it
   * in the component would mean the number rendering one way at prerender and
   * another at hydration, which is the class of bug that produced the React 418 hydration error on
   * board 1a's relative timestamps.
   */
  distanceLabel?: string;
  /**
   * One live fact: "Open until 18:00", "Closed · opens 08:00", "18 pumps in
   * catalogue". Formatted by the caller for the same reason as `distanceLabel`
   * — an opening-hours string measured against "now" cannot be computed twice
   * and agree.
   */
  liveFact?: string;
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
  /**
   * The WhatsApp reveal, rendered by the caller.
   *
   * A reveal needs client state and an action; this component is a server
   * component and should stay one. `ContactCard` takes its composer trigger the
   * same way and for the same reason — the island is the caller's, the layout
   * is ours.
   */
  contactAction?: React.ReactNode;
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
  contactAction,
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

  if (context === "map") {
    /*
       Board 1c's result row, beside the map.

       Denser than the search row and arranged around one job: reconciling a pin
       with a supplier. The rank number leads because that is the thing the map
       and the list agree on, and it takes the moss treatment when selected for
       the same reason the pin does.

       Unverified rows get "View listing" and nothing else. The board is
       explicit, and it is the same rule the unclaimed context runs on: an
       "Enquire" button on a listing nobody has checked sends a buyer's details
       to a record rather than to a supplier.
    */
    const verified = business.verificationTier >= 2;

    return (
      <Card as="article" elevation="flat" interactive selected={selected} padded={false}>
        <div className="flex gap-3 p-4">
          <LogoTile
            src={business.logoUrl}
            name={business.displayName}
            categoryCode={business.categoryCode}
            size="md"
          />

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-start gap-2">
              {business.rank !== undefined && (
                /*
                   Not an ordered-list marker, because the list is already an
                   `ol` and this has to be visible next to the name rather than
                   in the gutter. `aria-hidden` so a screen reader hears the
                   position once, from the list, not twice.
                */
                <span
                  aria-hidden
                  className={cn(
                    "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-pill",
                    "font-mono text-eyebrow tabular-nums",
                    selected ? "bg-moss text-on-ink" : "bg-ink text-on-ink",
                  )}
                >
                  {business.rank}
                </span>
              )}

              <h3 className="min-w-0 flex-1 text-body-sm text-ink">
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

            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-caption text-muted">
              <span className="truncate">{business.categoryName}</span>
              <span aria-hidden>·</span>
              <span className="truncate">{business.areaName}</span>
              {business.distanceLabel && (
                <>
                  <span aria-hidden>·</span>
                  <span className="tabular-nums">{business.distanceLabel}</span>
                </>
              )}
            </div>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              {verification}

              {!unclaimed && business.responseTimeMedianMs !== undefined && (
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

              {/* Exactly one, as the board draws it. The caller decides which. */}
              {business.liveFact && (
                <span className="text-caption text-muted">{business.liveFact}</span>
              )}
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {verified ? (
                <>
                  <a href={link} className="contents">
                    <Button size="sm" tabIndex={-1}>
                      {t("listing.storefront")}
                    </Button>
                  </a>
                  {enquireHref ? (
                    /*
                       `/rfq/new?to=<seller>` is one force-dynamic, uncached URL
                       per supplier — 30,000 of them at the listing target,
                       each linked from every row the supplier appears in. The
                       composer is already `noindex`, so there was never
                       anything at the end of these for a crawler to find.
                    */
                    <a
                      href={enquireHref}
                      rel={crawlRel(enquireHref)}
                      className={buttonClassName({ size: "sm", variant: "secondary" })}
                    >
                      {t("listing.enquire")}
                    </a>
                  ) : (
                    <Button size="sm" variant="secondary" disabled>
                      {t("listing.enquire")}
                    </Button>
                  )}
                  {contactAction}
                </>
              ) : (
                <a href={link} className={buttonClassName({ size: "sm", variant: "secondary" })}>
                  {t("listing.view_listing")}
                </a>
              )}
            </div>
          </div>

          {/*
             96px square, reserved whether or not there is a photo — the same
             rule as the search row, for the same reason: a list whose row
             heights depend on who uploaded an image jumps as you scroll it.
          */}
          <div className="relative hidden size-24 shrink-0 overflow-hidden rounded-chip lg:block">
            {business.coverImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={business.coverImageUrl}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <ImagePlaceholder kind="empty" className="absolute inset-0 h-full w-full" />
            )}
          </div>
        </div>
      </Card>
    );
  }

  if (context === "search") {
    /*
       Board 1b's row: a photo, what they do, and the column a buyer decides in.
       The three are separated so the eye can skip the middle — somebody
       scanning twenty suppliers reads names and reply times, and reads the
       description only once something has caught them.
    */
    return (
      <Card as="article" elevation="flat" interactive selected={selected} padded={false}>
        {/*
           A container query, not a media query.

           The row reflows on its **own** width rather than the window's, which
           is the difference between a card that works wherever it is put and one
           that only works in the results column it was drawn for. Board 2c puts
           this exact component in a 470px rail as a live preview, where the
           viewport is a desktop and the card is not — under `sm:` it kept the
           three-column row and squeezed the name to one word a line.

           The thresholds are chosen so nothing on `1c` moves: the results column
           is far wider than 24rem on a desktop and narrower than it on a phone,
           which is where the old breakpoints already put it.
        */}
        <div className="@container/row flex flex-col overflow-hidden @sm/row:flex-row">
          {/*
             Always reserved, even with nothing in it. A row whose height
             depends on whether a seller uploaded a photo makes the list jump,
             and the empty state is a recruiting signal rather than a gap.
          */}
          {/*
             The column takes the row's height rather than setting it. An
             aspect-ratio here would make an empty listing taller than a full
             one, which is the list jumping for the worst possible reason.
          */}
          <div className="relative h-32 w-full shrink-0 self-stretch @sm/row:h-auto @sm/row:w-[214px]">
            {business.coverImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={business.coverImageUrl}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <span className="absolute inset-0 flex items-center justify-center border-e border-line bg-[repeating-linear-gradient(135deg,var(--placeholder-stripe-a)_0_1px,var(--placeholder-stripe-b)_1px_8px)]">
                <span className="rounded-tag bg-card/70 px-2 py-1 font-mono text-eyebrow text-muted">
                  {t("display.no_image")}
                </span>
              </span>
            )}
            {business.sponsored && sponsoredLabel && (
              <span className="absolute left-2.5 top-2.5">
                <StatusBadge tone="warn" size="sm">
                  {sponsoredLabel}
                </StatusBadge>
              </span>
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-5 p-4 @3xl/row:flex-row @3xl/row:gap-6">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="min-w-0 text-h2 text-ink">
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
                {verification}
              </div>

              {business.tradeLine && (
                <p className="mt-1.5 text-body-sm text-muted">{business.tradeLine}</p>
              )}

              {business.description && (
                <p className="mt-2.5 max-w-[520px] text-body-sm leading-relaxed text-body">
                  {business.description}
                </p>
              )}

              {/*
                 Facts, not adjectives. Every chip here is a count or a state
                 from the record — §08 asks for the number, and "1,204 products"
                 is a reason to click where "wide range" is not.
              */}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {business.productCount !== undefined && business.productCount > 0 && (
                  <Tag size="sm">{t("listing.products", { count: business.productCount })}</Tag>
                )}
                {business.branchCount !== undefined && business.branchCount > 1 && (
                  <Tag size="sm">{t("listing.branches", { count: business.branchCount })}</Tag>
                )}
                {business.establishedYear && (
                  <Tag size="sm">{t("listing.years", { year: business.establishedYear })}</Tag>
                )}
                {business.trnOnFile && <Tag size="sm">{t("listing.trn_on_file")}</Tag>}
              </div>
            </div>

            {/* Where the decision happens. */}
            <div className="flex shrink-0 flex-col gap-2 @3xl/row:w-[196px] @3xl/row:border-s @3xl/row:border-line-mid @3xl/row:ps-5">
              {business.ratingOverall != null && (
                <div className="flex items-baseline gap-1.5">
                  <span className="text-h1 font-medium tabular-nums text-ink">
                    {business.ratingOverall.toFixed(1)}
                  </span>
                  <span className="text-caption text-muted">
                    {business.reviewCount
                      ? t("listing.reviews", { count: business.reviewCount })
                      : t("listing.no_reviews")}
                  </span>
                </div>
              )}

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

              {place}

              <div className="mt-auto flex flex-col gap-1.5 pt-3">
                <a href={link} className={buttonClassName({ size: "sm", block: true })}>
                  {t("listing.view_storefront")}
                </a>
                {/*
                   Contact actions belong to a claimed listing only. An
                   unclaimed one has nobody behind it to answer, and offering a
                   WhatsApp button that reaches a licence record is worse than
                   offering nothing — criterion 7.
                */}
                {!unclaimed && (
                  <>
                    <div className="flex gap-1.5">
                      {contactAction}
                      {enquireHref ? (
                        <a
                          href={enquireHref}
                          rel={crawlRel(enquireHref)}
                          className={cn(buttonClassName({ size: "sm", variant: "secondary" }), "flex-1")}
                        >
                          {t("product.enquire")}
                        </a>
                      ) : (
                        <span className="flex-1">
                          <Button size="sm" variant="secondary" block disabled title={t("enquiry.disabled")}>
                            {t("product.enquire")}
                          </Button>
                        </span>
                      )}
                    </div>
                    {/*
                       Board 1b does not draw this, and it stays anyway. The
                       comparison tray is a shipped feature with its own board
                       and its own tests — a buyer builds a shortlist from this
                       row and nowhere else, so dropping the control to match a
                       render would quietly delete the feature. Kept as a link
                       under the buttons rather than a third button, so the two
                       the board does draw keep their weight.
                    */}
                    <a
                      href={compareHref ?? `/compare?p=${business.slug}`}
                      /*
                         Adding a supplier to the tray preserves every other
                         parameter, so this control is a second combinatorial
                         space stacked on the facet one — 1.3 million tray
                         permutations from the 75 slugs a crawler reached on a
                         single shelf. The fallback href points at /compare,
                         which is disallowed outright.
                      */
                      rel={crawlRel(compareHref ?? `/compare?p=${business.slug}`)}
                      className={cn(
                        "rounded-tag text-center text-caption underline-offset-2 hover:underline",
                        "focus-visible:outline-none focus-visible:shadow-focus",
                        inCompare ? "font-medium text-moss-deep" : "text-moss",
                      )}
                    >
                      {compareLabel ?? t("action.compare")}
                    </a>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card
      as="article"
      elevation={context === "grid" ? "flat" : "flat"}
      interactive={!unclaimed}
      selected={selected}
      padded={false}
    >
      <div className="flex gap-3 p-4">
        <LogoTile
          src={business.logoUrl}
          name={business.displayName}
          categoryCode={business.categoryCode}
          size="md"
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="min-w-0 text-h3 text-ink">
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
            <Tag size="sm">{business.categoryName}</Tag>
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

        </div>
      </div>
    </Card>
  );
}
