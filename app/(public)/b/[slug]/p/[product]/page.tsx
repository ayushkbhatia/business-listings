import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { Breadcrumb, Panel, PublicShell } from "@/components/structure";
import { ImagePlaceholder, LogoTile, StatusBadge, type StatusTone } from "@/components/display";
import { ResponseTime, SpecTable, VerificationBadge, tierSpec } from "@/components/domain";
import { getBusinessBySlug, getProductBySlug } from "@/lib/db/queries";
import {
  countOtherSellers,
  getComparison,
  getQuestions,
} from "@/lib/db/queries/product-detail";
import { freshStock } from "@/lib/db/queries/storefront-catalogue";
import { availabilityBands, deliversLocally } from "@/lib/trade/availability-bands";
import { formatBytes, formatCount, formatDate, formatDuration } from "@/lib/format";
import { MEDIA_BUCKET, publicUrl } from "@/lib/storage";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { buyerPreviewFor } from "@/lib/products/buyer-preview";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { JsonLd } from "@/app/(public)/_json-ld";
import { EMIRATES } from "@/lib/uae";
import { getActor } from "@/lib/auth/session";
import { EnquiryCard, SpecRequestButton } from "./_enquiry-card";
import { ProductEnquiryProvider } from "./_enquiry-context";

/**
 * Board 1g — product detail & spec table.
 *
 * The page a buyer lands on from a search for a part number, answering one
 * question — is this the right thing — and making asking about it one action.
 *
 * It is also where the no-price model is tested hardest. This is the single
 * place on the site where a buyer looks at a quantity and expects a number
 * beside it, so it is where a price leaks first. The quantity table answers
 * "how fast can I have this many" instead, and "better rate" and "contract
 * pricing" say volume moves the number without stating one.
 *
 * ## What is cached for how long
 *
 * The route sits at 300s, matching the rest of the catalogue. The board asks
 * for 60s on the availability bands alone, and they are derived from
 * `Product.availability` and the seller's coverage — neither of which moves on
 * a minute's timescale. The one figure that goes stale dangerously is the stock
 * count, and that is handled by age rather than by cache: a number older than
 * thirty days renders as a band with no figure at all, which is `1e`'s rule and
 * is correct however long the page has been cached.
 */
export const revalidate = 300;

interface Params {
  params: Promise<{ slug: string; product: string }>;
}

const AVAILABILITY_TONE: Record<string, StatusTone> = {
  in_stock: "ok",
  made_to_order: "info",
  indent: "warn",
  out_of_stock: "bad",
};

const AVAILABILITY_KEY = {
  in_stock: "availability.in_stock",
  made_to_order: "availability.made_to_order",
  indent: "availability.indent",
  out_of_stock: "availability.out_of_stock",
} as const;

/** schema.org availability. No price on any of them, deliberately. */
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

  if (!product) {
    /*
       Criterion 9, as far as it can honestly be built.

       The board's premise is that a Free-plan seller has no catalogue, so their
       product pages should go. This platform's `Free` plan carries a
       `productLimit` of 10, and `allowance()` in `lib/plan/entitlements.ts`
       says in as many words that "a plan downgrade can legitimately leave a
       seller over their cap" — so a downgrade deliberately does not unpublish
       what is already there. Implementing the criterion literally would dark
       the product pages of every Free-plan seller on the platform and
       contradict a decision that predates this board.

       What is buildable is the board's own second sentence: never a live page
       for an unpublished product. A product that is now a draft, or was
       deleted, sends the buyer to the storefront rather than dead-ending — they
       came for this supplier's goods and the supplier still exists. A 404 is
       kept for the case where the storefront is gone too, because there is
       nowhere honest to send them.
    */
    const business = await getBusinessBySlug(slug);
    if (business) permanentRedirect(`/b/${slug}`);
    notFound();
  }

  const business = product.business;
  const [preview, actor] = await Promise.all([
    /*
       The spec table, composed by the module board 3g's preview rail also
       calls. Two screens showing one table, so the rail's caption — "spec table
       as buyers see it" — cannot quietly stop being true.

       It resolves the template and this seller's own labels and order. Only the
       label and the order move: the key is untouched, so comparison still
       matches across sellers and the facet rail is unaffected, which is why a
       rename is safe.
    */
    buyerPreviewFor(product.businessId, product.categoryId, product.specValues),
    // Only to decide whether the composer asks for a phone number.
    getActor(),
  ]);
  const { rows, filled, fields, primary: sizeLabel } = preview;
  const filterableIds = fields.filter((f) => f.isFilterable).map((f) => f.id);
  /*
     Whether there is a spec to compare on at all.

     `countOtherSellers` returns zero for a product with no filterable values
     filled, and the card's zero-copy is "the only verified listing for this
     spec" — which would be a claim about a spec that does not exist, on the
     listings least entitled to make one. No spec, no card.
  */
  const specValues = (product.specValues ?? {}) as Record<string, unknown>;
  const comparable = filterableIds.some((id) => {
    const value = specValues[id];
    return value !== undefined && value !== null && value !== "";
  });
  const labelOf = new Map(fields.map((f) => [f.id, f.label]));

  const [comparison, otherSellers, questions] = await Promise.all([
    getComparison(
      {
        id: product.id,
        categoryId: product.categoryId,
        businessId: product.businessId,
        specValues: product.specValues,
        slug: product.slug,
      },
      filterableIds,
      (id) => labelOf.get(id),
    ),
    countOtherSellers(
      { id: product.id, categoryId: product.categoryId, specValues: product.specValues },
      filterableIds,
    ),
    getQuestions(product.id),
  ]);

  const spec = tierSpec(business.verificationTier);
  const head = business.locations[0];
  const outOfStock = product.availability === "out_of_stock";
  const now = new Date();

  /*
     Criterion 10. A stock number older than thirty days is worse than none:
     "In stock" is honest and "240 units" from March is a promise the seller
     never made. Same rule and same helper as board 1e's catalogue.
  */
  const stock = freshStock(product.stockQty, product.stockUpdatedAt, now);

  const bands = availabilityBands(product.availability, {
    deliversLocally: deliversLocally(business.locations),
    leadTimeDays: product.leadTimeDays,
  });

  /*
     Criterion 4: `N OF M`, where M is the number of rows rendered.

     Both numbers come from the same `fields` array the table is built from, so
     they cannot drift. This is not cosmetic — it is the figure
     `CompletenessMeter` reads, the figure the seller sees in 3g, and the
     spec-completeness ranking weight.
  */
  const specMeta = preview.templateName
    ? t("pdp.spec_meta", {
        template: preview.templateName,
        version: preview.templateVersion ?? 1,
        filled,
        total: rows.length,
      })
    : null;

  /** The unfilled template fields, named, for the one-click request. */
  const missing = fields
    .filter((field) => rows.find((row) => row.key === field.id)?.value === null)
    .map((field) => field.label);

  const crumbs = [
    { label: business.primaryCategory.name, href: `/c/${business.primaryCategory.slug}` },
    { label: product.category.name, href: `/c/${product.category.slug}` },
    { label: business.displayName, href: `/b/${business.slug}` },
    // The SKU last: a buyer who arrived by part number sees it confirmed.
    { label: product.sku ?? product.name },
  ];

  const enquire = {
    businessId: business.id,
    businessSlug: business.slug,
    displayName: business.displayName,
    categoryId: business.primaryCategoryId,
    emirates: EMIRATES,
    signedIn: Boolean(actor),
    initialRequirementSeed: product.name,
    recipient: {
      businessId: business.id,
      displayName: business.displayName,
      areaName: head?.area.name ?? null,
      verificationTier: business.verificationTier,
      responseLabel:
        business.responseTimeMedianMs === null
          ? t("response.unmeasured")
          : t("response.median", { duration: formatDuration(business.responseTimeMedianMs) }),
      pinned: true,
    },
  };

  /*
     The join's order is the gallery's order, and its first row is the primary
     image — board 3i acceptance criterion 8. One file can serve several
     products now, so the row is the reference and `.media` is the file.
  */
  const gallery = product.media
    .map((row) => row.media)
    .filter((item) => item.kind === "gallery" || item.kind === "cover" || item.kind === "product");
  const primaryImage = gallery[0];

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
          /*
             Criterion 1's machine half: every filled spec field, so a query for
             "PN16 ductile iron DN100" has something structured to match as well
             as the body text it already matches.
          */
          additionalProperty: rows
            .filter((row) => row.value !== null)
            .map((row) => ({
              "@type": "PropertyValue",
              name: row.label,
              value: row.unit ? `${row.value} ${row.unit}` : row.value,
            })),
          offers: {
            "@type": "Offer",
            /*
               No `price`, no `priceCurrency`, no `PriceSpecification` — omitted
               entirely rather than emitted empty or zero. `Product` has no price
               column and no public surface renders one; an omitted price with a
               stated availability is valid markup, and a zero price is not — it
               would be read as free.
            */
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

      {/*
         One composer for the page, however many things open it. Four triggers
         live in three different sections and every one of them is an enquiry to
         the same seller about the same product — only the seed differs.
      */}
      <ProductEnquiryProvider
        enquire={enquire}
        defaultSeed={product.name}
        line={{
          key: product.id,
          productId: product.id,
          description: product.name,
          unit: "pcs",
          size: sizeLabel ?? "",
          targetUnitPriceAed: "",
        }}
      >

      {/* Media 540px, commercial column takes the rest. */}
      <div className="grid gap-[var(--gutter)] lg:grid-cols-[minmax(0,28.75rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,33.75rem)_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="overflow-hidden rounded-card border border-line bg-card">
            {primaryImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={publicUrl(MEDIA_BUCKET, primaryImage.storagePath)}
                alt={product.name}
                className="h-[26.25rem] w-full object-cover"
              />
            ) : (
              <ImagePlaceholder kind="empty" label={t("display.no_image")} className="h-[26.25rem] w-full" />
            )}
          </div>

          {gallery.length > 1 && (
            /*
               A swipe strip below 768 and a row above it — the same list either
               way, so a phone gets the whole set rather than a truncated one.
            */
            <ul className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {gallery.slice(0, 5).map((item, index) => (
                <li key={item.id} className="shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={publicUrl(MEDIA_BUCKET, item.storagePath)}
                    alt=""
                    className={cn(
                      "h-[4.625rem] w-[5.75rem] rounded-ctl border object-cover",
                      index === 0 ? "border-[1.5px] border-moss" : "border-line",
                    )}
                  />
                </li>
              ))}
              {gallery.length > 5 && (
                <li className="flex h-[4.625rem] w-[5.75rem] shrink-0 items-center justify-center rounded-ctl border border-line bg-paper-sunk font-mono text-caption text-muted">
                  +{gallery.length - 5}
                </li>
              )}
            </ul>
          )}

          {product.documents.length > 0 && (
            <div className="mt-4">
              <Panel title={t("pdp.documents")}>
                {/*
                   Criterion 12: downloadable without an enquiry or a login. A
                   datasheet is how a buyer confirms the spec, and gating it
                   costs more enquiries than it earns. The link goes through the
                   signed-URL route — the bucket stays private and the URL
                   cannot outlive the cached page.
                */}
                <ul className="flex flex-col gap-1.5">
                  {product.documents.map(({ document: doc }) => (
                    <li key={doc.id}>
                      <a
                        href={`/b/${business.slug}/d/${doc.id}`}
                        rel="nofollow"
                        className="rounded-tag text-body-sm text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                      >
                        {doc.displayName ?? t(`document.${doc.kind}` as never)}
                      </a>
                      <span className="ml-2 font-mono text-eyebrow uppercase text-faint">
                        {t("pdp.doc_meta", {
                          kind: (doc.mimeType?.split("/")[1] ?? "file").toUpperCase(),
                          size: doc.bytes ? formatBytes(doc.bytes) : "—",
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>
          )}
        </div>

        {/* ── Commercial column ──────────────────────────────────────────── */}
        <div className="min-w-0">
          {/* Seller strip. Display name, as everywhere — criterion 11. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <LogoTile
              name={business.displayName}
              categoryCode={business.primaryCategory.code}
              size="sm"
              rounded="chip"
            />
            <div className="min-w-0">
              <p className="text-body-sm font-medium text-ink">{business.displayName}</p>
              <p className="flex flex-wrap items-center gap-x-2 text-caption text-body">
                <VerificationBadge
                  tier={business.verificationTier}
                  label={t(spec.labelKey as never)}
                  checked={t(spec.checkedKey as never)}
                  date={
                    spec.dateField === "none" || !business.verifiedAt
                      ? undefined
                      : formatDate(business.verifiedAt)
                  }
                  tierLabel={t("verify.tier", { tier: business.verificationTier })}
                />
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
              </p>
            </div>
            <a
              href={`/b/${business.slug}`}
              className="ml-auto rounded-tag text-body-sm font-medium text-moss underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
            >
              {t("pdp.visit_storefront")}
            </a>
          </div>

          {/*
             The product name, never the SKU, and never truncated — it is the
             string the buyer searched, and cutting it hides the size or the
             rating that made it the right result.
          */}
          <h1 className="mt-3 text-h1 font-medium tracking-tight text-ink">{product.name}</h1>

          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {product.sku && (
              <span className="font-mono text-caption uppercase text-muted">
                SKU {product.sku}
              </span>
            )}
            <StatusBadge dot tone={AVAILABILITY_TONE[product.availability] ?? "neutral"} size="sm">
              {t(AVAILABILITY_KEY[product.availability])}
            </StatusBadge>
            {product.availability === "in_stock" && head && (
              <span className="text-caption text-body">
                {stock === null
                  ? t("pdp.in_stock_at_unknown", { location: head.area.name })
                  : t("pdp.in_stock_at", {
                      qty: formatCount(stock),
                      location: head.area.name,
                    })}
              </span>
            )}
          </p>

          <div className="mt-4">
            <EnquiryCard
              productId={product.id}
              enquirySeed={product.name}
              minOrderQty={product.minOrderQty ?? 1}
              primaryLabel={outOfStock ? t("product.notify") : t("product.enquire")}
              {...(outOfStock
                ? {
                    leadTimeLabel: t("pdp.enquire_lead_time"),
                    leadTimeSeed: t("pdp.request_lead_time_seed", { product: product.name }),
                  }
                : {})}
              {...(head?.whatsapp
                ? {
                    whatsappHref: `https://wa.me/${head.whatsapp.replace(/[^\d]/g, "")}`,
                  }
                : {})}
              whatsappLabel={t("pdp.whatsapp_seller")}
              rfqLabel={t("pdp.add_to_rfq")}
              rfqAddedLabel={t("pdp.added_to_rfq")}
              rfqCrossoverLabel={t("pdp.send_to_several")}
              quantityLabel={t("pdp.qty_label")}
              decrementLabel={t("stepper.decrement")}
              incrementLabel={t("stepper.increment")}
              productName={product.name}
              storefrontSlug={business.slug}
              confidence={
                <>
                  {/*
                     Where a price would sit. Criterion 2: the three-factor
                     sentence turns an apparent omission into a reason, and it
                     is true — in this market volume, delivery point and terms
                     all move the number. The reply time is the measured median
                     and the sentence simply ends early without one; never "log
                     in to see prices", which reads as a paywall.
                  */}
                  <p className="font-serif text-h2-serif text-ink">{t("product.no_price")}</p>
                  <p className="mt-1.5 text-body-sm leading-relaxed text-body">
                    {business.responseTimeMedianMs === null
                      ? t("pdp.price_reason")
                      : t("pdp.price_reason_reply", {
                          duration: formatDuration(business.responseTimeMedianMs),
                        })}
                  </p>
                </>
              }
              bands={
                bands.length > 0 ? (
                  <table className="w-full border-collapse text-body-sm">
                    <caption className="sr-only">{t("pdp.qty_caption")}</caption>
                    <thead>
                      <tr className="border-b border-line">
                        <th scope="col" className="py-1.5 text-left font-mono text-eyebrow uppercase tracking-eyebrow text-faint">
                          {t("pdp.quantity")}
                        </th>
                        <th scope="col" className="py-1.5 text-right font-mono text-eyebrow uppercase tracking-eyebrow text-faint">
                          {product.availability === "in_stock"
                            ? t("pdp.availability_col")
                            : t("pdp.lead_time_col")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {bands.map((band) => (
                        <tr key={band.quantity} className="border-b border-line last:border-0">
                          <th scope="row" className="py-1.5 text-left font-mono text-caption font-normal tabular-nums text-body">
                            {band.quantity}
                          </th>
                          <td className="py-1.5 text-right text-caption text-ink">
                            {band.weeks === undefined
                              ? t(band.labelKey as never)
                              : t(band.labelKey as never, { count: band.weeks })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  /*
                     Out of stock: one sentence rather than four rows about
                     something there is none of. The enquiry path stays — an
                     out-of-stock product is still a live enquiry, and the state
                     exists to keep it rather than to close it.
                  */
                  <p className="text-body-sm text-body">{t("pdp.out_of_stock_note")}</p>
                )
              }
              details={
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-caption">
                  <Detail label={t("pdp.delivery")}>
                    {business.deliveryNote ?? t("table.not_provided")}
                  </Detail>
                  <Detail label={t("pdp.collection")}>
                    {head ? `${head.area.name}, ${t(`emirate.${head.emirate}` as never)}` : t("table.not_provided")}
                  </Detail>
                  <Detail label={t("pdp.payment_terms")}>
                    {business.paymentTerms ?? t("table.not_provided")}
                  </Detail>
                  <Detail label={t("pdp.min_order")}>
                    {product.minOrderQty
                      ? t("pdp.min_order_value", { qty: formatCount(product.minOrderQty) })
                      : t("table.not_provided")}
                  </Detail>
                </dl>
              }
            />
          </div>

          {/* ── Side cards ─────────────────────────────────────────────── */}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {comparable && (
            <SideCard title={t("pdp.other_sellers")}>
              {otherSellers > 0 ? (
                <>
                  <p className="text-body-sm text-ink">
                    {t("pdp.other_sellers_count", { count: otherSellers })}
                  </p>
                  <a
                    href={`/search?q=${encodeURIComponent(product.name)}`}
                    className="mt-1.5 inline-block rounded-tag text-body-sm font-medium text-moss underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                  >
                    {t("pdp.enquire_with_all", { count: otherSellers + 1 })}
                  </a>
                </>
              ) : (
                /* Criterion 7: a genuine selling point, not an empty state. */
                <p className="text-body-sm text-ink">{t("pdp.only_listing")}</p>
              )}
            </SideCard>
            )}

            <SideCard title={t("pdp.ask_seller")}>
              {questions.shown[0] ? (
                <>
                  {/*
                     Verbatim, both halves. A paraphrase would be the platform
                     speaking for a supplier about their own goods, and the
                     value of the card is that another buyer already asked the
                     thing you are about to.
                  */}
                  <p className="text-body-sm text-ink">{questions.shown[0].body}</p>
                  <p className="mt-1 text-caption text-body">{questions.shown[0].answer}</p>
                  <p className="mt-1.5 font-mono text-eyebrow uppercase text-faint">
                    {t("pdp.questions_answered", { count: questions.answered })}
                  </p>
                </>
              ) : (
                <p className="text-body-sm text-body">{t("pdp.no_questions")}</p>
              )}
            </SideCard>
          </div>
        </div>
      </div>

      {/* ── 5 · Specifications ───────────────────────────────────────────── */}
      {rows.length > 0 && (
        <section className="mt-8 rounded-card border border-line bg-card p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="text-h2 text-ink">{t("product.spec")}</h2>
            {specMeta && (
              <p className="font-mono text-eyebrow uppercase tracking-eyebrow text-faint">
                {specMeta}
              </p>
            )}
          </div>

          <div className="mt-3">
            {/*
               Unfilled template rows stay visible, in `--text-faint`, reading
               "Not provided". Three reasons and all three are load-bearing: the
               buyer sees what is unanswered rather than assuming it was
               answered; the one-click request below turns that into a specific,
               high-intent enquiry; and the seller sees the same grey rows in 3g
               and fills them. Hiding them would make an incomplete spec look
               complete.
            */}
            <SpecTable
              caption={t("seo.spec_caption", { product: product.name })}
              rows={rows}
              notProvidedLabel={t("table.not_provided")}
              filterableLabel={t("product.spec_filterable")}
            />
          </div>

          {missing.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <p className="max-w-[var(--measure-prose)] text-caption text-body">
                {t("pdp.spec_footnote")}
              </p>
              {/*
                 Criterion 5. The enquiry names the fields rather than saying
                 "please send full specs" — a seller who reads "confirm the seat
                 material and the face-to-face dimension" can answer in a line,
                 and that is what makes it high-intent rather than a chore.
              */}
              <SpecRequestButton
                label={t("pdp.request_specs")}
                seed={t("pdp.request_specs_seed", {
                  product: product.name,
                  fields: missing.join(", "),
                })}
              />
            </div>
          )}
        </section>
      )}

      {/* ── 6 · Same spec, other sellers ─────────────────────────────────── */}
      {comparison.length > 1 && (
        <section className="mt-8">
          <h2 className="text-h2 text-ink">{t("pdp.comparison_title")}</h2>
          {/*
             A real `<table>` with `scope`d headers, server-rendered.

             Not `DataTable`: that is a client component whose columns are
             render functions, and a function cannot cross the server boundary —
             which is the bug boards 1d and 1e each shipped once. This table
             sorts nothing, selects nothing and has no row menu, so none of that
             machinery earns its place here.

             No price column. The comparison is spec, lead time and
             responsiveness, which is the whole reason the table is possible:
             specs are templated, so the rows line up.
          */}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-body-sm">
              <caption className="sr-only">{t("pdp.comparison_title")}</caption>
              <thead>
                <tr className="border-b border-line-strong">
                  <Th>{t("pdp.col_seller")}</Th>
                  <Th className="hidden md:table-cell">{t("pdp.col_distinguishing")}</Th>
                  <Th>{t("pdp.col_lead")}</Th>
                  <Th>{t("pdp.col_replies")}</Th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((row) => (
                  <tr
                    key={row.productId}
                    className={cn(
                      "border-b border-line last:border-0",
                      row.isCurrent && "bg-paper-sunk",
                    )}
                  >
                    <th scope="row" className="py-2.5 pr-3 text-left font-normal">
                      {/*
                         Display names, every row. Criterion 11 says so and the
                         reason is concrete: each row links to that seller's
                         storefront, so a legal name here would have the buyer
                         read one name and land on another.
                      */}
                      <a
                        href={`/b/${row.businessSlug}`}
                        className="rounded-tag font-medium text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                      >
                        {row.displayName}
                      </a>
                      {row.isCurrent && (
                        <span className="ml-1.5 text-caption text-muted">{t("pdp.this_page")}</span>
                      )}
                    </th>
                    <td className="hidden py-2.5 pr-3 text-caption text-body md:table-cell">
                      {row.distinguishing.join(" · ") || t("table.not_provided")}
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-caption tabular-nums text-body">
                      {row.leadTimeDays === null
                        ? t("pdp.lead_unstated")
                        : t("pdp.lead_days", { days: row.leadTimeDays })}
                    </td>
                    <td className="py-2.5 font-mono text-caption tabular-nums text-body">
                      {row.responseTimeMedianMs === null
                        ? t("response.unmeasured")
                        : formatDuration(row.responseTimeMedianMs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      </ProductEnquiryProvider>

      {/* The sticky bar is fixed; this keeps the last section clear of it. */}
      <div className="h-16 md:hidden" aria-hidden />
    </PublicShell>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="font-mono text-eyebrow uppercase tracking-eyebrow text-faint">{label}</dt>
      <dd className="text-body">{children}</dd>
    </>
  );
}

function SideCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-card p-3.5">
      <p className="font-mono text-eyebrow uppercase tracking-eyebrow text-faint">{title}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cn(
        "py-2 pr-3 text-left font-mono text-eyebrow uppercase tracking-eyebrow text-faint",
        className,
      )}
    >
      {children}
    </th>
  );
}
