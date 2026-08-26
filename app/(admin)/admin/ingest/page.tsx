import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/can";
import { recentRuns } from "@/lib/ingest/service";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { RunTable } from "./RunTable";

/**
 * Board 12a — the licence importer.
 *
 * The list exists to answer one question: is anything staged and waiting for a
 * decision. A staged run is tinted, because a run nobody approves is 8,000
 * companies that are not in the directory.
 */

export const dynamic = "force-dynamic";

export default async function IngestPage() {
  const seat = await requireStaff();
  if (!can(seat.actor, "queue.decide")) notFound();

  const [runs, badges] = await Promise.all([recentRuns(), getAdminNavBadges(seat)]);
  const staged = runs.reduce((sum, run) => sum + (run.status === "staged" ? run.stagedCount : 0), 0);

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/ingest"
      title={t("admin.ingest.title")}
      eyebrow={t("admin.ingest.eyebrow")}
      meta={
        <span className="text-caption text-muted">
          {t("admin.ingest.meta", {
            staged: formatCount(staged),
            runs: formatCount(runs.length),
          })}
        </span>
      }
    >
      <RunTable rows={runs} />

      <p className="mt-[var(--gutter)] max-w-prose text-caption text-muted">
        {t("admin.ingest.note")}
      </p>
    </AdminPage>
  );
}
