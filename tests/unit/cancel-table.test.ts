import { describe, expect, it } from "vitest";
import {
  consequenceTable,
  lastPaidDay,
  whatChanges,
  type CancelFacts,
} from "@/lib/billing/cancel-table";
import type { PlanCaps } from "@/lib/plan/entitlements";

/**
 * Board 11h's consequence table, without a database.
 *
 * The arithmetic is the screen, so this is where its acceptance criteria are
 * actually checkable: every `ON FREE` figure from the plan-limit config,
 * every date from one period-end value, and a mark that is derived rather than
 * decided by whoever wrote the row.
 */

function plan(over: Partial<PlanCaps> = {}): PlanCaps {
  return {
    id: "pro",
    name: "Pro",
    monthlyPriceAed: 299,
    enquiriesPerMonth: null,
    productLimit: null,
    serviceLimit: null,
    locationLimit: null,
    photoLimit: null,
    publicPhotoLimit: null,
    categoryLimit: null,
    storageMb: null,
    teamSeats: 10,
    rankingMultiplier: 1.4,
    customDomain: true,
    analytics: true,
    csvImport: true,
    sponsoredEligible: true,
    sortOrder: 3,
    ...over,
  };
}

const FREE = plan({
  id: "free",
  name: "Free",
  monthlyPriceAed: 0,
  enquiriesPerMonth: 3,
  productLimit: 10,
  serviceLimit: 10,
  locationLimit: 1,
  storageMb: 512,
  teamSeats: 1,
  rankingMultiplier: 1,
  customDomain: false,
  analytics: false,
  csvImport: false,
  sponsoredEligible: false,
  sortOrder: 1,
});

/** The board's own seller: 1,204 products, 4 branches, 3 seats, 2.1 GB, 86 last month. */
const FACTS: CancelFacts = {
  plan: plan(),
  free: FREE,
  usage: { products: 1204, locations: 4, photos: 0, categories: 0, seats: 3, storageMb: 2150 },
  freeStartsOn: new Date("2026-09-14T00:00:00.000Z"),
  enquiriesLastMonth: 86,
  verified: true,
  reviewCount: 42,
  domain: "shop.alwaha.ae",
  storefrontUrl: "businesslistings.ae/b/al-waha",
  csvImportLastUsedAt: new Date("2026-09-02T00:00:00.000Z"),
  placement: { label: "Top slot · Valves, Dubai", endsOn: new Date("2026-09-30T00:00:00.000Z") },
};

const row = (facts: CancelFacts, key: string) =>
  consequenceTable(facts).find((entry) => entry.key === key);

describe("the table claims every area", () => {
  it("has twelve rows, storage and CSV import among them", () => {
    /*
       The board's third correction. A table that claims every area cannot omit
       the two this seller's account most depends on: 1,204 products arrived
       through the importer, and 2.1 GB of photos sit above a 0.5 GB cap.
    */
    const keys = consequenceTable(FACTS).map((entry) => entry.key);
    expect(keys).toHaveLength(12);
    expect(keys).toContain("storage");
    expect(keys).toContain("csv_import");
  });

  it("leads with the listing and the badge", () => {
    // The question sellers actually ask, answered first rather than in a note.
    expect(consequenceTable(FACTS)[0]?.key).toBe("listing");
    expect(row(FACTS, "listing")?.mark).toBe("unchanged");
    expect(row(FACTS, "listing")?.free).toContain("licence");
  });
});

describe("criterion 3 — every ON FREE figure comes from the config", () => {
  it("reads the caps rather than the board's numbers", () => {
    expect(row(FACTS, "products")?.freeLead).toContain("10");
    expect(row(FACTS, "branches")?.freeLead).toContain("1");
    expect(row(FACTS, "seats")?.freeLead).toContain("1");
    expect(row(FACTS, "enquiries")?.freeLead).toContain("3");
  });

  it("moves with the config and not with this file", () => {
    /*
       The whole of `B1`. Five boards read one tier table and this is the only
       one where a seller acts on it irreversibly, so the numbers have to come
       from the plan-limit config — change the config and the screen changes.
    */
    const generous = { ...FACTS, free: plan({ ...FREE, productLimit: 400 }) };
    expect(row(generous, "products")?.freeLead).toContain("400");
    expect(row(generous, "products")?.free).toContain("804");
  });

  it("never keeps more than the seller has", () => {
    // A Free cap of ten against four live products keeps four, and the row
    // says the products are unchanged rather than that ten of them stay.
    const small = { ...FACTS, usage: { ...FACTS.usage, products: 4 } };
    expect(row(small, "products")?.mark).toBe("unchanged");
    expect(row(small, "products")?.freeLead).toBeNull();
  });
});

describe("criterion 4 — the marks are computed, and colour carries nothing", () => {
  it("marks a shortfall reduced and an absent entitlement ended", () => {
    expect(row(FACTS, "products")?.mark).toBe("reduced");
    expect(row(FACTS, "storage")?.mark).toBe("reduced");
    expect(row(FACTS, "analytics")?.mark).toBe("ends");
    expect(row(FACTS, "csv_import")?.mark).toBe("ends");
    expect(row(FACTS, "reviews")?.mark).toBe("unchanged");
    expect(row(FACTS, "invoices")?.mark).toBe("unchanged");
  });

  it("stops saying ends the moment Free carries the entitlement", () => {
    // Derived, not written down. Nobody edits this file to move the row.
    const withAnalytics = { ...FACTS, free: plan({ ...FREE, analytics: true }) };
    expect(row(withAnalytics, "analytics")?.mark).toBe("unchanged");
  });

  it("names the mark in the row rather than only colouring it", () => {
    // The screen renders three distinct shapes plus a stated key, and every
    // row's mark is a value rather than a class name.
    for (const entry of consequenceTable(FACTS)) {
      expect(["unchanged", "reduced", "ends"]).toContain(entry.mark);
    }
  });
});

describe("what the seller picks between", () => {
  it("offers a choice on products, branches and seats", () => {
    expect(row(FACTS, "products")?.choose).toBe("products");
    expect(row(FACTS, "branches")?.choose).toBe("locations");
    expect(row(FACTS, "seats")?.choose).toBe("seats");
  });

  it("offers none on storage, which does not resolve into a list", () => {
    /*
       Q4, and the same answer `shortfallsOf` gives on the downgrade path. A
       gigabyte is not a row somebody can tick, so the cell states the shortfall
       and says nothing is deleted — which is true whichever way Q4 lands.
    */
    expect(row(FACTS, "storage")?.choose).toBeNull();
    expect(row(FACTS, "storage")?.free).toContain("1.6 GB");
  });

  it("renders storage through the formatter `11f` and `3m` already use", () => {
    /*
       The board draws the Free cap as `0.5 GB` and this renders `512 MB`, which
       is the same number through `formatStorage` — the function board 11f's
       comparison grid and board 3m's usage meter both call. Forking it so one
       screen rounds to a decimal gigabyte and two others do not is how a seller
       comes to read three storage figures and wonder which is theirs. Exact
       beats rounded on the screen somebody acts on irreversibly.
    */
    expect(row(FACTS, "storage")?.freeLead).toBe("512 MB");
    expect(row(FACTS, "storage")?.now).toBe("2.1 GB used");
  });

  it("offers none on enquiries, which is an allowance and not a set", () => {
    expect(row(FACTS, "enquiries")?.choose).toBeNull();
  });
});

describe("the rows that state a consequence the seller will not have", () => {
  it("says a domain that does not exist is unchanged, rather than ending", () => {
    /*
       Interface honesty. A consequence table listing a consequence that cannot
       happen to this account is the padding rule wearing a different hat.
    */
    const noDomain = { ...FACTS, domain: null };
    expect(row(noDomain, "custom_domain")?.mark).toBe("unchanged");
    expect(row(noDomain, "custom_domain")?.now).toBe("Not in use");
  });

  it("names the address the storefront reverts to whenever there is a domain", () => {
    // Never the first half alone: a domain that stops resolving with no
    // replacement named breaks every printed card and every backlink silently.
    expect(row(FACTS, "custom_domain")?.free).toContain("businesslistings.ae/b/al-waha");
  });

  it("says the placement ends with the subscription, on the subscription's date", () => {
    /*
       D2, 9 Sep 2026, and this test used to assert the opposite in its own
       name: "the booking's date, not the subscription's".

       The row said the placement "runs to 30 Sep 2026 under its own term" and
       was stamped `ends` — a red cross with the word "Ends" in its accessible
       text — because Free is not sponsored-eligible and the mark was therefore
       always `ends`. One row, two answers. This test asserted the sentence, and
       asserted the mark only for the *absent* placement, which is the gap the
       contradiction shipped through.

       Both halves now, on the row that has a placement.
    */
    const sponsored = row(FACTS, "sponsored");
    // 14 Sep is `freeStartsOn`. 30 Sep was the slot's own term and is gone.
    expect(sponsored?.free).toContain("14 Sep 2026");
    expect(sponsored?.free).not.toContain("30 Sep 2026");
    expect(sponsored?.free).not.toContain("own term");
    expect(sponsored?.mark).toBe("ends");
    // And the seller is told the unused days come back, because they do.
    expect(sponsored?.free).toContain("credit");

    // No placement is still no change, which is a different row and a different
    // sentence rather than this one with a null in it.
    expect(row({ ...FACTS, placement: null }, "sponsored")?.mark).toBe("unchanged");
  });
});

describe("the rail restates the table rather than deriving its own version", () => {
  it("carries only what actually changes", () => {
    const lines = whatChanges(consequenceTable(FACTS));
    expect(lines).toHaveLength(4);
    expect(lines.every((line) => line.mark !== "unchanged")).toBe(true);
  });

  it("returns the same objects the table rendered", () => {
    // The board headed these `WHAT YOU CONFIRMED` above four things the seller
    // had only read. They are the same rows now, not a second computation.
    const rows = consequenceTable(FACTS);
    expect(rows).toContain(whatChanges(rows)[0]);
  });

  it("is empty for a seller Free already holds everything of", () => {
    const tiny: CancelFacts = {
      ...FACTS,
      usage: { products: 2, locations: 1, photos: 0, categories: 0, seats: 1, storageMb: 10 },
      enquiriesLastMonth: 1,
      domain: null,
      placement: null,
      free: plan({ ...FREE, analytics: true, csvImport: true, enquiriesPerMonth: null }),
    };
    expect(whatChanges(consequenceTable(tiny))).toHaveLength(0);
  });
});

describe("criterion 1 — one date, and the other derived from it", () => {
  it("puts the paid period one day before Free starts", () => {
    /*
       *"Pro is paid to 13 September and runs to 13 September. Free starts 14
       September."* One value on the subscription and one subtraction, so there
       is no second date to keep in step and nothing to hardcode.
    */
    expect(lastPaidDay(new Date("2026-09-14T00:00:00.000Z")).toISOString()).toBe(
      "2026-09-13T00:00:00.000Z",
    );
  });

  it("crosses a month boundary without special-casing it", () => {
    expect(lastPaidDay(new Date("2026-10-01T00:00:00.000Z")).toISOString()).toBe(
      "2026-09-30T00:00:00.000Z",
    );
  });
});

describe("the enquiry row", () => {
  it("states the seller's own last month against the Free allowance", () => {
    expect(row(FACTS, "enquiries")?.now).toContain("86");
    expect(row(FACTS, "enquiries")?.freeLead).toContain("3");
  });

  it("states the current cap where the plan has one rather than saying unlimited", () => {
    const capped = { ...FACTS, plan: plan({ enquiriesPerMonth: 25 }) };
    expect(row(capped, "enquiries")?.now).toContain("25");
  });
});
