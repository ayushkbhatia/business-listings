import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JOB_CRONS, JOB_SCHEDULES } from "@/lib/jobs/schedule";

/**
 * Standing item 9.5, held to the tree rather than to intent: `runSteps` is the
 * one writer of the run record, for every job behind it. A job that kept a
 * record of its own would be a second, differently shaped history of the same
 * run — and the first one to drift from the other.
 *
 * So: the tables are written in `lib/jobs/record.ts` and nowhere else; its
 * writers are called from the shared guard and nowhere else; and every job
 * route goes through that guard under its own cron's name.
 */

const ROOTS = ["app", "lib", "components", "scripts", "prisma"];

function files(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "generated" || entry === "migrations" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) files(path, out);
    else if (/\.(ts|tsx|mts|mjs)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

const source = ROOTS.flatMap((root) => files(root)).map((path) => ({ path, text: readFileSync(path, "utf8") }));

function calling(name: string): string[] {
  return source
    .filter((file) => file.path !== "lib/jobs/record.ts" && new RegExp(`\\b${name}\\(`).test(file.text))
    .map((file) => file.path)
    .sort();
}

describe("one writer of the run record", () => {
  it("writes job_run and job_run_step in lib/jobs/record.ts and nowhere else", () => {
    const writers = source
      .filter((file) => /\bjobRun(Step)?\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/.test(file.text))
      .map((file) => file.path);
    expect(writers).toEqual(["lib/jobs/record.ts"]);
  });

  it("is reached from the shared guard, and the retention sweep from the daily run", () => {
    for (const writer of ["openRun", "recordStep", "closeRun", "recordRefusal"]) {
      expect(calling(writer), writer).toEqual(["lib/jobs/authorize.ts"]);
    }
    expect(calling("pruneJobRuns")).toEqual(["app/api/jobs/daily/route.ts"]);
  });

  it("is not reachable from the console, which only reads it", () => {
    const console = source.filter((file) => file.path.startsWith("app/(admin)"));
    expect(console.filter((file) => /@\/lib\/jobs\/record/.test(file.text)).map((file) => file.path)).toEqual([]);
  });
});

describe("every job route goes through the guard under its own name", () => {
  it("guards and runs each cron as itself", () => {
    for (const cron of JOB_CRONS) {
      const route = readFileSync(`app${JOB_SCHEDULES[cron].path}/route.ts`, "utf8");
      expect(route, cron).toContain(`await authorizeJob(request, "${cron}")`);
      expect(route, cron).toContain(`runSteps("${cron}", {`);
      // The request goes in too, or the scheduler's header never reaches the row.
      expect(route, cron).toMatch(/\},\s*request\);/);
    }
  });

  it("has no job route outside the ones the schedule names", () => {
    expect(readdirSync("app/api/jobs").sort()).toEqual([...JOB_CRONS].sort());
  });
});
