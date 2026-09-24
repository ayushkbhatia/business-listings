import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { messageOf, scheduleHeader } from "./outcome";
import { closeRun, openRun, recordRefusal, recordStep, stepRecord } from "./record";
import type { JobCron } from "./schedule";

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
 * ## A refusal is recorded when it is the schedule being refused
 *
 * Standing item 9.5. "The nightly has not run since Tuesday" has two causes
 * that look identical from outside — the scheduler stopped calling, or it
 * called and was turned away — and only the record can tell them apart. So a
 * refused call writes a `job_run` row with `authorised` false, but only two
 * kinds of it, and at most one per cron per hour:
 *
 *   - **Every call while `CRON_SECRET` is unset.** Whoever made it, the answer
 *     is that no scheduled run can succeed, which is the thing to know.
 *   - **A wrong secret from a caller naming itself `vercel-cron/`**, the user
 *     agent Vercel's scheduler always sends. A stranger guessing at the
 *     endpoint is not a run of anything, and writes nothing.
 *
 * The user agent can be forged, which is why the hourly cap exists: the worst a
 * forger can do is one row an hour, not one row a request.
 *
 * @returns a response to return immediately, or `null` when the caller may run.
 */
export async function authorizeJob(request: NextRequest, cron: JobCron): Promise<NextResponse | null> {
  const secret = process.env["CRON_SECRET"];
  if (!secret) {
    console.error(`[jobs] ${cron} called with no CRON_SECRET set`);
    await recordRefusal(cron, "no_secret", scheduleOf(request));
    return new NextResponse(null, { status: 500 });
  }

  const offered = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!constantTimeEqual(offered, secret)) {
    if (fromScheduler(request)) await recordRefusal(cron, "wrong_secret", scheduleOf(request));
    return new NextResponse(null, { status: 401 });
  }

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

/** Vercel's scheduler, by the user agent its docs promise on every invocation. */
function fromScheduler(request: NextRequest): boolean {
  return request.headers.get("user-agent")?.startsWith("vercel-cron/") ?? false;
}

/** The expression that fired this call, when the scheduler sent one. */
function scheduleOf(request: NextRequest | undefined): string | null {
  return scheduleHeader(request?.headers.get("x-vercel-cron-schedule"));
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
 *
 * ## And it writes the run down
 *
 * Standing item 9.5: this is the one place a run is recorded, for every job
 * behind it, so no job keeps a record of its own. The run's row is written
 * before the first step, each step's row as it settles — a step that threw
 * included, with the message it threw — and the finish and verdict last. See
 * `lib/jobs/record.ts` for why none of those writes can throw back into here:
 * the steps run, and the response says what they did, whatever the database
 * made of the record.
 */
export async function runSteps(
  cron: JobCron,
  steps: Record<string, () => Promise<unknown>>,
  request?: NextRequest,
): Promise<{ ok: boolean; steps: Record<string, StepOutcome>; runId: string }> {
  const names = Object.keys(steps);
  const run = await openRun(cron, names, scheduleOf(request));
  const outcomes: Record<string, StepOutcome> = {};
  let ok = true;

  for (const [position, name] of names.entries()) {
    const step = steps[name]!;
    const startedAt = new Date();
    let settled: { ok: true; result: unknown } | { ok: false; message: string };
    try {
      settled = { ok: true, result: await step() };
    } catch (error) {
      ok = false;
      console.error(`[jobs] ${name} threw`, error);
      settled = { ok: false, message: messageOf(error) };
    }
    outcomes[name] = settled.ok ? settled : { ok: false, error: settled.message };
    await recordStep(run, stepRecord({ name, position, startedAt, finishedAt: new Date(), outcome: settled }));
  }

  await closeRun(run, ok);
  return { ok, steps: outcomes, runId: run.id };
}
