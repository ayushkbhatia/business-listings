-- Standing item 9.5 — a record of every scheduled job run, and of every step
-- inside one.
--
-- `/api/jobs/daily` and `/api/jobs/sweep` run their steps through `runSteps` in
-- `lib/jobs/authorize.ts`, which already knew each step's outcome and kept it
-- for the length of one HTTP response. Nothing was persisted, so a nightly that
-- stopped firing changed nothing on any screen. These two tables are what
-- `/admin/jobs` reads.
--
-- ## What it adds
--
--  1. **`job_run`** — one row per call: which cron, when it started and
--     finished, whether it was authorised, the steps it set out to take, and
--     the runner's verdict. Written at the start of the run so a function that
--     is killed half way still leaves a row. A refused call is a row with no
--     steps, held to one per cron per hour by a unique key.
--  2. **`job_run_step`** — one row per step as it settles: its outcome, what it
--     returned, and the message it threw. A step that throws is recorded; that
--     is the reason the table exists.
--
-- Neither is an audit table. There is no actor, no reason and no before/after:
-- a cron has no actor to attribute (CLAUDE.md non-negotiable 2), and a record
-- that something ran is not a decision.
--
-- ## Retention
--
-- 90 days, pruned by the daily run's `prunedJobRuns` step. Steps go with their
-- run by `ON DELETE CASCADE`.
--
-- ## Ordering
--
-- **Additive, and applies before the merge** (`docs/deployments.md` § Ordering).
-- Two new tables that nothing on the deployed code reads or writes.
--
-- Idempotent: applied through the Supabase MCP and then recorded, a second run
-- is a no-op.

-- ── 1 · Runs ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "job_run" (
  "id" TEXT NOT NULL,
  "cron" TEXT NOT NULL,
  "started_at" TIMESTAMP(3) NOT NULL,
  "finished_at" TIMESTAMP(3),
  "ok" BOOLEAN,
  "authorised" BOOLEAN NOT NULL,
  "refusal" TEXT,
  "refused_hour" TIMESTAMP(3),
  "schedule" TEXT,
  "planned" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  CONSTRAINT "job_run_pkey" PRIMARY KEY ("id"),
  -- A route name, not free text. Not an enumeration: a third cron is a change
  -- to `vercel.json` and `JOB_CRONS`, and should not also need a migration.
  CONSTRAINT "job_run_cron_shape" CHECK ("cron" ~ '^[a-z][a-z0-9_-]{0,39}$'),
  CONSTRAINT "job_run_finished_after_start"
    CHECK ("finished_at" IS NULL OR "finished_at" >= "started_at"),
  -- An authorised run has a verdict exactly when it has a finish.
  CONSTRAINT "job_run_verdict_with_finish"
    CHECK (NOT "authorised" OR (("finished_at" IS NULL) = ("ok" IS NULL))),
  -- A refused call ran nothing: a reason, an hour, a finish, no verdict and no
  -- steps planned. An authorised one carries none of the refusal fields.
  CONSTRAINT "job_run_refusal_shape" CHECK (
    ("authorised" AND "refusal" IS NULL AND "refused_hour" IS NULL)
    OR (
      NOT "authorised"
      AND "refusal" IN ('no_secret', 'wrong_secret')
      AND "refused_hour" IS NOT NULL
      AND "finished_at" IS NOT NULL
      AND "ok" IS NULL
      AND cardinality("planned") = 0
    )
  ),
  -- The header is written as Vercel sends it, and a refused call's header is
  -- anybody's text. The writer drops anything that is not a cron expression.
  CONSTRAINT "job_run_schedule_shape"
    CHECK ("schedule" IS NULL OR "schedule" ~ '^[0-9*/, -]{1,64}$')
);

-- `/admin/jobs`: the last run per cron, and the history paged by keyset.
CREATE INDEX IF NOT EXISTS "job_run_cron_started_idx" ON "job_run"("cron", "authorised", "started_at", "id");
-- The prune, and the first row ever recorded ("recording since").
CREATE INDEX IF NOT EXISTS "job_run_started_idx" ON "job_run"("started_at");
-- One refused row per cron per hour. `refused_hour` is null on every authorised
-- run, and nulls never collide, so this constrains refusals alone.
CREATE UNIQUE INDEX IF NOT EXISTS "job_run_refusal_hour_key" ON "job_run"("cron", "refused_hour");

-- Nothing reads it through PostgREST. Zero policies, as every table here.
ALTER TABLE "job_run" ENABLE ROW LEVEL SECURITY;

-- ── 2 · Steps ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "job_run_step" (
  "run_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "started_at" TIMESTAMP(3) NOT NULL,
  "finished_at" TIMESTAMP(3) NOT NULL,
  "ok" BOOLEAN NOT NULL,
  "error" TEXT,
  -- `json`, not `jsonb`: nothing queries inside a result, and `jsonb` reorders
  -- keys by length, which scrambles the line the console reads it into.
  "result" JSON,
  CONSTRAINT "job_run_step_pkey" PRIMARY KEY ("run_id", "name"),
  CONSTRAINT "job_run_step_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "job_run"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "job_run_step_position_nonnegative" CHECK ("position" >= 0),
  CONSTRAINT "job_run_step_finished_after_start" CHECK ("finished_at" >= "started_at"),
  -- A failed step says why and returned nothing; a step that succeeded has no
  -- error. The bound is the writer's (`ERROR_TEXT_LIMIT`), so this never
  -- refuses a row the writer made.
  CONSTRAINT "job_run_step_outcome_shape" CHECK (
    ("ok" AND "error" IS NULL)
    OR (NOT "ok" AND "error" IS NOT NULL AND "result" IS NULL)
  ),
  CONSTRAINT "job_run_step_error_bounded" CHECK ("error" IS NULL OR char_length("error") <= 2000)
);

ALTER TABLE "job_run_step" ENABLE ROW LEVEL SECURITY;
