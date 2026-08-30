import { notFound } from "next/navigation";
import { $Enums } from "@/lib/db/generated/client";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/can";
import { recentRuns } from "@/lib/ingest/service";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { RunTable } from "./RunTable";
import { StageForm } from "./StageForm";
import { stage } from "./actions";

/**
 * Board 12a — the licence importer.
 *
 * The list exists to answer one question: is anything staged and waiting for a
 * decision. A staged run is tinted, because a run nobody approves is 8,000
 * companies that are not in the directory.
 */

export const dynamic = "force-dynamic";

/**
 * The licensing authorities a run can come from, straight off the schema enum
 * so a new free zone is one migration rather than two edits.
 */
const AUTHORITIES = Object.values($Enums.Authority).map((value) => ({
  value,
  label: value,
}));

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
      {/*
         The way in. `stageRun` had no caller anywhere, so a run could only
         arrive from a test — the approval half of this screen worked and there
         was nothing for it to approve.
      */}
      <StageForm authorities={AUTHORITIES} stage={stage} />

      <div className="mt-[var(--section-gap)]">
        <RunTable rows={runs} />
      </div>

      <p className="mt-[var(--gutter)] max-w-prose text-caption text-muted">
        {t("admin.ingest.note")}
      </p>
    </AdminPage>
  );
}
