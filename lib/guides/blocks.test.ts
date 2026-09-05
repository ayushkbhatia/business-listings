import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS } from "@/lib/publish-threshold";
import {
  blockItems,
  blockLine,
  directoryLinks,
  guideBlockSpec,
  guideHeadings,
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
  it("is 1,200, and deliberately not the landing-page intro floor", () => {
    /*
       It used to be `DEFAULT_THRESHOLDS.minIntroWords`, on the argument that
       one number is better than two. That was right about landing pages and
       wrong here: 250 is the floor for a *paragraph* introducing a page of
       listings, and a guide is the page.

       Board 6d, acceptance 13. The render shows structure at about 520 words
       and the spec says plainly that it "would not rank for a query this
       competitive". Two numbers because they measure two things.
    */
    expect(GUIDE_MIN_WORDS).toBe(1_200);
    expect(GUIDE_MIN_WORDS).toBeGreaterThan(DEFAULT_THRESHOLDS.minIntroWords);
  });
});

describe("the contents rail", () => {
  const heading = (id: string, text: string) => ({ id, kind: "heading" as const, values: { text } });

  it("is derived from the headings, in order", () => {
    // Acceptance 4. The board hand-wrote six entries against three headings:
    // two pointed at nothing and one pointed at a different guide.
    const blocks = [
      heading("a", "What a licence tells you"),
      { id: "p1", kind: "text" as const, values: { body: "Body." } },
      heading("b", "How to check it"),
    ];
    expect(guideHeadings(blocks)).toEqual([
      { id: "s-a", text: "What a licence tells you" },
      { id: "s-b", text: "How to check it" },
    ]);
  });

  it("anchors on the block id, not the text", () => {
    /*
       A slug of the heading would change the moment somebody rewrote it, and
       every link anyone had shared into that section would break silently.
    */
    const before = guideHeadings([heading("a", "How to check it")]);
    const after = guideHeadings([heading("a", "How to check a trade licence")]);
    expect(after[0]?.id).toBe(before[0]?.id);
  });

  it("drops a heading with no text rather than rendering an empty anchor", () => {
    expect(guideHeadings([heading("a", "   ")])).toEqual([]);
  });
});

describe("links into the directory", () => {
  it("finds them in a href field and in prose", () => {
    /*
       Acceptance 10 counts **body** links, not the closing CTA: a guide that
       keeps all its earned authority in its own footer passes much less of it
       to the area pages the guide exists to make rank.
    */
    const found = directoryLinks([
      { id: "p1", kind: "text" as const, values: { body: "See [HVAC in Al Quoz](/dubai/al-quoz/hvac)." } },
      { id: "c1", kind: "cta" as const, values: { href: "/c/valves-and-fittings" } },
      { id: "p2", kind: "text" as const, values: { body: "And [a policy](/verification-policy)." } },
    ]);
    // The policy page is not the directory: it earns the guide nothing.
    // Order is the order they appear in the article, which is what a reader
    // and a crawler both see — so the assertion reads that way too.
    expect(found).toEqual(["/dubai/al-quoz/hvac", "/c/valves-and-fittings"]);
  });

  it("counts the directory index, which is its front door", () => {
    // `/categories` is board 6c's crawlable spine. The first version of the
    // pattern required a second path segment and refused it.
    expect(
      directoryLinks([
        { id: "p1", kind: "text" as const, values: { body: "The [directory](/categories)." } },
      ]),
    ).toEqual(["/categories"]);
  });

  it("finds none in an article that only links to itself", () => {
    expect(
      directoryLinks([{ id: "p1", kind: "text" as const, values: { body: "See [the index](/guides)." } }]),
    ).toEqual([]);
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
