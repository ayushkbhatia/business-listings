# Routes — all three surfaces

Every route the canvas defines. Board ids in brackets refer to the screen canvas.
Routes marked `later` are named so the router and nav config are shaped correctly now;
they 404 until their handoff.

**This file drifts, in both directions.** `/dashboard/questions` was built and in the nav
for a whole handoff without a row here, and the three `/dashboard/setup/*` task routes had
rows here without existing. Nothing automated reads the file. The rendered version — every
row, marked live or missing by asking the router — is at `/dev` on a development machine,
and it is the one that argues back.

## Public — businesslistings.me

```
/                                       Directory home                        [1a]
/c/:category                            Category browse + filters             [1b]
/c/:category/:sub                       Subcategory                          [10a]  SEO'd h5s2
/search?q&emirate&verified&tab          Results, businesses tab               [1c]
/search?tab=products                    Results, products tab                [10c]
/compare?p=…                            Comparison tray                      [10d]
/b/:slug                                Storefront overview                   [1d]
/b/:slug/products                       Catalogue                             [1e]
/b/:slug/branches                       Branches & hours                      [1f]
/b/:slug/reviews                        Reviews & ratings                     [1m]  built h4s6
/b/:slug/p/:product                     Product + spec table                  [1g]
/b/:slug/services                       Services index — the link surface   [1g-s] built h3gs
/b/:slug/s/:service                     Service detail — the scope table    [1g-s] built h3gs
/b/:slug (unclaimed variant)            Unclaimed listing                    [10g]
/rfq/new                                RFQ fan-out                           [1h]  built h2s3
/enquiry/:id                            Enquiry sent + tracking               [1i]  built h2s3
/enquiry/:id/compare                    Compare quotes                        [1n]  built h2s3
/enquiry/:id/accepted                   Accepted quote record                 [7c]  built h2s3
/enquiry/:id/thread/:seller             Negotiation thread                   [10h]  built h2s4
/pricing                                Plans                                 [1l]  built h1s1l
/guides                                 Guide index                          [10b]  built h5s3
/guides/how-we-check                    How the guides are checked           [10b]  built h5s3
/guides/:slug                           Guide article, or a subject view [6d, 10b]  built h5s3
/best/:slug                             Curated list                          [6b]  built h5s4
/categories                             Category index                        [6c]  built h5s2
/:emirate/:category                     Trade across one emirate — 84 of them [6a]  built h5s2
/:emirate/:area/:category               Area landing page                     [6a]  built h5s3
/lp/:campaign                           Campaign landing                     [10i]  built h5s5
/report/:subject                        Report a listing (modal route)       [10j]
/terms                                  Terms of use, 16 clauses             [13f]  built h7s1
/privacy                                Privacy policy, 12 sections          [13g]  built h7s1
/cookies                                Cookie policy + 9-cookie register    [13h]  built h7s1
/cookies/settings                       Consent toggles                       later
/verification-policy · /review-policy                                        [10j]  built h5s5
/signin · /signup · /verify · /reset                                          [7a]  built h2s2
/for-buyers                             Buyer entry surface                         built h5s7
/list-your-business                     Supplier entry surface                      built h5s7
/staff                                  Staff sign in — noindex, unlinked         built h5s7
/account/enquiries                      Buyer enquiry inbox                  [10e]  built h2s3
/account/saved/shortlist                Saved suppliers                             built h8s1
/invite/:token                          Accept a team seat                    [8d]  built h8s1
/account/saved                          Saved searches & alerts              [10e]
/account/suppliers                      Saved suppliers                       later
/account/requirements                   Saved requirements                    later
/account/company                        Company, TRN, team, approvals         [7b]
/review/new?enq=                        Write a review                       [10f]  built h2s6
```

## Tenant — /dashboard

```
/onboarding/claim                       Find or add the business              [2a]  built h6s1 · public
/onboarding/verify                      Prove ownership                       [2b]  built h6s2
/onboarding/kind                        Claim result — how it sells         [2b-s] built h2bs
/onboarding/profile                     Profile basics                        [2c]  built h6s3
/onboarding/locations                   Locations & hours                     [2d]  built h6s4
/onboarding/locations (services)        Coverage areas                      [2d-s] built h2ds
/onboarding/plan                        Pick a plan                           [2e]  built h6s5
/dashboard                              Overview                              [3a]
/dashboard (free variant)               Free-plan overview                   [11a]
/dashboard/setup                        Setup hub                             [8a]  built h8s1
/dashboard/setup/photos                 Task 1 — photos                       [8b]  built h8s2
/dashboard/setup/products               Task 2 — template, first products     [8c]  built h8s3
/dashboard/setup/team                   Task 3 — invite the team              [8d]  built h8s4
/dashboard/setup/done                   Setup complete, once only             [8e]  built h8s5
/dashboard/listing                      Listing profile                       [3b]  built h3 wave 3
/dashboard/locations                    Locations                             [3c]
/dashboard/hours                        Hours & Ramadan                       [3d]
/dashboard/verification                 Verification & documents              [3e]  built h3 wave 3
/dashboard/products                     Catalogue                             [3f]  built h3 wave 2
/dashboard/products/:id                 Product editor                        [3g]  built h3 wave 2
/dashboard/products/import              CSV import mapper                    [11d]  built h3 wave 2
/dashboard/products/export              Catalogue as a spreadsheet           [11d]  built h3 wave 2
/dashboard/services                     Services list                       [3f-s] built h3gs
/dashboard/services/:id                 Service editor — the scope sheet    [3g-s] built h3gs
/dashboard/templates                    Spec templates                        [3h]  built h3 wave 2
/dashboard/templates/:slug              One template, fields and settings      [3h]  built h3 wave 2
/dashboard/templates/:slug/history      Revision history and rollback         [3h]  built h3 wave 2
/dashboard/media                        Media library                         [3i]  built h3 wave 2
/dashboard/leads                        Leads & RFQ inbox                     [3j]  built h3 wave 1
/dashboard/leads/:id                    One lead, and the quote composer      [3j]  built h3 wave 1
/dashboard/leads/:id/thread             Seller message thread                [11b]  built h3 wave 1
/dashboard/quotes                       Quotes sent pipeline                  [3k]  built h3 wave 1
/dashboard/quotes/:ref                  One quote, highlighted                [3k]  built h3 wave 1
/dashboard/quotes/:ref/extend           …with the extend dialog open          [3k]  built h3 wave 1
/dashboard/quotes/export                The pipeline as a CSV                 [3k]  built h3 wave 1
/dashboard/reviews                      Reviews                              [11c]  built h2s6
/dashboard/questions                    Buyer questions                       [1g]  built h5
/dashboard/team                         Team, seats & lead routing            [7d]  built h4
/dashboard/analytics                    Analytics                             [3l]  built h3 wave 4
/dashboard/analytics/export             The four tables as one CSV            [3l]  built h3 wave 4
/dashboard/billing                      Subscription & billing                [3m]  built h3 wave 4
/dashboard/domain                       Your own web address                  [5e]  built h4s6
                                        <label>.businesslistings.me, rewritten by proxy.ts to /b/<label>
/dashboard/billing/change               Change plan                          [11f]  built h3 wave 4
/dashboard/billing/change/keep/:kind    Choose what stays live               [11f]  built h3 wave 4
/dashboard/billing/cancel               Cancel — what changes                [11h]  built h3 wave 4
/dashboard/billing/cancel/confirm       Cancel — reason & confirm            [11j]  built h3 wave 4
/dashboard/billing/invoice/:id          Tax invoice                          [11g]  built h3 wave 4
/dashboard/billing/invoice/:id/pdf      The stored PDF, byte for byte        [11g]  built h3 wave 4
/dashboard/promote                      Sponsored placement                  [11e]
/dashboard/settings                     Settings & notifications              [7e]  built h2s5 (alerts only)
```

## Superadmin — /admin

```
/admin                                  Platform overview                     [4a]  built h4s0
/admin/queue                            Approval queue                        [4b]
/admin/queue/:id                        Review a submission                   [4c]
/admin/queue/conflict/:id               Resolve a conflicting claim           [4c]
/admin/queue/document/:id               Decide a seller's credential          [3e]  built h3 wave 3
/admin/ingest                           Licence importer                     [12a]  built h4s2
/admin/ingest/:id                       One import run                       [12a]  built h4s2
/admin/ingest/dedupe                    Dedupe & merge                       [12b]  built h4s2
/admin/search                           Ranking, boosts, weight history      [12c]  built h4s8
/admin/categories                       Taxonomy                              [4d]  rename h5s6
/admin/categories?tab=kind              Taxonomy — trade kind                [4d-s] built h4ds
/admin/spec-library                     Spec library                          [4e]  built h4e
/admin/spec-library/:id                 One template's fields                 [4e]  built h4e
/admin/catalogue-imports                Concierge catalogue queue            [12i]  built h8s1
/admin/attributes                       Attribute dictionary                  later
/admin/businesses                       Businesses & health                   [4f]  built h4s4
/admin/crm                              Recruitment & accounts               [12d]  built h4s4
/admin/users                            Users                                later
/admin/staff                            Staff, roles & audit                  [4i]  built h4s3
/admin/subscriptions                    Subscriptions                         [4g]  built h4s5
/admin/invoices                         Invoices & credits                   [12e]  built h4s5
/admin/plans                            Plans & entitlements                 [12e]  built h4s5
/admin/dunning                          Failed payments                      [12e]  built h4s5
/admin/tax                              VAT export                           [12e]  built h4s5
/admin/revenue                          Revenue                               [4g]  built h4s5
/admin/reports                          Supplier reports & flags              [4h]  built h4s3
/admin/support                          Support desk & view-as               [12f]  built h4s4
/admin/notifications                    Notification templates              [12g]  built h4s7
/admin/strings                          Localisation                         [12g]  built h4s7
/admin/content/matrix                   Page matrix & content ops             [6f]  built h5s2
/admin/content/lists                    Curated lists index               [6b, 6f]  built h5s2
/admin/content/guide-subjects           Guide subjects                       [10b]  built h5s3
/admin/content/guides                   Guides                          [10b, 6d]  built h5s1
/admin/content/guides/:id               One guide, or new               [10b, 6d]  built h5s1
/admin/content/attribution              Enquiry attribution                  [10i]  built h5s5
/admin/content/home                     Homepage curation                    [12g]  built h4s7
/admin/content/testimonials             Entry page testimonials                     built h5s7
/admin/content/redirects                Redirects                            [12g]  built h4s7
/admin/storefront-templates             Templates & section library      [5c]  built h4s6
/admin/storefront-templates/specimens   Section specimens           [5g, 5h]  built h4s6
/admin/storefront-templates/:id         Builder shell                    [5a]  built h4s6
/b/:slug/d/:document                    Signed link to a published doc   [5c]  built h4s6
/b/:slug/:page                          A template page on a storefront  [5d]  built h4s6
/admin/storefront-templates/:id/theme   Theme presets                    [5b]  built h4s6
/admin/storefront-templates/:id/pages   Page template editor             [5d]  built h4s6
/admin/domains                          Custom domain verification       [5e]
/admin/areas                            Emirates, areas, free zones          [12h]
/admin/api                              API keys & webhooks                  [12h]
/admin/compliance                       PDPL data requests                   [12h]
/admin/audit                            Audit log                             [4i]  built h4s3
```

## Development surfaces

Not part of any of the three products. They exist so a person can see every
state at once, which is the only way to notice that two of them disagree.

Rendered only when `DATABASE_URL` is loopback — see `lib/dev/guard.ts`. The database is
the condition that carries the weight rather than `NODE_ENV`, because Playwright builds
for production and the gallery has to survive that. Before this gate existed they were
prerendered public routes, kept out of search results by a robots directive and nothing
else.

```
/dev                                    Every surface, and which seat opens it      built h8s1
/dev/seat                               Sign in as any seat, on any business        built h8s1
/dev/gallery                            Every component, every state          built h0-h2
/dev/notifications                      Notification templates rendered [7f]  built h2s5
```

### Wave 4 note — board `3l` introduced an event pipeline

`3l` is the first board whose dependency is **capture** rather than a query.
Three of its five funnel stages had no source at all: `SearchQueryLog` recorded
what a buyer typed and never which businesses were returned, and nothing
anywhere counted a buyer looking at a product.

- Four daily rollups — `search_impression_day`, `category_position_day`,
  `product_view_day`, `listing_device_day` — pruned at 90 days by the daily job.
  The grain is a business, a day, and whatever the panel groups by, so a search
  returning twenty listings costs twenty upserts rather than twenty rows.
- `search_impression_day` doubles as the **query** position snapshot;
  `category_position_day` is the **category** one that board `3a`'s card reads.
  Two objects, two tables, deliberately — a rank for a typed phrase and a rank
  in a category listing are different numbers.
- Search impressions are written server-side behind the crawler gate that
  already guards `recordSearch`; product views go through the beacon, like
  `listing_viewed`. A render is not a visit and a crawler is not a buyer.
- **Nothing backfills.** Reveals and enquiries have history; impressions, clicks
  and product views start the day the pipeline ships, which the page states as
  `tracking since`.
- `Enquiry.emirate` is new. The composer always collected it and `fanout` always
  routed on it; the write kept only the free-text area beside it. A null renders
  as `Not stated` rather than a country guessed from an IP.

### Wave 4 note — the `11f` split

`11f` was one board carrying plan change, cancel and a tax invoice. It is now
four: `11f` change plan, `11g` tax invoice, `11h` cancel and `11j` cancel reason.
Two things moved with the split and both are recorded above:

- The tax invoice is at **`/dashboard/billing/invoice/:id`**, not
  `/dashboard/invoice/:id`. It sits under the screen that lists the invoices, and
  the old path had it a level up from everything it belongs to.
- Cancel is **two routes and one spec**: `/dashboard/billing/cancel` is `11h`,
  the dated consequence table, and `/dashboard/billing/cancel/confirm` is `11j`,
  the reason and the confirm. Two specs for two steps is how a step indicator
  drifts from a step count. Step 2 is a route rather than a modal because a
  seller arriving from an email needs somewhere to land and something to return
  to.
- Both stop being reachable once a cancellation is scheduled, and both redirect
  to `/dashboard/billing` — which is where the `Cancellation scheduled` banner
  now carries `Resume Pro` **and the picker**. That banner is `3m`'s amendment,
  and without it *"you pick which ten products stay live"* was a sentence with
  nowhere to act on it.
- The picker is `11f`'s, unchanged, at `/dashboard/billing/change/keep/:kind`.
  A cancellation is a pending `subscription_change` with `kind = cancellation`,
  so it writes into the same three columns the same appliers read at period end.
- `11f`'s **Free column routes here** rather than scheduling a plain plan change.
  A downgrade to Free is a cancellation: it was previously possible to reach one
  with no reason recorded, no `cancelledAt`, no banner and no confirmation email.
- `/dashboard/account/close` is `11i`, which is **not drawn and is blocked**.
  Nothing on either cancel route links to it; the fork is stated and the control
  is inert.
- `11g` shipped with two routes rather than one. `/pdf` serves the file written
  at issue and does not render — a PDF regenerated by a later template is a
  different document from the one a seller filed with their accountant, so a
  missing file is a 404 rather than a fresh render.

## Rules

Three doors, one flow. `/signin` is the neutral one and is where the root 404
sends people. `/for-buyers` and `/list-your-business` are the same sign-in form
with an audience's own copy and its own measured numbers around it. `/staff` is
the console's door: nothing links to it, `robots.ts` disallows it and the page
sets `noindex`, because the staff console is undiscoverable only while nothing
advertises it. All four post to the same server actions in `app/(auth)/actions.ts`
and get the same throttle and the same neutral outcome — a second sign-in *path*
would be a second rate limiter and a second set of bugs, and an entry page that
answered differently for a staff number than for anyone else's would be an
enumeration oracle.

`?as=buyer|supplier` on `/signup` preselects an intent checkbox and nothing else.
`?from=` carries which door a person came through so a refusal returns there; it
is validated by `isSafeNext` and is never a destination for a signed-in session.
Neither grants anything: roles are read from the profile row after the code is
verified.

**`/onboarding/claim` is the one funnel step with no seat.** `2b`–`2e` require a
signed-in claimant, because they write rows and a claim has to belong to
somebody; `2a` only searches the public licence register, and a supplier who has
to create an account to find out whether we hold their business is a supplier
who does not find out. The account is asked for at the point it becomes
necessary — choosing a listing — and the chosen listing rides through the
sign-up in `next`. Unauthenticated is not unmetered: the search is rate-limited
per caller through `lib/rate-limit`, keyed on the actor where there is one and on
the forwarded address where there is not. The page is `noindex, follow` and is
deliberately *not* in `robots.ts`'s disallow list: a disallow would stop a
crawler reading the `noindex` and stop it following the links out, which is the
half of the directive we want.

A signed-in seller already holding a claimed listing is redirected from `2a` to
`/dashboard?notice=one_business`, which states the reason. Claiming a second
business is not something this flow does.

`/onboarding/profile` is where the split between a legal name and a display name
is created, and the only screen carrying both as fields. The trade name is
locked; the display name is validated against legal suffixes and against words
its own categories already carry, and a near-match to a verified listing in the
same emirate is **accepted and flagged** to the trust queue rather than refused —
in a market where a hundred firms are called Al Something Trading it is usually
a coincidence, and a form cannot tell that from impersonation.

Categories are capped by `plan.categoryLimit`, which counts the primary. The
screen shows two counters over the same two arrays and both are right: the extras
allowance is the cap minus the primary, the strength meter counts the total. An
extra whose category is not covered by the licence's stated activity is taken,
flagged, and left out of the enquiry fan-out **for that category only** until a
reviewer clears it.

`/b/:slug/s/:service` is the scope table where the spec table is. Its row order
comes from `ScopeSheetFamily`, so every firm in a family renders the same rows in
the same order — that is the comparison, and sorting per service would destroy
it. `/b/:slug/services` is the **link surface**, not board `1e-s`: `1e-s` is the
full public catalogue and it replaces the index behind that tab, which stays.

`indicativeFee` reaches neither. It is excluded from `publicServiceFor`'s
`select`, so it cannot appear in the page, the payload, the meta description or
the structured data — board `3g-s` B5 asks for the assertion to live in the
response type rather than the template, and a field that is never fetched is the
strongest version of that.

`/onboarding/locations` is **one route with two bodies**, chosen by
`Business.sellsKind` — board `2d-s` B1. A seller who sells goods gets board 2d
unchanged: a branch list, a map, a pin, hours, and a publish gate on
coordinates. A seller who sells work gets a delivery mode, a set of coverage
areas and a free-zone registration list, with no map and a publish gate on one
mode and one area. A seller who sells both gets both, grouped and labelled, on
one step. The step rail renames itself accordingly, on all five steps, so the
name does not change under the seller between step 2 and step 4.

There is no `/onboarding/coverage`. The board's header names one; B1 in the same
document says "conditional screen body keyed on `Business.sellsKind`, not a
second route", and the second is the one that is right — a second URL is a second
place for `goLive` to be called from and a bookmark that sends a seller to the
wrong body after they change their mind.

`/onboarding/verify` takes `?business=` as either an id or a slug. Board 2a hands
over an id, which is what a link built by a screen carries; a link built by a
*person* — the recruitment mail board 12d sends — carries a slug, because
`?business=al-bariq-trading-llc` is a URL somebody can write and check and
`?business=cmtmb7ac700di26itwegmpf56` is one they can only paste and hope. Both
resolve to the same row and neither grants anything: the route requires a seat,
and submitting queues a review rather than granting a tier. A business already at
`VERIFIED_TIER` redirects to `/onboarding/profile` — there is nothing left for
that screen to guard.

`/b/:slug/reviews` takes `?show=` (all · accepted · photos · critical), `?sort=` (recent ·
highest · lowest · detailed) and `?page=`. Every narrowed view is `noindex, follow` and
canonicalises to the bare path — sixteen filter-and-sort permutations of one list is the
doorway-page shape `/b/:slug/products` already rules out, and the review text is the thing
worth ranking. `?page=` is cumulative: page 3 renders thirty rows, so "Load more" is an anchor
a buyer can go back through rather than an endless list. The route 404s where the business has
no published review, because `StorefrontHeader` hides a tab with a zero count and a tab that
does not exist should not have a URL that renders.

`/guides/:slug` resolves two kinds of page from one segment: a published article
first, then a guide subject. Next cannot hold two dynamic siblings, and board
10b puts the subject chips at real URLs of their own — `/guides/buying-safely`
alongside `/guides/check-a-uae-trade-licence`. `guideSlugCollision` refuses
either from taking the other's slug, and `how-we-check` is a reserved segment
because a fixed route answers before the dynamic one and a guide minted there
would have no URL at all. A subject with no published guides 404s rather than
serving a self-canonical page nothing links to.

Slugs are immutable once published. Renaming a category or merging two listings creates a
301 automatically; deleting a page without one is blocked at the service layer.

Area landing pages and subcategory pages publish only above the thresholds in board 6f, and
the rule is per trade rather than one set of numbers: a page needs its **need** in listings —
the higher of the category's own floor and 25 listings per 1,000 monthly searches for that
scope — with 30% of them verified, the category's word floor of intro copy, and four FAQ
rows of which two are answerable only about that scope.

A page that publishes stays live down to four fifths of its need, and for its first 30 days
it stays live below that too. Those two rules exist because a single threshold used in both
directions makes a page at exactly the floor publish and unpublish daily, and every cycle is
a sitemap change. A scope that has never published has no URL and 404s; one that was live and
came down redirects permanently to the emirate page for that trade, because the address has
accumulated ranking a 404 would discard.

All of it is enforced in code, not by editorial discipline, and the numbers are edited on
`/admin/content/matrix` behind an impact preview and a second approver.

## Why the product editor is `:id` and not `:sku`

The spec, the epic and this file all said `/dashboard/products/:sku`. The route
is `:id` and stays that way.

`Product.sku` is `String?` with no unique constraint — the only per-business
uniqueness on the table is `@@unique([businessId, slug])`. So a sku route is
unaddressable for a product that has no sku, ambiguous for two that share one,
and would need a new unique index to be either. That is a migration, and a
migration for a cosmetic match to a line in a document is the wrong trade. The
catalogue links by id and the e2e waits on `/dashboard/products/\w+`.
