import { describe, expect, it } from "vitest";
import {
  ENGAGEMENTS_MAX,
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

describe("checkServiceProfile — declared sector counts, board 1d-s B8", () => {
  it("leaves the stored counts alone when the form sent none", () => {
    const result = checkServiceProfile({ sectorsServed: ["Trading"] });
    expect(result.ok && result.value.sectorEngagements).toBeNull();
  });

  it("keeps counts for listed sectors, on the matching form, and drops the rest", () => {
    const result = checkServiceProfile({
      sectorsServed: ["Construction & contracting", "Free Zone entities"],
      sectorEngagements: {
        "construction & contracting": 41,
        "Free Zone entities": 19,
        hospitality: 12,
      },
    });
    expect(result.ok && result.value.sectorEngagements).toEqual([
      { sectorSlug: "construction & contracting", engagements: 41 },
      { sectorSlug: "free zone entities", engagements: 19 },
    ]);
  });

  it("reads a blank as not declared, and sends an empty set to clear", () => {
    const result = checkServiceProfile({ sectorsServed: ["Trading"], sectorEngagements: { trading: null } });
    expect(result.ok && result.value.sectorEngagements).toEqual([]);
  });

  it("refuses zero, a fraction and anything past the ceiling, naming the ceiling", () => {
    for (const bad of [0, 2.5, ENGAGEMENTS_MAX + 1]) {
      const result = checkServiceProfile({ sectorsServed: ["Trading"], sectorEngagements: { trading: bad } });
      expect(result, String(bad)).toEqual({
        ok: false,
        refusals: [{ field: "sectorEngagements", reason: "out_of_range", max: ENGAGEMENTS_MAX }],
      });
    }
  });
});

describe("board 3b-s — the fields the dashboard added to the shared set", () => {
  it("holds sectors at six and says so rather than trimming the seventh — Q1", async () => {
    const { SECTORS_MAX: max } = await import("./service-profile");
    expect(max).toBe(6);
    const seven = ["A", "B", "C", "D", "E", "F", "G"].map((letter) => `Sector ${letter}`);
    expect(checkServiceProfile({ sectorsServed: seven })).toEqual({
      ok: false,
      refusals: [{ field: "sectorsServed", reason: "too_many", max: 6 }],
    });
  });

  it("leaves languages alone when the caller did not send them", () => {
    /*
       `2c-s` shipped rendering a languages field and never posting it. The fix
       sends them; an older client that still does not must not be read as
       "this firm works in no language".
    */
    const result = checkServiceProfile({ headline: "Audit" });
    expect(result.ok && result.value.languages).toBeUndefined();
  });

  it("deduplicates languages case-insensitively, keeping the first spelling", () => {
    const result = checkServiceProfile({ languages: ["Arabic", "arabic", " English "] });
    expect(result.ok && result.value.languages).toEqual(["Arabic", "English"]);
  });

  it("refuses more languages than the cap", async () => {
    const { LANGUAGES_MAX } = await import("./service-profile");
    const many = Array.from({ length: LANGUAGES_MAX + 1 }, (_, i) => `Language ${i}`);
    const result = checkServiceProfile({ languages: many });
    expect(result.ok).toBe(false);
  });

  it("accepts a qualified count within the team band, and zero as a real answer", () => {
    expect(checkServiceProfile({ qualifiedCount: 9, teamSize: "b11_50" }).ok).toBe(true);
    const zero = checkServiceProfile({ qualifiedCount: 0, teamSize: "b1_10" });
    expect(zero.ok && zero.value.qualifiedCount).toBe(0);
  });

  it("refuses more qualified professionals than the band holds, naming the ceiling", () => {
    expect(checkServiceProfile({ qualifiedCount: 12, teamSize: "b1_10" })).toEqual({
      ok: false,
      refusals: [{ field: "qualifiedCount", reason: "exceeds_team", max: 10 }],
    });
  });

  it("does not cap against an open-ended band or no band at all", () => {
    expect(checkServiceProfile({ qualifiedCount: 900, teamSize: "b500_plus" }).ok).toBe(true);
    expect(checkServiceProfile({ qualifiedCount: 900, teamSize: null }).ok).toBe(true);
  });

  it("refuses a fraction or a negative, and keeps null as not stated", () => {
    expect(checkServiceProfile({ qualifiedCount: 2.5 }).ok).toBe(false);
    expect(checkServiceProfile({ qualifiedCount: -1 }).ok).toBe(false);
    const none = checkServiceProfile({ qualifiedCount: null });
    expect(none.ok && none.value.qualifiedCount).toBeNull();
  });

  it("trims typical client, stores empty as null, and refuses past eighty characters", async () => {
    const { TYPICAL_CLIENT_MAX } = await import("./service-profile");
    const clean = checkServiceProfile({ typicalClient: "  AED 10m–150m   turnover " });
    expect(clean.ok && clean.value.typicalClient).toBe("AED 10m–150m turnover");
    const empty = checkServiceProfile({ typicalClient: "   " });
    expect(empty.ok && empty.value.typicalClient).toBeNull();
    expect(checkServiceProfile({ typicalClient: "x".repeat(TYPICAL_CLIENT_MAX + 1) }).ok).toBe(false);
  });

  it("does not send services offered when the dashboard says it has none to send", () => {
    // `3b-s` leaves the services-offered list on onboarding; an absent list
    // from the dashboard must not wipe the one onboarding collected.
    const result = checkServiceProfile({ headline: "Audit", withServicesOffered: false });
    expect(result.ok && result.value.servicesOffered).toBeUndefined();
  });
});
