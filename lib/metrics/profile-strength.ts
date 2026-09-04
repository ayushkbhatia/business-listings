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
 *
 * ## Why locations are not in here
 *
 * Board 2c, criterion 14, and it is a correction rather than an omission. A
 * location is **required to publish** — `goLive` refuses without one — so it is
 * a gate, not a lever. Levers are things a seller can decline.
 *
 * Mixing the two made the meter unreadable in a specific way: board 8a offers
 * four tasks worth fifty points between them against a denominator of a hundred,
 * so a seller could finish every task on offer and still be short, with nothing
 * named to do about it. That is the state a completeness meter must never reach,
 * and criterion 13 states it as a property — the named levers and the current
 * percentage sum to exactly a hundred. `strengthItems` below is what makes that
 * true by construction rather than by arithmetic somebody checked once.
 *
 * The fifteen points went to `identity` rather than being spread, so the three
 * figures board 8a publishes — photographs, catalogue, team — are the same
 * numbers they were. Identity is what board 2c is *for*, and it is now weighted
 * like it.
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
  identity: 35,
  /** Photographs. The single biggest driver of a buyer opening a listing. */
  photos: 20,
  /** A catalogue at all. */
  catalogue: 20,
  /** A catalogue that can be filtered — the difference between listed and found. */
  filterableSpecs: 15,
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

  const team = ratio(facts.teamSeats - 1, 1);

  const score =
    identity * WEIGHTS.identity +
    photos * WEIGHTS.photos +
    catalogue * WEIGHTS.catalogue +
    filterable * WEIGHTS.filterableSpecs +
    team * WEIGHTS.team;

  return Math.round((score / TOTAL) * 100);
}

/**
 * How far each part of the profile has come, as a fraction of its own weight.
 *
 * The same arithmetic `profileStrength` runs, exposed per component so a meter
 * can name what is left. Split out rather than duplicated: two copies of this
 * would drift, and the drift would be a screen promising points the score does
 * not award.
 */
function fractions(facts: ProfileFacts): Record<WeightKey, number> {
  return {
    identity:
      (Number(facts.hasDescription) * 8 +
        Number(facts.hasEstablishedYear) * 4 +
        Number(facts.hasTeamSize) * 3 +
        ratio(facts.languages, 2) * 3 +
        ratio(facts.additionalCategories, 2) * 2) /
      20,
    photos: ratio(facts.photos + Number(facts.hasLogo) + Number(facts.hasCover), PHOTO_TARGET),
    catalogue: ratio(facts.products, PRODUCT_TARGET),
    filterableSpecs: ratio(facts.productsWithFilterableSpecs, Math.max(1, facts.products)),
    team: ratio(facts.teamSeats - 1, 1),
  };
}

export type WeightKey = keyof typeof WEIGHTS;

export interface StrengthItem {
  key: WeightKey;
  /** Whole points already earned here. */
  earned: number;
  /** Whole points still on the table. Zero once the item is done. */
  remaining: number;
  done: boolean;
}

/**
 * The meter's rows, in whole points that sum to exactly a hundred.
 *
 * Criterion 13, and the reason it needs its own function: rounding each of five
 * components independently can land on 99 or 101, and a meter whose levers do
 * not close the gap is the trick the criterion exists to forbid. Largest
 * remainder distributes the rounding error to the components with the biggest
 * fractional part, which is the standard way to make a set of rounded shares add
 * up to their total.
 *
 * `earned` across every item equals `profileStrength`; `earned + remaining`
 * across every item equals a hundred. Both are asserted in the tests.
 */
export function strengthItems(facts: ProfileFacts): StrengthItem[] {
  const parts = fractions(facts);
  const keys = Object.keys(WEIGHTS) as WeightKey[];

  const exact = keys.map((key) => (parts[key] * WEIGHTS[key] * 100) / TOTAL);
  const floors = exact.map(Math.floor);
  const shortfall = Math.round(exact.reduce((a, b) => a + b, 0)) - floors.reduce((a, b) => a + b, 0);

  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);
  for (let i = 0; i < shortfall; i += 1) floors[order[i]!.index]! += 1;

  /*
     The same distribution over each component's *whole* weight, so `remaining`
     is what this item would still pay rather than what is left of the meter.
  */
  const caps = keys.map((key) => Math.round((WEIGHTS[key] * 100) / TOTAL));
  const capShortfall = 100 - caps.reduce((a, b) => a + b, 0);
  if (capShortfall !== 0) caps[0] = (caps[0] ?? 0) + capShortfall;

  return keys.map((key, index) => {
    const earned = Math.min(floors[index]!, caps[index]!);
    return {
      key,
      earned,
      remaining: caps[index]! - earned,
      done: earned >= caps[index]!,
    };
  });
}

/** Board 2c and board 8a draw the threshold at 80%. */
export const STRONG_ENOUGH = 80;
