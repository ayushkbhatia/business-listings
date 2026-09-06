import Link from "next/link";
import { SearchField, Select } from "@/components/primitives";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Board 3i §3 — the filter row.
 *
 * **`Newest first` was static text, not a control**, which is the same defect
 * `3f` §5 was corrected for. Everything here is a real control, and each one is
 * a URL: a filtered grid is a thing a seller sends themselves a link to, and a
 * bulk delete over a filtered set is the wrong place for state the address bar
 * cannot see.
 *
 * **The alt-text count is scoped.** Alt text on an unattached file costs
 * nothing; alt text missing from an image on a live page is a public
 * accessibility failure and is what image search reads. The chip counts only
 * the live ones — the board's `14 missing alt text` counted every file and
 * pointed at none of them.
 *
 * A plain `<form method="get">` rather than an onChange handler: this is a
 * server component, no function crosses the boundary, and the whole row works
 * with JavaScript off.
 */
export function Filters({
  missingAlt,
  search,
  type,
  used,
  sort,
  altActive,
}: {
  missingAlt: number;
  search: string;
  type: string;
  used: string;
  sort: string;
  altActive: boolean;
}) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-2">
      <div className="min-w-[14rem] flex-1">
        <SearchField
          name="q"
          defaultValue={search}
          label={t("media.filter_search")}
          placeholder={t("media.filter_search")}
          clearLabel={t("media.filter_clear")}
        />
      </div>

      <label className="flex flex-col gap-1">
        <span className="font-mono text-eyebrow uppercase text-muted">
          {t("media.filter_type")}
        </span>
        <Select
          name="type"
          defaultValue={type}
          options={[
            { value: "all", label: t("media.filter_type.all") },
            { value: "image", label: t("media.filter_type.image") },
            { value: "document", label: t("media.filter_type.document") },
          ]}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-mono text-eyebrow uppercase text-muted">
          {t("media.filter_used")}
        </span>
        <Select
          name="used"
          defaultValue={used}
          options={[
            { value: "all", label: t("media.filter_used.all") },
            { value: "products", label: t("media.filter_used.products") },
            { value: "storefront", label: t("media.filter_used.storefront") },
            { value: "nothing", label: t("media.filter_used.nothing") },
          ]}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-mono text-eyebrow uppercase text-muted">{t("media.sort")}</span>
        <Select
          name="sort"
          defaultValue={sort}
          options={[
            { value: "newest", label: t("media.sort.newest") },
            { value: "oldest", label: t("media.sort.oldest") },
            { value: "largest", label: t("media.sort.largest") },
            { value: "name", label: t("media.sort.name") },
          ]}
        />
      </label>

      <button
        type="submit"
        className="rounded-ctl border border-line-strong px-3 py-1.5 text-body-sm text-ink hover:bg-paper-sunk focus-visible:outline-none focus-visible:shadow-focus"
      >
        {t("media.filter_apply")}
      </button>

      {missingAlt > 0 && (
        <Link
          href={altActive ? "/dashboard/media" : "/dashboard/media?alt=1"}
          aria-pressed={altActive}
          className={`rounded-chip px-2 py-1 font-mono text-eyebrow uppercase focus-visible:outline-none focus-visible:shadow-focus ${
            altActive ? "bg-ink text-on-ink" : "bg-warn-surface text-warn-ink"
          }`}
        >
          {t("media.filter_alt", { count: missingAlt, n: formatCount(missingAlt) })}
        </Link>
      )}
    </form>
  );
}
