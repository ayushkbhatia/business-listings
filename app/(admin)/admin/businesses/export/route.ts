import { NextResponse } from "next/server";
import { getStaffSeat } from "@/lib/auth/staff";
import { hasAnyFilter, normaliseAccountFilter, toQueryString } from "@/lib/accounts/filter";
import { CHURN_RISK_BELOW, SLOW_REPLIES_BELOW, UPGRADE_WINDOW_DAYS } from "@/lib/accounts/health";
import { QUOTED_WINDOW_DAYS, accountRows } from "@/lib/accounts/list";
import { WINDOW_DAYS } from "@/lib/metrics/response-time";
import { csvField } from "@/lib/import/csv";

/**
 * Board 4f `B9` — the accounts, exported, carrying the filter and recording it.
 *
 * The same `accountWhere` as the page, walked to the end rather than paged, and
 * streamed a batch at a time. The file opens with the filter it was asked for,
 * when it was taken, and the definitions its numbers use — a spreadsheet passed
 * round a week later has to be able to say what it is a list of, and "reply
 * rate" means nothing without its window and its thresholds.
 *
 * The metadata rows start with `#` in the first cell, a convention pandas,
 * `csvkit` and most importers skip with one option. The header row follows.
 *
 * Every staff seat that can open the list can export it: the columns are the
 * list's columns, and nothing here is a contact detail.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HEADER = [
  "business_id",
  "display_name",
  "licence_number",
  "emirate",
  "area",
  "state",
  "plan",
  "paying",
  "tier",
  "sells_kind",
  "live_products",
  "live_services",
  "reply_rate",
  "reply_sample",
  "median_reply_minutes",
  `quoted_goods_aed_${QUOTED_WINDOW_DAYS}d`,
  `quotes_${QUOTED_WINDOW_DAYS}d`,
  `proposals_${QUOTED_WINDOW_DAYS}d`,
  "upgrade_signal",
  "upgrade_signal_at_utc",
  "claimed_since_utc",
] as const;

function line(cells: readonly (string | number | null)[]): string {
  return `${cells.map((cell) => csvField(cell === null ? "" : String(cell))).join(",")}\r\n`;
}

export async function GET(request: Request) {
  const seat = await getStaffSeat();
  if (!seat) return new NextResponse(null, { status: 404 });

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const filter = normaliseAccountFilter(params);
  const now = new Date();
  const query = toQueryString(filter);
  const encoder = new TextEncoder();
  const rows = accountRows(filter, now);

  const preamble = [
    line(["# filter", query === "" ? "none" : query]),
    line(["# exported_at_utc", now.toISOString()]),
    line([
      "# definitions",
      `reply_rate: answered over counted, enquiries delivered in the last ${WINDOW_DAYS} days, an unanswered enquiry counted once its window closed; ` +
        `churn_risk: paying and reply_rate under ${CHURN_RISK_BELOW}; slow_replies: reply_rate under ${SLOW_REPLIES_BELOW}; ` +
        `upgrade_candidate: on basic with a plan-cap refusal or an enquiry missed at the monthly cap in the last ${UPGRADE_WINDOW_DAYS} days; ` +
        `quoted: latest sent revision per enquiry in the last ${QUOTED_WINDOW_DAYS} days, goods lines summed, proposals counted`,
    ]),
    line(HEADER),
  ].join("");

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`﻿${preamble}`));
    },
    async pull(controller) {
      try {
        const next = await rows.next();
        if (next.done) {
          controller.close();
          return;
        }
        let chunk = "";
        for (const row of next.value) {
          chunk += line([
            row.id,
            row.displayName,
            row.licenceNumber,
            row.emirate,
            row.areaName,
            row.state,
            row.planId,
            row.paying ? "yes" : "no",
            row.tier,
            row.sellsKind,
            row.liveProducts,
            row.liveServices,
            row.replyRate === null ? null : row.replyRate.toFixed(4),
            row.replySample,
            row.medianMs === null ? null : Math.round(row.medianMs / 60_000),
            row.quoted.goodsAed,
            row.quoted.quotes,
            row.quoted.proposals,
            row.upgradeSignal?.kind ?? null,
            row.upgradeSignal ? row.upgradeSignal.at.toISOString() : null,
            row.claimedSince ? row.claimedSince.toISOString() : null,
          ]);
        }
        controller.enqueue(encoder.encode(chunk));
      } catch (cause) {
        console.error("[accounts] export failed part-way", {
          cause: cause instanceof Error ? cause.name : "unknown",
        });
        controller.error(cause);
      }
    },
    async cancel() {
      await rows.return(undefined);
    },
  });

  const stamp = now.toISOString().slice(0, 10);
  return new NextResponse(stream, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="businesses-${hasAnyFilter(filter) ? "filtered" : "all"}-${stamp}.csv"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
