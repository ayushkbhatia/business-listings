import "server-only";
import { countResults } from "@/lib/db/queries/search";
import { parseSearchQuery } from "@/lib/search/query";
import { memberScopeOf, type LandingScope } from "./scope";
import { servicesMembers } from "./services-supply";

/**
 * How many rows a landing page lists — what its pager and its 404 for a page
 * number past the end are measured against.
 *
 * Two rules, one per template, and each is the rule its page renders with. The
 * goods page counts what `searchBusinesses` would rank, narrowed by a
 * subcategory chip where one is applied. The services page counts its members
 * — firms that cover the place (`6a-s` B1) — which is the same set its stat
 * line, its gate and its ranking read. A pager counted by branch address on a
 * page listed by coverage would offer pages that are empty, or hide ones that
 * are not.
 */
export async function landingResultCount(
  scope: LandingScope,
  chipCategoryId: string | null,
  now = new Date(),
): Promise<number> {
  if (scope.trade === "services") return (await servicesMembers(memberScopeOf(scope), now)).length;
  return countResults(
    {
      ...parseSearchQuery({}),
      ...(scope.area ? { area: scope.area.slug } : { emirate: scope.emirate }),
      tab: "businesses",
    },
    chipCategoryId ? [chipCategoryId] : scope.categoryIds,
  );
}
