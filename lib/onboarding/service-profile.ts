/**
 * Board `2c-s` — the services field set, and the rules it answers to.
 *
 * Pure, with no database import, so the caps and the normalisation are unit
 * tested without one and can be imported by the client form that renders the
 * counters. `lib/onboarding/profile-fields.ts` exists for the same reason and
 * says why: a *constant* crossing the server boundary is a real import, and it
 * pulled `pg` into the browser bundle once already.
 */

/** The one-liner cap. Ninety characters, and it shows in every search result. */
export const HEADLINE_MAX = 90;

/**
 * How many services a seller may name — B4, and a judgement rather than a limit.
 *
 * A practice claiming twelve services has not thought about any of them, and the
 * scope-sheet family gets ambiguous past a handful. Enforced server-side and
 * named in the refusal: silently dropping the sixth teaches a seller that the
 * form is lying to them.
 */
export const SERVICES_MAX = 5;

/**
 * And how many sectors. Not in the board, and needed all the same.
 *
 * The field is free text with free entry, which is an unbounded array on a row
 * every search result reads. A seller pasting two hundred sectors is not a
 * malicious act, it is a Friday afternoon — and the card would render it.
 */
export const SECTORS_MAX = 20;

/** Longest a single free-entry sector may be. A sentence is not a sector. */
export const SECTOR_MAX_LENGTH = 40;

/**
 * The matching form of a sector — B3.
 *
 * Trimmed, inner whitespace collapsed, case-folded. *Free Zone*, *free  zone*
 * and ` Free zone ` are one sector. Matching only: what is stored is what the
 * seller typed, because it is their own word for their own industry and a
 * lower-cased slug is not it.
 */
export function sectorSlug(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** The stored form: trimmed and collapsed, case as typed. */
export function sectorLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * Deduplicate a list of sectors by matching form, keeping the first spelling.
 *
 * First rather than last, so a seller who picks a chip and then types the same
 * thing keeps the chip's established spelling rather than their typo.
 */
export function dedupeSectors(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of values) {
    const label = sectorLabel(raw);
    if (!label) continue;
    const slug = sectorSlug(label);
    if (seen.has(slug)) continue;
    seen.add(slug);
    kept.push(label);
  }
  return kept;
}

export type ProfileRefusal =
  | { field: "headline"; reason: "too_long"; max: number }
  | { field: "servicesOffered"; reason: "too_many"; max: number }
  | { field: "sectorsServed"; reason: "too_many"; max: number }
  | { field: "sectorsServed"; reason: "entry_too_long"; max: number };

export interface ServiceProfileInput {
  headline?: string | null;
  sectorsServed?: readonly string[];
  servicesOffered?: readonly string[];
}

export interface ServiceProfileClean {
  headline: string | null;
  sectorsServed: string[];
  servicesOffered: string[];
}

/**
 * Clean and check the services field set.
 *
 * Returns every refusal rather than the first, so a seller who is over on two
 * fields is told both times instead of discovering the second after fixing the
 * first. Nothing is truncated — a refusal names the cap and leaves the value
 * alone, which is B4's whole point and applies to the sectors as well.
 */
export function checkServiceProfile(
  input: ServiceProfileInput,
): { ok: true; value: ServiceProfileClean } | { ok: false; refusals: ProfileRefusal[] } {
  const refusals: ProfileRefusal[] = [];

  const headline = typeof input.headline === "string" ? input.headline.trim() : null;
  if (headline && headline.length > HEADLINE_MAX) {
    refusals.push({ field: "headline", reason: "too_long", max: HEADLINE_MAX });
  }

  const services = dedupeSectors(input.servicesOffered ?? []);
  if (services.length > SERVICES_MAX) {
    refusals.push({ field: "servicesOffered", reason: "too_many", max: SERVICES_MAX });
  }

  const sectors = dedupeSectors(input.sectorsServed ?? []);
  if (sectors.length > SECTORS_MAX) {
    refusals.push({ field: "sectorsServed", reason: "too_many", max: SECTORS_MAX });
  }
  if (sectors.some((sector) => sector.length > SECTOR_MAX_LENGTH)) {
    refusals.push({ field: "sectorsServed", reason: "entry_too_long", max: SECTOR_MAX_LENGTH });
  }

  if (refusals.length > 0) return { ok: false, refusals };

  return {
    ok: true,
    value: {
      headline: headline && headline.length > 0 ? headline : null,
      sectorsServed: sectors,
      servicesOffered: services,
    },
  };
}

/**
 * Which field set a seller sees — B1, and the only branch on this screen.
 *
 * One screen with a conditional field set, never a second route and never a
 * forked component. `both` sees both groups, labelled, and nothing is hidden
 * behind a toggle: a seller who sells both fills both.
 */
export function fieldSetFor(sellsKind: string): { services: boolean; goods: boolean } {
  return {
    services: sellsKind === "services" || sellsKind === "both",
    // `unset` still gets the goods set, which is what every seller saw before
    // this board existed. Onboarding routes an unset seller to `2b-s` first, so
    // this only governs a listing that predates the fork.
    goods: sellsKind !== "services",
  };
}
