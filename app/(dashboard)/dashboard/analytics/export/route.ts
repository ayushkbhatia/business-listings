import { NextResponse } from "next/server";
import { analyticsSummary } from "@/lib/analytics/summary";
import { toCsv } from "@/lib/import/csv";
import { mayReadAnalytics } from "@/lib/auth/guards";
import { effectiveFor } from "@/lib/billing/entitlements-service";
import { formatDateShort } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getSellerSeat } from "../../_shell";

/**
 * The four tables on the page, as one CSV.
 *
 * Board `3l`, spec Q5: **the aggregates shown, not raw events.** The button on
 * the board said `Export CSV` with no scope at all, which left a seller to
 * guess whether they were about to download five rows or five hundred thousand.
 * It says what it writes now, and this writes exactly that.
 *
 * Raw events are a support tool rather than a seller feature. They are also the
 * one thing on this page that is not the seller's alone: `search_impression_day`
 * holds phrases typed by buyers, and handing a seller the unaggregated stream
 * would be exporting other people's behaviour rather than their own numbers.
 *
 * ## One file, four tables, stated section by section
 *
 * A CSV has one header row and this has four, so each is preceded by a section
 * line. The alternative — four files in a zip — is a download a seller opens
 * once and a support request the first time one of them is missing.
 *
 * Every figure is the one on screen. It re-reads through `analyticsSummary`
 * rather than recomputing, so the file and the page cannot disagree: two
 * readers of one window is exactly how an export comes to say something the
 * screen never showed.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const seat = await getSellerSeat();
  if (!seat) return new NextResponse(null, { status: 404 });
  // The same two gates the page applies, in the same order. A route handler is
  // exactly the URL a nav-level check would miss.
  if (!mayReadAnalytics(seat.actor)) return new NextResponse(null, { status: 404 });

  const caps = await effectiveFor(seat.businessId);
  if (caps && !caps.analytics) return new NextResponse(null, { status: 404 });

  const summary = await analyticsSummary(seat.actor, seat.businessId);
  if (!summary) return new NextResponse(null, { status: 404 });

  const window = `${formatDateShort(summary.window.from)} to ${formatDateShort(summary.window.to)}`;
  const rows: string[][] = [];

  const section = (title: string, header: readonly string[]) => {
    if (rows.length > 0) rows.push([]);
    rows.push([title]);
    rows.push([...header]);
  };

  /*
     A delta is written as the number and its unit, never as a bare figure.

     `1.4` in a column beside `14.7%` is ambiguous in exactly the way the board
     corrected on screen — points and percent are not interchangeable, and a
     spreadsheet strips the colour that might otherwise have hinted.
  */
  const delta = (value: (typeof summary.stages)[number]["delta"]): string => {
    switch (value.kind) {
      case "none":
        return "no comparison yet";
      case "count":
        return String(value.value);
      case "percent":
        return `${value.value.toFixed(1)}%`;
      case "points":
        return `${value.value.toFixed(1)}pt`;
      case "places":
        return `${value.value > 0 ? "down " : value.value < 0 ? "up " : ""}${Math.abs(value.value)} places`;
      default:
        return "";
    }
  };

  const rate = (value: number | null) => (value === null ? "" : `${(value * 100).toFixed(1)}%`);

  section(`Where buyers drop off (${window})`, [
    "Stage",
    "Count",
    "Carried from the stage above",
    "Change",
  ]);
  for (const stage of summary.stages) {
    rows.push([
      // The label the screen shows, not the key it groups by. A seller opening
      // this in a spreadsheet is reading the page they exported, and
      // `product_views` is a column name rather than a stage.
      t(`analytics.stage.${stage.key}` as "analytics.stage.clicks"),
      String(stage.count),
      rate(stage.carried),
      delta(stage.delta),
    ]);
  }

  section("What buyers searched to reach you", ["Query", "Impressions", "Position", "Movement"]);
  for (const row of summary.queries) {
    rows.push([
      row.query,
      String(row.volume),
      row.position === null ? "not ranked" : String(row.position),
      delta(row.movement),
    ]);
  }

  section("Top products by enquiry", [
    "Product",
    "Views",
    "Enquiries",
    "Conversion",
    "Change",
    "Flags",
  ]);
  for (const row of summary.products) {
    const flags = [
      row.noCoverPhoto ? "no cover photo" : "",
      row.outOfStockDays === null ? "" : `out of stock ${row.outOfStockDays} days`,
    ]
      .filter(Boolean)
      .join("; ");
    rows.push([
      row.name,
      String(row.views),
      String(row.enquiries),
      rate(row.conversion),
      delta(row.delta),
      flags,
    ]);
  }

  section("Where enquiries come from", ["Region", "Enquiries", "Share", "Change"]);
  for (const row of summary.regions) {
    rows.push([
      row.key === "not_stated"
        ? t("analytics.regions.not_stated")
        : t(`emirate.${row.key}` as "emirate.dubai"),
      String(row.count),
      rate(row.share),
      delta(row.delta),
    ]);
  }

  const filename = `analytics-${summary.window.from.toISOString().slice(0, 10)}.csv`;

  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // A seller's own figures, and a shared cache holding them would be a leak.
      "Cache-Control": "private, no-store",
    },
  });
}
