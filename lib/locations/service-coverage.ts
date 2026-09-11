import type { DeliveryMode, Emirate } from "@/lib/db/generated/enums";
import { sameScope, type CoverageScope } from "./coverage";

/**
 * Board `2d-s` — where a services business works, and how the work reaches the
 * client.
 *
 * Pure. The picker runs in the browser and has to agree with the server about
 * what is claimed, what is blocked and what a buyer will be shown, so the rules
 * live once here and both sides import them.
 *
 * ## The three rules this module exists to hold
 *
 * **B2 — the publish gate is a mode and an area, never a coordinate.** `2d`
 * blocks publish until a branch has `lat`/`lng`, because an unpinned branch is
 * excluded from the results map by a `where` clause. Carried across unchanged,
 * that check means no services business can ever publish: a consultancy has no
 * gate to pin. The equivalent gate is one delivery mode and one coverage area.
 *
 * **B5 — the default is inherited, never copied down.** What this screen writes
 * is the business default. A service with no coverage of its own resolves to it
 * *at read time*. Copy it onto each service at write time and every later edit
 * of the default silently fails to reach the services that were stamped from it.
 *
 * **B6 — what a buyer sees is the union, never the default line.** Once services
 * carry their own coverage, the business's coverage is the union of its
 * published services' effective coverage. Get this backwards and narrowing one
 * service shrinks the whole listing — the seller is punished for being precise,
 * which is the opposite of what the screen asks of them.
 *
 * `CoverageScope` is deliberately the same type board 3c's delivery coverage
 * uses. The two are different claims — a delivery promise against a place the
 * work happens — but they are the same *shape*, and everything downstream that
 * already reads `(emirate, areaId)` needs no translation to read this.
 */

/* ── How the work reaches the client ─────────────────────────────────────── */

/**
 * The three modes, in the order the screen asks them.
 *
 * Ordered from least to most geographically constrained, which is also the
 * order that makes the question answerable: a practice reading down the list
 * stops at the first one that is true of them, and the ones below it narrow.
 */
export const DELIVERY_MODES = ["remote", "at_our_office", "at_client_site"] as const;

export function isDeliveryMode(value: string): value is DeliveryMode {
  return (DELIVERY_MODES as readonly string[]).includes(value);
}

/**
 * B8 — whether any distance affordance may render anywhere downstream.
 *
 * Suppressed, not disabled. A greyed-out radius slider on a remote practice's
 * screen is a control telling them they are missing something they are not:
 * there is no distance to state, because nobody is travelling.
 */
export function travelsToClients(modes: readonly DeliveryMode[]): boolean {
  return modes.includes("at_client_site");
}

/**
 * What the helper line under the mode group says the areas beneath it *mean*.
 *
 * Three cases and they are genuinely different questions, which is the whole
 * reason the mode group sits above the areas rather than beside them. Ask for
 * emirates first and a remote-only practice reasonably ticks all eight — true,
 * and useless. Ask how the work reaches the client first and the emirate list
 * acquires a meaning before it is filled in.
 */
export type CoverageFraming = "unanswered" | "where_clients_are" | "where_you_travel";

export function framingFor(modes: readonly DeliveryMode[]): CoverageFraming {
  if (modes.length === 0) return "unanswered";
  return travelsToClients(modes) ? "where_you_travel" : "where_clients_are";
}

/* ── The gate ────────────────────────────────────────────────────────────── */

/** What is still missing before a services listing can go live. B2, AC3. */
export type CoverageGap = "delivery_mode" | "coverage_area";

export interface CoverageReadiness {
  ready: boolean;
  /** In the order the screen asks them, so the first is the one to point at. */
  missing: CoverageGap[];
}

export function coverageReadiness(input: {
  deliveryModes: readonly DeliveryMode[];
  coverage: readonly CoverageScope[];
}): CoverageReadiness {
  const missing: CoverageGap[] = [];
  if (input.deliveryModes.length === 0) missing.push("delivery_mode");
  if (input.coverage.length === 0) missing.push("coverage_area");
  return { ready: missing.length === 0, missing };
}

/* ── Inheritance, and the union ──────────────────────────────────────────── */

/**
 * B5. One service's coverage: its own rows if it has any, otherwise the
 * business default.
 *
 * The emptiness is the signal, and it has to be, because there is no third
 * state to store. A service with no rows has not been narrowed; a service that
 * has been narrowed has rows. Storing "inherits: true" alongside would let the
 * two disagree, and something would eventually write one without the other.
 */
export function effectiveCoverage(
  businessDefault: readonly CoverageScope[],
  ownRows: readonly CoverageScope[],
): readonly CoverageScope[] {
  return ownRows.length > 0 ? ownRows : businessDefault;
}

/**
 * B6. The union of several coverage sets, deduplicated at both scales.
 *
 * An emirate-wide claim swallows the area rows inside it, because a buyer
 * filtering for Al Quoz matches a supplier covering Dubai and rendering both
 * chips says the same thing twice. The reverse is not true: three area rows in
 * Dubai do not add up to Dubai, and collapsing them would widen a claim the
 * seller did not make.
 */
export function unionCoverage(sets: readonly (readonly CoverageScope[])[]): CoverageScope[] {
  const all = sets.flat();

  const wholeEmirates = new Set<Emirate>(
    all.filter((scope) => scope.areaId === null).map((scope) => scope.emirate),
  );

  const out: CoverageScope[] = [];
  for (const scope of all) {
    if (scope.areaId !== null && wholeEmirates.has(scope.emirate)) continue;
    if (out.some((held) => sameScope(held, scope))) continue;
    out.push({ emirate: scope.emirate, areaId: scope.areaId });
  }
  return out;
}

/**
 * What a buyer is shown as this business's coverage — the single helper B6 asks
 * for, used by the storefront, the facets and the fan-out matcher alike.
 *
 * `publishedServices` is every published service's own rows, one array each.
 * A business with no services yet passes none, and the answer is its default —
 * which is the state every services seller is in the moment they finish this
 * screen, and the state the whole directory is in today.
 */
export function businessCoverage(
  businessDefault: readonly CoverageScope[],
  publishedServices: readonly (readonly CoverageScope[])[] = [],
): CoverageScope[] {
  if (publishedServices.length === 0) return unionCoverage([businessDefault]);
  return unionCoverage(
    publishedServices.map((own) => effectiveCoverage(businessDefault, own)),
  );
}

/** The emirates a coverage set reaches, for `1h`'s locality term and the facets. */
export function emiratesCovered(scopes: readonly CoverageScope[]): Emirate[] {
  return [...new Set(scopes.map((scope) => scope.emirate))];
}
