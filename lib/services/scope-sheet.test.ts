import { describe, expect, it } from "vitest";
import {
  OPTIONAL_FIELD_KEYS,
  REQUIRED_COUNT,
  REQUIRED_FIELDS,
  ROW_COUNT,
  ROW_KEYS,
  completeness,
  isDeliveredWhere,
  isEngagementType,
  isOptionalFieldKey,
  mayPublish,
  rowsFilled,
  scopeRows,
  serviceSlug,
  uniqueServiceSlug,
  type FamilyRow,
  type RequiredFieldValues,
} from "./scope-sheet";

/**
 * Boards `3g-s`, `3f-s`, `1g-s` — the rules, without a database.
 *
 * The two things worth pinning here are the ones that leave the screen: the
 * completeness number, which becomes a column, a gap report and a ranking term,
 * and the row order, which is the entire comparison instrument on the public
 * page.
 */

const empty: RequiredFieldValues = {
  name: null,
  engagementType: null,
  feeBasis: null,
  turnaround: null,
  deliveredWhere: null,
  deliverable: null,
};

const complete: RequiredFieldValues = {
  name: "Hard FM & MEP maintenance",
  engagementType: "ongoing_contract",
  feeBasis: "per_month",
  turnaround: "24/7 callout, 4-hour attendance",
  deliveredWhere: "on_site",
  deliverable: "Monthly written report with asset condition photographs",
};

describe("the field list", () => {
  it("asks for six required fields and no more", () => {
    expect(REQUIRED_FIELDS).toHaveLength(6);
    expect(REQUIRED_COUNT).toBe(6);
  });

  it("carries four optional keys, and capacity is not one of them", () => {
    /*
       D11, closed as no on 11 Sep. The board offers `capacity` and marks it
       under review; a listed business is taking work, and a stale "accepting
       clients" flag is worse than no flag because a buyer who acts on one and
       gets no reply blames the directory rather than the firm.
    */
    expect<readonly string[]>(OPTIONAL_FIELD_KEYS).not.toContain("capacity");
    expect(isOptionalFieldKey("capacity")).toBe(false);
    expect(isOptionalFieldKey("regulator")).toBe(true);
  });

  it("renders nine public rows — the twelve fields minus the name and the fee", () => {
    // The name is the page's h1, and the indicative fee is private.
    expect(ROW_KEYS).toHaveLength(9);
    expect(ROW_COUNT).toBe(9);
    expect(ROW_KEYS).not.toContain("name");
    expect(ROW_KEYS.some((key) => key.includes("fee_basis"))).toBe(true);
    expect(ROW_KEYS.some((key) => key.includes("indicative"))).toBe(false);
  });

  it("refuses an engagement type or delivery place that is not on the list", () => {
    expect(isEngagementType("ongoing_contract")).toBe(true);
    expect(isEngagementType("annual")).toBe(false);
    expect(isDeliveredWhere("on_site")).toBe(true);
    expect(isDeliveredWhere("hybrid")).toBe(false);
  });
});

describe("completeness — measured, never declared", () => {
  it("counts an empty sheet as 0 of 6 and names every gap", () => {
    const result = completeness(empty);
    expect(result).toEqual({ filled: 0, total: 6, missing: [...REQUIRED_FIELDS] });
  });

  it("counts a full sheet as 6 of 6 with nothing missing", () => {
    expect(completeness(complete)).toEqual({ filled: 6, total: 6, missing: [] });
  });

  it("names the gaps on the render's own 4-of-6 row", () => {
    // Chiller overhaul, live at 4 of 6: no deliverable and no delivered-where.
    const chiller: RequiredFieldValues = {
      ...complete,
      deliverable: null,
      deliveredWhere: null,
    };
    const result = completeness(chiller);
    expect(result.filled).toBe(4);
    expect(result.missing).toEqual(["deliveredWhere", "deliverable"]);
  });

  it("names gaps in the order the editor asks them, not the order they were found", () => {
    const result = completeness({ ...complete, name: null, feeBasis: null });
    expect(result.missing).toEqual(["name", "feeBasis"]);
  });

  it("does not count whitespace as an answer", () => {
    /*
       Not pedantry. The number is the intended ranking input on `12c`, so a
       field holding three spaces scoring the same as a filled one makes the
       term gameable by accident before anybody tries on purpose.
    */
    expect(completeness({ ...complete, turnaround: "   " }).filled).toBe(5);
  });

  it("never blocks publishing, at any score — B4", () => {
    // A function rather than a comment, so anything reaching for a
    // completeness gate has to delete it to get one.
    expect(mayPublish()).toBe(true);
  });
});

describe("the public scope table", () => {
  const family: FamilyRow[] = [
    { key: "sectors", label: "Sectors most audited", position: 7, filterable: true },
    { key: "engagement_type", label: "Engagement type", position: 0, filterable: true },
    { key: "turnaround", label: "Turnaround", position: 1, filterable: false },
    { key: "fee_basis", label: "Fee basis", position: 2, filterable: true },
    { key: "deliverable", label: "Deliverable", position: 3, filterable: false },
    { key: "delivered_where", label: "Delivered where", position: 4, filterable: true },
    { key: "regulator", label: "Standard applied", position: 5, filterable: true },
    { key: "requires_from_client", label: "You provide", position: 6, filterable: false },
    { key: "languages", label: "Languages", position: 8, filterable: false },
  ];

  it("renders in family order, whatever order the rows arrive in", () => {
    // The comparison instrument: a buyer reading three audit firms reads the
    // same nine rows in the same order three times.
    const rows = scopeRows(family, {});
    expect(rows.map((row) => row.key)).toEqual([...ROW_KEYS]);
  });

  it("uses the family's labels, so two families name the same row differently", () => {
    const rows = scopeRows(family, {});
    expect(rows.find((row) => row.key === "sectors")?.label).toBe("Sectors most audited");
    expect(rows.find((row) => row.key === "regulator")?.label).toBe("Standard applied");
  });

  it("returns unfilled rows as null rather than dropping them", () => {
    /*
       The one place this build diverges from an explicit build note. `1g-s` B2
       asks for unfilled rows to be omitted; `CLAUDE.md` § Interface honesty
       says unfilled rows stay visible and grey, because what is unanswered is
       what makes the enquiry high-intent. Returning the row keeps that a
       rendering decision rather than a data one.
    */
    const rows = scopeRows(family, { engagement_type: "Annual" });
    expect(rows).toHaveLength(9);
    expect(rows.find((row) => row.key === "engagement_type")?.value).toBe("Annual");
    expect(rows.find((row) => row.key === "languages")?.value).toBeNull();
  });

  it("treats whitespace as unfilled and trims what it keeps", () => {
    const rows = scopeRows(family, { turnaround: "  3–4 weeks  ", languages: "   " });
    expect(rows.find((row) => row.key === "turnaround")?.value).toBe("3–4 weeks");
    expect(rows.find((row) => row.key === "languages")?.value).toBeNull();
  });

  it("drops a family row the code has no value for, rather than rendering it empty for ever", () => {
    const withGhost = [...family, { key: "capacity", label: "Capacity", position: 9, filterable: false }];
    const keys: readonly string[] = scopeRows(withGhost, {}).map((row) => row.key);
    expect(keys).not.toContain("capacity");
  });

  it("counts what is filled, for the sentence under the table", () => {
    const rows = scopeRows(family, { engagement_type: "Annual", fee_basis: "Fixed fee" });
    expect(rowsFilled(rows)).toBe(2);
  });

  it("marks turnaround unfilterable, whatever the render says", () => {
    /*
       The board's own rule: "a row only becomes filterable when its values are
       enumerable across the family". "24/7 callout, 4-hour attendance" and
       "3–4 weeks from complete records" are both right and neither is a facet
       value. The spec's prose says five filterable rows; its render marks six;
       the rule settles it.
    */
    const rows = scopeRows(family, {});
    expect(rows.filter((row) => row.filterable)).toHaveLength(5);
    expect(rows.find((row) => row.key === "turnaround")?.filterable).toBe(false);
  });
});

describe("the public path segment", () => {
  it("derives a readable slug from the name", () => {
    expect(serviceSlug("Statutory audit")).toBe("statutory-audit");
    expect(serviceSlug("Hard FM & MEP maintenance")).toBe("hard-fm-mep-maintenance");
    expect(serviceSlug("Fire & life safety inspection")).toBe("fire-life-safety-inspection");
  });

  it("falls back rather than producing an empty path segment", () => {
    // A name in Arabic alone is a real case, and an empty segment is a 404.
    expect(serviceSlug("التدقيق")).toBe("service");
    expect(serviceSlug("   ")).toBe("service");
  });

  it("de-duplicates within one business, because two firms may share a name", () => {
    expect(uniqueServiceSlug("Statutory audit", [])).toBe("statutory-audit");
    expect(uniqueServiceSlug("Statutory audit", ["statutory-audit"])).toBe("statutory-audit-2");
    expect(uniqueServiceSlug("Statutory audit", ["statutory-audit", "statutory-audit-2"])).toBe(
      "statutory-audit-3",
    );
  });
});
