import { describe, expect, it } from "vitest";
import { contentChecks, MIN_WORDS, passedCount } from "./content-check";
import { readBlocks, proseOf, type Block } from "./blocks";

/**
 * Board 5d's content check.
 *
 * The reason it exists is scale: a template page is authored once and lands on
 * every storefront in the sector, so a thin one is not one thin page — it is
 * 1,842 identical ones, which is the shape search engines treat as doorway
 * content.
 */

const block = (kind: Block["kind"], values: Record<string, unknown> = {}): Block => ({
  id: `${kind}-${Math.abs(kind.length)}`,
  kind,
  values,
});

const longProse = Array.from({ length: MIN_WORDS + 10 }, (_, index) => `word${index}`).join(" ");

const input = (blocks: Block[]) => ({
  blocks,
  sectorName: "Valves & fittings",
  places: ["Dubai", "Al Quoz", "Sharjah"],
});

describe("the four checks", () => {
  it("counts the words a reader would actually read", () => {
    const checks = contentChecks(input([block("text", { body: longProse })]));
    const length = checks.find((check) => check.key === "length")!;
    expect(length.passed).toBe(true);
    expect(Number(length.detail)).toBeGreaterThanOrEqual(MIN_WORDS);
  });

  it("fails a stub and says how many words it has", () => {
    const checks = contentChecks(input([block("text", { body: "We sell valves in Dubai." })]));
    const length = checks.find((check) => check.key === "length")!;
    expect(length.passed).toBe(false);
    expect(length.detail).toBe("5");
  });

  it("counts a trade mention loosely, because nobody writes the category name", () => {
    /*
     * The trade is "Valves & fittings" and no sentence contains that. A page
     * saying "valves" has mentioned the trade as far as a reader is concerned,
     * and a check that demanded the exact string would be a check somebody
     * satisfies by pasting a category name into a paragraph.
     */
    const checks = contentChecks(
      input([block("text", { body: "We stock valves for contractors across Dubai." })]),
    );
    expect(checks.find((check) => check.key === "local")!.passed).toBe(true);
  });

  it("says which half of the local check is missing", () => {
    const noPlace = contentChecks(input([block("text", { body: "We stock valves." })]));
    expect(noPlace.find((check) => check.key === "local")).toMatchObject({
      passed: false,
      detail: "place",
    });

    const noTrade = contentChecks(input([block("text", { body: "We deliver across Dubai." })]));
    expect(noTrade.find((check) => check.key === "local")).toMatchObject({
      passed: false,
      detail: "trade",
    });
  });

  it("wants an image and wants it described", () => {
    const none = contentChecks(input([block("text", { body: "x" })]));
    expect(none.find((check) => check.key === "image_alt")).toMatchObject({
      passed: false,
      detail: "none",
    });

    const undescribed = contentChecks(
      input([block("image_text", { image: "a.jpg", body: "x" })]),
    );
    expect(undescribed.find((check) => check.key === "image_alt")).toMatchObject({
      passed: false,
      detail: "0/1",
    });

    const described = contentChecks(
      input([block("image_text", { image: "a.jpg", alt: "The counter at Al Quoz", body: "x" })]),
    );
    expect(described.find((check) => check.key === "image_alt")!.passed).toBe(true);
  });

  it("counts a call to action as the internal link", () => {
    const without = contentChecks(input([block("text", { body: "x" })]));
    expect(without.find((check) => check.key === "internal_link")!.passed).toBe(false);

    const withCta = contentChecks(
      input([block("text", { body: "x" }), block("cta", { label: "See the catalogue" })]),
    );
    expect(withCta.find((check) => check.key === "internal_link")!.passed).toBe(true);
  });

  it("is advisory — it returns results and refuses nothing", () => {
    /*
     * There is no `blocked` field and no throw. A check that blocked publishing
     * is a check somebody routes around by padding the word count, and staff
     * know things this does not.
     */
    const checks = contentChecks(input([]));
    expect(checks).toHaveLength(4);
    expect(passedCount(checks)).toBe(0);
    expect(Object.keys(checks[0]!)).not.toContain("blocked");
  });
});

describe("reading blocks out of the column", () => {
  it("drops a kind that has left the vocabulary rather than throwing", () => {
    // A deploy that made every About page in a sector 500 is worse than one
    // that dropped a paragraph until somebody noticed.
    const blocks = readBlocks([
      { id: "a", kind: "text", values: { body: "kept" } },
      { id: "b", kind: "something_we_deleted", values: {} },
      { id: "c", kind: "cta", values: {} },
    ]);
    expect(blocks.map((entry) => entry.id)).toEqual(["a", "c"]);
  });

  it("takes anything that is not an array as no blocks", () => {
    for (const value of [null, undefined, {}, "blocks", 3]) {
      expect(readBlocks(value)).toEqual([]);
    }
  });

  it("reads prose out of every field a reader sees", () => {
    const prose = proseOf([
      block("heading", { text: "About us" }),
      block("text", { body: "We stock valves." }),
      block("cta", { label: "See the catalogue" }),
    ]);
    expect(prose).toContain("About us");
    expect(prose).toContain("We stock valves.");
    expect(prose).toContain("See the catalogue");
  });
});
