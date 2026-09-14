import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DAILY_JOB_UTC, nextDailyRun } from "@/lib/jobs/schedule";

/**
 * Board 12d B1 and B2, held to the tree rather than to intent.
 *
 * A task table is one `create` away from a manual-add field, and a manual add
 * is how the call list stops being a flywheel and becomes a spreadsheet. So:
 * exactly one file creates tasks, and the only files that close one are the
 * derivation (a signal cleared) and the call logger (a seller said no).
 */

const ROOTS = ["app", "lib", "components", "scripts"];

function files(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "generated" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) files(path, out);
    else if (/\.(ts|tsx|mts)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

const source = ROOTS.flatMap((root) => files(root)).map((path) => ({ path, text: readFileSync(path, "utf8") }));

describe("B1 — nobody types a task", () => {
  it("creates tasks in lib/crm/sync.ts and nowhere else", () => {
    const writers = source.filter((file) => /crmTask\.(create|createMany|upsert)\s*\(/.test(file.text)).map((file) => file.path);
    expect(writers).toEqual(["lib/crm/sync.ts"]);
  });

  it("closes tasks only in the derivation and the call logger", () => {
    const closers = source.filter((file) => /crmTask/.test(file.text) && /closedAt:\s*now/.test(file.text)).map((file) => file.path).sort();
    expect(closers).toEqual(["lib/crm/service.ts", "lib/crm/sync.ts"]);
  });

  it("offers no priority anybody could type — the score is written by the derivation alone", () => {
    // Files that write the table and set the score. A gallery fixture sets a
    // number on a plain object and writes nothing.
    const scorers = source
      .filter((file) => /crmTask\.(create|createMany|update|updateMany|upsert)\s*\(/.test(file.text) && /demandScore:\s*(?!true\b|"(?:asc|desc)")/.test(file.text))
      .map((file) => file.path);
    expect(scorers).toEqual(["lib/crm/sync.ts"]);
  });
});

describe("the schedule the empty list quotes", () => {
  it("matches the daily cron in vercel.json", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] };
    const daily = config.crons.find((cron) => cron.path === "/api/jobs/daily");
    expect(daily?.schedule).toBe(`${DAILY_JOB_UTC.minute} ${DAILY_JOB_UTC.hour} * * *`);
  });

  it("names the next run after now, never now", () => {
    expect(nextDailyRun(new Date("2026-09-14T08:00:00Z")).toISOString()).toBe("2026-09-14T20:23:00.000Z");
    expect(nextDailyRun(new Date("2026-09-14T20:23:00Z")).toISOString()).toBe("2026-09-15T20:23:00.000Z");
  });
});
