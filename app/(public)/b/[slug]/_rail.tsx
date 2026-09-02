import Link from "next/link";
import { Card, KeyValuePanel } from "@/components/structure";
import { MapCanvas, StatusBadge, Tag } from "@/components/display";
import { cn } from "@/lib/cn";
import { formatDate, maskTRN } from "@/lib/format";
import { t } from "@/lib/i18n";
import { DAYS, type RamadanHours, type WeekHours } from "@/lib/trade/hours";
import { openNow } from "@/lib/trade/open-now";
import { VERIFIED_TIER } from "@/lib/verification";
import type { PublicBusiness } from "@/lib/db/queries";
import { RfqForm } from "@/app/(public)/rfq/RfqForm";
import { CopyAddress } from "./CopyAddress";

/**
 * Board 1d's right rail: hours, locations and what we checked.
 *
 * The rail is chrome rather than template sections, and the existing page
 * already carried a note about why — non-negotiable 2 says trust signals render
 * identically on every storefront, which is an argument that a seller's
 * template must not be able to reorder them, restyle them or switch them off.
 * A sector whose template dropped the licence panel would be a sector where we
 * quietly stopped showing what we checked.
 *
 * The composer sits here for a related reason: the enquiry is the conversion
 * event and it is not a seller's to compose away.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Hours
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The week, with a live open/closed dot.
 *
 * ## Where "now" is decided
 *
 * On the server, at render. The page revalidates every five minutes, so the dot
 * can be up to that stale at an opening or closing boundary — a supplier who
 * shuts at 18:00 may read "Open until 18:00" until 18:05.
 *
 * The alternative is computing it in the browser, which is exact but hands a
 * crawler and a reader with JavaScript off no answer at all, and reintroduces
 * the hydration class of bug that board 1a already produced once by measuring
 * "now" twice. A five-minute window on a trade counter's door is the smaller
 * cost, and `openNow` is timezone-correct either way.
 */
export function HoursPanel({
  hours,
  ramadanHours,
  now = new Date(),
}: {
  hours: WeekHours | null | undefined;
  ramadanHours: RamadanHours | null | undefined;
  now?: Date;
}) {
  const state = openNow(hours, ramadanHours, now);

  // Nothing on file is nothing to show. The board removes a section whose data
  // is absent rather than rendering an empty one.
  if (state.state === "unknown") return null;

  const { hours: week } = { hours: (hours ?? {}) as WeekHours };
  const effective: WeekHours =
    state.isRamadan && ramadanHours?.all
      ? Object.fromEntries(DAYS.map((day) => [day, ramadanHours.all!]))
      : week;

  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-h3 text-brand-ink">{t("storefront.hours")}</h2>
        <span className="flex items-center gap-1.5">
          {/*
             A dot and a word. Colour alone would make "open" invisible to a
             reader who cannot see it, and this is a fact somebody may be about
             to drive across Dubai on.
          */}
          <span
            aria-hidden
            className={cn(
              "block size-2 rounded-pill",
              state.state === "open" ? "bg-ok" : "bg-line-strong",
            )}
          />
          <span className="text-caption font-medium text-ink">
            {state.state === "open"
              ? t("storefront.open_until", { time: state.until })
              : state.opensAt
                ? t("storefront.closed_opens", { time: state.opensAt })
                : t("storefront.closed")}
          </span>
        </span>
      </div>

      {state.isRamadan && (
        /*
           Said plainly, and said as something that happened rather than
           something the reader must do. The switch is automatic; a seller who
           set reduced hours in March should not have to remember to turn them
           on, and a buyer should not have to work out which week applies.
        */
        <p className="mt-2 rounded-chip bg-warn-wash px-2.5 py-2 text-caption text-ink">
          {t("storefront.ramadan_applied")}
        </p>
      )}

      <dl className="mt-3 flex flex-col gap-1">
        {DAYS.map((day) => {
          const shifts = effective[day] ?? [];
          const closed = shifts.length === 0;
          return (
            <div key={day} className="flex items-baseline justify-between gap-3">
              <dt className={cn("text-caption", closed ? "text-faint" : "text-body")}>
                {t(`storefront.day.${day}` as never)}
              </dt>
              <dd
                className={cn(
                  "font-mono text-eyebrow tabular-nums",
                  closed ? "text-faint" : "text-body",
                )}
              >
                {closed
                  ? t("storefront.closed")
                  : shifts.map((shift) => `${shift.open}–${shift.close}`).join(", ")}
              </dd>
            </div>
          );
        })}
      </dl>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Locations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The head office, the branches, and a map that never invents a pin.
 *
 * Unpinned locations are excluded from the map and counted, exactly as the
 * search map does — board 1c criterion 4 is a rule about the platform, not
 * about one page. The address below is still shown: we know where they are,
 * we just do not know where that is on a map.
 */
export function LocationsPanel({ business }: { business: PublicBusiness }) {
  const locations = business.locations;
  if (locations.length === 0) return null;

  const head = locations[0]!;
  const pins = locations
    .filter((location) => location.lat !== null && location.lng !== null)
    .map((location, index) => ({
      id: location.id,
      lat: location.lat!,
      lng: location.lng!,
      label: `${location.area.name}, ${t(`emirate.${location.emirate}` as never)}`,
      kind: (index === 0 ? "head_office" : "verified") as "head_office" | "verified",
    }));

  const excluded = locations.length - pins.length;

  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-h3 text-brand-ink">{t("storefront.locations")}</h2>
        {locations.length > 1 && (
          <a
            href={`/b/${business.slug}/branches`}
            className="rounded-tag text-body-sm text-moss underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
          >
            {t("storefront.all_branches", { count: locations.length })}
          </a>
        )}
      </div>

      {pins.length > 0 && (
        <div className="mt-3">
          <MapCanvas
            label={t("storefront.locations")}
            height={132}
            pins={pins}
            excluded={excluded}
            excludedLabel={t("map.excluded", { count: excluded })}
            emptyLabel={t("display.map_empty")}
          />
        </div>
      )}

      <address className="mt-3 not-italic">
        <p className="text-body-sm text-ink">{head.addressLine}</p>
        <p className="text-caption text-muted">
          {head.area.name}, {t(`emirate.${head.emirate}` as never)}
        </p>
      </address>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {head.lat !== null && head.lng !== null && (
          /*
             A map link rather than an embedded route: the buyer's own maps app
             knows where they are and this page does not, which is the same
             reason the search page takes its distance origin from a filter.
          */
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${head.lat},${head.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-ctl border border-line px-2.5 py-1.5 text-caption font-medium text-ink hover:bg-paper focus-visible:outline-none focus-visible:shadow-focus"
          >
            {t("storefront.directions")}
          </a>
        )}
        <CopyAddress
          address={`${head.addressLine}, ${head.area.name}, ${t(`emirate.${head.emirate}` as never)}`}
          label={t("storefront.copy_address")}
          copiedLabel={t("storefront.address_copied")}
        />
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Verification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What we checked, what we did not, and who did the checking.
 *
 * Board 1d calls the closing sentence "the most valuable copy on the page" and
 * says not to soften it. It is also the reason this panel is platform chrome
 * that no seller theme reaches: a trust signal a seller could restyle is a
 * trust signal worth nothing.
 *
 * Every row states its own state rather than implying the others. A tier 1
 * listing shows a licence check that has not happened yet, in the same neutral
 * tone as one that has — never a green tick for work nobody did.
 */
export function VerificationPanel({
  business,
  now = new Date(),
}: {
  business: PublicBusiness;
  /*
     Taken as a parameter rather than read inside the body. `Date.now()` during
     render is an impure call — the lint rule that catches it is the same rule
     that would have caught board 1a's relative-timestamp hydration bug, and it
     is right: a component whose output depends on when React happened to run
     it is a component that renders two different pages.
  */
  now?: Date;
}) {
  const licenceExpired = business.licenceExpiry.getTime() < now.getTime();

  const rows = [
    {
      key: "licence",
      label: t("verify.row_licence"),
      done: business.verificationTier >= VERIFIED_TIER,
      date: business.verifiedAt ? formatDate(business.verifiedAt) : undefined,
    },
    {
      key: "trn",
      label: t("verify.row_trn"),
      done: Boolean(business.trn) && business.verificationTier >= VERIFIED_TIER,
      date: business.verifiedAt ? formatDate(business.verifiedAt) : undefined,
    },
    {
      key: "visit",
      label: t("verify.row_visit"),
      done: Boolean(business.visitedAt),
      date: business.visitedAt ? formatDate(business.visitedAt) : undefined,
    },
  ];

  return (
    <Card>
      <h2 className="text-h3 text-ink">{t("verify.panel_title")}</h2>

      {licenceExpired && (
        /*
           Criterion 10. The badge comes off the same day the licence lapses and
           the page stays live — an expired licence is not grounds for
           delisting, only for de-badging, and a buyer is better served by a
           page that says so than by one that vanished.
        */
        <div className="mt-2">
          <StatusBadge tone="warn" size="sm">
            {t("verify.licence_renewal_pending")}
          </StatusBadge>
        </div>
      )}

      <ul className="mt-3 flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.key} className="flex items-baseline gap-2">
            <span
              aria-hidden
              className={cn(
                "mt-0.5 block size-3.5 shrink-0 rounded-pill border-2",
                row.done ? "border-ok bg-ok" : "border-line-strong bg-card",
              )}
            />
            <span className="min-w-0 flex-1">
              <span className={cn("text-caption", row.done ? "text-ink" : "text-muted")}>
                {row.done ? row.label : t("verify.row_not_yet", { check: row.label })}
              </span>
              {row.done && row.date && (
                <span className="ms-1.5 font-mono text-eyebrow tabular-nums text-muted">
                  {row.date}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>

      {/* The sentence the board says not to soften. It is not softened. */}
      <p className="mt-3 text-caption text-body">{t("verify.not_self_declared")}</p>

      <Link
        href="/verification-policy"
        className="mt-2 inline-block rounded-tag text-caption text-moss underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
      >
        {t("verify.report_issue")}
      </Link>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Enquiry composer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The composer, inline in the rail rather than behind a button.
 *
 * Board 1d puts a real form here, and the reason is the whole page: this is
 * what the directory exists to deliver. A buyer who has read the description,
 * the hours and the verification panel should not then have to find and press
 * something before they can type.
 *
 * The same `RfqForm` the drawer wraps, without the drawer. One form, so the
 * redaction rules, the fanout and the contact fields cannot drift between the
 * two places a buyer can start an enquiry.
 *
 * The reply-time line is measured or absent. "Typically answered within 2
 * hours" on a supplier who has never answered anything would be the invention
 * criterion 5 of the project rules forbids, and the honest alternative — saying
 * they are new — is also more useful than silence.
 */
export function EnquiryComposer({
  business,
  emirates,
  signedIn,
  responseLabel,
  answeredWithin,
}: {
  business: PublicBusiness;
  emirates: readonly { value: string; label: string }[];
  signedIn: boolean;
  responseLabel: string;
  /** Already formatted, or absent where nothing has been measured. */
  answeredWithin?: string;
}) {
  const head = business.locations[0];

  return (
    <Card>
      <h2 className="text-h3 text-brand-ink">{t("storefront.send_enquiry_title")}</h2>
      <p className="mt-0.5 text-caption text-muted">
        {answeredWithin
          ? t("storefront.answered_within", { duration: answeredWithin })
          : t("storefront.answered_unmeasured")}
      </p>

      <div className="mt-3">
        <RfqForm
          shape="single"
          categoryId={business.primaryCategoryId}
          emirates={emirates}
          initialRecipients={[
            {
              businessId: business.id,
              displayName: business.displayName,
              areaName: head?.area?.name ?? null,
              verificationTier: business.verificationTier,
              responseLabel,
              pinned: true,
            },
          ]}
          pinnedBusinessIds={[business.id]}
          askForContact={!signedIn}
          defaultFanout={4}
        />
      </div>

      {/*
         Both halves of this are true, and that is the only reason it is here.
         No account is needed — `askForContact` collects a name and a mobile
         instead — and the number is redacted until the supplier replies, which
         `lib/enquiry/redaction.ts` enforces rather than this sentence promising.
      */}
      <p className="mt-2.5 text-caption text-faint">{t("storefront.composer_privacy")}</p>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Business details
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The ten rows, masked where they must be.
 *
 * Criterion 4: licence and TRN are masked and carry a tick only when verified;
 * the full values never reach the DOM. The mask comes from `maskTRN`, never
 * hand-formatted — a second implementation is a second chance to reveal three
 * digits too many, and the seller's own dashboard is the one place the whole
 * number is shown.
 *
 * Criterion 5's other half lives here too. **Trade name** is the legal name,
 * marked licence-locked because the seller genuinely cannot change it: it is
 * whatever the licence says. **Trading as** is the display name — the one in
 * the `h1` and on every card that links here. Showing both, labelled, is what
 * stops the page appearing to disagree with the search results.
 */
export function BusinessDetails({
  business,
  lastUpdated,
}: {
  business: PublicBusiness;
  /** Already formatted by the caller. */
  lastUpdated: string;
}) {
  const verified = business.verificationTier >= VERIFIED_TIER;
  const tick = (value: React.ReactNode) =>
    verified ? (
      <span className="inline-flex items-center gap-1.5">
        {value}
        <span className="text-ok" aria-label={t("storefront.verified_tick")}>
          ✓
        </span>
      </span>
    ) : (
      value
    );

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-h2 text-brand-ink">{t("storefront.details_title")}</h2>
        <span className="font-mono text-eyebrow uppercase tabular-nums text-muted">
          {t("storefront.last_updated", { date: lastUpdated })}
        </span>
      </div>

      <div className="mt-3">
        <KeyValuePanel
          columns={2}
          notProvidedLabel={t("table.not_provided")}
          entries={[
            {
              key: "trade_name",
              label: `${t("storefront.trade_name")} · ${t("storefront.licence_locked")}`,
              value: business.tradeName,
            },
            {
              key: "trading_as",
              label: t("storefront.trading_as"),
              value: business.displayName,
            },
            {
              key: "licence",
              /*
                 Masked with the same function the TRN uses. The licence number
                 is on the public register, but printing it whole here makes
                 this page the convenient place to copy it from, and a licence
                 number is most of what a convincing impersonation needs.
              */
              label: t("storefront.licence"),
              value: tick(maskTRN(business.licenceNumber)),
              mono: true,
            },
            {
              key: "trn",
              label: t("trade.trn"),
              value: business.trn ? tick(maskTRN(business.trn)) : undefined,
              mono: true,
            },
            {
              key: "authority",
              label: t("storefront.authority"),
              value: business.licenceAuthority,
            },
            {
              key: "established",
              label: t("storefront.established"),
              value: business.establishedYear ?? undefined,
            },
            {
              key: "team",
              label: t("storefront.team"),
              value: business.teamSize
                ? t(`storefront.team_band.${business.teamSize}` as never)
                : undefined,
            },
            {
              key: "payment",
              label: t("storefront.payment_terms"),
              value: business.paymentTerms ?? undefined,
            },
            {
              key: "delivery",
              label: t("storefront.delivery"),
              value: business.deliveryNote ?? undefined,
            },
            {
              key: "languages",
              label: t("storefront.languages"),
              value: business.languages.length > 0 ? business.languages.join(", ") : undefined,
              wide: true,
            },
          ]}
        />
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Capability chips
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The trades they carry, and what they can do with them.
 *
 * Board 1d asks for "the seller's subcategories plus capability flags (Site
 * delivery, etc)". The subcategories are real — `BusinessCategory` rows the
 * seller chose. The capability flags are derived from facts already on the
 * record rather than invented as a new set of checkboxes nobody fills in:
 * a service radius means they deliver, a free-zone address means they trade
 * from one, more than one branch means they have counters in more than one
 * place.
 *
 * A flag that came from a field a seller had to tick would be a flag that is
 * blank on almost every listing, which is how a capability row becomes noise.
 */
export function CapabilityChips({ business }: { business: PublicBusiness }) {
  const trades = business.categories
    .map((link) => link.category.name)
    .filter((name) => name !== business.primaryCategory.name);

  const radius = business.locations.find((location) => location.serviceRadiusKm !== null);
  const freeZone = business.locations.some((location) => location.area.isFreeZone);

  const capabilities = [
    radius?.serviceRadiusKm
      ? t("storefront.service_radius", { km: radius.serviceRadiusKm })
      : null,
    freeZone ? t("facet.free_zone_option") : null,
    business.locations.length > 1
      ? t("listing.branches", { count: business.locations.length })
      : null,
  ].filter((label): label is string => label !== null);

  if (trades.length === 0 && capabilities.length === 0) return null;

  return (
    <section>
      <h2 className="sr-only">{t("storefront.categories")}</h2>
      <div className="flex flex-wrap gap-1.5">
        {trades.map((name) => (
          <Tag key={name}>{name}</Tag>
        ))}
        {capabilities.map((label) => (
          <Tag key={label}>{label}</Tag>
        ))}
      </div>
    </section>
  );
}
