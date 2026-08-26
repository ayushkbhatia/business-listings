import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { redirectIfMoved, absorbedInto } from "@/lib/listing/redirect";
import { Breadcrumb, Card, PublicShell } from "@/components/structure";
import { MapCanvas, StatusBadge } from "@/components/display";
import { getBusinessBySlug } from "@/lib/db/queries";
import { formatShifts, maskPhone } from "@/lib/format";
import { t } from "@/lib/i18n";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { StorefrontHeader, storefrontCrumbs } from "../_storefront";

export const revalidate = 300;

interface Params {
  params: Promise<{ slug: string }>;
}

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

interface Shift {
  open: string;
  close: string;
}

/** Hours are JSON on the row; this is the only place that reads their shape. */
function shiftsFor(hours: unknown, day: string): Shift[] {
  if (!hours || typeof hours !== "object") return [];
  const value = (hours as Record<string, unknown>)[day];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (s): s is Shift =>
      typeof s === "object" && s !== null && "open" in s && "close" in s,
  );
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) return {};
  return {
    title: `${t("storefront.branches")} — ${business.displayName}`,
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
  if (!business || business.claimStatus === "unclaimed") notFound();

  /*
   * A location with no coordinates is excluded from the map entirely. It is not
   * approximated to the centroid of its area — a wrong pin is worse than no
   * pin — and the count of excluded branches is surfaced rather than swallowed,
   * so a buyer knows the map is not the whole list and a seller has a reason to
   * fix it.
   */
  const pinned = business.locations.filter((l) => l.lat != null && l.lng != null);
  const excluded = business.locations.length - pinned.length;

  return (
    <PublicShell
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
        <StorefrontHeader business={business} active="branches" />

        <div className="mt-5 grid gap-[var(--gutter)] lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-3">
            {business.locations.map((location) => {
              const unpinned = location.lat == null || location.lng == null;
              return (
                <Card key={location.id}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h2 className="text-h3 text-brand-ink">
                      {t(`location.${location.type}` as never)}
                    </h2>
                    {unpinned && (
                      <StatusBadge tone="warn" size="sm">
                        {t("storefront.unpinned")}
                      </StatusBadge>
                    )}
                  </div>

                  <p className="mt-1 text-body-sm text-body">{location.addressLine}</p>
                  <p className="text-caption text-muted">
                    {location.area.name} · {t(`emirate.${location.emirate}` as never)}
                  </p>

                  {location.phone && (
                    <p className="mt-2 font-mono text-body-sm text-ink">
                      {/*
                        An unverified number is hidden from buyers entirely; a
                        verified one is masked until the reveal, which is inert
                        this handoff.
                      */}
                      {location.phoneVerified ? maskPhone(location.phone) : t("table.not_provided")}
                    </p>
                  )}

                  {location.serviceRadiusKm && (
                    <p className="mt-1 text-caption text-muted">
                      {t("storefront.service_radius", { km: location.serviceRadiusKm })}
                    </p>
                  )}

                  <div className="mt-3 border-t border-line pt-2">
                    <p className="font-mono text-eyebrow uppercase text-faint">
                      {t("storefront.hours")}
                    </p>
                    <dl className="mt-1">
                      {DAYS.map((day) => {
                        const shifts = shiftsFor(location.hours, day);
                        return (
                          <div key={day} className="flex justify-between gap-3 py-0.5">
                            <dt className="text-caption text-muted">
                              {t(`storefront.day.${day}` as never)}
                            </dt>
                            <dd
                              className={
                                shifts.length === 0
                                  ? "text-caption text-faint"
                                  : "font-mono text-caption tabular-nums text-body"
                              }
                            >
                              {shifts.length === 0 ? t("storefront.closed") : formatShifts(shifts)}
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                  </div>
                </Card>
              );
            })}
          </div>

          <div className="min-w-0">
            <MapCanvas
              label={t("display.map_label")}
              height={520}
              excluded={excluded}
              excludedLabel={t("display.map_excluded", { count: excluded })}
              emptyLabel={t("display.map_empty")}
              pins={pinned.map((location) => ({
                id: location.id,
                lat: location.lat!,
                lng: location.lng!,
                label: `${business.displayName} — ${t(`location.${location.type}` as never)}, ${location.area.name}`,
                kind:
                  location.type === "head_office"
                    ? "head_office"
                    : business.verificationTier >= 2
                      ? "verified"
                      : "unverified",
              }))}
            />
          </div>
        </div>
      </div>
    </PublicShell>
  );
}
