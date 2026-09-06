import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge, Tag, type StatusTone } from "@/components/display";
import { PageEvent } from "@/components/telemetry";
import { getProductForEditor } from "@/lib/db/queries/catalogue";
import { resolveEditorTemplate } from "@/lib/products/editor-template";
import { buyerPreviewFor } from "@/lib/products/buyer-preview";
import { isFilled } from "@/lib/catalogue/overlay";
import { isMultiselect } from "@/lib/products/spec-values";
import { can } from "@/lib/auth/can";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../../_shell";
import { saveProduct } from "../actions";
import { ProductForm } from "./ProductForm";
import type { EditorField } from "./fields";

/**
 * Board 3g — one product.
 *
 * The fields come from `resolveEditorTemplate`: the seller's own clone of the
 * category template where they have one, the platform template where they do
 * not, and in both cases the key is the id `Product.specValues` stores the
 * value under. A seller who has renamed "Body material" to "Material of
 * construction" sees their own wording over the same storage.
 *
 * The preview rail resolves separately, through `buyerPreviewFor`, because the
 * buyer's page does — highest-versioned `live` template rather than
 * `Category.defaultTemplateId`. The two coincide today, which is exactly why
 * the rail must not borrow the editor's answer.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const seat = await requireSellerSeat();
  // Cached per request, so this pass and the body below share one query.
  const product = await getProductForEditor(seat.businessId, id);
  return { title: product?.name ?? t("product.not_found") };
}

const STATUS_TONE: Record<string, StatusTone> = {
  live: "ok",
  draft: "neutral",
  out_of_stock: "warn",
};

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const seat = await requireSellerSeat();

  /*
     Gated here, not only at the write.

     There was no capability check on this route at all, so a `seller_sales`
     seat opened the editor, saw every input, filled them in and discovered on
     submit that `assertCanEditProduct` throws — an error boundary rather than a
     message. Board 3h added the same gate to the template screen.
  */
  if (!can(seat.actor, "product.edit")) notFound();

  const [product, badges] = await Promise.all([
    getProductForEditor(seat.businessId, id),
    getNavBadges(seat.businessId),
  ]);
  if (!product) notFound();

  const values = (product.specValues ?? {}) as Record<string, unknown>;

  const [template, preview] = await Promise.all([
    resolveEditorTemplate(seat.businessId, product.categoryId),
    buyerPreviewFor(seat.businessId, product.categoryId, product.specValues),
  ]);

  const fields: EditorField[] = (template?.fields ?? []).map((field) => ({
    fieldId: field.fieldId,
    label: field.label,
    platformLabel: field.platformLabel,
    unit: field.unit,
    type: field.type,
    options: field.options,
    facet: field.facet,
    own: field.own,
    detached: field.detached,
    requiredNow: field.requiredNow,
    // Flattened for the wire. A multiselect crosses `|`-joined and is split
    // back on both sides by the same pair of functions.
    value: flatten(values[field.fieldId], field.type),
  }));

  /*
     Fields the seller invented, which have no row on the buyer's page.

     Counted from the flag that means it — `own` — rather than by subtracting
     the preview's field count from the grid's. The two sets are resolved by
     different queries on purpose, so a difference between them could be an own
     field or could be the two resolvers disagreeing, and a sentence that named
     the first while measuring the second would be wrong exactly when it
     mattered. The integration test asserts the rest of the sets match.
  */
  const ownFieldCount = fields.filter((field) => field.own).length;
  const gaps = fields.filter((field) => !isFilled(values[field.fieldId])).length;

  /*
     Board 3h, where the fields and the required set are defined.

     The clone's own route where there is one, the index otherwise — which is
     where a seller with no clone is offered one. Never a write from here.
  */
  const templateHref = template?.cloneSlug
    ? `/dashboard/templates/${template.cloneSlug}`
    : "/dashboard/templates";

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/products"
      eyebrow={t("product.eyebrow")}
      title={product.name}
      meta={
        <span className="flex flex-wrap items-center gap-2">
          {/*
            The publish state, beside the name.

            It is here because of what the card below can say: a product missing
            a required field cannot be saved and has not been taken down, and
            the seller needs to see both facts at once or the blocked save reads
            as a delisting. The words are 3f's, so one product does not have two
            names for its state across two screens.
          */}
          <StatusBadge tone={STATUS_TONE[product.status] ?? "neutral"} size="sm">
            {t(`catalogue.status.${product.status}` as "catalogue.status.live")}
          </StatusBadge>
          {template && (
            <span className="flex flex-wrap items-center gap-1.5">
              <Tag mono size="sm">
                {t("product.template_eyebrow")}
              </Tag>
              <span className="text-caption text-muted">{template.templateName}</span>
              <span className="font-mono text-eyebrow uppercase tabular-nums text-faint">
                {template.source === "clone" && template.revision !== null
                  ? t("product.template_revision", {
                      revision: String(template.revision),
                      version: String(template.tracksVersion ?? 1),
                    })
                  : t("product.template_platform")}
              </span>
              <span className="font-mono text-eyebrow uppercase tabular-nums text-muted">
                {/* Every count here is a projection of the resolved template. */}
                {t("product.template_counts", {
                  fields: String(fields.length),
                  filterable: String(fields.filter((f) => f.facet === "platform").length),
                })}
              </span>
            </span>
          )}
        </span>
      }
      actions={
        /*
           Absent on a draft rather than disabled.

           `PUBLIC_PRODUCT` is `{ status: { not: "draft" } }`, so a draft's
           public URL permanently redirects to the storefront. A Preview link
           that silently bounces the seller somewhere else is worse than no
           link, and 56 of the 64 seeded products are in exactly that state.
        */
        product.status !== "draft" ? (
          <Link
            href={`/b/${product.business.slug}/p/${product.slug}`}
            className="rounded-tag text-body-sm text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          >
            {t("product.preview_action")}
          </Link>
        ) : undefined
      }
      breadcrumb={
        <Link
          href="/dashboard/products"
          className="rounded-tag text-caption text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("product.back")}
        </Link>
      }
    >
      <PageEvent name="product_editor_viewed" props={{ fields: fields.length, gaps }} />
      <ProductForm
        id={product.id}
        name={product.name}
        sku={product.sku}
        description={product.description}
        availability={product.availability}
        status={product.status}
        stockQty={product.stockQty}
        leadTimeDays={product.leadTimeDays}
        minOrderQty={product.minOrderQty}
        fields={fields}
        previewFields={preview.fields}
        ownFieldCount={ownFieldCount}
        templateHref={templateHref}
        action={saveProduct}
      />
    </SellerPage>
  );
}

/**
 * A stored value, as the form carries it.
 *
 * A multiselect is an array in the column and a `|`-joined string on the wire,
 * because an option may contain a comma — "Grooved, AWWA C606" — and the CSV
 * importer already writes comma-joined strings into the same column. One
 * separator cannot mean both "inside an option" and "between two".
 */
function flatten(value: unknown, type: string): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.filter((part) => typeof part === "string").join("|");
  const text = String(value);
  // A single imported string for a multiselect arrives comma-joined.
  return isMultiselect(type) && text.includes(",")
    ? text
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part !== "")
        .join("|")
    : text;
}
