import { DROP_TO_FREE_DAY, SCHEDULE, type DunningStage } from "./dunning";

/**
 * The failed-payment sequence as five dated steps, with what each one did —
 * tasks T9.2 and T9.4, prompts P-05 and P-07.
 *
 * ## One model, two readers
 *
 * Board 3m shows a seller the rail: what has happened to their account and what
 * happens next. Board 12i shows staff the same five steps per account and a
 * `Last notice` column. They answer one question — *did we tell them?* — and if
 * they read it two ways, a seller and the person they ring will disagree about
 * whether an email went out. So both are built from this function.
 *
 * ## Dates from the schedule, results from the delivery log
 *
 * Every date is `pastDueSince` plus a `SCHEDULE` day — the constants the job
 * acts on (spec S3: *"Every date on the rail equals the date the job will act
 * on"*). Every result is a `NotificationDelivery` row. A step whose stage has
 * passed but which has no row says so; it is never drawn as sent. That is the
 * rule the old banner broke: it told sellers to reply to an email that, until
 * S6, nothing sent.
 *
 * Pure. The caller reads the rows; the rule lives here once.
 */

const DAY_MS = 86_400_000;

export type RailStepKey = "card" | "first_notice" | "second_notice" | "final_notice" | "drop";

/** One delivery row, as far as the rail needs it. */
export interface RailDelivery {
  event: "payment_failed" | "payment_final_notice";
  channel: string;
  status: "queued" | "deferred" | "sent" | "failed" | "skipped";
  reason: string | null;
  createdAt: Date;
  sentAt: Date | null;
  scheduledFor: Date | null;
  /** Who it was for, by name. Never an address — the log does not keep one. */
  recipientName: string | null;
}

/**
 * What a notice step achieved, across every channel it tried.
 *
 * P-07's badge set. `delivered` wins over everything: an email that arrived is
 * a seller who was told, whatever WhatsApp did.
 */
export type NoticeResult = "delivered" | "deferred" | "pending" | "failed" | "no_template" | "skipped";

export type RailStepState =
  /** The schedule has reached this step and the job acted. */
  | "done"
  /** Not yet. */
  | "upcoming"
  /** The seller cancelled before this step, so it will not run. T9.1. */
  | "not_after_cancel";

export interface RailStep {
  key: RailStepKey;
  /** Days from the first failure. */
  day: number;
  /** When the job acts, or acted. */
  at: Date;
  state: RailStepState;
  /** Card step only: whether a charge was actually attempted. False with no gateway. */
  retried: boolean;
  /** Notice steps only: every row the step wrote, every channel. */
  deliveries: RailDelivery[];
  /** Notice steps only, once done. Null for the card and the drop. */
  result: NoticeResult | null;
  /** The channels that reached the seller, in the order they did. */
  deliveredOn: string[];
  /** Why nothing arrived, where nothing did — the first reason recorded. */
  failureReason: string | null;
  recipientName: string | null;
}

export interface Rail {
  steps: RailStep[];
  dropsOn: Date;
  /** The newest notice step that has run, for 12i's `Last notice` column. */
  lastNotice: RailStep | null;
  /** True where at least one notice has reached somebody. */
  anyDelivered: boolean;
}

export interface RailInput {
  pastDueSince: Date;
  stage: DunningStage;
  /** Whether a charge was attempted in this episode — a `PaymentAttempt` row. */
  attempted: boolean;
  /** When the seller cancelled, if they did while past due. */
  cancelledAt: Date | null;
  /** `payment_failed` and `payment_final_notice` rows written since `pastDueSince`. */
  deliveries: readonly RailDelivery[];
}

const STAGE_ORDER: readonly DunningStage[] = ["none", "retry", "emailed", "messaged", "final", "dropped"];

/** The stage at which each step counts as done. */
const DONE_AT: Record<RailStepKey, DunningStage> = {
  card: "retry",
  first_notice: "emailed",
  second_notice: "messaged",
  final_notice: "final",
  drop: "dropped",
};

const DAY_OF: Record<RailStepKey, number> = {
  card: SCHEDULE.retry,
  first_notice: SCHEDULE.emailed,
  second_notice: SCHEDULE.messaged,
  final_notice: SCHEDULE.final,
  drop: DROP_TO_FREE_DAY,
};

const RESULT_RANK: readonly NoticeResult[] = ["delivered", "deferred", "pending", "failed", "no_template", "skipped"];

function resultOf(delivery: RailDelivery): NoticeResult {
  if (delivery.status === "sent") return "delivered";
  if (delivery.status === "deferred") return "deferred";
  if (delivery.status === "queued") return "pending";
  if (delivery.status === "failed") return "failed";
  if (delivery.reason === "no_live_template" || delivery.reason === "no_template") return "no_template";
  return "skipped";
}

/**
 * The two `payment_failed` sends, told apart.
 *
 * Day 3 and day 7 both emit `payment_failed`, so the event cannot say which
 * step a row belongs to. Nor can the date alone: a run that is late does one
 * step per day, so a day-3 notice sent on day 8 is still the first notice. So
 * rows are grouped into sends — one `notify()` call writes one row per channel
 * within moments of each other — and the sends are taken in order.
 */
function splitSends(rows: readonly RailDelivery[]): RailDelivery[][] {
  const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const sends: RailDelivery[][] = [];
  for (const row of sorted) {
    const last = sends.at(-1);
    const anchor = last?.[0];
    if (last && anchor && row.createdAt.getTime() - anchor.createdAt.getTime() < 60 * 60_000) last.push(row);
    else sends.push([row]);
  }
  return sends;
}

export function dunningRail(input: RailInput): Rail {
  const { pastDueSince, stage, cancelledAt } = input;
  const reached = STAGE_ORDER.indexOf(stage);
  const failedSends = splitSends(input.deliveries.filter((d) => d.event === "payment_failed"));
  const finalRows = input.deliveries.filter((d) => d.event === "payment_final_notice");
  const rowsFor: Record<RailStepKey, RailDelivery[]> = {
    card: [],
    first_notice: failedSends[0] ?? [],
    second_notice: failedSends[1] ?? [],
    final_notice: finalRows,
    drop: [],
  };

  const keys: RailStepKey[] = ["card", "first_notice", "second_notice", "final_notice", "drop"];
  const steps = keys.map((key): RailStep => {
    const at = new Date(pastDueSince.getTime() + DAY_OF[key] * DAY_MS);
    const done = reached >= STAGE_ORDER.indexOf(DONE_AT[key]);
    /*
       A cancellation stops the retries and the reminders (T9.1) and leaves
       the date: the plan still changes on the drop day, by the cancellation
       rather than by the sequence. So a step not yet run when the seller
       cancelled will not run — except the last, which happens either way.
    */
    const state: RailStepState = done
      ? "done"
      : cancelledAt && key !== "drop"
        ? "not_after_cancel"
        : "upcoming";
    const deliveries = rowsFor[key];
    const isNotice = key !== "card" && key !== "drop";
    const results = deliveries.map(resultOf);
    const result =
      isNotice && state === "done"
        ? (RESULT_RANK.find((r) => results.includes(r)) ?? "skipped")
        : null;
    const delivered = deliveries.filter((d) => d.status === "sent");
    const undelivered = deliveries.find((d) => d.status === "failed" || d.status === "skipped");
    return {
      key,
      day: DAY_OF[key],
      at,
      state,
      retried: key === "card" && input.attempted,
      deliveries,
      result,
      deliveredOn: delivered.map((d) => d.channel),
      failureReason: result && result !== "delivered" ? (undelivered?.reason ?? null) : null,
      recipientName: deliveries.find((d) => d.recipientName)?.recipientName ?? null,
    };
  });

  const notices = steps.filter((step) => step.result !== null);
  return {
    steps,
    dropsOn: new Date(pastDueSince.getTime() + DROP_TO_FREE_DAY * DAY_MS),
    /*
       The newest step that wrote a row. A done step with no row — a run from
       before S6 sent anything — has no channel, date or result to report, and
       12i's column says "None recorded" rather than "Skipped" with nothing
       after it.
    */
    lastNotice: notices.filter((step) => step.deliveries.length > 0).at(-1) ?? null,
    anyDelivered: notices.some((step) => step.result === "delivered"),
  };
}
