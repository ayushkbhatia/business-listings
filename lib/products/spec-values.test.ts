import { describe, expect, it } from "vitest";
import { mergeSpecValues } from "./spec-values";

/**
 * The guarantee board 3h's rename warning has been making since it shipped:
 * "the products already using it keep their values".
 *
 * It was false. These are the cases that made it false, and the one that made
 * it look fine in a screenshot.
 */

const known = new Set(["a", "b", "c"]);

describe("merging spec values", () => {
  it("keeps a value whose field the form never showed", () => {
    /*
       The whole bug in one assertion. `b` was hidden, so no input was rendered
       and nothing was posted for it — and the old code read that as "cleared".
    */
    expect(
      mergeSpecValues({
        stored: { a: "DN50", b: "Cast iron" },
        presented: ["a"],
        posted: { a: "DN50" },
        known,
      }),
    ).toEqual({ a: "DN50", b: "Cast iron" });
  });

  it("clears a value the form showed and the seller emptied", () => {
    // The other half. A field on screen is the seller's to clear, and a merge
    // that never deleted would make emptying a box impossible.
    expect(
      mergeSpecValues({
        stored: { a: "DN50", b: "Cast iron" },
        presented: ["a", "b"],
        posted: { a: "DN50", b: "" },
        known,
      }),
    ).toEqual({ a: "DN50" });
  });

  it("treats whitespace as empty, so a space bar does not store a value", () => {
    expect(
      mergeSpecValues({ stored: { a: "DN50" }, presented: ["a"], posted: { a: "   " }, known }),
    ).toEqual({});
  });

  it("ignores a posted field the template does not carry", () => {
    // A form is a suggestion. An id off another template would otherwise become
    // a key nothing can render and nothing can clear.
    expect(
      mergeSpecValues({
        stored: { a: "DN50" },
        presented: ["a", "z"],
        posted: { a: "DN50", z: "smuggled" },
        known,
      }),
    ).toEqual({ a: "DN50" });
  });

  it("keeps an orphan value the template no longer carries", () => {
    /*
       A field removed from a live platform template leaves values behind.
       Nothing prunes them and this must not become the thing that does: a
       removal that silently emptied every product's stored value is the
       retroactive destruction board 3h §5 exists to prevent, and the field may
       come back.
    */
    expect(
      mergeSpecValues({
        stored: { a: "DN50", gone: "Brass" },
        presented: ["a"],
        posted: { a: "DN50" },
        known,
      }),
    ).toEqual({ a: "DN50", gone: "Brass" });
  });

  it("changes nothing when the form showed nothing", () => {
    // A save from a screen with no spec section at all — the catalogue's
    // inline editor, a status flip — must not touch the specs.
    expect(
      mergeSpecValues({ stored: { a: "DN50", b: "Cast iron" }, presented: [], posted: {}, known }),
    ).toEqual({ a: "DN50", b: "Cast iron" });
  });

  it("does not mutate what it was given", () => {
    const stored = { a: "DN50" };
    mergeSpecValues({ stored, presented: ["a"], posted: { a: "" }, known });
    expect(stored).toEqual({ a: "DN50" });
  });
});
