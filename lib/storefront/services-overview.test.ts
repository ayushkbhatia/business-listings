import { describe, expect, it } from "vitest";
import {
  OVERVIEW_CREDENTIALS,
  carriesCounts,
  composerService,
  declaredSectors,
  heroCredential,
  overviewCredentials,
} from "./services-overview";

/** Board `1d-s` — the rules under the storefront a firm that sells work gets. */

describe("declaredSectors — B8", () => {
  it("keeps the firm's order and joins counts on the matching form", () => {
    expect(
      declaredSectors(
        ["Construction & contracting", "Free Zone entities", "Real estate"],
        [
          { sectorSlug: "free zone entities", engagements: 19 },
          { sectorSlug: "construction & contracting", engagements: 41 },
        ],
      ),
    ).toEqual([
      { label: "Construction & contracting", engagements: 41 },
      { label: "Free Zone entities", engagements: 19 },
      { label: "Real estate", engagements: null },
    ]);
  });

  it("drops a count whose sector is no longer listed", () => {
    expect(
      declaredSectors(["Trading"], [{ sectorSlug: "hospitality", engagements: 12 }]),
    ).toEqual([{ label: "Trading", engagements: null }]);
  });

  it("never reads a zero as a declaration", () => {
    expect(declaredSectors(["Trading"], [{ sectorSlug: "trading", engagements: 0 }])).toEqual([
      { label: "Trading", engagements: null },
    ]);
  });

  it("owes the disclaimer only where a number is printed", () => {
    expect(carriesCounts([{ label: "Trading", engagements: null }])).toBe(false);
    expect(carriesCounts([{ label: "Trading", engagements: 3 }])).toBe(true);
    expect(carriesCounts([])).toBe(false);
  });
});

describe("overviewCredentials", () => {
  it("shows four and counts the rest — the typical state", () => {
    const rows = ["a", "b", "c", "d", "e", "f"];
    expect(overviewCredentials(rows)).toEqual({ shown: ["a", "b", "c", "d"], more: 2 });
    expect(OVERVIEW_CREDENTIALS).toBe(4);
  });

  it("has nothing behind the link at or under the cut — the one-credential state", () => {
    expect(overviewCredentials(["a"])).toEqual({ shown: ["a"], more: 0 });
    expect(overviewCredentials(["a", "b", "c", "d"]).more).toBe(0);
  });
});

describe("heroCredential — B3", () => {
  it("names only a register-verified credential, never a claim", () => {
    expect(heroCredential([{ id: "claim", verified: false }])).toBeNull();
    expect(
      heroCredential([
        { id: "claim", verified: false },
        { id: "checked", verified: true },
      ]),
    ).toEqual({ id: "checked", verified: true });
  });

  it("drops a checked credential the day after its confirmed date — 6a-s B4", () => {
    const today = new Date("2026-09-24T00:00:00.000Z");
    const lapsed = { id: "lapsed", verified: true, expiresOn: new Date("2026-09-23T00:00:00.000Z") };
    const lastDay = { id: "last-day", verified: true, expiresOn: new Date("2026-09-24T00:00:00.000Z") };
    expect(heroCredential([lapsed], today)).toBeNull();
    expect(heroCredential([lapsed, lastDay], today)).toEqual(lastDay);
    // No date is not a lapse: the register confirmed no end.
    expect(heroCredential([{ id: "open", verified: true, expiresOn: null }], today)?.id).toBe("open");
  });
});

describe("composerService — B11", () => {
  const services = [{ slug: "statutory-audit" }, { slug: "vat-return-filing" }];

  it("prefills the service the buyer arrived from", () => {
    expect(composerService(services, "vat-return-filing")).toBe("vat-return-filing");
  });

  it("defaults to the firm's first service otherwise", () => {
    expect(composerService(services, undefined)).toBe("statutory-audit");
  });

  it("falls through to the first when the link names a draft or a deleted service", () => {
    expect(composerService(services, "transfer-pricing-documentation")).toBe("statutory-audit");
  });

  it("has nothing to prefill when nothing is live", () => {
    expect(composerService([], "statutory-audit")).toBeNull();
  });
});
