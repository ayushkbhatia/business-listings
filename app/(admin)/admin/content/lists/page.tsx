import { notFound } from "next/navigation";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { curatedListIndex } from "@/lib/seo/curated/queues";
import { formatCount, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../../_shell";
import { ListTable, type ListRowView } from "./ListTable";

/**
 * Board 6f §7 — where a curated-list queue row opens.
 *
 * The re-audit queue and the drift queue both name a list and both need
 * somewhere to send a person. `6b` describes the record and `6f` scopes the
 * tab; neither designs an editor, so this is deliberately a read-only index:
 * what is published, when it was audited, when it is next due, and what is
 * outstanding against it. The audit itself still runs through `auditList`.
 */

export const dynamic = "force-dynamic";

export default async function CuratedListsAdminPage() {
  const seat = await requireStaff();
  if (!can(seat.actor, "taxonomy.write")) notFound();

  const [lists, badges] = await Promise.all([curatedListIndex(), getAdminNavBadges(seat)]);

  const rows: ListRowView[] = lists.map((list) => ({
    id: list.id,
    title: list.title,
    slug: list.slug,
    categoryName: list.categoryName,
    members: formatCount(list.members),
    state: !list.published ? "draft" : list.overdue ? "overdue" : "published",
    audited: list.auditedAt ? formatDate(list.auditedAt) : "—",
    due: list.dueAt ? formatDate(list.dueAt) : "—",
    drift: list.openDrift === 0 ? "—" : formatCount(list.openDrift),
  }));

  const overdue = rows.filter((row) => row.state === "overdue").length;

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/content/lists"
      title={t("lists_admin.title")}
      eyebrow={t("lists_admin.eyebrow")}
      meta={
        <span className="text-caption text-muted">
          {t("lists_admin.meta", {
            count: formatCount(rows.length),
            overdue: formatCount(overdue),
          })}
        </span>
      }
    >
      <ListTable rows={rows} />

      <p className="mt-[var(--gutter)] max-w-prose text-caption text-muted">
        {t("lists_admin.note")}
      </p>
    </AdminPage>
  );
}
