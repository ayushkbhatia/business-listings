import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  JOB_CRONS,
  JOB_GRACE_MS,
  JOB_SCHEDULES,
  dueSlotIndex,
  nextDailyRun,
  nextSlot,
  slotIndex,
  slotTime,
} from "@/lib/jobs/schedule";

/**
 * `lib/jobs/schedule.ts` is the reading of `vercel.json`, which a screen cannot
 * read at request time. A run can only be *missing* against a schedule, so if
 * the two part, `/admin/jobs` counts missed runs against a schedule nobody is
 * running — and says the nightly is late when it is not, or the reverse.
 */

const config = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] };

describe("the schedule the record is read against", () => {
  it("is vercel.json's, cron for cron", () => {
    for (const cron of JOB_CRONS) {
      const entry = config.crons.find((item) => item.path === JOB_SCHEDULES[cron].path);
      expect(entry?.schedule, cron).toBe(JOB_SCHEDULES[cron].expression);
    }
  });

  it("names every cron vercel.json registers, so a third one cannot run unread", () => {
    expect(config.crons.map((item) => item.path).sort()).toEqual(JOB_CRONS.map((cron) => JOB_SCHEDULES[cron].path).sort());
  });

  it("has a route for every cron it names", () => {
    for (const cron of JOB_CRONS) {
      expect(() => readFileSync(`app${JOB_SCHEDULES[cron].path}/route.ts`, "utf8"), cron).not.toThrow();
    }
  });

  it("gives every cron the one grace the screen states", () => {
    for (const cron of JOB_CRONS) expect(JOB_SCHEDULES[cron].graceMs, cron).toBe(JOB_GRACE_MS);
  });
});

describe("slot arithmetic", () => {
  const daily = JOB_SCHEDULES.daily;
  const sweep = JOB_SCHEDULES.sweep;

  it("puts a run in the slot it started in", () => {
    // Measured in production: the daily fired at 20:23:26 UTC.
    const fired = new Date("2026-09-23T20:23:26.107Z");
    expect(slotTime(daily, slotIndex(daily, fired)).toISOString()).toBe("2026-09-23T20:23:00.000Z");
    // A run somebody starts by hand at noon counts for the slot before it.
    const byHand = new Date("2026-09-24T08:00:00Z");
    expect(slotTime(daily, slotIndex(daily, byHand)).toISOString()).toBe("2026-09-23T20:23:00.000Z");
    // The sweep at :42:37.
    const swept = new Date("2026-09-24T10:42:37.122Z");
    expect(slotTime(sweep, slotIndex(sweep, swept)).toISOString()).toBe("2026-09-24T10:42:00.000Z");
  });

  it("owes a slot only once its grace has run out", () => {
    const slot = slotIndex(daily, new Date("2026-09-24T20:23:00Z"));
    expect(dueSlotIndex(daily, new Date("2026-09-24T20:52:59Z"))).toBe(slot - 1);
    expect(dueSlotIndex(daily, new Date("2026-09-24T20:53:00Z"))).toBe(slot);
  });

  it("names the next slot strictly after now", () => {
    expect(nextSlot(sweep, new Date("2026-09-24T10:42:00Z")).toISOString()).toBe("2026-09-24T11:42:00.000Z");
    expect(nextSlot(sweep, new Date("2026-09-24T10:41:59Z")).toISOString()).toBe("2026-09-24T10:42:00.000Z");
    // The CRM's empty list has read this since board 12d; it is the same arithmetic now.
    expect(nextDailyRun(new Date("2026-09-14T08:00:00Z")).toISOString()).toBe("2026-09-14T20:23:00.000Z");
    expect(nextDailyRun(new Date("2026-09-14T20:23:00Z")).toISOString()).toBe("2026-09-15T20:23:00.000Z");
  });
});
