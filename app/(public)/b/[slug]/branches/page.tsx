import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { redirectIfMoved, absorbedInto } from "@/lib/listing/redirect";
import { Breadcrumb, PublicShell } from "@/components/structure";
import { StatusBadge } from "@/components/display";
import { getBusinessBySlug } from "@/lib/db/queries";
import {
  branchStatus,
  coverageOf,
  emirateSummary,
  orderBranches,
  ramadanActive,
  type BranchLocation,
} from "@/lib/trade/branches";
import { openingHoursSchema } from "@/lib/trade/open-now";
import { branchClosures, publicHolidaysAround } from "@/lib/db/queries/hours";
import { readRamadanCalendar } from "@/lib/trade/ramadan-calendar";
import type { BranchSchedule } from "@/lib/trade/closures";
import type { RamadanCalendar } from "@/lib/trade/hours";
import { formatDate, formatPhone, formatShifts, toE164 } from "@/lib/format";
import { t } from "@/lib/i18n";
import { navPages } from "@/lib/storefront/pages";
import { JsonLd } from "@/app/(public)/_json-ld";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { StorefrontHeader, storefrontCrumbs } from "../_storefront";
import { BranchesClient, type ClientBranch } from "./_client";

/**
 * Board 1f — branches & hours.
 *
 * Two buyer questions, both urgent: **can I get there today**, and **can I get
 * it today**. The detail column answers the first, the delivery card answers the
 * second, and nothing that answers neither is on the page.
 *
 * ## Why this route revalidates faster than the rest of the storefront
 *
 * Every other storefront route sits at 300 seconds. A stale product count is a
 * cosmetic error; a stale "Open now" sends somebody across Dubai on a Thursday
 * afternoon to a shut door. The spec calls it "the single most damaging
 * inaccuracy here" and it is right — this is the one page whose freshness is
 * measured in wasted journeys rather than in wrong numbers.
 *
 * Sixty seconds for the whole route rather than a split cache, because the
 * badge is server-rendered and its freshness is the page's freshness. Computing
 * it in the browser instead would put it on the reader's clock, which is the
 * exact failure criterion 2 exists to prevent.
 */
export const revalidate = 60;

interface Params {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) return {};

  const { emirates } = emirateSummary(business.locations as BranchLocation[]);
  const list = emirates.map((emirate) => t(`emirate.${emirate}` as never)).join(", ");

  return {
    title: t("branches.title", { name: business.displayName, emirates: list }),
    description: t("seo.branches_description", {
      name: business.displayName,
      count: business.locations.length,
    }),
    alternates: { canonical: `/b/${slug}/branches` },
  };
}

export default async function BranchesPage({ params }: Params) {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) {
    /*
     * Before the 404, the two ways a listing legitimately moves: a rename wrote
     * a redirect, or a merge absorbed it. Both wrote rows nothing read until
     * handoff 4 step 2.
     */
    await redirectIfMoved(`/b/${slug}`);
    notFound();
  }

  const movedTo = await absorbedInto(slug);
  if (movedTo) permanentRedirect(`/b/${movedTo}`);

  // An unclaimed listing has no subpages. It is a licence record, not a
  // storefront, and there is nothing here for it to show.
  if (business.claimStatus === "unclaimed") notFound();

  /*
     Criterion 10's second half: no published location means no tab, and
     `StorefrontHeader` already hides it. Reaching this route directly is then a
     URL for a page with nothing on it.
  */
  const locations = business.locations as unknown as BranchLocation[];
  if (locations.length === 0) notFound();

  const now = new Date();
  /*
     Board 3d criterion 6, on the page a buyer checks before driving somewhere.

     The temporary closure has always been handled above the week; these are the
     rung below it. Without them a branch shut for Eid reports "Open until
     18:00" here, which is the exact failure the `open now` filter's rank makes
     expensive — it is the third most-used filter on the site.

     Loaded once for the page rather than per card. The calendar is national and
     the closures belong to these branches, so one read serves every card.
  */
  const [calendar, holidays] = await Promise.all([
    readRamadanCalendar(),
    publicHolidaysAround(now),
  ]);
  const closuresByBranch = await branchClosures(locations.map((location) => location.id));

  const { branches } = orderBranches(locations, null);
  const summary = emirateSummary(locations);
  const ramadan = ramadanActive(now);
  const coverage = coverageOf(locations, business.deliveryNote);
  const pages = business.sectorId ? await navPages(business.sectorId) : [];

  const pinned = locations.filter((l) => l.lat != null && l.lng != null);
  const excluded = locations.length - pinned.length;

  const emirateList = summary.emirates
    .map((emirate) => t(`emirate.${emirate}` as never))
    .join(", ");
  const emirateLabel = summary.more
    ? t("branches.emirates_more", { list: emirateList, count: summary.more })
    : emirateList;

  /*
     Both shapes of every branch, rendered here and handed over as nodes.

     The client decides which to show; it never formats. That keeps the Dubai
     clock, the localisation and the hours parsing on the server, and it is the
     shape boards 1d and 1e both arrived at the expensive way — a callback prop
     cannot cross the boundary and the grid renders as nothing at all.
  */
  const clientBranches: ClientBranch[] = branches.map((location) => ({
    id: location.id,
    lat: location.lat,
    lng: location.lng,
    radiusKm: location.serviceRadiusKm,
    label: `${business.displayName} — ${t(`location.${location.type}` as never)}, ${location.area.name}`,
    kind:
      location.type === "head_office"
        ? "head_office"
        : business.verificationTier >= 2
          ? "verified"
          : "unverified",
    expanded: (
      <BranchCard
        location={location}
        now={now}
        expanded
        calendar={calendar}
        dates={{ holidays, closures: closuresByBranch.get(location.id) ?? [] }}
      />
    ),
    compact: (
      <BranchCard
        location={location}
        now={now}
        expanded={false}
        calendar={calendar}
        dates={{ holidays, closures: closuresByBranch.get(location.id) ?? [] }}
      />
    ),
  }));

  return (
    <PublicShell
      bleed
      nav={<DirectoryNav />}
      breadcrumb={
        <Breadcrumb
          label={t("gallery.breadcrumb_label")}
          items={storefrontCrumbs(business, t("storefront.branches"))}
        />
      }
      footer={<DirectoryFooter />}
    >
      <div data-theme={business.themePreset ?? "default"}>
        <StorefrontHeader
          business={business}
          active="branches"
          pages={pages}
          now={now}
          subline={t("branches.subline", {
            count: locations.length,
            emirates: emirateLabel,
          })}
        />

        <BranchesClient
          branches={clientBranches}
          mapLabel={t("display.map_label")}
          excluded={excluded}
          excludedLabel={t("display.map_excluded", { count: excluded })}
          noPinsLabel={t("branches.no_pins")}
          countEyebrow={t("branches.count_eyebrow", { count: locations.length })}
          sortedEmirateLabel={t("branches.sorted_emirate")}
          sortedDistanceLabel={t("branches.sorted_distance")}
          nearestLabel={t("branches.nearest")}
          locatingLabel={t("branches.locating")}
          declinedLabel={t("branches.location_declined")}
          radiusLabel={t("branches.radius_overlay")}
          listLabel={t("branches.list_view")}
          mapViewLabel={t("branches.map_view")}
          distanceTemplate={t("branches.distance_km", { km: "{km}" })}
          ramadanStrip={
            ramadan ? (
              /*
                 Criterion 3. Rendered only inside the window and absent outside
                 it — not greyed, because a strip about hours that are not in
                 effect is a sentence a buyer has to work out is irrelevant.
              */
              <div className="border-t border-warn-line bg-warn-wash px-5 py-3.5 md:px-7">
                <p className="text-body-sm text-warn-ink">
                  <strong className="font-medium">{t("branches.ramadan_live")}</strong>{" "}
                  {t("branches.ramadan_detail", { until: formatDate(ramadan.to) })}
                </p>
              </div>
            ) : undefined
          }
          deliveryCard={
            coverage ? (
              <div className="rounded-card border border-line bg-card/94 p-3 shadow-overlay backdrop-blur-sm">
                {coverage.radiusKm != null && (
                  <p className="text-body-sm font-medium text-ink">
                    {t("branches.delivers_within", { km: coverage.radiusKm })}
                  </p>
                )}
                {coverage.note && (
                  <p className="mt-1.5 text-caption leading-relaxed text-muted">{coverage.note}</p>
                )}
                {coverage.radiusKm == null && coverage.freeZone && (
                  <p className="mt-1.5 text-caption text-muted">{t("branches.free_zone")}</p>
                )}
              </div>
            ) : undefined
          }
        />
      </div>

      {/*
         Criterion 9: one `LocalBusiness` per branch, each with its own address,
         hours and telephone. This is the page Google reads for local pack
         eligibility, so a single blob covering four addresses would be the
         wrong markup for the one page where per-branch data matters most.

         An unpinned branch is emitted without `geo` rather than with a
         fabricated one. The same rule the map runs: a coordinate we do not have
         is not a coordinate we may invent, and inventing one in a machine-
         readable format is the worst place to do it.
      */}
      {locations.map((location) => (
        <JsonLd
          key={location.id}
          data={{
            "@context": "https://schema.org",
            "@type": "LocalBusiness",
            name: `${business.displayName} — ${t(`location.${location.type}` as never)}`,
            identifier: business.licenceNumber,
            address: {
              "@type": "PostalAddress",
              streetAddress: location.addressLine,
              addressLocality: location.area.name,
              addressRegion: t(`emirate.${location.emirate}` as never),
              addressCountry: "AE",
            },
            geo:
              location.lat != null && location.lng != null
                ? {
                    "@type": "GeoCoordinates",
                    latitude: location.lat,
                    longitude: location.lng,
                  }
                : undefined,
            /*
               The real number, unmasked, for the reason board 1d gives: schema
               is for machines, and a crawler will not send an enquiry.

               Marked up whenever it is shown, which is the same rule the
               storefront one level up already runs — it publishes `head.phone`
               with no verification gate. Structured data that omitted a number
               the page displays is the mismatch crawlers actually penalise.
            */
            // E.164, matching the `tel:` href the page renders — a crawler
            // cannot infer the country from the stored local form.
            telephone: location.phone ? (toE164(location.phone) ?? location.phone) : undefined,
            openingHoursSpecification: openingHoursSchema(
              location.hours as never,
              location.ramadanHours as never,
              now,
            ),
          }}
        />
      ))}
    </PublicShell>
  );
}

/*
   44px tall on every width, not only below 768.

   Criterion 12 asks for it on a phone, and there is no width at which a thumb
   gets smaller. `inline-flex` with a min-height rather than padding arithmetic,
   so the target does not shrink when the label is one word.
*/
const ACTION_BASE =
  "inline-flex min-h-11 items-center rounded-ctl px-3.5 text-body-sm font-medium " +
  "focus-visible:outline-none focus-visible:shadow-focus";
const ACTION_PRIMARY = `${ACTION_BASE} bg-moss text-white hover:bg-moss-deep`;
const ACTION_SECONDARY = `${ACTION_BASE} border border-line bg-card text-ink hover:bg-paper`;

const WEEKDAYS = ["mon", "tue", "wed", "thu"] as const;
const WEEKEND = ["fri", "sat"] as const;

/** Hours are JSON on the row; this is the only place on this page that reads their shape. */
function shiftsFor(hours: unknown, day: string): { open: string; close: string }[] {
  if (!hours || typeof hours !== "object") return [];
  const value = (hours as Record<string, unknown>)[day];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (s): s is { open: string; close: string } =>
      typeof s === "object" && s !== null && "open" in s && "close" in s,
  );
}

/**
 * The same days as the render's contact grid, collapsed where they agree.
 *
 * "MON–THU 08:00–18:00" is one cell because a counter that opens at eight every
 * weekday has said one thing, not four.
 *
 * Where they disagree the distinct values are listed once each rather than once
 * per day. This market runs split shifts — 08:00–13:00 and 16:00–20:00 is an
 * ordinary trade counter — and a supplier who closes an hour earlier on Thursday
 * produced four near-identical strings in one cell before this deduplicated.
 * Two values is information; four copies of two values is noise.
 *
 * A closed day survives the dedupe. It was filtered out at first and that was
 * wrong: "closed" in the Friday cell is the fact a buyer needs, and dropping it
 * left the cell claiming Saturday's hours applied to both.
 */
function summarise(hours: unknown, days: readonly string[]): string {
  const rendered = days.map((day) => {
    const shifts = shiftsFor(hours, day);
    // `formatShifts` returns a bare lowercase "closed" that never went through
    // the catalogue. Swapped here rather than in the formatter, which a dozen
    // other surfaces already render.
    return shifts.length === 0 ? t("branches.closed_short") : formatShifts(shifts);
  });
  return [...new Set(rendered)].join(" / ");
}

/**
 * One branch, in both of its shapes.
 *
 * Expanded carries the contact grid and the actions; compact carries the mono
 * line the render draws — hours and phone in one string, because a secondary row
 * is scanned rather than read. Both are rendered on the server for every branch
 * and the client picks; see the note on `clientBranches` above.
 */
function BranchCard({
  location,
  now,
  expanded,
  calendar,
  dates,
}: {
  location: BranchLocation;
  now: Date;
  expanded: boolean;
  calendar: RamadanCalendar;
  dates: Pick<BranchSchedule, "holidays" | "closures">;
}) {
  const status = branchStatus(location, now, calendar, dates);
  const closure = location.closedFrom && location.closedUntil && location.closureReason
    ? { from: location.closedFrom, until: location.closedUntil, reason: location.closureReason }
    : null;
  const closureActive = closure && now >= closure.from && now <= closure.until;

  /*
     Criterion 4 in the column: an unpinned branch is here, with its address,
     and says so. It is not hidden and it is not given a centroid.
  */
  const unpinned = location.lat == null || location.lng == null;

  /*
     Shown in full, and shown whether or not anybody has checked it.

     This page used to hide a number unless `Location.phoneVerified` was true,
     which made it stricter than the storefront one level up — that page marks
     up `head.phone` with no such gate. Nothing has ever written the column
     outside the seed, so in production the rule hid *every* branch number from
     *every* buyer, and the seeded 80% made it look like it worked.

     The gate is gone rather than given a writer. A branch page only exists for
     a claimed listing (see the `notFound` above), so this number was typed by
     the business itself; and an unclaimed listing already says page-wide that
     nothing on it has been confirmed. Neither case is improved by silence.

     Unlike board 1d it is not masked: the buyer has navigated two levels to
     reach a specific branch, the reveal event was written once on the overview,
     and masking it a second time is friction that buys no signal.
  */
  const phone = location.phone;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <h2 className={expanded ? "text-h3 text-brand-ink" : "text-body font-medium text-ink"}>
          {t(`location.${location.type}` as never)}
        </h2>
        <BranchBadge status={status} />
      </div>

      <p className="mt-1.5 text-body-sm leading-relaxed text-body">{location.addressLine}</p>
      <p className="text-caption text-muted">
        {location.area.name} · {t(`emirate.${location.emirate}` as never)}
        {unpinned && <> · {t("branches.unpinned_note")}</>}
      </p>

      {closureActive && (
        /*
           Above the hours, because it overrides them. A buyer who reads
           "08:00–18:00" first and the closure second has already decided to go.
        */
        <div className="mt-2.5 rounded-ctl border border-warn-line bg-warn-wash px-3 py-2">
          <p className="text-caption font-medium text-warn-ink">
            {t("branches.closure_title", { until: formatDate(closure.until) })}
          </p>
          <p className="mt-0.5 text-caption text-warn-ink">{closure.reason}</p>
        </div>
      )}

      {expanded ? (
        <>
          <dl className="mt-3.5 grid grid-cols-1 gap-x-5 gap-y-2.5 border-t border-line pt-3.5 sm:grid-cols-2">
            <Cell label={t("storefront.phone")}>
              {phone ? (
                /*
                   Criterion 13: every number is a `tel:` link. The href is
                   E.164 because a dialler needs the country code, and the label
                   is the local form because that is how it is written on the
                   van.
                */
                <a href={`tel:${toE164(phone) ?? phone}`} className="hover:underline">
                  {formatPhone(phone)}
                </a>
              ) : (
                t("table.not_provided")
              )}
            </Cell>
            <Cell label={t("storefront.whatsapp")}>
              {location.whatsapp ? (
                <a
                  href={`https://wa.me/${(toE164(location.whatsapp) ?? location.whatsapp).replace(/[^\d]/g, "")}`}
                  rel="nofollow noopener"
                  className="hover:underline"
                >
                  {formatPhone(location.whatsapp)}
                </a>
              ) : (
                t("table.not_provided")
              )}
            </Cell>
            <Cell label={t("branches.mon_thu")}>{summarise(location.hours, WEEKDAYS)}</Cell>
            <Cell label={t("branches.fri_sat")}>{summarise(location.hours, WEEKEND)}</Cell>
          </dl>

          <div className="mt-3.5 flex flex-wrap gap-2">
            {/*
               Directions, Call and — where a buyer can collect — the fact that
               they can. No enquiry action: this page is "where and when", and
               the composer lives on the overview and the catalogue.

               `Directions` hands off to the native maps app on every width, not
               only below 768. A pannable map inside a browser tab is not what
               somebody standing next to a van wants.
            */}
            <a
              href={mapsHref(location)}
              target="_blank"
              rel="noopener noreferrer"
              className={ACTION_PRIMARY}
            >
              {t("storefront.directions")}
            </a>
            {phone && (
              <a href={`tel:${toE164(phone) ?? phone}`} className={ACTION_SECONDARY}>
                {t("branches.call_branch")}
              </a>
            )}
            {isCollectable(location) && (
              <StatusBadge tone="neutral" size="sm">
                {t("branches.collection_point")}
              </StatusBadge>
            )}
          </div>
        </>
      ) : (
        <p className="mt-1.5 font-mono text-caption text-muted">
          {summarise(location.hours, WEEKDAYS)}
          {phone && (
            <>
              {" · "}
              {/* Criterion 13 applies to the compact row too. It read as a
                  number and was not one, which on a phone is the difference
                  between calling the branch and copying it out by hand. */}
              <a href={`tel:${toE164(phone) ?? phone}`} className="text-ink hover:underline">
                {formatPhone(phone)}
              </a>
            </>
          )}
        </p>
      )}
    </>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-mono text-eyebrow uppercase tracking-eyebrow text-faint">{label}</dt>
      <dd className="mt-1 text-body-sm text-ink">{children}</dd>
    </div>
  );
}

function BranchBadge({ status }: { status: ReturnType<typeof branchStatus> }) {
  if (status.kind === "type") {
    /* Criterion 6: the type, where hours would mislead. */
    return (
      <StatusBadge tone="neutral" size="sm">
        {t("branches.sales_only")}
      </StatusBadge>
    );
  }
  if (status.kind === "open") {
    return (
      <StatusBadge tone="ok" size="sm" dot>
        {t("branches.open_now")}
      </StatusBadge>
    );
  }
  if (status.kind === "closed") {
    /* Criterion 7: never a bare "Closed" when the next opening is known. */
    return (
      <StatusBadge tone="neutral" size="sm">
        {status.until
          ? t("branches.closure_title", { until: formatDate(status.until) })
          : status.opensAt
            ? t("storefront.closed_opens", { time: status.opensAt })
            : t("branches.closed")}
      </StatusBadge>
    );
  }
  /* No hours on file is unknown, never closed. Absent data is not a shut door. */
  return (
    <StatusBadge tone="neutral" size="sm">
      {t("branches.hours_unknown")}
    </StatusBadge>
  );
}

/**
 * Where "Directions" goes.
 *
 * Coordinates when we have them, the written address when we do not — a query
 * on the address is a worse route and still a route, which beats a dead button
 * on the one page a buyer opens to find their way there.
 */
function mapsHref(location: BranchLocation): string {
  const query =
    location.lat != null && location.lng != null
      ? `${location.lat},${location.lng}`
      : `${location.addressLine}, ${location.area.name}, ${t(`emirate.${location.emirate}` as never)}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** A counter a buyer can collect from, as opposed to an office or a workshop. */
function isCollectable(location: BranchLocation): boolean {
  return (
    location.type === "trade_counter" ||
    location.type === "warehouse" ||
    location.type === "depot"
  );
}
