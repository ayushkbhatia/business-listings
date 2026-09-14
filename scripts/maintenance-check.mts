import { readFileSync, writeFileSync } from "node:fs";
import { describeScope } from "../lib/maintenance/decide";
import { renderMaintenanceDocument } from "../lib/maintenance/document";
import { phaseAt, plannedMinutes, parseWindow, retryAfterSeconds, trustHolds, viewAt } from "../lib/maintenance/window";
import { formatDateTime } from "../lib/format/date";
import { formatPhone } from "../lib/format/phone";

/**
 * Read a maintenance window record back before the window, not during it.
 *
 * Board 13e open question 2: no admin screen owns the record yet (`12h` will).
 * Until it does, somebody writes JSON — into the Global Config store or into
 * `MAINTENANCE_WINDOW` — and the proxy fails open on a record it cannot read,
 * so a typo is a window that silently never starts. This is the check that
 * makes the typo loud at a desk.
 *
 *   pnpm maintenance:check window.json
 *   pnpm maintenance:check --env                       reads MAINTENANCE_WINDOW
 *   pnpm maintenance:check window.json --at 2026-09-20T02:30:00+04:00
 *   pnpm maintenance:check window.json --html preview.html
 *
 * Prints what the page will say, what it takes down, and the one-line JSON to
 * paste into the store. Exits 1 on a record the proxy would refuse.
 */

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

const fromEnv = args.includes("--env");
const file = args.find((a, i) => !a.startsWith("--") && !["--at", "--html"].includes(args[i - 1] ?? ""));

if (!fromEnv && !file) {
  console.error("usage: pnpm maintenance:check <record.json> | --env  [--at <iso time>] [--html <out.html>]");
  process.exit(2);
}

const raw = fromEnv ? (process.env.MAINTENANCE_WINDOW ?? "") : readFileSync(file!, "utf8");
const result = parseWindow(raw);

if (!result.ok) {
  console.error("✗ The proxy would refuse this record and serve the site as normal:\n");
  for (const error of result.errors) console.error(`  · ${error}`);
  process.exit(1);
}

const { window } = result;
const at = flag("--at");
const now = at ? new Date(at) : new Date();
if (Number.isNaN(now.getTime())) {
  console.error(`--at is an ISO time with its zone, for example 2026-09-20T02:30:00+04:00. Received: ${at}`);
  process.exit(2);
}

const phase = phaseAt(window, now);
const view = viewAt(window, phase === "upcoming" ? window.startsAt : now);
const gst = (d: Date) => `${formatDateTime(d)} GST`;

console.log(`✓ ${window.id} — work on ${window.work.replace("_", " ")}\n`);
console.log(`  starts      ${gst(window.startsAt)}`);
console.log(`  ends        ${gst(window.endsAt)}  (${plannedMinutes(window)} minutes)`);
console.log(`  at ${gst(now)}: ${phase}${phase === "lapsed" ? " — past the two-hour grace, treated as lifted" : ""}`);
if (phase === "active" || phase === "overrun") console.log(`  Retry-After ${retryAfterSeconds(window, now)}s`);
console.log(`\n  takes down`);
for (const line of describeScope(window)) console.log(`    ${line}`);
console.log(`\n  rows`);
for (const row of window.affected) console.log(`    ${row.state.toUpperCase().padEnd(8)} ${row.system}`);
console.log(`\n  trust sentence  ${trustHolds(window) ? "shown" : "removed — quotes and notifications are not both running"}`);
console.log(`  WhatsApp        ${window.whatsapp ? `${formatPhone(window.whatsapp)} — confirm it is staffed for the whole window` : "none — no contact card"}`);
console.log(`\n  paste into Global Config key "maintenance", or MAINTENANCE_WINDOW:`);
console.log(
  `  ${JSON.stringify({
    id: window.id,
    work: window.work,
    startsAt: window.startsAt.toISOString(),
    endsAt: window.endsAt.toISOString(),
    affected: window.affected,
    ...(window.whatsapp ? { whatsapp: window.whatsapp } : {}),
  })}`,
);

const html = flag("--html");
if (html) {
  writeFileSync(html, renderMaintenanceDocument(view));
  console.log(`\n  wrote ${html} — open it with the dev server running, so /maintenance/*.css resolves`);
}
