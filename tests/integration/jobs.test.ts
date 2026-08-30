import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as sweep } from "@/app/api/jobs/sweep/route";
import { GET as daily } from "@/app/api/jobs/daily/route";
import { GET as measure } from "@/app/api/jobs/measure/route";
import { runSteps } from "@/lib/jobs/authorize";

/**
 * The guard on the job routes, which had no test of any kind.
 *
 * These endpoints are reachable from the internet and each one walks a large
 * slice of the database. `CRON_SECRET` is the whole of the access control, so
 * it gets the coverage the thing it protects deserves.
 */

const SECRET = "test-cron-secret-value";

function call(path: string, bearer?: string) {
  return new NextRequest(`https://businesslistings.me${path}`, {
    headers: bearer === undefined ? {} : { authorization: `Bearer ${bearer}` },
  });
}

const ROUTES: ReadonlyArray<[string, (r: NextRequest) => Promise<Response>]> = [
  ["/api/jobs/sweep", sweep],
  ["/api/jobs/daily", daily],
  ["/api/jobs/measure", measure],
];

let original: string | undefined;

beforeEach(() => {
  original = process.env["CRON_SECRET"];
});

afterEach(() => {
  if (original === undefined) delete process.env["CRON_SECRET"];
  else process.env["CRON_SECRET"] = original;
});

describe("every job route refuses anybody without the secret", () => {
  for (const [path, handler] of ROUTES) {
    it(`${path} refuses a request with no header at all`, async () => {
      process.env["CRON_SECRET"] = SECRET;
      const response = await handler(call(path));
      expect(response.status).toBe(401);
      // No body. An endpoint that explains why it refused helps somebody guess.
      expect(await response.text()).toBe("");
    });

    it(`${path} refuses a wrong secret`, async () => {
      process.env["CRON_SECRET"] = SECRET;
      const response = await handler(call(path, "not-the-secret"));
      expect(response.status).toBe(401);
    });

    it(`${path} refuses a secret of a different length`, async () => {
      // The length branch of the constant-time compare, which returns early.
      process.env["CRON_SECRET"] = SECRET;
      const response = await handler(call(path, "short"));
      expect(response.status).toBe(401);
    });

    it(`${path} fails closed when CRON_SECRET is unset`, async () => {
      delete process.env["CRON_SECRET"];
      const response = await handler(call(path, SECRET));
      // 500, not 401 — an unset secret is our misconfiguration, and it should
      // look like one rather than like a caller being turned away.
      expect(response.status).toBe(500);
    });
  }
});

describe("the sweep job", () => {
  it("runs, and says whether the backlog outran the pass limit", async () => {
    process.env["CRON_SECRET"] = SECRET;
    const response = await sweep(call("/api/jobs/sweep", SECRET));
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      ok: boolean;
      steps: { deferredNotifications: { ok: true; result: { flushed: number; capped: boolean } } };
    };
    expect(body.ok).toBe(true);
    const step = body.steps.deferredNotifications;
    expect(step.ok).toBe(true);
    expect(step.result.flushed).toBeGreaterThanOrEqual(0);
    expect(step.result.capped).toBe(false);
  }, 30_000);
});

describe("runSteps isolates one failure from the rest", () => {
  it("runs every step even when an earlier one throws, and reports not-ok", async () => {
    /*
       The property the measure route does not have, and the reason anything
       batched into a route gets this helper: a throw in the first job used to
       skip every job after it, silently.
    */
    const ran: string[] = [];
    const outcome = await runSteps({
      first: async () => {
        ran.push("first");
        throw new Error("the first one fell over");
      },
      second: async () => {
        ran.push("second");
        return 2;
      },
    });

    expect(ran).toEqual(["first", "second"]);
    expect(outcome.ok).toBe(false);
    expect(outcome.steps["first"]).toEqual({ ok: false, error: "the first one fell over" });
    expect(outcome.steps["second"]).toEqual({ ok: true, result: 2 });
  });
});
