import { describe, expect, it } from "vitest";
import {
  BAND_COUNT,
  CLICK_WEIGHT,
  DEFAULT_BASE_PRICE_AED,
  DEFAULT_STEP_BPS,
  MAX_BAND,
  MIN_BAND,
  bandScopes,
  generateCard,
  priceForBand,
  scoreOf,
  type ScopeSignal,
} from "./bands";

/**
 * Board `11e`'s pricing ladder, tested without a database.
 *
 * Two things here decide what a seller is charged and both are easy to get
 * subtly wrong: the ratified curve — AED 300 at the floor, rising a tenth a
 * band — and the rule that a scope nobody has visited sits at the floor rather
 * than wherever a decile over a list of zeroes happens to put it.
 */

function scope(over: Partial<ScopeSignal> & { categoryId: string }): ScopeSignal {
  return { emirate: null, appearances: 0, clicks: 0, ...over };
}

describe("the ratified curve", () => {
  it("starts at AED 300 and rises a tenth a band", () => {
    expect(priceForBand(1)).toBe(300);
    expect(priceForBand(2)).toBe(330);
    expect(priceForBand(3)).toBe(363);
    expect(priceForBand(10)).toBe(707);
  });

  it("generates ten rungs and no eleventh", () => {
    const card = generateCard();
    expect(card).toHaveLength(BAND_COUNT);
    expect(card.map((rung) => rung.band)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(card.map((rung) => rung.monthlyPriceAed)).toEqual([
      300, 330, 363, 399, 439, 483, 531, 585, 643, 707,
    ]);
  });

  it("clamps a band outside the ladder rather than extrapolating a price", () => {
    expect(priceForBand(0)).toBe(priceForBand(MIN_BAND));
    expect(priceForBand(99)).toBe(priceForBand(MAX_BAND));
  });

  it("regenerates from a base and a step the owner can move", () => {
    // The point of the two being rows: the floor and the step are a commercial
    // decision, and moving either regenerates the ladder rather than needing
    // ten numbers retyped.
    expect(priceForBand(1, 500, DEFAULT_STEP_BPS)).toBe(500);
    expect(priceForBand(2, 500, DEFAULT_STEP_BPS)).toBe(550);
    expect(priceForBand(2, DEFAULT_BASE_PRICE_AED, 2000)).toBe(360);
    // A step of zero is a flat rate, which is what the product had before this.
    expect(generateCard(450, 0).every((rung) => rung.monthlyPriceAed === 450)).toBe(true);
  });
});

describe("what a scope scores", () => {
  it("weights a click far above an appearance", () => {
    // A buyer shown the page against a buyer who acted on it.
    expect(scoreOf({ appearances: 100, clicks: 0 })).toBe(100);
    expect(scoreOf({ appearances: 0, clicks: 10 })).toBe(10 * CLICK_WEIGHT);
  });
});

describe("cutting the scopes into bands", () => {
  it("holds a scope nobody has visited at the floor", () => {
    /*
       The defect this exists to stop: a decile over a list that is mostly
       zeroes puts a page nobody has ever opened in band 7, because it ties with
       the seventh decile rather than because anybody looked at it.
    */
    const banded = bandScopes([
      scope({ categoryId: "quiet-a" }),
      scope({ categoryId: "quiet-b" }),
      scope({ categoryId: "busy", appearances: 400 }),
    ]);
    expect(banded.find((s) => s.categoryId === "quiet-a")!.band).toBe(MIN_BAND);
    expect(banded.find((s) => s.categoryId === "quiet-b")!.band).toBe(MIN_BAND);
  });

  it("puts every scope at the floor when nothing has been measured yet", () => {
    // The cold-start state, and it is a designed one: at launch every slot is
    // AED 300 and the screen says the demand is not measured.
    const banded = bandScopes([scope({ categoryId: "a" }), scope({ categoryId: "b" })]);
    expect(banded.every((s) => s.band === MIN_BAND)).toBe(true);
  });

  it("does not call one measured page the busiest on the platform", () => {
    const banded = bandScopes([scope({ categoryId: "only", appearances: 9_000 })]);
    expect(banded[0]!.band).toBe(MIN_BAND);
  });

  it("spreads a real spread across the whole ladder", () => {
    const banded = bandScopes(
      Array.from({ length: 10 }, (_, index) =>
        scope({ categoryId: `c${index}`, appearances: (index + 1) * 100 }),
      ),
    );
    expect(banded[0]!.band).toBe(MIN_BAND);
    expect(banded[9]!.band).toBe(MAX_BAND);
    // Monotonic: more traffic is never a lower band.
    for (let i = 1; i < banded.length; i += 1) {
      expect(banded[i]!.band).toBeGreaterThanOrEqual(banded[i - 1]!.band);
    }
  });

  it("gives two scopes on the same traffic the same band", () => {
    /*
       Ties never straddle a boundary. Two pages with identical traffic priced
       differently because one sorted ahead of the other is the kind of thing
       nobody can explain to the seller who got the dearer one.
    */
    const banded = bandScopes([
      scope({ categoryId: "a", appearances: 50 }),
      scope({ categoryId: "b", appearances: 50 }),
      scope({ categoryId: "c", appearances: 5_000 }),
    ]);
    expect(banded[0]!.band).toBe(banded[1]!.band);
    expect(banded[2]!.band).toBeGreaterThan(banded[0]!.band);
  });

  it("stays a ten-rung ladder however many scopes there are", () => {
    // "The rank and file stays from 1 to 10." The directory grows; the ladder
    // does not.
    const many = bandScopes(
      Array.from({ length: 5_000 }, (_, index) =>
        scope({ categoryId: `c${index}`, appearances: index + 1 }),
      ),
    );
    const bands = new Set(many.map((s) => s.band));
    expect(Math.min(...bands)).toBe(MIN_BAND);
    expect(Math.max(...bands)).toBe(MAX_BAND);
    expect(bands.size).toBeLessThanOrEqual(BAND_COUNT);
  });

  it("returns a band for every scope handed in, in order", () => {
    const signals = [scope({ categoryId: "a" }), scope({ categoryId: "b", clicks: 3 })];
    const banded = bandScopes(signals);
    expect(banded.map((s) => s.categoryId)).toEqual(["a", "b"]);
  });
});
