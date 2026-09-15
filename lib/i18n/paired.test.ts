import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { en } from "./en";
import {
  CODE_COPIES,
  copiesFrom,
  halfFor,
  PAIRED_STRINGS,
  pairedEntry,
  pairingCount,
  resolveHalf,
  type EntryRow,
} from "./paired";

/**
 * Board `12g-s` — the registry against the code that reads it, and the rules
 * that turn two halves and a row into words.
 */

const PLACEHOLDER = /\{([a-zA-Z0-9_]+)\}/g;
const placeholders = (text: string) => [...text.matchAll(PLACEHOLDER)].map((match) => match[1]!);

const row = (over: Partial<EntryRow> & Pick<EntryRow, "key" | "kind" | "state">): EntryRow => ({
  value: null,
  updatedAt: new Date("2026-09-15T08:00:00Z"),
  ...over,
});

describe("the registry (B4, B10)", () => {
  it("names each key once, and every half is a plain catalogue string", () => {
    const keys = PAIRED_STRINGS.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const entry of PAIRED_STRINGS) {
      expect(typeof en[entry.key], entry.key).toBe("string");
      if (entry.services !== "missing" && entry.services !== "suppressed") {
        expect(typeof en[entry.services], entry.services).toBe("string");
        expect(entry.services).not.toBe(entry.key);
      }
    }
  });

  it("is read by every file it names — a key no board reads is dead weight", () => {
    for (const entry of PAIRED_STRINGS) {
      expect(entry.consumers.length, entry.key).toBeGreaterThan(0);
      expect(entry.surfaces.length, entry.key).toBeGreaterThan(0);
      for (const file of entry.consumers) {
        const path = join(process.cwd(), file);
        expect(existsSync(path), file).toBe(true);
        expect(readFileSync(path, "utf8"), `${file} reads ${entry.key}`).toContain(`"${entry.key}"`);
      }
    }
  });

  it("declares exactly the placeholders its code defaults use", () => {
    for (const entry of PAIRED_STRINGS) {
      const used = new Set(placeholders(en[entry.key] as string));
      if (entry.services !== "missing" && entry.services !== "suppressed") {
        for (const name of placeholders(en[entry.services] as string)) used.add(name);
      }
      expect([...used].sort(), entry.key).toEqual([...entry.params].sort());
    }
  });

  it("offers suppression only where the code default is suppressed", () => {
    for (const entry of PAIRED_STRINGS) {
      expect(entry.suppressible, entry.key).toBe(entry.services === "suppressed");
    }
  });
});

describe("resolution (B2)", () => {
  const reviews = pairedEntry("section.reviews.title")!;
  const missed = pairedEntry("overview.missed_body")!;
  const csv = pairedEntry("change.row.csv_import")!;

  it("reads the code default for each half when nobody has decided", () => {
    expect(resolveHalf(reviews, "goods", [])).toEqual({ state: "written", template: "What buyers said", source: "code" });
    expect(resolveHalf(reviews, "services", [])).toEqual({ state: "written", template: "What clients said", source: "code" });
  });

  it("renders the goods words for a missing half — never blank — and null for a suppressed one", () => {
    expect(resolveHalf(missed, "services", [])).toMatchObject({ state: "missing", template: en["overview.missed_body"] });
    expect(resolveHalf(csv, "services", [])).toEqual({ state: "suppressed", template: null, source: "code" });
    expect(resolveHalf(csv, "goods", [])).toMatchObject({ state: "written", template: "CSV import" });
  });

  it("lets a staff row override either half, and never suppresses a control the registry does not allow", () => {
    const rows = [
      row({ key: "overview.missed_body", kind: "services", state: "written", value: "{n} enquiries matched your services" }),
      row({ key: "section.reviews.title", kind: "services", state: "suppressed" }),
      row({ key: "section.reviews.title", kind: "goods", state: "written", value: "What buyers wrote" }),
    ];
    expect(resolveHalf(missed, "services", rows)).toEqual({ state: "written", template: "{n} enquiries matched your services", source: "staff" });
    expect(resolveHalf(reviews, "services", rows).state).toBe("written");
    expect(resolveHalf(reviews, "goods", rows).template).toBe("What buyers wrote");
  });

  it("builds both halves for every key, as plain data", () => {
    expect(Object.keys(CODE_COPIES.goods).sort()).toEqual(PAIRED_STRINGS.map((entry) => entry.key).sort());
    expect(CODE_COPIES.services["change.row.csv_import"]).toBeNull();
    expect(JSON.parse(JSON.stringify(copiesFrom([])))).toEqual(CODE_COPIES);
  });

  it("picks the half from the business's own kind (B5)", () => {
    expect(halfFor("services")).toBe("services");
    expect(halfFor("both")).toBe("goods");
    expect(halfFor("unset")).toBe("goods");
  });
});

describe("the count (B3)", () => {
  it("is computed from the registry and the rows, and a written twin moves it", () => {
    const base = pairingCount([]);
    const missing = PAIRED_STRINGS.filter((entry) => entry.services === "missing").length;
    const suppressed = PAIRED_STRINGS.filter((entry) => entry.services === "suppressed").length;
    expect(base).toMatchObject({ total: PAIRED_STRINGS.length, unpaired: missing, paired: PAIRED_STRINGS.length - missing, suppressed, staffDecisions: 0, lastDecidedAt: null });

    const at = new Date("2026-09-15T09:30:00Z");
    const after = pairingCount([row({ key: "overview.missed_body", kind: "services", state: "written", value: "x", updatedAt: at.toISOString() })]);
    expect(after.unpaired).toBe(missing - 1);
    expect(after.staffDecisions).toBe(1);
    expect(after.lastDecidedAt).toEqual(at);
  });

  it("ignores a row for a key the registry does not declare", () => {
    expect(pairingCount([row({ key: "nothing.here", kind: "services", state: "written", value: "x" })]).staffDecisions).toBe(0);
  });
});
