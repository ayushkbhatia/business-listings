import { describe, expect, it } from "vitest";
import {
  DELIVERY_MODES,
  businessCoverage,
  coverageReadiness,
  effectiveCoverage,
  emiratesCovered,
  framingFor,
  isDeliveryMode,
  travelsToClients,
  unionCoverage,
} from "./service-coverage";
import type { CoverageScope } from "./coverage";

/**
 * Board `2d-s` — the rules a services listing's coverage obeys, without a
 * database.
 *
 * Two of these tests pin behaviour that has no data behind it yet. There is no
 * `Service` model until stage 3, so nothing writes a per-service coverage row
 * today — and the union rule is precisely the one that is expensive to get
 * wrong later, because getting it backwards means a seller who narrows one
 * service silently shrinks their whole listing. It is cheaper to pin it now
 * than to discover it when the rows exist.
 */

const dubai: CoverageScope = { emirate: "dubai", areaId: null };
const sharjah: CoverageScope = { emirate: "sharjah", areaId: null };
const alAin: CoverageScope = { emirate: "abu_dhabi", areaId: "area-al-ain" };
const alQuoz: CoverageScope = { emirate: "dubai", areaId: "area-al-quoz" };

describe("how the work reaches the client", () => {
  it("offers three modes and no fourth", () => {
    // "Hybrid" is two of these ticked. A fourth value would be a second way to
    // say the same thing, and every reader would have to know both.
    expect(DELIVERY_MODES).toEqual(["remote", "at_our_office", "at_client_site"]);
  });

  it("rejects anything not on the list", () => {
    expect(isDeliveryMode("remote")).toBe(true);
    expect(isDeliveryMode("on_site")).toBe(false);
  });

  it("shows a distance affordance only where somebody actually travels — B8", () => {
    expect(travelsToClients(["remote", "at_our_office"])).toBe(false);
    expect(travelsToClients(["at_client_site"])).toBe(true);
  });

  it("reframes the areas by what the modes mean", () => {
    /*
       The ordering argument, as a function. Ask for emirates first and a
       remote-only practice reasonably ticks all eight — true, and useless.
    */
    expect(framingFor([])).toBe("unanswered");
    expect(framingFor(["remote"])).toBe("where_clients_are");
    expect(framingFor(["remote", "at_client_site"])).toBe("where_you_travel");
  });
});

describe("the publish gate — B2, AC3", () => {
  it("passes on one mode and one area", () => {
    const result = coverageReadiness({ deliveryModes: ["remote"], coverage: [dubai] });
    expect(result).toEqual({ ready: true, missing: [] });
  });

  it("names both when neither is answered, in the order the screen asks", () => {
    expect(coverageReadiness({ deliveryModes: [], coverage: [] }).missing).toEqual([
      "delivery_mode",
      "coverage_area",
    ]);
  });

  it("blocks on coverage alone when the mode is answered", () => {
    expect(coverageReadiness({ deliveryModes: ["remote"], coverage: [] })).toEqual({
      ready: false,
      missing: ["coverage_area"],
    });
  });

  it("asks for no coordinate anywhere", () => {
    /*
       The defect this whole board exists to avoid. `2d` gates publish on
       `lat`/`lng`; carried across unchanged it means a consultancy — which has
       no gate to pin — can never publish at all.
    */
    const ready = coverageReadiness({ deliveryModes: ["at_our_office"], coverage: [alAin] });
    expect(ready.ready).toBe(true);
  });
});

describe("inheritance — B5", () => {
  it("gives a service with no rows of its own the business default", () => {
    expect(effectiveCoverage([dubai, sharjah], [])).toEqual([dubai, sharjah]);
  });

  it("gives a narrowed service only its own rows", () => {
    expect(effectiveCoverage([dubai, sharjah], [dubai])).toEqual([dubai]);
  });

  it("follows the default when the default changes, because nothing was copied", () => {
    // The whole point of resolving at read time. A service stamped from the
    // default at write time would still say Dubai after the default moved.
    const before = effectiveCoverage([dubai], []);
    const after = effectiveCoverage([dubai, sharjah], []);
    expect(before).toHaveLength(1);
    expect(after).toHaveLength(2);
  });
});

describe("the union — B6", () => {
  it("is the union of the services, not the default line", () => {
    /*
       A practice that files VAT nationwide and audits only in Dubai covers
       both. Reading the default alone would be right here by accident; reading
       it *instead* of the union is what goes wrong when one service narrows.
    */
    const listing = businessCoverage([dubai], [[dubai, sharjah], [dubai]]);
    expect(listing).toHaveLength(2);
    expect(emiratesCovered(listing).sort()).toEqual(["dubai", "sharjah"]);
  });

  it("does not shrink the listing when one service is narrowed", () => {
    // The sentence in the spec, as a test. Narrowing the audit service to
    // Dubai must not take Sharjah off the listing, because VAT still covers it.
    const wide = businessCoverage([dubai, sharjah], [[dubai, sharjah], [dubai, sharjah]]);
    const narrowed = businessCoverage([dubai, sharjah], [[dubai, sharjah], [dubai]]);
    expect(emiratesCovered(narrowed).sort()).toEqual(emiratesCovered(wide).sort());
  });

  it("is the default when the business has no services yet", () => {
    // Which is every services seller the moment they finish this screen, and
    // the state the whole directory is in today.
    expect(businessCoverage([dubai, alAin])).toEqual([dubai, alAin]);
  });

  it("lets an emirate-wide claim swallow the areas inside it", () => {
    // A buyer filtering for Al Quoz already matches a supplier covering Dubai.
    // Two chips saying that is the same claim rendered twice.
    expect(unionCoverage([[dubai], [alQuoz]])).toEqual([dubai]);
  });

  it("never widens three areas into an emirate", () => {
    // The reverse is not symmetric. Collapsing area rows upward would state a
    // claim the seller did not make.
    const areas = [alQuoz, { emirate: "dubai", areaId: "area-deira" } as CoverageScope];
    expect(unionCoverage([areas])).toHaveLength(2);
  });

  it("counts one scope once however many services claimed it", () => {
    expect(unionCoverage([[dubai], [dubai], [dubai]])).toEqual([dubai]);
  });

  it("keeps Al Ain, which is an area and not an emirate — B3", () => {
    /*
       AC4. Al Ain sits under Abu Dhabi, so a firm covering Al Ain and not Abu
       Dhabi city keeps its distinct claim; a firm covering the emirate entire
       has Al Ain swallowed by it, which is correct.
     */
    expect(unionCoverage([[alAin]])).toEqual([alAin]);
    expect(unionCoverage([[{ emirate: "abu_dhabi", areaId: null }], [alAin]])).toEqual([
      { emirate: "abu_dhabi", areaId: null },
    ]);
  });
});
