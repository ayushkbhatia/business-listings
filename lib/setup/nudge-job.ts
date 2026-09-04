import "server-only";
import { prisma } from "@/lib/db/client";
import { onSetupUnfinished } from "@/lib/notify/events";
import { setupStateFor, type Task } from "@/lib/onboarding/service";

/**
 * The one nudge board 8a promises, and the promise is the hard part.
 *
 * `setup.reminder.body` says it out loud on the hub: *"One WhatsApp three days
 * after you went live if anything is still open, then nothing. We do not
 * chase."* A panel that makes a promise on a job's behalf is a panel the job
 * has to keep, so most of this file is about not sending a second one.
 *
 * ## Exactly once, ever — and how
 *
 * `notify()` never reads `NotificationDelivery` before it writes one. There is
 * no dedupe anywhere in that layer and there should not be: every other event
 * in the product is meant to fire again next time it happens. So the guard is
 * this job's, and of the three idioms the codebase already uses — a claim
 * column, a status transition, and the restated `updateMany` where a count of
 * zero means another pass got there first — none is available, because the
 * nudge changes no state of its own. What is available is the log: a
 * `NotificationDelivery` row for `(setup_nudge, businessId)` means this
 * business has had its nudge, and `@@index([event, businessId, createdAt])`
 * exists on exactly that shape. One query covers the whole batch.
 *
 * `notify` writes a row for every outcome including a skip and its reason — no
 * live WhatsApp template, no carrier, quiet hours — so "we ran the nudge for
 * this business" is recorded even when nothing left the building. That is the
 * right guard for the promise being made: board 8a says one attempt and then
 * nothing, not one delivery and then nothing.
 *
 * It is also the fact the hub itself reads. `setupHubState` derives `nudgeUsed`
 * from `findFirst({ businessId, event: "setup_nudge" })` — the same row, for the
 * same reason — so the panel that says *"Sent on 4 September. That was the only
 * one."* and the job that decides whether to send are reading one fact rather
 * than two that can drift.
 *
 * **It is a check-then-act, and that is accepted here rather than overlooked.**
 * Two passes overlapping between the read and `notify`'s write would send twice.
 * The only caller is the daily cron; `runSteps` is sequential and Vercel does
 * not run two invocations of one schedule at once, so the window needs a second
 * cron or a hand-run of the route inside the same second. The cost of losing
 * that race is one extra WhatsApp to one supplier, not a loop: the row written
 * by whichever pass got there closes it for good. Making it airtight means a
 * `Business.setupNudgedAt` claimed with the restated `updateMany` this codebase
 * already uses — `count === 0` meaning another pass got there — and that is a
 * migration plus a second place the hub would have to read the same fact from.
 * Heavier than the risk, and listed as a follow-up rather than done quietly.
 *
 * ## Where the window comes from
 *
 * Both edges are load-bearing. The lower one is the board's 72 hours. The upper
 * one is what stops the first run after deploy nudging every supplier who ever
 * signed up — a listing published in March is not owed a reminder about a
 * screen it has been ignoring since, and sending one would break the promise in
 * the other direction. Seven days leaves four clear days of slack over the
 * 72-hour mark, so a supplier who crosses it during a cron outage is still
 * reminded, late, rather than never; four consecutive missed daily runs is an
 * outage somebody has already been paged about.
 *
 * ## What time it actually arrives
 *
 * The daily cron is scheduled for 20:23 UTC, which is 00:23 in Dubai and inside
 * the quiet window every seller has by default. So the WhatsApp is normally
 * deferred at the moment it is raised and released by the hourly sweep at 07:00
 * — which is when a reminder about an afternoon's work should land anyway. The
 * in-app row is written straight away, because in-app is never an interruption.
 *
 * Nothing here compensates for that, and nothing should: a deferred delivery is
 * still this listing's one nudge. `setupHubState` counts the row rather than the
 * send for exactly this reason, so the panel does not promise a second one while
 * the first is sitting in the queue.
 *
 * ## What it will not do
 *
 * It writes no audit row, for the reason `verification/expiry-job.ts` and
 * `billing/dunning-job.ts` both set out and CLAUDE.md accepts: `AuditEvent`
 * records decisions and its `actorId` is NOT NULL, and a platform following its
 * own published sequence on a schedule has no actor to attribute. The delivery
 * rows are the record.
 *
 * It never throws out of the sweep. One supplier whose row went missing between
 * the select and the read must not stop the other nineteen being reminded.
 */

/** Board 8a. Three days after go-live, not two and not four. */
export const NUDGE_AFTER_HOURS = 72;

/**
 * How far back the sweep will look.
 *
 * See the window note above: this is the edge that stops a deploy nudging the
 * back catalogue.
 */
export const NUDGE_WINDOW_DAYS = 7;

/**
 * A ceiling on one pass.
 *
 * The window is four days wide, so this is only reached by a launch day or a
 * migration that published a batch of listings at once. Anything over the limit
 * is still inside the window tomorrow and gets picked up then — a day late for
 * a message about a screen that has been waiting three, which beats a run that
 * walks ten thousand listings inside one cron invocation.
 *
 * Oldest first, so a capped pass serves the ones closest to falling out of the
 * window rather than the ones with days of slack left.
 */
const BATCH_LIMIT = 200;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface SetupNudgeSweepResult {
  /** Unsuspended listings inside the window. */
  considered: number;
  /**
   * Handed to the emitter this pass.
   *
   * Not "messages sent". What actually reached a handset is on the delivery
   * rows, and a seller who has WhatsApp switched off for alerts is counted here
   * and reached by nothing — which is what the hub already tells them.
   */
  nudged: number;
  /** Already had their one, on some earlier pass. */
  alreadyNudged: number;
  /** Every task done. Nothing to nudge about. */
  nothingOpen: number;
  /** Open question 4: only the site visit is left, so it is suppressed. */
  visitOnly: number;
  /** Threw, and the sweep carried on. */
  failed: number;
  ranAt: Date;
}

/**
 * The tasks a nudge may be about.
 *
 * Board 8a's open question 4 asks whether the nudge should fire when only the
 * site visit is left, and answers no: that task waits on our scheduling rather
 * than on the seller, and chasing somebody for our own backlog is the kind of
 * message that teaches people to mute a channel.
 *
 * So the visit is dropped from the list rather than special-cased at the end.
 * One rule covers both "nothing is open" and "only the visit is open", and it
 * also keeps the message honest: what the seller reads is work they can go and
 * finish tonight, and the estimate it quotes is the estimate for that work.
 */
function isOpenAndTheirs(row: { task: Task; done: boolean }): boolean {
  return !row.done && row.task !== "visit";
}

export async function sweepSetupNudges(
  now: Date = new Date(),
): Promise<SetupNudgeSweepResult> {
  const result: SetupNudgeSweepResult = {
    considered: 0,
    nudged: 0,
    alreadyNudged: 0,
    nothingOpen: 0,
    visitOnly: 0,
    failed: 0,
    ranAt: now,
  };

  const candidates = await prisma.business.findMany({
    where: {
      publishedAt: {
        lte: new Date(now.getTime() - NUDGE_AFTER_HOURS * HOUR),
        gt: new Date(now.getTime() - NUDGE_WINDOW_DAYS * DAY),
      },
      // A suspended listing is off the directory, so finishing these tasks
      // would reach no buyer. The hub says the same thing to the seller's face
      // rather than offering them work with no audience.
      suspendedAt: null,
    },
    select: { id: true },
    orderBy: { publishedAt: "asc" },
    take: BATCH_LIMIT,
  });

  result.considered = candidates.length;
  if (candidates.length === 0) return result;

  /*
     The guard, in one query for the whole batch rather than one per business.

     `distinct` on the business rather than a row each: a seller routing the
     nudge to WhatsApp and in-app has two rows for one nudge, and both mean the
     same thing here.
  */
  const nudgedAlready = new Set(
    (
      await prisma.notificationDelivery.findMany({
        where: { event: "setup_nudge", businessId: { in: candidates.map((b) => b.id) } },
        select: { businessId: true },
        distinct: ["businessId"],
      })
    ).map((row) => row.businessId),
  );

  /*
     One business at a time, and `setupStateFor` is five queries each.

     Affordable because of the window, not by luck: only listings that crossed
     72 hours in the last four days are here, which at any plausible signup rate
     is a handful. The batch alternative — group-bys over media, products, seats
     and visits — would be a second implementation of "is this task finished",
     and two answers to that question is the drift `lib/setup/tasks.ts` was
     careful to avoid. If the batch ever gets big enough to matter, the fix is a
     shared batched reader, not a copy of the rule.
  */
  for (const business of candidates) {
    if (nudgedAlready.has(business.id)) {
      result.alreadyNudged += 1;
      continue;
    }

    try {
      /*
         `setupStateFor` rather than `setupHubState`, though both exist.

         The hub's reader also fetches entitlements, the enquiry lift, view days
         and shortlist counts — everything board 8a renders — and none of that
         decides whether a nudge is owed. It also takes the cached lift by
         default, which needs a request context this job may not have. The four
         task rows are what matters here, and `lib/setup/tasks.ts` says in its
         own comment that its targets and estimates are the ones this module
         publishes, so the two cannot disagree about what is finished.
      */
      const state = await setupStateFor(business.id);
      const open = state.tasks.filter(isOpenAndTheirs);

      if (open.length === 0) {
        const anyOpen = state.tasks.some((task) => !task.done);
        if (anyOpen) result.visitOnly += 1;
        else result.nothingOpen += 1;
        continue;
      }

      /*
         `onSetupUnfinished` swallows its own errors, like every emitter, so a
         carrier being down is not a failure of this sweep. It also writes
         nothing when the business has no `NotificationPreference` row or does
         not route this event, which leaves the guard untripped and this
         business considered again tomorrow — deliberately. A seller who turns
         the nudge on during their first week still gets their one reminder,
         and the window closes the loop a few days later either way.
      */
      await onSetupUnfinished({
        businessId: business.id,
        openTasks: open.map((task) => task.task),
        // Added up from the rows themselves rather than from a table of my own:
        // the message quotes the estimate the cards quote.
        minutes: open.reduce((total, task) => total + task.minutes, 0),
      });
      result.nudged += 1;
    } catch (cause) {
      // One supplier must not stop the sweep. A business deleted between the
      // select and the read is the ordinary case; `setupStateFor` throws on it.
      result.failed += 1;
      console.error("[setup] nudge failed for one business", { businessId: business.id, cause });
    }
  }

  return result;
}
