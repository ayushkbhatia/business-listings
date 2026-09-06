import { describe, expect, it } from "vitest";
import { refusesPublish, roomLeft } from "./catalogue-query";

/**
 * The fence on bulk publish.
 *
 * Every other path into `live` already respects the plan's product cap — the
 * CSV importer refuses an over-cap file, the onboarding sheet returns `at_cap`
 * — and a bulk publish that did not would be the widest hole in the ladder,
 * two clicks from a screen that shows the cap in its own header.
 */

describe("publishing against a plan's product cap", () => {
  it("never refuses a plan that caps nothing", () => {
    expect(refusesPublish({ cap: null, listed: 9_000, adding: 500 })).toBe(false);
    expect(roomLeft({ cap: null, listed: 9_000, adding: 500 })).toBeNull();
  });

  it("allows a selection that fits exactly", () => {
    expect(refusesPublish({ cap: 10, listed: 7, adding: 3 })).toBe(false);
    expect(roomLeft({ cap: 10, listed: 7, adding: 3 })).toBe(3);
  });

  it("refuses one more than fits", () => {
    expect(refusesPublish({ cap: 10, listed: 7, adding: 4 })).toBe(true);
  });

  it("refuses anything at all once the cap is reached", () => {
    expect(refusesPublish({ cap: 10, listed: 10, adding: 1 })).toBe(true);
    expect(roomLeft({ cap: 10, listed: 10, adding: 1 })).toBe(0);
  });

  it("reports no room rather than negative room after a downgrade", () => {
    /*
       A plan drop can legitimately leave a seller over their cap — nothing is
       deleted, the overflow is unlisted — and "you have -1,232 products left"
       is not a sentence. They are refused any addition and can unpublish their
       way back, which is the picker the spec asks for made out of controls this
       screen already has.
    */
    expect(roomLeft({ cap: 10, listed: 1_242, adding: 1 })).toBe(0);
    expect(refusesPublish({ cap: 10, listed: 1_242, adding: 1 })).toBe(true);
  });

  it("counts only what is not already live", () => {
    // The action passes `adding` as the non-live rows in the selection, so
    // selecting a whole page of live products and pressing Publish is a no-op
    // rather than a refusal.
    expect(refusesPublish({ cap: 10, listed: 10, adding: 0 })).toBe(false);
  });
});
