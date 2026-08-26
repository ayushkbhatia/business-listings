import { describe, expect, it } from "vitest";
import {
  daysPastDue,
  FORBIDDEN_EFFECTS,
  GRACE_AFTER_FINAL_DAYS,
  nextAction,
  PERMITTED_ACCOUNT_EFFECTS,
  SCHEDULE,
  type DunningAction,
} from "./dunning";

/**
 * Criterion 10, in the pure.
 *
 *   "Dunning runs the D0/D3/D7/D14 sequence and never deletes a listing or
 *    removes a badge."
 *
 * The second half is a negative, which is the kind that passes by accident. It
 * is tested here by enumeration rather than by inspection: the only action that
 * touches the account is `drop_to_free`, and the test reads the list.
 */

const FAILED = new Date("2026-08-01T00:00:00Z");
const day = (n: number) => new Date(FAILED.getTime() + n * 86_400_000);

describe("the schedule", () => {
  it("is D0, D3, D7 and D14", () => {
    expect(SCHEDULE).toEqual({ retry: 0, emailed: 3, messaged: 7, final: 14 });
  });

  it("counts whole days from the first failure", () => {
    expect(daysPastDue(FAILED, day(0))).toBe(0);
    expect(daysPastDue(FAILED, new Date(FAILED.getTime() + 23 * 3_600_000))).toBe(0);
    expect(daysPastDue(FAILED, day(3))).toBe(3);
  });
});

describe("the sequence", () => {
  it("retries silently on the day it fails", () => {
    // Most of these are an expired card. Telling somebody their payment failed
    // when it has not is worse than waiting a day.
    expect(nextAction("none", FAILED, day(0))).toEqual({
      kind: "retry_silently",
      stage: "retry",
    });
  });

  it("waits until day three before saying anything", () => {
    expect(nextAction("retry", FAILED, day(1))).toEqual({ kind: "wait" });
    expect(nextAction("retry", FAILED, day(2))).toEqual({ kind: "wait" });
    expect(nextAction("retry", FAILED, day(3))).toEqual({
      kind: "send",
      channel: "email",
      stage: "emailed",
    });
  });

  it("moves to WhatsApp at day seven, because that is what gets read here", () => {
    expect(nextAction("emailed", FAILED, day(6))).toEqual({ kind: "wait" });
    expect(nextAction("emailed", FAILED, day(7))).toEqual({
      kind: "send",
      channel: "whatsapp",
      stage: "messaged",
    });
  });

  it("sends a final notice at day fourteen", () => {
    expect(nextAction("messaged", FAILED, day(13))).toEqual({ kind: "wait" });
    expect(nextAction("messaged", FAILED, day(14))).toMatchObject({
      stage: "final",
      final: true,
    });
  });

  it("drops to Free only after the final notice has had its day", () => {
    expect(nextAction("final", FAILED, day(14))).toEqual({ kind: "wait" });
    expect(nextAction("final", FAILED, day(14 + GRACE_AFTER_FINAL_DAYS))).toEqual({
      kind: "drop_to_free",
      stage: "dropped",
    });
  });

  it("does nothing once dropped", () => {
    expect(nextAction("dropped", FAILED, day(60))).toEqual({ kind: "wait" });
  });

  it("catches up rather than restarting when a run is late", () => {
    /*
     * Measured from the first failure, not from the previous step. A run that
     * is three days late does the step that is due — the seller has been past
     * due that long either way, and restarting the clock would leave somebody
     * in dunning for a month.
     */
    expect(nextAction("retry", FAILED, day(10))).toMatchObject({ stage: "emailed" });
    expect(nextAction("emailed", FAILED, day(30))).toMatchObject({ stage: "messaged" });
  });
});

describe("what dunning may do to an account", () => {
  it("may do exactly one thing, and it is a plan change", () => {
    expect(PERMITTED_ACCOUNT_EFFECTS).toEqual(["drop_to_free"]);
  });

  it("names what it must never do", () => {
    for (const forbidden of [
      "delete_listing",
      "unpublish_listing",
      "remove_badge",
      "lower_tier",
    ]) {
      expect(FORBIDDEN_EFFECTS).toContain(forbidden);
    }
  });

  it("returns no action that could reach a forbidden effect", () => {
    /*
     * Every stage, every day from 0 to 40. The only account-touching action the
     * sequence can produce is the drop, whatever the inputs — which is the
     * negative half of criterion 10, asserted rather than read.
     */
    const stages = ["none", "retry", "emailed", "messaged", "final", "dropped"] as const;
    const seen = new Set<string>();

    for (const stage of stages) {
      for (let d = 0; d <= 40; d += 1) {
        const action: DunningAction = nextAction(stage, FAILED, day(d));
        seen.add(action.kind);
      }
    }

    expect([...seen].sort()).toEqual(["drop_to_free", "retry_silently", "send", "wait"]);
    for (const forbidden of FORBIDDEN_EFFECTS) {
      expect([...seen]).not.toContain(forbidden);
    }
  });
});
