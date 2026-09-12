import { describe, expect, it } from "vitest";
import {
  PHOTO_TARGET,
  PRODUCT_TARGET,
  profileStrength,
  strengthItems,
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
  credentials: 0,
  licenceVerified: false,
  servicesLive: 0,
  sectors: 0,
  deliveryModes: 0,
  coverageAreas: 0,
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
  credentials: 0,
  licenceVerified: false,
  servicesLive: 0,
  sectors: 0,
  deliveryModes: 0,
  coverageAreas: 0,
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
        credentials: 0,
        licenceVerified: false,
        servicesLive: 0,
        sectors: 0,
        deliveryModes: 0,
        coverageAreas: 0,
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

  it("gives no credit for a location or its hours — a gate is not a lever", () => {
    /*
       Board 2c, criterion 14. A location is required to publish, so it is a
       gate; levers are things a seller can decline. Mixing the two is what let
       board 8a offer four tasks worth fifty points against a denominator of a
       hundred, so a seller could finish everything on offer and still be short
       with nothing named to do about it.
    */
    const none = profileStrength({ ...EMPTY, locations: 0, locationsWithHours: 0 });
    const both = profileStrength({ ...EMPTY, locations: 4, locationsWithHours: 4 });
    expect(none).toBe(0);
    expect(both).toBe(0);
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
    /*
       Every step is a lever the seller can pull. Adding a location used to be
       one of them and no longer moves the number at all — board 2c, criterion
       14: a location is required to publish, so it is a gate.
    */
    const steps: ProfileFacts[] = [
      EMPTY,
      { ...EMPTY, hasDescription: true },
      { ...EMPTY, hasDescription: true, hasEstablishedYear: true, hasTeamSize: true },
      { ...EMPTY, hasDescription: true, hasEstablishedYear: true, hasTeamSize: true, products: 10, productsWithFilterableSpecs: 10 },
      { ...EMPTY, hasDescription: true, hasEstablishedYear: true, hasTeamSize: true, products: 10, productsWithFilterableSpecs: 10, photos: 10 },
    ];
    const scores = steps.map((facts) => profileStrength(facts));
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
      credentials: 0,
      licenceVerified: false,
      servicesLive: 0,
      sectors: 0,
      deliveryModes: 0,
      coverageAreas: 0,
    };
    expect(profileStrength(realistic)).toBeGreaterThanOrEqual(STRONG_ENOUGH);
  });
});

describe("strengthItems — the meter's rows", () => {
  /**
   * Criterion 13, as a property rather than an example.
   *
   * A meter whose named levers do not close the gap to a hundred is the trick
   * the criterion exists to forbid: a seller at 96% with nothing left to do
   * concludes the number is decorative. Asserted across a spread of profiles
   * rather than one, because rounding five components independently is exactly
   * where it would break.
   */
  const PROFILES: ProfileFacts[] = [
    EMPTY,
    FULL,
    { ...EMPTY, hasDescription: true },
    { ...EMPTY, hasDescription: true, additionalCategories: 2, hasEstablishedYear: true },
    { ...EMPTY, photos: 3, products: 4, productsWithFilterableSpecs: 1 },
    { ...EMPTY, hasLogo: true, hasCover: true, languages: 1, teamSeats: 2 },
    { ...FULL, products: 7, productsWithFilterableSpecs: 3, photos: 5 },
    { ...EMPTY, hasTeamSize: true, languages: 2, products: 1, productsWithFilterableSpecs: 1 },
  ];

  it("earns and leaves exactly a hundred points between them", () => {
    for (const facts of PROFILES) {
      const items = strengthItems(facts);
      const total = items.reduce((sum, item) => sum + item.earned + item.remaining, 0);
      expect(total, JSON.stringify(facts)).toBe(100);
    }
  });

  it("earns what the score says it earned", () => {
    for (const facts of PROFILES) {
      const earned = strengthItems(facts).reduce((sum, item) => sum + item.earned, 0);
      expect(earned, JSON.stringify(facts)).toBe(profileStrength(facts));
    }
  });

  it("marks an item done only when it has nothing left to give", () => {
    for (const facts of PROFILES) {
      for (const item of strengthItems(facts)) {
        expect(item.done, `${item.key} of ${JSON.stringify(facts)}`).toBe(item.remaining === 0);
      }
    }
  });

  it("names every weight, so nothing contributes anonymously", () => {
    expect(strengthItems(EMPTY).map((item) => item.key).sort()).toEqual(
      Object.keys(WEIGHTS).sort(),
    );
  });

  it("has everything to give on an empty profile and nothing on a full one", () => {
    expect(strengthItems(EMPTY).every((item) => item.earned === 0)).toBe(true);
    expect(strengthItems(FULL).every((item) => item.remaining === 0)).toBe(true);
  });
});
