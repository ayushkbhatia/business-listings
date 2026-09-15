import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BANNED, LEGAL_SUFFIX, ORDER, PROVENANCE, SITE_VISIT, vocabularyProblems } from "./vocabulary";

const script = readFileSync(join(process.cwd(), "scripts/check-vocabulary.sh"), "utf8");

/** `NAME='…'` followed by any `NAME+='…'` lines, joined the way bash joins them. */
function assembled(name: string): string {
  const parts = [...script.matchAll(new RegExp(`^${name}\\+?='(.*)'$`, "gm"))].map((match) => match[1]);
  expect(parts.length, `${name} in scripts/check-vocabulary.sh`).toBeGreaterThan(0);
  return parts.join("");
}

describe("the save-time vocabulary rules", () => {
  it("are the CI scan's patterns, character for character", () => {
    expect(BANNED).toBe(assembled("BANNED"));
    expect(ORDER).toBe(assembled("ORDER"));
    expect(PROVENANCE).toBe(assembled("PROVENANCE"));
    expect(SITE_VISIT).toBe(assembled("VISITS"));
    expect(script).toContain(`grep -E '${LEGAL_SUFFIX}'`);
  });

  it("refuses the words for things that do not exist, and lets the real ones through", () => {
    expect(vocabularyProblems("Add to cart")).toEqual([{ rule: "banned", match: "Add to cart" }]);
    expect(vocabularyProblems("Track your order")).toMatchObject([{ rule: "order" }]);
    expect(vocabularyProblems("Nexa Freight & Logistics LLC")).toMatchObject([{ rule: "legal_suffix" }]);
    expect(vocabularyProblems("Verified buyer")).toMatchObject([{ rule: "provenance" }]);
    expect(vocabularyProblems("Our field team checked it")).toMatchObject([{ rule: "site_visit" }]);

    expect(vocabularyProblems("Describe the work and when you need it done.")).toEqual([]);
    expect(vocabularyProblems("Made to order, minimum order quantity 40")).toEqual([]);
    expect(vocabularyProblems("What clients said")).toEqual([]);
  });
});
