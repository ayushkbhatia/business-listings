import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasMessage } from "@/lib/i18n";
import {
  NULLABLE_PLAN_FIELDS,
  PLAN_FIELDS,
  SWITCH_PLAN_FIELDS,
  planFieldSpec,
} from "@/lib/plan/plan-fields";

/**
 * Board 12e `B1` — this config is the single writer, and the census is how that
 * stays true.
 *
 * The defect it guards has happened three times on this one table. `storageMb`
 * had a column, a snapshot key, a meter on `3m`, a row on `11f` and an
 * enforcement point in the media library, and no way to set it.
 * `publicPhotoLimit` was the same. `serviceLimit` had a box on the screen and
 * was missing from the action that read the form back, so a staff member typed
 * the services cap, pressed Save, and was told nothing had changed.
 *
 * So every configurable column on `Plan` is either on this list or exempt here
 * with a reason a reader can argue with. A new column that is neither fails
 * this test on the day it is added, which is the only day it is cheap.
 */

const schema = readFileSync("prisma/schema.prisma", "utf8");
const planBody = /^model Plan \{([\s\S]*?)^\}/m.exec(schema)![1]!;

/** Every scalar column on `Plan`, from the schema text. */
const columns = planBody
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line !== "" && !line.startsWith("//") && !line.startsWith("///") && !line.startsWith("@@"))
  .map((line) => line.split(/\s+/))
  .filter(([, type]) => type !== undefined && /^(String|Int|Float|Boolean|DateTime|Decimal)\??$/.test(type))
  .map(([name]) => name!);

/**
 * Columns the console deliberately does not edit, each with its reason.
 *
 * `rankingMultiplier` is the load-bearing one, and it is board 12e correction
 * 1: `12c` ships six integers that always total 100 with plan tier as one of
 * them and `PLAN_TIER_CEILING = 10` enforced server-side, so an editable
 * multiplier in billing ops would be a second writer for a model whose single
 * source is `lib/search/ranking.ts`.
 */
const NOT_EDITED: Record<string, string> = {
  id: "The plan's identity. It reaches a URL and a seed; it is set once, at creation.",
  name: "Set at creation. Renaming a plan a seller is on is a commercial decision with its own notice.",
  sortOrder: "The order the ladder renders in. Set at creation, from the plan it was added after.",
  rankingMultiplier:
    "Board 12e B2: no ranking field on this screen. Plan tier is one of 12c's six weights, capped at 10, and 12c is its only home.",
  withdrawnAt:
    "Written as an intent rather than a date — the On sale row posts a boolean and the service stamps the day, so re-saving a withdrawn plan keeps the date it was withdrawn on.",
};

describe("the plan config census", () => {
  it("edits every column on Plan that is not exempt with a reason", () => {
    const edited = new Set<string>(PLAN_FIELDS.map((spec) => spec.field));
    const unaccounted = columns.filter((name) => !edited.has(name) && !(name in NOT_EDITED));
    expect(unaccounted).toEqual([]);
  });

  it("exempts nothing that does not exist", () => {
    for (const name of Object.keys(NOT_EDITED)) expect(columns).toContain(name);
  });

  it("names a real column for every field it draws", () => {
    for (const spec of PLAN_FIELDS) expect(columns).toContain(spec.field);
  });

  it("gives every exemption a reason somebody could argue with", () => {
    for (const [name, why] of Object.entries(NOT_EDITED)) {
      expect(why.length, name).toBeGreaterThan(40);
    }
  });
});

describe("what a cell may be", () => {
  it("has a translated label for every field", () => {
    for (const spec of PLAN_FIELDS) expect(hasMessage(spec.labelKey), spec.field).toBe(true);
  });

  it("says what an empty cell means, wherever one is legal", () => {
    /*
       `B6`, and the reason the empty clause is per field rather than one hint.
       An empty `productLimit` is unlimited; an empty `annualMonthsCharged` is a
       plan not sold by the year; an empty `teamSeats` is not a state at all. A
       single "empty means unlimited" would have been wrong on two of the three.
    */
    for (const spec of PLAN_FIELDS) {
      if (spec.empty === null) continue;
      expect(hasMessage(spec.empty.labelKey), spec.field).toBe(true);
      expect(hasMessage(spec.empty.hintKey), spec.field).toBe(true);
    }
  });

  it("keeps seats and the price out of the nullable list", () => {
    // A plan with unlimited seats is a plan with no seat pricing, which is a
    // commercial decision and not a field. A plan with no price is not a free
    // plan — Free is nought, which is a number somebody chose.
    expect(NULLABLE_PLAN_FIELDS).not.toContain("teamSeats");
    expect(NULLABLE_PLAN_FIELDS).not.toContain("monthlyPriceAed");
    expect(planFieldSpec("teamSeats")!.empty).toBeNull();
    expect(planFieldSpec("monthlyPriceAed")!.empty).toBeNull();
  });

  it("draws the four on/off entitlements 11f compares plans on", () => {
    expect([...SWITCH_PLAN_FIELDS].sort()).toEqual([
      "analytics",
      "csvImport",
      "customDomain",
      "sponsoredEligible",
    ]);
  });

  it("carries no ranking field", () => {
    expect(planFieldSpec("rankingMultiplier")).toBeNull();
  });
});
