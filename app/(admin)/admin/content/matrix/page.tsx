import { notFound } from "next/navigation";
import { Alert } from "@/components/display";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { areaMatrix, pageMatrix } from "@/lib/content/matrix";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../../_shell";
import { publishArea, saveAreaCopy, saveIntro, unpublishArea } from "./actions";
import { AreaTable, type AreaRowView } from "./AreaTable";
import { MatrixTable, type MatrixRowView } from "./MatrixTable";

/**
 * Board 6f — the SEO page matrix.
 *
 * `taxonomy.write`, because the copy goes through `editCategory` and lands on
 * the same audited row as the thresholds it is measured against.
 */

export const dynamic = "force-dynamic";

export default async function MatrixPage() {
  const seat = await requireStaff();
  if (!can(seat.actor, "taxonomy.write")) notFound();

  const [matrix, areas, badges] = await Promise.all([
    pageMatrix(),
    areaMatrix(),
    getAdminNavBadges(seat),
  ]);

  const rows: MatrixRowView[] = matrix.rows.map((row) => ({
    id: row.id,
    path: row.path,
    name: row.name,
    parentName: row.parentName,
    listings: formatCount(row.listings),
    verifiedShare: row.listings === 0 ? "—" : `${Math.round(row.verifiedShare * 100)}%`,
    introWords: row.introWords,
    intro: row.intro,
    publishable: row.publishable,
    failing: row.failing,
  }));

  const areaRows: AreaRowView[] = areas.rows.map((row) => ({
    areaId: row.areaId,
    categoryId: row.categoryId,
    path: row.path,
    areaName: row.areaName,
    categoryName: row.categoryName,
    listings: formatCount(row.listings),
    verifiedShare:
      row.listings === 0 ? "—" : `${Math.round((row.verified / row.listings) * 100)}%`,
    introWords: row.introWords,
    intro: row.intro ?? "",
    published: row.published,
    live: row.live,
    clearsFloors: row.failing.length === 0,
    failing: row.failing,
  }));

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/content/matrix"
      title={t("matrix.title")}
      eyebrow={t("matrix.eyebrow")}
      meta={
        <span className="text-caption text-muted">
          {t("matrix.meta", {
            publishable: formatCount(matrix.publishable + areas.live),
            total: formatCount(matrix.rows.length + areas.rows.length),
            copy: formatCount(matrix.copyOnly + areas.copyOnly),
          })}
        </span>
      }
    >
      {matrix.copyOnly > 0 && (
        <Alert tone="info" live="off">
          {t("matrix.copy_only", { count: formatCount(matrix.copyOnly) })}
        </Alert>
      )}

      <MatrixTable rows={rows} save={saveIntro} />

      <p className="mt-[var(--gutter)] max-w-prose text-caption text-muted">
        {t("matrix.note")}
      </p>

      {/*
        Board 6a on the same screen, because criterion 12 asks the sitemap's
        page count to match this matrix exactly — and area pages are the largest
        population in the sitemap. A matrix that covered only categories could
        not answer that question at all.
      */}
      <h2 className="mt-[calc(var(--gutter)*2)] text-h2 text-ink">{t("matrix.area_tab")}</h2>
      <AreaTable
        rows={areaRows}
        save={saveAreaCopy}
        publish={publishArea}
        unpublish={unpublishArea}
      />

      <p className="mt-[var(--gutter)] max-w-prose text-caption text-muted">
        {t("matrix.area_note", { listings: 60, share: 30, words: 250 })}
      </p>
    </AdminPage>
  );
}
