import { describe, expect, it } from "vitest";
import { ALERT_GROUPS, EVENTS, GOES_TO, floorLocked, inAppLocked, nextRouting } from "@/app/(dashboard)/dashboard/settings/matrix";
import { EVENT_AUDIENCE, isEmitted } from "@/lib/notify/params";
import type { NotificationEvent } from "@/lib/notify/routing";

/**
 * Board 7e's alert matrix — task T6.5.
 *
 * The screen renders some of the events a seller can receive and not others,
 * which is a legitimate editorial choice. What was not legitimate is what
 * `saveAlerts` did about it: it rebuilt the stored matrix from `EVENTS` and
 * `{}`, so **every choice for an event the screen omits was deleted on save**.
 */

const SELLER_EVENTS = (Object.entries(EVENT_AUDIENCE) as [NotificationEvent, string][])
  .filter(([, audience]) => audience === "seller")
  .map(([event]) => event);

describe("T6.5 — saving keeps what the screen does not show", () => {
  it("writes the rendered rows from the form and leaves the rest alone", () => {
    const previous = {
      // Rendered: the form decides.
      enquiry_received: ["whatsapp", "email", "in_app"],
      // Not rendered: nothing on this screen has an opinion about it.
      weekly_digest: ["whatsapp", "email"],
      enquiry_unanswered: ["email"],
    };

    const next = nextRouting(previous, { enquiry_received: ["email", "in_app"] });

    expect(next["enquiry_received"]).toEqual(["email", "in_app"]);
    expect(next["weekly_digest"], "deleted on save before T6.5").toEqual([
      "whatsapp",
      "email",
    ]);
    expect(next["enquiry_unanswered"]).toEqual(["email"]);
  });

  it("lets a seller untick everything, which merging would have made a no-op", () => {
    /*
       The opposite defect, and the reason a rendered event is written whatever
       its length. `[]` is an explicit "nothing": `chosenChannels` reads it as a
       choice rather than as an absent value, so the platform floor still
       applies and `ROUTES_LIKE` inheritance stops.
    */
    const next = nextRouting({ review_posted: ["email", "whatsapp"] }, { review_posted: [] });
    expect(next["review_posted"]).toEqual([]);
  });

  it("copies rather than aliases, so a stored array cannot be mutated through it", () => {
    const stored = ["email"];
    const next = nextRouting({ subscription_renewed: stored }, {});
    next["subscription_renewed"]!.push("whatsapp");
    expect(stored).toEqual(["email"]);
  });

  it("renders every emitted seller event, and names the one it omits", () => {
    /*
       The guard that matters for the next event rather than this one. A new
       seller event appears in `EVENT_AUDIENCE` and somebody has to decide which
       group it joins; without this test the decision is made by not making it.

       T7.2 took the omissions from seven to two. The six it added were four
       floor-only events a seller received and could see no row for, and two —
       `subscription_renewed`, `review_dispute_decided` — a seller could not
       choose for at all. The two left are the two nothing emits; a row for
       either is a box nothing honours.
    */
    const shown = new Set<string>(EVENTS);
    const omitted = SELLER_EVENTS.filter((event) => !shown.has(event)).sort();

    // No emitter. `matrix.ts` says why each row was taken off the screen and the enum value kept.
    expect(omitted).toEqual(["enquiry_unanswered", "weekly_digest"]);
    for (const event of omitted) expect(isEmitted(event), event).toBe(false);
    for (const event of EVENTS) expect(isEmitted(event), event).toBe(true);
  });

  it("puts every row in exactly one group", () => {
    const flat = ALERT_GROUPS.flatMap((group) => [...group.events]);
    expect(new Set(flat).size).toBe(flat.length);
    expect(flat).toEqual([...EVENTS]);
  });

  it("says who every rendered row reaches", () => {
    // `GOES_TO` is the screen's own `GOES TO` column. A rendered row without an
    // entry renders a tick nobody can attribute to a handset.
    for (const event of EVENTS) expect(GOES_TO[event], event).toBeTruthy();
  });
});

/**
 * T7.2 — each group note is a sentence about the rules, so the rules hold it.
 *
 * The notes in `lib/i18n/en.ts` name which rows we always send. A note that
 * outlived a change to `PLATFORM_FLOOR` or `ALWAYS_IN_APP` would tell a seller
 * they cannot switch off something they can, or the reverse — which is the
 * defect the old single footnote had: it said "licence expiry" while the floor
 * held nine events.
 */
describe("T7.2 — the group notes say what the floor does", () => {
  const group = (key: string) => ALERT_GROUPS.find((g) => g.key === key)!.events as readonly (typeof EVENTS)[number][];
  const always = (event: (typeof EVENTS)[number], channel: "email" | "in_app") =>
    floorLocked(event, channel) || (channel === "in_app" && inAppLocked(event));

  it("leads and quotes: in app is locked on every row except an accepted quote", () => {
    const unlocked = group("leads_quotes").filter((event) => !always(event, "in_app"));
    expect(unlocked).toEqual(["quote_accepted"]);
  });

  it("listing: email and in app are locked for licence expiry and Ramadan dates, and nothing else", () => {
    const locked = group("listing").filter((event) => always(event, "email") && always(event, "in_app"));
    expect(locked).toEqual(["document_expiring", "ramadan_dates_moved"]);
    expect(group("listing").filter((event) => always(event, "email") !== always(event, "in_app"))).toEqual([]);
  });

  it("billing: email and in app are locked for a freed slot and both payment notices, and not for a renewal", () => {
    const locked = group("billing").filter((event) => always(event, "email") && always(event, "in_app"));
    expect(locked).toEqual(["placement_slot_freed", "payment_failed", "payment_final_notice"]);
    expect(always("subscription_renewed", "email")).toBe(false);
  });

  it("reviews: nothing is locked, so the group carries no note", () => {
    for (const event of group("reviews")) {
      expect(always(event, "email"), event).toBe(false);
      expect(always(event, "in_app"), event).toBe(false);
    }
  });
});
