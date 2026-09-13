import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumb, Card, PublicShell } from "@/components/structure";
import { Tag } from "@/components/display";
import { scopeWords } from "@/components/domain";
import { ENQUIRE_LINK } from "@/components/domain/ServicesStorefront";
import { getBusinessBySlug } from "@/lib/db/queries";
import { publicServicesFor } from "@/lib/services/service";
import { navPages } from "@/lib/storefront/pages";
import { formatCount, formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getActor } from "@/lib/auth/session";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { StorefrontHeader, storefrontCrumbs } from "../_storefront";
import { composerOptions } from "../_services";
import { ServiceEnquireDrawer } from "../ServiceEnquireDrawer";

/**
 * The link surface for board `1g-s`, and deliberately not board `1e-s`.
 *
 * `1e-s` is the public services catalogue — grouped by family, filtered,
 * ordered, with the empty states and the composition rules that go with a
 * catalogue — and it is a later board. What this is, is the tab that makes a
 * service page reachable: a detail page linked from nowhere is a route rather
 * than a screen, and shipping `1g-s` without one would leave three screens of
 * work behind a URL only its author could type.
 *
 * It renders the seller's own order, from `Service.position`, which is `3f-s`
 * B5's whole point — sellers lead with their best work. `1e-s` inherits that
 * and replaces the rest of this file.
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
    title: t("services_index.title", { name: business.displayName }),
    alternates: { canonical: `/b/${business.slug}/services` },
  };
}

export default async function StorefrontServicesPage({ params }: Params) {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) notFound();

  const [services, pages, actor] = await Promise.all([
    publicServicesFor(business.id),
    /*
       By sector, not by business id. `navPages` takes a sector and this passed
       the business's own id, so the tab row here never carried the template
       pages every other storefront tab carries — the shared header rendering
       differently on one tab.
    */
    business.sectorId ? navPages(business.sectorId) : Promise.resolve([]),
    getActor(),
  ]);
  const options = composerOptions(services);

  return (
    <PublicShell
      nav={<DirectoryNav />}
      breadcrumb={
        <Breadcrumb
          label={t("gallery.breadcrumb_label")}
          items={storefrontCrumbs(business, t("storefront.services"))}
        />
      }
      footer={<DirectoryFooter />}
    >
      <div data-theme={business.themePreset ?? "default"}>
        <StorefrontHeader
          business={business}
          active="services"
          pages={pages}
          subline={t("services_index.intro")}
        />

        <div className="mx-auto w-full max-w-[75rem] px-[var(--section-pad)] py-8">
          {services.length === 0 ? (
            <p className="text-body-sm text-muted">{t("services_index.empty")}</p>
          ) : (
            <ul className="grid list-none gap-4 p-0 md:grid-cols-2 lg:grid-cols-3">
              {services.map((service) => (
                <li key={service.id}>
                  <Card>
                    <h2 className="text-body font-medium text-ink">
                      <Link
                        href={`/b/${business.slug}/s/${service.slug}`}
                        className="rounded-tag underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                      >
                        {service.name}
                      </Link>
                    </h2>

                    {service.chips.length > 0 && (
                      <ul className="mt-2 flex list-none flex-wrap gap-1.5 p-0">
                        {service.chips.map((chip) => (
                          <li key={chip.key}>
                            <Tag>{scopeWords(chip.key, chip.value)}</Tag>
                          </li>
                        ))}
                      </ul>
                    )}

                    {/*
                       The same count the firm is shown on `3f-s`, said to the
                       buyer as what is answered rather than as a score. A page
                       with three unanswered rows is a page worth enquiring
                       about, and saying so is what makes the enquiry specific.
                    */}
                    <p className="mt-2 text-caption text-faint">
                      {t("service_public.rows_filled", {
                        filled: formatCount(service.filled),
                        total: formatCount(service.total),
                      })}
                    </p>

                    {/*
                       Board `1d-s` B11 — "Enquire" from the services tab opens
                       the composer on this service: the storefront's own for a
                       firm that sells only work, a drawer for one that sells
                       both, whose storefront rail is the goods composer.
                    */}
                    <div className="mt-3 border-t border-line pt-3 text-end">
                      {business.sellsKind === "both" ? (
                        <ServiceEnquireDrawer
                          businessId={business.id}
                          businessName={business.displayName}
                          services={options}
                          service={service.slug}
                          serviceName={service.name}
                          askForContact={!actor}
                          responseLine={
                            business.responseTimeMedianMs === null
                              ? t("storefront_services.composer.reply_unmeasured")
                              : t("storefront_services.composer.reply_measured", {
                                  duration: formatDuration(business.responseTimeMedianMs),
                                })
                          }
                        />
                      ) : (
                        <Link
                          href={`/b/${business.slug}?service=${encodeURIComponent(service.slug)}#enquire`}
                          className={ENQUIRE_LINK}
                          aria-label={t("storefront_services.enquire_named", { name: service.name })}
                        >
                          {t("listing.enquire")}
                        </Link>
                      )}
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </PublicShell>
  );
}
