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
/b/:slug (unclaimed variant)            Unclaimed listing                    [10g]
/rfq/new                                RFQ fan-out                           [1h]  built h2s3
/enquiry/:id                            Enquiry sent + tracking               [1i]  built h2s3
/enquiry/:id/compare                    Compare quotes                        [1n]  built h2s3
/enquiry/:id/accepted                   Accepted quote record                 [7c]  built h2s3
/enquiry/:id/thread/:seller             Negotiation thread                   [10h]  built h2s4
/pricing                                Plans                                 [1l]  built h1s1l
/guides                                 Guide index                          [10b]  built h5s1
/guides/:slug                           Guide article                         [6d]  built h5s1
/best/:slug                             Curated list                          [6b]  built h5s4
/categories                             Category index                        [6c]  built h5s2
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
/onboarding/profile                     Profile basics                        [2c]  built h6s3
/onboarding/locations                   Locations & hours                     [2d]  built h6s4
/onboarding/plan                        Pick a plan                           [2e]  built h6s5
/dashboard                              Overview                              [3a]
/dashboard (free variant)               Free-plan overview                   [11a]
/dashboard/setup                        Setup hub                             [8a]  built h8s1
/dashboard/setup/photos                 Task 1 — photos                       [8b]  built h8s2
/dashboard/setup/products               Task 2 — template, first products     [8c]  built h8s3
/dashboard/setup/team                   Task 3 — invite the team              [8d]  built h8s4
/dashboard/setup/done                   Setup complete, once only             [8e]  built h8s5
/dashboard/listing                      Listing profile                       [3b]
/dashboard/locations                    Locations                             [3c]
/dashboard/hours                        Hours & Ramadan                       [3d]
/dashboard/verification                 Verification & documents              [3e]
/dashboard/products                     Catalogue                             [3f]
/dashboard/products/:sku                Product editor                        [3g]
/dashboard/products/import              CSV import mapper                    [11d]
/dashboard/templates                    Spec templates                        [3h]
/dashboard/media                        Media library                         [3i]
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
/dashboard/analytics                    Analytics                             [3l]
/dashboard/billing                      Subscription & invoices               [3m]
/dashboard/domain                       Your own web address                  [5e]  built h4s6
/dashboard/billing/change               Plan change                          [11f]
/dashboard/billing/cancel               Cancel                               [11f]
/dashboard/invoice/:id                  Tax invoice                          [11f]
/dashboard/promote                      Sponsored placement                  [11e]
/dashboard/settings                     Settings & notifications              [7e]  built h2s5 (alerts only)
```

## Superadmin — /admin

```
/admin                                  Platform overview                     [4a]  built h4s0
/admin/queue                            Approval queue                        [4b]
/admin/queue/:id                        Review a submission                   [4c]
/admin/queue/conflict/:id               Resolve a conflicting claim           [4c]
/admin/ingest                           Licence importer                     [12a]  built h4s2
/admin/ingest/:id                       One import run                       [12a]  built h4s2
/admin/ingest/dedupe                    Dedupe & merge                       [12b]  built h4s2
/admin/search                           Ranking, boosts, routing             [12c]  built h4s8
/admin/categories                       Taxonomy                              [4d]  rename h5s6
/admin/spec-library                     Spec templates                        [4e]
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
/admin/content/matrix                   SEO page matrix                       [6f]  built h4s7
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

Slugs are immutable once published. Renaming a category or merging two listings creates a
301 automatically; deleting a page without one is blocked at the service layer.

Area landing pages and subcategory pages publish only above the thresholds in board 6f:
60 listings, 30% verified, 250 words of intro copy. They auto-unpublish if supply drops
below the floor. This is enforced in code, not by editorial discipline.
