import Link from "next/link";
import { Alert } from "@/components/display";
import { buttonClassName } from "@/components/primitives";
import { Card } from "@/components/structure";
import { getCatalogue } from "@/lib/db/queries/catalogue";
import { revertableRuns } from "@/lib/import/service";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../_shell";
import { bulkUpdateProducts, undoImportForm } from "./actions";
import { CatalogueTable } from "./CatalogueTable";

/**
 * Board 3f — the catalogue.
 *
 * Two notices sit above the table, and both are numbers rather than advice.
 * "62 products have no filterable specs" is the sentence board 11e's upsell
 * panel leans on, and a seller who has never seen it on their own catalogue
 * screen has no reason to believe it there.
 */
export const metadata = { title: "Products" };
export const dynamic = "force-dynamic";

export default async function CataloguePage() {
  const seat = await requireSellerSeat();
  const [catalogue, badges, undoable] = await Promise.all([
    getCatalogue(seat.businessId),
    getNavBadges(seat.businessId),
    revertableRuns(seat.businessId),
  ]);

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/products"
      eyebrow={t("catalogue.eyebrow")}
      title={t("catalogue.title")}
      actions={
        <div className="flex flex-wrap gap-2">
          <Link
            href="/dashboard/products/import"
            className={buttonClassName({ variant: "secondary", size: "sm" })}
          >
            {t("catalogue.import")}
          </Link>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {undoable.map((run) => (
          <form key={run.id} action={undoImportForm}>
            <input type="hidden" name="importRunId" value={run.id} />
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-ctl border border-line bg-paper-sunk px-3 py-2">
              <p className="text-body-sm text-ink">
                {t("import.done_title", { count: formatCount(run.createdCount) })}
                <span className="ml-2 font-mono text-caption text-faint">{run.filename}</span>
                <span className="mt-0.5 block text-caption text-muted">
                  {t("import.undo_window")}
                </span>
              </p>
              <button
                type="submit"
                className={buttonClassName({ variant: "secondary", size: "sm" })}
              >
                {t("import.undo")}
              </button>
            </div>
          </form>
        ))}

        {catalogue.missingFilterableSpecs > 0 && (
          <Alert
            tone="warn"
            action={
              <Link
                href="/dashboard/templates"
                className={buttonClassName({ variant: "secondary", size: "sm" })}
              >
                {t("catalogue.template_link")}
              </Link>
            }
          >
            {t("catalogue.missing_specs", {
              count: formatCount(catalogue.missingFilterableSpecs),
            })}
          </Alert>
        )}

        {catalogue.draftCount > 0 && (
          <p className="text-body-sm text-muted">
            {t("catalogue.drafts", { count: formatCount(catalogue.draftCount) })}
          </p>
        )}

        {catalogue.rows.length === 0 ? (
          <Card padded>
            <h2 className="text-h3 text-ink">{t("catalogue.empty_title")}</h2>
            <p className="mt-2 max-w-prose text-body-sm text-muted">{t("catalogue.empty_body")}</p>
            <div className="mt-4">
              <Link
                href="/dashboard/products/import"
                className={buttonClassName({ size: "sm" })}
              >
                {t("catalogue.import")}
              </Link>
            </div>
          </Card>
        ) : (
          <CatalogueTable
            rows={catalogue.rows}
            action={bulkUpdateProducts}
          />
        )}
      </div>
    </SellerPage>
  );
}
