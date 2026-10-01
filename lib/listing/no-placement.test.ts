import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Board 10g `B7` and 13d §4: the suggestion query "never joins the sponsored
 * table", asserted against the query rather than against who comes back.
 *
 * A supplier who buys placement elsewhere can appear in the suggestions, on the
 * same terms as everybody else — the board's own Al Waha does. So a test that
 * ran the query and checked a sponsored firm was absent would be asserting the
 * wrong thing, and one that checked the order would pass as well with the
 * placement read and weighted by nought. The guarantee is that nothing a seller
 * pays for is read at all, so this reads the source, the way
 * `lib/seo/curated/no-placement.test.ts` does for curated lists.
 * `tests/integration/unclaimed-listing.test.ts` runs the query with a boosted,
 * slotted candidate and holds the order to reply time.
 */

const SOURCE = join(process.cwd(), "lib/listing/suggestions.ts");

const BOUGHT = [
  "rankingMultiplier",
  "ranking_multiplier",
  "planTier",
  "plan_tier",
  "plan:",
  "planId",
  "PlacementSlot",
  "placementSlot",
  "placements",
  "ListingBoost",
  "listingBoost",
  "boosts",
  "boostPoints",
  "sponsored",
];

/** Comments say why a thing is absent; only code may not mention it. */
function code(body: string): string {
  return body
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*\*.*$/gm, "");
}

describe("nothing a seller buys reaches the suggestions on 10g and 13d", () => {
  const body = code(readFileSync(SOURCE, "utf8"));

  it("reads the module it means to", () => {
    // A move that left this path empty would make every assertion below pass.
    expect(body).toContain("export async function nearestVerifiedInTrade");
    expect(body).toContain("export function suggestionQuery");
  });

  for (const field of BOUGHT) {
    it(`never references \`${field}\``, () => {
      expect(body.includes(field)).toBe(false);
    });
  }
});
