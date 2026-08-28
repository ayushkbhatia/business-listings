import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS } from "@/lib/publish-threshold";
import {
  blockItems,
  blockLine,
  guideBlockSpec,
  guideProse,
  guideWords,
  GUIDE_MIN_WORDS,
  readGuideBlocks,
} from "./blocks";

describe("readGuideBlocks", () => {
  it("keeps blocks whose kind is in the vocabulary", () => {
    const blocks = readGuideBlocks([
      { id: "a", kind: "heading", values: { text: "Why" } },
      { id: "b", kind: "text", values: { body: "Because." } },
    ]);
    expect(blocks.map((block) => block.kind)).toEqual(["heading", "text"]);
  });

  it("drops a kind that has left the vocabulary rather than throwing", () => {
    /*
       The failure this prevents is a deploy, not a bad write: a block kind can
       only disappear when the vocabulary changes, and a deploy that made every
       published guide return 500 is worse than one that dropped a paragraph.
    */
    const blocks = readGuideBlocks([
      { id: "a", kind: "heading", values: { text: "Kept" } },
      { id: "b", kind: "carousel", values: {} },
      { id: "c", kind: "text", values: { body: "Also kept." } },
    ]);
    expect(blocks).toHaveLength(2);
  });

  it("drops malformed entries and non-arrays", () => {
    expect(readGuideBlocks(null)).toEqual([]);
    expect(readGuideBlocks("[]")).toEqual([]);
    expect(readGuideBlocks([null, 3, { kind: "text" }, { id: "a" }])).toEqual([]);
  });
});

describe("field readers", () => {
  it("reads a line, and the empty string for anything that is not one", () => {
    const block = { id: "a", kind: "heading" as const, values: { text: "Yes", other: 3 } };
    expect(blockLine(block, "text")).toBe("Yes");
    expect(blockLine(block, "other")).toBe("");
    expect(blockLine(block, "missing")).toBe("");
  });

  it("reads items, skipping blanks and non-strings", () => {
    const block = {
      id: "a",
      kind: "list" as const,
      values: { items: ["One", "", "   ", 4, "Two"] },
    };
    expect(blockItems(block, "items")).toEqual(["One", "Two"]);
  });
});

describe("the word count", () => {
  const blocks = readGuideBlocks([
    { id: "a", kind: "heading", values: { text: "Five rungs" } },
    { id: "b", kind: "text", values: { body: "A licence check is not a quality guarantee." } },
    { id: "c", kind: "list", values: { items: ["Filter to verified", "Read the date"] } },
    { id: "d", kind: "callout", values: { label: "Note", body: "Renewed annually." } },
  ]);

  it("counts headings and list items, not only paragraphs", () => {
    /*
       Counting paragraphs alone would let an article reach the floor on
       headings, which is visibly thin — the thing the floor exists to catch.
    */
    expect(guideProse(blocks)).toContain("Five rungs");
    expect(guideProse(blocks)).toContain("Filter to verified");
    expect(guideWords(blocks)).toBe(2 + 8 + 3 + 3 + 1 + 2);
  });

  it("is zero for an empty body", () => {
    expect(guideWords([])).toBe(0);
  });
});

describe("the publish floor", () => {
  it("is the same number a landing page intro answers to", () => {
    /*
       Not a coincidence and not a copy. Two 250s in the codebase drift the
       first time somebody changes one of them.
    */
    expect(GUIDE_MIN_WORDS).toBe(DEFAULT_THRESHOLDS.minIntroWords);
  });
});

describe("the vocabulary", () => {
  it("names every kind the renderer switches on", () => {
    for (const kind of ["heading", "text", "list", "steps", "callout", "cta"]) {
      expect(guideBlockSpec(kind), kind).toBeDefined();
    }
    expect(guideBlockSpec("certifications")).toBeUndefined();
  });
});
