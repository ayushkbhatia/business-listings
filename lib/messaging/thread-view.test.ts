import { describe, expect, it } from "vitest";
import { toThreadQuotes, type QuoteForThread } from "./thread-view";

const format = (aed: string) => `AED ${Number(aed).toLocaleString("en-AE")}`;
const labels = {
  down: (amount: string, percent: string) => `${amount} lower, ${percent}%`,
  up: (amount: string, percent: string) => `${amount} higher, ${percent}%`,
  same: "Same total",
};

const r1: QuoteForThread = {
  id: "q1",
  ref: "QT-8841-R1",
  revision: 1,
  lines: [{ qty: 24, unitPrice: "410.00" }, { qty: 8, unitPrice: "735.00" }],
};
const r2: QuoteForThread = {
  id: "q2",
  ref: "QT-8841-R2",
  revision: 2,
  lines: [{ qty: 24, unitPrice: "398.00" }, { qty: 8, unitPrice: "712.00" }],
};

describe("toThreadQuotes", () => {
  it("gives the first revision a total and nothing to compare against", () => {
    const views = toThreadQuotes([r1], format, labels);
    expect(views.get("q1")).toEqual({
      ref: "QT-8841-R1",
      revision: 1,
      totalLabel: "AED 15,720",
    });
  });

  it("strikes the previous total through and names the delta", () => {
    // 15,720 down to 15,248: 472 lower, 3%.
    const view = toThreadQuotes([r1, r2], format, labels).get("q2")!;
    expect(view.previousTotalLabel).toBe("AED 15,720");
    expect(view.totalLabel).toBe("AED 15,248");
    expect(view.direction).toBe("down");
    expect(view.deltaLabel).toBe("AED 472 lower, 3%");
  });

  it("compares against the revision before it, whatever order they arrive in", () => {
    const shuffled = toThreadQuotes([r2, r1], format, labels).get("q2")!;
    expect(shuffled.previousTotalLabel).toBe("AED 15,720");
  });

  it("says a rise is a rise", () => {
    const dearer: QuoteForThread = { ...r2, id: "q3", lines: [{ qty: 24, unitPrice: "450.00" }, { qty: 8, unitPrice: "800.00" }] };
    const view = toThreadQuotes([r1, dearer], format, labels).get("q3")!;
    expect(view.direction).toBe("up");
    expect(view.deltaLabel).toContain("higher");
  });

  it("says nothing changed when nothing changed", () => {
    const same: QuoteForThread = { ...r1, id: "q4", revision: 2 };
    expect(toThreadQuotes([r1, same], format, labels).get("q4")!.deltaLabel).toBe("Same total");
  });

  it("shows the same numbers to both sides, because it is computed once", () => {
    // The failure this prevents: a seller's screen saying six per cent and the
    // buyer's saying five.
    const buyer = toThreadQuotes([r1, r2], format, labels).get("q2");
    const seller = toThreadQuotes([r1, r2], format, labels).get("q2");
    expect(buyer).toEqual(seller);
  });
});

describe("toThreadQuotes on proposals — board 3j-s", () => {
  const fee = (p: { feeAed: string; feeBasisLabel: string }) => `AED ${Number(p.feeAed).toLocaleString("en-AE")} · ${p.feeBasisLabel}`;
  const proposal = (id: string, revision: number, feeAed: string, feeBasis: string, feeBasisLabel: string): QuoteForThread => ({
    id,
    ref: `QT-8851-EMIR${revision}`,
    revision,
    lines: [],
    proposal: { feeAed, feeBasis, feeBasisLabel },
  });

  it("labels a proposal by its fee on its basis, not by a sum of no lines", () => {
    const views = toThreadQuotes([proposal("p1", 1, "18400.00", "per_month", "Per month")], format, labels, fee);
    expect(views.get("p1")?.totalLabel).toBe("AED 18,400 · Per month");
  });

  it("names the change between two revisions on the same basis", () => {
    const views = toThreadQuotes(
      [proposal("p1", 1, "18400.00", "per_month", "Per month"), proposal("p2", 2, "17480.00", "per_month", "Per month")],
      format,
      labels,
      fee,
    );
    expect(views.get("p2")).toMatchObject({ previousTotalLabel: "AED 18,400 · Per month", direction: "down" });
  });

  it("names no change across two bases, because there is no unit to subtract in", () => {
    const views = toThreadQuotes(
      [proposal("p1", 1, "18400.00", "per_month", "Per month"), proposal("p2", 2, "210000.00", "fixed_fee", "Fixed fee")],
      format,
      labels,
      fee,
    );
    expect(views.get("p2")).toEqual({ ref: "QT-8851-EMIR2", revision: 2, totalLabel: "AED 210,000 · Fixed fee" });
  });
});
