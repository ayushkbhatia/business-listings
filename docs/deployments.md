# Deployments

Vercel, one project, production tracking `main`. Two things are worth knowing
before you push: what a deploy costs, and why a push to a branch no longer
builds by itself.

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
