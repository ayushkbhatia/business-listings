import { describe, expect, it } from "vitest";
import {
  filledLines,
  hasLine,
  sendBlockedBy,
  stepOf,
  type RfqLine,
  type RfqState,
} from "@/app/(public)/rfq/rfq-state";

/**
 * Board 1h's step model, which is the thing most likely to be built wrong.
 *
 * The composer model rejects a stored step three separate ways. These pin the
 * consequence: a step is derived, so it cannot disagree with the form, and a
 * buyer who edits a line at step 3 stays at step 3.
 */

const line = (over: Partial<RfqLine> = {}): RfqLine => ({
  key: "l1",
  description: "Grooved gasket, EPDM, 4 inch",
  qty: 10,
  targetUnitPriceAed: "",
  productId: null,
  sku: null,
  sellerName: null,
  ...over,
});

const state = (over: Partial<RfqState> = {}): RfqState => ({
  lines: [line()],
  emirate: "dubai",
  area: "",
  picked: ["b1"],
  ...over,
});

const LABELS = { noLines: "no lines", noArea: "no area", noRecipients: "no recipients" };

describe("the step is read from the form, never stored", () => {
  it("is step 1 with no line, whatever else is filled", () => {
    /*
       Cold arrival. The table has a blank row and the cursor in it; the
       requirement fields render dimmed so the buyer can see what is coming
       without filling it out of order.
    */
    expect(stepOf(state({ lines: [line({ description: "" })] }))).toBe(1);
    expect(stepOf(state({ lines: [] }))).toBe(1);
    // A space bar is not an item.
    expect(stepOf(state({ lines: [line({ description: "   " })] }))).toBe(1);
  });

  it("reaches step 2 the moment one line exists, typed or seeded", () => {
    expect(stepOf(state({ emirate: "", picked: [] }))).toBe(2);
  });

  it("reaches step 3 on a delivery area and at least one recipient", () => {
    expect(stepOf(state())).toBe(3);
    expect(stepOf(state({ picked: [] }))).toBe(2);
    expect(stepOf(state({ emirate: "" }))).toBe(2);
  });

  it("does not drag a buyer backwards when they edit a line at step 3", () => {
    /*
       "Steps never gate backwards." With a stored step, correcting a quantity
       after picking recipients would have moved the page back to step 2 and
       made the buyer walk forward again through work they had already done.
    */
    const at3 = state();
    expect(stepOf(at3)).toBe(3);
    const edited = { ...at3, lines: [line({ qty: 40, description: "EPDM gasket, 6 inch" })] };
    expect(stepOf(edited)).toBe(3);
  });
});

describe("what would actually be sent", () => {
  it("drops the blank rows the table keeps for typing into", () => {
    const lines = [line(), line({ key: "l2", description: "  " }), line({ key: "l3", description: "Butterfly valve DN100" })];
    expect(filledLines(lines).map((l) => l.key)).toEqual(["l1", "l3"]);
    expect(hasLine([line({ description: "" })])).toBe(false);
  });
});

describe("Send always says why it is off", () => {
  it("names the first thing missing, in order", () => {
    // Never a silent dead button: a disabled control with no reason is a puzzle
    // the buyer solves by leaving.
    expect(sendBlockedBy(state({ lines: [line({ description: "" })] }), LABELS)).toBe("no lines");
    expect(sendBlockedBy(state({ emirate: "" }), LABELS)).toBe("no area");
    expect(sendBlockedBy(state({ picked: [] }), LABELS)).toBe("no recipients");
    expect(sendBlockedBy(state(), LABELS)).toBeNull();
  });
});
