# The crawl surface at 41,000 listings — T3.3

Audited 9 November 2026 against `prisma/seed-at-scale.mts`'s corpus: 41,308
listings, 38,687 public, 112,180 non-draft products, 55 published areas, 440
categories. Re-run it with

```bash
DATABASE_URL=…/bl_scale DIRECT_URL=…/bl_scale pnpm audit:crawl
```

The script is the audit. This file records what it printed, what was wrong, and
what is owed — because five of the numbers below are content and will be
different next month.

## What was wrong, and is now fixed

Nine findings. Seven of them are one defect in seven places.

### 1–7 · Seven surfaces had followable links into the facet space

`lib/seo/crawl-policy.ts` makes the argument plainly: robots.txt only *asks*,
and `rel="nofollow"` is the half that works on a crawler which does not read it
or reads it and declines — the crawler from the 2026-09-04 incident being
exactly that. Both halves were supposed to ship on every surface that renders a
filter. Four did not:

| Surface | What was followable | Size of the space |
|---|---|---|
| `b/[slug]/products/_rail.tsx` | every spec option, availability, subcategory, and the four sorts | multi-select, so `2^options` per field — `4.29e9` on the valve template — per seller, across 38,687 storefronts |
| `b/[slug]/products/page.tsx` | *Show more* carried the active facets into `?…&page=2` | one more node inside whatever view is open |
| `b/[slug]/reviews/_toolbar.tsx` | four filters, four sorts | 16 views per claimed storefront |
| `_results/SearchFilterBar.tsx` | three availability chips on the blended screen | 8 states per query |
| `_landing/LandingPage.tsx` | the `?sub=` subcategory chips | one per chip per live landing page |
| `components/domain/BlendedResultRows.tsx` | every row's *Ask for a quote* — **48 of them on one page of results** | one `force-dynamic` composer per supplier and per product |
| `_results/ZeroResult.tsx` | the trade's composer prompt, `/rfq/new?category=` | 427, one per trade |
| `_shortlist/ShortlistButton.tsx` | *Sign in to save*, `?next=` the page it is on | one sign-in form per listing, ~30,000 |

Each is a `noindex` page or a composer with nothing on it to rank — every fetch
of one is crawl budget taken from a supplier page that could rank. And in most
of these cases **the sibling component had it right**: `services/_rail.tsx`,
`ServicesLanding.tsx`, `FilterChip`, `ListingCard` and `ProductCard` all call
`crawlRel`, while the newer row set drawn beside them on the same screen called
it nowhere. This is the defect `CLAUDE.md` names as the most repeated one in the
project, in its exact documented form — a shared behaviour implemented on one
sibling screen and not the other.

A grep could not have found them, which is why the gate below is a rendered-page
check. Each of the seven builds its href a slightly different way, and four of
the seven are files that import `crawlRel` already and simply do not call it on
every anchor.

### 8 · `/rfq/new?to=` was not disallowed, though its two siblings are

`DISALLOWED_PATHS` carries `/report` and `/onboarding/claim?` with the same
reasoning written out twice: one `force-dynamic` URL per listing, roughly thirty
thousand, nothing on them to rank. `Ask for a quote` on every listing card and
every product card links to `/rfq/new?to=<slug>` — the identical shape, 38,687
of them, each running `getActor()` — and the route was not named. The anchors
have carried `nofollow` since the cards were written, so the compliant half was
the half missing. One line.

### 9 · Three indexable classes were in no sitemap

`/for-buyers`, `/list-your-business` and `/lp/:campaign` are all indexable and
canonical to themselves, deliberately. None was in any chunk. For the first two
the only internal links are inside the entry and sign-up funnel; the third has
none anywhere, because a campaign page is arrived at from an advert. For those
three the sitemap is not a hint, it is the path. `/list-your-business` is the
page a supplier searching "list my company UAE" is supposed to land on.

`campaign` is now a fixed sitemap class and the two marketing pages are in
`core`. `tests/integration/crawl-surface-t33.test.ts` pins all of it, and pins
the contradiction guard the other way too: nothing a fixed chunk submits may be
a disallowed path.

## The sitemap, measured

162,819 URLs across 20 chunks. T3.1 split it for exactly this reason: one file
cannot carry it, and a crawler rejects an oversized file whole.

| Class | Files | Largest file | Share of the 50,000 cap |
|---|---|---|---|
| `core` | 1 | 12 | 0% |
| `area` | 1 | 4 | 0% |
| `emirate` | 1 | 1 | 0% |
| `taxonomy` | 1 | 13 | 0% |
| `lists` | 1 | 1 | 0% |
| `guides` | 1 | 3 | 0% |
| `campaign` | 1 | 1 | 0% |
| `business` | 6 | 9,263 | 19% |
| `service` | 1 | 143 | 0% |
| `product` | 6 | 20,000 | 40% |

Headroom is the point rather than the fill: the `business` chunks sit at a fifth
of the cap because a row can emit six URLs and the slice is sized for the worst
case.

## The publish floor, which is where the directory actually is

This is the finding with a number attached that nobody has decided about.

| | Addressable | Staff published | Live right now |
|---|---|---|---|
| area pages (`/:emirate/:area/:trade`) | 23,540 | 5 | **4** |
| emirate cells (`/:emirate/:trade`) | 2,996 | 2 | **1** |
| trade pages (`/c/:sector/:trade`) | 427 | — | **0** |
| curated lists (`/best/:slug`) | — | 1 | 1 |
| campaigns (`/lp/:campaign`) | — | 1 | 1 |

**Zero of 427 trade pages clear the floor**, so the whole subcategory layer of
the taxonomy is absent from the sitemap and from `/categories`. The breakdown
says which floor, and it is not the one you would guess:

- 427 fail the **250-word intro**;
- 425 also fail the **30% verified share**;
- **2** clear supply and fail only on the intro.

So the subcategory layer is gated on verification, not on prose — at 41,000
listings only two trades have enough verified suppliers to be worth writing 250
words for. That is a true statement about the directory and a correct refusal by
board 6f: a trade page with 41 listings and three verified ones is the thin page
the floor exists to prevent. It is worth saying out loud because the shape of
the engine at launch is **four live landing pages and 38,687 storefronts**, and
every plan that assumes the landing matrix carries acquisition is assuming
something that is not true yet.

One published area page and one published emirate cell are below a floor right
now and are correctly dark. `livePages` re-checks rather than trusting
`publishedAt`, so they leave the sitemap on the next build without waiting for
the sweep.

## The facet space, against the real taxonomy

The task asks to confirm the combination trap is closed on the real taxonomy
rather than the seed's. It is closed, and the arithmetic is not the one the
policy file quotes.

`crawl-policy.ts` says ~10^45, counted from the 46 facet groups and 151 option
values one crawler found on `/c/valves-and-fittings` on 2026-09-04. The taxonomy
as it stands cannot produce that: there are **two live spec templates covering
two of 440 categories**, with four and three filterable fields. Measured:

- fixed rail — 6 groups, `6.88e5` states including the 55 published areas;
- `sort` × `tab` × `view` — 75 states;
- the widest template, Industrial valve — 4 multi-select fields over 32 options,
  `4.29e9` states;
- **one shelf therefore addresses `2.2e17` distinct URLs**, before `q` and
  before `page`.

28 orders of magnitude below the quoted figure and still unbounded in every way
that matters: at the incident's rate of twelve requests a minute, walking
`2.2e17` URLs takes 10^11 years. The rule does not depend on which number is
right, which is the useful conclusion — and the exponent grows multiplicatively
with every template an ops lead publishes, since marking a `SpecField`
filterable needs no code change. The policy file's figure is left as written
with this measurement beside it: it is an observation from a log, and a log is
evidence.

## Canonical targets

`canonicalFor`'s three rules hold, and the one worth checking is the first — a
filtered view naming a single area canonicalises to that area's page *only where
the page is live*, because a canonical aimed at a `noindex` page is worse than
none. Four live area pages can be named; the one published-but-dark page falls
through to rule 2 and canonicalises to the unfiltered trade page, which is the
intended behaviour.

Every other class is self-canonical: landing pages carry `?page=` in the
canonical and drop a `?sub=`, `/lp/:campaign` and `/best/:slug` point at
themselves, and the storefront tabs canonicalise to themselves unfiltered.

## Owed

1. **Five internal links into `/search` keep a query string and stay
   followable, deliberately.** `/search?kind=products` is the nav bar's
   *Products* item, the footer's *Browse products*, the home page's and the
   comparison tray's, and the home page's "Popular:" chips are the same class.
   By the letter of the policy — only `page` is crawlable — each should be
   `nofollow`, and they are not, for two reasons: a `nofollow` on a top-level
   nav item is a strong and strange signal about site structure, and the cost is
   now bounded. `/search` is disallowed *and* `noindex`, so a compliant crawler
   never fetches it; one that ignores robots.txt gets a page where, after this
   change, every facet anchor is `nofollow`. The walk dies at depth one instead
   of entering the space. Written down so the next person to widen it has to
   argue with this paragraph, and `q` — the one unbounded key in the product —
   is behind exactly that door.
2. **The gate is in, and it reads the page rather than the source.**
   `tests/e2e/seo.spec.ts` now walks seven public URLs, reads every anchor's
   `href` and `rel`, and judges them with `isCrawlable` — the policy's own
   function, so the test and the product cannot drift on what the rule is. It
   runs in CI's `acceptance` job. The two deliberate entry points are listed by
   exact URL rather than by prefix, because a prefix match on `/search` would
   have exempted the blended screen's own facet anchors, which is one of the
   seven defects above.
3. **The 427 dark trade pages are a content and verification backlog**, not a
   defect, and the number belongs on the ops matrix rather than in a build plan.
