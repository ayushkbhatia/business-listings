/**
 * The demand ladder a sponsored slot is priced on. Board `11e`, ratified
 * 17 September 2026.
 *
 * Pure, and deliberately so: the arithmetic that decides what a seller is
 * charged should be testable without a database, and the two halves of it —
 * where a scope sits, and what that rung costs — are separable questions that
 * were worth separating.
 *
 * ## Ten rungs, and the scopes move rather than the ladder
 *
 * Every sellable scope — one trade in one emirate — is classified into one of
 * **ten bands** from what buyers actually did there. Any number of scopes may
 * share a band: these are positioning bands, not price tiers with a quota. The
 * cut is by **decile over the scopes that have demand**, so the ladder stays
 * 1 to 10 however large the directory grows and a page climbs it by attracting
 * traffic rather than by the scale stretching underneath it.
 *
 * That is the whole of *"basis how the website grows in terms of traffic
 * captured"*: at forty listings band 10 is a page with a few dozen visits, and
 * at four thousand it is a page with thousands. The price ladder does not move;
 * what it takes to climb it does.
 *
 * ## Why a scope with no demand is band 1 rather than wherever the cut lands
 *
 * Most scopes have no measured demand at all today, and a decile over a list
 * that is mostly zeroes puts a page nobody has ever visited in band 7 — because
 * it ties with the seventh decile, not because anybody looked at it. So scopes
 * with a score of zero are held at band 1 and the deciles are cut over the rest.
 * The floor price is the honest answer for a page nobody has been to.
 */

/** The only bands there are. A band 11 would mean the ladder had stretched. */
export const MIN_BAND = 1;
export const MAX_BAND = 10;
export const BAND_COUNT = MAX_BAND - MIN_BAND + 1;

/** The ratified floor: the quietest page a slot can be bought on. */
export const DEFAULT_BASE_PRICE_AED = 300;
/** The ratified step, in basis points. 1000 is 10% a band. */
export const DEFAULT_STEP_BPS = 1000;

/**
 * What a click is worth against an appearance.
 *
 * An appearance is a buyer being shown this scope's results; a click is a buyer
 * choosing something out of them. The second is the far stronger statement
 * about whether the page produces anything, and a scope that is opened and
 * abandoned should not out-rank one that is opened and acted on. Ten is a
 * judgement, stated here rather than buried in a SQL expression so it can be
 * argued with — and it is a *ratio*, so it never changes the absolute score
 * anybody is charged from, only the order the scopes come in.
 */
export const CLICK_WEIGHT = 10;

/** One scope's measured traffic, before it is a band. */
export interface ScopeSignal {
  categoryId: string;
  emirate: string | null;
  appearances: number;
  clicks: number;
}

export interface ScopeScore extends ScopeSignal {
  score: number;
  band: number;
}

/** Appearances plus clicks, weighted. Whole numbers, so the row stores an Int. */
export function scoreOf(signal: { appearances: number; clicks: number }): number {
  return Math.max(0, Math.round(signal.appearances + signal.clicks * CLICK_WEIGHT));
}

/**
 * Cut a set of scopes into the ten bands.
 *
 * Deciles over the scopes with a score, and band 1 for the rest. Ties never
 * straddle a boundary: every scope on the same score gets the same band, which
 * matters more than an even split — two pages with identical traffic priced
 * differently because one sorted ahead of the other is indefensible to the
 * seller who got the dearer one.
 *
 * Returns a band for every scope handed in, in the order they were handed in.
 */
export function bandScopes(signals: readonly ScopeSignal[]): ScopeScore[] {
  const scored = signals.map((signal) => ({ ...signal, score: scoreOf(signal) }));
  const withDemand = scored.filter((scope) => scope.score > 0);

  if (withDemand.length === 0) {
    return scored.map((scope) => ({ ...scope, band: MIN_BAND }));
  }

  /*
     The distinct scores, ascending, are what the deciles are cut over — not the
     rows. Cutting over rows puts the boundary inside a tie whenever one score
     is common, which on a young directory is most of them: twelve scopes on a
     score of 1 and one on 400 would otherwise spread the twelve across nine
     bands. Cutting over distinct values asks the question the band is supposed
     to answer — how busy is this page, against the others — and gives every
     scope on the same number the same answer.
  */
  const distinct = [...new Set(withDemand.map((scope) => scope.score))].sort((a, b) => a - b);
  const bandOfScore = new Map<number, number>();
  for (const [index, score] of distinct.entries()) {
    /*
       The quietest distinct score is band 1 and the busiest is band 10, with
       the rest spread evenly between. A single distinct score means one band,
       and it is band 1: one page with traffic and nothing to compare it to is
       not the busiest page on the platform, it is the only measured one.
    */
    const band =
      distinct.length === 1
        ? MIN_BAND
        : MIN_BAND + Math.round((index / (distinct.length - 1)) * (BAND_COUNT - 1));
    bandOfScore.set(score, Math.min(MAX_BAND, Math.max(MIN_BAND, band)));
  }

  return scored.map((scope) => ({
    ...scope,
    band: scope.score === 0 ? MIN_BAND : (bandOfScore.get(scope.score) ?? MIN_BAND),
  }));
}

/**
 * The price of one band, from the base and the step.
 *
 * `base × (1 + step)^(band − 1)`, rounded to the dirham. The rate card stores
 * the ten results rather than deriving them at read time, so a price somebody
 * tuned by hand survives — but this is what generates them, and what the editor
 * regenerates from when the base or the step moves.
 */
export function priceForBand(
  band: number,
  basePriceAed: number = DEFAULT_BASE_PRICE_AED,
  stepBps: number = DEFAULT_STEP_BPS,
): number {
  const rung = Math.min(MAX_BAND, Math.max(MIN_BAND, Math.round(band)));
  return Math.round(basePriceAed * (1 + stepBps / 10_000) ** (rung - MIN_BAND));
}

/** The whole ladder, band 1 to 10. */
export function generateCard(
  basePriceAed: number = DEFAULT_BASE_PRICE_AED,
  stepBps: number = DEFAULT_STEP_BPS,
): { band: number; monthlyPriceAed: number }[] {
  return Array.from({ length: BAND_COUNT }, (_, index) => ({
    band: MIN_BAND + index,
    monthlyPriceAed: priceForBand(MIN_BAND + index, basePriceAed, stepBps),
  }));
}
