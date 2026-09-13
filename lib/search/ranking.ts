/**
 * Ranking weights, as a config object.
 *
 * Board 12c sets these. They live here rather than inline in the query so the
 * admin editor in handoff 4 has one thing to write to, and so a change is a
 * diff somebody can review rather than a line buried in SQL.
 *
 * Plan tier is deliberately the smallest weight. Above about 10 the results
 * stop being useful and buyers notice inside a week — a directory that sells
 * its way to the top is a directory nobody comes back to, and the subscription
 * only holds if being found is worth paying for.
 */
import type { TradeKind } from "@/lib/db/generated/enums";
import { trustScore } from "@/lib/verification";

/**
 * Which of the two vectors — board `12c-s`.
 *
 * The same two values as `Category.tradeKind`, because that is what decides
 * which vector a listing ranks on: resolved per listing at query time, never
 * from a business-level flag (`12c-s` B11). A business holding one category of
 * each kind ranks as goods on the valves page and as services on the AMC page.
 */
export type RankingKind = TradeKind;

export const RANKING_KINDS = ["goods", "services"] as const satisfies readonly RankingKind[];

export function isRankingKind(value: string): value is RankingKind {
  return (RANKING_KINDS as readonly string[]).includes(value);
}

export interface RankingWeights {
  relevance: number;
  verificationTier: number;
  responseTime: number;
  specCompleteness: number;
  distance: number;
  planTier: number;
}

/**
 * The weight names, in the order the editor shows them.
 *
 * Here rather than in `settings.ts` because a client component needs them and
 * that module is `server-only` — importing it from the editor pulled Prisma and
 * `pg` into the browser bundle, which typecheck and lint both allowed and the
 * build caught.
 */
export const WEIGHT_KEYS = [
  "relevance",
  "verificationTier",
  "responseTime",
  "specCompleteness",
  "distance",
  "planTier",
] as const;

/**
 * What `relevance` means on a page with no query — board 6a §Ranking.
 *
 * The area and emirate landing pages rank on this same config, and they have no
 * search box. `relevance` is the largest of the six weights and there is
 * nothing on those pages for it to score against, so left alone it multiplies
 * zero: staff move a 34-point slider on board 12c and nothing changes on the
 * highest-traffic template in the product. That is worse than a wrong number,
 * because it looks like it works.
 *
 *   `redistribute`    the 34 points spread across the other five in proportion
 *                     to their own weights. Verification becomes the dominant
 *                     signal at roughly 35 effective points, which is what the
 *                     H2 on those pages promises the reader.
 *   `category_depth`  relevance keeps its points, and the caller scores it as
 *                     how exactly a listing's own trade matches the page's —
 *                     primary category exact scores 1, a match at sector level
 *                     scores half.
 *
 * A named mode on the same config row, never a constant in a route: the spec
 * asks for the decision to be recorded where the weights are, so that whoever
 * moves a weight can see what it does to the pages with no query.
 */
export const BROWSE_RELEVANCE_MODES = ["redistribute", "category_depth"] as const;
export type BrowseRelevanceMode = (typeof BROWSE_RELEVANCE_MODES)[number];
export const DEFAULT_BROWSE_RELEVANCE_MODE: BrowseRelevanceMode = "redistribute";

export function isBrowseRelevanceMode(value: string): value is BrowseRelevanceMode {
  return (BROWSE_RELEVANCE_MODES as readonly string[]).includes(value);
}

/**
 * The weights a page with no query should rank on.
 *
 * Under `category_depth` nothing moves — the caller supplies a real relevance
 * score and the config is used as staff set it.
 *
 * Under `redistribute` the relevance points are shared out in proportion to the
 * other five, and relevance goes to zero. Two properties matter and both are
 * asserted in the unit tests:
 *
 *   · the total stays the same, so a score from this page is on the same scale
 *     as a score from a search and a boost's five points still mean five;
 *   · a weight staff set to nought stays at nought. Redistributing *into* a
 *     signal somebody deliberately switched off would make the admin editor a
 *     suggestion, which is the same objection `weightsForShape` records.
 *
 * Rounding is by largest remainder rather than `Math.round` per weight, which
 * loses or invents points depending on the numbers. With every other weight at
 * zero there is nothing to redistribute into and the relevance points are
 * dropped rather than parked somewhere arbitrary — a config of "relevance
 * only" on a page with no query is a config with no ranking in it, and
 * `validateWeights` already refuses the all-zero case that would produce it —
 * it cannot total 100.
 */
export function weightsForBrowse(
  weights: RankingWeights,
  mode: BrowseRelevanceMode = DEFAULT_BROWSE_RELEVANCE_MODE,
): RankingWeights {
  if (mode === "category_depth") return { ...weights };

  const others = WEIGHT_KEYS.filter((key) => key !== "relevance");
  const base = others.reduce((total, key) => total + weights[key], 0);
  if (base === 0 || weights.relevance === 0) return { ...weights, relevance: 0 };

  const exact = others.map((key) => ({
    key,
    share: (weights.relevance * weights[key]) / base,
  }));
  const shared = exact.map((entry) => ({ ...entry, whole: Math.floor(entry.share) }));
  let left = weights.relevance - shared.reduce((total, entry) => total + entry.whole, 0);

  // Largest remainder first, then the bigger weight, so the result does not
  // depend on the order `WEIGHT_KEYS` happens to be written in.
  const order = [...shared].sort(
    (a, b) => (b.share - b.whole) - (a.share - a.whole) || weights[b.key] - weights[a.key],
  );
  const extra = new Map(order.map((entry) => [entry.key, 0]));
  for (const entry of order) {
    if (left <= 0) break;
    extra.set(entry.key, 1);
    left -= 1;
  }

  const next: RankingWeights = { ...weights, relevance: 0 };
  for (const entry of shared) {
    next[entry.key] = weights[entry.key] + entry.whole + (extra.get(entry.key) ?? 0);
  }
  return next;
}

/**
 * The six always add to this.
 *
 * Board `12c` second pass, criterion 2. The shipped model was six independent
 * integers and the panel said so — *"what matters is the ratio between them,
 * not the total"* — which is true of the ordering and false of everything
 * measured against it.
 *
 * A boost is added to the weighted sum rather than multiplied into it, and
 * `RankSignals.boostPoints` says why: *"five points is five points, whatever
 * the weights happen to be this week."* That only holds while the scale is
 * fixed. On a free total, the same 25-point boost is a quarter of the ranking
 * at a total of 100 and a sixth of it at 150, so a cap written once in points
 * quietly means something different every time somebody moves a slider.
 *
 * `weightsForBrowse` already assumed it: its largest-remainder rounding exists
 * to preserve the total so that a score from a landing page sits on the same
 * scale as a score from a search. This makes that a rule rather than a
 * workaround.
 */
export const WEIGHT_TOTAL = 100;

/**
 * The factors a redistribution may not move.
 *
 * Distance is pinned because it is the one weight that scores an *unknown* at
 * half credit for most buyers, so moving it moves everybody by the same amount
 * and nobody relative to anybody. Plan tier is pinned because it is the
 * commercial one: a redistribution that quietly raised it would be the exact
 * thing `PLAN_TIER_CEILING` exists to prevent, arrived at sideways.
 */
export const PINNED_KEYS = ["distance", "planTier"] as const satisfies readonly WeightKey[];

export function weightsTotal(weights: RankingWeights): number {
  return WEIGHT_KEYS.reduce((total, key) => total + weights[key], 0);
}

/**
 * Move one weight and take the difference out of the others in proportion.
 *
 * The editor's whole interaction. Six sliders and a *must total 100* rule with
 * no mechanism is the most important behaviour on the board left undefined —
 * the first render stated the rule and drew nothing that obeyed it.
 *
 * Three properties, each asserted in the unit tests:
 *
 *   · the total is `WEIGHT_TOTAL` afterwards, always;
 *   · pinned factors absorb nothing, in either direction;
 *   · a factor staff set to nought stays at nought. Redistributing *into* a
 *     signal somebody deliberately switched off makes the editor a suggestion,
 *     which is the objection `weightsForBrowse` already records.
 *
 * Rounding is by largest remainder, for the reason it is there: `Math.round`
 * per weight loses or invents points depending on the numbers, and a total that
 * is 99 on some drafts and 101 on others is not a rule.
 *
 * Where the absorbers cannot cover the move — every other unpinned weight is
 * already nought, or the move is larger than they hold between them — the moved
 * weight is clamped to what they *can* cover rather than the total being broken.
 * The editor then shows a number lower than the one dragged for, which is
 * honest: there is nowhere left for the points to come from.
 */
export function redistribute(
  weights: RankingWeights,
  key: WeightKey,
  value: number,
): RankingWeights {
  const pinned = new Set<WeightKey>(PINNED_KEYS);

  // A pinned weight is set directly and nothing else moves — the total is then
  // wrong, and `setWeights` refuses it. Pinned means "not part of the give and
  // take", not "uneditable": the ceiling copy on plan tier would be a lie if
  // the slider could not be moved at all.
  if (pinned.has(key)) return { ...weights, [key]: value };

  return spread(weights, key, value, WEIGHT_KEYS.filter((other) => other !== key && !pinned.has(other)));
}

/**
 * Set one weight and take the difference out of the named absorbers, in
 * proportion, preserving `WEIGHT_TOTAL`.
 *
 * The arithmetic `redistribute` was, extracted so that `weightsForShape` can
 * use it too. The two callers differ only in which factors absorb, and having
 * one body means they cannot differ in how they round: `Math.round` per weight
 * loses or invents points depending on the numbers, and a total that is 99 on
 * some queries and 101 on others is not a rule.
 */
export function spread(
  weights: RankingWeights,
  key: WeightKey,
  value: number,
  absorbers: readonly WeightKey[],
): RankingWeights {
  const pool = absorbers.reduce((total, other) => total + weights[other], 0);

  const headroom = weights[key] + pool;
  const next = Math.max(0, Math.min(value, headroom));
  const remaining = pool - (next - weights[key]);

  const result: RankingWeights = { ...weights, [key]: next };
  if (absorbers.length === 0) return result;

  if (pool === 0) {
    // Nothing to take from and nothing to give back to. `next` is clamped to
    // `weights[key]` above in that case, so this is the identity.
    return result;
  }

  const exact = absorbers.map((other) => ({
    key: other,
    share: (weights[other] * remaining) / pool,
  }));
  const whole = exact.map((entry) => ({ ...entry, floor: Math.floor(entry.share) }));
  let left = remaining - whole.reduce((total, entry) => total + entry.floor, 0);

  const order = [...whole].sort(
    (a, b) => (b.share - b.floor) - (a.share - a.floor) || weights[b.key] - weights[a.key],
  );
  const extra = new Map<WeightKey, number>(order.map((entry) => [entry.key, 0]));
  for (const entry of order) {
    if (left <= 0) break;
    extra.set(entry.key, 1);
    left -= 1;
  }

  for (const entry of whole) {
    result[entry.key] = entry.floor + (extra.get(entry.key) ?? 0);
  }
  return result;
}

/**
 * What a query is about, as far as the weights are concerned.
 *
 * Declared here rather than imported from `origin.ts` because that module is
 * `server-only` and this one is the pure half — and because the shape only
 * matters here, where it decides a vector.
 */
export type QueryShape = "sku" | "spec" | "service";

/** What distance is worth on a query of each shape. */
const DISTANCE_FOR_SHAPE: Partial<Record<QueryShape, number>> = {
  // A part number is the same part in Sharjah as in Dubai.
  sku: 4,
  // "AMC contractor" is mostly a question about who can get there.
  service: 14,
};

/**
 * The stored weights with distance moved to suit the query, and the rest
 * rebalanced so the six still add to a hundred.
 *
 * ## The rebalance is the fix, and the total is the reason
 *
 * This used to write the literal and return: `{ ...weights, distance: 4 }`.
 * Against the seeded 34/22/18/12/8/6 that totals **96** on a SKU query and
 * **106** on a service-shaped one, so the ranking scale differed by ten per
 * cent between two searches a buyer might run a minute apart.
 *
 * `WEIGHT_TOTAL`'s own docblock argues at length that the hundred is a rule and
 * not a workaround — *"a cap written once in points quietly means something
 * different every time somebody moves a slider"* — and `validateWeights`
 * enforces it. But it only ever saw the authored vector: the shape vector is
 * built after the settings are read and nothing checked it. So the rule held
 * everywhere except on the live search path, which is the one place it is
 * measured.
 *
 * ## Which factors absorb, and why not the other two
 *
 * The four that are neither distance nor plan tier, in proportion, through the
 * same largest-remainder arithmetic the admin editor uses — one body, so the
 * two cannot round differently.
 *
 * Plan tier is excluded for the reason `PINNED_KEYS` gives: it is the
 * commercial weight, and a shape transform that quietly raised it would be
 * `PLAN_TIER_CEILING` arrived at sideways. A buyer searching for a part number
 * would be shown more paid placement than one searching for a trade, and
 * nobody would have decided that.
 *
 * The old comment said *"a search that quietly rewrote three of them would make
 * that screen a suggestion rather than a setting"*. Proportional redistribution
 * is not that: every ratio staff set between the four is preserved exactly, and
 * `weightsForBrowse` already made the same trade for the same reason.
 *
 * ## The goods vector only
 *
 * The shape exists because how far a buyer will travel depends on what they are
 * buying — a part is worth a drive, a site visit is not. On the services vector
 * that question has already been answered by what the slot measures: coverage
 * match asks whether the firm comes to you, as a yes or a no, at the weight staff
 * set for exactly that kind of listing. Moving it again because the words typed
 * looked service-shaped would be the same judgement made twice, the second time
 * by a heuristic. Callers pass the services vector through untouched.
 */
export function weightsForShape(weights: RankingWeights, shape: QueryShape): RankingWeights {
  const distance = DISTANCE_FOR_SHAPE[shape];
  if (distance === undefined) return weights;

  return spread(weights, "distance", distance, ABSORBERS);
}

/** Everything but distance, which is moving, and plan tier, which is bought. */
const ABSORBERS = WEIGHT_KEYS.filter(
  (key) => key !== "distance" && key !== "planTier",
);

/** Above this the results stop being useful and buyers notice inside a week. */
export const PLAN_TIER_CEILING = 10;
/** A boost bigger than this replaces the ranking rather than nudging it. */
export const MAX_BOOST_POINTS = 25;
/** A boost cannot outlive the quarter somebody is thinking about. */
export const MAX_BOOST_DAYS = 90;

export const DEFAULT_WEIGHTS: RankingWeights = {
  relevance: 34,
  verificationTier: 22,
  responseTime: 18,
  specCompleteness: 12,
  distance: 8,
  planTier: 6,
};

/**
 * The services vector as board `12c-s` proposes it.
 *
 * Four points leave relevance. With no stock signal there is less evidence a
 * supplier is actually trading, so two go to verification and two to the reply
 * time the platform measures. Scope completeness and coverage match take the
 * spec and distance slots at the same 12 and 8, so neither kind is advantaged
 * and the two vectors stay the same shape.
 *
 * **Plan tier is identical, deliberately.** Two different plan weights would be
 * a commercial decision wearing a technical costume; `planTierAgrees` refuses a
 * publish that would make one.
 *
 * Never written by a migration. It is what the editor opens on while no
 * services vector has been saved or published — a proposal on the screen, not
 * a ranking anybody is subject to.
 */
export const DEFAULT_SERVICES_WEIGHTS: RankingWeights = {
  relevance: 30,
  verificationTier: 24,
  responseTime: 20,
  specCompleteness: 12,
  distance: 8,
  planTier: 6,
};

export function defaultWeightsFor(kind: RankingKind): RankingWeights {
  return kind === "services" ? DEFAULT_SERVICES_WEIGHTS : DEFAULT_WEIGHTS;
}

/**
 * What the fourth and fifth slots measure, per vector.
 *
 * The weights keep one set of keys on both vectors — the columns are named
 * `spec_completeness` and `distance`, and renaming them would make the
 * migration a drop-and-add with no safe order against a deploy. So the key is a
 * *slot* and this map is what the slot *measures*. `factorScores` reads it, and
 * so does the publish gate: there is one place that says a services vector
 * scores scope rather than spec, and it is the place the ranker actually uses.
 */
export interface FactorSources {
  specCompleteness: "spec" | "scope";
  distance: "distance" | "coverage";
}

export const FACTOR_SOURCES: Readonly<Record<RankingKind, FactorSources>> = {
  goods: { specCompleteness: "spec", distance: "distance" },
  services: { specCompleteness: "scope", distance: "coverage" },
};

/**
 * The message key that names a slot on a vector.
 *
 * Returned as a key rather than a string so that this module stays free of the
 * catalogue, and the caller — a client component or a service — does the
 * wording. On the services vector the fourth and fifth slots are named for what
 * they measure; everywhere else a slot keeps its one name.
 */
export function weightLabelKey(vector: RankingKind, key: WeightKey): string {
  return vector === "services" && (key === "specCompleteness" || key === "distance")
    ? `ranking.weight.services.${key}`
    : `ranking.weight.${key}`;
}

/** The impact table's *who gains* phrase for a slot, named the same way. */
export function gainsLabelKey(vector: RankingKind, key: WeightKey): string {
  return vector === "services" && (key === "specCompleteness" || key === "distance")
    ? `ranking.impact.gains.services.${key}`
    : `ranking.impact.gains.${key}`;
}

/**
 * `12c-s` B2 and criterion 3 — the slots a vector would score on a measure its
 * listings cannot earn.
 *
 * Empty means wired. A services vector whose completeness slot still reads spec
 * completeness re-inflicts the twelve-point zero under a new name, and one whose
 * proximity slot reads kilometres scores an office's address for work done at
 * the client's site. Either is a reason to **refuse** a publish, not warn about
 * one, because the defect is invisible in every number the board shows.
 *
 * Takes the map rather than reading it, so the refusal is testable against a
 * map that is wrong — the shipped one never is, and a gate whose failing branch
 * cannot be reached by a test is a gate nobody has seen close.
 */
export function unwiredSlots(
  kind: RankingKind,
  sources: FactorSources = FACTOR_SOURCES[kind],
): WeightKey[] {
  if (kind === "goods") return [];
  const unwired: WeightKey[] = [];
  if (sources.specCompleteness !== "scope") unwired.push("specCompleteness");
  if (sources.distance !== "coverage") unwired.push("distance");
  return unwired;
}

/**
 * `12c-s` B5 — plan tier is the same number on both vectors.
 *
 * Checked against the other vector's live weight **or the draft waiting to
 * follow it**. Against the live weight alone the rule deadlocks: moving plan
 * tier from 6 to 7 needs both vectors at 7, neither can publish first, and the
 * only way out would be to break the rule for a night. So one side saves and
 * publishes, the other side's draft carries the matching number, and the second
 * publish closes the gap.
 *
 * A vector with nothing live and nothing drafted — the services vector before
 * its first publish — constrains nothing, because nothing ranks on it.
 */
export function planTierAgrees(
  planTier: number,
  other: { live: number | null; draft: number | null },
): boolean {
  if (other.live === null && other.draft === null) return true;
  return planTier === other.live || planTier === other.draft;
}

/**
 * The vector a listing of this kind actually ranks on today.
 *
 * `12c-s` §States, first row: while no services vector is published *"the goods
 * vector serves everything; services rank on it"*. The board adds *"and lose the
 * 12 points"*, which is half right: a firm with no products has a null spec
 * completeness, and the ranker scores null as half — six points, stuck, whatever
 * the firm fills in. That is the truth of the platform until somebody presses
 * publish, and every reader
 * — the ranker, the snapshot, the impact preview, the seller's own screens —
 * has to tell it the same way.
 */
export function appliedVector(kind: RankingKind, servicesLive: boolean): RankingKind {
  return kind === "services" && servicesLive ? "services" : "goods";
}

/** Every signal a rankable row carries. Each is normalised to 0..1 below. */
export interface RankSignals {
  /** 0..1 from the text match. 1 for an exact name hit. */
  relevance: number;
  /** 0..4 from the database. */
  verificationTier: number;
  /** Median enquiry-to-first-reply. Null when unmeasured. */
  responseTimeMedianMs: number | null;
  /** 0..1 filled ratio. Null when the category has no template. */
  specCompleteness: number | null;
  /** Kilometres from the buyer. Null when we do not know where they are. */
  distanceKm: number | null;
  /** From Plan.rankingMultiplier — 1.0 free, 1.15 basic, 1.35 pro. */
  planMultiplier: number;
  /**
   * Share of the listing's live services holding all six required fields.
   *
   * `12c-s` B3: measured exactly as spec completeness is — complete rows out of
   * rows — with no credit for optional fields (Q2), because a score that rose
   * with every optional answer would reward verbosity. Null with no live service,
   * which scores as unknown rather than as empty. Only the services vector reads
   * it.
   */
  scopeCompleteness?: number | null;
  /**
   * Whether the matched service's effective coverage reaches the place the
   * buyer named — `12c-s` B4.
   *
   * Binary, because a firm either comes to you or works remotely; kilometres
   * between two offices say nothing about either. Null where the buyer named no
   * place, or the listing has stated no coverage at all — unknown, scored at
   * half, for the reason distance is. Only the services vector reads it.
   */
  coverageMatch?: boolean | null;
  /**
   * Points from a live `ListingBoost`, added on top rather than weighted.
   *
   * A boost is a nudge with a reason and an expiry, not a seventh signal — it
   * has no natural 0..1 shape and it is not a property of the listing. Added
   * after the weighted sum so its size is legible: five points is five points,
   * whatever the weights happen to be this week.
   */
  boostPoints?: number;
}

const HOUR = 3_600_000;

/**
 * An unmeasured signal scores 0.5, not 0.
 *
 * A new supplier with no enquiries yet has no response time, and scoring that
 * as "slowest possible" would bury every listing on its first day — which is
 * how a directory ends up with a frozen top ten. Half credit is the honest
 * position: we do not know.
 */
const UNKNOWN = 0.5;

function scoreResponseTime(ms: number | null): number {
  if (ms === null) return UNKNOWN;
  if (ms <= 4 * HOUR) return 1;
  if (ms >= 7 * 24 * HOUR) return 0;
  // Linear between four hours and a week. A buyer feels the difference between
  // two hours and two days; they do not feel the one between six and seven.
  return 1 - (ms - 4 * HOUR) / (7 * 24 * HOUR - 4 * HOUR);
}

function scoreDistance(km: number | null): number {
  // We do not ask for a location and most buyers arrive without one. Half
  // credit keeps the weight from silently becoming a penalty on everyone.
  if (km === null) return UNKNOWN;
  if (km <= 5) return 1;
  if (km >= 100) return 0;
  return 1 - (km - 5) / 95;
}

function scorePlan(multiplier: number): number {
  // 1.0 free, 1.35 pro. Mapped onto 0..1 so the weight means what it says.
  return Math.min(1, Math.max(0, (multiplier - 1) / 0.35));
}

/** One weight, by name. */
export type WeightKey = (typeof WEIGHT_KEYS)[number];

/** Every factor, normalised to 0..1, before any weight is applied. */
export type FactorScores = Record<WeightKey, number>;

/**
 * The six normalised scores, without the weights.
 *
 * Split out of `scoreRow` for the `3a`/`3l` amendment, which stores this vector
 * per listing per day so an attribution sentence can name *which* factor moved.
 * It has to be the ranker's own arithmetic rather than a second implementation
 * beside it: a copy would drift, and the first symptom would be a page telling
 * a seller their reply time cost them a place it did not cost them.
 */
export function factorScores(
  signals: RankSignals,
  vector: RankingKind = "goods",
  sources: FactorSources = FACTOR_SOURCES[vector],
): FactorScores {
  return {
    relevance: Math.min(1, Math.max(0, signals.relevance)),
    /*
       Normalised against the top achievable rung — 2 — and not the 4 the ladder
       stopped having when site visits were withdrawn. Until this, the strongest
       verification a supplier can hold contributed three quarters of the
       verification weight, whatever staff have it set to on board 12c: the whole
       directory ranked as though every verified listing were one rung short of
       something nobody can reach.
    */
    verificationTier: trustScore(signals.verificationTier),
    responseTime: scoreResponseTime(signals.responseTimeMedianMs),
    specCompleteness:
      sources.specCompleteness === "scope"
        ? (signals.scopeCompleteness ?? UNKNOWN)
        : (signals.specCompleteness ?? UNKNOWN),
    distance:
      sources.distance === "coverage"
        ? scoreCoverage(signals.coverageMatch ?? null)
        : scoreDistance(signals.distanceKm),
    planTier: scorePlan(signals.planMultiplier),
  };
}

function scoreCoverage(match: boolean | null): number {
  // No place named, or no coverage stated: unknown, not far. Same doctrine as
  // distance — not knowing must not read as evidence against anybody.
  if (match === null) return UNKNOWN;
  return match ? 1 : 0;
}

export function scoreRow(
  signals: RankSignals,
  weights: RankingWeights = DEFAULT_WEIGHTS,
  vector: RankingKind = "goods",
): number {
  const scores = factorScores(signals, vector);
  const weighted = WEIGHT_KEYS.reduce((total, key) => total + weights[key] * scores[key], 0);
  return weighted + (signals.boostPoints ?? 0);
}

export function rank<T>(
  rows: readonly T[],
  signalsOf: (row: T) => RankSignals,
  weights: RankingWeights = DEFAULT_WEIGHTS,
  vector: RankingKind = "goods",
): T[] {
  return [...rows]
    .map((row) => ({ row, score: scoreRow(signalsOf(row), weights, vector) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.row);
}

/** The vectors in force. `services` is null until one has been published. */
export interface VectorSet {
  goods: RankingWeights;
  services: RankingWeights | null;
}

/**
 * Which relevance band a 0..1 relevance falls in. Lower is better.
 *
 * Three bands, read off `relevanceOf`'s own arithmetic — `0.35 + 0.65 × share
 * of words hit` — rather than invented beside it: every word, at least half of
 * them, and fewer than that or a bare category match. On a page with no query
 * relevance is category depth, so an exact trade lands in the first band and a
 * sector-level match in the third.
 */
export function relevanceBand(relevance: number): number {
  if (relevance >= 0.999) return 0;
  if (relevance >= 0.675) return 1;
  return 2;
}

/**
 * One result set from two vectors — `12c-s` Q1, taken as the board recommends.
 *
 * **Scores from the two vectors are never compared.** A services result at 71
 * and a goods result at 71 did not earn their points the same way, and ordering
 * one against the other by that number is exactly the merged ordinal the board
 * refuses. So each kind is ranked on its own vector, in its own order, and the
 * two orders are merged by the one signal both vectors score identically —
 * relevance to what the buyer asked — and, inside a band, in proportion to how
 * many of each there are.
 *
 * Two properties follow, and both are asserted in the unit tests:
 *
 *   · **within a kind the order is exactly `rank`'s.** A services listing never
 *     overtakes another services listing because of where the goods ones fell;
 *   · **while no services vector is published there is one group**, and the
 *     result is byte-for-byte the single-vector ranking. Shipping this board
 *     reorders nothing until somebody publishes.
 *
 * `1c-s` is where blended search is drawn, and Q1 is its question. This is the
 * one function that answers it, so a different answer is a change here and
 * nowhere else.
 */
export function rankBlended<T>(
  rows: readonly T[],
  signalsOf: (row: T) => RankSignals,
  kindOf: (row: T) => RankingKind,
  vectors: VectorSet,
): T[] {
  const servicesLive = vectors.services !== null;
  const groups = new Map<RankingKind, T[]>();
  for (const row of rows) {
    const vector = appliedVector(kindOf(row), servicesLive);
    const group = groups.get(vector);
    if (group) group.push(row);
    else groups.set(vector, [row]);
  }

  const ranked = RANKING_KINDS.filter((kind) => groups.has(kind)).map((kind) => {
    const weights = kind === "services" ? vectors.services! : vectors.goods;
    return rank(groups.get(kind)!, signalsOf, weights, kind);
  });

  if (ranked.length <= 1) return ranked[0] ?? [];
  return mergeByBand(ranked, (row) => relevanceBand(signalsOf(row).relevance));
}

/**
 * Merge already-ordered groups without reordering any of them.
 *
 * At each step the head with the better relevance band goes first. Between heads
 * in the same band the group that is furthest behind its share goes first —
 * `(taken + ½) ÷ size`, the Sainte-Laguë quotient — so eighteen goods results and
 * two services results put a service near the fifth place and the fourteenth
 * rather than the first two or the last two. Remaining ties go to the larger
 * group, then to `RANKING_KINDS` order, so the result never depends on how a
 * `Map` iterated.
 */
export function mergeByBand<T>(groups: readonly (readonly T[])[], bandOf: (row: T) => number): T[] {
  const taken = groups.map(() => 0);
  const out: T[] = [];
  const total = groups.reduce((sum, group) => sum + group.length, 0);

  while (out.length < total) {
    let pick = -1;
    for (let g = 0; g < groups.length; g += 1) {
      const group = groups[g]!;
      if (taken[g]! >= group.length) continue;
      if (pick === -1) {
        pick = g;
        continue;
      }
      const best = groups[pick]!;
      const band = bandOf(group[taken[g]!]!);
      const bestBand = bandOf(best[taken[pick]!]!);
      if (band !== bestBand) {
        if (band < bestBand) pick = g;
        continue;
      }
      const quota = (taken[g]! + 0.5) / group.length;
      const bestQuota = (taken[pick]! + 0.5) / best.length;
      if (quota < bestQuota || (quota === bestQuota && group.length > best.length)) pick = g;
    }
    out.push(groups[pick]![taken[pick]!]!);
    taken[pick]! += 1;
  }
  return out;
}

/**
 * Place the sponsored slot.
 *
 * One per results page, always labelled. It never outranks a verified supplier
 * on a filter the buyer explicitly set: a buyer who ticked "tier 3 and up" has
 * told us what they care about, and selling the top of that list is the fastest
 * way to make the filter worthless. When such a filter is set the sponsor stays
 * in its natural rank position — still labelled, never promoted.
 */
export function placeSponsored<T>(
  ranked: readonly T[],
  sponsoredId: string | null,
  idOf: (row: T) => string,
  buyerSetAVerificationFilter: boolean,
): { rows: T[]; sponsoredId: string | null } {
  if (!sponsoredId) return { rows: [...ranked], sponsoredId: null };

  const index = ranked.findIndex((row) => idOf(row) === sponsoredId);
  if (index === -1) return { rows: [...ranked], sponsoredId: null };

  if (buyerSetAVerificationFilter) return { rows: [...ranked], sponsoredId };

  const rows = [...ranked];
  const [sponsor] = rows.splice(index, 1);
  return { rows: [sponsor!, ...rows], sponsoredId };
}
