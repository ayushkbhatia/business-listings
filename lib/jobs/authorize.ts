import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

/**
 * The guard on every scheduled job route.
 *
 * Vercel Cron calls a job with an `Authorization: Bearer $CRON_SECRET` header.
 * Anything else is refused: the jobs are idempotent and read nothing private,
 * but an open endpoint that walks every recipient row is a free way to make the
 * database work for somebody.
 *
 * A missing secret refuses everything rather than allowing everything. A job
 * that silently stops running is better than one anybody can run.
 *
 * Lifted verbatim out of the old `measure` route, which was the only job for a
 * while. The status codes are deliberately asymmetric and both bodies are
 * null:
 *
 *   - **500** when `CRON_SECRET` is unset. That is our misconfiguration, not
 *     the caller's, and it should page somebody rather than look like a refusal.
 *   - **401** when the secret is wrong. No body, no message — an endpoint that
 *     explains why it refused is an endpoint that helps somebody guess.
 *
 * @returns a response to return immediately, or `null` when the caller may run.
 */
export function authorizeJob(request: NextRequest, name: string): NextResponse | null {
  const secret = process.env["CRON_SECRET"];
  if (!secret) {
    console.error(`[jobs] ${name} called with no CRON_SECRET set`);
    return new NextResponse(null, { status: 500 });
  }

  const offered = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!constantTimeEqual(offered, secret)) return new NextResponse(null, { status: 401 });

  return null;
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    // Compare something of equal length anyway, so a wrong-length secret costs
    // the same as a wrong-value one.
    timingSafeEqual(right, right);
    return false;
  }
  return timingSafeEqual(left, right);
}

export type StepOutcome =
  | { ok: true; result: unknown }
  | { ok: false; error: string };

/**
 * Run several jobs in one request without letting the first failure eat the
 * rest.
 *
 * The measure route has no try/catch: a throw in its first sub-job becomes an
 * unhandled 500 and every sub-job after it is skipped, silently. That is
 * survivable when the sub-jobs are all bookkeeping. It is not survivable when
 * one of them is dunning, so anything batched here is isolated.
 *
 * Sequential rather than parallel, because several of these write the same
 * `Subscription` rows.
 *
 * The caller returns 500 when any step failed. Every job behind this helper is
 * idempotent, so Vercel retrying the whole batch is safe — and a failed run
 * that reports 200 is a run nobody finds out about.
 */
export async function runSteps(
  steps: Record<string, () => Promise<unknown>>,
): Promise<{ ok: boolean; steps: Record<string, StepOutcome> }> {
  const outcomes: Record<string, StepOutcome> = {};
  let ok = true;

  for (const [name, step] of Object.entries(steps)) {
    try {
      outcomes[name] = { ok: true, result: await step() };
    } catch (error) {
      ok = false;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[jobs] ${name} threw`, error);
      outcomes[name] = { ok: false, error: message };
    }
  }

  return { ok, steps: outcomes };
}
