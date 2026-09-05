import { describe, expect, it } from "vitest";
import { DEFAULT_WEIGHTS, WEIGHT_KEYS } from "@/lib/search/ranking";

/**
 * Board 8e's two arithmetic rules, tested where they are cheap.
 *
 * `lib/setup/complete.ts` is `server-only`, so what can be asserted without a
 * database is the shape of the thing it reads and the shape of what it must
 * produce. The behaviour that needs rows — the delta hiding itself, the
 * once-only redirect — is in tests/integration/setup-done.test.ts.
 *
 * What this file is really guarding is §4's instruction: **read the weights
 * from the same config as search**. A copy of those numbers on the completion
 * screen would be right on the day it was written and wrong the first time
 * somebody retunes ranking in admin, and nothing would fail — the screen would
 * simply start lying quietly, which is the failure mode this project's rules
 * are mostly about.
 */

describe("the ranking card and the search ranking are one set of numbers", () => {
  it("names exactly the factors search ranks by, and no others", () => {
    /*
       The completion screen renders `WEIGHT_KEYS` and a catalogue key each. A
       seventh factor added to ranking without a label here would render as a
       raw key, and a factor dropped from ranking would leave a bar on this
       screen for a signal that no longer exists.
    */
    expect([...WEIGHT_KEYS].sort()).toEqual(
      [
        "relevance",
        "verificationTier",
        "responseTime",
        "specCompleteness",
        "distance",
        "planTier",
      ].sort(),
    );
  });

  it("has a catalogue label for every factor", async () => {
    const { en } = await import("@/lib/i18n/en");
    for (const key of WEIGHT_KEYS) {
      expect(en, key).toHaveProperty(`setup_done.rank.${key}`);
    }
  });

  it("matches the weights board 8e §4 draws", () => {
    /*
       The board names relevance 34, verification 22, response time 18, spec
       completeness 12, distance 8, plan 6 — and they are the shipped defaults,
       which is why the screen may read them live rather than restating them.
       If this fails, either ranking was retuned (fine — the screen follows) or
       the board and the product have drifted (not fine).
    */
    expect(DEFAULT_WEIGHTS).toEqual({
      relevance: 34,
      verificationTier: 22,
      responseTime: 18,
      specCompleteness: 12,
      distance: 8,
      planTier: 6,
    });
  });

  it("sums to a hundred, so the bars are a share of something real", () => {
    const total = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(100);
  });
});

describe("the copy the screen needs", () => {
  it("carries every clause the board makes conditional", async () => {
    /*
       Each of these is rendered only when its figure exists — §2 and §5 are
       explicit that a missing baseline drops the clause rather than guessing
       one. A key removed in a copy edit would take the conditional branch with
       it and the screen would silently stop saying what it gained.
    */
    const { en } = await import("@/lib/i18n/en");
    for (const key of [
      "setup_done.strength_rose",
      "setup_done.strength_rose_partial",
      "setup_done.strength_complete",
      "setup_done.filters",
      "setup_done.tick.photos",
      "setup_done.tick.photos_no_cover",
      "setup_done.tick.products",
      "setup_done.tick.team",
      "setup_done.once_body",
      "setup_done.rank_note",
    ]) {
      expect(en, key).toHaveProperty(key);
    }
  });

  it("never promises a site visit, which no longer exists", async () => {
    const { en } = await import("@/lib/i18n/en");
    const copy = Object.entries(en)
      .filter(([key]) => key.startsWith("setup_done."))
      .map(([, value]) => (typeof value === "string" ? value : Object.values(value).join(" ")))
      .join(" ");
    expect(copy).not.toMatch(/site visit/i);
  });
});
