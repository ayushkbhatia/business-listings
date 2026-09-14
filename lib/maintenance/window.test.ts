import { describe, expect, it } from "vitest";
import {
  MIN_RETRY_S,
  OVERRUN_RETRY_S,
  parseWindow,
  phaseAt,
  plannedMinutes,
  retryAfterSeconds,
  trustHolds,
  viewAt,
  type MaintenanceWindow,
} from "./window";
import { SPECIMEN_WINDOW } from "./specimen";

const DRAWN = SPECIMEN_WINDOW;

function ok(record: unknown): MaintenanceWindow {
  const result = parseWindow(record);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.window;
}

function errors(record: unknown): string[] {
  const result = parseWindow(record);
  return result.ok ? [] : result.errors;
}

const at = (iso: string) => new Date(iso);

describe("parseWindow", () => {
  it("reads the board's window, from an object or from JSON text", () => {
    const window = ok(DRAWN);
    expect(window.startsAt.toISOString()).toBe("2026-09-19T22:20:00.000Z");
    expect(window.whatsapp).toBe("+971501184400");
    expect(ok(JSON.stringify(DRAWN))).toEqual(window);
    expect(plannedMinutes(window)).toBe(40);
  });

  it("refuses JSON that is not JSON, and never throws", () => {
    expect(errors("{nope")).toEqual(["the record is not valid JSON"]);
  });

  it("refuses a time with no zone — B5, the end time carries its zone", () => {
    expect(errors({ ...DRAWN, endsAt: "2026-09-20T03:00:00" }).join()).toMatch(/endsAt is an ISO time with its zone/);
  });

  it("refuses an end before its start, and a window longer than a day", () => {
    expect(errors({ ...DRAWN, endsAt: DRAWN.startsAt }).join()).toMatch(/after startsAt/);
    expect(errors({ ...DRAWN, endsAt: "2026-09-21T03:00:00+04:00" }).join()).toMatch(/24 hours at most/);
  });

  it("refuses a Dubai landline for WhatsApp — the correction at export, as a rule", () => {
    expect(errors({ ...DRAWN, whatsapp: "+971 4 000 0000" }).join()).toMatch(/UAE mobile.*landline/);
    expect(errors({ ...DRAWN, whatsapp: "not a number" }).join()).toMatch(/not a UAE number/);
  });

  it("allows no WhatsApp line at all", () => {
    expect(ok({ ...DRAWN, whatsapp: undefined }).whatsapp).toBeNull();
  });

  it("refuses a system listed twice, and an unknown field", () => {
    expect(errors({ ...DRAWN, affected: [...DRAWN.affected, { system: "search", state: "down" }] }).join()).toMatch(
      /listed twice|Too big/,
    );
    expect(errors({ ...DRAWN, reason: "free text" }).length).toBeGreaterThan(0);
  });

  it("refuses an all-down list for work that is not site-wide — a list nobody believes", () => {
    const allDown = DRAWN.affected.map((r) => ({ ...r, state: "down" }));
    expect(errors({ ...DRAWN, affected: allDown }).join()).toMatch(/at least one system that keeps running/);
  });

  it("refuses a claim about the architecture that contradicts the work", () => {
    const searchRunning = DRAWN.affected.map((r) => (r.system === "search" ? { ...r, state: "running" } : r));
    expect(errors({ ...DRAWN, affected: searchRunning }).join()).toMatch(/search index has to list search as down/);
    expect(errors({ ...DRAWN, work: "database" }).join()).toMatch(/cannot be listed as running/);
  });

  it("refuses a window that takes no page down", () => {
    const record = {
      ...DRAWN,
      work: "notification_job",
      affected: [
        { system: "notifications", state: "down" },
        { system: "search", state: "running" },
      ],
    };
    expect(errors(record).join()).toMatch(/no page is taken down/);
  });

  it("accepts the database state with every row down", () => {
    expect(ok({ ...DRAWN, work: "database", affected: DRAWN.affected.map((r) => ({ ...r, state: "down" })) }).work).toBe(
      "database",
    );
  });
});

describe("phases and Retry-After", () => {
  const window = ok(DRAWN);

  it("walks upcoming, active, overrun, lapsed", () => {
    expect(phaseAt(window, at("2026-09-20T02:19:59+04:00"))).toBe("upcoming");
    expect(phaseAt(window, at("2026-09-20T02:20:00+04:00"))).toBe("active");
    expect(phaseAt(window, at("2026-09-20T03:00:00+04:00"))).toBe("overrun");
    expect(phaseAt(window, at("2026-09-20T04:59:59+04:00"))).toBe("overrun");
    expect(phaseAt(window, at("2026-09-20T05:00:00+04:00"))).toBe("lapsed");
  });

  it("counts to the end time, never below a minute, then five minutes", () => {
    expect(retryAfterSeconds(window, at("2026-09-20T02:30:00+04:00"))).toBe(30 * 60);
    expect(retryAfterSeconds(window, at("2026-09-20T02:59:50+04:00"))).toBe(MIN_RETRY_S);
    expect(retryAfterSeconds(window, at("2026-09-20T03:10:00+04:00"))).toBe(OVERRUN_RETRY_S);
  });
});

describe("viewAt", () => {
  const window = ok(DRAWN);

  it("renders the end in Gulf time, without a day on the same Dubai day", () => {
    const view = viewAt(window, at("2026-09-20T02:30:00+04:00"));
    expect(view).toMatchObject({ phase: "active", endClock: "03:00", endDay: null, minutes: 40, trust: true });
    expect(view.whatsapp).toEqual({ display: "+971 50 118 4400", href: "https://wa.me/971501184400" });
  });

  it("names the day when the end falls on another Dubai day", () => {
    expect(viewAt(window, at("2026-09-19T23:50:00+04:00")).endDay).toBe("20 Sep");
  });

  it("removes the trust sentence unless quotes and notifications both run", () => {
    expect(trustHolds(window)).toBe(true);
    const job = ok({
      ...DRAWN,
      work: "notification_job",
      affected: [
        { system: "search", state: "running" },
        { system: "quotes", state: "down" },
        { system: "notifications", state: "down" },
      ],
    });
    expect(trustHolds(job)).toBe(false);
    expect(trustHolds(ok({ ...DRAWN, affected: DRAWN.affected.slice(0, 3) }))).toBe(false);
  });
});
