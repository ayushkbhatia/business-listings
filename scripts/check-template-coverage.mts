/**
 * Task T6.7 — an emitted event with no live template on a channel it routes to
 * by default fails the build.
 *
 * ## The shape this catches
 *
 * `notify()` records `no_live_template` and carries on, which is the right
 * behaviour at runtime — a WhatsApp body waiting on Meta must not stop the
 * email going out. The cost is that the gap is **invisible until somebody
 * reads board 12g**: production held 15 templates against a catalogue of 27 on
 * 14 Sep 2026, and `enquiry_escalated` had skipped its in-app delivery 22 times
 * for want of one. Nothing failed. Nobody was told. A seller was simply not
 * notified twenty-two times.
 *
 * The runtime cannot fail on this and the build can, so the build does.
 *
 * The rule itself is `coverageGrid` in `lib/notify/coverage.ts` (T7.1), shared
 * with board 12g's grid so the console and the build name the same gaps.
 *
 * ## What "routes to by default" means
 *
 * Not every channel: a seller may switch WhatsApp off and that is their
 * business. The channels that have to exist are the ones a recipient gets
 * **without choosing anything** —
 *
 *   · a seller: `DEFAULT_ROUTING` plus `PLATFORM_FLOOR`, which is what a
 *     business with no stored preference receives (T6.1) and what the floor
 *     sends whatever the matrix says;
 *   · a buyer or a claimant: `BUYER_DEFAULT`, since neither holds a matrix.
 *
 * A channel a seller must opt into is checked by nothing here, deliberately:
 * `pending_meta` is a real state and a build that refused it would stop the
 * product shipping until a third party answered an email.
 *
 * ## Against the catalogue, not the database
 *
 * `prisma/seed-notification-templates.mts` is the committed intent, and
 * `tests/unit/notification-templates.test.ts` already holds it equal to the
 * backfill migrations — so a catalogue this check passes is a production that
 * has the rows once its migration runs. A check against a database would pass
 * or fail on which environment it ran in, which is not a property of the code.
 */
import { coverageGrid, type CoverageInput } from "../lib/notify/coverage.js";
import type { NotificationChannel, NotificationEvent } from "../lib/notify/routing.js";
import type { PrimaryState } from "../lib/notify/template-lines.js";
import { TEMPLATES } from "../prisma/seed-notification-templates.mjs";

/*
   The catalogue as `coverageGrid` reads it. The rule for what is a gap lives in
   `lib/notify/coverage.ts` once (T7.1), so board 12g's grid and this check
   cannot disagree about which cells are silent — they differ only in reading
   the database or the committed intent.

   Primary line only: a services twin replaces the goods wording for a services
   brief and sends nothing on its own, so a pair whose only live body is a twin
   is a pair a goods seller is never sent.
*/
const STATUS_RANK: Record<string, PrimaryState> = { live: "live", pending_meta: "in_review", draft: "draft", rejected: "rejected" };
const pairs = new Map<string, CoverageInput>();
for (const template of TEMPLATES) {
  if (template.kind === "services") continue;
  const state = STATUS_RANK[template.status ?? "live"];
  if (!state) continue;
  const k = `${template.event}.${template.channel}`;
  const held = pairs.get(k);
  const order: PrimaryState[] = ["live", "in_review", "rejected", "draft"];
  if (held && order.indexOf(held.state) <= order.indexOf(state)) continue;
  pairs.set(k, {
    event: template.event as NotificationEvent,
    channel: template.channel as NotificationChannel,
    state,
    liveVersion: state === "live" ? 1 : null,
    pendingVersion: state === "in_review" ? 1 : null,
  });
}

const grid = coverageGrid([...pairs.values()]);
const emitted = grid.rows.filter((row) => row.emitted);
const silent = grid.rows.filter((row) => row.silentCells > 0);
const pending = grid.rows.flatMap((row) =>
  row.cells.filter((cell) => cell.byDefault && cell.state === "with_meta").map((cell) => `${cell.event} on ${cell.channel}`),
);
const liveBodies = grid.rows.reduce((sum, row) => sum + row.cells.filter((cell) => cell.state === "live").length, 0);

console.log("→ an emitted event has a live template on every channel it routes to by default");
console.log(
  `   ${String(emitted.length)} emitted event(s), ${String(grid.defaultRoutes)} default route(s) checked, ` +
    `${String(liveBodies)} live body/bodies in the catalogue`,
);

/*
   Named rather than counted. "3 events are missing templates" sends somebody to
   read two files; the event and the channel is the whole of what they need.
*/
if (silent.length > 0) {
  for (const row of silent) {
    const channels = row.cells.filter((cell) => cell.silent).map((cell) => cell.channel);
    console.log(`   FAIL — ${row.event} has no live template on ${channels.join(", ")}`);
  }
  console.log(
    "   A recipient gets these without choosing anything, so a missing body is a message " +
      "nobody receives and nothing reports. Add it to prisma/seed-notification-templates.mts " +
      "and to a migration beside it.",
  );
  process.exit(1);
}

/*
   An event nothing emits is not checked, and the number is printed so the
   silence is a measurement rather than an omission — board 12g's grid says the
   same thing with the words "nothing sends this yet".
*/
console.log(`   note  ${String(grid.dormantEvents)} declared event(s) that nothing emits yet`);
if (pending.length > 0) {
  console.log(`   note  ${String(pending.length)} written and waiting on Meta: ${pending.join(", ")}`);
}
process.exit(0);
