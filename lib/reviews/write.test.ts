import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/en";
import {
  contactDetailsIn,
  DIMENSION_LABEL,
  EMPTY_REVIEW_FIELDS,
  graphemeCount,
  isReviewPhotoPath,
  parsePhotoRefs,
  REVIEW_BODY_MAX,
  REVIEW_BODY_MIN,
  reviewPhotoPath,
  reviewProblems,
  type ReviewFields,
} from "./write";
import { DIMENSIONS } from "./eligibility";

const BOARD_BODY =
  "Quote matched the final invoice to the dirham. Crew arrived a day late on the first visit but stayed until it was done, and the supervisor answers his phone.";

const filled = (over: Partial<ReviewFields> = {}): ReviewFields => ({
  ...EMPTY_REVIEW_FIELDS,
  overall: 4,
  quotedAccurate: 5,
  onTime: 3,
  asDescribed: 4,
  responsiveness: 5,
  body: BOARD_BODY,
  ...over,
});

describe("board 10f B2 — the four dimensions are 1m's", () => {
  it("names them as 1m's RATED ON card does, in its order", () => {
    expect(DIMENSIONS.map((key) => en[DIMENSION_LABEL[key]])).toEqual([
      "Quoted accurately",
      "Delivered on time",
      "Product as described",
      "Responsiveness",
    ]);
  });
});

describe("board 10f B3 — overall is an input", () => {
  it("is required, and is not the mean of the dimensions", () => {
    // The board ships overall 4 over a dimension mean of 4.25, on purpose.
    expect(reviewProblems(filled())).toEqual([]);
    expect(reviewProblems(filled({ overall: null })).map((p) => p.code)).toEqual(["overall_missing"]);
  });

  it("posts with every dimension skipped (B4)", () => {
    const skipped = filled({ quotedAccurate: null, onTime: null, asDescribed: null, responsiveness: null });
    expect(reviewProblems(skipped)).toEqual([]);
  });

  it("refuses a zero or a six anywhere", () => {
    expect(reviewProblems(filled({ onTime: 0 })).map((p) => p.code)).toEqual(["invalid_score"]);
    expect(reviewProblems(filled({ overall: 6 })).map((p) => p.code)).toEqual(["invalid_score"]);
  });
});

describe("board 10f B5 — 40 to 800 graphemes", () => {
  it("counts what a reader sees, not UTF-16 units", () => {
    expect("👍🏽".length).toBe(4);
    expect(graphemeCount("👍🏽")).toBe(1);
    // An Arabic word with diacritics: base letters with combining marks are one each.
    expect(graphemeCount("مَرْحَبًا")).toBe(5);
    // The board's body is 157 characters. Its counter read `148 / 800` — a
    // number typed rather than counted, and the render's own body disagreed.
    expect(graphemeCount(BOARD_BODY)).toBe(157);
  });

  it("holds the floor and the ceiling, trimmed", () => {
    const under = "a".repeat(REVIEW_BODY_MIN - 1);
    expect(reviewProblems(filled({ body: `   ${under}   ` })).map((p) => p.code)).toEqual(["body_short"]);
    expect(reviewProblems(filled({ body: "a".repeat(REVIEW_BODY_MIN) }))).toEqual([]);
    expect(reviewProblems(filled({ body: "a".repeat(REVIEW_BODY_MAX + 1) })).map((p) => p.code)).toEqual(["body_long"]);
    // Forty emoji are forty characters, not eighty units.
    expect(reviewProblems(filled({ body: "👍🏽".repeat(REVIEW_BODY_MIN) }))).toEqual([]);
  });
});

describe("no contact details", () => {
  it("finds a phone, an email, a website and a handle", () => {
    expect(contactDetailsIn("Call Ahmed on 050 641 2288 for the keys")).toEqual(["phone"]);
    expect(contactDetailsIn("write to ahmed@sparkle.ae")).toContain("email");
    expect(contactDetailsIn("see www.sparkle-fm.com")).toEqual(["url"]);
    expect(contactDetailsIn("they are @sparklefm on instagram")).toEqual(["handle"]);
  });

  it("leaves a PO or invoice number alone — a bare run of digits is not a phone here", () => {
    expect(contactDetailsIn("Invoice 4500012345 matched PO 7100093321 to the dirham.")).toEqual([]);
    expect(contactDetailsIn("WhatsApp +971 50 641 2288 if you need the crew")).toEqual(["phone"]);
  });

  it("leaves a company name, a price and a quantity alone", () => {
    expect(contactDetailsIn("Sparkle Facilities Services LLC quoted AED 9,600 for 3 units, DN100 × 40.")).toEqual([]);
    expect(reviewProblems(filled())).toEqual([]);
  });

  it("stops the post, and says which", () => {
    const problems = reviewProblems(filled({ body: `${BOARD_BODY} Ring 04 885 1122.` }));
    expect(problems).toEqual([{ code: "contact_details", kinds: ["phone"] }]);
  });
});

describe("photo paths", () => {
  it("sit under the supplier and the enquiry, and nowhere else is accepted", () => {
    const path = reviewPhotoPath("biz1", "enq1", "IMG 4471.JPG");
    expect(path).toMatch(/^biz1\/review\/enq1\/img-4471-[a-z0-9]{1,6}\.jpg$/);
    expect(isReviewPhotoPath("biz1", "enq1", path)).toBe(true);
    expect(isReviewPhotoPath("biz1", "enq2", path)).toBe(false);
    expect(isReviewPhotoPath("biz2", "enq1", path)).toBe(false);
    expect(isReviewPhotoPath("biz1", "enq1", "biz1/review/enq1/../../licence.pdf")).toBe(false);
    expect(isReviewPhotoPath("biz1", "enq1", "biz1/review/enq1/sub/x.jpg")).toBe(false);
  });

  it("reads a draft's JSON defensively", () => {
    expect(parsePhotoRefs("nope")).toEqual([]);
    expect(parsePhotoRefs([{ path: "a", width: 800, height: -1 }, { nope: true }, null])).toEqual([
      { path: "a", width: 800, height: null, bytes: null },
    ]);
  });
});
