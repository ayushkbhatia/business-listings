import { describe, expect, it } from "vitest";
import type { LandingFacts } from "./facts";
import { faqJsonLd, landingFaq, MIN_REPLY_SAMPLE } from "./faq";

/**
 * Criterion 3 — "FAQ answers derive from platform data and update as the data
 * does."
 *
 * Which is as much a rule about what may not be written. Most of what is
 * asserted below is that a question whose number is missing does not appear at
 * all: an omitted question is honest, and a question answered with a hedge is
 * the spun text this handoff exists to keep off the site.
 */

const FULL: LandingFacts = {
  listings: 218,
  verified: 96,
  emirates: [
    { emirate: "dubai", listings: 141 },
    { emirate: "sharjah", listings: 44 },
    { emirate: "abu_dhabi", listings: 22 },
    { emirate: "ajman", listings: 11 },
  ],
  replyMedianMs: 4 * 3_600_000,
  replyMeasurable: 90,
  products: 1_204,
  availability: [
    { availability: "in_stock", products: 700 },
    { availability: "made_to_order", products: 400 },
    { availability: "indent", products: 104 },
  ],
};

const EMPTY: LandingFacts = {
  listings: 0,
  verified: 0,
  emirates: [],
  replyMedianMs: null,
  replyMeasurable: 0,
  products: 0,
  availability: [],
};

const scope = { subject: "Valves and fittings" };

describe("landingFaq", () => {
  it("says the number in every answer it writes", () => {
    const items = landingFaq(scope, FULL);
    const howMany = items.find((item) => item.id === "how-many");
    expect(howMany?.answer).toContain("218");
    expect(howMany?.answer).toContain("96");
  });

  it("names the biggest emirates with their counts, and totals the rest", () => {
    const answer = landingFaq(scope, FULL).find((item) => item.id === "where")?.answer ?? "";
    expect(answer).toContain("Dubai (141)");
    expect(answer).toContain("Sharjah (44)");
    // Four emirates, three named — the fourth is counted, not listed.
    expect(answer).toContain("1 other");
    expect(answer).not.toContain("Ajman");
  });

  it("lists every emirate when they all fit", () => {
    const answer =
      landingFaq(scope, { ...FULL, emirates: FULL.emirates.slice(0, 2) }).find(
        (item) => item.id === "where",
      )?.answer ?? "";
    expect(answer).toContain("Dubai (141)");
    expect(answer).toContain("Sharjah (44)");
    expect(answer).not.toContain("other");
  });

  it("gives the reply median with the sample it came from", () => {
    const answer = landingFaq(scope, FULL).find((item) => item.id === "reply-time")?.answer ?? "";
    expect(answer).toContain("4 h");
    expect(answer).toContain("90");
  });

  it("does not ask about reply time when too few listings can be measured", () => {
    /*
       "4 h" from three suppliers and "4 h" from ninety are different facts.
       Below the sample floor the honest move is not a hedge — it is silence.
    */
    const thin = { ...FULL, replyMeasurable: MIN_REPLY_SAMPLE - 1 };
    expect(landingFaq(scope, thin).map((item) => item.id)).not.toContain("reply-time");
  });

  it("does not ask about reply time when nothing is measurable at all", () => {
    const unmeasured = { ...FULL, replyMedianMs: null, replyMeasurable: 0 };
    expect(landingFaq(scope, unmeasured).map((item) => item.id)).not.toContain("reply-time");
  });

  it("does not ask about availability when nothing is listed", () => {
    const noProducts = { ...FULL, products: 0, availability: [] };
    expect(landingFaq(scope, noProducts).map((item) => item.id)).not.toContain("availability");
  });

  it("writes nothing at all for a trade with no listings", () => {
    // Not even the price answer: a page with nothing on it has no FAQ, and an
    // FAQPage block with one policy question is markup pretending to be a page.
    expect(landingFaq(scope, EMPTY)).toEqual([]);
  });

  it("always answers the price question where there is anything to answer for", () => {
    const price = landingFaq(scope, FULL).find((item) => item.id === "price");
    expect(price?.answer).toContain("never take a cut");
  });

  it("moves when the data moves", () => {
    const before = landingFaq(scope, FULL).find((item) => item.id === "how-many")?.answer;
    const after = landingFaq(scope, { ...FULL, listings: 219, verified: 97 }).find(
      (item) => item.id === "how-many",
    )?.answer;
    expect(after).not.toBe(before);
    expect(after).toContain("219");
  });
});

describe("faqJsonLd", () => {
  it("mirrors exactly the items the page renders", () => {
    const items = landingFaq(scope, FULL);
    const block = faqJsonLd(items) as Record<string, unknown> & {
      mainEntity: { name: string; acceptedAnswer: { text: string } }[];
    };

    expect(block["@type"]).toBe("FAQPage");
    expect(block.mainEntity).toHaveLength(items.length);
    expect(block.mainEntity.map((entry) => entry.name)).toEqual(items.map((item) => item.question));
    expect(block.mainEntity.map((entry) => entry.acceptedAnswer.text)).toEqual(
      items.map((item) => item.answer),
    );
  });

  it("is an empty block rather than a wrong one when there are no items", () => {
    const block = faqJsonLd([]) as { mainEntity: unknown[] };
    expect(block.mainEntity).toEqual([]);
  });
});
