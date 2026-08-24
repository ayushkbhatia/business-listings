import { describe, expect, it } from "vitest";
import {
  PHOTO_TARGET,
  PRODUCT_TARGET,
  profileStrength,
  STRONG_ENOUGH,
  WEIGHTS,
  type ProfileFacts,
} from "@/lib/metrics/profile-strength";

const EMPTY: ProfileFacts = {
  hasDescription: false,
  hasLogo: false,
  hasCover: false,
  additionalCategories: 0,
  hasEstablishedYear: false,
  hasTeamSize: false,
  languages: 0,
  locations: 0,
  locationsWithHours: 0,
  products: 0,
  productsWithFilterableSpecs: 0,
  photos: 0,
  teamSeats: 1,
};

const FULL: ProfileFacts = {
  hasDescription: true,
  hasLogo: true,
  hasCover: true,
  additionalCategories: 3,
  hasEstablishedYear: true,
  hasTeamSize: true,
  languages: 4,
  locations: 2,
  locationsWithHours: 2,
  products: 40,
  productsWithFilterableSpecs: 40,
  photos: 30,
  teamSeats: 4,
};

describe("the published weights", () => {
  it("add to a hundred", () => {
    // Board 8a states what each setup task is worth in percentage points, so
    // these are a promise to the seller rather than a tuning knob.
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe("profileStrength", () => {
  it("is zero for an imported record nobody has touched", () => {
    expect(profileStrength(EMPTY)).toBe(0);
  });

  it("is a hundred for a profile with everything", () => {
    expect(profileStrength(FULL)).toBe(100);
  });

  it("never exceeds a hundred however much is piled on", () => {
    // Rounding six components separately and adding them can land on 101, and
    // a strength meter reading 101% is a bug report.
    //
    // Specs scale with the catalogue on purpose. Nine thousand products with
    // forty of them specced is a *worse* profile than forty of forty, and the
    // proportional test below is the same rule seen from the other side.
    expect(
      profileStrength({
        ...FULL,
        photos: 900,
        products: 9_000,
        productsWithFilterableSpecs: 9_000,
        languages: 40,
        teamSeats: 60,
      }),
    ).toBe(100);
  });

  it("falls when a catalogue grows without its specs", () => {
    const specced = profileStrength({ ...FULL, products: 40, productsWithFilterableSpecs: 40 });
    const bulkDumped = profileStrength({ ...FULL, products: 9_000, productsWithFilterableSpecs: 40 });
    expect(bulkDumped).toBeLessThan(specced);
  });

  it("is an integer", () => {
    const score = profileStrength({ ...EMPTY, hasDescription: true, products: 3 });
    expect(Number.isInteger(score)).toBe(true);
  });

  it("counts hours as half the value of having a location at all", () => {
    // The score is a rounded integer, so half of an odd weight is not
    // observable exactly — 7.5 points shows up as 7. Assert the half rather
    // than a figure that would have to change every time a weight moves.
    const addressOnly = profileStrength({ ...EMPTY, locations: 2, locationsWithHours: 0 });
    const withHours = profileStrength({ ...EMPTY, locations: 2, locationsWithHours: 2 });
    expect(withHours - addressOnly).toBe(Math.floor(WEIGHTS.locations / 2));
    expect(addressOnly).toBe(Math.round(WEIGHTS.locations / 2));
  });

  it("gives no location credit for having none", () => {
    expect(profileStrength({ ...EMPTY, locations: 0, locationsWithHours: 0 })).toBe(0);
  });

  it("stops rewarding photos past the target", () => {
    const at = profileStrength({ ...EMPTY, photos: PHOTO_TARGET });
    const over = profileStrength({ ...EMPTY, photos: PHOTO_TARGET * 5 });
    expect(over).toBe(at);
    expect(at).toBe(WEIGHTS.photos);
  });

  it("stops rewarding products past the target", () => {
    const at = profileStrength({ ...EMPTY, products: PRODUCT_TARGET });
    const over = profileStrength({ ...EMPTY, products: PRODUCT_TARGET * 9 });
    expect(over).toBe(at);
  });

  it("rewards specs in proportion to the catalogue, not in absolute terms", () => {
    // Ten products all specced beats forty products a quarter specced, which is
    // the behaviour that makes the FILTER markers worth acting on.
    const allOfTen = profileStrength({ ...EMPTY, products: 10, productsWithFilterableSpecs: 10 });
    const quarterOfForty = profileStrength({
      ...EMPTY,
      products: 40,
      productsWithFilterableSpecs: 10,
    });
    expect(allOfTen).toBeGreaterThan(quarterOfForty);
  });

  it("gives no spec credit for a catalogue that does not exist", () => {
    expect(profileStrength({ ...EMPTY, products: 0, productsWithFilterableSpecs: 0 })).toBe(0);
  });

  it("counts a second seat, and not the owner's own", () => {
    expect(profileStrength({ ...EMPTY, teamSeats: 1 })).toBe(0);
    expect(profileStrength({ ...EMPTY, teamSeats: 2 })).toBe(WEIGHTS.team);
  });

  it("rises monotonically as a seller does the work", () => {
    const steps: ProfileFacts[] = [
      EMPTY,
      { ...EMPTY, hasDescription: true },
      { ...EMPTY, hasDescription: true, locations: 1, locationsWithHours: 1 },
      { ...EMPTY, hasDescription: true, locations: 1, locationsWithHours: 1, products: 10, productsWithFilterableSpecs: 10 },
      { ...EMPTY, hasDescription: true, locations: 1, locationsWithHours: 1, products: 10, productsWithFilterableSpecs: 10, photos: 10 },
    ];
    const scores = steps.map(profileStrength);
    for (let i = 1; i < scores.length; i += 1) {
      expect(scores[i]!).toBeGreaterThan(scores[i - 1]!);
    }
  });

  it("puts the 80% threshold within reach without a full catalogue", () => {
    // Board 2c marks 80%. A threshold only a perfect profile can hit is a
    // threshold nobody aims at.
    const realistic: ProfileFacts = {
      ...EMPTY,
      hasDescription: true,
      hasLogo: true,
      hasCover: true,
      hasEstablishedYear: true,
      hasTeamSize: true,
      languages: 2,
      additionalCategories: 1,
      locations: 1,
      locationsWithHours: 1,
      products: 10,
      productsWithFilterableSpecs: 10,
      photos: 8,
      teamSeats: 2,
    };
    expect(profileStrength(realistic)).toBeGreaterThanOrEqual(STRONG_ENOUGH);
  });
});
