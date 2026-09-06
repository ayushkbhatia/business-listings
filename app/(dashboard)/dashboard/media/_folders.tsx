import Link from "next/link";
import { Panel } from "@/components/structure";
import type { Folder } from "@/lib/media/library";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Board 3i §2 — the folders rail, 188px.
 *
 * **Every file is in exactly one folder, and the counts sum to the header
 * total.** The board listed five folders plus `Unused 41`, which put 41 files
 * in two folders at once — they are also in *Product shots*, or wherever they
 * were uploaded — and the counts only summed to 1,482 because unused was
 * treated as exclusive. Unreferenced is a **state**: it lives in the rail card
 * below and in the filter row, not here. Same category error as `4e`'s category
 * row inside a table of templates.
 *
 * `Unfiled` is the null case rather than a row, which is what keeps the sum
 * true — there is no folder to rename or delete out from under it, and it is
 * the honest destination of uploads nobody has moved.
 */
export function FoldersRail({
  folders,
  activeId,
  total,
}: {
  folders: readonly Folder[];
  /** `undefined` means every folder; `null` means Unfiled. */
  activeId: string | null | undefined;
  total: number;
}) {
  const named = folders.filter((folder) => folder.id !== null);

  return (
    <Panel eyebrow={t("media.folders")} padded={false}>
      <ul className="flex flex-col">
        {folders.map((folder) => {
          const active = activeId !== undefined && activeId === folder.id;
          const href = folder.id === null ? "/dashboard/media?folder=none" : `/dashboard/media?folder=${folder.id}`;
          return (
            <li key={folder.id ?? "unfiled"} className="border-b border-line last:border-0">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex items-baseline justify-between gap-2 px-3 py-2 text-body-sm focus-visible:outline-none focus-visible:shadow-focus ${
                  active ? "bg-ink text-on-ink" : "text-ink hover:bg-paper-sunk"
                }`}
              >
                <span className="min-w-0 truncate">
                  {folder.id === null ? t("media.unfiled") : folder.name}
                </span>
                <span className="shrink-0 font-mono tabular-nums text-caption opacity-80">
                  {formatCount(folder.files)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <p className="border-t border-line px-3 py-2 text-caption text-muted">
        {t("media.folder_note", {
          count: folders.length,
          n: formatCount(folders.length),
          files: formatCount(total),
        })}
      </p>
      {named.length === 0 && null}
    </Panel>
  );
}
