import { describe, expect, it } from "vitest";
import {
  badgesFor,
  canDelete,
  liveSurfaceOf,
  needsAlt,
  stateOf,
  type Reference,
} from "./state";

/**
 * Board 3i's rules, and the one the whole board turns on: a file with no
 * product attachment is not the same as a file nobody is using.
 *
 * The test that matters most is the refusal. A file cited by a sent quote is a
 * document already delivered to a buyer, so deleting it is refused rather than
 * warned about — and the fixture that proves it has **no product attachment at
 * all**, because that is exactly the file the board offered to delete.
 */

const ref = (over: Partial<Reference> = {}): Reference => ({
  kind: "product",
  label: "AW-VLV-BF-100",
  live: true,
  ...over,
});

describe("stateOf", () => {
  it("calls a file with no references anywhere unreferenced", () => {
    expect(stateOf([]).unreferenced).toBe(true);
  });

  it("does not call a quote-held file unreferenced, though nothing links it to a product", () => {
    // The board's 41. Six of them looked identical to this and were not.
    const held = [ref({ kind: "sent_quote", label: "Q-2026-0184", live: false })];
    expect(stateOf(held).unreferenced).toBe(false);
    expect(stateOf(held).quoteHeld).toBe(true);
  });

  it("counts products, and names the ones it is primary on", () => {
    const state = stateOf([
      ref({ label: "AW-VLV-BF-100", primary: true }),
      ref({ label: "AW-VLV-BF-150" }),
      ref({ kind: "storefront", label: "Storefront cover" }),
    ]);
    expect(state.productCount).toBe(2);
    expect(state.primaryFor).toEqual(["AW-VLV-BF-100"]);
  });

  it("is live when any one reference is, and not when none is", () => {
    expect(stateOf([ref({ live: false }), ref({ live: true })]).live).toBe(true);
    expect(stateOf([ref({ live: false })]).live).toBe(false);
  });
});

describe("canDelete", () => {
  it("refuses a quote-held file and names who holds it", () => {
    const result = canDelete([
      ref({ kind: "sent_quote", label: "Q-2026-0184", live: false }),
      ref({ kind: "sent_quote", label: "Q-2026-0191", live: false }),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("quote_held");
      expect(result.holders).toEqual(["Q-2026-0184", "Q-2026-0191"]);
    }
  });

  it("refuses even when the file is also on products the seller could detach", () => {
    // Detaching from every product would leave it unattached and still held.
    const result = canDelete([ref(), ref({ kind: "sent_quote", label: "Q-1", live: false })]);
    expect(result.ok).toBe(false);
  });

  it("allows an unreferenced file, and says nothing is affected", () => {
    const result = canDelete([]);
    expect(result).toEqual({ ok: true, products: [], primaryFor: [] });
  });

  it("names every product that loses an image, and which lose their primary", () => {
    const result = canDelete([
      ref({ label: "AW-VLV-BF-100", primary: true }),
      ref({ label: "AW-VLV-BF-150" }),
      ref({ label: "AW-VLV-BF-200" }),
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.products).toEqual(["AW-VLV-BF-100", "AW-VLV-BF-150", "AW-VLV-BF-200"]);
      expect(result.primaryFor).toEqual(["AW-VLV-BF-100"]);
    }
  });
});

describe("needsAlt", () => {
  it("never counts a document, which has no alt text to be missing", () => {
    // The running screen showed three PDFs badged `NO ALT`. A null alt on a
    // document is "not applicable", not "missing".
    expect(needsAlt({ describable: false, alt: null }, [ref({ live: true })])).toBe(false);
  });

  it("ignores a file that is not on a live surface", () => {
    expect(needsAlt({ describable: true, alt: null }, [ref({ live: false })])).toBe(false);
    expect(needsAlt({ describable: true, alt: null }, [])).toBe(false);
  });

  it("counts an empty alt on a live surface", () => {
    expect(needsAlt({ describable: true, alt: null }, [ref({ live: true })])).toBe(true);
    expect(needsAlt({ describable: true, alt: "   " }, [ref({ live: true })])).toBe(true);
  });

  it("does not count a file that has alt text", () => {
    expect(needsAlt({ describable: true, alt: "Grooved butterfly valve DN100" }, [ref({ live: true })])).toBe(false);
  });
});

describe("badgesFor", () => {
  it("gives an unreferenced file with no alt no alt-badge, because nobody reads it", () => {
    expect(badgesFor({ describable: true, alt: null, references: [] })).toEqual(["unreferenced"]);
  });

  it("badges a live file missing alt, and names nothing by colour", () => {
    const badges = badgesFor({ describable: true, alt: null, references: [ref({ live: true })] });
    expect(badges).toContain("no_alt");
  });

  it("badges a quote-held file", () => {
    expect(
      badgesFor({ describable: true, alt: "x", references: [ref({ kind: "sent_quote", label: "Q-1", live: false })] }),
    ).toEqual(["quote_held"]);
  });

  it("badges primary", () => {
    expect(badgesFor({ describable: true, alt: "x", references: [ref({ primary: true })] })).toEqual(["primary"]);
  });
});

describe("liveSurfaceOf", () => {
  it("names the surface a buyer reads it on, so the badge can say where", () => {
    const surface = liveSurfaceOf([ref({ live: false }), ref({ kind: "storefront", label: "Listing profile", live: true })]);
    expect(surface?.label).toBe("Listing profile");
  });

  it("returns null when nothing is live", () => {
    expect(liveSurfaceOf([ref({ live: false })])).toBeNull();
  });
});
