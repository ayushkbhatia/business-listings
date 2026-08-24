/**
 * Profile strength, measured.
 *
 * `Business.profileStrength` has been a seeded `int(38, 98)` since handoff 0 —
 * the same shape of lie handoff 2 caught in `responseTimeMedianMs`, and worth
 * naming plainly: a number nothing computed, shown to a seller as if it were a
 * fact about them. Acceptance criterion 11 asks that it have no seller-writable
 * path, which it cannot have while nobody writes it at all.
 *
 * This module is pure. It takes the facts and returns the number, so the job,
 * the seed and the tests all agree by construction rather than by discipline.
 *
 * The weights are a judgement, and the setup hub in board 8a states what each
 * task is worth in percentage points — so they are published to the seller and
 * have to add to a hundred. `WEIGHTS` is the source both read.
 */

export interface ProfileFacts {
  hasDescription: boolean;
  hasLogo: boolean;
  hasCover: boolean;
  /** Beyond the primary one. */
  additionalCategories: number;
  hasEstablishedYear: boolean;
  hasTeamSize: boolean;
  languages: number;
  locations: number;
  /** Locations with trading hours filled in. */
  locationsWithHours: number;
  products: number;
  /** Products whose spec values cover their template's filterable fields. */
  productsWithFilterableSpecs: number;
  /** Photos on the business or its products. */
  photos: number;
  teamSeats: number;
}

/**
 * What each part of a profile is worth. Published to the seller on board 8a,
 * so these are a promise rather than a tuning knob.
 */
export const WEIGHTS = {
  /** Who you are: the storefront reads as a real company. */
  identity: 20,
  /** Photographs. The single biggest driver of a buyer opening a listing. */
  photos: 20,
  /** A catalogue at all. */
  catalogue: 20,
  /** A catalogue that can be filtered — the difference between listed and found. */
  filterableSpecs: 15,
  /** Where you are, and when you are open. */
  locations: 15,
  /** Somebody other than the owner who can reply. */
  team: 10,
} as const;

const TOTAL = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);

/** Ten photos is a full gallery; more does not make the profile stronger. */
export const PHOTO_TARGET = 10;
/** Ten products is the free-plan ceiling and a credible catalogue. */
export const PRODUCT_TARGET = 10;

/** A ratio clamped to 0..1, with a zero denominator reading as zero rather than NaN. */
function ratio(got: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(1, Math.max(0, got / target));
}

/**
 * Nought to a hundred, rounded.
 *
 * Rounded once at the end rather than per component: rounding each of six
 * parts and adding them can land on 101, and a strength meter that reads 101%
 * is a bug report.
 */
export function profileStrength(facts: ProfileFacts): number {
  const identity =
    (Number(facts.hasDescription) * 8 +
      Number(facts.hasEstablishedYear) * 4 +
      Number(facts.hasTeamSize) * 3 +
      ratio(facts.languages, 2) * 3 +
      ratio(facts.additionalCategories, 2) * 2) /
    20;

  const photos = ratio(facts.photos + Number(facts.hasLogo) + Number(facts.hasCover), PHOTO_TARGET);
  const catalogue = ratio(facts.products, PRODUCT_TARGET);
  const filterable = ratio(facts.productsWithFilterableSpecs, Math.max(1, facts.products));

  // Hours are half of this: an address with no opening times is the complaint
  // a buyer makes about every other directory in the market.
  const locations =
    facts.locations === 0 ? 0 : 0.5 + 0.5 * ratio(facts.locationsWithHours, facts.locations);

  const team = ratio(facts.teamSeats - 1, 1);

  const score =
    identity * WEIGHTS.identity +
    photos * WEIGHTS.photos +
    catalogue * WEIGHTS.catalogue +
    filterable * WEIGHTS.filterableSpecs +
    locations * WEIGHTS.locations +
    team * WEIGHTS.team;

  return Math.round((score / TOTAL) * 100);
}

/** Board 2c and board 8a draw the threshold at 80%. */
export const STRONG_ENOUGH = 80;
