# What a public render costs at 41,000 listings — T3.2

Measured 9 November 2026 against `prisma/seed-at-scale.mts`'s corpus: 41,308
listings, 38,687 of them public, 119,212 products. `next build` then `next start`
on this machine, four requests per URL, seconds.

| URL class | 1st | then | then | then |
|---|---|---|---|---|
| `/c/:trade` | 0.344 | 0.135 | 0.126 | 0.160 |
| `/c/:trade/:niche` | 0.134 | 0.105 | 0.092 | 0.166 |
| `/b/:slug` | 0.133 | 0.044 | 0.034 | 0.037 |
| `/b/:slug/reviews` | 0.023 | 0.018 | 0.019 | 0.013 |
| `/:emirate/:area/:trade` | 0.073 | 0.047 | 0.041 | 0.044 |
| `/:emirate/:trade` | 0.027 | 0.028 | 0.015 | 0.012 |

**Every one of these is a fresh render.** Not one is a cache hit, and that is
the finding rather than the latency: `/c/:trade` and `/b/:slug` both declare
`revalidate = 300`, and on both of them it is inert.

## Why, and it is not one reason

The task assumed a single cause — a `searchParams` read — and there are two,
which is why the fix is not the one the task names.

**`/c/*` and `/:emirate/:area/:trade` are dynamic because their body *is* the
query string.** Facets, pagination, the sort chips. There is no shell to
separate: the counts in the header, the chips in the rail and the rows in the
list are one predicate over one set, which is the property boards `10c`/`10c-s`
are built on. Splitting the header from the list would give two predicates and
a header that disagrees with what is under it — the exact defect T2.6 just
removed from the landing pages.

**`/b/:slug` is dynamic because it is personalised, and it must stay that
way.** `getActor()` reads the request's cookies for the shortlist's *Saved*
state, and the file says plainly what caching it would do:

> Anything that puts the page back in the cache … would serve one buyer's
> "Saved" to the next reader, who would then press a button that says it is
> removing something they never saved.

A first attempt at this task moved `?service=`, `?report=1` and the closed
listing's review query off the server to stop the route reading `searchParams`.
It worked, the route stayed `ƒ` because of `getActor()`, and three behaviours
had been given up for nothing. It is reverted. The page had already written
down why it could not work; I should have read it first.

## What would actually fix it

`cacheComponents: true` — Next 16's Partial Prerendering. The static shell
prerenders and the dynamic hole streams, which is exactly the shape both
classes need: a category shelf whose chrome is fixed and whose list is a query,
a storefront whose content is fixed and whose *Saved* is one viewer's.

It is **a repo-wide migration, not a sprint task**, and the framework's own
guide says why: with it on, "data fetching is dynamic by default, and you
choose what to cache". Every read in the product becomes uncached until it is
marked `use cache`, and the ones that must not be cached — the actor, the
shortlist, anything per-viewer — have to be proved uncached rather than assumed.
Flipping that flag inside a sprint whose other eight tasks are unrelated would
put the whole public surface on one untested switch.

## What this costs if it is not done

Latency is not the argument. 12–160 ms is a fine server render, and S2 already
took the widest search from an arbitrary 200-row window to a true page in
232 ms.

The argument is `CLAUDE.md`'s opening rule. Every one of these is a billed
function invocation, and at 41,000 listings the crawl surface is large:

- 38,687 storefronts, plus up to five tabs on each claimed one;
- 119,212 product pages;
- the live area and emirate pages, and ~1,267 more if the services class opens;
- all of it re-rendered on every production deploy, because each deployment
  gets a fresh ISR cache.

So the cost is a function of how often a crawler walks the directory, and today
nothing between the crawler and Postgres holds an answer. That is the number
`cacheComponents` would change, and it is worth its own sprint rather than a
task inside one.

## Owed

1. A `cacheComponents` migration, scoped as its own piece of work, with the
   per-viewer reads enumerated before the flag is turned on. `getActor`,
   `isShortlisted`, the contact reveal and the own-listing note are the four
   found so far.
2. Until then, a CDN rule is **not** a substitute on `/b/:slug`: the page is
   per-viewer and the file above says what caching it would leak.
