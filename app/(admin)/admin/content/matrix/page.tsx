import { notFound } from "next/navigation";
import { Alert } from "@/components/display";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { pageMatrix } from "@/lib/content/matrix";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../../_shell";
import { saveIntro } from "./actions";
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

  const [matrix, badges] = await Promise.all([pageMatrix(), getAdminNavBadges(seat)]);

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
            publishable: formatCount(matrix.publishable),
            total: formatCount(matrix.rows.length),
            copy: formatCount(matrix.copyOnly),
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
    </AdminPage>
  );
}
