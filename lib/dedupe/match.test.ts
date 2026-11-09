import { describe, expect, it } from "vitest";
import { signalRows } from "@/app/(admin)/admin/ingest/dedupe/signals";
import {
  MIN_BLOCK,
  bestMatch,
  blockCapFor,
  buildMatchIndex,
  chooseParent,
  pairHint,
  type SideFacts,
} from "./match";
import { DEFAULT_BANDS, type Listing } from "./similarity";

/**
 * Board 12b — which side survives, and which listing a record pairs with.
 *
 * `chooseParent` is B1 in one function: the claimed, paying record is always
 * the parent whichever side a reviewer clicked, and two claimed records are
 * never decided by a rule (Q3). The first version kept `a.id < b.id`.
 */

const facts = (over: Partial<SideFacts>): SideFacts => ({
  id: "x",
  claimed: false,
  paying: false,
  reviews: 0,
  products: 0,
  enquiries: 0,
  publishedAt: new Date("2026-01-01T00:00:00Z"),
  createdAt: new Date("2026-01-01T00:00:00Z"),
  ...over,
});

const listing = (over: Partial<Listing>): Listing => ({
  id: "l",
  tradeName: "",
  licenceNumber: "",
  licenceAuthority: "DED",
  emirate: "dubai",
  areaId: null,
  addressLine: null,
  phones: [],
  ...over,
});

describe("chooseParent", () => {
  it("keeps the claimed side, whichever side it is on", () => {
    const claimed = facts({ id: "b", claimed: true });
    const unclaimed = facts({ id: "a", reviews: 40 });
    expect(chooseParent(unclaimed, claimed)).toMatchObject({ kind: "parent", parentId: "b", because: "claimed" });
    expect(chooseParent(claimed, unclaimed)).toMatchObject({ kind: "parent", parentId: "b", because: "claimed" });
  });

  it("refuses to pick between two claimed listings", () => {
    expect(chooseParent(facts({ id: "a", claimed: true }), facts({ id: "b", claimed: true, paying: true }))).toEqual({
      kind: "both_claimed",
    });
  });

  it("then prefers paying, then history, then the older listing", () => {
    expect(chooseParent(facts({ id: "a" }), facts({ id: "b", paying: true }))).toMatchObject({ parentId: "b", because: "paying" });
    expect(chooseParent(facts({ id: "a", products: 2 }), facts({ id: "b", reviews: 1 }))).toMatchObject({
      parentId: "b",
      because: "history",
    });
    expect(
      chooseParent(
        facts({ id: "a", publishedAt: new Date("2026-03-01T00:00:00Z") }),
        facts({ id: "b", publishedAt: new Date("2025-03-01T00:00:00Z") }),
      ),
    ).toMatchObject({ parentId: "b", because: "older" });
  });
});

describe("pairHint", () => {
  it("names a branch suffix on the licence root", () => {
    expect(pairHint({ licenceNumber: "DED-441908" }, { licenceNumber: "DED-441908-01" })).toEqual({
      kind: "branch_suffix",
      suffix: "01",
    });
  });

  it("says the same licence is the company itself", () => {
    expect(pairHint({ licenceNumber: "DED-441908" }, { licenceNumber: "441908" })).toEqual({ kind: "same_licence" });
  });

  it("says nothing when the licences do not share a root", () => {
    expect(pairHint({ licenceNumber: "DED-441908" }, { licenceNumber: "DED-552017-01" })).toBeNull();
  });
});

describe("bestMatch", () => {
  const gulfCool = listing({
    id: "gulf-cool",
    tradeName: "Gulf Cool Technical Services LLC",
    licenceNumber: "DED-441908",
    phones: ["04 340 6688"],
  });
  const other = listing({ id: "other", tradeName: "Marina Pumps & Controls", licenceNumber: "DED-552017" });
  const index = buildMatchIndex([gulfCool, other]);

  it("pairs a branch record with its parent in the manual band", () => {
    const record = listing({
      id: "record:1",
      tradeName: "Gulf Cool Technical Services (Branch)",
      licenceNumber: "DED-441908-01",
      phones: ["043406688"],
    });
    const { match } = bestMatch(record, index, DEFAULT_BANDS);
    expect(match?.listing.id).toBe("gulf-cool");
    expect(match?.similarity.band).toBe("probable");
  });

  it("leaves a listing somebody kept separate out of the running", () => {
    const record = listing({ id: "record:2", tradeName: "Gulf Cool Technical Services (Branch)", licenceNumber: "DED-441908-02" });
    expect(bestMatch(record, index, DEFAULT_BANDS, new Set(["gulf-cool"])).match).toBeNull();
  });

  it("counts a near miss under the floor rather than dropping it silently", () => {
    const record = listing({ id: "record:3", tradeName: "Summit Rigging LLC", licenceNumber: "DED-441908-03" });
    const result = bestMatch(record, index, { floor: 0.8, certain: 0.9 });
    expect(result.match).toBeNull();
    expect(result.nearMiss).toBe(true);
  });
});

describe("T4.5 — the block cap moves with the directory", () => {
  /*
     The defect, as a test.

     `MAX_BLOCK` was a flat 200 and the cut was made at **lookup**: a word
     shared by more than two hundred listings was skipped by `bestMatch`, so the
     index still carried it and nothing anywhere said a word had been given up
     on. The number did not move with the corpus, which is the part that
     mattered — at four hundred listings it never fired, and at four hundred
     thousand it would cut words that appear in one listing in two thousand.
  */
  it("is a share of the corpus, with a floor", () => {
    // Small directory: the floor, because no word identifies nobody yet.
    expect(blockCapFor(0)).toBe(MIN_BLOCK);
    expect(blockCapFor(400)).toBe(MIN_BLOCK);
    // 41,000 listings: a word in one in a hundred still narrows to 410.
    expect(blockCapFor(41_000)).toBe(410);
    // And it keeps moving, which the flat 200 did not.
    expect(blockCapFor(400_000)).toBe(4_000);
  });

  it("drops an over-common word when the index is built, and says which", () => {
    /*
       Two hundred and one listings sharing one word, against a cap of 200. The
       word leaves the index — so `bestMatch` reads no useless block — and it is
       named on the index, because a silent cut is what this replaced.
    */
    const many = Array.from({ length: MIN_BLOCK + 1 }, (_, i) =>
      listing({ id: `gulf-${String(i)}`, tradeName: `Gulf Trading ${String(i)} LLC` }),
    );
    const index = buildMatchIndex(many, MIN_BLOCK);

    expect(index.blockCap).toBe(MIN_BLOCK);
    expect(index.droppedKeys).toContain("gulf");
    expect(index.blocks.has("name:gulf")).toBe(false);
    /*
       The rarer word in the same name is untouched: this is a cap on words that
       identify nobody, not a cap on the name. `keysFor` only blocks on tokens
       longer than two characters, so `137` is a key and `17` is not — which is
       worth asserting, because a reader of this test would otherwise read the
       absent `17` as the cap having fired.
    */
    expect(index.blocks.get("name:137")?.length).toBe(1);
    expect(index.blocks.has("name:17")).toBe(false);
  });

  it("never drops a licence or a phone, however many listings share it", () => {
    /*
       A licence shared by four hundred listings is not noise — it is four
       hundred listings that need looking at, and dropping the block would hide
       the clearest duplicate signal the matcher has.
    */
    const many = Array.from({ length: MIN_BLOCK + 1 }, (_, i) =>
      listing({ id: `same-${String(i)}`, tradeName: `Distinct ${String(i)}`, licenceNumber: "DED-441908", phones: ["043406688"] }),
    );
    const index = buildMatchIndex(many, MIN_BLOCK);
    expect(index.blocks.get("licence:441908")?.length).toBe(MIN_BLOCK + 1);
    expect(index.blocks.get("phone:43406688")?.length).toBe(MIN_BLOCK + 1);
    expect(index.droppedKeys).not.toContain("441908");
  });
});

describe("the signals rail", () => {
  it("always asks the same five questions, and answers no where nothing matched", () => {
    const rows = signalRows([
      { key: "licence_root", strength: 1, detail: "441908, suffix 01" },
      { key: "trade_name", strength: 0.94, detail: "94% of the identifying words" },
      { key: "nearby_area", strength: 1, detail: "Al Quoz Industrial 3 and Al Quoz Industrial 4" },
    ]);
    expect(rows.map((row) => [row.label, row.value])).toEqual([
      ["Licence root identical", "Strong"],
      ["Phone", "No match"],
      ["Trade name similarity", "94%"],
      ["Same area", "Adjacent"],
      ["Same activity code", "No match"],
    ]);
  });
});
