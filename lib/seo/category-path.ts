/**
 * Task T3.4 — a category's real address, in one place.
 *
 * The taxonomy is two levels on the public side: `/c/:trade` for a top-level
 * trade and `/c/:trade/:niche` for a subcategory. So a link built as
 * `/c/${category.slug}` is right for half the tree and a **404** for the other
 * half, and three places built it that way:
 *
 *   · board 10a's zero-result state, whose *Browse the whole category* link is
 *     the one thing offered to a buyer who found nothing — so the dead end had
 *     a dead end in it;
 *   · the campaign landing page's call to action, which is the single
 *     conversion path on a page bought traffic lands on;
 *   · and the sitemap, which got it right by walking the tree itself.
 *
 * A function rather than three fixes, because the next person to link to a
 * category will reach for a template string too. It takes the parent's slug
 * rather than looking it up: every caller already has it or can select it in
 * the query it is already making, and a path helper that reads the database is
 * a path helper nobody uses on a client component.
 *
 * `parentSlug` is null for a top-level trade and `undefined` where the caller
 * does not know — and those two are deliberately the same answer here, because
 * guessing a parent would be the defect this fixes wearing a helper's clothes.
 * A caller that does not know must select it; `tests/unit/category-path.test.ts`
 * pins the three cases.
 */
export function categoryPath(category: {
  slug: string;
  parentSlug?: string | null;
}): string {
  return category.parentSlug
    ? `/c/${category.parentSlug}/${category.slug}`
    : `/c/${category.slug}`;
}
