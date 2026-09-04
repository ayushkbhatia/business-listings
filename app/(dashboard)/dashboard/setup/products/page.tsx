import { redirect } from "next/navigation";
import { PageEvent } from "@/components/telemetry";
import { productBoardFor, sheetChoicesFor, AVAILABILITY_OPTIONS } from "@/lib/products/service";
import { setupHubState } from "@/lib/setup/service";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { requireSellerSeat, type SellerSeat } from "../../_shell";
import { TaskChrome, type TaskSegment } from "../_task-chrome";
import { SheetChooser, type SheetCard } from "./SheetChooser";
import { RowTable, type EditableRow } from "./RowTable";
import {
  chooseSheetAction,
  deleteRowAction,
  pasteRowsAction,
  saveRowAction,
  sheetChangeCost,
} from "./actions";

/**
 * Board 8c — setup task 2: the spec sheet, then the first ten products.
 *
 * The most valuable and most expensive of the four tasks, and the only one that
 * creates new indexable pages rather than improving an existing one. Two jobs
 * stacked on one route, in that order, because the sheet decides what the rows
 * can hold.
 *
 * ## What was cut, and why it is the handoff's own instruction
 *
 * **"Upload a price list"** — §6. It and "Paste from Excel" share one visual
 * weight in the render and are not the same feature: paste is reading the
 * clipboard, while upload is a file parse, a column-mapping step, a
 * preview-and-confirm table, per-row error reporting and a job queue. §6 says
 * to cut the second and keep the first if the importer is not in this phase,
 * because a button that opens nothing is worse than no button — and board 8a
 * already routes the hard case to the concierge, which is a human process that
 * works today.
 *
 * ## What was kept that the handoff expected to cut
 *
 * "Clone one and edit it later" stays in step 1's copy. §9's second open
 * question asks whether to scope cloning or cut the clause — it turns out
 * cloning already exists: `cloneTemplate` is wired to `/dashboard/templates`
 * and has been since handoff 3.
 */
export const metadata = { title: "First products" };
export const dynamic = "force-dynamic";

/** Board 8c §1: owner and manager, like the hub and like 8b. */
function mayEditProducts(seat: SellerSeat): boolean {
  return seat.actor.roles.some((role) => role === "seller_owner" || role === "seller_manager");
}

export default async function SetupProductsPage() {
  const seat = await requireSellerSeat();
  if (!mayEditProducts(seat)) redirect("/dashboard/leads");

  const [board, sheets, hub] = await Promise.all([
    productBoardFor(seat.businessId),
    sheetChoicesFor(seat.businessId),
    setupHubState(seat.businessId),
  ]);
  if (!hub) redirect("/dashboard");
  if (!hub.live) redirect("/onboarding/locations");

  const segments: TaskSegment[] = hub.tasks.map((task) =>
    task.id === "products"
      ? { id: task.id, filled: Math.min(1, board.qualifying / board.target) }
      : { id: task.id, filled: task.done ? 1 : 0 },
  );

  const toCard = (sheet: (typeof sheets)[number]): SheetCard => ({
    id: sheet.id,
    name: sheet.name,
    meta: t("products.sheet_meta", {
      fields: formatCount(sheet.fields),
      required: formatCount(sheet.required),
      filterable: formatCount(sheet.filterable),
    }),
    adoption:
      sheet.adoption > 0
        ? t("products.sheet_adoption", {
            count: sheet.adoption,
            formatted: formatCount(sheet.adoption),
          })
        : "",
    matches: sheet.matches,
  });

  const rows: EditableRow[] = board.rows.map((row) => ({
    id: row.id,
    name: row.name,
    size: row.size,
    availability: row.availability,
    live: row.live,
    hasImage: row.hasImage,
    specsLabel:
      row.specs.required === 0
        ? t("products.no_specs")
        : t("products.specs_of", {
            filled: formatCount(row.specs.filled),
            required: formatCount(row.specs.required),
          }),
    tone: row.specs.tone,
  }));

  const availability = Object.fromEntries(
    AVAILABILITY_OPTIONS.map((option) => [
      option,
      t(`products.availability.${option}` as never),
    ]),
  );

  const more = Math.max(0, board.target - board.qualifying);

  return (
    <TaskChrome
      name={t("products.eyebrow")}
      segments={segments}
      openCount={hub.openCount}
      done={board.done}
    >
      <PageEvent name="setup_task_started" props={{ task: "products" }} />

      <div className="flex flex-col gap-7">
        <section aria-labelledby="sheet-step">
          <h2 id="sheet-step" className="text-h1 text-ink">
            {t("products.step1")}
          </h2>
          <p className="mt-2 max-w-prose text-body-sm text-body">{t("products.step1_body")}</p>

          <div className="mt-5" role="radiogroup" aria-labelledby="sheet-step">
            <SheetChooser
              cards={sheets.slice(0, 3).map(toCard)}
              all={sheets.map(toCard)}
              selectedId={board.sheetId ? currentPlatformId(board, sheets) : null}
              hasRows={board.rows.length > 0}
              labels={{
                matches: t("products.sheet_matches"),
                browseAll: t("products.browse_all", {
                  count: sheets.length,
                  formatted: formatCount(sheets.length),
                }),
                browseBody: t("products.browse_body"),
                browseTitle: t("products.browse_title"),
                browseClose: t("products.browse_close"),
                choose: t("products.choose"),
                chosen: t("products.chosen"),
                changeTitle: t("products.change_sheet_title"),
                changeBody: t("products.change_sheet_body"),
                changeConfirm: t("products.change_sheet_confirm"),
                changeCancel: t("products.change_sheet_cancel"),
              }}
              choose={chooseSheetAction}
              cost={sheetChangeCost}
            />
          </div>
        </section>

        <section aria-labelledby="rows-step" className="border-t border-line pt-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="rows-step" className="text-h1 text-ink">
                {t("products.step2")}
              </h2>
              <p className="mt-2 max-w-prose text-body-sm text-body">
                {board.sheetId ? t("products.step2_body") : t("products.no_sheet")}
              </p>
            </div>
          </div>

          <div className="mt-5">
            <RowTable
              rows={rows}
              availabilityOptions={AVAILABILITY_OPTIONS}
              canAdd={!board.atCap}
              disabled={board.sheetId === null}
              labels={{
                colImg: t("products.col.img"),
                colName: t("products.col.name"),
                // The sheet's own field, not the word "size" — see
                // `sizeFieldOf`. A supplier reading "Nominal diameter" knows
                // what to type; reading "Size" has to guess.
                colSize: board.sizeFieldLabel ?? t("products.col.size"),
                colAvailability: t("products.col.availability"),
                colSpecs: t("products.col.specs"),
                colActions: t("products.col.actions"),
                caption: t("products.caption"),
                namePlaceholder: t("products.name_placeholder"),
                addLine: t("products.add_line"),
                remove: t("products.remove_row"),
                notLive: t("products.not_live"),
                paste: t("products.paste"),
                pasteHint: t("products.paste_hint"),
                pasteApply: t("products.paste_apply"),
                pasteClose: t("products.browse_close"),
                previewEyebrow: t("products.preview_eyebrow"),
                previewPrice: t("products.preview_price"),
                previewEnquire: t("products.preview_enquire"),
                previewEmpty: t("products.preview_empty"),
                saveFailed: t("products.error.save_failed"),
                availability,
              }}
              save={saveRowAction}
              remove={deleteRowAction}
              paste={pasteRowsAction}
            />
          </div>

          <Footer board={board} more={more} />

          {/*
            "No prices needed" is the reassurance the whole product rests on:
            there is no price field on a product at any tier, and a supplier
            arriving from a marketplace expects to be asked for one.
          */}
          <div className="mt-4 rounded-card border border-warn-line bg-warn-surface px-5 py-4">
            <p className="max-w-prose text-body-sm text-warn-ink">
              <span className="font-medium">{t("products.no_prices_title")}</span>{" "}
              {t("products.no_prices_body")}
            </p>
          </div>

          <div className="mt-4 rounded-card border border-line bg-paper-sunk px-5 py-4 lg:max-w-[520px]">
            <p className="text-body-sm font-medium text-ink">{t("products.why_title")}</p>
            <p className="mt-2 text-caption text-body">{t("products.why_body")}</p>
          </div>
        </section>
      </div>
    </TaskChrome>
  );
}

/**
 * Two numbers from one table, and the cap case the Free plan creates.
 *
 * "3 live · 7 more to finish this task" counts published rows on the left and
 * *qualifying* rows on the right — §3 is explicit that a row below the 60% bar
 * is live and does not count.
 *
 * At the cap and still short, the sentence changes: adding is refused, so the
 * way forward is filling specs on rows that already exist. Telling a seller to
 * add more when the product will refuse the next one is the kind of instruction
 * that makes somebody give up on a screen.
 */
function Footer({
  board,
  more,
}: {
  board: Awaited<ReturnType<typeof productBoardFor>>;
  more: number;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
      <p className="text-caption text-muted">
        {board.done
          ? t("products.footer_done", {
              count: board.live,
              formatted: formatCount(board.live),
            })
          : t("products.footer", {
              count: board.live,
              formatted: formatCount(board.live),
              more: formatCount(more),
            })}
      </p>
      <p className="font-mono text-caption tabular-nums text-muted">
        {t("products.points_so_far", { points: formatCount(board.pointsSoFar) })}
      </p>

      {board.atCap && board.planName && (
        <p className="w-full text-caption text-warn-ink">
          {board.done
            ? t("products.at_cap", {
                count: board.cap ?? 0,
                formatted: formatCount(board.cap ?? 0),
                plan: board.planName,
              })
            : t("products.at_cap_improve", { plan: board.planName })}
        </p>
      )}
    </div>
  );
}

/**
 * Which card is selected.
 *
 * `SellerTemplate` stores the platform template it points at, and the cards are
 * keyed by platform template id — so the selected card is the one whose id the
 * seller's sheet was built from, not the seller-template row's own id.
 */
function currentPlatformId(
  board: Awaited<ReturnType<typeof productBoardFor>>,
  sheets: Awaited<ReturnType<typeof sheetChoicesFor>>,
): string | null {
  const byName = sheets.find((sheet) => sheet.name === board.sheetName);
  return byName?.id ?? null;
}
