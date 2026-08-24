import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumb, Card, Panel, PublicShell } from "@/components/structure";
import { ImagePlaceholder, StatusBadge, type StatusTone } from "@/components/display";
import { CompletenessMeter, SpecTable, VerificationBadge, tierSpec } from "@/components/domain";
import { getProductBySlug, getSpecTemplate } from "@/lib/db/queries";
import { formatCount, formatDate, formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import { countFilled, primarySize, toSpecRows } from "@/lib/spec";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { JsonLd } from "@/app/(public)/_json-ld";
import { EnquireButton } from "../../EnquireDrawer";
import { EMIRATES } from "@/lib/uae";
import { getActor } from "@/lib/auth/session";

/** Rebuilt on demand, then cached for five minutes. A catalogue is not a feed. */
export const revalidate = 300;

interface Params {
  params: Promise<{ slug: string; product: string }>;
}

const AVAILABILITY_TONE: Record<string, StatusTone> = {
  in_stock: "ok",
  made_to_order: "info",
  indent: "warn",
  out_of_stock: "neutral",
};

const AVAILABILITY_KEY = {
  in_stock: "availability.in_stock",
  made_to_order: "availability.made_to_order",
  indent: "availability.indent",
  out_of_stock: "availability.out_of_stock",
} as const;

/** schema.org availability. No price, on any of them. */
const SCHEMA_AVAILABILITY: Record<string, string> = {
  in_stock: "https://schema.org/InStock",
  made_to_order: "https://schema.org/MadeToOrder",
  indent: "https://schema.org/BackOrder",
  out_of_stock: "https://schema.org/OutOfStock",
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, product: productSlug } = await params;
  const product = await getProductBySlug(slug, productSlug);
  if (!product) return {};

  const title = `${product.name} — ${product.business.displayName}`;
  const description = t("seo.product_description", {
    product: product.name,
    supplier: product.business.displayName,
    area: product.business.locations[0]?.area.name ?? product.business.primaryCategory.name,
  });

  return {
    title,
    description,
    alternates: { canonical: `/b/${slug}/p/${productSlug}` },
    openGraph: { title, description, type: "website", url: `/b/${slug}/p/${productSlug}` },
  };
}

export default async function ProductPage({ params }: Params) {
  const { slug, product: productSlug } = await params;
  const product = await getProductBySlug(slug, productSlug);
  if (!product) notFound();

  const business = product.business;
  const template = await getSpecTemplate(product.categoryId);
  const fields = template?.fields ?? [];
  const rows = toSpecRows(fields, product.specValues);
  const sizeLabel = primarySize(fields, product.specValues);
  // Only to decide whether the composer asks for a phone number.
  const actor = await getActor();
  const filled = countFilled(fields, product.specValues);
  const spec = tierSpec(business.verificationTier);
  const outOfStock = product.availability === "out_of_stock";

  const crumbs = [
    { label: t("chrome.directory"), href: "/" },
    { label: business.primaryCategory.name, href: `/c/${business.primaryCategory.slug}` },
    { label: business.displayName, href: `/b/${business.slug}` },
    { label: product.name },
  ];

  return (
    <PublicShell
      nav={<DirectoryNav />}
      breadcrumb={<Breadcrumb label={t("gallery.breadcrumb_label")} items={crumbs} />}
      footer={<DirectoryFooter />}
    >
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Product",
          name: product.name,
          sku: product.sku ?? undefined,
          description: product.description ?? undefined,
          category: product.category.name,
          brand: { "@type": "Organization", name: business.displayName },
          offers: {
            "@type": "Offer",
            // No price and no priceCurrency, deliberately. Product has no price
            // column and no public surface renders one; a schema.org offer
            // without a price is the honest description of an enquiry-led
            // catalogue, and inventing one for the rich result would be a lie
            // Google would eventually punish anyway.
            availability: SCHEMA_AVAILABILITY[product.availability],
            seller: { "@type": "Organization", name: business.displayName },
            url: `/b/${business.slug}/p/${product.slug}`,
          },
        }}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: crumbs.map((crumb, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: crumb.label,
            item: crumb.href,
          })),
        }}
      />

      <div className="grid gap-[var(--gutter)] lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <header>
            <p className="font-mono text-eyebrow uppercase text-faint">
              {product.category.name}
              {product.sku && <> · {product.sku}</>}
            </p>
            <h1 className="mt-1 font-serif text-h1-serif text-ink">{product.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge dot tone={AVAILABILITY_TONE[product.availability] ?? "neutral"}>
                {t(AVAILABILITY_KEY[product.availability])}
              </StatusBadge>
              {product.availability === "in_stock" && product.stockQty != null && (
                <span className="font-mono text-eyebrow tabular-nums text-muted">
                  {t("product.in_stock_qty", { qty: formatCount(product.stockQty) })}
                </span>
              )}
              {product.leadTimeDays != null && (
                <span className="font-mono text-eyebrow tabular-nums text-muted">
                  {t("product.lead_time", { days: product.leadTimeDays })}
                </span>
              )}
              {product.minOrderQty != null && (
                <span className="font-mono text-eyebrow tabular-nums text-muted">
                  {t("product.min_order", { qty: formatCount(product.minOrderQty) })}
                </span>
              )}
            </div>
          </header>

          <div className="mt-5 max-w-md">
            <ImagePlaceholder kind="empty" label={t("display.no_image")} />
          </div>

          {product.description && (
            <p className="mt-5 max-w-[var(--measure-prose)] text-prose text-prose">
              {product.description}
            </p>
          )}

          <div className="mt-6">
            <h2 className="mb-2 text-h2 text-ink">{t("product.spec")}</h2>
            {rows.length > 0 ? (
              <>
                <SpecTable
                  caption={t("seo.spec_caption", { product: product.name })}
                  rows={rows}
                  notProvidedLabel={t("table.not_provided")}
                  filterableLabel={t("product.spec_filterable")}
                />
                <div className="mt-3 max-w-xs">
                  <CompletenessMeter
                    label={t("display.spec_completeness")}
                    filled={filled}
                    total={fields.length}
                    valueLabel={t("display.fields_filled", { filled, total: fields.length })}
                  />
                </div>
              </>
            ) : (
              <p className="text-body-sm text-muted">{t("product.no_template")}</p>
            )}
          </div>
        </div>

        <aside className="min-w-0">
          <Card>
            <p className="text-caption text-muted">{t("product.supplied_by")}</p>
            <h2 className="mt-0.5 text-h3 text-ink">
              <a
                href={`/b/${business.slug}`}
                className="rounded-tag underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
              >
                {business.displayName}
              </a>
            </h2>
            <p className="mt-0.5 text-caption text-muted">
              {business.locations[0]?.area.name} · {t(`emirate.${business.locations[0]?.emirate}` as never)}
            </p>

            <div className="mt-3">
              <VerificationBadge
                tier={business.verificationTier}
                label={t(spec.labelKey as never)}
                checked={t(spec.checkedKey as never)}
                date={
                  spec.dateField === "none"
                    ? undefined
                    : spec.dateField === "visitedAt"
                      ? business.visitedAt
                        ? formatDate(business.visitedAt)
                        : undefined
                      : business.verifiedAt
                        ? formatDate(business.verifiedAt)
                        : undefined
                }
                tierLabel={t("verify.tier", { tier: business.verificationTier })}
              />
            </div>

            <div className="mt-4 border-t border-line pt-3">
              {/*
                Where a price would sit. Product has no price column, so this
                line is the answer rather than a gap the eye reads as missing.
              */}
              <p className="text-caption text-muted">{t("product.no_price")}</p>
              {/*
                Live from handoff 2 step 3, and it carries this product in as a
                line — a buyer standing on a product page is not writing a
                requirement from scratch, they are pointing at one thing.
              */}
              <div className="mt-2">
                <EnquireButton
                  block
                  businessId={business.id}
                  businessSlug={business.slug}
                  displayName={business.displayName}
                  categoryId={business.primaryCategoryId}
                  emirates={EMIRATES}
                  signedIn={Boolean(actor)}
                  triggerLabel={outOfStock ? t("product.notify") : t("product.enquire")}
                  initialRequirementSeed={product.name}
                  initialLines={[
                    {
                      key: product.id,
                      description: product.name,
                      qty: product.minOrderQty ?? 1,
                      unit: "pcs",
                      size: sizeLabel ?? "",
                      targetUnitPriceAed: "",
                    },
                  ]}
                  recipient={{
                    businessId: business.id,
                    displayName: business.displayName,
                    areaName: null,
                    verificationTier: business.verificationTier,
                    responseLabel:
                      business.responseTimeMedianMs === null
                        ? t("response.unmeasured")
                        : t("response.median", {
                            duration: formatDuration(business.responseTimeMedianMs),
                          }),
                    pinned: true,
                  }}
                />
              </div>
              <p className="mt-2 text-caption text-faint">{t("storefront.enquiry_note")}</p>
            </div>
          </Card>

          {product.documents.length > 0 && (
            <div className="mt-3">
              <Panel title={t("product.datasheet")}>
                <ul className="flex flex-col gap-1">
                  {product.documents.map((doc) => (
                    <li key={doc.id} className="text-body-sm text-body">
                      {doc.filename}
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>
          )}
        </aside>
      </div>
    </PublicShell>
  );
}
