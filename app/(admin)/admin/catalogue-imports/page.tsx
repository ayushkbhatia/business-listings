import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/can";
import { openCatalogueImports } from "@/lib/catalogue-import/service";
import { formatAED, formatCount, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { ImportQueue, type ImportRow } from "./ImportQueue";
import { complete, reject, start } from "./actions";

/**
 * Board 12i — concierge catalogue loads.
 *
 * The other end of board 8a's right rail: a seller sent us a price list and
 * somebody here keys it in. `queue.decide` gates it — moderator or ops lead —
 * for the reason `lib/catalogue-import/service.ts` sets out: working through a
 * queue of seller submissions is what that row of the matrix names, and no
 * narrower capability exists without a `docs/permissions.md` change.
 *
 * Every figure on this page is a query. The fee is the one frozen on the row at
 * the moment the seller asked, not today's price for that plan — those are two
 * different numbers whenever the setting has moved, and the seller agreed to
 * the first one.
 *
 * Formatting happens here and not in `ImportQueue`. That component is a client
 * one, and a date formatted in the browser and again on the server is the
 * hydration mismatch this repo has hit more than once.
 */

export const dynamic = "force-dynamic";

export default async function CatalogueImportsPage() {
  const seat = await requireStaff();
  if (!can(seat.actor, "queue.decide")) notFound();

  const [requests, badges] = await Promise.all([
    openCatalogueImports(200),
    getAdminNavBadges(seat),
  ]);

  const rows: ImportRow[] = requests.map((request) => ({
    id: request.id,
    businessName: request.business.displayName,
    planName: request.business.plan?.name ?? "—",
    fee: formatAED(request.feeAed),
    note: request.note,
    filename: request.document?.filename ?? null,
    status: request.status === "in_progress" ? "in_progress" : "requested",
    due: request.dueAt ? formatDate(request.dueAt) : "—",
    ageDays: request.ageDays,
    late: request.late,
  }));

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/catalogue-imports"
      title={t("nav.group.catalogue")}
      eyebrow={t("nav.group.supply")}
      meta={
        <span className="text-caption text-muted">
          {t("admin.queue.meta", {
            count: formatCount(rows.length),
            days: String(rows[0]?.ageDays ?? 0),
          })}
        </span>
      }
    >
      {/*
        No standing note under the table yet. `/admin/visits` and
        `/admin/reports` both carry one saying what the queue is and is not, and
        this screen owes the same sentence — it is listed as
        `admin.catalogue_imports.note` in the strings this module could not add.
        A borrowed paragraph about supplier reports would be worse than none.
      */}
      <ImportQueue rows={rows} start={start} complete={complete} reject={reject} />
    </AdminPage>
  );
}
