import { requireStaff } from "@/lib/auth/staff";
import { platformOverview } from "@/lib/console/overview";
import { formatMonth } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../_shell";
import { PeriodMenu } from "./revenue/PeriodMenu";
import { refreshOverview } from "./_overview/actions";
import { SnapshotLine, StatusChip } from "./_overview/HeaderBits";
import { OverviewView } from "./_overview/OverviewView";
import { presentOverview } from "./_overview/present";

/**
 * Board 4a — the platform overview. The first screen an ops lead opens.
 *
 * The flow map's sentence is the brief: *six jobs keep the marketplace working;
 * this screen answers one question each morning — which of them is behind — and
 * every number on it links into the queue that fixes it.*
 *
 * Built to the board-level handoff of 1 Oct 2026, with the owner's Phase 0
 * answers of the same day. The five-job panel grid it replaces is gone; the six
 * figures the render had no place for are kept in *Other queues*, by the
 * owner's answer, each linked to the screen that fixes it.
 *
 * - **It owns almost none of its data** (B3). `lib/console/overview.ts` reads
 *   each figure through the board that owns it.
 * - **Every number is a link** (B1), with the filter that reproduces it on the
 *   destination, or plain text where the seat cannot open that board.
 * - **The period picker moves period figures only** (B4). Live tiles say *now*.
 * - **Finance figures are omitted, not blanked,** for a seat without
 *   `revenue.read` (B10).
 *
 * `GET /api/admin/overview?period=` returns the same view, raw.
 */

export const dynamic = "force-dynamic";

type Params = Promise<{ period?: string; sectors?: string }>;

export default async function AdminOverviewPage({ searchParams }: { searchParams: Params }) {
  const seat = await requireStaff();
  const params = await searchParams;
  const now = new Date();
  const [overview, badges] = await Promise.all([
    platformOverview(seat.actor, params.period ?? null, now),
    getAdminNavBadges(seat),
  ]);
  const { view, periods } = overview;
  const allSectors = params.sectors === "all";
  const screen = presentOverview(view, { allSectors });

  const periodQuery = params.period ? `period=${view.period.key}&` : "";
  const allSectorsHref = allSectors ? null : `/admin?${periodQuery}sectors=all`;

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin"
      title={t("admin.overview.title")}
      meta={<StatusChip status={screen.status} />}
      actions={
        /*
           Capped at the viewport so it wraps on a phone: the shell's actions
           slot does not shrink, and three controls on one line would push the
           month picker off the screen.
        */
        <div className="flex max-w-[calc(100vw-2.5rem)] flex-wrap items-center justify-end gap-3">
          <SnapshotLine note={screen.snapshotNote} refresh={refreshOverview} />
          <PeriodMenu
            current={{ key: view.period.key, label: screen.periodLabel, partial: view.period.partial }}
            options={periods.map((period) => ({ key: period.key, label: formatMonth(period.from), partial: period.partial }))}
            basePath="/admin"
          />
        </div>
      }
    >
      <p className="mb-4 text-caption text-muted">
        {t("overview.period_line", { month: screen.periodLabel, note: screen.periodNote })}
      </p>
      <OverviewView screen={screen} periodKey={view.period.key} allSectorsHref={allSectorsHref} />
    </AdminPage>
  );
}
