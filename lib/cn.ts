/**
 * Join class names. No dependency — the primitives are ours, and a class-name
 * joiner is four lines.
 *
 * Deliberately not tailwind-merge: variants are props on one component, so a
 * caller should never be passing a competing utility for the component to
 * resolve. If you find yourself needing a merge, the variant is missing.
 */
export type ClassValue = string | false | null | undefined;

export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
