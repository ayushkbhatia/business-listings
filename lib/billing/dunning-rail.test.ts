import { describe, expect, it } from "vitest";
import { DROP_TO_FREE_DAY, SCHEDULE } from "./dunning";
import { dunningRail, type RailDelivery } from "./dunning-rail";

/**
 * T9.2 / T9.4 — the rail every failed-payment screen reads. Spec S3's
 * acceptance: every date equals the date the job acts on, and no sentence
 * refers to a message that has no delivery row.
 */

const SINCE = new Date("2026-09-04T06:00:00Z");
const DAY = 86_400_000;
const at = (day: number, minutes = 0) => new Date(SINCE.getTime() + day * DAY + minutes * 60_000);

const row = (
  event: RailDelivery["event"],
  channel: string,
  createdAt: Date,
  status: RailDelivery["status"] = "sent",
  reason: string | null = null,
): RailDelivery => ({
  event,
  channel,
  status,
  reason,
  createdAt,
  sentAt: status === "sent" ? createdAt : null,
  scheduledFor: null,
  recipientName: "Fatima",
});

describe("dunningRail", () => {
  it("dates every step from the schedule the job runs on", () => {
    const rail = dunningRail({ pastDueSince: SINCE, stage: "retry", attempted: true, cancelledAt: null, deliveries: [] });
    expect(rail.steps.map((step) => step.day)).toEqual([
      SCHEDULE.retry,
      SCHEDULE.emailed,
      SCHEDULE.messaged,
      SCHEDULE.final,
      DROP_TO_FREE_DAY,
    ]);
    expect(rail.steps.map((step) => step.at)).toEqual(rail.steps.map((step) => at(step.day)));
    expect(rail.dropsOn).toEqual(at(DROP_TO_FREE_DAY));
  });

  it("marks steps done by the stage, and the rest upcoming", () => {
    const rail = dunningRail({ pastDueSince: SINCE, stage: "emailed", attempted: true, cancelledAt: null, deliveries: [] });
    expect(rail.steps.map((step) => step.state)).toEqual(["done", "done", "upcoming", "upcoming", "upcoming"]);
  });

  it("says a done notice with no row was not recorded, never that it was sent", () => {
    const rail = dunningRail({ pastDueSince: SINCE, stage: "emailed", attempted: true, cancelledAt: null, deliveries: [] });
    const first = rail.steps[1]!;
    expect(first.deliveries).toEqual([]);
    expect(first.result).toBe("skipped");
    expect(rail.anyDelivered).toBe(false);
  });

  it("tells the two payment_failed sends apart even when the job ran late", () => {
    // The first notice went out on day 8, a run late; the reminder on day 9.
    const deliveries = [
      row("payment_failed", "email", at(8)),
      row("payment_failed", "in_app", at(8, 1)),
      row("payment_failed", "email", at(9)),
    ];
    const rail = dunningRail({ pastDueSince: SINCE, stage: "messaged", attempted: true, cancelledAt: null, deliveries });
    expect(rail.steps[1]!.deliveries).toHaveLength(2);
    expect(rail.steps[2]!.deliveries).toHaveLength(1);
  });

  it("calls a notice delivered when any channel arrived, and names why the others did not", () => {
    const deliveries = [
      row("payment_failed", "whatsapp", at(3), "skipped", "recipient_has_no_address_for_this_channel"),
      row("payment_failed", "email", at(3, 1)),
    ];
    const rail = dunningRail({ pastDueSince: SINCE, stage: "emailed", attempted: true, cancelledAt: null, deliveries });
    expect(rail.steps[1]!.result).toBe("delivered");
    expect(rail.steps[1]!.deliveredOn).toEqual(["email"]);
    expect(rail.steps[1]!.failureReason).toBeNull();
    expect(rail.anyDelivered).toBe(true);
  });

  it("carries the reason when nothing arrived", () => {
    const deliveries = [row("payment_failed", "email", at(3), "skipped", "no_live_template")];
    const rail = dunningRail({ pastDueSince: SINCE, stage: "emailed", attempted: true, cancelledAt: null, deliveries });
    expect(rail.steps[1]!.result).toBe("no_template");
    expect(rail.steps[1]!.failureReason).toBe("no_live_template");
  });

  it("reads the final notice from its own event", () => {
    const deliveries = [row("payment_final_notice", "email", at(14))];
    const rail = dunningRail({ pastDueSince: SINCE, stage: "final", attempted: true, cancelledAt: null, deliveries });
    expect(rail.steps[3]!.result).toBe("delivered");
    expect(rail.lastNotice?.key).toBe("final_notice");
  });

  it("stops the remaining notices after a cancellation, and keeps the drop", () => {
    const rail = dunningRail({ pastDueSince: SINCE, stage: "emailed", attempted: true, cancelledAt: at(5), deliveries: [] });
    expect(rail.steps.map((step) => step.state)).toEqual(["done", "done", "not_after_cancel", "not_after_cancel", "upcoming"]);
  });

  it("records whether the card was actually tried", () => {
    const untried = dunningRail({ pastDueSince: SINCE, stage: "retry", attempted: false, cancelledAt: null, deliveries: [] });
    expect(untried.steps[0]!.retried).toBe(false);
  });
});
