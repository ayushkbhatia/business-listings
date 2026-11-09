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
import { EVENT_AUDIENCE, isEmitted } from "../lib/notify/params.js";
import { BUYER_DEFAULT, DEFAULT_ROUTING, PLATFORM_FLOOR } from "../lib/notify/routing.js";
import type { NotificationChannel, NotificationEvent } from "../lib/notify/routing.js";
import { TEMPLATES } from "../prisma/seed-notification-templates.mjs";

/** Every (event, channel) the catalogue has a **live** body for. */
const live = new Set(
  TEMPLATES.filter((template) => template.status === "live").map(
    (template) => `${template.event}:${template.channel}`,
  ),
);

/**
 * WhatsApp bodies written and waiting on Meta.
 *
 * `pending_meta` is a real state and somebody else's queue: a WhatsApp template
 * cannot change version without Meta approving it, so a build that refused one
 * would stop the product shipping until a third party answered an email. The
 * body exists, the gap is theirs, and `notify` already records
 * `no_live_template` against each send — so this is reported as a note rather
 * than a failure.
 *
 * Only WhatsApp. A `pending_meta` email or in-app body would be a body somebody
 * wrote and never published, which is a gap of ours.
 */
const waitingOnMeta = new Set(
  TEMPLATES.filter(
    (template) => template.channel === "whatsapp" && template.status === "pending_meta",
  ).map((template) => `${template.event}:${template.channel}`),
);

/** The channels this event reaches without the recipient choosing anything. */
function defaultChannels(event: NotificationEvent): NotificationChannel[] {
  const audience = EVENT_AUDIENCE[event];
  const chosen =
    audience === "seller"
      ? [...(DEFAULT_ROUTING.matrix[event] ?? []), ...(PLATFORM_FLOOR[event] ?? [])]
      : [...(BUYER_DEFAULT.matrix[event] ?? [])];
  return [...new Set(chosen)];
}

const emitted = (Object.keys(EVENT_AUDIENCE) as NotificationEvent[]).filter(isEmitted).sort();

const missing: { event: NotificationEvent; channels: NotificationChannel[] }[] = [];
const pending: string[] = [];
let checked = 0;

for (const event of emitted) {
  const channels = defaultChannels(event);
  checked += channels.length;
  const gaps: NotificationChannel[] = [];
  for (const channel of channels) {
    if (live.has(`${event}:${channel}`)) continue;
    if (waitingOnMeta.has(`${event}:${channel}`)) {
      pending.push(`${event} on ${channel}`);
      continue;
    }
    gaps.push(channel);
  }
  if (gaps.length > 0) missing.push({ event, channels: gaps });
}

console.log("→ an emitted event has a live template on every channel it routes to by default");
console.log(
  `   ${String(emitted.length)} emitted event(s), ${String(checked)} default route(s) checked, ` +
    `${String(live.size)} live body/bodies in the catalogue`,
);

/*
   Named rather than counted. "3 events are missing templates" sends somebody to
   read two files; the event and the channel is the whole of what they need.
*/
if (missing.length > 0) {
  for (const row of missing) {
    console.log(`   FAIL — ${row.event} has no live template on ${row.channels.join(", ")}`);
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
   silence is a measurement rather than an omission — board 12g's screen says
   the same thing with the words "nothing sends this yet".
*/
const declared = (Object.keys(EVENT_AUDIENCE) as NotificationEvent[]).length;
console.log(`   note  ${String(declared - emitted.length)} declared event(s) that nothing emits yet`);
if (pending.length > 0) {
  console.log(`   note  ${String(pending.length)} written and waiting on Meta: ${pending.join(", ")}`);
}
process.exit(0);
