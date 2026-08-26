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
