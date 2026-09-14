/*
   Pure, and apart from `categories.ts` for a reason: the approval queue reads
   this check (board 4b), and `categories.ts` writes. A console screen that
   imports a module which mutates is a screen `check:audit` has to account for.
*/

/**
 * Does the licence's stated activity cover this category?
 *
 * A word match against the category's own name, its parent's, and the synonyms
 * the taxonomy already carries for query routing — the same list that decides
 * whether a buyer's Arabic search reaches this trade, reused rather than a
 * second vocabulary to maintain.
 *
 * **An absent activity covers everything.** A listing imported from an export
 * that carried no activity column has told us nothing, and a flag raised on
 * silence would put every one of them in front of a reviewer to say so.
 */
export function activityCovers(
  activity: string | null,
  category: { name: string; synonyms?: string[]; parent?: { name: string } | null },
): boolean {
  const text = (activity ?? "").toLowerCase();
  if (!text.trim()) return true;

  const terms = [
    category.name,
    category.parent?.name ?? "",
    ...(category.synonyms ?? []),
  ]
    .flatMap((term) => term.toLowerCase().split(/[^\p{Letter}\p{Number}]+/u))
    .filter((word) => word.length >= 4);

  return terms.some((word) => text.includes(word));
}
