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

  /* ── Board `8a-s`. Only read for a seller of work. ──────────────────── */

  /**
   * Credentials on file and not lapsed — board `8a-s`, task 1.
   *
   * **Not "verified".** The spec's completion rule asks for at least one
   * verified credential, and this product has no such state: board 3e splits
   * the screen precisely so that a document the seller uploaded says `On file`
   * and never `Verified`, because nobody here has looked at it. Requiring a
   * state that cannot be reached would put the largest lever on the board
   * permanently out of the seller's hands.
   */
  credentials: number;
  /** The one component the seller cannot finish — see `SERVICES_WEIGHTS`. */
  licenceVerified: boolean;
  /** Scope sheets with `status = live`. */
  servicesLive: number;
  /** Sectors the firm says it has worked in — `2c-s`. */
  sectors: number;
  /** Delivery modes picked on `2d-s`. */
  deliveryModes: number;
  /** Coverage areas claimed on `2d-s`. */
  coverageAreas: number;
}

/**
 * What each part of a profile is worth to a seller of **goods**. Published on
 * board 8a, so these are a promise rather than a tuning knob.
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

/**
 * What the same profile is worth to a seller of **work** — board `8a-s`.
 *
 * The structure of the hub carries over and the weighting turns upside down.
 * The goods table leads with photographs at 20, because for a parts supplier a
 * picture of the shelf is evidence. For an audit practice it is decoration:
 * what makes the listing credible is the FTA agent number, the MoF approval,
 * the professional body and the indemnity cover. So credentials lead at 32 and
 * photographs fall to 4.
 *
 * ## Everything the seller controls sums to exactly eighty
 *
 * 32 + 20 + 12 + 8 + 4 + 4 = 80, and `STRONG_ENOUGH` is 80. That is not a
 * coincidence worth leaving unremarked: **licence verification is the one
 * component a seller cannot finish on their own** — `verificationTier` is
 * writable only by an `ops_lead`, which is `CLAUDE.md` non-negotiable 2 — so a
 * practice that does every single thing on the hub lands exactly on the
 * threshold and nothing they can do is left unnamed.
 *
 * That is the property the site-visit cut was made to restore, written down as
 * arithmetic this time: a completeness meter must never reach a state where a
 * seller has finished everything on offer and is still short with nothing to do
 * about it.
 *
 * Two departures from the goods table are worth naming. Licence drops 24 → 20
 * because credentials are now the larger trust signal; and locations (which the
 * goods table does not carry at all, for the reason above) becomes coverage at
 * 4, because a coverage set is a two-minute answer where a branch list with
 * pins was not.
 */
export const SERVICES_WEIGHTS = {
  /** What a professional-services buyer actually checks. Board `8a-s`, task 1. */
  credentials: 32,
  /** Three live scope sheets. Pro-rata below three — `8a-s` B4. */
  services: 20,
  /** Checked against the issuing authority. The one the seller cannot finish. */
  licence: 20,
  /** Who you are: the description, the sectors, the name. */
  identity: 12,
  /** Somebody other than the owner who can reply. */
  team: 8,
  /** A delivery mode and an area — `2d-s`'s publish gate, as a lever. */
  coverage: 4,
  /** Certificates on the wall and a team shot. They convert; not like a shelf. */
  photos: 4,
} as const;

/**
 * A seller who is both — board `8a-s` B9.
 *
 * The union of the two tables, renormalised to a hundred **once**. Where a
 * component appears in both, the larger weight wins: a trading company with a
 * service arm is genuinely both things, and taking the smaller of two claims
 * about what matters would under-weight whichever half the seller cares about.
 *
 * Derived rather than written out, so a change to either table reaches this one
 * instead of a third table quietly going stale. The renormalisation is what
 * keeps it a percentage; summing the two tables — which B9 forbids in as many
 * words — would produce a denominator of 176 and a meter that never fills.
 */
export const BOTH_WEIGHTS: Readonly<Record<string, number>> = Object.fromEntries(
  [...new Set([...Object.keys(WEIGHTS), ...Object.keys(SERVICES_WEIGHTS)])].map((key) => [
    key,
    Math.max(
      (WEIGHTS as Record<string, number>)[key] ?? 0,
      (SERVICES_WEIGHTS as Record<string, number>)[key] ?? 0,
    ),
  ]),
);

/** Which table a seller is measured against. `unset` is what it always was. */
export type SellsKind = "unset" | "goods" | "services" | "both";

export function weightsFor(kind: SellsKind): Readonly<Record<string, number>> {
  if (kind === "services") return SERVICES_WEIGHTS;
  if (kind === "both") return BOTH_WEIGHTS;
  /*
     `unset` reads as goods, which is what every one of the 123 live businesses
     holds and what the meter measured them against before the fork existed. A
     column shipping with no backfill must not move a number a seller has
     already seen.
  */
  return WEIGHTS;
}

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
export function profileStrength(facts: ProfileFacts, kind: SellsKind = "goods"): number {
  if (kind !== "goods" && kind !== "unset") {
    const weights = weightsFor(kind);
    const parts = allFractions(facts, kind);
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    const score = Object.entries(weights).reduce(
      (sum, [key, weight]) => sum + (parts[key] ?? 0) * weight,
      0,
    );
    return Math.round((score / total) * 100);
  }

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
/** Three live scope sheets, pro-rata below — board `8a-s` B4. */
export const SERVICES_TARGET = 3;
/** Two credentials on file. Board `8a-s`'s completion rule, minus "verified". */
export const CREDENTIAL_TARGET = 2;
/** A description this short says nothing; the board asks for 120 characters. */
export const DESCRIPTION_TARGET = 120;

/**
 * The services components, as fractions of their own weight.
 *
 * `identity` is deliberately a different sum here from the goods one: a
 * practice's identity is what it does and who for — the description and the
 * sectors — where a trader's is the description, the year, the team size and
 * the languages. Same key, same meaning, different evidence, which is the whole
 * reason the tables are separate rather than one table with a multiplier.
 */
function servicesFractions(facts: ProfileFacts): Record<string, number> {
  return {
    credentials: ratio(facts.credentials, CREDENTIAL_TARGET),
    services: ratio(facts.servicesLive, SERVICES_TARGET),
    licence: facts.licenceVerified ? 1 : 0,
    identity:
      (ratio(descriptionLength(facts), DESCRIPTION_TARGET) * 12 + ratio(facts.sectors, 1) * 8) / 20,
    team: ratio(facts.teamSeats - 1, 1),
    // `2d-s`'s publish gate, as a lever: one mode and one area, both required.
    coverage: (ratio(facts.deliveryModes, 1) + ratio(facts.coverageAreas, 1)) / 2,
    photos: ratio(facts.photos, PHOTO_TARGET_SERVICES),
  };
}

/**
 * How long the description is, from the boolean the goods facts already carry.
 *
 * `hasDescription` is what the job measures and what every caller passes; a
 * second field would be a second thing to keep in step. A seller who has
 * written one at all is credited in full, and the 120-character floor lives in
 * the copy the editor shows rather than as a cliff in the meter — a description
 * of 119 characters scoring zero is a number nobody can act on.
 */
function descriptionLength(facts: ProfileFacts): number {
  return facts.hasDescription ? DESCRIPTION_TARGET : 0;
}

/** Three photographs is the whole ask here — `8a-s`, task 4. */
export const PHOTO_TARGET_SERVICES = 3;

/**
 * Every component a table might ask for, whichever table it is.
 *
 * The goods components keep their own arithmetic and the services ones keep
 * theirs, and a `both` seller is measured on the union — which is why this
 * merges rather than choosing. `identity` appears in both and the services
 * reading wins for a services seller and the goods one for everybody else: a
 * `both` listing has a year, a team size and languages as well as sectors, so
 * it is measured the fuller way.
 */
function allFractions(facts: ProfileFacts, kind: SellsKind): Record<string, number> {
  const goods = fractions(facts);
  const services = servicesFractions(facts);
  if (kind === "services") return services;
  return { ...services, ...goods, photos: goods.photos };
}

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
  /** A key of whichever table this seller is measured against. */
  key: string;
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
export function strengthItems(facts: ProfileFacts, kind: SellsKind = "goods"): StrengthItem[] {
  const weights = weightsFor(kind);
  const parts = allFractions(facts, kind);
  const keys = Object.keys(weights);
  const total = Object.values(weights).reduce((a, b) => a + b, 0);

  const exact = keys.map((key) => ((parts[key] ?? 0) * weights[key]! * 100) / total);
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
  const caps = keys.map((key) => Math.round((weights[key]! * 100) / total));
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
