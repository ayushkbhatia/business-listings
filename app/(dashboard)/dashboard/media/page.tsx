import { prisma } from "@/lib/db/client";
import { Card, Panel } from "@/components/structure";
import { Button, Input, Label } from "@/components/primitives";
import { mediaLibrary, UNFILED, type LibraryFilters, type SortKey } from "@/lib/media/library";
import { formatBytes, formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../_shell";
import {
  attachToProductAction,
  createFolderAction,
  deleteFileAction,
  detachFromProductAction,
  moveToFolderAction,
  previewDeleteAction,
  recordMedia,
  saveAltAction,
  setPrimaryAction,
  signMediaUpload,
} from "./actions";
import { MediaBoard } from "./MediaBoard";
import { MediaUploader } from "./MediaUploader";
import { FoldersRail } from "./_folders";
import { UnreferencedCard } from "./_unreferenced";
import { Filters } from "./Filters";

/**
 * Board 3i — the media library.
 *
 * Every image and document the seller has uploaded, and what each one is
 * attached to. It is a **reference store, not a per-product folder**: one file
 * can be the primary image on one product, a secondary on two more, and a
 * datasheet cited by twelve. That is the answer to board `3g` Q4 — documents
 * are shared and referenced, never copied per product — and it is a schema
 * change, because `Media.productId` and `Document.productId` were single
 * nullable columns until this board.
 *
 * The correction that outranks everything else on the screen: **unattached is
 * not unused**. The board's rail card offered to delete 41 files and free
 * 380 MB, from one column. A file with no product attachment can still be
 * cited by a quote a buyer already holds, and deleting that breaks a document
 * we have already sent. `lib/media/references.ts` computes it properly and
 * `lib/media/state.ts` decides what may follow.
 *
 * Every count here is a query. The board hardcoded all of them.
 */
export const metadata = { title: t("media.title") };
export const dynamic = "force-dynamic";

const SORTS: SortKey[] = ["newest", "oldest", "largest", "name"];

export default async function MediaPage({
  searchParams,
}: {
  searchParams: Promise<{
    folder?: string;
    q?: string;
    type?: string;
    used?: string;
    alt?: string;
    sort?: string;
  }>;
}) {
  const seat = await requireSellerSeat();
  const params = await searchParams;

  const folderId =
    params.folder === undefined ? undefined : params.folder === "none" ? null : params.folder;

  const filters: LibraryFilters = {
    ...(folderId !== undefined ? { folderId } : {}),
    ...(params.q ? { search: params.q } : {}),
    ...(params.type === "image" || params.type === "document" ? { type: params.type } : {}),
    ...(params.used === "products" || params.used === "storefront" || params.used === "nothing"
      ? { usedIn: params.used }
      : {}),
    ...(params.alt === "1" ? { missingAlt: true } : {}),
    ...(SORTS.includes(params.sort as SortKey) ? { sort: params.sort as SortKey } : {}),
  };

  const [library, badges, products] = await Promise.all([
    mediaLibrary(seat.businessId, filters),
    getNavBadges(seat.businessId),
    prisma.product.findMany({
      where: { businessId: seat.businessId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, sku: true },
    }),
  ]);

  const cap = library.storage.allowance.cap;
  const scopeName =
    folderId === undefined
      ? // No folder filter, so the scope is everything — `2 selected in Folders`
        // named a rail rather than a set. Board 3i §6 wants the scope stated,
        // and a wrong noun is worse than a vague one before a bulk delete.
        t("media.all_files")
      : folderId === null
        ? t("media.unfiled")
        : (library.folders.find((folder) => folder.id === folderId)?.name ?? t("media.folders"));

  const unreferencedBytes = library.files
    .filter((file) => file.unreferenced)
    .reduce((sum, file) => sum + file.bytes, 0);

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/media"
      eyebrow={t("media.eyebrow")}
      title={t("media.title")}
      meta={
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-caption text-muted">
            {cap === null
              ? t("media.header_uncapped", {
                  count: library.total,
                  n: formatCount(library.total),
                  used: formatBytes(library.storage.usedBytes),
                })
              : t("media.header", {
                  count: library.total,
                  n: formatCount(library.total),
                  used: formatBytes(library.storage.usedBytes),
                  cap: formatBytes(cap * 1024 * 1024),
                })}
          </span>
          {cap !== null && (
            /*
               The cap states its behaviour. `2.1 GB of 10 GB` said nothing
               about whose 10 GB or what happens at 10 — per board 3f §6 a plan
               limit is visible before it bites and never destroys a record.
            */
            <span className="rounded-chip bg-paper-sunk px-2 py-0.5 font-mono text-eyebrow uppercase text-muted">
              {t("media.cap_behaviour", {
                plan: library.storage.planName,
                cap: formatBytes(cap * 1024 * 1024),
              })}
            </span>
          )}
        </span>
      }
    >
      {/*
          `board:` (1440), not `xl:` (1280). Tailwind's `xl` is 1280 and the design
          width is 1440, so `xl:` put the four-column grid and the 188px rail
          on at 1280 — where the spec asks for three columns and the folders
          out of the way. Board 3g's SpecGrid made the same correction and says
          so at the same length.

          Between 1280 and 1439 the folders stack above the grid rather than
          taking a column: the detail panel is the part that cannot shrink,
          because it is the screen's only route to one file.
      */}
      <div className="flex flex-col gap-[var(--gutter)] board:flex-row">
        <div className="flex w-full shrink-0 flex-col gap-[var(--gutter)] board:w-[188px]">
          <FoldersRail folders={library.folders} activeId={folderId} total={library.total} />

          <Panel title={t("media.new_folder")}>
            <form action={createFolderAction} className="flex flex-col gap-2">
              <Label htmlFor="folder-name">{t("media.folder_name")}</Label>
              <Input id="folder-name" name="name" required maxLength={40} />
              <Button type="submit" variant="secondary" size="sm">
                {t("media.folder_create")}
              </Button>
            </form>
          </Panel>

          <UnreferencedCard
            unreferenced={library.unreferenced}
            unreferencedBytes={unreferencedBytes}
            quoteHeld={library.quoteHeld}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-[var(--gutter)]">
          <Filters
            missingAlt={library.missingAltOnLive}
            search={params.q ?? ""}
            type={params.type ?? "all"}
            used={params.used ?? "all"}
            sort={params.sort ?? "newest"}
            altActive={params.alt === "1"}
          />

          {library.storage.allowance.atCap && (
            <Card padded>
              <p className="text-body-sm text-body">
                {t("media.cap_reached", {
                  cap: formatBytes((cap ?? 0) * 1024 * 1024),
                  plan: library.storage.planName,
                })}
              </p>
            </Card>
          )}

          <MediaUploader
            signAction={signMediaUpload}
            recordAction={recordMedia}
            disabled={library.storage.allowance.atCap}
          />

          {library.total === 0 ? (
            <Card padded>
              <h2 className="text-h3 text-ink">{t("media.empty_title")}</h2>
              <p className="mt-2 max-w-prose text-body-sm text-muted">{t("media.empty_body")}</p>
            </Card>
          ) : (
            <MediaBoard
              files={library.files}
              folders={[
                { id: null, name: UNFILED },
                ...library.folders
                  .filter((folder) => folder.id !== null)
                  .map((folder) => ({ id: folder.id, name: folder.name })),
              ]}
              products={products.map((product) => ({
                id: product.id,
                label: product.sku ?? product.name,
              }))}
              scopeName={scopeName}
              totalBytes={library.storage.usedBytes}
              previewDelete={previewDeleteAction}
              deleteFile={deleteFileAction}
              saveAlt={saveAltAction}
              attachToProduct={attachToProductAction}
              detachFromProduct={detachFromProductAction}
              setPrimary={setPrimaryAction}
              moveToFolder={moveToFolderAction}
            />
          )}
        </div>
      </div>
    </SellerPage>
  );
}
