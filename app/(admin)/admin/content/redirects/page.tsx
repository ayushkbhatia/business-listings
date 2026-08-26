import { notFound } from "next/navigation";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { redirectList } from "@/lib/content/redirects";
import { formatCount, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../../_shell";
import { create, remove } from "./actions";
import { RedirectManager, type RedirectRowView } from "./RedirectManager";

/** Board 12g — redirects. `Redirect` is read on every 404 that might be one. */

export const dynamic = "force-dynamic";

export default async function RedirectsPage() {
  const seat = await requireStaff();
  if (!can(seat.actor, "taxonomy.write")) notFound();

  const [redirects, badges] = await Promise.all([redirectList(), getAdminNavBadges(seat)]);

  const rows: RedirectRowView[] = redirects.map((row) => ({
    id: row.id,
    fromPath: row.fromPath,
    toPath: row.toPath,
    statusCode: String(row.statusCode),
    businessName: row.businessName ?? "—",
    added: formatDate(row.createdAt),
  }));

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/content/redirects"
      title={t("redirects.title")}
      eyebrow={t("redirects.eyebrow")}
      meta={
        <span className="text-caption text-muted">
          {t("redirects.meta", { count: formatCount(rows.length) })}
        </span>
      }
    >
      <RedirectManager rows={rows} create={create} remove={remove} />

      <p className="mt-[var(--gutter)] max-w-prose text-caption text-muted">
        {t("redirects.note")}
      </p>
    </AdminPage>
  );
}
