import { describe, expect, it } from "vitest";
import {
  RUN_CEILING_MS,
  cronHealth,
  failedSteps,
  historyRows,
  needsAttention,
  runState,
  runTally,
  standingRefusal,
  stepRows,
  type RecordedStep,
  type RunDigest,
} from "@/lib/jobs/health";
import { JOB_SCHEDULES } from "@/lib/jobs/schedule";

/**
 * Standing item 9.5 — what the record says, held to the cases the screen was
 * built for. Dates are UTC; the daily fires at 20:23 UTC, 00:23 in Dubai, so
 * "Tuesday's run" is the one that started at 20:23 on Monday UTC.
 */

const daily = JOB_SCHEDULES.daily;
const sweep = JOB_SCHEDULES.sweep;
const MIN = 60_000;

function run(startedAt: string, extra: Partial<RunDigest> = {}): RunDigest {
  const start = new Date(startedAt);
  return {
    id: `run-${startedAt}`,
    cron: "daily",
    startedAt: start,
    finishedAt: new Date(start.getTime() + 5_000),
    ok: true,
    schedule: "23 20 * * *",
    planned: ["renewals", "dunning"],
    steps: [
      { name: "renewals", ok: true },
      { name: "dunning", ok: true },
    ],
    ...extra,
  };
}

describe("the nightly has not run since Tuesday", () => {
  // Tue 22 Sep, 00:23 Dubai. Read on Thursday morning, 10:00 Dubai.
  const tuesday = run("2026-09-21T20:23:26Z");
  const now = new Date("2026-09-24T06:00:00Z");

  it("counts the two nights that are missing, and says when the first was due", () => {
    const health = cronHealth({ schedule: daily, last: tuesday, recordingSince: new Date("2026-09-01T00:00:00Z"), now });
    expect(health.state).toBe("ran");
    if (health.state !== "ran") return;
    expect(health.missed).toEqual({
      count: 2,
      first: new Date("2026-09-22T20:23:00Z"),
      last: new Date("2026-09-23T20:23:00Z"),
    });
    expect(health.lastState).toBe("ok");
    expect(needsAttention(health)).toBe(true);
  });

  it("is on schedule when the last night's run happened, even a minute late", () => {
    const lastNight = run("2026-09-23T20:24:10Z");
    const health = cronHealth({ schedule: daily, last: lastNight, recordingSince: null, now });
    expect(health.state === "ran" && health.missed).toBe(null);
    expect(needsAttention(health)).toBe(false);
  });

  it("does not call tonight's run missing until its grace has run out", () => {
    const lastNight = run("2026-09-23T20:23:05Z");
    const justDue = new Date("2026-09-24T20:52:00Z");
    const pastGrace = new Date("2026-09-24T20:54:00Z");
    expect(cronHealth({ schedule: daily, last: lastNight, recordingSince: null, now: justDue })).toMatchObject({ missed: null });
    expect(cronHealth({ schedule: daily, last: lastNight, recordingSince: null, now: pastGrace })).toMatchObject({
      missed: { count: 1, first: new Date("2026-09-24T20:23:00Z") },
    });
  });

  it("counts a run started by hand for the slot it falls in, not the one after", () => {
    // Started at noon Dubai on Thursday: it did Wednesday night's work, and
    // Thursday night's scheduled run is still owed at 20:23.
    const byHand = run("2026-09-24T08:00:00Z", { schedule: null });
    const late = new Date("2026-09-24T21:00:00Z");
    expect(cronHealth({ schedule: daily, last: byHand, recordingSince: null, now: late })).toMatchObject({
      missed: { count: 1, first: new Date("2026-09-24T20:23:00Z") },
    });
  });
});

describe("a cron with no run", () => {
  const now = new Date("2026-09-24T12:00:00Z");

  it("claims nothing when nothing at all is recorded", () => {
    const health = cronHealth({ schedule: daily, last: null, recordingSince: null, now });
    expect(health).toEqual({ state: "no_record" });
    expect(needsAttention(health)).toBe(false);
  });

  it("is missing every slot since the record went live", () => {
    // The sweep wrote the first row on Monday; the daily has never followed.
    const health = cronHealth({ schedule: daily, last: null, recordingSince: new Date("2026-09-21T10:42:00Z"), now });
    expect(health).toMatchObject({ state: "never", missed: { count: 3, first: new Date("2026-09-21T20:23:00Z") } });
    expect(needsAttention(health)).toBe(true);
  });

  it("is not late before its first slot has come round", () => {
    const health = cronHealth({ schedule: daily, last: null, recordingSince: new Date("2026-09-24T10:42:00Z"), now });
    expect(health).toMatchObject({ state: "never", missed: null });
    expect(needsAttention(health)).toBe(false);
  });
});

describe("what became of a run", () => {
  const now = new Date("2026-09-24T12:00:00Z");

  it("is running inside the ceiling and unfinished past it", () => {
    const going = { startedAt: new Date(now.getTime() - 5 * MIN), finishedAt: null, ok: null };
    const stopped = { startedAt: new Date(now.getTime() - RUN_CEILING_MS), finishedAt: null, ok: null };
    expect(runState(going, now)).toBe("running");
    expect(runState(stopped, now)).toBe("unfinished");
  });

  it("takes the runner's verdict once finished", () => {
    expect(runState({ startedAt: now, finishedAt: now, ok: false }, now)).toBe("failed");
    expect(runState({ startedAt: now, finishedAt: now, ok: true }, now)).toBe("ok");
  });

  it("wants attention when the latest run failed or never finished, and not while it runs", () => {
    const failed = run("2026-09-24T11:42:05Z", { ok: false, steps: [{ name: "renewals", ok: false }, { name: "dunning", ok: true }] });
    const stopped = run("2026-09-24T11:30:00Z", { finishedAt: null, ok: null, steps: [{ name: "renewals", ok: true }] });
    const going = run("2026-09-24T11:55:00Z", { finishedAt: null, ok: null, steps: [] });
    const at = (last: RunDigest) => needsAttention(cronHealth({ schedule: sweep, last, recordingSince: null, now }));
    expect(at(failed)).toBe(true);
    expect(at(stopped)).toBe(true);
    expect(at(going)).toBe(false);
  });

  it("tallies from the rows, and counts a planned step with no row as unrecorded", () => {
    const partial = run("2026-09-24T11:42:05Z", {
      planned: ["a", "b", "c", "d"],
      steps: [
        { name: "a", ok: true },
        { name: "b", ok: false },
        { name: "c", ok: true },
      ],
    });
    expect(runTally(partial)).toEqual({ planned: 4, ok: 2, failed: 1, unrecorded: 1 });
    expect(failedSteps(partial)).toEqual(["b"]);
  });
});

describe("a refusal beside a cron", () => {
  const now = new Date("2026-09-24T12:00:00Z");

  it("stands while nothing has run since it, and is answered by a run after it", () => {
    const refusal = { at: new Date("2026-09-23T20:23:01Z"), refusal: "no_secret" as const };
    const before = cronHealth({ schedule: daily, last: run("2026-09-22T20:23:00Z"), recordingSince: null, now });
    const after = cronHealth({ schedule: daily, last: run("2026-09-23T21:00:00Z"), recordingSince: null, now });
    expect(standingRefusal(before, refusal)).toEqual(refusal);
    expect(standingRefusal(after, refusal)).toBe(null);
    expect(standingRefusal(after, null)).toBe(null);
  });
});

describe("a cron's history, with its gaps", () => {
  const now = new Date("2026-09-24T06:00:00Z");
  const thursday = run("2026-09-23T20:23:10Z");
  const tuesday = run("2026-09-21T20:23:05Z");
  const monday = run("2026-09-20T20:23:07Z");

  it("writes each missing night in as a row above the run before it", () => {
    const rows = historyRows({ cron: "daily", runs: [thursday, tuesday, monday], newerThanPage: null, recordingSince: null, now });
    expect(rows.map((row) => (row.kind === "run" ? row.run.id : `missed ${row.span.count}`))).toEqual([
      thursday.id,
      "missed 1",
      tuesday.id,
      monday.id,
    ]);
    const missed = rows[1];
    expect(missed?.kind === "missed" && missed.span.first).toEqual(new Date("2026-09-22T20:23:00Z"));
  });

  it("opens with the gap up to now when the newest run is late", () => {
    const rows = historyRows({ cron: "daily", runs: [tuesday], newerThanPage: null, recordingSince: null, now });
    expect(rows[0]).toMatchObject({ kind: "missed", span: { count: 2 } });
    expect(rows[1]).toMatchObject({ kind: "run" });
  });

  it("draws a gap at a page break once, on the page below it", () => {
    const first = historyRows({ cron: "daily", runs: [thursday], newerThanPage: null, recordingSince: null, now });
    const second = historyRows({ cron: "daily", runs: [tuesday, monday], newerThanPage: thursday.startedAt, recordingSince: null, now });
    expect(first.filter((row) => row.kind === "missed")).toHaveLength(0);
    expect(second[0]).toMatchObject({ kind: "missed", span: { count: 1 } });
  });

  it("reads two runs in one slot as two runs and no gap", () => {
    const duplicate = run("2026-09-23T20:23:40Z", { id: "duplicate" });
    const rows = historyRows({ cron: "daily", runs: [duplicate, thursday], newerThanPage: null, recordingSince: null, now });
    expect(rows.every((row) => row.kind === "run")).toBe(true);
  });

  it("draws a cron that never ran as its missing slots since the record went live", () => {
    const rows = historyRows({ cron: "sweep", runs: [], newerThanPage: null, recordingSince: new Date("2026-09-24T02:10:00Z"), now });
    // 02:42, 03:42 and 04:42 are due by 06:00 less the grace; 05:42 is not.
    expect(rows).toEqual([
      { kind: "missed", span: { count: 3, first: new Date("2026-09-24T02:42:00Z"), last: new Date("2026-09-24T04:42:00Z") } },
    ]);
    expect(historyRows({ cron: "sweep", runs: [], newerThanPage: null, recordingSince: null, now })).toEqual([]);
  });

  it("counts hours on the sweep", () => {
    const at = new Date("2026-09-24T10:30:00Z");
    const rows = historyRows({ cron: "sweep", runs: [run("2026-09-24T06:42:30Z", { cron: "sweep" })], newerThanPage: null, recordingSince: null, now: at });
    // 07:42, 08:42 and 09:42 are due and missing; 10:42 has not come round.
    expect(rows[0]).toMatchObject({ kind: "missed", span: { count: 3, first: new Date("2026-09-24T07:42:00Z") } });
  });
});

describe("every step a run planned, whether or not it left a row", () => {
  const now = new Date("2026-09-24T12:00:00Z");
  const step = (name: string, position: number, ok = true): RecordedStep => ({
    name,
    position,
    startedAt: new Date("2026-09-24T11:59:00Z"),
    finishedAt: new Date("2026-09-24T11:59:01Z"),
    ok,
    error: ok ? null : "it fell over",
    result: ok ? { considered: 0 } : null,
  });
  const planned = ["a", "b", "c", "d"];

  it("marks the step a running run is on, and the rest not reached", () => {
    const going = { planned, startedAt: new Date(now.getTime() - MIN), finishedAt: null, ok: null };
    expect(stepRows(going, [step("a", 0)], now).map((row) => row.state)).toEqual(["ok", "in_progress", "not_reached", "not_reached"]);
  });

  it("marks the step a stopped run was on as having no finish", () => {
    const stopped = { planned, startedAt: new Date(now.getTime() - RUN_CEILING_MS - MIN), finishedAt: null, ok: null };
    expect(stepRows(stopped, [step("a", 0), step("b", 1, false)], now).map((row) => row.state)).toEqual([
      "ok",
      "failed",
      "no_finish",
      "not_reached",
    ]);
  });

  it("calls a missing row on a finished run a lost write, not a step that never ran", () => {
    const finished = { planned: ["a", "b"], startedAt: now, finishedAt: now, ok: true };
    expect(stepRows(finished, [step("a", 0)], now).map((row) => row.state)).toEqual(["ok", "not_recorded"]);
  });

  it("keeps a recorded step the plan does not name", () => {
    const finished = { planned: ["a"], startedAt: now, finishedAt: now, ok: true };
    expect(stepRows(finished, [step("a", 0), step("extra", 1)], now).map((row) => row.name)).toEqual(["a", "extra"]);
  });
});
