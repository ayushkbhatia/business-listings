import { describe, expect, it } from "vitest";
import { mentions, MIN_THEME_REVIEWS, themesIn, words } from "./themes";

/**
 * Board 11c `B3` — the claim the board made and the product could not back.
 *
 * *"Two reviews mention brand substitution"* was a sentence about review text
 * over a product that did no text analysis, and the note says it does not get
 * softened into a hedge. So the thing to prove here is not that the matcher
 * fires: it is that it **does not fire on praise**, which is the failure that
 * would make the panel worse than not having one.
 */

const substitution =
  "Good stock depth and the trade counter is quick. One line was substituted with an " +
  "equivalent brand without asking us first — flagged it and they credited the difference.";

describe("reading a review into words", () => {
  it("drops punctuation and case", () => {
    expect(words("Quick, correct — fair price.")).toEqual([
      "quick",
      "correct",
      "fair",
      "price",
    ]);
  });

  it("collapses an apostrophe rather than splitting on it", () => {
    // "didn t" would put a bare `t` between a negation and the word it negates,
    // which is the one thing the negation check cannot survive.
    expect(words("They didn't chase")).toEqual(["they", "didnt", "chase"]);
  });
});

describe("a phrase is only a mention when it is a complaint", () => {
  it("matches a stem", () => {
    expect(mentions("the item was substituted", "substitut*")).toBe(true);
    expect(mentions("they offered a substitution", "substitut*")).toBe(true);
  });

  it("matches a phrase across words", () => {
    expect(mentions("the DN80 was out of stock", "out of stock")).toBe(true);
  });

  it("does not match a phrase split across a gap", () => {
    expect(mentions("out of the stock we needed", "out of stock")).toBe(false);
  });

  it("refuses a negated match", () => {
    // Praise that reads like a complaint to a substring search. Each of these
    // would have put a process-fix sentence on a rail under a five-star review.
    expect(mentions("nothing was damaged", "damaged")).toBe(false);
    expect(mentions("no delay at all", "delay*")).toBe(false);
    expect(mentions("never had to chase", "had to chase")).toBe(false);
  });

  it("still matches the same phrase elsewhere in the same review", () => {
    expect(mentions("nothing was damaged. the second pallet arrived damaged", "damaged")).toBe(
      true,
    );
  });

  it("does not match a stem inside another word", () => {
    // `\b`-equivalent, because the matcher works on whole words: "undamaged"
    // is not "damaged".
    expect(mentions("arrived undamaged", "damaged")).toBe(false);
  });
});

describe("themes across a set of reviews", () => {
  it("finds nothing under the floor", () => {
    // The board's own bar is two. One review mentioning something is one
    // person's account, and a rail telling a supplier to change a process on
    // that is the padding rule wearing a diagnosis.
    expect(themesIn([{ id: "a", body: substitution }])).toEqual([]);
    expect(MIN_THEME_REVIEWS).toBe(2);
  });

  it("finds the board's own example at two", () => {
    const found = themesIn([
      { id: "a", body: substitution },
      { id: "b", body: "They swapped the brand on two lines without telling us." },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]!.key).toBe("brand_substitution");
    expect(found[0]!.count).toBe(2);
    expect(found[0]!.dimension).toBe("asDescribed");
    expect(found[0]!.reviewIds).toEqual(["a", "b"]);
  });

  it("counts a review once however many phrases it uses", () => {
    // One person's account of one incident. Counting it twice is exactly how a
    // panel comes to claim more agreement than it has.
    const found = themesIn([
      { id: "a", body: "substituted for a different brand, an equivalent brand at that" },
      { id: "b", body: "they swapped the brand" },
    ]);
    expect(found[0]!.count).toBe(2);
  });

  it("finds nothing in a page of praise", () => {
    const praise = [
      { id: "a", body: "Priced below the two quotes I had on paper and delivered the same afternoon." },
      { id: "b", body: "In stock, correct brand, certificates in the box. No delay, nothing damaged." },
      { id: "c", body: "Answered within the hour every time. Never had to chase them." },
    ];
    expect(themesIn(praise)).toEqual([]);
  });

  it("sorts by agreement, then by the vocabulary's own order", () => {
    const found = themesIn([
      { id: "a", body: "delivered late and the pallet was damaged" },
      { id: "b", body: "arrived late again" },
      { id: "c", body: "one crate was dented" },
    ]);
    expect(found.map((theme) => theme.key)).toEqual(["late_delivery", "damaged_on_arrival"]);
    expect(found[0]!.count).toBe(2);
  });

  it("caps the rail rather than filling it", () => {
    const body =
      "delivered late, out of stock, substituted, wrong size, no certificate, damaged, " +
      "no reply, charged more, short delivered";
    expect(themesIn([{ id: "a", body }, { id: "b", body }]).length).toBeLessThanOrEqual(3);
  });
});
