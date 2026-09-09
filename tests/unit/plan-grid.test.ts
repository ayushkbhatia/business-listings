import { describe, expect, it } from "vitest";
import { formatStorage, keepsOf, planGrid, shortfallsOf, type Usage } from "@/lib/billing/plan-grid";
import type { PlanCaps } from "@/lib/plan/entitlements";

/**
 * Board 11f's grid, which is nine rows of arithmetic over the plan-limit config.
 *
 * Criterion 4 lives here: *"Every cell in the comparison grid states what that
 * plan keeps out of what the seller has now. One denominator per row."*
 */

function plan(over: Partial<PlanCaps> = {}): PlanCaps {
  return {
    id: "basic",
    name: "Basic",
    monthlyPriceAed: 99,
    enquiriesPerMonth: 25,
    productLimit: 100,
    locationLimit: 2,
    photoLimit: 40,
    publicPhotoLimit: null,
    categoryLimit: 3,
    storageMb: 5 * 1024,
    teamSeats: 2,
    rankingMultiplier: 1.15,
    customDomain: false,
    analytics: true,
    csvImport: true,
    sponsoredEligible: false,
    sortOrder: 1,
    ...over,
  };
}

const FREE = plan({
  id: "free",
  name: "Free",
  monthlyPriceAed: 0,
  enquiriesPerMonth: 3,
  productLimit: 10,
  locationLimit: 1,
  teamSeats: 1,
  storageMb: 1024,
  analytics: false,
  csvImport: false,
  sortOrder: 0,
});

const BASIC = plan();

const PRO = plan({
  id: "pro",
  name: "Pro",
  monthlyPriceAed: 299,
  enquiriesPerMonth: null,
  productLimit: null,
  locationLimit: null,
  photoLimit: null,
  categoryLimit: null,
  teamSeats: 5,
  storageMb: 10 * 1024,
  customDomain: true,
  sponsoredEligible: true,
  sortOrder: 2,
});

const PLANS = [FREE, BASIC, PRO];

/** The seller on the board: 1,204 products, 4 branches, 3 seats, 2.1 GB. */
const USAGE: Usage = {
  products: 1204,
  locations: 4,
  photos: 46,
  categories: 5,
  seats: 3,
  storageMb: Math.round(2.1 * 1024),
};

const cellsFor = (key: string) => {
  const row = planGrid(PLANS, USAGE).find((candidate) => candidate.key === key);
  if (!row) throw new Error(`no row ${key}`);
  return row.cells;
};

describe("criterion 4 — one denominator per row", () => {
  it("counts every metered cell against the seller's own usage", () => {
    /*
       The board's first correction. Team seats read `1 of 3` on Free, `2 of 3`
       on Basic and `3 of 5 used` on Pro — the first two against the seller's
       three seats and the third against Pro's cap of five. A reader comparing
       across was comparing nothing.

       Pro holds five seats and the seller has three, so Pro keeps three. Not
       five, and never a denominator of five.
    */
    const seats = cellsFor("seats");
    expect(seats.map((cell) => cell.keeps)).toEqual([1, 2, 3]);
    expect(seats[2]?.label).toBe("All 3");
    expect(seats.every((cell) => !cell.label.includes("5"))).toBe(true);
  });

  it("never claims a plan keeps more than the seller has", () => {
    // The property the correction is an instance of, over every metered row.
    for (const key of ["products", "locations", "seats", "storage"]) {
      for (const cell of cellsFor(key)) {
        expect(cell.keeps).not.toBeNull();
        expect(cell.keeps ?? 0).toBeLessThanOrEqual(
          key === "products"
            ? USAGE.products
            : key === "locations"
              ? USAGE.locations
              : key === "seats"
                ? USAGE.seats
                : USAGE.storageMb,
        );
      }
    }
  });

  it("renders the board's products row", () => {
    expect(cellsFor("products").map((cell) => cell.label)).toEqual([
      "10 of 1,204",
      "100 of 1,204",
      "All 1,204",
    ]);
  });

  it("renders the board's branches row", () => {
    expect(cellsFor("locations").map((cell) => cell.label)).toEqual([
      "1 of 4",
      "2 of 4",
      "All 4",
    ]);
  });

  it("puts storage in the same frame, in its own unit", () => {
    /*
       Q4, and the board's second correction. The Free column read
       `0.5 GB · 1.6 over`, which is a different frame from every other row and
       has no `Choose` beside it. Stated as what the plan keeps of what the
       seller has, the row compares across like the other three — and the
       shortfall stays visible, because 1 GB of 2.1 GB is exactly as legible as
       "1.1 over" and reads the same way as the row above it.
    */
    expect(cellsFor("storage").map((cell) => cell.label)).toEqual([
      "1 GB of 2.1 GB",
      "All 2.1 GB",
      "All 2.1 GB",
    ]);
  });
});

describe("entitlements are not caps of nought", () => {
  it("states enquiries as a monthly allowance, not as a shortfall", () => {
    // Metered in the model and an entitlement on this screen: it resets every
    // month, so there is nothing to pick what to keep from. `3 of 86 enquiries`
    // would read as losing 83 the seller already has.
    const cells = cellsFor("enquiries");
    expect(cells.map((cell) => cell.label)).toEqual(["3 a month", "25 a month", "Unlimited"]);
    expect(cells.every((cell) => cell.keeps === null)).toBe(true);
  });

  it("renders the four on/off rows from the config", () => {
    // Criterion 5: no screen hardcodes a limit and no placeholder ships. Every
    // one of these is a `Plan` column.
    expect(cellsFor("analytics").map((cell) => cell.state)).toEqual([
      "absent",
      "included",
      "included",
    ]);
    expect(cellsFor("csv_import").map((cell) => cell.state)).toEqual([
      "absent",
      "included",
      "included",
    ]);
    expect(cellsFor("custom_domain").map((cell) => cell.state)).toEqual([
      "absent",
      "absent",
      "included",
    ]);
    expect(cellsFor("sponsored").map((cell) => cell.state)).toEqual([
      "absent",
      "absent",
      "included",
    ]);
  });

  it("draws eleven rows, six metered and five not", () => {
    /*
       Nine until D1, which added photographs and extra categories.

       `METERED` had carried both since board 3b and this grid rendered neither,
       so the screen a seller reads before changing plan could not show them two
       of the seven caps they are choosing between — and Free is tightest on
       exactly those two.
    */
    const grid = planGrid(PLANS, USAGE);
    expect(grid).toHaveLength(11);
    expect(grid.filter((row) => row.kind === "meter")).toHaveLength(6);
    expect(grid.filter((row) => row.kind === "entitlement")).toHaveLength(5);
  });
});

describe("shortfalls — what the seller chooses between", () => {
  const grid = planGrid(PLANS, USAGE);

  it("names only what the target plan holds less of", () => {
    /*
       Three rows on the board's rail, and storage is not one of them: Basic
       holds 5 GB and this seller stores 2.1 GB, so there is no shortfall to
       name. `100 of 1,204 products`, `2 of 4 branches`, `2 of 3 team seats`.
    */
    const shortfalls = shortfallsOf(grid, "basic", USAGE);
    expect(shortfalls.map((shortfall) => shortfall.key)).toEqual([
      "products",
      "locations",
      "photos",
      "categories",
      "seats",
    ]);
    expect(shortfalls.find((s) => s.key === "products")).toMatchObject({
      keeps: 100,
      used: 1204,
      choosable: true,
    });
  });

  it("finds nothing on the plan that holds everything", () => {
    // Pro keeps all four, so the panel does not render at all rather than
    // rendering four rows saying "all of them".
    expect(shortfallsOf(grid, "pro", USAGE)).toEqual([]);
  });

  it("does not offer to choose between photographs or categories", () => {
    /*
       D1 added both meters and `choosable` was `key !== "storage"`, which was
       true of the four rows that existed and became a lie the moment there were
       six. `SubscriptionChange` carries keep lists for products, locations and
       seats and for nothing else, so a picker for these two would be a control
       with nothing behind it — the seller is told, not asked.
    */
    const shortfalls = shortfallsOf(grid, "basic", USAGE);
    expect(shortfalls.find((s) => s.key === "photos")).toMatchObject({ choosable: false });
    expect(shortfalls.find((s) => s.key === "categories")).toMatchObject({ choosable: false });
    // And the three that do have one still do.
    for (const key of ["products", "locations", "seats"]) {
      expect(shortfalls.find((s) => s.key === key), key).toMatchObject({ choosable: true });
    }
  });

  it("marks storage as not choosable, on the plan that is short of it", () => {
    /*
       Q4, and the column the board flagged: Free holds 1 GB against 2.1 GB
       stored. A downgrade removes no files — the cap is enforced on upload, so
       an over-quota seller cannot add more until they are back under it. A
       `Choose` for storage would open a screen that could not do anything.
    */
    const shortfalls = shortfallsOf(grid, "free", USAGE);
    expect(shortfalls.map((s) => s.key)).toContain("storage");
    expect(shortfalls.find((s) => s.key === "storage")?.choosable).toBe(false);
    // The other three still are.
    expect(shortfalls.filter((s) => s.choosable).map((s) => s.key)).toEqual([
      "products",
      "locations",
      "seats",
    ]);
  });

  it("reads the grid rather than recomputing the caps", () => {
    // The pair of boards exists because two surfaces derived one number twice.
    // The panel and the table must not be able to disagree.
    const cell = cellsFor("products").find((c) => c.planId === "basic");
    const shortfall = shortfallsOf(grid, "basic", USAGE).find((s) => s.key === "products");
    expect(shortfall?.keeps).toBe(cell?.keeps);
  });
});

describe("keepsOf", () => {
  it("treats an unlimited cap as keeping everything", () => {
    expect(keepsOf(PRO, "products", 1204)).toBe(1204);
  });

  it("keeps the cap when the seller is over it", () => {
    expect(keepsOf(FREE, "products", 1204)).toBe(10);
  });

  it("keeps what the seller has when they are under it", () => {
    // Not the cap. `10 of 4 products stay live` is not a sentence.
    expect(keepsOf(FREE, "products", 4)).toBe(4);
  });
});

describe("formatStorage", () => {
  it("reads in gigabytes above a gigabyte, without a trailing zero", () => {
    expect(formatStorage(10 * 1024)).toBe("10 GB");
    expect(formatStorage(Math.round(2.1 * 1024))).toBe("2.1 GB");
  });

  it("stays in megabytes below one", () => {
    expect(formatStorage(640)).toBe("640 MB");
  });
});
