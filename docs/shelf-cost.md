# What a category shelf costs

`/c/valves-and-fittings` takes **3.2 seconds** to first byte in production, every
time, uncached. This is the scope for fixing that, and for the guard that would
have caught the outage on 2026-09-04 before it reached anybody.

Four pieces of work. One of them is not about speed at all and ships first.

Measurements below were taken on 2026-09-04 against production and against the
production database. Where a number is an estimate rather than a measurement it
says so. Re-measure before trusting any of it in a month.

## Where the cost is

| Route | Render | TTFB (production) | Round trips |
|---|---|---|---|
| `/categories` | static | 0.14 s | 0 at request time |
| `/` | dynamic | 0.37 s | 9, one `Promise.all` deep |
| `/b/[slug]` | dynamic | 2.8 s | 37 |
| `/c/[category]` | dynamic | **3.2 s** | **47** |

The homepage is the control. It is dynamic too, it queries the same database
across the same ocean, and it answers in 0.37 s — because its nine queries sit in
a single `Promise.all` one level deep. The shelf's 47 are nested three levels of
`Promise.all` deep, and depth is what you pay for.

Round trips on one unfiltered shelf render, counted with Prisma query logging
against the production schema:

```
 25  business COUNT
 20  SELECT (category, plan, product, spec_template, spec_field, …)
  2  other COUNT
 ---
 47  TOTAL      2,902 ms of accumulated database time
```

And what one round trip costs, measured with eight `select 1` calls:

| From | Connect | Per query |
|---|---|---|
| Same machine as Postgres | 11 ms | **0.4 ms** |
| Dubai → `ap-south-1` pooler | 185 ms | **39 ms** |
| `iad1` → `ap-south-1` | not measured | farther again |

`x-vercel-id: bom1::iad1::…` on every response: the request enters the edge in
Mumbai, and the function executes in Virginia, to query a database in Mumbai.

**The two levers multiply.** Fewer round trips helps in any region. A closer
region makes every remaining trip cheaper. Neither is a substitute for the other.

## PR 1 — a guard against schema deploying behind code

Ships first, and it is not a performance change.

On 2026-09-04, seven migrations from PRs #75, #77, #79 (×3), #80 and #85 sat
unapplied while their code ran in production. The homepage, every category shelf,
every storefront, `/pricing` and `/search` returned 500 for roughly six hours.
Only build-time prerenders kept serving, which made the failure look like a
runtime connection problem and cost an hour of misdiagnosis.

`docs/deployments.md` § *Ordering, when a migration and its code both need to
ship* already gives the rule: a migration that "adds a table, column, index or
constraint nothing yet reads" is applied **before the merge**. All seven were
additive. The rule is written down and nothing enforces it.

**The change.** `scripts/vercel-ignore-build.sh` already runs before every
production build, in the repo root, with the project's environment. It already
cancels a deployment by exiting 0. Give it a schema check: compare the tables and
columns the Prisma schema declares against `information_schema` on the target
database, and cancel the production build when the code needs schema the database
does not have.

- Reuse `scripts/pending-migrations.mts`. It is already read-only, already
  resolves the target the same way every other command does, and already joins
  each pending migration to the PR that added it.
- **Fail towards deploying.** `vercel-ignore-build.sh` already does this for
  `VERCEL_ENV`, and for the same reason: if `DIRECT_URL` is absent or the
  database is unreachable, build. A guard that stops production deploys on a
  network blip gets deleted within a week.
- Print the pending list and the PR numbers into the build log, so the person
  reading a cancelled deployment knows exactly which command to run.
- Do **not** auto-migrate. `docs/deployments.md` § *Why there is no workflow that
  does this* rejects it, correctly: a push-triggered job still applies every
  pending migration and would run against the same pooled Postgres as the build
  the merge just started.

**Why this shape works.** The drift check is exact. Run against production before
the migrations were applied it reported precisely 12 columns and 2 tables, which
is precisely what the seven pending migrations add — no false positives, nothing
missed. Run again afterwards: none.

**Risk.** A false positive blocks a production deploy. Mitigated by failing
towards deploying and by the check being derived from the schema rather than
hand-maintained. Worth one integration test that asserts a known-good database
produces an empty drift list.

## PR 2 — 47 round trips down to about 10

Behaviour-preserving. No architectural change. This is the one with the clearest
payoff per unit of risk.

**The 19-way facet fan-out.** `optionCounts` in `lib/db/queries/search.ts:542`
maps every option value to its own `countResults` call:

```
tier 4 + emirate 4 + availability 4 + freeZone 1 + reply 3 + years 3 = 19
```

Nineteen `SELECT COUNT(*)` queries that differ only in one predicate. One query
with `FILTER (WHERE …)` clauses returns all nineteen counts in a single trip.
Check whether Prisma can express it before reaching for `$queryRaw`; if raw SQL
is needed, `docs/database.md` has the house rules on hand-written statements.

**The duplicated resolver.** `generateMetadata` and the page component each
resolve `getCategoryBySlug` and `countResults` independently, and there is no
React `cache()` anywhere in `lib/db/queries`. Wrapping the hot readers in
`cache()` deduplicates them within a request at no behavioural cost. Confirm the
call counts per route before and after — the same duplication exists on
`/c/[category]/[sub]`, `/[emirate]/[area]`, `/[emirate]/[area]/[category]` and
`/b/[slug]`.

**The JSON pull.** `getSpecFacets` (`search.ts:666`) fetches up to 1,000 product
rows with their `specValues` JSON and groups them in JavaScript. The comment
explains why — "a JSON column with a dynamic key does not group cleanly through
the query builder" — which is true of the query builder and not of Postgres.
`jsonb_each` can group it server-side. Measure before committing: at current
catalogue size this may be one cheap round trip, in which case leave it and say
so in the file.

**Depth, not just count.** The homepage proves depth is what costs. After the
above, look at what is still serial in `Results.tsx` — the `countResults` pair,
then `searchBusinesses`, then the facet queries — and flatten what can be
flattened.

**Expected:** 47 → roughly 10, and the serial depth from three levels to one or
two. At 39 ms per trip that is worth about 1.4 s from Dubai and more from
Virginia. **Verify by re-running the query-log count**, not by feel.

**Risk.** Low, but the facet counts are user-visible numbers and CLAUDE.md is
explicit that every number is a query. A collapsed `FILTER` query must return
byte-identical counts to the nineteen it replaces; assert that in an integration
test against seeded data before deleting the old path.

## PR 3 — move the function to the database's region

One line, reversible, possibly the largest single win.

```json
{ "regions": ["bom1"] }
```

`vercel.json` has no `regions` key today, so Vercel's default applies and the
function lands in `iad1` / `cle1`. The database is in `ap-south-1`. Mumbai is
also nearer to a UAE buyer than Virginia is, so this helps the human and the
query on the same line.

**Confirm before committing:**

- That `bom1` is available on the current Vercel plan. Region availability is
  plan-dependent and this is a dashboard fact, not a repo fact.
- Measure TTFB on `/c/valves-and-fittings` before and after. The `x-vercel-id`
  header names the execution region and is the cheapest possible check.

**Risk.** Low and reversible. The one thing to watch is that a single region has
no failover; `functionFailoverRegions` exists in the `vercel.json` schema if that
matters.

**Do this after PR 2, not before.** Region and round trips multiply, and doing
the cheap structural work first means the region change is measured against a
page that is already efficient rather than hiding the improvement inside noise.

## Deferred — making the shelf cacheable

Not now, and the evidence says not soon.

`export const revalidate = 300` on `app/(public)/c/[category]/page.tsx` is inert.
The route awaits `searchParams`, and the Next 16.3.2 docs are explicit
(`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`,
line 119):

> `searchParams` is a **Request-time API** whose values cannot be known ahead of
> time. Using it will opt the page into **dynamic rendering** at request time.

`next build` agrees: `/c/[category]` is marked `ƒ (Dynamic)`.

**Why it is deferred, not scheduled.** The addressable surface is small and the
measured demand for it is zero:

| | |
|---|---|
| URLs in the production sitemap | 420 |
| …that are `/c/<category>` | **13** |
| Requests in the 75-minute log window | 797 |
| …for a clean, unfiltered shelf | **0** |

Every one of those 797 requests carried a facet parameter, which is the case
Next's own `use-cache-remote.md` names under *When to avoid remote caching*:
"If cache keys have mostly unique values per request (search filters, price
ranges, user-specific parameters), cache utilization will be near-zero."

**The gate.** Before spending a week on this, measure clean-shelf traffic now
that the crawler is blocked:

```bash
npx vercel logs --project business-listings \
  --scope ayushkbhatia-7383s-projects \
  --environment production --since 24h --limit 500 --json \
  | jq -r 'select(.path | test("^/c/[^/?]+$")) | .path' | sort | uniq -c | sort -rn
```

Thirteen shelves at a handful of requests a day each does not justify a
restructure of the busiest route in the app. If that number grows — a marketing
push, an indexing improvement, real buyer traffic — revisit with two candidate
approaches:

- **`cacheComponents: true`** (Next 16's own answer, PPR by default). Adoptable
  incrementally: enable the flag, run
  `npx @next/codemod@canary cache-components-instant-false ./app`, convert one
  route at a time. Two costs to size first, and **size them properly — the
  numbers below are bounds, not measurements**. There are 163 synchronous-IO
  call sites (`new Date()`, `Math.random()` and friends) across 98 files; only
  those reached while prerendering a page or layout block the build, and
  `instant = false` does **not** defer those. Classify them before estimating.
  Separately, `<Activity>` state preservation changes navigation behaviour
  app-wide — 95 client components hold `useState`, 14 use Drawer/Modal — and
  that one is not deferrable by any flag.
- **A route split** — the clean shelf stops reading `searchParams` and becomes
  prerenderable; filtered requests rewrite to a dynamic twin. The sibling project
  did this. Read its revert first (see below).

## Traps, each one already paid for

**Cache-Control from `next.config.ts` does not apply on Vercel.** A dynamically
rendered App Router page returns `private, no-cache, no-store` from the function,
and a function's own header wins over `headers()` in config. The sibling project
shipped this inert and reverted it. Production confirms the header is exactly
that string today. A caching change verified only under `next start` is not
verified.

**Every deploy resets the ISR cache.** Vercel's own docs: each deployment gets
its own cache and does not reuse the previous one. So a caching PR makes the site
briefly *worse* — every page cold — before it is better, and a batch of PRs costs
one cache wipe instead of several. Relevant to PR ordering, not to whether to do
the work.

**Caching a count makes it stale.** CLAUDE.md: "Every number is a query, not a
constant." A cached facet count or supplier tally is a constant for the length of
its lifetime. That may be fine at a 60-second lifetime and is not fine at an
hour; whichever is chosen, the trade goes in the file next to the number.

**`plan: true` was a bare relation include on a public path.** Narrowed in #84 to
the one column the browse path reads. Worth a pass over the other includes in
`BUSINESS_INCLUDE` (`search.ts:158`) for the same shape — check what
`ListingCard` actually renders against what the query selects.

**The measurement lesson from the outage.** Three wrong diagnoses in one session,
all the same mistake: inferring where a measurement was available. Vercel's
runtime logs named the failing column in one line —

```bash
npx vercel logs --project business-listings \
  --scope ayushkbhatia-7383s-projects \
  --environment production --status-code 500 --since 10m
```

— and reading them first would have saved an hour. Check the checkout is current
before trusting any list derived from it; a sibling session can merge PRs
mid-task.

## What has to be measured rather than assumed

| Question | How |
|---|---|
| Round trips per render | Prisma `log: [{ emit: "event", level: "query" }]`, count per request. Revert the instrumentation. |
| Per-trip cost from the function's region | `select 1` × 8 from the region; `x-vercel-id` names it |
| Whether PR 2 worked | Re-count round trips; TTFB before and after |
| Whether `bom1` is available | Vercel dashboard, project settings |
| Whether caching is worth it | The clean-shelf traffic query above |
| Facet counts unchanged after collapsing | Integration test against seeded data |

## What is the user's, not the engineer's

- **The Vercel firewall rule** denying training-crawler user agents on `/c/*`
  carrying a query string. Dashboard only — the `vercel.json` schema has no
  firewall key (checked against `openapi.vercel.sh/vercel.json`). This is the
  layer that costs no compute at all, because it rejects at the edge before
  middleware runs.
- **The region decision** in PR 3, and confirming plan availability.
- **Applying migrations.** Unchanged, and correctly so: `db:deploy` needs a TTY
  for its prompt, and #82's `assertLocalTarget` refuses `--yes` against a
  non-local host. Do not reach for `DB_DESTRUCTIVE_ALLOW_HOST` to automate it.

## Order, and why

1. **PR 1, the guard.** Cheapest, and the only one that prevents a repeat of a
   six-hour outage. Nothing about it depends on the rest.
2. **PR 2, the round trips.** Largest measured win, lowest risk of the
   performance work, and it makes PR 3 measurable.
3. **PR 3, the region.** One line, after PR 2 so the effect is visible.
4. **Caching, gated** on the traffic measurement.

Batch 2 and 3 into one deploy if they land close together — same reasoning as
CLAUDE.md's rule about deploy cost and cache resets.
