import { NextResponse } from "next/server";
import { can } from "@/lib/auth/can";
import { getStaffSeat } from "@/lib/auth/staff";
import { auditRows, normaliseAuditFilter } from "@/lib/audit/log";
import { actionLabel } from "@/lib/audit/describe";
import { csvField } from "@/lib/import/csv";
import { t } from "@/lib/i18n";

/**
 * Board 4i `B6` — the log, exportable, carrying the filter it was asked with.
 *
 * Streamed. The log only grows, and a year of it is not a string to assemble in
 * a function's memory before the first byte goes out; `auditRows` walks it a
 * thousand rows at a time and each batch is written as it arrives.
 *
 * Scope is the page's scope. An ops lead exports the whole log; everybody else
 * exports their own rows — `auditRows` applies `auditScopeFor`, and an actor
 * filter from a non-ops viewer is dropped before it reaches the query.
 *
 * UTC timestamps in ISO form, unlike the screen. A file is read by a spreadsheet
 * or a script, and both need an instant they can sort, not a sentence.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HEADER = [
  "at_utc",
  "actor_id",
  "actor",
  "action",
  "action_label",
  "subject",
  "subject_name",
  "blast_radius",
  "blast_unit",
  "reason",
  "before",
  "after",
];

function line(cells: readonly string[]): string {
  return `${cells.map(csvField).join(",")}\r\n`;
}

export async function GET(request: Request) {
  const seat = await getStaffSeat();
  if (!seat || !can(seat.actor, "audit.read")) {
    // 404 rather than 403, as the console's pages do.
    return new NextResponse(null, { status: 404 });
  }

  const params = new URL(request.url).searchParams;
  const filter = normaliseAuditFilter({
    actor: params.get("actor"),
    action: params.get("action"),
    subject: params.get("subject"),
  });
  if (!seat.isOpsLead) delete filter.actorId;

  const encoder = new TextEncoder();
  const rows = auditRows(seat.actor, filter);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // A byte-order mark, so Excel reads the reasons' Arabic and em dashes as
      // UTF-8 rather than as the local code page.
      controller.enqueue(encoder.encode(`﻿${line(HEADER)}`));
    },
    async pull(controller) {
      try {
        const next = await rows.next();
        if (next.done) {
          controller.close();
          return;
        }
        let chunk = "";
        for (const entry of next.value) {
          chunk += line([
            entry.at.toISOString(),
            entry.actorId,
            entry.actorName,
            entry.action,
            actionLabel(entry.action),
            entry.subject,
            entry.subjectName ?? "",
            entry.blastRadius === null ? "" : String(entry.blastRadius),
            entry.blastUnit ?? "",
            entry.reason,
            entry.before === null || entry.before === undefined ? "" : JSON.stringify(entry.before),
            entry.after === null || entry.after === undefined ? "" : JSON.stringify(entry.after),
          ]);
        }
        controller.enqueue(encoder.encode(chunk));
      } catch (cause) {
        console.error("[audit] export failed part-way", {
          cause: cause instanceof Error ? cause.name : "unknown",
        });
        controller.error(cause);
      }
    },
    async cancel() {
      await rows.return(undefined);
    },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  const scope = filter.actorId || filter.action || filter.subject ? "filtered" : "all";
  const filename = t("admin.audit.export_filename", { scope, date: stamp });

  return new NextResponse(stream, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
