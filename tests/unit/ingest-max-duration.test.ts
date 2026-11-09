import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Task T4.6 — every segment of the importer declares how long it may live.
 *
 * Six screens and one export, each able to touch forty thousand records:
 * staging a register export, publishing a run, continuing one the chunk loop
 * did not finish, categorising a queue group, rescanning the directory for
 * pairs, exporting a run's rejects. Not one of them declared a duration, so
 * each inherited the platform's default — and a function killed mid-run is
 * what T4.2's chunked transactions and resumable cursor exist to survive.
 * Surviving it is not a reason to keep provoking it.
 *
 * A test rather than a `check:` script because the rule is about one directory
 * and the honest check is three lines. What it is really for is the **next**
 * screen: a seventh page added to the importer inherits the default silently,
 * and this is the thing that says so.
 *
 * `maxDuration` on a page sets the ceiling for every Server Action called from
 * it — Next's own note in `route-segment-config/maxDuration` — which is why
 * this asserts on pages rather than hunting for action files.
 */

const ROOT = "app/(admin)/admin/ingest";

/** Every `page.tsx` and `route.ts` under the importer. */
function segments(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...segments(path));
      continue;
    }
    if (entry === "page.tsx" || entry === "route.ts") out.push(path);
  }
  return out.sort();
}

describe("T4.6 — the importer's segments declare a duration", () => {
  it("finds the screens it is about", () => {
    // A guard on the guard: a test that silently found nothing would pass
    // forever. Six screens and one export at the time of writing.
    expect(segments(ROOT).length).toBeGreaterThanOrEqual(6);
  });

  for (const path of segments(ROOT)) {
    it(`${path.slice(ROOT.length + 1)} declares maxDuration`, () => {
      const source = readFileSync(path, "utf8");
      const match = /export const maxDuration = (\d+)/.exec(source);
      expect(match, "an ingest segment with no maxDuration inherits the default").not.toBeNull();
      /*
         And it is a real ceiling, not a token one. Three hundred is this
         project's plan limit; anything under a minute would be below what a
         41,000-row run measures at, which is a declaration that reads as a
         decision and behaves like the default.
       */
      expect(Number(match?.[1] ?? 0)).toBeGreaterThanOrEqual(60);
    });
  }
});
