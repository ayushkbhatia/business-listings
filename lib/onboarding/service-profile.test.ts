import { describe, expect, it } from "vitest";
import {
  HEADLINE_MAX,
  SECTORS_MAX,
  SECTOR_MAX_LENGTH,
  SERVICES_MAX,
  checkServiceProfile,
  dedupeSectors,
  fieldSetFor,
  sectorLabel,
  sectorSlug,
} from "./service-profile";

/**
 * Board `2c-s` — the caps and the normalisation, without a database.
 *
 * The rule that matters here is that **nothing is truncated**. A cap produces a
 * refusal naming the cap; it never quietly drops the sixth service, because the
 * seller finds that out at `8c-s` when the scope sheet is missing and has no way
 * to connect the two.
 */

describe("normalising a sector — B3", () => {
  it("matches case-insensitively and collapses whitespace", () => {
    // "Free Zone", "free  zone" and " Free zone " are one sector.
    const forms = ["Free Zone", "free  zone", " Free zone ", "FREE ZONE"];
    expect(new Set(forms.map(sectorSlug)).size).toBe(1);
  });

  it("stores what the seller typed, not the matching form", () => {
    // It is their own word for their own industry; a lower-cased slug is not it.
    expect(sectorLabel("  Free  Zone entities ")).toBe("Free Zone entities");
    expect(sectorSlug("  Free  Zone entities ")).toBe("free zone entities");
  });

  it("keeps the first spelling when a seller adds the same sector twice", () => {
    /*
       First rather than last, so a seller who picks a chip and then types the
       same thing keeps the chip's established spelling rather than their typo.
    */
    expect(dedupeSectors(["Free Zone", "free zone", "Healthcare"])).toEqual([
      "Free Zone",
      "Healthcare",
    ]);
  });

  it("drops blanks rather than storing an empty sector", () => {
    expect(dedupeSectors(["  ", "Healthcare", ""])).toEqual(["Healthcare"]);
  });
});

describe("the caps — B4", () => {
  it("accepts exactly the cap", () => {
    const five = ["Audit", "VAT", "Bookkeeping", "Payroll", "Advisory"];
    expect(five).toHaveLength(SERVICES_MAX);
    const result = checkServiceProfile({ servicesOffered: five });
    expect(result.ok).toBe(true);
  });

  it("refuses the sixth service, naming the cap, and truncates nothing", () => {
    /*
       The defect this guards against is the silent one. A form that accepts six
       and stores five is a form that lies, and the seller discovers it at 8c-s
       with no way to connect the missing scope sheet to this screen.
    */
    const six = ["Audit", "VAT", "Bookkeeping", "Payroll", "Advisory", "Liquidation"];
    const result = checkServiceProfile({ servicesOffered: six });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.refusals).toContainEqual({
      field: "servicesOffered",
      reason: "too_many",
      max: SERVICES_MAX,
    });
  });

  it("counts services after deduplication, so a repeat is not a sixth", () => {
    const withRepeat = ["Audit", "audit", "VAT", "Bookkeeping", "Payroll", "Advisory"];
    expect(checkServiceProfile({ servicesOffered: withRepeat }).ok).toBe(true);
  });

  it("refuses a one-liner over ninety characters rather than cutting it", () => {
    const long = "x".repeat(HEADLINE_MAX + 1);
    const result = checkServiceProfile({ headline: long });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.refusals[0]).toEqual({ field: "headline", reason: "too_long", max: HEADLINE_MAX });
  });

  it("accepts exactly ninety", () => {
    expect(checkServiceProfile({ headline: "x".repeat(HEADLINE_MAX) }).ok).toBe(true);
  });

  it("caps the sector list, which the board does not and an array on a hot row needs", () => {
    // Free entry on an unbounded array that every search result reads. A seller
    // pasting two hundred sectors is a Friday afternoon, not an attack.
    const many = Array.from({ length: SECTORS_MAX + 1 }, (_, i) => `Sector ${i}`);
    const result = checkServiceProfile({ sectorsServed: many });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.refusals).toContainEqual({
      field: "sectorsServed",
      reason: "too_many",
      max: SECTORS_MAX,
    });
  });

  it("refuses a sector that is a sentence", () => {
    const result = checkServiceProfile({
      sectorsServed: ["x".repeat(SECTOR_MAX_LENGTH + 1)],
    });
    expect(result.ok).toBe(false);
  });

  it("returns every refusal, not the first", () => {
    // A seller over on two fields is told both times rather than discovering
    // the second after fixing the first.
    const result = checkServiceProfile({
      headline: "x".repeat(HEADLINE_MAX + 1),
      servicesOffered: Array.from({ length: SERVICES_MAX + 1 }, (_, i) => `S${i}`),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.refusals).toHaveLength(2);
  });

  it("stores an empty one-liner as null rather than an empty string", () => {
    const result = checkServiceProfile({ headline: "   " });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.headline).toBeNull();
  });
});

describe("which field set a seller sees — B1", () => {
  it("gives a services seller the services set and not the goods one", () => {
    expect(fieldSetFor("services")).toEqual({ services: true, goods: false });
  });

  it("gives a goods seller what every seller saw before this board", () => {
    expect(fieldSetFor("goods")).toEqual({ services: false, goods: true });
  });

  it("gives a both seller both, because a seller who sells both fills both", () => {
    // B6: not hidden behind a toggle. Two labelled groups on one screen.
    expect(fieldSetFor("both")).toEqual({ services: true, goods: true });
  });

  it("gives an unanswered listing the goods set, which is what it had", () => {
    /*
       Only reachable on a listing that predates the fork — onboarding routes an
       unanswered seller to 2b-s first. Defaulting it to the services set would
       change what 123 published businesses render on a screen they have already
       filled in.
    */
    expect(fieldSetFor("unset")).toEqual({ services: false, goods: true });
  });
});
