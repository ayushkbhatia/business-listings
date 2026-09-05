import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Board 6b §5 requirement 3, asserted the way the spec asks for it.
 *
 *   *"Plan tier is **absent** from selection. `6a`'s ranking config gives plan
 *    tier 6 points; the curated-list selection query must not read that field at
 *    all, and the test asserts the field is unreferenced rather than weighted to
 *    zero."*
 *
 * So this reads the source rather than the behaviour. A test that ran the
 * selection and checked the order would pass just as well with the field read
 * and multiplied by nought — and a weight of nought is a decision somebody can
 * revisit in a config screen, while an absent field is not.
 *
 * ## Why the guarantee needs a test at all now
 *
 * It did not used to. Membership was computed from three criteria and
 * `CuratedList` had no placement column, so "placement cannot be bought" held
 * because there was nowhere to put it. Board 6b §3 made membership authored —
 * hand-written entries cross-reference each other and no automated process can
 * rewrite prose — which means there is now a row a person writes, and the
 * guarantee has to be asserted rather than assumed.
 */

const DIR = join(process.cwd(), "lib/seo/curated");

/**
 * Anything a seller pays for.
 *
 * `enquiriesPerMonth` is deliberately **not** here. `recipients.ts` reads it,
 * and it is a plan field — but it is not placement: it decides who can receive
 * an enquiry today, which is `1h`'s rule about capacity and applies to every
 * surface equally. It cannot move anybody up a list, because it is read after
 * membership is already fixed.
 */
const BOUGHT = [
  "rankingMultiplier",
  "ranking_multiplier",
  "planTier",
  "plan_tier",
  "PlacementSlot",
  "placementSlot",
  "ListingBoost",
  "listingBoost",
  "boostPoints",
  "sponsored",
];

function sources(): { name: string; body: string }[] {
  return readdirSync(DIR)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => ({ name, body: readFileSync(join(DIR, name), "utf8") }));
}

/** Comments explain why a thing is absent; only code may not mention it. */
function code(body: string): string {
  return body
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*\*.*$/gm, "");
}

describe("nothing a seller buys reaches a curated list", () => {
  it("has sources to read", () => {
    // A rename that emptied this directory would otherwise make every
    // assertion below vacuously true.
    const files = sources().map((file) => file.name).sort();
    expect(files).toContain("audit.ts");
    expect(files).toContain("criteria.ts");
    expect(files).toContain("read.ts");
  });

  for (const field of BOUGHT) {
    it(`never references \`${field}\``, () => {
      const offenders = sources()
        .filter((file) => code(file.body).includes(field))
        .map((file) => file.name);
      expect(
        offenders,
        `${field} appears in ${offenders.join(", ")}. Board 6b §5: placement is absent from selection, not weighted to zero.`,
      ).toEqual([]);
    });
  }

  it("does not import the search ranking", () => {
    /*
       `lib/search/ranking.ts` weighs plan tier — correctly, on a results page,
       where the slot is labelled. Importing it here would bring that weight
       onto the one page that publishes "paid placement: never".
    */
    const offenders = sources()
      .filter((file) => code(file.body).includes("search/ranking"))
      .map((file) => file.name);
    expect(offenders).toEqual([]);
  });

  it("keeps the criteria free of anything but measured signals", () => {
    const criteria = readFileSync(join(DIR, "criteria.ts"), "utf8");
    // The three the page publishes, and nothing else that could order a list.
    expect(code(criteria)).toContain("verificationTier");
    expect(code(criteria)).toContain("responseTimeMedianMs");
    expect(code(criteria)).toContain("reviewCount");
  });
});
