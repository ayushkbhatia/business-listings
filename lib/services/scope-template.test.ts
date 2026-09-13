import { describe, expect, it } from "vitest";
import {
  BLANK_FIELDS,
  CLONE_FILLS,
  CLONE_MISSING,
  TRAVELLING_FIELDS,
  cloneValues,
  isTravellingField,
  offersFor,
  templateFilled,
  travellingOnly,
} from "./scope-template";
import { REQUIRED_COUNT, REQUIRED_FIELDS } from "./scope-sheet";
import { COUNTING_BAR } from "./setup-sheet";

describe("five travel and four do not — criterion 1", () => {
  it("carries the four required fields plus the accreditation row", () => {
    expect(TRAVELLING_FIELDS).toEqual([
      "engagementType",
      "feeBasis",
      "deliveredWhere",
      "deliverable",
      "regulator",
    ]);
  });

  it("never carries name, scope, excluded or turnaround", () => {
    for (const blank of BLANK_FIELDS) {
      expect(isTravellingField(blank)).toBe(false);
    }
  });

  it("keeps the two lists disjoint, so a field cannot be in both", () => {
    const both = TRAVELLING_FIELDS.filter((field) =>
      (BLANK_FIELDS as readonly string[]).includes(field),
    );
    expect(both).toEqual([]);
  });
});

describe("the arithmetic — §The arithmetic, criterion 5", () => {
  it("fills four of the six required fields", () => {
    expect(CLONE_FILLS).toBe(4);
    expect(REQUIRED_COUNT).toBe(6);
  });

  it("lands a clone exactly on `8c-s`'s counting bar", () => {
    /*
       This is what makes the template worth having rather than merely tidy: a
       cloned service counts toward the seller's three the moment it is named.
       If either number moves, this fails rather than the relationship quietly
       ceasing to hold.
    */
    expect(CLONE_FILLS).toBe(COUNTING_BAR);
  });

  it("leaves the name and the turnaround, and nothing else", () => {
    expect(CLONE_MISSING).toEqual(["name", "turnaround"]);
    expect(CLONE_MISSING).toHaveLength(REQUIRED_COUNT - CLONE_FILLS);
  });

  it("derives the arithmetic from the field lists rather than restating it", () => {
    // Every travelling field that is required is one a clone arrives with.
    const fromLists = REQUIRED_FIELDS.filter((field) =>
      (TRAVELLING_FIELDS as readonly string[]).includes(field),
    ).length;
    expect(fromLists).toBe(CLONE_FILLS);
  });
});

describe("a template holds only what travels — B3", () => {
  it("drops scope and excluded however they arrive", () => {
    const values = travellingOnly({
      engagementType: "call_off",
      scope: "Everything",
      excluded: "Nothing",
      name: "Hull survey",
      turnaround: "3 days",
    });
    expect(values).toEqual({ engagementType: "call_off" });
  });

  it("drops a blank rather than storing an offer to un-answer a question", () => {
    expect(travellingOnly({ deliveredWhere: "   ", deliverable: "A report" })).toEqual({
      deliverable: "A report",
    });
  });

  it("ignores a key that is not a string", () => {
    expect(travellingOnly({ feeBasis: 12 as unknown as string })).toEqual({});
  });

  it("counts what a template has answered", () => {
    expect(templateFilled({})).toBe(0);
    expect(templateFilled({ engagementType: "call_off", regulator: "IACS" })).toBe(2);
    expect(templateFilled({ engagementType: "  " })).toBe(0);
  });

  it("clones exactly what it holds and nothing more", () => {
    const template = { engagementType: "call_off", deliverable: "Signed certificate" };
    expect(cloneValues(template)).toEqual(template);
    expect(Object.keys(cloneValues({ ...template, scope: "x" } as never))).toEqual(
      Object.keys(template),
    );
  });
});

describe("offers are derived, and a decline is not — B4, AC3, AC4", () => {
  const template = {
    engagementType: "call_off",
    feeBasis: "per_certificate",
    deliverable: "Signed certificate + photographic report",
  };

  it("offers only what differs", () => {
    const offers = offersFor(template, {
      engagementType: "call_off",
      feeBasis: "per_day",
      deliverable: null,
    });
    expect(offers.map((offer) => offer.field)).toEqual(["feeBasis", "deliverable"]);
    expect(offers[0]).toEqual({
      field: "feeBasis",
      before: "per_day",
      after: "per_certificate",
    });
    expect(offers[1]!.before).toBeNull();
  });

  it("offers nothing when the service already agrees", () => {
    expect(offersFor(template, template)).toEqual([]);
  });

  it("never offers a field the template has not answered", () => {
    // A template silent on delivered-where says nothing about it, which is not
    // the same as saying it should be empty.
    expect(offersFor({}, { deliveredWhere: "remote" })).toEqual([]);
  });

  it("stops offering what was declined, at that value", () => {
    const declined = { feeBasis: "per_certificate" } as const;
    const offers = offersFor(template, { feeBasis: "per_day" }, declined);
    expect(offers.map((offer) => offer.field)).not.toContain("feeBasis");
  });

  it("offers again when the template moves to a different value", () => {
    /*
       The decline stores the refused value rather than a flag, so "no" means no
       to *that*, not to the field for ever. Declining "Per certificate" says
       nothing about "Per day".
    */
    const declined = { feeBasis: "per_certificate" } as const;
    const moved = { ...template, feeBasis: "per_visit" };
    const offers = offersFor(moved, { feeBasis: "per_day" }, declined);
    expect(offers.map((offer) => offer.field)).toContain("feeBasis");
  });

  it("treats whitespace on either side as agreement", () => {
    expect(offersFor({ deliverable: "A report" }, { deliverable: "  A report  " })).toEqual([]);
  });
});
