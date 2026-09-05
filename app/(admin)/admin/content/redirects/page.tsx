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
    /*
       What goes on the wire, not what the column says.

       `redirectIfMoved` calls Next's `permanentRedirect`, which emits 308. The
       column has held 301 since handoff 0 because three writers store that
       literal, and this table printed it — so the one screen in the product
       that answers "what status does this address return" answered with a
       number no request has ever received. 308 is the same instruction with the
       method preserved; the column is left alone because rewriting stored rows
       to match a renderer is the wrong direction, and the value it holds is the
       intent rather than the response.
    */
    statusCode: "308",
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
