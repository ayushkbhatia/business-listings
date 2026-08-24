import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * A `"use server"` module may only export async functions.
 *
 * Everything such a module exports becomes a callable endpoint, so Next
 * refuses anything else — but it refuses at *module evaluation*, not at build.
 * A const array exported from an action file therefore passes `next build`,
 * ships, and fails on the first request that touches the page.
 *
 * That has now happened twice in this handoff. This is the check that stops a
 * third time, and it runs in the unit suite where it costs nothing.
 */
/** Every .ts under app/, walked by hand — node:fs globSync is not in this typings version. */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return entry.isFile() && path.endsWith(".ts") ? [path] : [];
  });
}

const ACTION_FILES = walk("app").filter((file) =>
  /^\s*["']use server["']/.test(readFileSync(file, "utf8")),
);

describe("every \"use server\" module", () => {
  it("has action files to check", () => {
    expect(ACTION_FILES.length).toBeGreaterThan(0);
  });

  for (const file of ACTION_FILES) {
    it(`${file} exports only async functions and types`, () => {
      const source = readFileSync(file, "utf8");
      const offenders: string[] = [];

      for (const line of source.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("export")) continue;
        // Types and interfaces are erased and never become endpoints.
        if (/^export\s+(type|interface)\b/.test(trimmed)) continue;
        if (/^export\s+\{[^}]*\}\s+from\b/.test(trimmed) && /\btype\b/.test(trimmed)) continue;
        if (/^export\s+async\s+function\b/.test(trimmed)) continue;
        offenders.push(trimmed);
      }

      expect(
        offenders,
        `${file} exports something that is not an async function:\n  ${offenders.join("\n  ")}`,
      ).toEqual([]);
    });
  }
});
