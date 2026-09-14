import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeScope, shouldServeMaintenance } from "./decide";
import { SYSTEM_ROUTES, systemForPath } from "./systems";
import { parseWindow, type MaintenanceWindow } from "./window";
import { SPECIMEN_WINDOW as DRAWN } from "./specimen";

function ok(record: unknown): MaintenanceWindow {
  const result = parseWindow(record);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.window;
}

const DURING = new Date("2026-09-20T02:30:00+04:00");
const BEFORE = new Date("2026-09-20T01:00:00+04:00");
const LAPSED = new Date("2026-09-20T06:00:00+04:00");

describe("shouldServeMaintenance", () => {
  const drawn = ok(DRAWN);

  it("serves nothing without a window", () => {
    expect(shouldServeMaintenance("/search", null, DURING)).toBeNull();
  });

  it("takes down the routes of the systems marked down, and only those", () => {
    for (const path of ["/search", "/c/valves-and-fittings", "/categories", "/compare", "/best/x", "/dubai/al-quoz/valves", "/rfq/new"]) {
      expect(shouldServeMaintenance(path, drawn, DURING), path).toBe("active");
    }
    // Quotes in flight and notifications are running, so their routes answer as normal.
    for (const path of ["/", "/enquiry/abc", "/dashboard/leads/1", "/account/enquiries", "/b/acme", "/pricing", "/cookies"]) {
      expect(shouldServeMaintenance(path, drawn, DURING), path).toBeNull();
    }
  });

  it("matches on a whole segment", () => {
    expect(shouldServeMaintenance("/cookies", drawn, DURING)).toBeNull();
    expect(shouldServeMaintenance("/searching", drawn, DURING)).toBeNull();
  });

  it("never intercepts the background work the RUNNING rows describe, or the page's own files", () => {
    const site = ok({ ...DRAWN, work: "database", affected: DRAWN.affected.map((r) => ({ ...r, state: "down" })) });
    for (const path of ["/api/jobs/sweep", "/api/auth/send-otp", "/dev/gallery", "/maintenance/maintenance.css", "/robots.txt"]) {
      expect(shouldServeMaintenance(path, site, DURING), path).toBeNull();
    }
    for (const path of ["/", "/b/acme", "/dashboard", "/auth/callback", "/sitemap.xml"]) {
      expect(shouldServeMaintenance(path, site, DURING), path).toBe("active");
    }
  });

  it("starts at startsAt and lets a lapsed window go", () => {
    expect(shouldServeMaintenance("/search", drawn, BEFORE)).toBeNull();
    expect(shouldServeMaintenance("/search", drawn, LAPSED)).toBeNull();
  });

  it("shows the recorded window at /maintenance from the moment it is set", () => {
    expect(shouldServeMaintenance("/maintenance", drawn, BEFORE)).toBe("upcoming");
    expect(shouldServeMaintenance("/maintenance", drawn, DURING)).toBe("active");
    expect(shouldServeMaintenance("/maintenance", drawn, LAPSED)).toBeNull();
    expect(shouldServeMaintenance("/maintenance", null, DURING)).toBeNull();
  });

  it("describes what a window takes down", () => {
    expect(describeScope(drawn)).toContain("/rfq (requirements)");
  });
});

/*
   Every route prefix a system claims has to be a route. A prefix that matches
   nothing is a row on the page saying something is down that the proxy never
   takes down — the drift the systems file exists to make impossible.
*/
describe("system routes exist", () => {
  const APP = join(process.cwd(), "app");

  function segments(dir: string, prefix = ""): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (!statSync(full).isDirectory() || name.startsWith("_")) continue;
      const segment = /^\(.*\)$/.test(name) ? "" : `/${name}`;
      const path = `${prefix}${segment}`;
      out.push(path, ...segments(full, path));
    }
    return out;
  }

  const routes = new Set(segments(APP));

  it.each(Object.entries(SYSTEM_ROUTES).flatMap(([system, prefixes]) => prefixes.map((p) => [system, p])))(
    "%s owns %s, which the app routes",
    (_system, prefix) => {
      // The emirate prefixes are values of the `[emirate]` segment.
      const concrete = routes.has(prefix) || (routes.has("/[emirate]") && systemForPath(prefix) === "search");
      expect(concrete).toBe(true);
    },
  );
});
