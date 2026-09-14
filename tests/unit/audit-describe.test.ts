import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS, BLAST_UNITS, PAIRED_ACTIONS, RETIRED_AUDIT_ACTIONS } from "@/lib/audit/types";
import { actionLabel, blastPhrase, describeChange, describeEntry, parseSubject } from "@/lib/audit/describe";
import { decodeCursor, encodeCursor, normaliseAuditFilter } from "@/lib/audit/filter";
import { assertBlastRadius } from "@/lib/audit/write-audit";
import { hasMessage } from "@/lib/i18n";

/**
 * Board 4i — the log reads as consequence, and every row it can meet has words.
 */

describe("every action the log can hold reads as a sentence", () => {
  it("has a phrase for every action written today and every retired one", () => {
    for (const action of [...AUDIT_ACTIONS, ...RETIRED_AUDIT_ACTIONS]) {
      expect(hasMessage(`audit.action.${action}`), action).toBe(true);
    }
  });

  it("has a noun for every blast-radius unit", () => {
    for (const unit of BLAST_UNITS) expect(hasMessage(`audit.blast.${unit}`), unit).toBe(true);
  });

  it("names the staff screen's five outcomes under staff.manage", () => {
    expect(PAIRED_ACTIONS["staff.manage"]).toEqual(
      expect.arrayContaining([
        "staff_invited",
        "staff_invite_resent",
        "staff_invite_revoked",
        "staff_role_changed",
        "staff_deactivated",
      ]),
    );
  });
});

describe("B4 — the sentence carries the blast radius", () => {
  it("reads the render's template-publish line from the row", () => {
    const described = describeEntry({
      actorName: "R. Haddad",
      action: "taxonomy_changed",
      subjectName: "Valves & actuators v3",
      blastRadius: 8412,
      blastUnit: "products",
    });
    expect(described.headline).toBe("R. Haddad changed the taxonomy");
    expect(described.subjectName).toBe("Valves & actuators v3");
    expect(described.blast).toBe("affected 8,412 products");
  });

  it("uses the singular for one", () => {
    expect(blastPhrase(1, "listings")).toBe("affected 1 listing");
  });

  it("omits a radius with no known unit rather than printing a bare number", () => {
    expect(blastPhrase(12, "widgets")).toBeNull();
    expect(blastPhrase(null, "products")).toBeNull();
  });

  it("shows an unknown action by its key instead of hiding the row", () => {
    const described = describeEntry({
      actorName: "A",
      action: "something_new",
      subjectName: null,
      blastRadius: null,
      blastUnit: null,
    });
    expect(described.headline).toBe("A something_new");
    expect(described.unknownAction).toBe(true);
    expect(actionLabel("something_new")).toBe("something_new");
  });

  it("capitalises the label from the phrase", () => {
    expect(actionLabel("review_removed")).toBe("Removed a review");
  });
});

describe("before and after read as the fields that changed", () => {
  it("lists scalar fields that differ, and nothing that did not", () => {
    expect(describeChange({ role: "staff_moderator", note: "x" }, { role: "staff_finance", note: "x" })).toEqual([
      { field: "role", from: "staff_moderator", to: "staff_finance" },
    ]);
  });

  it("reads a cleared value and a set one", () => {
    expect(describeChange({ role: "staff_finance" }, { role: null })).toEqual([
      { field: "role", from: "staff_finance", to: "—" },
    ]);
    expect(describeChange(null, { verificationTier: 2 })).toEqual([{ field: "verificationTier", from: "—", to: "2" }]);
  });

  it("skips nested values rather than printing JSON into a table", () => {
    expect(describeChange({ grants: { a: 1 } }, { grants: { a: 2 } })).toEqual([]);
  });
});

describe("a blast radius is a whole count with a known noun, or absent", () => {
  it("accepts a count and a unit", () => {
    expect(assertBlastRadius("x", { count: 64, unit: "pairs" })).toEqual({ count: 64, unit: "pairs" });
    expect(assertBlastRadius("x", null)).toBeNull();
  });

  it("refuses the shapes a miscounting service would write", () => {
    expect(() => assertBlastRadius("x", { count: 1.5, unit: "pairs" })).toThrow();
    expect(() => assertBlastRadius("x", { count: -1, unit: "pairs" })).toThrow();
    expect(() => assertBlastRadius("x", { count: Number.NaN, unit: "pairs" })).toThrow();
    expect(() => assertBlastRadius("x", { count: 3, unit: "widgets" as never })).toThrow();
  });
});

describe("the log's filters take only what they can mean", () => {
  it("keeps a subject reference and a subject type", () => {
    expect(normaliseAuditFilter({ subject: "Business:clx123" })).toEqual({ subject: "Business:clx123" });
    expect(normaliseAuditFilter({ subject: "Business" })).toEqual({ subject: "Business" });
  });

  it("drops anything else", () => {
    expect(
      normaliseAuditFilter({ actor: "not-a-uuid", action: "DROP TABLE", subject: "business:%" }),
    ).toEqual({});
  });

  it("lowercases an actor id", () => {
    expect(normaliseAuditFilter({ actor: "00000000-0000-4000-8000-00000000000A" })).toEqual({
      actorId: "00000000-0000-4000-8000-00000000000a",
    });
  });

  it("parses a reference only when both halves exist", () => {
    expect(parseSubject("User:abc")).toEqual({ type: "User", id: "abc" });
    expect(parseSubject("User:")).toBeNull();
    expect(parseSubject(":abc")).toBeNull();
  });
});

describe("page cursors survive the round trip and refuse tampering", () => {
  it("round-trips", () => {
    const cursor = { at: new Date("2026-09-14T08:12:44.123Z"), id: "clx0abc" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("refuses what it did not write", () => {
    expect(decodeCursor("not base64 at all!")).toBeNull();
    expect(decodeCursor(Buffer.from("yesterday|x").toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from("2026-09-14T00:00:00Z|x'; --").toString("base64url"))).toBeNull();
    expect(decodeCursor(null)).toBeNull();
  });
});
