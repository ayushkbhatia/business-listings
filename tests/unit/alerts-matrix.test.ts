import { describe, expect, it } from "vitest";
import { EVENTS, GOES_TO, nextRouting } from "@/app/(dashboard)/dashboard/settings/matrix";
import { EVENT_AUDIENCE } from "@/lib/notify/params";
import { PLATFORM_FLOOR, type NotificationEvent } from "@/lib/notify/routing";

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
      subscription_renewed: ["whatsapp", "email"],
      review_dispute_decided: ["email"],
    };

    const next = nextRouting(previous, { enquiry_received: ["email", "in_app"] });

    expect(next["enquiry_received"]).toEqual(["email", "in_app"]);
    expect(next["subscription_renewed"], "deleted on save before T6.5").toEqual([
      "whatsapp",
      "email",
    ]);
    expect(next["review_dispute_decided"]).toEqual(["email"]);
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

  it("names every seller event it omits, so none is omitted by accident", () => {
    /*
       The guard that matters for the next event rather than this one. A new
       seller event appears in `EVENT_AUDIENCE` and somebody has to decide
       whether it belongs on this screen; without this test the decision is made
       by not making it, and the event routes to whatever the floor says — or to
       nothing.

       Seven today. Four of them are on `PLATFORM_FLOOR`, which puts their
       channels back whatever the matrix says, so the seller still hears. The
       other three are the ones a seller cannot choose for at all, and each is
       listed with why that is currently acceptable.
    */
    const shown = new Set<string>(EVENTS);
    const omitted = SELLER_EVENTS.filter((event) => !shown.has(event)).sort();

    expect(omitted).toEqual(
      [
        /*
           On the floor, so the seller hears whatever the matrix says — the
           screen renders them nowhere because there is nothing to choose.
        */
        "payment_failed",
        "payment_final_notice",
        "placement_slot_freed",
        "ramadan_dates_moved",
        /*
           Not on the floor, and not choosable. Each is a real gap and T6.5 is
           what stops it being a *destructive* one:

           · `subscription_renewed` — a receipt. It routes on whatever the
             seller last stored, which is now preserved rather than deleted.
           · `enquiry_unanswered` — no emitter at all; `matrix.ts` says why the
             row was taken off the screen and the enum value kept.
           · `review_dispute_decided` — the rail promises the outcome is "sent
             to you", and the channel for it is not the seller's to set yet.
        */
        "enquiry_unanswered",
        "review_dispute_decided",
        "subscription_renewed",
      ].sort(),
    );

    const unreachable = omitted.filter((event) => !PLATFORM_FLOOR[event]);
    expect(unreachable.sort()).toEqual([
      "enquiry_unanswered",
      "review_dispute_decided",
      "subscription_renewed",
    ]);
  });

  it("says who every rendered row reaches", () => {
    // `GOES_TO` is the screen's own `GOES TO` column. A rendered row without an
    // entry renders a tick nobody can attribute to a handset.
    for (const event of EVENTS) expect(GOES_TO[event], event).toBeTruthy();
  });
});
