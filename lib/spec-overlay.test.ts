import { describe, expect, it } from "vitest";
import { applyOverlay } from "./spec";

/**
 * Board 3h's labels and order, reaching a buyer.
 *
 * The guarantee under all of it: the key never moves, so comparison and the
 * facet rail — which read the platform field — cannot be affected by anything a
 * seller types.
 */

const fields = [
  { id: "f1", key: "nominal_diameter", label: "Nominal diameter", unit: "DN", type: "select", isFilterable: true },
  { id: "f2", key: "body_material", label: "Body material", unit: null, type: "select", isFilterable: true },
  { id: "f3", key: "warranty", label: "Warranty", unit: "months", type: "text", isFilterable: false },
];

describe("a seller's overlay on the public spec table", () => {
  it("renames a field without touching its key", () => {
    const [first] = applyOverlay(fields, { f1: { label: "Bore size" } });
    expect(first!.label).toBe("Bore size");
    // The half that makes a rename safe. `specValues` is keyed by id and
    // comparison matches on the platform field.
    expect(first!.id).toBe("f1");
    expect(first!.key).toBe("nominal_diameter");
    expect(first!.isFilterable).toBe(true);
  });

  it("reorders to the seller's own order", () => {
    const order = applyOverlay(fields, { f3: { sortOrder: -1 } }).map((f) => f.id);
    expect(order).toEqual(["f3", "f1", "f2"]);
  });

  it("leaves the platform's order where the seller set none", () => {
    expect(applyOverlay(fields, {}).map((f) => f.id)).toEqual(["f1", "f2", "f3"]);
    expect(applyOverlay(fields, null).map((f) => f.id)).toEqual(["f1", "f2", "f3"]);
  });

  it("keeps every field, because unfilled data stays visible", () => {
    // There is no overlay member that removes a row. A field a seller does not
    // stock renders "Not provided", which is the truth and is what makes the
    // completeness count mean anything.
    expect(applyOverlay(fields, { f2: { label: "Material" } })).toHaveLength(3);
  });

  it("does not mutate the fields it was given", () => {
    const before = fields.map((f) => f.label);
    applyOverlay(fields, { f1: { label: "Changed" } });
    expect(fields.map((f) => f.label)).toEqual(before);
  });
});
