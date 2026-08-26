import { describe, expect, it } from "vitest";
import {
  productIsComplete,
  requiredNow,
  specCompleteness,
  wouldBeIncomplete,
  type ProductSpecs,
  type SpecFieldRule,
} from "./spec-completeness";

/**
 * The pure half of criterion 4, and of the ranking signal that has been random
 * since handoff 0.
 */

const NOW = new Date("2026-08-26T10:00:00Z");

/*
 * The id is what `Product.specValues` is keyed by. These fixtures use the same
 * string for both so the tests stay readable, and one test below proves the
 * lookup really is by id.
 */
const rule = (key: string, over: Partial<SpecFieldRule> = {}): SpecFieldRule => ({
  id: key,
  key,
  required: true,
  isFilterable: true,
  requiredFrom: null,
  ...over,
});

const TEMPLATE = "tpl_valves";
const rules = (...fields: SpecFieldRule[]) => new Map([[TEMPLATE, fields]]);
const product = (values: Record<string, unknown> | null): ProductSpecs => ({
  templateId: TEMPLATE,
  values,
});

describe("what a template requires now", () => {
  it("counts only the required, filterable fields", () => {
    const fields = [
      rule("bore"),
      rule("material", { required: false }),
      rule("note", { isFilterable: false }),
    ];
    expect(requiredNow(fields, NOW).map((f) => f.key)).toEqual(["bore"]);
  });

  it("does not require a field whose grace period has not expired", () => {
    const later = new Date("2026-10-01T00:00:00Z");
    const fields = [rule("bore"), rule("pressure", { requiredFrom: later })];
    expect(requiredNow(fields, NOW).map((f) => f.key)).toEqual(["bore"]);
  });

  it("requires it once the deadline has passed", () => {
    const earlier = new Date("2026-08-01T00:00:00Z");
    const fields = [rule("bore"), rule("pressure", { requiredFrom: earlier })];
    expect(requiredNow(fields, NOW).map((f) => f.key)).toEqual(["bore", "pressure"]);
  });
});

describe("whether one product is complete", () => {
  it("is complete when every required field has a value", () => {
    expect(
      productIsComplete(product({ bore: "DN100", material: "SS316" }), [rule("bore")], NOW),
    ).toBe(true);
  });

  it("is incomplete when one is missing", () => {
    expect(
      productIsComplete(product({ bore: "DN100" }), [rule("bore"), rule("pressure")], NOW),
    ).toBe(false);
  });

  it("treats an empty string and an empty list as not filled in", () => {
    expect(productIsComplete(product({ bore: "  " }), [rule("bore")], NOW)).toBe(false);
    expect(productIsComplete(product({ bore: [] }), [rule("bore")], NOW)).toBe(false);
  });

  it("treats false and zero as filled in, because they are answers", () => {
    expect(productIsComplete(product({ flanged: false }), [rule("flanged")], NOW)).toBe(true);
    expect(productIsComplete(product({ bore: 0 }), [rule("bore")], NOW)).toBe(true);
  });

  it("looks the value up by field id, not by key", () => {
    // Every writer in the product stores values under the field's id. Reading
    // by key finds nothing and scores every product incomplete.
    const field: SpecFieldRule = {
      id: "fld_abc123",
      key: "bore",
      required: true,
      isFilterable: true,
      requiredFrom: null,
    };
    expect(productIsComplete(product({ fld_abc123: "DN100" }), [field], NOW)).toBe(true);
    expect(productIsComplete(product({ bore: "DN100" }), [field], NOW)).toBe(false);
  });

  it("is complete against a template that requires nothing", () => {
    // A statement about the template, not the product. Inventing a failure here
    // would punish a seller for our own gap.
    expect(productIsComplete(product(null), [], NOW)).toBe(true);
    expect(productIsComplete(product(null), [rule("bore", { required: false })], NOW)).toBe(true);
  });

  it("is complete while a new field is still inside its grace period", () => {
    const fields = [rule("bore"), rule("pressure", { requiredFrom: new Date("2026-10-01") })];
    expect(productIsComplete(product({ bore: "DN100" }), fields, NOW)).toBe(true);
  });
});

describe("the share across a catalogue", () => {
  it("is null with no products, never zero", () => {
    // Zero means they filled nothing in. Null means there is nothing to fill.
    expect(specCompleteness([], rules(rule("bore")), NOW)).toBeNull();
  });

  it("is the share complete, to two places", () => {
    const catalogue = [
      product({ bore: "DN100" }),
      product({ bore: "DN80" }),
      product({}),
      product(null),
    ];
    expect(specCompleteness(catalogue, rules(rule("bore")), NOW)).toBe(0.5);
  });

  it("counts a product whose category has no template as complete", () => {
    const orphan: ProductSpecs = { templateId: null, values: null };
    expect(specCompleteness([orphan], rules(rule("bore")), NOW)).toBe(1);
  });
});

describe("what a new required field would cost", () => {
  const catalogue = [
    product({ bore: "DN100", pressure: "PN16" }),
    product({ bore: "DN80" }),
    product({ bore: "DN50" }),
    product({}), // already incomplete
  ];

  it("counts the products that would become incomplete", () => {
    const affected = wouldBeIncomplete(
      catalogue,
      rules(rule("bore")),
      { templateId: TEMPLATE, field: rule("pressure") },
      NOW,
    );
    // Two have a bore and no pressure. The first has both; the fourth is
    // already incomplete and adding a field does not make it more so.
    expect(affected).toBe(2);
  });

  it("does not count a product that is already incomplete", () => {
    const affected = wouldBeIncomplete(
      [product({})],
      rules(rule("bore")),
      { templateId: TEMPLATE, field: rule("pressure") },
      NOW,
    );
    expect(affected).toBe(0);
  });

  it("ignores products on another template", () => {
    const other: ProductSpecs = { templateId: "tpl_cable", values: { bore: "DN100" } };
    const affected = wouldBeIncomplete(
      [other],
      rules(rule("bore")),
      { templateId: TEMPLATE, field: rule("pressure") },
      NOW,
    );
    expect(affected).toBe(0);
  });

  it("counts nothing when every product already carries the new field", () => {
    const affected = wouldBeIncomplete(
      [product({ bore: "DN100", pressure: "PN16" })],
      rules(rule("bore")),
      { templateId: TEMPLATE, field: rule("pressure") },
      NOW,
    );
    expect(affected).toBe(0);
  });
});
