import { describe, expect, it } from "vitest";
import {
  CRM_SIGNALS,
  NO_ANSWER_COOLING_DAYS,
  SUPPRESS_AFTER_CLOSE_DAYS,
  actionOf,
  demandScoreOf,
  dubaiWeekStart,
  endOfDubaiDay,
  isDue,
  resumeFrom,
  signalValueOf,
  strongerSignal,
  supplyGap,
  transition,
  unansweredOf,
  type SignalFacts,
} from "@/lib/crm/model";
import { scriptIdFor } from "@/lib/crm/scripts";
import { ceilShare, verifiedShortfall } from "@/lib/publish-threshold";

/**
 * Board 12d — the call list's rules, held without a database.
 *
 * The handoff corrected a banner whose recruitment target sat above a listing
 * count that had already cleared the threshold it was said to be held by. The
 * supply arithmetic is the first thing here, on the handoff's own figures.
 */

const NOW = new Date("2026-09-14T08:00:00Z"); // 12:00 in Dubai, a Monday
const DAY = 86_400_000;

describe("§Corrected 1 — the banner's supply arithmetic derives", () => {
  it("verifies 16 of the 70 unverified listings when 78 already pass a 60-listing need", () => {
    const gap = supplyGap({ listings: 78, verified: 8, need: 60, minVerifiedShare: 0.3, unverified: 70 });
    expect(gap.listingsPass).toBe(true);
    expect(gap.sharePass).toBe(false);
    expect(gap.toVerify).toBe(16);
    expect(gap.verifiedAfter).toBe(24);
    expect(gap.listingsAfter).toBe(78);
    // 24 of 78 is 30.8%, over the floor; 23 would be 29.5%, under it.
    expect(24 / 78).toBeGreaterThanOrEqual(0.3);
    expect(23 / 78).toBeLessThan(0.3);
  });

  it("reaches the handoff's 30 of 100 by verifying before recruiting", () => {
    const gap = supplyGap({ listings: 78, verified: 8, need: 100, minVerifiedShare: 0.3, unverified: 70 });
    expect(gap.listingsToAdd).toBe(22);
    expect(gap.toVerify).toBe(22);
    expect(gap.addedVerified).toBe(0);
    expect(gap.verifiedAfter).toBe(30);
    expect(gap.listingsAfter).toBe(100);
  });

  it("asks new listings to arrive verified only for what the scope's own cannot cover", () => {
    const gap = supplyGap({ listings: 1, verified: 0, need: 99, minVerifiedShare: 0.3, unverified: 1 });
    expect(gap.listingsToAdd).toBe(98);
    expect(gap.toVerify).toBe(1);
    expect(gap.addedVerified).toBe(29);
    expect(gap.verifiedAfter).toBe(30);
    // 30 of 99 is 30.3%; 29 would be 29.3%.
    expect(30 / 99).toBeGreaterThanOrEqual(0.3);
    expect(29 / 99).toBeLessThan(0.3);
  });

  it("clears a listings-only gap with unverified listings when the share already holds", () => {
    const gap = supplyGap({ listings: 40, verified: 20, need: 60, minVerifiedShare: 0.3, unverified: 20 });
    expect(gap).toMatchObject({ listingsToAdd: 20, toVerify: 0, addedVerified: 0, verifiedAfter: 20, listingsAfter: 60 });
  });

  it("does not ask for a nineteenth verified listing at 30% of 60", () => {
    // 0.3 × 60 is 18.000000000000004 as a double.
    expect(ceilShare(0.3, 60)).toBe(18);
    expect(verifiedShortfall({ listings: 60, verified: 18 }, 0.3)).toBe(0);
    const gap = supplyGap({ listings: 60, verified: 18, need: 60, minVerifiedShare: 0.3, unverified: 42 });
    expect(gap.toVerify + gap.listingsToAdd).toBe(0);
  });
});

describe("B8 — outcomes are a fixed set, and each moves the task one way", () => {
  it("parks a wrong number, loses a no, and closes a business that closed down", () => {
    expect(transition("wrong_number", NOW, null)).toMatchObject({ ok: true, state: "parked", closeReason: "wrong_number" });
    expect(transition("not_interested", NOW, null)).toMatchObject({ ok: true, state: "lost", closeReason: "not_interested" });
    expect(transition("closed_down", NOW, null)).toMatchObject({ ok: true, state: "lost", closeReason: "closed_down" });
  });

  it("treats no answer as a touch, back in the queue after a cooling period", () => {
    const move = transition("no_answer", NOW, null);
    expect(move).toMatchObject({ ok: true, state: "unreachable" });
    if (!move.ok || !("coolingUntil" in move)) throw new Error("unreachable");
    expect(move.coolingUntil!.getTime()).toBe(NOW.getTime() + NO_ANSWER_COOLING_DAYS * DAY);
  });

  it("books a call-back only with a date, in the future, within sixty days", () => {
    expect(transition("call_back", NOW, null)).toEqual({ ok: false, error: "call_back_needs_date" });
    expect(transition("call_back", NOW, new Date(NOW.getTime() - DAY))).toEqual({ ok: false, error: "call_back_in_past" });
    expect(transition("call_back", NOW, new Date(NOW.getTime() + 61 * DAY))).toEqual({ ok: false, error: "call_back_too_far" });
    expect(transition("interested", NOW, new Date(NOW.getTime() + DAY))).toEqual({ ok: false, error: "date_only_on_call_back" });
    expect(transition("call_back", NOW, new Date(NOW.getTime() + 3 * DAY))).toMatchObject({ ok: true, state: "callback" });
  });
});

describe("States — what is due today", () => {
  it("makes a call-back due on its day, not at its minute", () => {
    const eveningCallBack = new Date("2026-09-14T17:00:00Z"); // 21:00 Dubai, same day
    expect(isDue({ state: "callback", callBackAt: eveningCallBack, coolingUntil: null }, NOW)).toBe(true);
    expect(isDue({ state: "callback", callBackAt: new Date("2026-09-14T20:30:00Z"), coolingUntil: null }, NOW)).toBe(false);
  });

  it("holds a no-answer until its cooling period ends, and never offers a closed task", () => {
    expect(isDue({ state: "unreachable", callBackAt: null, coolingUntil: new Date(NOW.getTime() + DAY) }, NOW)).toBe(false);
    expect(isDue({ state: "unreachable", callBackAt: null, coolingUntil: new Date(NOW.getTime() - 1) }, NOW)).toBe(true);
    for (const state of ["won", "lost", "parked", "cleared"] as const) {
      expect(isDue({ state, callBackAt: null, coolingUntil: null }, NOW)).toBe(false);
    }
  });

  it("puts the Dubai day and week where Dubai does", () => {
    expect(endOfDubaiDay(NOW).toISOString()).toBe("2026-09-14T20:00:00.000Z");
    expect(dubaiWeekStart(NOW).toISOString()).toBe("2026-09-13T20:00:00.000Z");
    expect(dubaiWeekStart(new Date("2026-09-20T19:59:00Z")).toISOString()).toBe("2026-09-13T20:00:00.000Z");
  });

  it("labels a churn call a save and a follow-up a follow-up", () => {
    expect(actionOf("churn_risk", "queued")).toBe("save");
    expect(actionOf("cap_reached", "called")).toBe("follow_up");
    expect(actionOf("held_page", "queued")).toBe("call");
  });
});

describe("a new task starts where the last conversation left it", () => {
  const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

  it("keeps a business off the list for ninety days after a no, a wrong number or a closure", () => {
    expect(resumeFrom({ kind: "not_interested", createdAt: ago(10), callBackAt: null }, NOW)).toEqual({ kind: "suppress" });
    expect(resumeFrom({ kind: "wrong_number", createdAt: ago(89), callBackAt: null }, NOW)).toEqual({ kind: "suppress" });
    expect(resumeFrom({ kind: "closed_down", createdAt: ago(SUPPRESS_AFTER_CLOSE_DAYS + 1), callBackAt: null }, NOW)).toEqual({ kind: "fresh" });
  });

  it("honours a call-back that has not come round yet", () => {
    const resume = resumeFrom({ kind: "call_back", createdAt: ago(3), callBackAt: new Date(NOW.getTime() + 2 * DAY) }, NOW);
    expect(resume).toMatchObject({ kind: "state", state: "callback" });
  });

  it("starts fresh with no history", () => {
    expect(resumeFrom(null, NOW)).toEqual({ kind: "fresh" });
  });
});

describe("one signal per business, and a score nobody typed", () => {
  it("prefers the save call, then the upgrade, then the claim", () => {
    expect(CRM_SIGNALS[0]).toBe("churn_risk");
    expect(strongerSignal("zero_result", "churn_risk")).toBe("churn_risk");
    expect(strongerSignal("cap_reached", "held_page")).toBe("cap_reached");
    expect(strongerSignal("unclaimed_demand", "held_page")).toBe("unclaimed_demand");
  });

  const held: SignalFacts = {
    kind: "held_page",
    areaId: "a",
    areaName: "Business Bay",
    categoryId: "c",
    categoryName: "HVAC",
    path: "/dubai/business-bay/hvac",
    listings: 78,
    verified: 8,
    need: 60,
    minVerifiedShare: 0.3,
    introWords: 0,
    minIntroWords: 250,
    unverified: 70,
    monthlySearches: 3_940,
    failing: ["verified", "copy"],
    tradeSearchesWeek: 8,
    tradeName: "Chiller AMC",
    claimed: false,
  };

  it("sorts a held page by its searches, but opens the call with the supplier's own", () => {
    // The script's eight is per supplier and per trade, never the banner's 3,940.
    expect(demandScoreOf(held)).toBe(3_940);
    expect(signalValueOf(held)).toBe(8);
  });

  it("scores a churn risk by the enquiries left unanswered in 4f's sample", () => {
    const churn: SignalFacts = { kind: "churn_risk", replyRate: 0.34, replySample: 12, renewsAt: "2026-09-28T00:00:00.000Z", planId: "basic" };
    expect(unansweredOf(churn)).toBe(8);
    expect(demandScoreOf(churn)).toBe(8);
    expect(signalValueOf(churn)).toBe(34);
  });

  it("scores a product cap at nought, below every call with a buyer behind it", () => {
    expect(
      demandScoreOf({ kind: "cap_reached", cap: "product_cap", missedEnquiries30d: 0, refusedAt: null, refusedAttempted: 12, refusedCap: 50, planId: "basic" }),
    ).toBe(0);
  });

  it("picks the script with a number only when the number is not nought", () => {
    expect(scriptIdFor(held, "unclaimed")).toBe("held_page.claim.v1");
    expect(scriptIdFor({ ...held, tradeSearchesWeek: 0 }, "unclaimed")).toBe("held_page.claim_no_number.v1");
    expect(scriptIdFor(held, "claimed")).toBe("held_page.verify.v1");
  });
});
