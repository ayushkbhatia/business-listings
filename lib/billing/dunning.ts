/**
 * The dunning sequence, as a pure function.
 *
 * Criterion 10: *"dunning runs the D0/D3/D7/D14 sequence and never deletes a
 * listing or removes a badge."*
 *
 * The second half is the load-bearing one and it is a **negative** — the kind
 * that passes by accident. So this module returns what should happen and does
 * nothing, and the only action it can ever return that touches the account is
 * `drop_to_free`. There is no `delete`, no `unpublish`, no `unverify`, and no
 * way to add one without changing a union that the tests enumerate.
 *
 * ## Why the sequence is what it is
 *
 * *"A failed card is usually an expired card, not a decision to leave."* So the
 * first response is silence — retry, and say nothing, because most of these fix
 * themselves and telling somebody their payment failed when it has not is worse
 * than waiting a day. Then email, which is a record. Then WhatsApp, which is
 * the channel that actually gets read here. Then a final notice, and only then
 * the plan drops.
 *
 * Fourteen days is the whole runway and it is deliberately long. The listing
 * stays live on Free afterwards, with its reviews, its catalogue and its badge
 * — the badge in particular records what we checked, and a card expiring does
 * not unverify a trade licence.
 */

export type DunningStage = "none" | "retry" | "emailed" | "messaged" | "final" | "dropped";

export type DunningAction =
  | { kind: "wait" }
  /** Try the card again, silently. */
  | { kind: "retry_silently"; stage: "retry" }
  | { kind: "send"; channel: "email"; stage: "emailed" }
  | { kind: "send"; channel: "whatsapp"; stage: "messaged" }
  | { kind: "send"; channel: "email"; stage: "final"; final: true }
  /**
   * The only action in this union that changes the account, and all it changes
   * is the plan. Criterion 10's negative lives in this type.
   */
  | { kind: "drop_to_free"; stage: "dropped" };

/** Days from the first failure at which each step fires. */
export const SCHEDULE = { retry: 0, emailed: 3, messaged: 7, final: 14 } as const;

/** After the final notice, this long before the plan drops. */
export const GRACE_AFTER_FINAL_DAYS = 1;

const DAY_MS = 86_400_000;

/** Days from the first failure to the plan dropping to Free. */
export const DROP_TO_FREE_DAY = SCHEDULE.final + GRACE_AFTER_FINAL_DAYS;

/**
 * When this subscription drops to Free — board 12e correction 4.
 *
 * The failed-payments column header was `SUSPENDS` — *in 4 days*, *in 11 days*,
 * *tomorrow*. Two things were wrong with it. The policy is **drop to Free at
 * D14: never delete a listing, never remove the verified badge**, which is what
 * `PERMITTED_ACCOUNT_EFFECTS` enumerates and what `12i`'s equivalent column
 * says — *Plan changes to Free on 19 Sep*. And **suspension is a real and
 * different action**: `business.suspend`, ops-lead-only, audited, taken on
 * `/admin/businesses`, honoured across storefronts, search, product counts and
 * metrics, with its own reason codes and appeal path. Naming a billing lapse
 * after it points staff at the wrong control.
 *
 * Measured from the first failure like every other step, so a missed run moves
 * nothing: the date an account drops is fixed the moment its card fails.
 */
export function dropsToFreeAt(pastDueSince: Date): Date {
  return new Date(pastDueSince.getTime() + DROP_TO_FREE_DAY * DAY_MS);
}

export function daysPastDue(pastDueSince: Date, now: Date): number {
  return Math.floor((now.getTime() - pastDueSince.getTime()) / DAY_MS);
}

/**
 * What to do next for one subscription.
 *
 * Measured from the first failure rather than from the previous step, so a
 * missed run does not push the whole sequence back and leave somebody in
 * dunning for a month. A run that is three days late does three steps at once
 * — which is right: the seller has been past due that long either way.
 */
export function nextAction(
  stage: DunningStage,
  pastDueSince: Date,
  now: Date = new Date(),
): DunningAction {
  if (stage === "dropped") return { kind: "wait" };

  const days = daysPastDue(pastDueSince, now);

  if (stage === "none" && days >= SCHEDULE.retry) {
    return { kind: "retry_silently", stage: "retry" };
  }
  if (stage === "retry" && days >= SCHEDULE.emailed) {
    return { kind: "send", channel: "email", stage: "emailed" };
  }
  if (stage === "emailed" && days >= SCHEDULE.messaged) {
    return { kind: "send", channel: "whatsapp", stage: "messaged" };
  }
  if (stage === "messaged" && days >= SCHEDULE.final) {
    return { kind: "send", channel: "email", stage: "final", final: true };
  }
  if (stage === "final" && days >= SCHEDULE.final + GRACE_AFTER_FINAL_DAYS) {
    return { kind: "drop_to_free", stage: "dropped" };
  }

  return { kind: "wait" };
}

/**
 * Everything dunning is allowed to do to an account.
 *
 * Enumerated so a test can assert the list rather than trusting a reading of
 * the code. Adding anything here is a deliberate act, and the test that reads
 * it will fail until somebody updates it on purpose.
 */
export const PERMITTED_ACCOUNT_EFFECTS = ["drop_to_free"] as const;

/** What dunning must never do, named so the refusal is legible. */
export const FORBIDDEN_EFFECTS = [
  "delete_listing",
  "unpublish_listing",
  "remove_badge",
  "lower_tier",
  "delete_products",
  "delete_reviews",
] as const;

/**
 * The attempts that belong to the failure the queue is showing.
 *
 * A subscription keeps every `PaymentAttempt` it ever made — every renewal that
 * went through as well as every one that did not. The failed-payments queue
 * read all of them: its `ATTEMPTS` column counted a year of paid renewals as
 * "12 tried" against an account that had failed once, and its reason and amount
 * came from whichever failure was newest, which on an account with no attempt
 * yet in this episode was one from a previous lapse it had recovered from.
 *
 * So: made at or after the date this episode started. The renewal that fails
 * stamps its attempt with the same instant it writes to `pastDueSince`, which
 * is what makes "at or after" exact. No start date, no episode yet, no attempts.
 */
export function episodeAttempts<T extends { attemptedAt: Date }>(
  attempts: readonly T[],
  pastDueSince: Date | null,
): T[] {
  if (pastDueSince === null) return [];
  return attempts.filter((attempt) => attempt.attemptedAt.getTime() >= pastDueSince.getTime());
}

export interface QueueSummary {
  /** Subscriptions somewhere in the sequence, including the ones that dropped. */
  count: number;
  /** Still recoverable: past due and not yet dropped to Free. */
  inSequence: number;
  /**
   * What is still at risk, in fils, VAT included.
   *
   * Only the rows that have not dropped. An account already on Free has
   * finished the sequence — there is nothing left to lose on it, and counting
   * its failed payment as "at risk" would make the figure a running total of
   * everything that ever failed rather than what a call today could recover.
   */
  atRiskFils: number;
  /** How many drop to Free inside the next seven days, or are overdue to. */
  droppingSoon: number;
}

/**
 * The figures the queue's header and the card on `/admin/plans` both state.
 *
 * One function, because they were two: the card summed in `dunningSummary` and
 * the page re-derived the same two numbers inline, under a comment saying a
 * third copy of these failed payments "will drift again". Two copies of the
 * arithmetic is the same risk one level down.
 */
export function summariseQueue(
  rows: readonly { stage: DunningStage; amountFils: number | null; dropsToFreeAt: Date | null }[],
  now: Date,
): QueueSummary {
  const soon = now.getTime() + 7 * DAY_MS;
  const live = rows.filter((row) => row.stage !== "dropped");
  return {
    count: rows.length,
    inSequence: live.length,
    atRiskFils: live.reduce((total, row) => total + (row.amountFils ?? 0), 0),
    droppingSoon: live.filter(
      (row) => row.dropsToFreeAt !== null && row.dropsToFreeAt.getTime() <= soon,
    ).length,
  };
}
