import Link from "next/link";
import { Alert, Tag } from "@/components/display";
import { buttonClassName } from "@/components/primitives";
import { Card } from "@/components/structure";
import { prisma } from "@/lib/db/client";
import { effectiveFor } from "@/lib/billing/entitlements-service";
import { allowance } from "@/lib/plan/entitlements";
import {
  CATALOGUE_SORTS,
  DEFAULT_PAGE_SIZE,
  PAGE_SIZES,
  getCatalogueView,
  type CatalogueSort,
} from "@/lib/products/catalogue";
import { movableCategories } from "@/lib/products/move-category";
import { revertableRuns } from "@/lib/import/service";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../_shell";
import {
  bulkMoveCategory,
  bulkUpdateProducts,
  createProduct,
  previewMoveCategory,
  undoImportForm,
} from "./actions";
import { CatalogueWorkspace } from "./CatalogueWorkspace";

/**
 * Board 3f — the catalogue.
 *
 * Every product the seller has, and the work outstanding on them. The screen
 * turns on one correction: a missing spec is two different problems. An empty
 * **required** field blocks that product's next save and changes nothing a
 * buyer sees; an empty **filterable** field makes the product absent from a
 * buyer's filter and blocks nothing. One is a wall in front of the seller's
 * next edit, the other is reach they will never notice losing — so they are
 * counted, chipped and filtered separately, and nothing on this screen adds
 * them together.
 *
 * The header carries the plan's product limit on every plan, so it is never
 * discovered at the moment of being blocked. Over-cap products are stored and
 * unlisted, never deleted: `hideOverPlanCap` flips them to draft and records
 * them on the subscription, and an upgrade puts them back.
 */
export const metadata = { title: "Products" };
export const dynamic = "force-dynamic";

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function CataloguePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const seat = await requireSellerSeat();
  const params = await searchParams;

  const sortParam = one(params["sort"]);
  const sort: CatalogueSort = (CATALOGUE_SORTS as readonly string[]).includes(sortParam)
    ? (sortParam as CatalogueSort)
    : "gaps";
  const gapParam = one(params["gap"]);
  const gap = gapParam === "blocked" || gapParam === "filter" ? gapParam : undefined;
  const rowsParam = Number(one(params["rows"]));
  const pageSize = (PAGE_SIZES as readonly number[]).includes(rowsParam)
    ? rowsParam
    : DEFAULT_PAGE_SIZE;

  const query = {
    q: one(params["q"]),
    categoryId: one(params["categoryId"]),
    status: one(params["status"]),
    template: one(params["template"]),
    gap: gapParam,
    sort,
  };

  const [view, badges, undoable, caps, targets] = await Promise.all([
    getCatalogueView(seat.businessId, {
      ...(query.q ? { q: query.q } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.template ? { template: query.template } : {}),
      ...(gap ? { gap } : {}),
      sort,
      page: Math.max(1, Number(one(params["page"])) || 1),
      pageSize,
    }),
    getNavBadges(seat.businessId),
    revertableRuns(seat.businessId),
    effectiveFor(seat.businessId),
    movableCategories(seat.businessId),
  ]);

  const planName =
    (
      await prisma.business.findUnique({
        where: { id: seat.businessId },
        select: { plan: { select: { name: true } } },
      })
    )?.plan?.name ?? seat.planName;

  /*
     The cap, read rather than named.

     `allowance` is the same function the CSV importer refuses on and the
     onboarding sheet returns `at_cap` from — two readers of one definition, not
     two definitions of the cap. Counted against what is *listed*, because the
     cap is on reach rather than on records: nothing is deleted or refused
     storage for a billing reason.
  */
  const room = caps ? allowance(caps, "products", view.summary.live) : null;
  const overCap = view.rows.filter((row) => row.storedNotListed).length;

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/products"
      eyebrow={t("catalogue.eyebrow")}
      title={t("catalogue.title")}
      meta={
        <span className="flex flex-wrap items-center gap-2">
          {/*
             One total, and a breakdown that sums to it.

             The board read `1,204 live · 38 drafts · 14 out of stock` — 1,256 —
             over a pagination reading `1–10 of 1,242`, because 1,204 was the
             seller's total and the header had labelled it as the live count.
             Both figures here come from one read of one array.
          */}
          <span className="text-body-sm text-body">
            {t("catalogue.header_counts", {
              count: view.summary.total,
              formatted: formatCount(view.summary.total),
            })}
          </span>
          <span className="font-mono text-eyebrow uppercase tabular-nums text-muted">
            {t("catalogue.header_breakdown", {
              live: formatCount(view.summary.live),
              draft: formatCount(view.summary.draft),
              outOfStock: formatCount(view.summary.outOfStock),
            })}
          </span>
          <Tag mono size="sm">
            {room === null || room.cap === null
              ? t("catalogue.cap.unlimited", { plan: planName })
              : t("catalogue.cap.listed", {
                  plan: planName,
                  listed: formatCount(room.used),
                  cap: formatCount(room.cap),
                })}
          </Tag>
        </span>
      }
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
                <span className="ml-2 font-mono text-caption text-muted">{run.filename}</span>
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

        {/*
           Stored, not deleted — said where the seller meets it.

           A Pro seller who drops to Free keeps every record; the ones above the
           limit stop being listed and their URLs 301 like any unpublished
           product. No billing event destroys anything, and the sentence says so
           before the seller goes looking for what happened to their catalogue.
        */}
        {overCap > 0 && (
          <Alert
            tone="warn"
            action={
              <Link
                href="/dashboard/billing"
                className={buttonClassName({ variant: "secondary", size: "sm" })}
              >
                {t("nav.billing")}
              </Link>
            }
          >
            {t("catalogue.cap.over", { count: overCap })}
          </Alert>
        )}

        {view.summary.total === 0 ? (
          <Card padded>
            <h2 className="text-h3 text-ink">{t("catalogue.empty_title")}</h2>
            <p className="mt-2 max-w-prose text-body-sm text-muted">{t("catalogue.empty_body")}</p>
            <div className="mt-4">
              <Link href="/dashboard/products/import" className={buttonClassName({ size: "sm" })}>
                {t("catalogue.import")}
              </Link>
            </div>
          </Card>
        ) : (
          <CatalogueWorkspace
            view={view}
            query={query}
            moveTargets={targets}
            bulkAction={bulkUpdateProducts}
            moveAction={bulkMoveCategory}
            previewAction={previewMoveCategory}
            createAction={createProduct}
          />
        )}
      </div>
    </SellerPage>
  );
}
