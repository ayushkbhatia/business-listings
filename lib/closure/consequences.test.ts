import { describe, expect, it } from "vitest";
import { consequenceRows, notOursToDelete } from "./consequences";

/**
 * Board `11i`'s consequence table, without a database.
 *
 * The table is the screen's claim about what closure does, and every number in
 * it is somebody else's: the seat count is a query, the retention periods are
 * Privacy §07's. These assert the claims agree with their sources.
 */

const FACTS = { seats: 3, subdomain: "alwaha.businesslistings.me", slug: "al-waha-industrial-supplies" };

describe("consequenceRows", () => {
  it("splits into what leaves at closure and what is kept, in that order", () => {
    const kinds = consequenceRows(FACTS).map((row) => row.kind);
    const firstKept = kinds.findIndex((kind) => kind !== "leaves");
    expect(kinds.slice(0, firstKept).every((kind) => kind === "leaves")).toBe(true);
    expect(kinds.slice(firstKept).every((kind) => kind !== "leaves")).toBe(true);
    expect(kinds.filter((kind) => kind === "leaves")).toHaveLength(3);
  });

  it("prints the seat count it was given, not a number of its own", () => {
    const team = consequenceRows(FACTS).find((row) => row.key === "team")!;
    expect(team.body).toContain("3 seats");
    const alone = consequenceRows({ ...FACTS, seats: 1 }).find((row) => row.key === "team")!;
    expect(alone.body).not.toContain("1 seats");
  });

  it("names the storefront address only where the business has one", () => {
    expect(consequenceRows(FACTS).find((row) => row.key === "storefront")!.body).toContain(
      "alwaha.businesslistings.me",
    );
    expect(
      consequenceRows({ ...FACTS, subdomain: null }).find((row) => row.key === "storefront")!.body,
    ).not.toContain("released");
  });

  it("reserves this business's own address", () => {
    expect(consequenceRows(FACTS).find((row) => row.key === "address")!.body).toContain(
      "/b/al-waha-industrial-supplies",
    );
  });

  it("carries the retention periods Privacy §07 publishes", () => {
    const rows = consequenceRows(FACTS);
    expect(rows.find((row) => row.key === "documents")!.body).toContain("12 months");
    expect(rows.find((row) => row.key === "invoices")!.body).toContain("5 years");
  });

  it("never calls the licence documents statutory, because the published policy does not", () => {
    // The board's rail said "statutory"; Privacy §07 gives the reason as proof
    // of what we checked. The screen says what the policy says.
    const documents = consequenceRows(FACTS).find((row) => row.key === "documents")!;
    expect(documents.body.toLowerCase()).not.toContain("statutory");
  });
});

describe("notOursToDelete", () => {
  it("counts every kept row except the address, which is our own promise", () => {
    expect(notOursToDelete(consequenceRows(FACTS))).toEqual({ notOurs: 4, kept: 5 });
  });
});
