import { describe, expect, it } from "vitest";
import {
  REJECTION_ACTION,
  REJECTION_GROUNDS,
  activityKey,
  categorySlugFor,
  classify,
  displayNameFor,
  effectiveAuthority,
  expiryFloor,
  hasReadableTradeName,
  heldReasons,
  isOutOfScope,
  licenceKey,
  normaliseEmirate,
  stagedOutcome,
  tally,
  type LicenceRecord,
} from "./classify";

/**
 * Criterion 1's classifier, in the pure.
 *
 * The bias under test throughout is toward **queueing rather than rejecting**.
 * A record we cannot categorise costs somebody an afternoon; a record we
 * wrongly reject is a supplier who is not in the directory and will never know
 * why.
 */

const NOW = new Date("2026-08-26T00:00:00Z");

const record = (over: Partial<LicenceRecord> = {}): LicenceRecord => ({
  tradeName: "Al Marwan Industrial Supplies LLC",
  licenceNumber: "DED-618402",
  licenceAuthority: "DED",
  licenceExpiry: new Date("2027-03-01T00:00:00Z"),
  emirate: "Dubai",
  areaName: "Al Quoz Industrial 1",
  activity: "Trading in Valves & Pipe Fittings",
  phone: "+97143472290",
  ...over,
});

describe("a readable trade name", () => {
  it("accepts a real one", () => {
    expect(hasReadableTradeName("Al Marwan Industrial Supplies LLC")).toBe(true);
  });

  it("refuses the shapes an export actually carries", () => {
    for (const value of ["", "  ", "-", "--", "N/A", "n/a", "none", "NIL", "unknown", "7"]) {
      expect(hasReadableTradeName(value), value).toBe(false);
    }
  });

  it("accepts a two-letter name, because some are", () => {
    expect(hasReadableTradeName("KM")).toBe(true);
  });
});

describe("the emirate", () => {
  it("normalises the spellings and codes an export uses", () => {
    expect(normaliseEmirate("Dubai")).toBe("dubai");
    expect(normaliseEmirate("DXB")).toBe("dubai");
    expect(normaliseEmirate("abu dhabi")).toBe("abu_dhabi");
    expect(normaliseEmirate("RAK")).toBe("ras_al_khaimah");
    expect(normaliseEmirate("Umm Al Quwain")).toBe("umm_al_quwain");
  });

  it("does not recognise somewhere else", () => {
    expect(normaliseEmirate("Doha")).toBeNull();
    expect(normaliseEmirate("Riyadh")).toBeNull();
    expect(normaliseEmirate("")).toBeNull();
  });
});

describe("the category, from a licence activity", () => {
  it("reads the nouns that identify a trade", () => {
    expect(categorySlugFor("Trading in Valves & Pipe Fittings")).toBe("valves-and-fittings");
    expect(categorySlugFor("GI Pipe and Tube Trading")).toBe("pipes-and-tubing");
    expect(categorySlugFor("Air Conditioning Equipment Trading")).toBe("hvac-and-ventilation");
    expect(categorySlugFor("Electrical Cable & Accessories Trading")).toBe("electrical-and-cable");
    expect(categorySlugFor("Safety Equipment & Protective Clothing")).toBe("safety-and-ppe");
  });

  it("reads Arabic terms too", () => {
    expect(categorySlugFor("تجارة صمامات")).toBe("valves-and-fittings");
  });

  it("matches a signal at the start of a word, not inside one", () => {
    // Each of these was filed, confidently and wrongly, by a substring test.
    expect(categorySlugFor("Copper Wire Trading")).toBeNull(); // co-ppe-r
    expect(categorySlugFor("Food Products Trading")).toBeNull(); // pro-duct-s
    expect(categorySlugFor("Tipper Truck Rental")).toBeNull(); // ti-ppe-r
    expect(categorySlugFor("Unmapped Trade")).toBeNull();
  });

  it("still reads a stem and a compound", () => {
    expect(categorySlugFor("Ductwork Fabrication")).toBe("hvac-and-ventilation");
    expect(categorySlugFor("Ventilation & Duct Works Materials Trading")).toBe("hvac-and-ventilation");
    expect(categorySlugFor("PPE & Workwear Trading")).toBe("safety-and-ppe");
    expect(categorySlugFor("Pipes/Valves Trading")).toBe("valves-and-fittings");
  });

  it("reads an Arabic noun with its article attached", () => {
    expect(categorySlugFor("تجارة الصمامات")).toBe("valves-and-fittings");
  });

  it("returns nothing rather than guessing", () => {
    // "General Trading" covers half the suppliers in Dubai. Queue it.
    expect(categorySlugFor("General Trading")).toBeNull();
    expect(categorySlugFor("Building Materials Trading")).toBeNull();
    expect(categorySlugFor(null)).toBeNull();
  });
});

describe("out of scope", () => {
  it("fires on activities that are positively something else", () => {
    expect(isOutOfScope("Restaurant & Cafeteria")).toBe(true);
    expect(isOutOfScope("Ladies Beauty Salon")).toBe(true);
    expect(isOutOfScope("Legal Consultancy")).toBe(true);
  });

  it("does not fire on a general trading licence", () => {
    // The single most common licence in the market. Rejecting it would empty
    // the directory of exactly the suppliers it is for.
    expect(isOutOfScope("General Trading")).toBe(false);
    expect(isOutOfScope("Trading in Building Materials")).toBe(false);
  });

  it("does not fire on something merely unrecognised", () => {
    expect(isOutOfScope("Marine Equipment Trading")).toBe(false);
  });
});

describe("classifying a record", () => {
  it("is ready when the activity names a trade", () => {
    expect(classify(record(), NOW)).toEqual({
      disposition: "ready",
      ground: null,
      categorySlug: "valves-and-fittings",
    });
  });

  it("queues a record it cannot categorise, rather than rejecting it", () => {
    const result = classify(record({ activity: "General Trading" }), NOW);
    expect(result.disposition).toBe("needs_category");
    expect(result.ground).toBeNull();
  });

  it("rejects a record with no readable name, first", () => {
    // Checked before everything else: a record with no name cannot be argued
    // about, and naming a different ground would send somebody looking.
    const result = classify(
      record({ tradeName: "-", emirate: "Doha", activity: "Restaurant" }),
      NOW,
    );
    expect(result).toMatchObject({ disposition: "rejected", ground: "no_readable_trade_name" });
  });

  it("rejects a licence more than 24 months expired", () => {
    const result = classify(
      record({ licenceExpiry: new Date("2023-01-01T00:00:00Z") }),
      NOW,
    );
    expect(result).toMatchObject({
      disposition: "rejected",
      ground: "licence_expired_24_months",
    });
  });

  it("keeps a licence that expired recently", () => {
    // A late renewal is the most ordinary thing in this market, and the
    // verification ladder already drops the tier for it.
    const result = classify(
      record({ licenceExpiry: new Date("2026-06-01T00:00:00Z") }),
      NOW,
    );
    expect(result.disposition).toBe("ready");
  });

  it("keeps a record with no expiry at all", () => {
    const result = classify(record({ licenceExpiry: null }), NOW);
    expect(result.disposition).toBe("ready");
  });

  it("rejects an address outside the UAE", () => {
    const result = classify(record({ emirate: "Doha" }), NOW);
    expect(result).toMatchObject({ disposition: "rejected", ground: "address_outside_uae" });
  });

  it("rejects an activity that is positively something else", () => {
    const result = classify(record({ activity: "Restaurant & Cafeteria" }), NOW);
    expect(result).toMatchObject({ disposition: "rejected", ground: "activity_out_of_scope" });
  });

  it("never returns published — that is a person's decision", () => {
    const dispositions = new Set(
      [
        record(),
        record({ activity: "General Trading" }),
        record({ tradeName: "" }),
        record({ emirate: "Doha" }),
      ].map((r) => classify(r, NOW).disposition),
    );
    expect(dispositions.has("ready" as never)).toBe(true);
    expect([...dispositions]).not.toContain("published");
  });
});

describe("the totals the run screen renders", () => {
  it("counts rejections by ground", () => {
    const totals = tally([
      classify(record(), NOW),
      classify(record({ activity: "General Trading" }), NOW),
      classify(record({ tradeName: "-" }), NOW),
      classify(record({ tradeName: "N/A" }), NOW),
      classify(record({ emirate: "Doha" }), NOW),
      classify(record({ activity: "Restaurant" }), NOW),
    ]);

    expect(totals.rows).toBe(6);
    expect(totals.categorised).toBe(1);
    expect(totals.queued).toBe(1);
    expect(totals.rejected).toBe(4);
    expect(totals.staged).toBe(2);
    expect(totals.byGround).toEqual({
      no_readable_trade_name: 2,
      address_outside_uae: 1,
      activity_out_of_scope: 1,
      licence_expired_24_months: 0,
    });
  });

  it("adds up", () => {
    const totals = tally([classify(record(), NOW), classify(record({ emirate: "Doha" }), NOW)]);
    expect(totals.staged + totals.rejected).toBe(totals.rows);
    expect(totals.categorised + totals.queued).toBe(totals.staged);
  });
});

/* ── Board 12a, board-level pass ─────────────────────────────────────────── */

const KNOWN = new Set(["DED", "KIZAD", "SAIF"]);

describe("the expiry floor is twenty-four calendar months", () => {
  it("keeps a licence that lapsed 725 days ago, which 24 × 30 days rejected", () => {
    // 720 days is ten short of two years. The bias of this file is toward not
    // rejecting a real supplier, and the old arithmetic did the opposite.
    const lapsed = new Date(NOW.getTime() - 725 * 86_400_000);
    expect(classify(record({ licenceExpiry: lapsed }), NOW).disposition).toBe("ready");
  });

  it("rejects one that lapsed a day past the floor", () => {
    const floor = expiryFloor(NOW);
    const lapsed = new Date(floor.getTime() - 86_400_000);
    expect(classify(record({ licenceExpiry: lapsed }), NOW)).toMatchObject({
      ground: "licence_expired_24_months",
    });
  });

  it("is the same date two years earlier", () => {
    expect(expiryFloor(NOW).toISOString().slice(0, 10)).toBe("2024-08-26");
  });
});

describe("the four grounds are a closed list with an action each", () => {
  it("names all four once, in the board's order", () => {
    expect(REJECTION_GROUNDS).toEqual([
      "licence_expired_24_months",
      "no_readable_trade_name",
      "activity_out_of_scope",
      "address_outside_uae",
    ]);
    expect(Object.keys(REJECTION_ACTION).sort()).toEqual([...REJECTION_GROUNDS].sort());
  });

  it("never publishes an expired licence and discards the rest", () => {
    expect(REJECTION_ACTION.licence_expired_24_months).toBe("never_publish");
    expect(REJECTION_ACTION.address_outside_uae).toBe("discard");
  });
});

describe("the phrase a queue groups by", () => {
  it("ignores case and runs of space, and nothing else", () => {
    expect(activityKey("  General   Trading ")).toBe("general trading");
    expect(activityKey("general\ttrading")).toBe("general trading");
    expect(activityKey("Trading in Valves & Pipe Fittings")).toBe("trading in valves & pipe fittings");
  });

  it("is empty for a record with no activity", () => {
    expect(activityKey(null)).toBe("");
    expect(activityKey("   ")).toBe("");
  });

  it("leaves a non-breaking space alone, as the migration's SQL does", () => {
    // Postgres's `[ \t\n\r\f\v]` does not match U+00A0. A key JavaScript
    // collapsed and SQL did not would give one phrase two groups.
    expect(activityKey("general\u00a0trading")).toBe("general\u00a0trading");
    expect(activityKey("general\u00a0trading")).not.toBe(activityKey("general trading"));
  });
});

describe("a licence's identity", () => {
  it("is the authority and the digits", () => {
    expect(licenceKey("DED", "DED-618402")).toBe("DED:618402");
    expect(licenceKey("ded", "618402")).toBe("DED:618402");
    expect(licenceKey("DED", "DED 618-402")).toBe("DED:618402");
  });

  it("is a different licence under a different authority", () => {
    expect(licenceKey("KIZAD", "618402")).not.toBe(licenceKey("DED", "618402"));
  });

  it("is nothing without digits, rather than a match with every other blank", () => {
    expect(licenceKey("DED", "")).toBeNull();
    expect(licenceKey("DED", "PENDING")).toBeNull();
    expect(licenceKey(null, "618402")).toBeNull();
  });
});

describe("which authority licensed a record", () => {
  it("reads the run's source where the record's column is blank", () => {
    expect(effectiveAuthority(null, "DED", KNOWN)).toEqual({ code: "DED", stated: null });
    expect(effectiveAuthority("  ", "DED", KNOWN)).toEqual({ code: "DED", stated: null });
  });

  it("prefers the record's own column", () => {
    expect(effectiveAuthority("kizad", "DED", KNOWN).code).toBe("KIZAD");
  });

  it("does not paper over an authority we have no code for with the run's", () => {
    // The record disagrees with the file. That is for a person to see.
    expect(effectiveAuthority("XFZ", "DED", KNOWN)).toEqual({ code: null, stated: "XFZ" });
  });
});

describe("why a record is held back from publishing", () => {
  const ready = {
    disposition: "ready",
    categoryId: "cat",
    licenceAuthority: null,
    licenceNumber: "DED-1001",
    licenceExpiry: new Date("2027-01-01T00:00:00Z"),
  };

  it("holds nothing back from a complete record", () => {
    expect(heldReasons(ready, "DED", KNOWN)).toEqual([]);
  });

  it("holds a record waiting on a category", () => {
    expect(heldReasons({ ...ready, disposition: "needs_category", categoryId: null }, "DED", KNOWN)).toEqual([
      "needs_category",
    ]);
  });

  it("holds rather than invents: no licence number, no expiry", () => {
    // The old approval published `PENDING-XXXXXXXX` and "a year from today".
    expect(heldReasons({ ...ready, licenceNumber: null }, "DED", KNOWN)).toEqual(["licence_number_missing"]);
    expect(heldReasons({ ...ready, licenceExpiry: null }, "DED", KNOWN)).toEqual(["expiry_missing"]);
  });

  it("holds an authority with no code, and says every reason at once", () => {
    expect(
      heldReasons({ ...ready, licenceAuthority: "XFZ", licenceExpiry: null, categoryId: null }, "DED", KNOWN),
    ).toEqual(["needs_category", "authority_unrecognised", "expiry_missing"]);
  });
});

describe("where a staged record lands — reject, dedupe, then categorise", () => {
  const verdict = (over: Partial<ReturnType<typeof classify>> = {}) => ({
    disposition: "ready" as const,
    ground: null,
    categorySlug: "valves-and-fittings",
    ...over,
  });

  it("rejects before anything else", () => {
    expect(
      stagedOutcome({
        verdict: { disposition: "rejected", ground: "address_outside_uae", categorySlug: null },
        duplicate: true,
        mappedCategoryId: "m",
        signalCategoryId: "s",
      }),
    ).toEqual({ disposition: "rejected", ground: "address_outside_uae", categoryId: null, categorySource: null });
  });

  it("hands a duplicate to dedupe without categorising it", () => {
    // Q1: a record about to merge into a listing that has a category is not
    // worth a person's afternoon in the queue.
    expect(
      stagedOutcome({ verdict: verdict(), duplicate: true, mappedCategoryId: "m", signalCategoryId: "s" }),
    ).toMatchObject({ disposition: "duplicate", categoryId: null });
  });

  it("prefers a remembered decision to a keyword", () => {
    expect(
      stagedOutcome({ verdict: verdict(), duplicate: false, mappedCategoryId: "m", signalCategoryId: "s" }),
    ).toEqual({ disposition: "ready", ground: null, categoryId: "m", categorySource: "mapping" });
  });

  it("uses the keyword where nobody has decided", () => {
    expect(
      stagedOutcome({ verdict: verdict(), duplicate: false, mappedCategoryId: null, signalCategoryId: "s" }),
    ).toMatchObject({ categoryId: "s", categorySource: "signal" });
  });

  it("queues a signal whose category is not in the database, rather than calling it ready", () => {
    // The old staging wrote `ready` with no category, and approval stranded it.
    expect(
      stagedOutcome({ verdict: verdict(), duplicate: false, mappedCategoryId: null, signalCategoryId: null }),
    ).toEqual({ disposition: "needs_category", ground: null, categoryId: null, categorySource: null });
  });
});

describe("the three buckets sum to the file", () => {
  it("counts duplicates apart from new listings", () => {
    const totals = tally([
      { disposition: "ready" },
      { disposition: "needs_category" },
      { disposition: "duplicate" },
      { disposition: "rejected", ground: "address_outside_uae" },
    ]);
    expect(totals).toMatchObject({ rows: 4, staged: 2, duplicates: 1, rejected: 1 });
    expect(totals.staged + totals.duplicates + totals.rejected).toBe(totals.rows);
  });
});

describe("the name a buyer reads", () => {
  it("drops the legal suffix and nothing else", () => {
    expect(displayNameFor("Al Marwan Industrial Supplies LLC")).toBe("Al Marwan Industrial Supplies");
    expect(displayNameFor("Saif Line Pipe Supply FZE")).toBe("Saif Line Pipe Supply");
    expect(displayNameFor("Gulf Rigging L.L.C.")).toBe("Gulf Rigging");
    expect(displayNameFor("Meydan Air FZ-LLC")).toBe("Meydan Air");
    expect(displayNameFor("Doha Pipe Trading WLL")).toBe("Doha Pipe Trading");
  });

  it("keeps a name that is only a suffix, rather than returning nothing", () => {
    expect(displayNameFor("LLC")).toBe("LLC");
  });

  it("does not strip a suffix inside the name", () => {
    expect(displayNameFor("LLC Brothers Trading")).toBe("LLC Brothers Trading");
  });
});
