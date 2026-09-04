import { describe, expect, it } from "vitest";
import {
  checkDisplayName,
  couldBeMistakenFor,
  DISPLAY_NAME_MAX,
} from "./display-name";

describe("checkDisplayName", () => {
  it("accepts the name the board draws", () => {
    expect(checkDisplayName("Gulf Cool Technical")).toEqual({
      ok: true,
      value: "Gulf Cool Technical",
    });
  });

  it("collapses whitespace rather than objecting to it", () => {
    expect(checkDisplayName("  Gulf   Cool  ")).toMatchObject({ value: "Gulf Cool" });
  });

  it("refuses every legal suffix a UAE licence ends with", () => {
    // The registry's name for the entity, not what a buyer calls them. Carrying
    // it onto a card is how a directory ends up looking like a registry export.
    for (const name of [
      "Gulf Cool Technical Services LLC",
      "Gulf Cool L.L.C.",
      "Northbay FZE",
      "Northbay F.Z.E",
      "Silver Dune FZCO",
      "Silver Dune FZ-LLC",
      "Al Bariq DMCC",
      "Al Bariq WLL",
      "Coastline Trading Co.",
      "Coastline Trading Co",
      "Al Waha Est.",
      "Meridian Sole Proprietorship",
      "Branch of Emirates Crest",
    ]) {
      expect(checkDisplayName(name), name).toMatchObject({
        ok: false,
        problem: { kind: "legal_suffix" },
      });
    }
  });

  it("does not mistake ordinary words for suffixes", () => {
    // "Est" lives inside plenty of words and "Established" is a sentence a
    // seller might reasonably write.
    for (const name of ["Westhaven Cooling", "Estuary Marine", "Bluewater Establishedish"]) {
      expect(checkDisplayName(name), name).toMatchObject({ ok: true });
    }
  });

  it("refuses a name repeating a category it already carries", () => {
    /*
       "Gulf Cool HVAC Services" under a primary category of HVAC says HVAC
       twice on one card, in the two places a buyer reads first.
    */
    expect(checkDisplayName("Gulf Cool HVAC Services", ["HVAC & refrigeration"])).toMatchObject({
      ok: false,
      problem: { kind: "repeats_category", word: "hvac" },
    });
    expect(checkDisplayName("Al Bariq Valves", ["Valves & fittings"])).toMatchObject({
      problem: { kind: "repeats_category", word: "valves" },
    });
  });

  it("ignores the joining words every category name is full of", () => {
    // "Valves & fittings" must not object to a business with "and" in it, and
    // "Industrial Supplies" must not object to the word "supplies".
    expect(checkDisplayName("Cool and Dry", ["Valves & fittings"])).toMatchObject({ ok: true });
    expect(checkDisplayName("Northbay Supplies", ["Industrial supplies"])).toMatchObject({
      ok: true,
    });
  });

  it("still catches a three-letter acronym, which is the case it is for", () => {
    expect(checkDisplayName("Gulf PPE Direct", ["Safety & PPE"])).toMatchObject({
      problem: { kind: "repeats_category", word: "ppe" },
    });
  });

  it("refuses a name too short or too long to be one", () => {
    expect(checkDisplayName("A")).toMatchObject({ problem: { kind: "too_short" } });
    expect(checkDisplayName("   ")).toMatchObject({ problem: { kind: "too_short" } });
    expect(checkDisplayName("x".repeat(DISPLAY_NAME_MAX + 1))).toMatchObject({
      problem: { kind: "too_long" },
    });
    expect(checkDisplayName("x".repeat(DISPLAY_NAME_MAX))).toMatchObject({ ok: true });
  });
});

describe("couldBeMistakenFor", () => {
  it("catches one name containing another", () => {
    // Accepted and flagged, never refused: in a market where a hundred firms
    // are called Al Something Trading this is usually a coincidence, and
    // occasionally it is somebody trying to be mistaken for a competitor.
    expect(couldBeMistakenFor("Gulf Cool Technical", "Gulf Cool")).toBe(true);
    expect(couldBeMistakenFor("Gulf Cool", "Gulf Cool Technical Services")).toBe(true);
  });

  it("ignores punctuation, case and spacing", () => {
    expect(couldBeMistakenFor("gulf-cool", "Gulf Cool")).toBe(true);
  });

  it("leaves unrelated names alone", () => {
    expect(couldBeMistakenFor("Gulf Cool Technical", "Northbay Trading")).toBe(false);
  });

  it("does not let a very short name match everything", () => {
    // Below five characters almost anything contains almost anything, and a
    // queue full of those is a queue nobody reads.
    expect(couldBeMistakenFor("Gulf", "Gulf Cool Technical")).toBe(false);
    expect(couldBeMistakenFor("Gulf", "Gulf")).toBe(true);
  });

  it("is false where either side is empty", () => {
    expect(couldBeMistakenFor("", "Gulf Cool")).toBe(false);
    expect(couldBeMistakenFor("Gulf Cool", "   ")).toBe(false);
  });
});
