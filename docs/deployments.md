# Deployments

Vercel, one project, production tracking `main`. Four things are worth knowing
before you push: which database your commands are pointed at, that the database
is not part of a deploy, what a deploy costs, and why a push to a branch no
longer builds by itself.

## Which database am I about to hit

Every destructive command in this repo finds its database the same way — read
`DIRECT_URL`, fall back to `DATABASE_URL`, connect — and until recently none of
them asked which host that turned out to be.

That matters here more than on most projects, because the answer depends on
which directory you are standing in. `.env.local` in the repo root points at the
hosted Supabase. `.env.local` inside a worktree points at a throwaway on your
laptop. The same `pnpm db:seed` is a no-op in one and total data loss in the
other, and `prisma/seed.mts` opens with

```sql
truncate table "audit_event", "business", "review", … restart identity cascade;
```

across 46 tables, with no prompt and no undo. The code is in git and can be
rebuilt in minutes; the reviews buyers wrote, the enquiry and quote threads, the
verification history and the subscriptions cannot be. They exist once.

So these commands assert the target first and refuse anything that is not
loopback:

| Command | What it would have done |
|---|---|
| `pnpm db:seed` | truncate 46 tables, then reseed |
| `pnpm db:push` | drop any column the schema no longer has |
| `pnpm db:migrate` | offer to reset the database on drift |
| `pnpm test:integration` | delete rows by prefix, and rewrite one supplier's plan, tier and MRR ledger |
| `pnpm test:e2e` | provision and delete users, suspend listings, remove a review |
| `pnpm dev:seat` | delete and recreate a user row |
| `pnpm db:deploy --yes` | apply migrations with nobody watching |

`pnpm verify` runs the integration suite, so it is covered too — and it is the
likeliest of all of them to be typed in the wrong directory, because it is the
command every PR is supposed to run.

`pnpm db:deploy` **without** `--yes` is deliberately not on that list. Reaching
production is its job, and it already names the target and asks for `apply` or
`apply destructive` back. Only the unattended path is refused.

CI needs nothing: `.github/workflows/ci.yml` points at the `supabase start`
container on `127.0.0.1:54322`.

### When you really do mean a remote

Name the host on the command line:

```bash
DB_DESTRUCTIVE_ALLOW_HOST=aws-0-eu-central-1.pooler.supabase.com pnpm db:deploy --yes
```

Two things about it are deliberate. It names **one** host, so unlocking staging
cannot quietly unlock production. And it is refused outright if it appears in
`.env.local` or `.env` — those are the files that point at production, and an
override living in one is a guard that has been deleted rather than passed. It
has to be typed next to the thing it permits, every time.

The logic and its tests: `lib/db/target.ts`, `tests/unit/db-target.test.ts`.

## Schema does not deploy with the code

A merge to `main` ships the application. It does not ship the database. Nothing
in `package.json`'s build script, nothing in `vercel.json` and nothing in
`.github/workflows/ci.yml` runs a migration against the production project — CI
migrates only the throwaway `supabase start` container on its own runner.

Schema reaches production when a person runs one command:

```bash
pnpm db:deploy
```

That is the whole mechanism. It is deliberate, and the rest of this section is
about making it visible rather than removing it.

### Look before you apply

```bash
pnpm db:pending
```

Read-only. It names the database it is pointed at, lists every migration the
database has not applied, and for each one prints the commit, the author and the
PR that added it, plus any statement in it that loses or rewrites data:

```
  target   aws-0-ap-south-1.pooler.supabase.com:5432/postgres

  2 migration(s) pending, applied in this order:

  20260903132133_testimonial
    added by  #64 · ayushkbhatia · 2026-09-03
              feat(auth): a door each for buyers, suppliers and staff, over one sign-in flow (#64)

  20260826140000_licence_ingest
    added by  #21 · ayushkbhatia · 2026-08-26
              feat(admin): the licence importer, and a CSV parser that was dropping rows in silence (#21)
    DATA LOSS L171  ALTER TABLE "business" DROP COLUMN "import_run_id"
```

`pnpm db:deploy` prints exactly that report first, then asks for the word
`apply` before running `prisma migrate deploy` underneath. When any pending
migration loses or rewrites data the word is `apply destructive`, so the
confirmation cannot be muscle memory. It refuses outright when it is not
attached to a terminal — `--yes` is the deliberate way past that, and there is
no flag that skips the report.

It also reports two states `prisma migrate status` mentions only in passing: a
migration applied to the database that this checkout does not have, which means
you are about to deploy from a branch that is behind, and a migration that
started, never finished and was never rolled back, which `migrate deploy` will
refuse to run past.

A **rolled-back** row is none of those and is reported as nothing at all. It is
what resolving a failure looks like — `prisma migrate resolve --rolled-back` —
and Prisma does not block on one. Production carries two, both for
`20260827120000_storefront_templates` on 2026-08-26: a datatype mismatch, then
a duplicate column, then a third attempt that finished 1.7 seconds later. If a
rolled-back migration has no later success it simply reads as pending, which is
what it is.

### Why this exists

`prisma migrate deploy` applies **every** pending migration, not the one the
person running it has in mind.

On 2026-09-03, #64 added a `testimonial` table and merged. That migration
reached production not through anything in #64, but through whoever next ran
`db:deploy` while shipping #66 or #68 — an unrelated session shipped a schema
change it had never reviewed and did not know existed. It was purely additive,
so nothing broke. A `DROP COLUMN` travels the same path just as quietly, and the
`licence_ingest` migration above proves this repo writes those.

Nothing here stops `migrate deploy` doing what it does. What changed is that the
list, and the name on each line of it, is now in front of the person typing the
command.

### Naming a migration in its PR

`pnpm check:migrations` fails CI when a PR adds a migration and neither the PR
title nor the body names it. It runs on pull requests only, and inside
`pnpm verify` it is advisory — it prints the line to paste rather than failing,
so the answer arrives before the PR exists:

```
Migrations: 20260903132133_testimonial
```

A squash merge copies the PR body into the commit, which is what `db:pending`
reads back to whoever deploys next. It is also what makes
`git log --grep=20260903132133_testimonial` answer "when did this reach `main`,
and alongside what".

The same check fails on a migration **modified** relative to `main`. Prisma
checksums applied migrations: editing one that production has already run does
not re-run it, it makes the next `migrate deploy` refuse. Write a new migration.

### Ordering, when a migration and its code both need to ship

Vercel deploys on merge; the database waits for a person. So the two are never
simultaneous, and the order is a choice worth making on purpose:

| The migration | Apply it |
|---|---|
| Adds a table, column, index or constraint nothing yet reads | before the merge |
| Adds a `NOT NULL` column, or a constraint the old code would violate | before the merge, and only if the old code still satisfies it |
| Drops or renames anything | after the merge, once no running code refers to it |

The middle row is the one that bites: production runs the previous deployment
until the new one is live, and that code is still writing rows the new
constraint may reject.

### Why there is no workflow that does this

A `push`-triggered job that migrates production would still apply every pending
migration. It would move the surprise from a terminal to a workflow log without
removing it, and it would run against the same pooled Postgres as the Vercel
production build that the merge just started.

A `workflow_dispatch` job is the version worth having later: manual, auditable,
and with the production password in one place instead of on every laptop. It
needs `DIRECT_URL` as a repository secret, and a `production-db` environment —
whose required-reviewer rule needs a paid plan on a private repository, and with
one committer approves nothing anyway. Not built. The two guards above are what
the incident actually called for.

## Preview builds are opt-in

Every push to every branch used to trigger a preview build. Since
`scripts/vercel-ignore-build.sh` was wired to `ignoreCommand` in `vercel.json`,
a push builds only when one of these is true:

| Condition | Result |
|---|---|
| `VERCEL_ENV` is `production` | builds |
| The branch is `main` | builds |
| `[preview]` appears anywhere in the triggering commit message | builds |
| Anything else | skipped, deployment marked `CANCELED` |

Production is not gated. A squash merge to `main` deploys exactly as it always
did — both of the first two rules catch it, and the branch rule is there so that
a missing or renamed `VERCEL_ENV` fails towards deploying rather than towards a
merge that silently never ships.

### Getting a preview when you want one

Put the marker in the commit you are about to push:

```bash
git commit -m "fix(enquiry): drop the duplicate pin [preview]"
```

For a branch that is already pushed, an empty commit is enough:

```bash
git commit --allow-empty -m "chore: preview build [preview]"
```

Or, without a commit at all: Vercel dashboard → Deployments → the ellipsis on
the deployment → **Redeploy**, with **Use project's Ignore Build Step**
unchecked.

## The exit codes are inverted

This is the part that is easy to get backwards, and the reason the logic lives
in a commented script rather than inline in `vercel.json`, which cannot hold a
comment. From Vercel's `ignoreCommand` reference:

> When the command exits with code 1, the build will continue. When the command
> exits with 0, the build is ignored.

So **exit 0 skips the build** and **exit 1 runs it**. The script says so at both
`exit` lines. The Ignored Build Step runs in the Root Directory once the
deployment reaches `BUILDING`, and can read every
[System Environment Variable](https://vercel.com/docs/environment-variables/system-environment-variables) —
`VERCEL_ENV`, `VERCEL_GIT_COMMIT_REF` and `VERCEL_GIT_COMMIT_MESSAGE` are the
three it uses.

Test it the way CI would, without pushing anything:

```bash
VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=fix/thing \
  VERCEL_GIT_COMMIT_MESSAGE="fix(x): thing" \
  bash scripts/vercel-ignore-build.sh; echo "exit $?"
```

## Why

A deploy costs more than its build minutes.

- Every deployment is billed build time, usually twice per PR on a hosted
  platform: one preview per push, one production per merge.
- Each new deployment gets its own ISR cache and does not reuse the previous
  deployment's — Vercel's words in the ISR docs. So every production deploy
  makes every not-prerendered page cold again, and the next crawler or visitor
  to touch it pays a full render: a function invocation, an ISR write, an
  Observability event, and the bytes from function to edge.
- Measured on the sibling indus-hydraulics project, 2026-08-26: ~100
  deployments in 2 days, ~200 build-minutes/day, and ~1,790 of 2,070 URLs left
  cold by each production deploy, on a site with almost no human traffic.
  Deploys, not visitors, were the bill.

There is no setting that shares an ISR cache across deployments. Deploying less
is the only lever, which is also why finished PRs are held and merged as one
batch rather than one at a time.

### What this does not save

A cancelled build still counts as a deployment. Vercel is explicit that builds
cancelled by the Ignored Build Step "still count towards your deployment quotas
and concurrent build slots". What is saved is the install, the build and the
deployment itself — the minutes and the cold cache — not the row in the
deployments list.

## Cron

`vercel.json` also holds the scheduled jobs, which `ignoreCommand` does not
touch — crons run against the current production deployment and are unrelated to
whether a push builds.

| Path | Schedule |
|---|---|
| `/api/jobs/sweep` | `42 * * * *` |
| `/api/jobs/daily` | `23 20 * * *` |

The plan's cron allowance is a live question rather than a settled one —
`docs/platform-state.md` § Vercel's cron allowance describes three entries and
an hourly schedule that a Hobby plan would not accept. Two entries are in the
file today; that section has not been revisited since.
