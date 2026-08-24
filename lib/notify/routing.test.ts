import { describe, expect, it } from "vitest";
import {
  inQuietHours,
  localParts,
  overridesQuietHours,
  quietLiftsAt,
  route,
  type RoutingPreference,
} from "./routing";

/**
 * Acceptance criterion 10: quiet hours suppress WhatsApp and SMS but not
 * in-app, with the high-value override working.
 *
 * Every instant here is written in UTC and reasoned about in Asia/Dubai, which
 * is UTC+4 all year — the UAE does not observe daylight saving. A test that
 * quietly used the server's timezone would pass in Dubai and fail in CI.
 */
const PREFERENCE: RoutingPreference = {
  matrix: {
    enquiry_received: ["whatsapp", "sms", "email", "in_app"],
    weekly_digest: ["email"],
  },
  quiet: { enabled: true, fromHour: 21, toHour: 7, onSunday: true },
  highValueOverrideAed: 50_000,
};

/** 24 Aug 2026 is a Monday. */
const MONDAY_1000 = new Date("2026-08-24T06:00:00Z"); // 10:00 Dubai
const MONDAY_2200 = new Date("2026-08-24T18:00:00Z"); // 22:00 Dubai
const TUESDAY_0300 = new Date("2026-08-24T23:00:00Z"); // 03:00 Tue Dubai
const SUNDAY_1400 = new Date("2026-08-23T10:00:00Z"); // 14:00 Sun Dubai

const actions = (decisions: ReturnType<typeof route>) =>
  Object.fromEntries(decisions.map((d) => [d.channel, d.action]));

describe("localParts", () => {
  it("reads the hour in Dubai, not on the server", () => {
    expect(localParts(MONDAY_2200)).toEqual({ hour: 22, weekday: 1 });
    expect(localParts(TUESDAY_0300)).toEqual({ hour: 3, weekday: 2 });
    expect(localParts(SUNDAY_1400)).toEqual({ hour: 14, weekday: 0 });
  });
});

describe("inQuietHours", () => {
  it("is quiet after 21:00 and before 07:00, across midnight", () => {
    expect(inQuietHours(PREFERENCE.quiet, MONDAY_2200)).toBe(true);
    expect(inQuietHours(PREFERENCE.quiet, TUESDAY_0300)).toBe(true);
  });

  it("is not quiet during the working day", () => {
    expect(inQuietHours(PREFERENCE.quiet, MONDAY_1000)).toBe(false);
  });

  it("turns over exactly on the hour", () => {
    // 20:59 loud, 21:00 quiet; 06:59 quiet, 07:00 loud.
    expect(inQuietHours(PREFERENCE.quiet, new Date("2026-08-24T16:59:00Z"))).toBe(false);
    expect(inQuietHours(PREFERENCE.quiet, new Date("2026-08-24T17:00:00Z"))).toBe(true);
    expect(inQuietHours(PREFERENCE.quiet, new Date("2026-08-25T02:59:00Z"))).toBe(true);
    expect(inQuietHours(PREFERENCE.quiet, new Date("2026-08-25T03:00:00Z"))).toBe(false);
  });

  it("is quiet all Sunday, in the middle of the afternoon", () => {
    expect(inQuietHours(PREFERENCE.quiet, SUNDAY_1400)).toBe(true);
  });

  it("respects a seller who has switched Sunday back on", () => {
    const working = { ...PREFERENCE.quiet, onSunday: false };
    expect(inQuietHours(working, SUNDAY_1400)).toBe(false);
  });

  it("is never quiet when the seller has turned it off", () => {
    expect(inQuietHours({ ...PREFERENCE.quiet, enabled: false }, TUESDAY_0300)).toBe(false);
  });
});

describe("criterion 10 — what quiet hours suppress", () => {
  it("holds WhatsApp and SMS, and lets in-app and email through", () => {
    const decisions = route(PREFERENCE, { event: "enquiry_received", now: MONDAY_2200 });
    expect(actions(decisions)).toEqual({
      whatsapp: "defer",
      sms: "defer",
      email: "send",
      in_app: "send",
    });
  });

  it("says when a deferred message will go", () => {
    const decisions = route(PREFERENCE, { event: "enquiry_received", now: MONDAY_2200 });
    const held = decisions.find((d) => d.channel === "whatsapp");
    expect(held?.action).toBe("defer");
    if (held?.action !== "defer") throw new Error("unreachable");
    // 22:00 Monday, quiet until 07:00 Tuesday.
    expect(held.at.toISOString()).toBe("2026-08-25T03:00:00.000Z");
    expect(held.reason).toBe("quiet_hours");
  });

  it("sends everything during the working day", () => {
    const decisions = route(PREFERENCE, { event: "enquiry_received", now: MONDAY_1000 });
    expect(decisions.every((d) => d.action === "send")).toBe(true);
  });
});

describe("criterion 10 — the high-value override", () => {
  it("wakes a seller for an enquiry worth the threshold", () => {
    const decisions = route(PREFERENCE, {
      event: "enquiry_received",
      now: MONDAY_2200,
      valueAed: 50_000,
    });
    expect(actions(decisions)).toEqual({
      whatsapp: "send",
      sms: "send",
      email: "send",
      in_app: "send",
    });
  });

  it("does not wake them for one just under it", () => {
    const decisions = route(PREFERENCE, {
      event: "enquiry_received",
      now: MONDAY_2200,
      valueAed: 49_999,
    });
    expect(actions(decisions).whatsapp).toBe("defer");
  });

  it("does not override on a Sunday afternoon either — quiet is quiet", () => {
    const low = route(PREFERENCE, { event: "enquiry_received", now: SUNDAY_1400, valueAed: 100 });
    expect(actions(low).whatsapp).toBe("defer");
    const high = route(PREFERENCE, {
      event: "enquiry_received",
      now: SUNDAY_1400,
      valueAed: 80_000,
    });
    expect(actions(high).whatsapp).toBe("send");
  });

  it("never overrides when the seller has set no threshold", () => {
    const never: RoutingPreference = { ...PREFERENCE, highValueOverrideAed: null };
    const decisions = route(never, {
      event: "enquiry_received",
      now: MONDAY_2200,
      valueAed: 5_000_000,
    });
    expect(actions(decisions).whatsapp).toBe("defer");
  });

  it("does not override when the event has no value at all", () => {
    // A document expiring is not worth AED anything, and treating a missing
    // value as infinite would wake somebody for a licence renewal.
    expect(overridesQuietHours(PREFERENCE, null)).toBe(false);
    expect(overridesQuietHours(PREFERENCE, undefined)).toBe(false);
  });
});

describe("the matrix", () => {
  it("sends nothing for an event the seller has switched off", () => {
    expect(route(PREFERENCE, { event: "review_posted", now: MONDAY_1000 })).toEqual([]);
  });

  it("sends only the channels the seller chose", () => {
    const decisions = route(PREFERENCE, { event: "weekly_digest", now: MONDAY_1000 });
    expect(decisions.map((d) => d.channel)).toEqual(["email"]);
  });
});

describe("quietLiftsAt", () => {
  it("returns the next hour outside the window", () => {
    expect(quietLiftsAt(PREFERENCE.quiet, MONDAY_2200).toISOString()).toBe(
      "2026-08-25T03:00:00.000Z",
    );
  });

  it("steps over a whole quiet Sunday", () => {
    // 22:00 Saturday: quiet through Sunday, lifting 07:00 Monday.
    const saturday = new Date("2026-08-22T18:00:00Z");
    expect(quietLiftsAt(PREFERENCE.quiet, saturday).toISOString()).toBe(
      "2026-08-24T03:00:00.000Z",
    );
  });

  it("returns now when nothing is quiet", () => {
    const off = { ...PREFERENCE.quiet, enabled: false };
    expect(quietLiftsAt(off, MONDAY_2200).getTime()).toBeGreaterThanOrEqual(MONDAY_2200.getTime());
  });
});
