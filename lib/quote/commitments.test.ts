import { describe, expect, it } from "vitest";
import { extractCommitments, isCommitment, MAX_COMMITMENTS, sentencesOf } from "./commitments";

/**
 * Board `7c` `B4`: what the supplier committed to, from their own words.
 *
 * Each shape the matcher accepts has an example here, and each near-miss that
 * would put a sentence on a record that is not a commitment has one too — a
 * price that looks like a date, a pipe size that looks like a fraction of a
 * month, a question.
 */

describe("isCommitment", () => {
  it.each([
    "One drop, 40 valves and 120 couplings, on 4 Sep.",
    "Ready by 18th September.",
    "Delivery September 4.",
    "We can deliver 04/09 in the morning.",
    "Collection from JAFZA on Thursday.",
    "Gaskets to follow within 2 days of the drop.",
    "Lead time 2-3 weeks from order confirmation.",
    "Allow 7 working days for the certificate.",
    "Everything is ex-stock.",
    "Same day dispatch from Al Quoz.",
    "The balance comes next week.",
    "Datasheets by email today.",
    "Installed by end of the month.",
    "Confirmed for 4.9.2026.",
  ])("selects %s", (sentence) => {
    expect(isCommitment(sentence)).toBe(true);
  });

  it.each([
    // A price with two decimal places is not 4 September.
    "Unit price is 46.00 each.",
    // A fitting size is not a date.
    "The 3/4 inch valves are brass.",
    "Supplied with 1/2\" BSP ends.",
    // Asking is not committing.
    "Can you take delivery on Thursday?",
    // No time in it at all.
    "Thank you for the order reference.",
    "Revision 2 is on the enquiry.",
    // Weekday abbreviations that are also words.
    "The coating is rated for sun and salt spray.",
  ])("leaves out %s", (sentence) => {
    expect(isCommitment(sentence)).toBe(false);
  });
});

describe("sentencesOf", () => {
  it("splits on sentence ends and line breaks, and keeps decimals whole", () => {
    expect(sentencesOf("Valves at 191.00 each. Couplings on 4 Sep!\n- Gaskets within 2 days")).toEqual([
      "Valves at 191.00 each.",
      "Couplings on 4 Sep!",
      "- Gaskets within 2 days",
    ]);
  });
});

describe("extractCommitments", () => {
  const at = (day: number) => new Date(`2026-09-${String(day).padStart(2, "0")}T08:00:00Z`);

  it("keeps the supplier's words verbatim and dates them to when they were said", () => {
    const found = extractCommitments([
      { id: "m1", body: "Thanks.   One drop,  40 valves, on 4 Sep.", createdAt: at(1) },
    ]);
    expect(found).toEqual([{ messageId: "m1", text: "One drop, 40 valves, on 4 Sep.", saidAt: at(1) }]);
  });

  it("orders by when it was said, whatever order the messages arrive in", () => {
    const found = extractCommitments([
      { id: "late", body: "Gaskets within 2 days.", createdAt: at(5) },
      { id: "early", body: "Valves ex-stock.", createdAt: at(2) },
    ]);
    expect(found.map((c) => c.messageId)).toEqual(["early", "late"]);
  });

  it("dates a repeated statement to the first time it was made", () => {
    const found = extractCommitments([
      { id: "a", body: "Delivery on Thursday.", createdAt: at(1) },
      { id: "b", body: "delivery on thursday.", createdAt: at(3) },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]!.messageId).toBe("a");
  });

  it("keeps the most recent when there are more than the rail holds", () => {
    const messages = Array.from({ length: MAX_COMMITMENTS + 3 }, (_, i) => ({
      id: `m${i}`,
      body: `Batch ${i} ready in ${i + 1} days.`,
      createdAt: at(i + 1),
    }));
    const found = extractCommitments(messages);
    expect(found).toHaveLength(MAX_COMMITMENTS);
    expect(found.at(-1)!.messageId).toBe(`m${MAX_COMMITMENTS + 2}`);
    expect(found[0]!.messageId).toBe("m3");
  });

  it("cuts a very long sentence rather than letting it take the rail", () => {
    const long = `Delivery on 4 Sep ${"with every fitting individually tagged ".repeat(12)}`.trim();
    const [found] = extractCommitments([{ id: "m", body: long, createdAt: at(1) }]);
    expect(found!.text.length).toBeLessThanOrEqual(200);
    expect(found!.text.endsWith("…")).toBe(true);
  });

  it("returns nothing when nothing carries a time — the rail's empty state", () => {
    expect(extractCommitments([{ id: "m", body: "Thank you. Revision 2 is on the enquiry.", createdAt: at(1) }])).toEqual([]);
  });
});
