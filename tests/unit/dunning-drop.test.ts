import { describe, expect, it } from "vitest";
import {
  DROP_TO_FREE_DAY,
  FORBIDDEN_EFFECTS,
  GRACE_AFTER_FINAL_DAYS,
  PERMITTED_ACCOUNT_EFFECTS,
  SCHEDULE,
  dropsToFreeAt,
  nextAction,
} from "@/lib/billing/dunning";

/**
 * Board 12e correction 4 — the column is `DROPS TO FREE`, and the date under it
 * is the sequence's own.
 *
 * The board's head read `SUSPENDS`, which names an action this sequence cannot
 * take and which lives on a different screen under a different capability. The
 * words are a screen's problem; the date is this module's, and the two have to
 * agree — a column saying "in 4 days" over a job that drops on day 15 is worse
 * than no column.
 */

const DAY = 86_400_000;
const FAILED = new Date("2026-09-01T09:00:00Z");

describe("when an account drops to Free", () => {
  it("is the final notice plus its grace, measured from the first failure", () => {
    expect(DROP_TO_FREE_DAY).toBe(SCHEDULE.final + GRACE_AFTER_FINAL_DAYS);
    expect(dropsToFreeAt(FAILED).getTime()).toBe(FAILED.getTime() + DROP_TO_FREE_DAY * DAY);
  });

  it("is the day the sequence actually drops it", () => {
    /*
       The column and the job read the same arithmetic. Measured from the first
       failure rather than from the previous step, so a run that is three days
       late does not move the date an ops lead quoted to a seller.
    */
    const drops = dropsToFreeAt(FAILED);
    expect(nextAction("final", FAILED, new Date(drops.getTime() - 1))).toEqual({ kind: "wait" });
    expect(nextAction("final", FAILED, drops)).toEqual({
      kind: "drop_to_free",
      stage: "dropped",
    });
  });
});

describe("what the sequence may do to an account", () => {
  it("is one thing, and suspension is not it", () => {
    // Suspension is `business.suspend` — ops-lead only, audited, taken on
    // /admin/businesses, with its own reason codes and appeal path. A billing
    // lapse is not it, and this list is why a screen cannot imply otherwise.
    expect([...PERMITTED_ACCOUNT_EFFECTS]).toEqual(["drop_to_free"]);
    expect(FORBIDDEN_EFFECTS).not.toHaveLength(0);
    for (const effect of FORBIDDEN_EFFECTS) {
      expect(PERMITTED_ACCOUNT_EFFECTS as readonly string[]).not.toContain(effect);
    }
  });
});
