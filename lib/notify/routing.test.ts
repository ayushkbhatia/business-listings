import { describe, expect, it } from "vitest";
import { EVENT_AUDIENCE } from "./params";
import {
  DEFAULT_ROUTING,
  PLATFORM_FLOOR,
  inQuietHours,
  localParts,
  overridesQuietHours,
  quietLiftsAt,
  route,
  withInheritedChoices,
  type NotificationEvent,
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
  it("holds WhatsApp, lets in-app and email through, and skips the retired channel", () => {
    /*
       SMS deferred here until T6.8 retired it (N10). The fixture still names it
       because a stored matrix can — T6.5 stopped the alerts screen deleting
       what it does not render, and
       `20261121094000_retire_sms_routing_n10` is what takes it out of the data.
       What the routing promises about it is `skip`, with a reason, rather than
       a quiet disappearance.
    */
    const decisions = route(PREFERENCE, { event: "enquiry_received", now: MONDAY_2200 });
    expect(actions(decisions)).toEqual({
      whatsapp: "defer",
      sms: "skip",
      email: "send",
      in_app: "send",
    });
    const sms = decisions.find((decision) => decision.channel === "sms");
    expect(sms?.action === "skip" && sms.reason).toBe("channel_retired");
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

  it("sends everything during the working day, bar the retired channel", () => {
    const decisions = route(PREFERENCE, { event: "enquiry_received", now: MONDAY_1000 });
    expect(decisions.filter((d) => d.channel !== "sms").every((d) => d.action === "send")).toBe(true);
    // A retired channel is skipped whatever the hour: it is not a question
    // about quiet hours, it is a channel the product does not send on.
    expect(decisions.find((d) => d.channel === "sms")?.action).toBe("skip");
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
      // The override is about quiet hours. It cannot un-retire a channel.
      sms: "skip",
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

describe("board 12g B7 — what a seller cannot switch off", () => {
  it("sends licence expiry by email and in-app even with both unticked", () => {
    const off: RoutingPreference = { ...PREFERENCE, matrix: { document_expiring: [] } };
    expect(actions(route(off, { event: "document_expiring", now: MONDAY_1000 }))).toEqual({ email: "send", in_app: "send" });
  });

  it("keeps what the seller added on top, and does not send a channel twice", () => {
    const chosen: RoutingPreference = { ...PREFERENCE, matrix: { document_expiring: ["whatsapp", "email"] } };
    const decisions = route(chosen, { event: "document_expiring", now: MONDAY_1000 });
    expect(decisions.map((d) => d.channel)).toEqual(["whatsapp", "email", "in_app"]);
  });

  it("routes Ramadan date changes that no matrix has ever listed", () => {
    expect(actions(route(PREFERENCE, { event: "ramadan_dates_moved", now: MONDAY_2200 }))).toEqual({ email: "send", in_app: "send" });
  });

  it("lists only channels that do not interrupt, so quiet hours still mean what they say", () => {
    for (const channels of Object.values(PLATFORM_FLOOR)) {
      for (const channel of channels ?? []) expect(["email", "in_app"]).toContain(channel);
    }
  });
});

describe("board 1o — part of a quote accepted routes as an acceptance", () => {
  it("follows the seller's choice for an accepted quote until they choose for it", () => {
    const seller: RoutingPreference = { ...PREFERENCE, matrix: { quote_accepted: ["whatsapp", "email", "in_app"] } };
    expect(route(seller, { event: "quote_partly_accepted", now: MONDAY_1000 }).map((d) => d.channel)).toEqual([
      "whatsapp",
      "email",
      "in_app",
    ]);
  });

  it("sends no email to a seller who switched it off for acceptances: in-app only, from the floor", () => {
    const quiet: RoutingPreference = { ...PREFERENCE, matrix: { quote_accepted: [] } };
    expect(actions(route(quiet, { event: "quote_partly_accepted", now: MONDAY_1000 }))).toEqual({ in_app: "send" });
  });

  it("reads the seller's own choice once there is one", () => {
    const own: RoutingPreference = { ...PREFERENCE, matrix: { quote_accepted: ["whatsapp"], quote_partly_accepted: ["email"] } };
    expect(route(own, { event: "quote_partly_accepted", now: MONDAY_1000 }).map((d) => d.channel)).toEqual(["email", "in_app"]);
  });

  it("shows the inherited choice on the form, so saving it keeps it", () => {
    expect(withInheritedChoices({ quote_accepted: ["whatsapp", "in_app"] })).toEqual({
      quote_accepted: ["whatsapp", "in_app"],
      quote_partly_accepted: ["whatsapp", "in_app"],
    });
    expect(withInheritedChoices({ quote_accepted: ["whatsapp"], quote_partly_accepted: [] })).toEqual({
      quote_accepted: ["whatsapp"],
      quote_partly_accepted: [],
    });
  });
});

describe("T6.1 — DEFAULT_ROUTING, for a business with no stored preference", () => {
  /*
     The defect, as a test.

     `notify()` found no `NotificationPreference` and returned `[]` *before*
     `route()` ran, so `PLATFORM_FLOOR` was never reached: a business with no
     row received nothing on any channel for any event, the two the platform
     promises are not switchable included. Every imported listing is in that
     state.
  */
  it("covers every seller event, and only seller events", () => {
    const events = Object.keys(DEFAULT_ROUTING.matrix) as NotificationEvent[];
    expect(events.length).toBeGreaterThan(10);
    for (const event of events) {
      expect(EVENT_AUDIENCE[event], event).toBe("seller");
    }
    // Derived from `EVENT_AUDIENCE`, so a new seller event joins it without a
    // second list being edited. The three that matter most, named:
    for (const event of ["enquiry_received", "quote_accepted", "document_expiring"] as const) {
      expect(events, event).toContain(event);
    }
    // A buyer's events are not a seller's to receive.
    expect(events).not.toContain("quote_received");
    expect(events).not.toContain("approval_requested");
  });

  it("defaults to the two channels that do not interrupt, and nothing else", () => {
    for (const [event, channels] of Object.entries(DEFAULT_ROUTING.matrix)) {
      expect([...(channels ?? [])].sort(), event).toEqual(["email", "in_app"]);
    }
  });

  it("reaches the platform floor, which is what the early return skipped", () => {
    // `document_expiring` is on the floor *and* in the default matrix, so this
    // asserts the thing that was actually broken: that `route()` runs at all.
    const decisions = route(DEFAULT_ROUTING, { event: "document_expiring", now: MONDAY_1000 });
    expect(actions(decisions)).toEqual({ email: "send", in_app: "send" });
  });

  it("carries the platform's quiet promise, inert on both default channels", () => {
    /*
       Neither email nor in-app interrupts, so a default-routed business is
       never deferred — the window is set so that a seller who later turns
       WhatsApp on inherits the promise rather than a blank.
    */
    expect(DEFAULT_ROUTING.quiet.enabled).toBe(true);
    const decisions = route(DEFAULT_ROUTING, { event: "enquiry_received", now: TUESDAY_0300 });
    expect(actions(decisions)).toEqual({ email: "send", in_app: "send" });

    const chatty: RoutingPreference = {
      ...DEFAULT_ROUTING,
      matrix: { ...DEFAULT_ROUTING.matrix, enquiry_received: ["whatsapp", "email", "in_app"] },
    };
    expect(actions(route(chatty, { event: "enquiry_received", now: TUESDAY_0300 }))).toEqual({
      whatsapp: "defer",
      email: "send",
      in_app: "send",
    });
  });

  it("asks for no high-value override, because nobody set one", () => {
    expect(DEFAULT_ROUTING.highValueOverrideAed).toBeNull();
  });
});
