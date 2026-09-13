import type { Metadata } from "next";
import type { Emirate } from "@/lib/db/generated/enums";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { Breadcrumb, Card, Panel, PublicShell } from "@/components/structure";
import { Tag } from "@/components/display";
import { ScopeTable, VerificationBadge, scopeWords, tierSpec } from "@/components/domain";
import { getBusinessBySlug } from "@/lib/db/queries";
import { prisma } from "@/lib/db/client";
import { publicServiceFor, publicServicesFor } from "@/lib/services/service";
import { publicCredentialsFor, type PublicCredential } from "@/lib/credentials/service";
import { effectiveCoverage } from "@/lib/locations/service-coverage";
import { formatMonth } from "@/lib/format";
import { t } from "@/lib/i18n";
import { EMIRATES } from "@/lib/uae";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { PageEvent } from "@/components/telemetry";

/**
 * Board `1g-s` — service detail, and the scope table where the spec table was.
 *
 * The product page sells a thing: photographs, dimensions, tolerances, a stock
 * level. This page has none of those and has to do the same job — let a buyer
 * decide whether to enquire, and compare this firm against two others while
 * deciding.
 *
 * The instrument is the **scope table**: the same rows, in the same order, for
 * every firm in the family. A buyer comparing three audit practices reads the
 * same nine rows three times. That is the whole design, which is why the order
 * comes from `ScopeSheetFamily` and never from the service.
 *
 * ## No price, anywhere
 *
 * Fee **basis** is public — "fixed fee, quoted after a look at the trial
 * balance" is useful and commits to nothing. The **indicative fee** is private
 * and is not merely hidden here: `publicServiceFor` does not select the column,
 * so it cannot reach this page, its payload, its meta description or its
 * structured data. `3g-s` B5 asks for the assertion to live in the response
 * type rather than the template, and a field that is never fetched is the
 * strongest version of that.
 *
 * ## Unfilled rows stay visible, and this diverges from B2
 *
 * The board asks for unfilled rows to be omitted from the DOM. `CLAUDE.md`
 * § Interface honesty says the opposite, in as many words, about the table this
 * one replaces: *"Unfilled spec rows render grey reading 'Not provided', never
 * hidden. The buyer sees what is unanswered and the request becomes
 * high-intent."* The repository rule wins, and the board's own render settles
 * it on the board's own terms: it prints "9 of 12 rows are filled" under a
 * table with the empty ones removed, so the buyer already learns three rows are
 * unanswered and simply cannot see which. See `docs/services-build-plan.md` §4g.
 */
export const revalidate = 300;

interface Params {
  params: Promise<{ slug: string; service: string }>;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, service: serviceSlug } = await params;
  const [service, business] = await Promise.all([
    publicServiceFor(slug, serviceSlug),
    getBusinessBySlug(slug),
  ]);
  if (!service || !business) return {};

  const title = `${service.name} — ${business.displayName}`;
  return {
    title,
    description: t("service_public.meta_description", {
      name: service.name,
      business: business.displayName,
    }),
    // From the business's own slug, never the route parameter: a seller's web
    // address rewrites to `/b/<label>`, and a canonical built from the
    // parameter would have that address declare itself canonical.
    alternates: { canonical: `/b/${business.slug}/s/${serviceSlug}` },
    openGraph: {
      title,
      type: "website",
      url: `/b/${business.slug}/s/${serviceSlug}`,
    },
  };
}

/** One row, as the shape `effectiveCoverage` reads. */
function toScope(row: { emirate: Emirate; areaId: string | null }) {
  return { emirate: row.emirate, areaId: row.areaId };
}

export default async function ServiceDetailPage({ params }: Params) {
  const { slug, service: serviceSlug } = await params;
  const service = await publicServiceFor(slug, serviceSlug);

  if (!service) {
    /*
       A draft, a deleted service, or a suspended listing. The buyer came for
       this supplier, and the supplier usually still exists — so they land on
       the storefront rather than dead-ending. A 404 is kept for the case where
       the storefront is gone too, because there is nowhere honest to send them.
    */
    const business = await getBusinessBySlug(slug);
    if (business) permanentRedirect(`/b/${slug}`);
    notFound();
  }

  const business = await getBusinessBySlug(slug);
  if (!business) notFound();

  const [siblings, coverage, credentials] = await Promise.all([
    publicServicesFor(service.businessId),
    /*
       The business default *and* this service's own rows, in one query. Board
       `3c-s` gave the table a `serviceId`; before it, every row here was the
       default and this page could only ever show the firm's coverage on a
       page about one engagement.
    */
    prisma.serviceCoverage.findMany({
      where: {
        businessId: service.businessId,
        OR: [{ serviceId: null }, { serviceId: service.id }],
      },
      select: {
        emirate: true,
        areaId: true,
        serviceId: true,
        area: { select: { name: true } },
      },
    }),
    /*
       Board `8b-s`'s Feeds note. The file never travels: `publicCredentialsFor`
       does not select `documentId` at all, which is the same defence
       `indicativeFee` gets — a field that is never fetched cannot leak into
       this page, its payload or its structured data.
    */
    publicCredentialsFor(service.businessId),
  ]);

  /*
     Board `1g-s` B8 — the service's *effective* coverage: its own rows if it
     has any, otherwise the business default from `2d-s`.

     `businessCoverage` used to stand here, and on a page about one engagement
     it was the wrong helper twice over: it answers *where does this firm
     work*, and with `3c-s`'s rows in the table it would have unioned a
     service's narrowing back into the default it was narrowing away from — so
     restricting one service to Dubai would have published it as covering
     everywhere, which is the seller punished for being precise.
  */
  const areaNames = new Map(
    coverage.filter((row) => row.areaId).map((row) => [row.areaId!, row.area?.name ?? ""]),
  );
  const scopes = effectiveCoverage(
    coverage.filter((row) => row.serviceId === null).map(toScope),
    coverage.filter((row) => row.serviceId !== null).map(toScope),
  );
  const places = scopes.map((scope) =>
    scope.areaId
      ? (areaNames.get(scope.areaId) ?? emirateLabel(scope.emirate))
      : emirateLabel(scope.emirate),
  );

  const others = siblings.filter((row) => row.id !== service.id);

  const crumbs = [
    { label: t("chrome.directory"), href: "/" },
    { label: service.categoryName, href: `/c/${service.categorySlug}` },
    { label: business.displayName, href: `/b/${business.slug}` },
    { label: service.name },
  ];

  return (
    <PublicShell
      nav={<DirectoryNav />}
      breadcrumb={<Breadcrumb label={t("gallery.breadcrumb_label")} items={crumbs} />}
      footer={<DirectoryFooter />}
    >
      <PageEvent name="service_viewed" props={{ serviceId: service.id }} />

      <div className="mx-auto flex w-full max-w-[75rem] flex-col gap-8 px-[var(--section-pad)] py-8">
        {/* ── Header ───────────────────────────────────────────────────── */}
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-eyebrow uppercase tracking-eyebrow text-faint">
              {t("service_public.badge")}
            </span>
            <Link
              href={`/b/${business.slug}`}
              className="rounded-tag text-body-sm text-body underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
            >
              {business.displayName}
            </Link>
            {/* Compact: one line in a header row. It still carries what was
                checked — criterion 8 has no exceptions — as the title and to
                assistive technology; what is dropped is the second visible
                line, not the information. */}
            <VerificationBadge
              compact
              tier={business.verificationTier}
              label={t(tierSpec(business.verificationTier).labelKey as never)}
              checked={t(tierSpec(business.verificationTier).checkedKey as never)}
            />
          </div>

          <h1 className="font-serif text-h1-serif text-ink sm:text-[2rem]">{service.name}</h1>

          {/*
             No prose paragraph here.

             The design render carries a description above the chips that is
             distinct from the scope below — but the model this same handoff
             specifies has one prose field for an engagement, and putting it in
             both places renders the same four lines twice on one screen. The
             scope leads the panel directly beneath, which is where it says
             something the heading does not.
          */}
          {/*
             Three chips, not four. The fourth in the design render is
             "Accepting new clients", and D11 closed as no on 11 Sep: a listed
             business is taking work, and a stale flag is worse than no flag
             because a buyer who acts on one and gets no reply blames the
             directory rather than the firm.
          */}
          {service.chips.length > 0 && (
            <ul className="flex list-none flex-wrap gap-1.5 p-0">
              {service.chips.map((chip) => (
                <li key={chip.key}>
                  <Tag>{chipWords(chip)}</Tag>
                </li>
              ))}
            </ul>
          )}
        </header>

        {/* ── Scope of work ────────────────────────────────────────────── */}
        <Panel title={t("service_public.scope_title")}>
          {service.scope || service.excluded ? (
            /*
               Equal weight, and not an accordion — `1g-s` B4. A buyer choosing
               between two audit firms is materially served by knowing one of
               them will not touch group consolidation, and the firm is served
               by saying so before the enquiry rather than after it.
            */
            <div className="grid gap-6 md:grid-cols-2">
              <section>
                <h3 className="font-mono text-eyebrow uppercase tracking-wide text-muted">
                  {t("service_public.included")}
                </h3>
                <p className="mt-2 whitespace-pre-line text-body-sm text-body">
                  {service.scope ?? t("service_public.not_provided")}
                </p>
              </section>
              <section>
                <h3 className="font-mono text-eyebrow uppercase tracking-wide text-muted">
                  {t("service_public.excluded")}
                </h3>
                <p className="mt-2 whitespace-pre-line text-body-sm text-body">
                  {service.excluded ?? t("service_public.not_provided")}
                </p>
                {service.excluded && (
                  <p className="mt-2 text-caption text-muted">
                    {t("service_public.excluded_note")}
                  </p>
                )}
              </section>
            </div>
          ) : (
            <p className="max-w-prose text-body-sm text-muted">
              {t("service_public.scope_none")}
            </p>
          )}
        </Panel>

        {/* ── The comparison instrument ────────────────────────────────── */}
        <Panel
          title={t("service_public.table_title")}
          description={t("service_public.table_hint", { family: service.familyName })}
        >
          {/*
             The same component the setup screen's live preview mounts —
             `8c-s` B11. Two copies of this markup is two tables that agree
             today, and the preview is the one place a disagreement would be
             invisible until a seller published on the strength of it.
          */}
          <ScopeTable rows={service.rows} filled={service.filled} total={service.total} />
        </Panel>

        {/* ── Who signs it ─────────────────────────────────────────────── */}
        <Panel
          title={t("service_public.credentials_title")}
          description={t("service_public.credentials_hint")}
        >
          <Credentials rows={credentials} name={business.displayName} />
        </Panel>

        {/* ── Where they work ──────────────────────────────────────────── */}
        <Panel title={t("service_public.coverage_title")}>
          {places.length > 0 ? (
            <ul className="flex list-none flex-wrap gap-1.5 p-0">
              {places.map((place) => (
                <li key={place}>
                  <Tag>{place}</Tag>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body-sm text-muted">{t("service_public.coverage_none")}</p>
          )}
        </Panel>

        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <Card>
            <h2 className="text-body font-medium text-ink">
              {t("service_public.no_price_title")}
            </h2>
            <p className="mt-2 max-w-prose text-body-sm text-body">
              {t("service_public.no_price_body")}
            </p>
            <div className="mt-4">
              <Link
                href={`/rfq/new?business=${business.slug}&service=${service.slug}`}
                className="inline-flex items-center rounded-ctl bg-moss px-4 py-2 text-body-sm text-on-ink hover:bg-moss-deep focus-visible:shadow-focus focus-visible:outline-none"
              >
                {t("service_public.enquire")}
              </Link>
            </div>
          </Card>

          {/*
             The rest of this firm's work, rather than the design render's strip
             of competitors. The comparison strip is family-and-area scoped —
             `1g-s` B9 — and neither the family assignment nor the facets it
             needs exist yet: every category resolves to the seeded default, so
             a "same family, same emirate" query would return the whole
             directory. A strip that widened to the whole country is the one
             thing the board's own B9 refuses, so this ships without it and
             `1c-s` brings it.
          */}
          {others.length > 0 && (
            <Panel title={t("service_public.other_services", { name: business.displayName })}>
              <ul className="flex list-none flex-col gap-2 p-0">
                {others.slice(0, 6).map((row) => (
                  <li key={row.id}>
                    <Link
                      href={`/b/${business.slug}/s/${row.slug}`}
                      className="rounded-tag text-body-sm text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                    >
                      {row.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </PublicShell>
  );
}

/**
 * `Ongoing contract`, `On the client's site`. Worded here, never on the wire.
 *
 * Two of the nine rows hold an enum value and the rest hold the seller's own
 * text, so the wording happens where `t()` lives rather than in the loader — a
 * label function crossing into a component is this repo's most repeated defect,
 * and a loader that returned words would be a loader no other surface could
 * translate.
 */
function chipWords(chip: { key: string; value: string }): string {
  return scopeWords(chip.key, chip.value);
}

function emirateLabel(emirate: string): string {
  return EMIRATES.find((row) => row.value === emirate)?.label ?? emirate;
}

/* ── Who signs it ────────────────────────────────────────────────────────── */

/**
 * The trust block, where a product page shows stock availability.
 *
 * Board `8b-s` sets the tier labelling and this is one of the two screens it
 * binds: **an unverified claim must never render like a verified one.** The
 * separation here is structural rather than a colour — a checked credential
 * says which register checked it and when, and a claim says whose claim it is,
 * by name. A buyer reading "Stated by Meridian Chartered Accountants" knows
 * exactly how much the line is worth, which is the whole point of printing it.
 *
 * Empty is a real state and says so. A practice that has added nothing renders
 * the sentence rather than the panel vanishing: § Interface honesty — an
 * unclaimed listing says plainly that nothing is verified, and a section that
 * disappears when thin tells a buyer nothing about whether it was ever asked.
 */
function Credentials({ rows, name }: { rows: readonly PublicCredential[]; name: string }) {
  if (rows.length === 0) {
    return <p className="text-body-sm text-muted">{t("service_public.credentials_none")}</p>;
  }

  return (
    <ul className="flex list-none flex-col gap-3 p-0">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-col gap-0.5">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span className="text-body-sm text-ink">
              {t(`credentials.kind.${row.kind}` as never)}
            </span>
            {row.verified ? (
              <span className="font-mono text-eyebrow uppercase text-moss">
                {t("credentials.tier.register_verified")}
              </span>
            ) : (
              <span className="text-caption text-muted">
                {t("service_public.credential_claim", { name })}
              </span>
            )}
          </div>
          {/*
             Identifier, issuer and expiry, and only where the seller gave them
             — this is a buyer's surface, and "Not provided" belongs in the
             editor and in the scope table the board asks a buyer to compare
             across firms, not under a trust line that has nothing to compare to.
          */}
          <p className="text-caption text-muted">
            {[
              row.issuer,
              row.identifier,
              row.expiresOn === null
                ? null
                : t("service_public.credential_until", { when: formatMonth(row.expiresOn) }),
              row.verified && row.verifiedBy
                ? t("service_public.credential_by", { register: row.verifiedBy })
                : null,
            ]
              .filter((part): part is string => Boolean(part))
              .join(" · ")}
          </p>
        </li>
      ))}
    </ul>
  );
}
