/**
 * The buyer's typed area, resolved to an `Area` row — or not at all.
 *
 * Pure, and separate from the write, because the whole question is *when do we
 * refuse to guess* and that is the part worth testing. The composer collects a
 * free-text line; the taxonomy holds 300-odd named places; and the honest
 * answer for most of what a buyer types is **nothing**.
 *
 * ## Exact, and deliberately nothing cleverer
 *
 * Case and surrounding space are noise and are normalised away. Everything
 * else is a match or it is not.
 *
 * A trigram or prefix match would fill more rows and some of them would be
 * wrong, and wrong here is expensive in a specific way: this id is what lets a
 * seller covering only Al Quoz be matched to an enquiry, so a bad resolve sends
 * a job to somebody who does not work there and hides it from somebody who
 * does. "Al Quoz 1" and "Al Quoz Industrial Area 3" are different places with
 * the same prefix. The platform does not guess a delivery address.
 *
 * ## The emirate narrows it, and null does not widen it
 *
 * "Industrial Area 1" is a real place in more than one emirate. With an emirate
 * stated, the match is scoped to it. With none stated, a name is accepted only
 * when it is unambiguous across the whole country — because picking one of
 * three would be a coin toss recorded as a fact.
 */

export interface AreaRow {
  id: string;
  name: string;
  emirate: string;
}

/** Lower-cased, trimmed, inner runs of space collapsed. Nothing else. */
export function areaKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function resolveEnquiryArea(
  typed: string | null | undefined,
  emirate: string | null | undefined,
  areas: readonly AreaRow[],
): string | null {
  if (!typed) return null;
  const key = areaKey(typed);
  if (key === "") return null;

  const matches = areas.filter((area) => areaKey(area.name) === key);
  if (matches.length === 0) return null;

  if (emirate) {
    const inEmirate = matches.filter((area) => area.emirate === emirate);
    /*
       One match in the stated emirate, or nothing. Falling back to a match in
       another emirate when the buyer has told us which one they mean would be
       reading their answer and then ignoring it.
    */
    return inEmirate.length === 1 ? inEmirate[0]!.id : null;
  }

  return matches.length === 1 ? matches[0]!.id : null;
}
