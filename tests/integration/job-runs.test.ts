import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as sweep } from "@/app/api/jobs/sweep/route";
import { prisma } from "@/lib/db/client";
import { authorizeJob, runSteps } from "@/lib/jobs/authorize";
import { JOB_RUN_KEEP_DAYS } from "@/lib/jobs/health";
import { pruneJobRuns, refusalHour, stepRecord } from "@/lib/jobs/record";
import { jobsNeedingAttention, jobsOverview, refusedCalls, runDetail, runHistory, stepFailures } from "@/lib/jobs/report";

/**
 * Standing item 9.5 against a real Postgres: what `runSteps` writes, and that
 * the writing is never what costs the run.
 *
 * Every row this file makes is removed at the end. Files run one at a time
 * (`fileParallelism: false`), so the only writer of `job_run` meanwhile is this
 * file — which also means the "latest run" assertions below can trust that the
 * run they just made is the latest one.
 */

const suiteStart = new Date();
const SECRET = "job-runs-test-cron-secret";
let originalSecret: string | undefined;

beforeEach(() => {
  originalSecret = process.env["CRON_SECRET"];
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalSecret === undefined) delete process.env["CRON_SECRET"];
  else process.env["CRON_SECRET"] = originalSecret;
});

afterAll(async () => {
  await prisma.jobRun.deleteMany({ where: { startedAt: { gte: suiteStart } } });
  await prisma.jobRun.deleteMany({ where: { id: { startsWith: "job-runs-test-" } } });
});

async function recorded(runId: string) {
  return prisma.jobRun.findUniqueOrThrow({
    where: { id: runId },
    include: { steps: { orderBy: [{ position: "asc" }, { name: "asc" }] } },
  });
}

describe("a failed step is recorded as failed, and the rest of the run still lands", () => {
  it("writes the run, every step in order, the message the failure threw, and the verdict", async () => {
    const ran: string[] = [];
    const outcome = await runSteps("daily", {
      first: async () => {
        ran.push("first");
        return { considered: 6, renewed: 0, ranAt: new Date("2026-09-23T20:23:28.703Z") };
      },
      second: async () => {
        ran.push("second");
        throw new Error("renewal gateway refused billing@example.ae");
      },
      third: async () => {
        ran.push("third");
        return 0;
      },
    });

    // The steps behave exactly as they did before anything was recorded.
    expect(ran).toEqual(["first", "second", "third"]);
    expect(outcome.ok).toBe(false);
    expect(outcome.steps["second"]).toEqual({ ok: false, error: "renewal gateway refused billing@example.ae" });

    const run = await recorded(outcome.runId);
    expect(run).toMatchObject({ cron: "daily", authorised: true, ok: false, planned: ["first", "second", "third"] });
    expect(run.finishedAt).not.toBeNull();
    expect(run.finishedAt!.getTime()).toBeGreaterThanOrEqual(run.startedAt.getTime());

    expect(run.steps.map((step) => [step.name, step.position, step.ok])).toEqual([
      ["first", 0, true],
      ["second", 1, false],
      ["third", 2, true],
    ]);
    const [first, second, third] = run.steps;
    expect(first?.result).toEqual({ considered: 6, renewed: 0, ranAt: "2026-09-23T20:23:28.703Z" });
    // The stored message masks the address; the response and the log keep it.
    expect(second?.error).toBe("renewal gateway refused [email]");
    expect(second?.result).toBeNull();
    // A step that returned zero returned an answer, and the answer is kept.
    expect(third?.result).toBe(0);
  });

  it("is read back by the screen's own queries as a failed run with one failing step", async () => {
    const outcome = await runSteps("sweep", {
      steady: async () => ({ sent: 0 }),
      flaky: async () => {
        throw new Error("carrier timed out");
      },
    });

    const detail = await runDetail(outcome.runId);
    expect(detail?.steps.map((row) => row.state)).toEqual(["ok", "failed"]);

    const history = await runHistory("sweep", null, null);
    const newest = history.rows.find((row) => row.kind === "run");
    expect(newest?.kind === "run" && newest.run.id).toBe(outcome.runId);
    expect(newest?.kind === "run" && newest.failed).toEqual(["flaky"]);

    const failures = await stepFailures("sweep");
    expect(failures.find((failure) => failure.name === "flaky")).toMatchObject({
      lastError: "carrier timed out",
      lastRunId: outcome.runId,
    });

    const overview = await jobsOverview();
    const sweepSummary = overview.crons.find((entry) => entry.schedule.cron === "sweep");
    expect(sweepSummary?.health).toMatchObject({ state: "ran", lastState: "failed" });
    expect(sweepSummary?.attention).toBe(true);
    expect(await jobsNeedingAttention()).toBeGreaterThanOrEqual(1);
  });
});

describe("the write is never what loses the run", () => {
  it("writes the whole run at the end when its start could not be written", async () => {
    vi.spyOn(prisma.jobRun, "create").mockRejectedValueOnce(new Error("pooler dropped the connection"));
    const outcome = await runSteps("sweep", {
      one: async () => 1,
      two: async () => 2,
    });

    expect(outcome.ok).toBe(true);
    const run = await recorded(outcome.runId);
    expect(run.ok).toBe(true);
    expect(run.finishedAt).not.toBeNull();
    expect(run.steps.map((step) => [step.name, step.result])).toEqual([
      ["one", 1],
      ["two", 2],
    ]);
  });

  it("retries a step whose row did not land, at the close", async () => {
    vi.spyOn(prisma.jobRunStep, "create").mockRejectedValueOnce(new Error("statement timeout"));
    const outcome = await runSteps("sweep", {
      lost: async () => ({ flushed: 3 }),
      kept: async () => ({ flushed: 0 }),
    });

    const run = await recorded(outcome.runId);
    expect(run.steps.map((step) => [step.name, step.ok, step.result])).toEqual([
      ["lost", true, { flushed: 3 }],
      ["kept", true, { flushed: 0 }],
    ]);
  });

  it("still records the finish when a step's row can never be written", async () => {
    // A row the database refuses every time must cost that row, not the finish:
    // without the finish, a run that ended reads as one that stopped.
    const refused = new Error("new row violates check constraint");
    vi.spyOn(prisma.jobRunStep, "create").mockRejectedValue(refused);
    vi.spyOn(prisma.jobRunStep, "createMany").mockRejectedValue(refused);
    const outcome = await runSteps("sweep", { only: async () => ({ sent: 0 }) });

    vi.restoreAllMocks();
    const run = await recorded(outcome.runId);
    expect(run.ok).toBe(true);
    expect(run.finishedAt).not.toBeNull();
    expect(run.steps).toHaveLength(0);
    expect(run.planned).toEqual(["only"]);
  });

  it("never makes a row the database refuses when the clock steps back mid-step", () => {
    const startedAt = new Date("2026-09-24T10:42:05.000Z");
    const record = stepRecord({
      name: "escalations",
      position: 0,
      startedAt,
      finishedAt: new Date("2026-09-24T10:42:04.200Z"),
      outcome: { ok: true, result: { considered: 0 } },
    });
    expect(record.finishedAt).toEqual(startedAt);
  });

  it("runs every step and returns every outcome when no write succeeds at all", async () => {
    const down = new Error("database unreachable");
    vi.spyOn(prisma.jobRun, "create").mockRejectedValue(down);
    vi.spyOn(prisma.jobRun, "upsert").mockRejectedValue(down);
    vi.spyOn(prisma.jobRun, "update").mockRejectedValue(down);
    vi.spyOn(prisma.jobRunStep, "create").mockRejectedValue(down);
    vi.spyOn(prisma.jobRunStep, "createMany").mockRejectedValue(down);

    const ran: string[] = [];
    const outcome = await runSteps("daily", {
      renewals: async () => {
        ran.push("renewals");
        return { renewed: 0 };
      },
      dunning: async () => {
        ran.push("dunning");
        throw new Error("gateway down");
      },
      nudges: async () => {
        ran.push("nudges");
        return { nudged: 0 };
      },
    });

    expect(ran).toEqual(["renewals", "dunning", "nudges"]);
    expect(outcome.ok).toBe(false);
    expect(outcome.steps).toEqual({
      renewals: { ok: true, result: { renewed: 0 } },
      dunning: { ok: false, error: "gateway down" },
      nudges: { ok: true, result: { nudged: 0 } },
    });
    vi.restoreAllMocks();
    expect(await prisma.jobRun.findUnique({ where: { id: outcome.runId } })).toBeNull();
  });
});

describe("the route records its own run", () => {
  it("writes the sweep's run with every step it planned and the scheduler's expression", async () => {
    process.env["CRON_SECRET"] = SECRET;
    const response = await sweep(
      new NextRequest("https://businesslistings.me/api/jobs/sweep", {
        headers: {
          authorization: `Bearer ${SECRET}`,
          "user-agent": "vercel-cron/1.0",
          "x-vercel-cron-schedule": "42 * * * *",
        },
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { runId: string; steps: Record<string, unknown> };

    const run = await recorded(body.runId);
    expect(run).toMatchObject({ cron: "sweep", authorised: true, ok: true, schedule: "42 * * * *" });
    expect(run.planned).toEqual(Object.keys(body.steps));
    expect(run.steps.map((step) => step.name)).toEqual(run.planned);
  }, 30_000);
});

describe("a refused call is recorded when it is the schedule being refused", () => {
  function call(headers: Record<string, string>) {
    return new NextRequest("https://businesslistings.me/api/jobs/daily", { headers });
  }
  const thisHour = () => refusalHour(new Date());

  beforeEach(async () => {
    // The key is one row per cron per hour; start the hour clean.
    await prisma.jobRun.deleteMany({ where: { authorised: false, refusedHour: thisHour() } });
  });

  it("records every call while the secret is unset, once an hour", async () => {
    delete process.env["CRON_SECRET"];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await authorizeJob(call({}), "daily");
      expect(response?.status).toBe(500);
    }
    const rows = await prisma.jobRun.findMany({ where: { cron: "daily", authorised: false, refusedHour: thisHour() } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ refusal: "no_secret", ok: null, planned: [] });

    const log = await refusedCalls("daily");
    expect(log.rows[0]?.refusal).toBe("no_secret");
  });

  it("records a wrong secret from the scheduler, and nothing for a stranger guessing", async () => {
    process.env["CRON_SECRET"] = SECRET;

    const stranger = await authorizeJob(call({ authorization: "Bearer guess" }), "daily");
    expect(stranger?.status).toBe(401);
    expect(await prisma.jobRun.count({ where: { cron: "daily", authorised: false, refusedHour: thisHour() } })).toBe(0);

    const scheduler = await authorizeJob(
      call({ authorization: "Bearer stale", "user-agent": "vercel-cron/1.0", "x-vercel-cron-schedule": "23 20 * * *" }),
      "daily",
    );
    expect(scheduler?.status).toBe(401);
    const rows = await prisma.jobRun.findMany({ where: { cron: "daily", authorised: false, refusedHour: thisHour() } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ refusal: "wrong_secret", schedule: "23 20 * * *" });
  });

  it("keeps nothing of a header that is not a cron expression", async () => {
    process.env["CRON_SECRET"] = SECRET;
    await authorizeJob(
      call({ authorization: "Bearer stale", "user-agent": "vercel-cron/1.0", "x-vercel-cron-schedule": "<b>hi</b>" }),
      "daily",
    );
    const row = await prisma.jobRun.findFirst({
      where: { cron: "daily", authorised: false, refusedHour: thisHour() },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    });
    expect(row?.schedule).toBeNull();
  });
});

describe("retention", () => {
  it("deletes runs past the window with their steps, and keeps the rest", async () => {
    const day = 86_400_000;
    const old = new Date(Date.now() - (JOB_RUN_KEEP_DAYS + 1) * day);
    const recent = new Date(Date.now() - (JOB_RUN_KEEP_DAYS - 1) * day);
    for (const [id, startedAt] of [
      ["job-runs-test-old", old],
      ["job-runs-test-recent", recent],
    ] as const) {
      await prisma.jobRun.create({
        data: {
          id,
          cron: "daily",
          startedAt,
          finishedAt: startedAt,
          ok: true,
          authorised: true,
          planned: ["only"],
          steps: { create: { name: "only", position: 0, startedAt, finishedAt: startedAt, ok: true } },
        },
      });
    }

    const pruned = await pruneJobRuns(new Date(Date.now() - JOB_RUN_KEEP_DAYS * day));
    expect(pruned).toBeGreaterThanOrEqual(1);
    expect(await prisma.jobRun.findUnique({ where: { id: "job-runs-test-old" } })).toBeNull();
    expect(await prisma.jobRunStep.count({ where: { runId: "job-runs-test-old" } })).toBe(0);
    expect(await prisma.jobRun.findUnique({ where: { id: "job-runs-test-recent" } })).not.toBeNull();
  });
});
