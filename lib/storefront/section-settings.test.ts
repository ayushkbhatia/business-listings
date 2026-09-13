import { describe, expect, it } from "vitest";
import { SECTION_TYPES } from "./section-types";
import {
  checkSettings,
  DEFAULT_SETTINGS,
  isConfigurable,
  readSettings,
  SETTING_CONTROLS,
} from "./section-settings";

/**
 * Board `5c-s` B2 and B4, criterion 3: the live services sections take
 * configuration and no content, and no setting can hold a word.
 */

describe("what editing a live section means", () => {
  it("configures three services sections and nothing else", () => {
    expect(SECTION_TYPES.filter((type) => isConfigurable(type.key)).map((type) => type.key)).toEqual([
      "scope_grid",
      "credential_wall",
      "coverage",
    ]);
    // Sectors served is display only.
    expect(isConfigurable("sectors_served")).toBe(false);
  });

  it("offers only closed lists — there is no control a person could type into (B4)", () => {
    for (const controls of Object.values(SETTING_CONTROLS)) {
      for (const control of controls) {
        expect(["choice", "columns"]).toContain(control.kind);
        expect(control.options.length).toBeGreaterThan(1);
      }
    }
  });

  it("opens the scope grid on the two columns the board draws", () => {
    expect(readSettings("scope_grid", {})).toEqual({ columns: ["fee_basis", "turnaround"] });
    expect(DEFAULT_SETTINGS.credential_wall.show).toBe("all");
    expect(DEFAULT_SETTINGS.coverage.rows).toBe("per_service");
  });
});

describe("reading stored settings", () => {
  it("keeps the chosen order — reorder yes (Q2)", () => {
    expect(readSettings("scope_grid", { columns: ["turnaround", "engagement", "fee_basis"] }).columns).toEqual([
      "turnaround",
      "engagement",
      "fee_basis",
    ]);
  });

  it("drops what is not an option rather than rendering it", () => {
    expect(readSettings("scope_grid", { columns: ["Price", "fee_basis", "fee_basis"] }).columns).toEqual([
      "fee_basis",
    ]);
    expect(readSettings("scope_grid", { columns: ["Our rates"] }).columns).toEqual(["fee_basis", "turnaround"]);
    expect(readSettings("credential_wall", { show: "everything" }).show).toBe("all");
    expect(readSettings("coverage", "not an object").rows).toBe("per_service");
  });
});

describe("writing settings", () => {
  it("accepts a valid set", () => {
    expect(checkSettings("scope_grid", { columns: ["engagement", "delivered"] })).toBeNull();
    expect(checkSettings("credential_wall", { show: "verified" })).toBeNull();
    expect(checkSettings("coverage", { rows: "union" })).toBeNull();
  });

  it("refuses a rename, a label, any string that is not an option — rename no (Q2)", () => {
    expect(checkSettings("scope_grid", { columns: ["fee_basis"], labels: { fee_basis: "Fee from" } })).toBe(
      "unknown_setting",
    );
    expect(checkSettings("scope_grid", { columns: ["AED 5,000"] })).toBe("not_an_option");
    expect(checkSettings("credential_wall", { show: "only the good ones" })).toBe("not_an_option");
  });

  it("refuses an empty grid and a doubled column", () => {
    expect(checkSettings("scope_grid", { columns: [] })).toBe("no_columns");
    expect(checkSettings("scope_grid", { columns: ["turnaround", "turnaround"] })).toBe("not_an_option");
  });

  it("refuses settings on a section that has none", () => {
    expect(checkSettings("sectors_served", {})).toBe("not_configurable");
    expect(checkSettings("hero", { headline: "x" })).toBe("not_configurable");
  });
});
