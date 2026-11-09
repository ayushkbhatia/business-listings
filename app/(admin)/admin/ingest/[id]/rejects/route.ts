import { NextResponse } from "next/server";
import { can } from "@/lib/auth/can";
import { getStaffSeat } from "@/lib/auth/staff";
import { rejectsCsv } from "@/lib/ingest/read";
import { t } from "@/lib/i18n";

/**
 * Board 12a — "Export rejects". Criterion 3: rejection reasons come from a
 * closed enum and export with the raw row.
 *
 * A route rather than a server action, because the browser has to save a file
 * and an action cannot set `Content-Disposition`. The capability is checked
 * here as well as on the screen — a route handler is a URL, and a URL somebody
 * can paste is a URL somebody will paste. 404 rather than 403, as the console's
 * pages do.
 */
/*
   T4.6. The rejects of a 41,000-row run are tens of thousands of rows, each
   carrying its whole raw record (B5) — so this is the longest read in the
   console that is not an action, and it declared no duration at all. The two
   other exports in `/admin` ask for sixty seconds; this one can be a register.
*/
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const seat = await getStaffSeat();
  if (!seat || !can(seat.actor, "queue.decide")) return new NextResponse(null, { status: 404 });

  const { id } = await params;
  const file = await rejectsCsv(id, {
    ground: (ground) => t(`admin.run.ground.${ground}`),
    action: (action) => t(`admin.run.action.${action}`),
    headers: [
      t("admin.records.col.row"),
      t("admin.run.col.code"),
      t("admin.run.col.reason"),
      t("admin.run.col.action"),
    ],
  });
  if (!file) return new NextResponse(null, { status: 404 });

  return new NextResponse(file.body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${file.filename}"`,
      "cache-control": "no-store",
    },
  });
}
