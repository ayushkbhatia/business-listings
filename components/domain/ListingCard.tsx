import Link from "next/link";
import type { ClaimStatus } from "@/lib/db/generated/enums";
import { cn } from "@/lib/cn";
import { publiclyClaimed } from "@/lib/claims/status";
import { claimHref, invitesClaim } from "@/lib/listing/claim";
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
 *   ranked      board 6a's landing-page row: rank disc, one line of what they
 *               do, a meta strip, and the two stacked actions
 *
 * Tier 4 imports t() directly. Tiers 1 to 3 stay generic and take their strings
 * as props; a domain component is domain-specific by definition, and threading
 * twenty catalogue keys through props would be ceremony.
 *
 * ## Claimed or not is the business's, not the caller's
 *
 * `context` names a layout. Whether the listing is claimed is a fact about the
 * business, read from `business.claimStatus` — build plan 4.6. It used to be a
 * fifth context word, `unclaimed`, and only the gallery ever passed it: four
 * of the five production call sites asked for a layout and got the claimed
 * card for every listing, so a licence import with nobody behind it was drawn
 * with a reply-time slot, a quote button and a WhatsApp reveal wherever a buyer
 * could reach it. A state the caller has to remember to ask for is a state
 * production does not render.
 *
 * The unclaimed state is not a lesser version of the others. It states
 * plainly that nothing is verified, shows only what the licence record holds,
 * and never invents hours, a rating or an empty star row. Roughly three in four
 * listings are unclaimed, so this is a large share of what Google sees.
 *
 * Every layout has it. The two roomy ones — `grid` and `search` — carry the
 * whole panel: what this is, why none of it is confirmed, the claim and the
 * report. The two dense rows say the first of those in a line and offer *View
 * listing* and nothing else, which is boards 1b and 1c's rule for an unverified
 * row; the listing page they go to carries the claim card. No layout offers an
 * enquiry or a contact action on an unclaimed listing: the enquiry service
 * refuses one, and a button that cannot deliver is worse than none.
 */
export type ListingContext = "search" | "map" | "grid" | "ranked";

interface ListingCardFacts {
  slug: string;
  displayName: string;
  categoryName: string;
  categoryCode: string;
  areaName: string;
  emirateName: string;
  verificationTier: number;
  verifiedAt?: Date | string | null;
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

/**
 * Whose listing this is, and what the claim link needs when it renders.
 *
 * Wherever a listing can read as unclaimed the card may print a claim link,
 * prefilled with the licence number and withheld on a lapsed licence, so the
 * type asks for both whenever the status is not `claimed`. Board 2c's preview
 * is the one caller that knows its listing is claimed, and it is spared two
 * values it would never render.
 */
type ClaimFacts =
  | { claimStatus: "claimed"; licenceNumber?: string; licenceExpiry?: Date | string }
  | {
      claimStatus: Exclude<ClaimStatus, "claimed">;
      licenceNumber: string;
      licenceExpiry: Date | string;
    };

export type ListingCardBusiness = ListingCardFacts & ClaimFacts;

export interface ListingCardProps {
  business: ListingCardBusiness;
  /** The layout. Never whether the listing is claimed — that is `business.claimStatus`. */
  context?: ListingContext;
  href?: string;
  selected?: boolean;
  /** Labelled sponsor mark, already localised. */
  sponsoredLabel?: string;
  /**
   * Where the enquiry affordance goes. Absent leaves it disabled, which is the
   * state handoff 1 shipped and the one the gallery still shows. Ignored on an
   * unclaimed listing, which has nobody to send one to.
   */
  enquireHref?: string;
  /**
   * The WhatsApp reveal, rendered by the caller.
   *
   * A reveal needs client state and an action; this component is a server
   * component and should stay one. `ContactCard` takes its composer trigger the
   * same way and for the same reason — the island is the caller's, the layout
   * is ours. Ignored on an unclaimed listing, like `enquireHref`.
   */
  contactAction?: React.ReactNode;
  /** When "now" is, for the lapsed-licence test on the claim link. */
  now?: Date;
}

function badgeDate(business: ListingCardFacts): string | undefined {
  // Every dated rung dates from `verifiedAt` now. The visited rung was the only
  // one that did not, and it went with site visits.
  const spec = tierSpec(business.verificationTier);
  if (spec.dateField === "none" || !business.verifiedAt) return undefined;
  return formatDate(business.verifiedAt);
}

/**
 * What an unclaimed listing may print: the licence record, and nothing a
 * person added to it.
 *
 * Every layout below already renders a fact only where it is present, so most
 * of the unclaimed state is this projection rather than a branch in each of
 * them — no rating, no review count, no reply time, no product, branch or year
 * count, no TRN chip, no live fact. A count the card is not given is a count it
 * cannot imply.
 *
 * Photos, the logo and the description go as well as the numbers, and a
 * disputed listing is why. A claimant holds a seat from the moment they submit,
 * so whatever they uploaded while two claims are open is exactly what board 4c
 * `B10` keeps off the public listing. The trade line narrows to the category
 * the import filed it under, for the same reason.
 */
function recordOnly(business: ListingCardFacts): ListingCardFacts {
  return {
    slug: business.slug,
    displayName: business.displayName,
    categoryName: business.categoryName,
    categoryCode: business.categoryCode,
    areaName: business.areaName,
    emirateName: business.emirateName,
    verificationTier: business.verificationTier,
    verifiedAt: business.verifiedAt,
    tradeLine: business.categoryName,
    sponsored: business.sponsored,
    rank: business.rank,
    distanceLabel: business.distanceLabel,
  };
}

export function ListingCard({
  business,
  context = "search",
  href,
  selected = false,
  sponsoredLabel,
  enquireHref,
  contactAction,
  now = new Date(),
}: ListingCardProps) {
  const unclaimed = !publiclyClaimed(business.claimStatus);
  const shown = unclaimed ? recordOnly(business) : business;
  const spec = tierSpec(shown.verificationTier);
  const link = href ?? `/b/${shown.slug}`;
  /*
     The sibling of the claim controls on `10g`'s page composition, and it has
     to match them: the same destination, prefilled with the licence rather
     than the name, and absent on a lapsed licence, where the page withholds
     its claim card too. `crawlRel` because a distinct query string per card,
     across a results page of them, is the crawl shape
     `lib/seo/crawl-policy.ts` was written about.
  */
  const claimLink =
    unclaimed && business.licenceNumber && invitesClaim(business, now)
      ? claimHref(business.licenceNumber)
      : null;

  const verification = (
    <VerificationBadge
      compact
      size={context === "map" ? "sm" : "md"}
      tier={shown.verificationTier}
      label={t(spec.labelKey as never)}
      checked={t(spec.checkedKey as never)}
      date={badgeDate(shown)}
      tierLabel={t("verify.tier", { tier: shown.verificationTier })}
    />
  );

  /*
     Only the parts there are. An import whose area the importer could not
     match has no branch, and its callers pass empty strings — which printed a
     lone separator under the name.
  */
  const placeText = [shown.areaName, shown.emirateName].filter(Boolean).join(" · ");
  const place = placeText ? <span className="truncate text-caption text-muted">{placeText}</span> : null;

  /*
     The one line every unclaimed listing carries, in every layout. The two
     roomy layouts say it inside the full panel; the dense rows say only this.
  */
  const unclaimedLine = unclaimed ? (
    <span className="text-caption text-body">{t("listing.unclaimed_title")}</span>
  ) : null;

  if (context === "map") {
    /*
       Board 1c's result row, beside the map.

       Denser than the search row and arranged around one job: reconciling a pin
       with a supplier. The rank number leads because that is the thing the map
       and the list agree on, and it takes the moss treatment when selected for
       the same reason the pin does.

       Unverified rows get "View listing" and nothing else. The board is
       explicit, and it is the same rule the unclaimed state runs on: an
       "Enquire" button on a listing nobody has checked sends a buyer's details
       to a record rather than to a supplier. The rank and the distance stay on
       an unclaimed row — the pin it pairs with is still on the map.
    */
    const verified = shown.verificationTier >= 2 && !unclaimed;

    return (
      <Card as="article" elevation="flat" interactive selected={selected} padded={false}>
        <div className="flex gap-3 p-4">
          <LogoTile
            src={shown.logoUrl}
            name={shown.displayName}
            categoryCode={shown.categoryCode}
            size="md"
          />

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-start gap-2">
              {shown.rank !== undefined && (
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
                  {shown.rank}
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
                  {shown.displayName}
                </a>
              </h3>

              {shown.sponsored && sponsoredLabel && (
                <StatusBadge tone="neutral" size="sm">
                  {sponsoredLabel}
                </StatusBadge>
              )}
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-caption text-muted">
              <span className="truncate">{shown.categoryName}</span>
              {shown.areaName && (
                <>
                  <span aria-hidden>·</span>
                  <span className="truncate">{shown.areaName}</span>
                </>
              )}
              {shown.distanceLabel && (
                <>
                  <span aria-hidden>·</span>
                  <span className="tabular-nums">{shown.distanceLabel}</span>
                </>
              )}
            </div>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              {verification}

              {shown.responseTimeMedianMs !== undefined && (
                <ResponseTime
                  size="sm"
                  medianMs={shown.responseTimeMedianMs}
                  durationLabel={shown.responseDurationLabel}
                  label={
                    shown.responseDurationLabel
                      ? t("response.median", { duration: shown.responseDurationLabel })
                      : undefined
                  }
                  unmeasuredLabel={t("response.unmeasured")}
                />
              )}

              {/* Exactly one, as the board draws it. The caller decides which. */}
              {shown.liveFact && (
                <span className="text-caption text-muted">{shown.liveFact}</span>
              )}

              {unclaimedLine}
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
            {shown.coverImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={shown.coverImageUrl}
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

  if (context === "ranked") {
    /*
       Board 6a §4 — the row on an area landing page.

       Narrower than `search` and arranged around a different question. A buyer
       on `/c/hvac` is choosing what kind of supplier they want and gets a
       photo; a buyer who arrived here from Google already knows, and what they
       are deciding is *which of these ten*. So: the rank, who they are, one
       line of what they do, and the four facts that separate them.

       Rank 1 takes `--paper` and a `--line-strong` border, through `selected`.
       Not a different component and not a badge — the first row is the one the
       page is recommending, and the board says that with a fill rather than a
       word. The moss selection treatment would be the wrong grammar: moss means
       the reader chose it, and this is the page's own opinion.

       No compare link and no photo. §SEO budgets this page at about fifty
       anchors against `6c`'s hundred and fifty-six, on the grounds that it has
       a buyer to convert rather than only a crawler to feed; the tray is
       reachable from `1b` and `1c`, which is where a buyer building a shortlist
       actually is.

       Unclaimed, the line of what they do is the line saying nobody has
       claimed it, the meta strip has nothing measured to show and is left out,
       and the two actions become one. 6a ranks these last on every page, so
       the strip of them at the foot of a page reads as what it is.
    */
    return (
      <Card as="article" elevation="flat" padded={false} surface={selected ? "paper" : "card"}>
        {/*
           The container and the thing it lays out are two elements, not one.

           A container query cannot style the element that declares the
           container — `@container/ranked` and `@xl/ranked:flex-row` on the same
           div silently never fires, and the row renders with its two actions
           wrapped under the description at every width. It builds, it lints, and
           the only way to notice is to look at it.
        */}
        <div className="@container/ranked">
          <div className="flex flex-col gap-4 p-4 @xl/ranked:flex-row @xl/ranked:items-center @xl/ranked:gap-5">
            <div className="flex min-w-0 flex-1 items-start gap-3.5 @sm/ranked:gap-4">
              {shown.rank !== undefined && (
                /*
                   `aria-hidden`: the list is an `ol` and a screen reader already
                   announces the position. The disc is for the eye reconciling
                   "third result" with the page it lands on.
                */
                <span
                  aria-hidden
                  className={cn(
                    "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-pill",
                    "font-mono text-eyebrow tabular-nums",
                    selected ? "bg-ink text-on-ink" : "bg-fill text-body",
                  )}
                >
                  {shown.rank}
                </span>
              )}

              <LogoTile
                src={shown.logoUrl}
                name={shown.displayName}
                categoryCode={shown.categoryCode}
                size="lg"
              />

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="min-w-0 text-body font-medium text-ink">
                    <a
                      href={link}
                      className={cn(
                        "rounded-tag underline-offset-2 hover:underline",
                        "focus-visible:outline-none focus-visible:shadow-focus",
                      )}
                    >
                      {shown.displayName}
                    </a>
                  </h3>
                  {verification}
                  {shown.sponsored && sponsoredLabel && (
                    <StatusBadge tone="warn" size="sm">
                      {sponsoredLabel}
                    </StatusBadge>
                  )}
                </div>

                {unclaimed ? (
                  <p className="mt-1.5">{unclaimedLine}</p>
                ) : (
                  shown.description && (
                    <p className="mt-1.5 line-clamp-2 text-caption leading-relaxed text-body">
                      {shown.description}
                    </p>
                  )
                )}

                {/*
                   The meta strip. Every entry is a measurement or it is absent —
                   there is no "unknown", no empty star row and no slow-looking
                   placeholder. §4: "A seller with no answered enquiries shows no
                   band at all."
                */}
                {!unclaimed && (
                  <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
                    {shown.ratingOverall != null && (
                      <span className="text-caption text-muted">
                        <b className="font-medium tabular-nums text-ink">
                          {shown.ratingOverall.toFixed(1)}
                        </b>{" "}
                        {shown.reviewCount
                          ? t("listing.reviews", { count: shown.reviewCount })
                          : t("listing.no_reviews")}
                      </span>
                    )}
                    {shown.establishedYear && (
                      <span className="text-caption text-muted">
                        {t("listing.years", { year: shown.establishedYear })}
                      </span>
                    )}
                    {shown.responseTimeMedianMs != null && (
                      <ResponseTime
                        size="sm"
                        bare
                        medianMs={shown.responseTimeMedianMs}
                        durationLabel={shown.responseDurationLabel}
                        unmeasuredLabel={t("response.unmeasured")}
                      />
                    )}
                    {shown.productCount !== undefined && shown.productCount > 0 && (
                      <span className="text-caption text-muted">
                        {t("listing.products", { count: shown.productCount })}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/*
               Two actions, stacked on the board and side by side under `@xl`,
               where the row is a phone's width and a stack costs the height of a
               whole extra row per supplier.
            */}
            <div className="flex shrink-0 gap-2 @xl/ranked:w-[168px] @xl/ranked:flex-col">
              {unclaimed ? (
                <a
                  href={link}
                  className={cn(
                    buttonClassName({ size: "sm", variant: "secondary", block: true }),
                    "flex-1",
                  )}
                >
                  {t("listing.view_listing")}
                </a>
              ) : (
                <>
                  <a
                    href={link}
                    className={cn(buttonClassName({ size: "sm", block: true }), "flex-1")}
                  >
                    {t("listing.view_storefront")}
                  </a>
                  {enquireHref ? (
                    <a
                      href={enquireHref}
                      rel={crawlRel(enquireHref)}
                      className={cn(
                        buttonClassName({ size: "sm", variant: "secondary", block: true }),
                        "flex-1",
                      )}
                    >
                      {t("listing.enquire")}
                    </a>
                  ) : (
                    <span className="flex-1">
                      <Button size="sm" variant="secondary" block disabled title={t("enquiry.disabled")}>
                        {t("listing.enquire")}
                      </Button>
                    </span>
                  )}
                </>
              )}
            </div>
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

       Unclaimed, the middle is the panel and the decision column is the place
       and *View listing*: 1b's "one secondary View listing and no contact
       actions", with the row keeping the shape of the rows above it.
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

           Two elements, for the reason the ranked row gives: a container query
           cannot style the element that declares the container. This was one
           div, so `@sm/row:flex-row` never fired while the photo column's own
           `@sm/row:` widths did — every row on a category page stacked, with a
           214px photo slot of zero height and its label spilling over the top
           edge of the card.
        */}
        <div className="@container/row">
          <div className="flex flex-col overflow-hidden @sm/row:flex-row">
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
              {shown.coverImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={shown.coverImageUrl}
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
              {shown.sponsored && sponsoredLabel && (
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
                      {shown.displayName}
                    </a>
                  </h3>
                  {verification}
                </div>

                {shown.tradeLine && (
                  <p className="mt-1.5 text-body-sm text-muted">{shown.tradeLine}</p>
                )}

                {shown.description && (
                  <p className="mt-2.5 max-w-[520px] text-body-sm leading-relaxed text-body">
                    {shown.description}
                  </p>
                )}

                {/*
                   Facts, not adjectives. Every chip here is a count or a state
                   from the record — §08 asks for the number, and "1,204 products"
                   is a reason to click where "wide range" is not.
                */}
                {!unclaimed && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {shown.productCount !== undefined && shown.productCount > 0 && (
                      <Tag size="sm">{t("listing.products", { count: shown.productCount })}</Tag>
                    )}
                    {shown.branchCount !== undefined && shown.branchCount > 1 && (
                      <Tag size="sm">{t("listing.branches", { count: shown.branchCount })}</Tag>
                    )}
                    {shown.establishedYear && (
                      <Tag size="sm">{t("listing.years", { year: shown.establishedYear })}</Tag>
                    )}
                    {shown.trnOnFile && <Tag size="sm">{t("listing.trn_on_file")}</Tag>}
                  </div>
                )}

                {unclaimed && <UnclaimedPanel slug={shown.slug} claimLink={claimLink} />}
              </div>

              {/* Where the decision happens. */}
              <div className="flex shrink-0 flex-col gap-2 @3xl/row:w-[196px] @3xl/row:border-s @3xl/row:border-line-mid @3xl/row:ps-5">
                {shown.ratingOverall != null && (
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-h1 font-medium tabular-nums text-ink">
                      {shown.ratingOverall.toFixed(1)}
                    </span>
                    <span className="text-caption text-muted">
                      {shown.reviewCount
                        ? t("listing.reviews", { count: shown.reviewCount })
                        : t("listing.no_reviews")}
                    </span>
                  </div>
                )}

                {shown.responseTimeMedianMs !== undefined && (
                  <ResponseTime
                    size="sm"
                    medianMs={shown.responseTimeMedianMs}
                    durationLabel={shown.responseDurationLabel}
                    label={
                      shown.responseDurationLabel
                        ? t("response.median", { duration: shown.responseDurationLabel })
                        : undefined
                    }
                    unmeasuredLabel={t("response.unmeasured")}
                  />
                )}

                {place}

                <div className="mt-auto flex flex-col gap-1.5 pt-3">
                  {/*
                     Contact actions belong to a claimed listing only. An
                     unclaimed one has nobody behind it to answer, and offering a
                     WhatsApp button that reaches a licence record is worse than
                     offering nothing — criterion 7.
                  */}
                  {unclaimed ? (
                    <a
                      href={link}
                      className={buttonClassName({ size: "sm", variant: "secondary", block: true })}
                    >
                      {t("listing.view_listing")}
                    </a>
                  ) : (
                    <>
                      <a href={link} className={buttonClassName({ size: "sm", block: true })}>
                        {t("listing.view_storefront")}
                      </a>
                      <div className="flex gap-1.5">
                        {contactAction}
                        {enquireHref ? (
                          <a
                            href={enquireHref}
                            rel={crawlRel(enquireHref)}
                            className={cn(buttonClassName({ size: "sm", variant: "secondary" }), "flex-1")}
                          >
                            {t("listing.enquire")}
                          </a>
                        ) : (
                          <span className="flex-1">
                            <Button size="sm" variant="secondary" block disabled title={t("enquiry.disabled")}>
                              {t("listing.enquire")}
                            </Button>
                          </span>
                        )}
                      </div>
                      {/*
                         No compare control on a supplier. Board `10d` made the
                         comparison a product comparison — four products against
                         one trade's spec template — and a firm is not a row of
                         those fields. The tick lives on product cards and rows.
                      */}
                    </>
                  )}
                </div>
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
          src={shown.logoUrl}
          name={shown.displayName}
          categoryCode={shown.categoryCode}
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
                {shown.displayName}
              </a>
            </h3>
            {shown.sponsored && sponsoredLabel && (
              <StatusBadge tone="neutral" size="sm">
                {sponsoredLabel}
              </StatusBadge>
            )}
          </div>

          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            {place}
            <Tag size="sm">{shown.categoryName}</Tag>
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
                {shown.responseTimeMedianMs !== undefined && (
                  <ResponseTime
                    size="sm"
                    medianMs={shown.responseTimeMedianMs}
                    durationLabel={shown.responseDurationLabel}
                    label={
                      shown.responseDurationLabel
                        ? t("response.median", { duration: shown.responseDurationLabel })
                        : undefined
                    }
                    unmeasuredLabel={t("response.unmeasured")}
                  />
                )}

                {shown.productCount !== undefined && shown.productCount > 0 && (
                  <span className="font-mono text-eyebrow tabular-nums text-muted">
                    {t("listing.products", { count: shown.productCount })}
                  </span>
                )}

                {shown.reviewCount !== undefined && (
                  <span className="font-mono text-eyebrow tabular-nums text-muted">
                    {shown.reviewCount > 0
                      ? t("listing.reviews", { count: shown.reviewCount })
                      : t("listing.no_reviews")}
                  </span>
                )}
              </>
            )}
          </div>

          {unclaimed && <UnclaimedPanel slug={shown.slug} claimLink={claimLink} />}
        </div>
      </div>
    </Card>
  );
}

/**
 * The unclaimed state's panel, as handoff 1 designed it: what this is, why none
 * of it is confirmed, and the two things the reader can do about it.
 *
 * Both were `disabled` under a stale enquiry tooltip once, on a card that
 * carries no enquiry action by design. The report link went to the
 * verification policy until board 13c built the report itself; it goes there
 * now, by the address that works without the storefront's modal, since a
 * results page has no modal to open.
 */
function UnclaimedPanel({ slug, claimLink }: { slug: string; claimLink: string | null }) {
  return (
    <div className="mt-3 rounded-chip border border-line bg-paper-sunk p-3">
      <p className="text-caption text-body">{t("listing.unclaimed_title")}</p>
      <p className="mt-1 text-caption text-muted">{t("listing.unclaimed_body")}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {claimLink && (
          <Link
            href={claimLink}
            rel={crawlRel(claimLink)}
            className={buttonClassName({ size: "sm", variant: "secondary" })}
          >
            {t("listing.claim_cta")}
          </Link>
        )}
        <Link
          href={`/report/${slug}`}
          rel="nofollow"
          className={buttonClassName({ variant: "link" })}
        >
          {t("listing.report")}
        </Link>
      </div>
    </div>
  );
}
