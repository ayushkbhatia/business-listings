import { describe, expect, it } from "vitest";
import {
  EVENT_PARAMS,
  isEmitted,
  paramsFor,
  placeholdersIn,
  unknownPlaceholders,
} from "./params";

/**
 * The authoring-time half of a send-time rule.
 *
 * `render()` refuses a placeholder with no value — "a notification with a hole
 * in it is worse than one that did not send" — and until this existed, the only
 * way to discover a template referenced something its event does not supply was
 * for a seller not to get told something.
 */

describe("finding placeholders", () => {
  it("reads them out of every part a template has", () => {
    expect(placeholdersIn("Hello {name}", "Re: {ref}", "Open {shortLink}")).toEqual([
      "name",
      "ref",
      "shortLink",
    ]);
  });

  it("counts a repeated one once", () => {
    expect(placeholdersIn("{ref} and {ref} again")).toEqual(["ref"]);
  });

  it("ignores braces that are not placeholders", () => {
    expect(placeholdersIn("Costs {} or {not-a-name} or { spaced }")).toEqual([]);
  });

  it("takes null and undefined parts, because subject is optional", () => {
    expect(placeholdersIn("{ref}", null, undefined)).toEqual(["ref"]);
  });
});

describe("what an event supplies", () => {
  it("names the params the enquiry event actually passes", () => {
    expect(paramsFor("enquiry_received")).toContain("summary");
    expect(paramsFor("enquiry_received")).toContain("closesAt");
  });

  it("knows which events nothing emits yet", () => {
    /*
     * The rest are declared in the enum, seeded with templates, and sent by
     * nothing — which is not a bug, but staff should know before spending an
     * afternoon on the copy.
     *
     * `subscription_renewed`, `setup_nudge`, `enquiry_escalated`,
     * `quote_expiring` and `document_expiring` are sent from a schedule rather
     * than from a request. Every other
     * emitted event is sent by the service that did the work; these are sent by
     * a cron, which is why each carries its own exactly-once guard —
     * `notify()` deduplicates nothing.
     *
     * `enquiry_escalated` had a seeded email template and no emitter from
     * handoff 4 until board 8d, which put the sentence promising it on the
     * invite screen and then had to build the sweep behind it.
     */
    const emitted = (Object.keys(EVENT_PARAMS) as (keyof typeof EVENT_PARAMS)[]).filter(isEmitted);
    expect([...emitted].sort()).toEqual([
      /*
         Board 3e §5, and the fifth event sent from a schedule. It was declared
         in the enum and seeded with a live email template from handoff 1, and
         emitted by nothing for the whole of it — so the verification screen
         promised a sixty-day warning that no job sent, and the first a supplier
         heard about a lapse was the badge going. `lib/verification/
         licence-notice-job.ts` carries the exactly-once guard, per stage.
      */
      "document_expiring",
      "enquiry_escalated",
      "enquiry_received",
      // Board 11b's follow-up. The first message-shaped notification in the
      // product: everything else here is about a quote, because a message was
      // assumed to be read where it was written — and a buyer who has gone
      // quiet is by definition not looking at the thread.
      "message_received",
      "quote_accepted",
      /*
         Board 7e §2's added row, and the fourth event sent from a schedule.
         Board 3k shipped the expiry window, the `Expiring soon` tab and the
         extend action with nothing notifying any of it, so the only way a
         seller met a deadline was by opening the screen — which means the
         quotes that lapsed belonged to the sellers who were busy.
         `lib/quotes/expiry-job.ts` carries its own exactly-once guard, like the
         other three, because `notify()` deduplicates nothing.
      */
      "quote_expiring",
      "quote_received",
      "quote_revised",
      /*
         Board 3d's fifth event from a schedule. The Ramadan card promises the
         platform shifts its own estimated dates and emails the seller when
         they move, and a promise in shipped copy with no emitter is the
         unowned-commitment shape board 4e Q2 already got wrong.
         `lib/trade/ramadan-shift-job.ts` carries the exactly-once guard.
      */
      "ramadan_dates_moved",
      "setup_nudge",
      "subscription_renewed",
    ]);
  });

  it("covers every event in the enum, so none is missing a row", () => {
    // `satisfies Record<NotificationEvent, …>` enforces this at compile time;
    // this fails loudly if somebody widens the enum and the type is loosened.
    expect(Object.keys(EVENT_PARAMS)).toHaveLength(16);
  });

  it("does not claim to emit the alert it only records", () => {
    /*
       Handoff 5 step 6 added `product_alert_matched` and this test caught it
       claiming to be emitted, because declaring params is what `isEmitted`
       reads. `sweepAlerts` matches and records; it does not send. `notify` is
       seller-shaped and there are no buyer-side preferences yet, so the honest
       state is "declared, nothing sends it" — which the notifications screen
       already has a word for.
    */
    expect(isEmitted("product_alert_matched")).toBe(false);
  });
});

describe("catching the hole before it sends", () => {
  it("names a placeholder the event does not supply", () => {
    expect(unknownPlaceholders("quote_accepted", "Your quote {quoteRef} for {summary}")).toEqual([
      "summary",
    ]);
  });

  it("passes a template that only uses what it is given", () => {
    expect(
      unknownPlaceholders(
        "enquiry_received",
        "New enquiry {ref} — {summary}",
        "Closes {closesAt}",
        "Open it {shortLink}",
      ),
    ).toEqual([]);
  });

  it("treats every placeholder as unknown on an event nothing emits", () => {
    // Nothing supplies params, so nothing can be substituted. A template here
    // would fail at send time on its first placeholder.
    expect(unknownPlaceholders("weekly_digest", "Your week: {count} enquiries")).toEqual(["count"]);
  });

  it("passes a template with no placeholders at all", () => {
    expect(unknownPlaceholders("weekly_digest", "Your weekly digest is ready.")).toEqual([]);
  });
});
