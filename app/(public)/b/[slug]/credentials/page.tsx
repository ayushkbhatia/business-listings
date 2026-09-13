import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { Breadcrumb, PublicShell } from "@/components/structure";
import { CredentialTable } from "@/components/domain/CredentialTable";
import { getBusinessBySlug } from "@/lib/db/queries";
import { absorbedInto, redirectIfMoved } from "@/lib/listing/redirect";
import { navPages } from "@/lib/storefront/pages";
import { storefrontCredentials } from "@/lib/storefront/services";
import { storefrontTabs } from "@/lib/storefront/tabs";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { StorefrontHeader, storefrontCrumbs } from "../_storefront";

/**
 * Board `1d-s` — the credentials tab, *all six* behind *see all credentials*.
 *
 * Q3: credentials are a section on the overview **and** a tab, and that is the
 * right weighting for a page whose main job is *can you prove you are allowed
 * to do this*. The rows are the overview's and `1g-s`'s component, so the three
 * places a buyer reads them cannot disagree.
 *
 * The trade licence is not in this table and is not counted by the tab. It is
 * the one fact the platform checked, it lives on `Business`, and it is the
 * badge in the header above — a row here would be a second rendering of the
 * only verified fact on the listing (`8b-s`'s decision).
 *
 * 404 where the tab does not exist, by the same rule the header hides it with:
 * a goods seller, a firm with none, an unclaimed record.
 */
export const revalidate = 300;

interface Params {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) return {};
  return {
    title: t("storefront_services.credentials_page_title", { name: business.displayName }),
    description: t("storefront_services.credentials_page_description", {
      name: business.displayName,
    }),
    alternates: { canonical: `/b/${business.slug}/credentials` },
  };
}

export default async function StorefrontCredentialsPage({ params }: Params) {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) {
    await redirectIfMoved(`/b/${slug}/credentials`);
    notFound();
  }
  const movedTo = await absorbedInto(slug);
  if (movedTo) permanentRedirect(`/b/${movedTo}/credentials`);
  if (business.claimStatus === "unclaimed") notFound();

  const visible = storefrontTabs(business.sellsKind, {
    products: business._count.products,
    services: business._count.services,
    credentials: business._count.credentials,
    locations: business.locations.length,
    reviews: business._count.reviews,
  });
  if (!visible.includes("credentials")) notFound();

  const [credentials, pages] = await Promise.all([
    storefrontCredentials(business.id),
    business.sectorId ? navPages(business.sectorId) : Promise.resolve([]),
  ]);
  const verified = credentials.filter((row) => row.verified).length;

  return (
    <PublicShell
      bleed
      nav={<DirectoryNav />}
      breadcrumb={
        <Breadcrumb
          label={t("gallery.breadcrumb_label")}
          items={storefrontCrumbs(business, t("storefront_services.credentials_tab"))}
        />
      }
      footer={<DirectoryFooter />}
    >
      <div data-theme={business.themePreset ?? "default"}>
        <StorefrontHeader
          business={business}
          active="credentials"
          pages={pages}
          subline={t("storefront_services.credentials_subline", {
            count: credentials.length,
            formatted: formatCount(credentials.length),
            verified: formatCount(verified),
          })}
        />

        <div className="mx-auto w-full max-w-7xl px-5 py-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-h2 text-brand-ink">{t("storefront_services.credentials_tab")}</h2>
            <p className="text-body-sm text-muted">{t("storefront_services.credentials_hint")}</p>
          </div>

          <div className="mt-4">
            <CredentialTable
              rows={credentials}
              name={business.displayName}
              caption={t("storefront_services.credentials_caption", { name: business.displayName })}
            />
          </div>

          {/*
             B4, said to the buyer rather than only enforced. A date that has
             passed is printed as it is, and this is why nothing else changed.
          */}
          <p className="mt-4 max-w-[var(--measure-prose)] text-caption text-muted">
            {t("storefront_services.credentials_note")}
          </p>
        </div>
      </div>
    </PublicShell>
  );
}
