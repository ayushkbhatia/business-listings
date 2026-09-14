/**
 * Board 4d — what a category's own fields may hold.
 *
 * Pure, so the editor can run the rule the save runs on every keystroke and
 * say what is wrong beside the field rather than after the round trip — the
 * same arrangement `lib/notify/draft.ts` has with the template editor.
 */

/** Lowercase, digits and hyphens. The same shape every other slug answers to. */
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const NAME_MAX = 80;
export const SLUG_MAX = 80;
export const SYNONYM_MAX = 60;
/**
 * Forty terms per category.
 *
 * The largest seeded list is under twenty. A list of hundreds is not routing,
 * it is keyword stuffing, and every term on it is matched on every search.
 */
export const SYNONYMS_MAX = 40;

/**
 * A two-letter mark, like `IN`.
 *
 * Checked only when it changes. The seed carries a hundred three-character
 * codes from before the rule existed, and refusing to save a display name on
 * one of those rows because of a code nobody touched would make the editor
 * unusable on a quarter of the tree.
 */
export const CODE = /^[A-Z]{2}$/;

export type FieldProblem =
  | "name_empty"
  | "name_too_long"
  | "slug_invalid"
  | "slug_too_long"
  | "code_invalid"
  | "synonym_too_long"
  | "too_many_synonyms";

/**
 * A slug from a display name — "Valves & actuators" becomes
 * `valves-and-actuators`, the form the rest of the tree uses.
 *
 * Diacritics fold to their base letter. A name with nothing Latin in it yields
 * an empty string, and the form then asks for the address rather than
 * inventing one: a transliterated Arabic slug is a guess about how somebody
 * would spell it.
 */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
}

export function nameProblem(name: string): FieldProblem | null {
  const trimmed = name.trim();
  if (!trimmed) return "name_empty";
  if (trimmed.length > NAME_MAX) return "name_too_long";
  return null;
}

export function slugProblem(slug: string): FieldProblem | null {
  if (slug.length > SLUG_MAX) return "slug_too_long";
  return SLUG.test(slug) ? null : "slug_invalid";
}

export function codeProblem(code: string, previous?: string): FieldProblem | null {
  if (previous !== undefined && code === previous) return null;
  return CODE.test(code) ? null : "code_invalid";
}

/**
 * Synonyms as they are stored: trimmed, inner space collapsed, compatibility
 * forms folded, and de-duplicated without regard to case.
 *
 * The first spelling wins. `Gate valve` and `gate valve` are one routing term,
 * and keeping both would count twice in every list that shows the number.
 *
 * Arabic is kept exactly as typed apart from NFKC. The array is matched
 * exactly (`synonyms: { has: token }` in search), so stripping the short vowels
 * here would change what routes — that folding belongs to the tree search,
 * which is a person looking, not a buyer being routed.
 */
export function normaliseSynonyms(input: readonly string[]): { value: string[]; problem: FieldProblem | null } {
  const value: string[] = [];
  const seen = new Set<string>();
  let problem: FieldProblem | null = null;

  for (const raw of input) {
    const term = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
    if (!term) continue;
    if (term.length > SYNONYM_MAX) problem ??= "synonym_too_long";
    const key = term.toLocaleLowerCase("en");
    if (seen.has(key)) continue;
    seen.add(key);
    value.push(term);
  }

  if (value.length > SYNONYMS_MAX) problem ??= "too_many_synonyms";
  return { value, problem };
}

/** The same two lists, compared the way they are stored. */
export function sameSynonyms(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((term, index) => term === b[index]);
}
