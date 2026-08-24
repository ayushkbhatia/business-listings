import { getSpecFieldOptions } from "@/lib/db/queries/catalogue";
import { prisma } from "@/lib/db/client";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../../_shell";
import { previewImportFile, runImport, undoImport } from "../actions";
import { ImportWizard } from "./ImportWizard";

/**
 * Board 11d — the CSV import mapper.
 *
 * The category is the business's primary one. A seller importing into a second
 * category picks it on the catalogue screen first; offering a category chooser
 * here would make the spec fields change under a mapping already in progress.
 */
export const metadata = { title: "Import a spreadsheet" };
export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const seat = await requireSellerSeat();
  const [business, badges] = await Promise.all([
    prisma.business.findUniqueOrThrow({
      where: { id: seat.businessId },
      select: { primaryCategoryId: true },
    }),
    getNavBadges(seat.businessId),
  ]);

  const specFields = await getSpecFieldOptions(business.primaryCategoryId);

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/products"
      eyebrow={t("import.eyebrow")}
      title={t("import.title")}
    >
      <ImportWizard
        categoryId={business.primaryCategoryId}
        specFields={specFields.map((f) => ({
          id: f.id,
          label: f.label,
          isFilterable: f.isFilterable,
        }))}
        previewAction={previewImportFile}
        runAction={runImport}
        undoAction={undoImport}
      />
    </SellerPage>
  );
}
