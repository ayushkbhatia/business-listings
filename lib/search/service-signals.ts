import type { Emirate } from "@/lib/db/generated/enums";
import type { CoverageScope } from "@/lib/locations/coverage";
import { effectiveCoverage } from "@/lib/locations/service-coverage";
import { completeness, REQUIRED_COUNT, type RequiredFieldValues } from "@/lib/services/scope-sheet";

/**
 * Board `12c-s` — the two things a services listing is scored on that a goods
 * listing is not.
 *
 * Pure, with no database import, for the reason `lib/services/scope-sheet.ts`
 * gives: these rules leave the screen. The live search, the nightly snapshot and
 * the impact preview all rank with them, and three implementations of *does
 * this firm cover Sharjah* is how the preview comes to promise a reorder the
 * night then does not perform.
 */

/* ── Scope completeness ──────────────────────────────────────────────────── */

/** One service, as far as scope completeness and coverage match care. */
export interface RankableService extends RequiredFieldValues {
  categoryId: string;
  /** This service's own coverage rows. Empty inherits the business default. */
  coverage: readonly CoverageScope[];
}

/**
 * The share of live services whose six required fields are all answered.
 *
 * `12c-s` B3: *measured exactly as spec completeness is* — `specCompleteness`
 * in `lib/metrics/spec-completeness.ts` is complete products out of products,
 * so this is complete sheets out of sheets, to two places, and a firm with no
 * live service has `null` rather than zero. Null means there is nothing to fill
 * in yet, and the ranker scores it as unknown.
 *
 * **Six of six, or it does not count** — Q2. A sheet at five of six is not
 * five-sixths complete for ranking, for the same reason a product missing one
 * required spec is not: the comparison the fields exist for fails on the one
 * that is missing. Optional fields earn nothing, or the number becomes a reward
 * for verbosity; `3g-s` made them optional precisely because they do not always
 * apply.
 *
 * **Computed on read, never stored.** `3g-s` B3 says the number has no writable
 * path anywhere, and a column written by a nightly job would be a path — one a
 * seller could not reach, but one that lags the sheet by a day on the screen
 * that ranks it.
 *
 * Live services only. A draft has no page, so it cannot be what a buyer
 * compared, and a firm that keeps an unfinished draft should not rank below one
 * that deleted it.
 */
export function scopeCompleteness(liveServices: readonly RequiredFieldValues[]): number | null {
  if (liveServices.length === 0) return null;
  const complete = liveServices.filter(
    (service) => completeness(service).filled === REQUIRED_COUNT,
  ).length;
  return Number((complete / liveServices.length).toFixed(2));
}

/* ── Coverage match ──────────────────────────────────────────────────────── */

/**
 * The place the buyer named, as coverage understands places.
 *
 * `areaId` null means the buyer named only an emirate.
 */
export interface CoverageTarget {
  emirate: Emirate;
  areaId: string | null;
}

/**
 * Whether a coverage set reaches the place the buyer named.
 *
 * An emirate-wide row reaches every area inside it. An area row reaches that
 * area — and, when the buyer named only the emirate, it reaches the emirate too:
 * a firm that works in Al Quoz does work in Dubai, and *"a firm covering your
 * emirate scores the 8"* is the board's own sentence. The reverse does not hold:
 * a buyer in Al Quoz is not reached by a firm whose only Dubai row is Deira.
 */
export function coversTarget(set: readonly CoverageScope[], target: CoverageTarget): boolean {
  return set.some((scope) => {
    if (scope.emirate !== target.emirate) return false;
    if (target.areaId === null) return true;
    return scope.areaId === null || scope.areaId === target.areaId;
  });
}

/**
 * The services a query or a page actually matched.
 *
 * `12c-s` B4 — **never the business union.** A practice whose listing reads
 * seven emirates because one of its services covers them must not score the
 * coverage points on a query that service cannot answer. So:
 *
 *   · on a page or search scoped to categories, the live services filed under
 *     one of them;
 *   · with no category scope but words typed, the live services whose name holds
 *     one of those words;
 *   · with neither, or where nothing matched, none — and the caller falls back
 *     to the business default, which is what an unmatched service would inherit
 *     anyway. That is still not the union: a service that narrowed itself *wider*
 *     than the default does not lend its reach to the listing.
 */
export function matchedServices<S extends RankableService & { name: string | null }>(
  services: readonly S[],
  scope: { categoryIds?: readonly string[] | null; words?: readonly string[] },
): S[] {
  if (scope.categoryIds && scope.categoryIds.length > 0) {
    const wanted = new Set(scope.categoryIds);
    return services.filter((service) => wanted.has(service.categoryId));
  }
  const words = (scope.words ?? []).map((word) => word.toLowerCase()).filter(Boolean);
  if (words.length === 0) return [];
  return services.filter((service) => {
    const name = (service.name ?? "").toLowerCase();
    return words.some((word) => name.includes(word));
  });
}

/**
 * The coverage-match signal for one listing — binary, or unknown.
 *
 * `null` where the buyer named no place: there is nothing to match, and every
 * listing in the set would score the same, so it is scored as unknown rather
 * than as a yes or a no that means nothing. `null` also where the listing has
 * stated no coverage anywhere — the business default empty and every matched
 * service inheriting it — because not having said where you work is not
 * evidence that you do not work here. `2d-s` blocks publishing a services
 * listing in that state, so on a published listing this is the imported and
 * pre-fork case, and it scores as distance does for an unpinned branch.
 *
 * Otherwise the answer is yes if **any matched service** reaches the place, each
 * resolved through `effectiveCoverage` — its own rows where it has narrowed,
 * the default where it has not — and, with no matched service, the default.
 */
export function coverageMatch(input: {
  target: CoverageTarget | null;
  businessDefault: readonly CoverageScope[];
  matched: readonly RankableService[];
}): boolean | null {
  if (!input.target) return null;

  const sets =
    input.matched.length > 0
      ? input.matched.map((service) => effectiveCoverage(input.businessDefault, service.coverage))
      : [input.businessDefault];

  if (sets.every((set) => set.length === 0)) return null;
  return sets.some((set) => coversTarget(set, input.target!));
}
