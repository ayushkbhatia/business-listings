import { describe, expect, it } from "vitest";
import { catalogueCoverage, catalogueEntries } from "./coverage";
import { en } from "./en";

/**
 * Board 12g's localisation surface, which is a report rather than an editor.
 *
 * The catalogue is a TypeScript module and `t()` is typed against its keys —
 * that is what makes a missing string a build failure instead of a blank space
 * on a page. An editor writing strings at runtime would trade that guarantee
 * for the ability to fix a typo without a deploy.
 */

describe("what the catalogue holds", () => {
  it("counts every key exactly once", () => {
    const coverage = catalogueCoverage();
    expect(coverage.keys).toBe(Object.keys(en).length);
    expect(catalogueEntries()).toHaveLength(coverage.keys);
  });

  it("adds its sections back up to the whole", () => {
    const coverage = catalogueCoverage();
    const summed = coverage.sections.reduce((sum, section) => sum + section.keys, 0);
    expect(summed).toBe(coverage.keys);
    expect(coverage.sections.reduce((sum, s) => sum + s.words, 0)).toBe(coverage.words);
  });

  it("tells a plural object from a plain string", () => {
    const coverage = catalogueCoverage();
    const plurals = Object.values(en).filter((value) => typeof value !== "string").length;
    expect(coverage.plural).toBe(plurals);
    expect(coverage.plural).toBeGreaterThan(0);
  });

  it("counts the strings a translator has to keep placeholders in", () => {
    const coverage = catalogueCoverage();
    expect(coverage.interpolated).toBeGreaterThan(0);
    expect(coverage.interpolated).toBeLessThan(coverage.keys);
  });

  it("names the longest string, which is what a layout breaks on", () => {
    // Arabic and German both run longer than English, so the longest English
    // string is the one to check a layout against first.
    const coverage = catalogueCoverage();
    expect(coverage.longest.key).not.toBe("");
    expect(coverage.longest.words).toBeGreaterThan(20);
  });

  it("reports the locales that are configured, which is one", () => {
    expect(catalogueCoverage().locales).toEqual(["en"]);
  });

  it("sorts sections by size, so the biggest translation job is first", () => {
    const sections = catalogueCoverage().sections;
    for (let index = 1; index < sections.length; index += 1) {
      expect(sections[index - 1]!.keys).toBeGreaterThanOrEqual(sections[index]!.keys);
    }
  });
});

describe("the browser's entries", () => {
  it("joins a plural object rather than showing one half of it", () => {
    const plural = catalogueEntries().find((entry) => entry.plural)!;
    expect(plural.text).toContain("·");
  });

  it("flags the ones carrying placeholders", () => {
    const entry = catalogueEntries().find((candidate) => candidate.interpolated)!;
    expect(entry.text).toMatch(/\{[a-zA-Z0-9_]+\}/);
  });
});
