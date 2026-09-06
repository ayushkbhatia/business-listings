import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { getProductForEditor } from "@/lib/db/queries/catalogue";
import { getSellerTemplate } from "@/lib/catalogue/template";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../../_shell";
import { saveProduct } from "../actions";
import { ProductForm, type EditorField } from "./ProductForm";

/**
 * Board 3g — one product.
 *
 * The fields come from the seller's own clone of the category template where
 * they have one, and from the platform template otherwise. Either way the key
 * is the platform SpecField id, so a seller who has renamed "Body material" to
 * "Material of construction" sees their own wording over the same storage.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const seat = await requireSellerSeat();
  const product = await getProductForEditor(seat.businessId, id);
  return { title: product?.name ?? t("product.not_found") };
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const seat = await requireSellerSeat();

  const [product, badges] = await Promise.all([
    getProductForEditor(seat.businessId, id),
    getNavBadges(seat.businessId),
  ]);
  if (!product) notFound();

  const platformTemplateId = product.category.defaultTemplate?.id;
  const clone = platformTemplateId
    ? await prisma.sellerTemplate.findFirst({
        where: { businessId: seat.businessId, platformTemplateId },
        select: { id: true },
      })
    : null;

  const view = clone ? await getSellerTemplate(seat.businessId, clone.id) : null;
  const values = (product.specValues ?? {}) as Record<string, unknown>;

  const fields: EditorField[] = view
    ? view.fields
        /*
           Every field, not the un-hidden ones.

           The filter that was here is why hiding a field destroyed data: a
           field with no input on screen posted nothing, and `saveProduct`
           rebuilt `specValues` from what was posted. Hiding is gone — see
           lib/catalogue/template.ts — and the editor shows the whole template,
           which is also what "unfilled data stays visible" asks for.
        */
        .map((field) => ({
          id: field.platformFieldId,
          label: field.label,
          unit: field.unit,
          type: field.type,
          options: field.options,
          isFilterable: field.isFilterable,
          value: String(values[field.platformFieldId] ?? ""),
        }))
    : (
        await prisma.specField.findMany({
          where: { templateId: platformTemplateId ?? "" },
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            label: true,
            unit: true,
            type: true,
            options: true,
            isFilterable: true,
          },
        })
      ).map((field) => ({
        id: field.id,
        label: field.label,
        unit: field.unit,
        type: field.type,
        options: field.options,
        isFilterable: field.isFilterable,
        value: String(values[field.id] ?? ""),
      }));

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/products"
      eyebrow={t("product.eyebrow")}
      title={product.name}
      breadcrumb={
        <Link
          href="/dashboard/products"
          className="rounded-tag text-caption text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("product.back")}
        </Link>
      }
    >
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
        action={saveProduct}
      />
    </SellerPage>
  );
}
