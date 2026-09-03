import type { TestimonialAudience } from "@/lib/db/generated/enums";

/**
 * Which entry surface somebody came through.
 *
 * The same two values as `TestimonialAudience`, aliased rather than redeclared so a
 * third audience cannot be added to one and forgotten in the other.
 *
 * It travels in a query string, so it is attacker-controlled and is read
 * through `asAudience` everywhere. It selects copy and nothing else — the
 * closest it comes to a decision is preselecting a checkbox on `/signup`, which
 * the person can then untick.
 */
export type EntryAudience = TestimonialAudience;

export const ENTRY_AUDIENCES = ["buyer", "supplier"] as const satisfies readonly EntryAudience[];

/**
 * Which page each audience is served at.
 *
 * A switch rather than a ternary or a lookup table, for two reasons: adding a
 * third audience is a compile error here rather than a page that quietly links
 * to the wrong door, and it returns a `string` — `noUncheckedIndexedAccess`
 * makes a record lookup `string | undefined`, and a fallback path would be a
 * guess about where somebody came from.
 */
export function entryPath(audience: EntryAudience): string {
  switch (audience) {
    case "buyer":
      return "/for-buyers";
    case "supplier":
      return "/list-your-business";
  }
}

/** A query-string value, narrowed. Anything else is `null` rather than a guess. */
export function asAudience(value: unknown): EntryAudience | null {
  return typeof value === "string" && (ENTRY_AUDIENCES as readonly string[]).includes(value)
    ? (value as EntryAudience)
    : null;
}
