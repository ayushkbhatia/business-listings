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
/search?q&emirate&kind&…                One blended set, four filtering tabs [1c-s, 10c, 10c-s] built h10c
/search (no words, or ?bounds=)         The directory on a map                [1c]
/search?tab=products                    Legacy — resolves to ?kind=products  [10c]
/compare?p=…                            Products side by side — one trade, ≤4 [10d] built 10d
                                        — no ?p=: the bl_cmp tray; ?diff=1 hides matching rows
/b/:slug                                Storefront overview                   [1d]
/b/:slug (sells work)                   Storefront, catalogue taken out     [1d-s] built h1ds
/b/:slug (contact revealed)             The landline asked for, in place     [1d-v] built 15 Sep — was 13a, never routed
/b/:slug/credentials                    Credentials tab, with a count       [1d-s] built h1ds
/b/:slug/coverage                       Coverage, one row per service       [1f-s] built h1fs
/b/:slug/products                       Catalogue                             [1e]
/b/:slug/branches                       Branches & hours                      [1f]
/b/:slug/reviews                        Reviews & ratings                     [1m]  built h4s6
/b/:slug/p/:product                     Product + spec table                  [1g]
/b/:slug/services                       Services list — rows, not a grid    [1e-s] built h1es
/b/:slug/s/:service                     Service detail — the scope table    [1g-s] built h3gs
/b/:slug (unclaimed variant)            Unclaimed listing                    [10g]
/b/:slug?report=1                       Report a listing — modal over the storefront [13c] built 13c · noindex
/rfq/new                                RFQ fan-out                           [1h]  built h2s3
/rfq/new (trade sold by the job)        Brief — five questions, no quantity [1h-s] built h1hs
/rfq/new?revise=:ref                    Add detail to a sent enquiry          [1i]  built h1hs
/rfq/new?from=:ref                      Send a sent enquiry to more suppliers [1i]  built h1i
/rfq/new?resend=:ref                    Re-send an expired enquiry            [10e] built 10e
/enquiry/:id                            Enquiry sent + tracking               [1i]  built h2s3
/enquiry/:id/compare                    Compare quotes                        [1n]  built h2s3
                                        — an enquiry for work: proposals    [1n-s] built 14 Sep (not /account/rfq/:id)
/enquiry/:id/accepted                   Accepted quote record · accepted proposal [7c · 7c-s] built h7c, 7c-s
/enquiry/:id/accepted/pdf               Accepted quote or proposal as a PDF (route handler) [7c · 7c-s] built h7c, 7c-s
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
/report                                 Report hub — find the listing; ?ref= looks up a report [13c] built 13c · noindex
/report/:slug                           Report a listing — the page the modal degrades to [4h · 13c] built 4h, 13c
/terms                                  Terms of use, 16 clauses             [13f]  built h7s1
/privacy                                Privacy policy, 12 sections          [13g]  built h7s1
/cookies                                Cookie policy + 9-cookie register    [13h]  built h7s1
/cookies/settings                       Consent toggles                       later
/maintenance                            Scheduled maintenance — 503, Retry-After [13e] built 13e
                                        served by proxy.ts on every route a window takes down; 404 with no window
/verification-policy · /review-policy                                        [10j]  built h5s5
/signin · /signup · /verify · /reset                                          [7a]  built h2s2, rebuilt 7a
/auth/reset?token=                      Reset link landing (reads, never consumes) [7a]
/for-buyers                             Buyer entry surface                         built h5s7
/list-your-business                     Supplier entry surface                      built h5s7
/staff                                  Staff sign in — noindex, unlinked         built h5s7
/staff/invite/:token                    Accept a staff role — noindex         [4i]  built 4i
/account/enquiries                      Buyer enquiry inbox                  [10e]  built 10e
/account/saved/shortlist                Saved suppliers                             built h8s1
/invite/:token                          Accept a team seat                    [8d]  built h8s1
/account/saved                          Saved searches & alerts              [10e]  built 10e
/account/suppliers                      Saved suppliers                       later
/account/requirements                   Saved requirements                    later
/account/company                        Company, TRN, team, approvals         [7b]
/review/new?enq=&about=&edit=          Write a review · your review         [10f]  built h2s6, 10f
/account/reopen/:token                  Reverse a closure from the email      [11i]  built h3 wave 4
/account/closed                         Closure confirmed — session-free      [11i]  built h3 wave 4
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
/dashboard/setup (services)             Setup hub — four tasks              [8a-s] built h8as
/dashboard/setup/credentials            Task 1 (services) — credentials     [8b-s] built h8bs
/dashboard/setup/services               Task 2 (services) — sheet + services [8c-s] built h8cs
/dashboard/scope-templates              Scope templates                     [3h-s] built h3hs
/dashboard/scope-templates/:slug        One template, its services, offers  [3h-s] built h3hs
/dashboard/setup/photos                 Task 1 — photos                       [8b]  built h8s2
/dashboard/setup/products               Task 2 — template, first products     [8c]  built h8s3
/dashboard/setup/team                   Task 3 — invite the team              [8d]  built h8s4
/dashboard/setup/done                   Setup complete, once only             [8e]  built h8s5
/dashboard/listing                      Listing profile                       [3b]  built h3 wave 3
/dashboard/locations                    Locations                             [3c]
/dashboard/coverage                     Coverage — default and per service    [3c-s] built 13 Sep
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
                                        — an enquiry for work: the proposal [3j-s] built 14 Sep, no rail
/dashboard/leads/:id/thread             Seller message thread                [11b]  built h3 wave 1
/dashboard/leads/:id/attachments/:doc   The buyer's file, signed for 2 min  [1d-s] built h1ds
/dashboard/leads/phone                  Phone leads — buyers who revealed   [1d-v] built 15 Sep
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
/dashboard/promote                      Sponsored placement — one trade, one emirate [11e]  built 11e
/dashboard/settings                     Settings & notifications              [7e]  built h2s5 (alerts only)
/dashboard/account/close                Close account — the board             [11i]  built h3 wave 4
/dashboard/account/close/confirm        Close account — confirm               [11i]  built h3 wave 4
```

## Superadmin — /admin

```
/admin                                  Platform overview                     [4a]  built h4s0
/admin/queue                            Approval queue                        [4b]  built board pass
/admin/queue?kind=:kind&mine=1          The same queue, one kind, assigned    [4b]  built board pass
/admin/queue/rules                      Auto-check rules (ops lead)           [4b]  built board pass
/admin/queue/:id                        Review a submission                   [4c]
/admin/queue/claim/:id                  Decide an uncontested claim           [4b]  built board pass
/admin/queue/claim/:id/document         The claim's licence, signed, 2 min    [4b]  built board pass
/admin/queue/location/:id               A branch outside the licence          [4b]  built board pass
/admin/queue/credential/:id             Review a credential against a register [4c-s] built board pass
/admin/queue/credential/:id/document    The credential's certificate, signed  [4c-s] built board pass
/admin/queue/conflict/:id               Resolve a conflicting claim           [4c]
/admin/queue/document/:id               Decide a seller's credential          [3e]  built h3 wave 3
/admin/ingest                           Licence importer                     [12a]  built h4s2, board pass
/admin/ingest/:id                       One import run, and its records      [12a]  built h4s2, board pass
/admin/ingest/:id/rejects               Rejected records as CSV, raw rows    [12a]  built board pass
/admin/ingest/categorise                Categorisation queue, by activity    [12a]  built board pass
/admin/ingest/categorise?run=:id        The same queue, one run              [12a]  built board pass
/admin/ingest/records/:id               One staged record, raw row verbatim  [12a]  built board pass
/admin/ingest/dedupe                    Dedupe queue, one pair at a time     [12b]  built h4s2, board pass
/admin/ingest/dedupe?run=:id            The same queue, one run              [12b]  built board pass
/admin/leads                            Every phone lead (ops lead)         [1d-v] built 15 Sep
/admin/leads?supplier=:name             The same, one supplier               [1d-v] built 15 Sep
/admin/search                           Ranking, boosts, weight history      [12c]  built h4s8
/admin/search?vector=services           The services vector, same board      [12c-s] built s19
/admin/categories                       Categories — tree and editor          [4d]  built board pass
/admin/categories?c=:id                 The same, one category open           [4d]  built board pass
/admin/categories?tab=kind              Categories — trade kind              [4d-s] built h4ds
/admin/spec-library                     Spec library                          [4e]  built h4e
/admin/spec-library?view=scope          Scope-sheet families                [4e-s] built h4es
/admin/spec-library/:id                 One template's fields                 [4e]  built h4e
/admin/catalogue-imports                Concierge catalogue queue            [12i]  built h8s1
/admin/attributes                       Attribute dictionary                  later
/admin/businesses                       Businesses & health — search, filters [4f]  built 4f
/admin/businesses/:id                   One account: health, signals, decisions [4f] built 4f
/admin/businesses/export                The filtered list as CSV              [4f]  built 4f
/admin/crm                              Recruitment & accounts — ?tab=upgrade|renewal [12d]  built 12d
/admin/users                            Users                                later
/admin/staff                            Staff, roles, invitations & matrix    [4i]  built 4i
/admin/subscriptions                    Subscriptions                         [4g]  built h4s5
/admin/invoices                         Invoices & credits                   [12e]  built h4s5
/admin/plans                            Plan config — the matrix, add a plan [12e]  built 12e
/admin/placement                        Placement rate card, ten demand bands [11e]  built 11e
/admin/dunning                          Failed payments — the one list       [12e]  built 12e
/admin/revenue                          Revenue — one Dubai month, ?period=   [4g]  built 4g
/admin/revenue/export                   The month as CSV, formulas and filter [4g]  built 4g
/admin/reports                          Reports & flags — one queue, ?type=    [4h]  built 4h
/admin/reports/:id                      One report: evidence and the decision  [4h]  built 4h
/admin/reports/disputes/:id             One review dispute, on its own screen  [4h]  built 4h
/admin/reports/detectors                Detection thresholds, ops lead         [4h]  built 4h
/admin/support                          Support desk & view-as               [12f]  built h4s4
/admin/notifications                    Notification templates              [12g]  built 12g
/admin/notifications/channels           Carrier per channel, 30-day health   [12g]  built 12g
/admin/notifications/deliveries         Delivery log, keyset-paged           [12g]  built 12g
/admin/notifications/quiet-hours        Quiet hours as applied, read-only    [12g]  built 12g
/admin/strings                          Strings — All (catalogue report)     [12g]  built h4s7
/admin/strings/paired                   Strings — Paired                    [12g-s]  built 12g-s
/admin/content/matrix                   Page matrix & content ops             [6f]  built h5s2
/admin/content/lists                    Curated lists index               [6b, 6f]  built h5s2
/admin/content/guide-subjects           Guide subjects                       [10b]  built h5s3
/admin/content/guides                   Guides                          [10b, 6d]  built h5s1
/admin/content/guides/:id               One guide, or new               [10b, 6d]  built h5s1
/admin/content/attribution              Enquiry attribution                  [10i]  built h5s5
/admin/content/home                     Homepage curation                     [6h]  built 6h
/admin/content/testimonials             Entry page testimonials                     built h5s7
/admin/content/redirects                Redirects                            [12g]  built h4s7
/b/:slug/d/:document                    Signed link to a published doc         built h4s6
/admin/domains                          Custom domain verification       [5e]
/admin/areas                            Emirates, areas, free zones          [12h]
/admin/api                              API keys & webhooks                  [12h]
/admin/compliance                       PDPL data requests                   [12h]
/admin/audit                            Audit log, filtered and paged         [4i]  built 4i
/admin/audit/export                     The log as CSV, carrying the filter   [4i]  built 4i
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

### Board `11e` note — a slot is a trade in a place, and its price is measured

Sponsored placement was one slot per category, everywhere, at a flat AED 450.
The 17 Sep board sells a **scope** — one trade in one emirate — and prices it
from what buyers did there. Four things follow, and three are above:

- **`/dashboard/promote` sells emirate-scoped slots only.** The column stays
  nullable because slots bought before the emirate existed still run and still
  render; `takeSlot` refuses to create another country-wide one, because a
  national slot silently covers seven scopes and prices none of them.
- **`/admin/placement` is the rate card** — ten demand bands, priced from a
  floor and a step the owner can move without a deploy. It sets what a rung
  costs and never which rung a trade is on: that is cut monthly from measured
  traffic, which is what makes the price defensible to the seller paying it.
- **Two new counters feed it.** Appearances were already recorded by
  `recordCategoryPositions` on every results load; clicks were attributable to
  no page at all until `result_clicked`, a browser beacon carrying the trade and
  the emirate and no business id — this counts demand for a scope, never
  performance of a listing.
- **The waiting list tells everybody.** `placement_slot_freed` goes to the whole
  queue the day a slot ends and the first to answer takes it, which is the
  release rule ratified on 17 Sep. The position is still recorded and shown; it
  no longer decides anything on its own.

### Board `12e` note — plan config, and the route that went with the VAT export

The 12e board-level export of 16 Sep reshapes `/admin/plans` and removes one
route. Four things are recorded above and here:

- **`/admin/tax` is gone**, and so is `/admin/tax/export` and
  `lib/billing/vat.ts`. The spec: *"the VAT return export — Q3 2026 totals and
  the `Export FTA-format file` button. Out of scope — not needed. `/admin/tax`
  left the route with it."* `11g` remains the per-invoice tax surface and is
  unaffected: the platform still charges 5% VAT on subscriptions and placement,
  every invoice still stores the rate it used, and `/admin/revenue/export` is
  still the finance CSV. What is gone is the quarterly return, which the issuing
  company has no TRN to file.
- **`/admin/plans` is a matrix**, entitlements down and plans across, with every
  cell editable and a review step between the table and the write. It was a row
  per plan behind an Edit button — the transpose — which answered "what does Pro
  allow" and not "what do the three allow, compared".
- **The three commerce routes carry one tab strip**: Plans & entitlements,
  Failed payments, Invoices & credits, gated per item because `/admin/invoices`
  is finance's `subscription.credit` and the other two are not.
- **`/admin/dunning` is the only list of failed payments.** The board drew a
  second one on the plan screen over a different set of businesses; that panel is
  a count and a link. There are still no controls on it: `12i` audits the notices
  and `12j` sanctions a send, and neither is exported.

### Board `10d` note — the comparison compares products, and the tray is a cookie

`/compare` compared suppliers — ten fixed business attributes, slugs in `?p=`,
the tray carried in every results URL as `?compare=`. Board `10d` (18 Sep) makes
it the screen `10c`'s *matched on spec fields* promises: up to four **products**,
one trade, one spec template. Four route-level consequences:

- **`?p=` carries product ids now**, not seller slugs. A link from before the
  change names no product and lands on the empty state, which says what the
  page compares and where to start. Ids that are not ids are never looked up.
- **`?compare=` is gone from every results URL.** The tray is the `bl_cmp`
  cookie (`docs/telemetry.md` §4b), so it follows a buyer from a search to a
  product page to a seller's catalogue instead of dying on the first link that
  did not copy it. `compare` stays in the search query's reserved keys so an old
  link cannot turn it into a spec facet.
- **`POST /api/compare` is the tray's one writer** — a route handler, not a
  Server Action, because an action that sets a cookie re-renders the page it
  was called from, and on `/search` that is the whole loader for a tick. With
  JavaScript it answers JSON; without, it 303s back to the page it came from.
  Same-origin only, bodies over 2 KB refused, never cached.
- **On a seller's subdomain** every path is the storefront's (`proxy.ts`), so
  the tray links to the directory's `/compare` absolutely, with the set in `?p=`.
  `/api/*` is exempt from the rewrite, so the tick works there unchanged.

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
- `/dashboard/account/close` is `11i`, and it is **account, not billing**: the
  sidebar shows Settings active and the Settings page carries the owner-only
  card that links to it. Both cancel routes now link to it where the seller says
  they are closing the business. The URL is four things, decided in order: the
  reversal screen for an owner whose closure revoked their seat, a 404 for anybody
  who is not the owner (staff viewing-as included), the platform notice when a
  lapsed licence started it, and the board — blocked or clear.
- `/dashboard/account/close/confirm` redirects back to the board while anything
  blocks, so the confirm step cannot be reached with a paid plan or an unanswered
  quote standing. On success it redirects to **`/account/closed`**, a page with
  no session: closure ends the owner's seat inside the action, and a dashboard
  route re-rendered after that is a 404. The page reads a short-lived httpOnly
  cookie for the dates and the masked address, and says less without it.
- `/account/reopen/:token` is the email's link. The GET renders and changes
  nothing — mail scanners follow links — and the button on it posts the reversal.
  Rate-limited as `closure_reopen`, noindex.
- A closed `/b/:slug` renders a noindex notice with the reviews the business
  earned, reachable by direct link; every subroute redirects to it temporarily,
  because a closure can still be reversed.
- `11g` shipped with two routes rather than one. `/pdf` serves the file written
  at issue and does not render — a PDF regenerated by a later template is a
  different document from the one a seller filed with their accountant, so a
  missing file is a 404 rather than a fresh render.
- `10e`: `/account/enquiries` filters by `?status=awaiting|quotes_in|accepted|expired`
  and pages by `?page=`; the chip counts and the rows come from one read. `/account/saved`
  is the full list the inbox's three-row panel links to with *View all N* (Q2). Opening a
  saved search is a POST, not a link, because it clears the new-match count and a prefetch
  would press a GET. `/rfq/new?resend=` is signed in only: it refuses an open, accepted or
  already re-sent enquiry with a page that says which, and the send records `resentFromId`
  only after re-checking all three.
- The account menu with *Sign out* (Q1) renders on public pages that are already dynamic.
  A static page keeps the signed-out header rather than giving up its cache to learn who is
  looking. Sign-out is a POST to `signOutAction` and lands on `/`.

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

`/dashboard/setup` is **one route with two task sets**, chosen by
`Business.sellsKind` — board `8a-s` B1. A seller of goods gets three cards and
the goods weights; a seller of work gets four, credentials first at 32 points and
photographs last at 4; a seller who is both gets five and one renormalised score.
`profile_score` stays one integer on one column, recomputed idempotently, and
what changes is the table it is measured against.

The credentials card points at `/dashboard/setup/credentials`, board `8b-s`, and
pointed at `/dashboard/verification` until that shipped. **The two surfaces stay
distinct and the split is worth stating:** board 3e is *documents* — a file, a
public-visibility switch and a storefront list — while `8b-s` is *typed
credentials*, a kind with a tier the system assigns from it. A certificate added
on the task screen writes a private `Document` row that 3e lists, because it is
the same file and a second store for it would be a second place to get privacy
wrong.

The trade licence is on neither as a credential row. It lives on `Business` —
number, authority, expiry, `verifiedAt` — and `8b-s` renders it read-only from
there. A `Credential` row beside it would be a second source of truth for the
only fact on a listing anybody has checked.

**Nothing on `/dashboard/setup/credentials` is required**, and that is enforced
by there being no refusal in the code rather than by a form that permits empty
fields: `lib/credentials/service.ts` has exactly two failures, a kind that is not
a kind and a business that does not exist. `trust` is assigned from the kind and
is not an input. `CHECKABLE_KINDS` is one entry long — the FTA tax agent number —
and `lib/credentials/fta.ts` is the seam rather than the integration: no register
is configured anywhere on this platform, so every number saves as a claim with
`register_unavailable` surfaced inline.

`/dashboard/setup/services` is **two steps and the order is load-bearing** — board
`8c-s` B1. The sheet decides which rows a service has, so a service added before one
is chosen has nowhere to put its values; step 2 is inert until
`Business.scopeSheetFamilyId` is set, and `seedFromCommonServices` refuses on the
server as well, because a disabled fieldset is a hint rather than a gate.

**A family resolves business choice → `Category.scopeFamilyId` up the tree → the
seeded default.** The business column is an override rather than a second source of
truth, and it has to win for step 1 to mean anything: all 440 category rows are null,
so without it every seller resolves to `general` and the choice would change nothing.

**Publishing and counting are two rules.** `mayPublish()` still returns `true`
unconditionally — gate publication on a score and sellers type "TBC" into six fields —
but the hub's task 2 counts only services that are live **and** at `COUNTING_BAR`,
four of the six required fields. A thin service is published, findable and excluded,
and the screen names the missing fields rather than saying "incomplete". Four modules
read that rule and all four share `COUNTABLE_SELECT` in `lib/services/setup-sheet.ts`.

`/admin/spec-library?view=scope` is board `4e-s` — a tab rather than a route, because
spec sheets and scope sheets are the same artefact for the two halves of the directory.
**Five families**, and the `general` fallback is not one of them: it is what an
unassigned subcategory resolves to, deliberately usable and noticeably worse.

A family varies exactly two things — which fee bases make sense and which credential is
prompted — plus the optional rows it adds and their order. **The six required fields are
columns on `Service`**, so a family cannot touch them by construction rather than by
review. `feeBasisEnum` is per family and is what `3g-s` validates against server-side;
removing one **flags the services holding it and never clears them**. `rowOrder` is what
`1g-s` renders, so a reorder reshapes every published page in the family and the count
is stated before the save.

`credentialKind` is **prompted, never gating** — nothing reads it on a publish path.
Professional services prompts nothing on purpose: its column reads *regulator-dependent*,
and the regulator depends on the subcategory, so naming one would prompt a law firm for a
tax agent number.

`/dashboard/scope-templates` is **not** `/dashboard/templates` with a different
field list, whatever `3h-s`'s handoff says. Board `3h` is an *overlay* — one
`SellerTemplate` per platform template per business, storing only overrides, with
draft → apply → revision → rollback and a history route. `3h-s` is many templates
per business, cloned into services, with a usage count and a per-service offer.
The two share a word and nothing else; the one idea genuinely borrowed is that a
change is proposed and reviewed before it lands.

**Five fields travel and four never do.** Engagement type, fee basis, delivered
where, deliverable and the accreditation row are pre-filled; service name, scope,
excluded and turnaround are left per service. `scope` and `excluded` are `3g-s`
B6; **name and turnaround are `3h-s`'s correction to it**, and turnaround is the
interesting one — templating it would make a clone arrive complete and produce
four services claiming the same turnaround. The rule is a CHECK on
`scope_template.values`, not a form: B3 is right that UI-only avoidance does not
survive an import script.

**A template edit never writes through.** `saveTemplate` writes one row; the
offers are the difference between the template and each service, computed on
read. Only a decline is stored, and it carries the refused **value** so a
template edited again to something else offers again. Accepting goes through
`patchServiceField`, so `3g-s`'s fee-basis rule and the change log both apply.

`/b/:slug/s/:service` is the scope table where the spec table is. Its row order
comes from `ScopeSheetFamily`, so every firm in a family renders the same rows in
the same order — that is the comparison, and sorting per service would destroy
it. `/b/:slug/services` is board `1e-s`'s list: long cards with the same four
fields in the same order, sorted by ninety-day enquiry volume with the seller's
drag order as the tiebreak, filterable by `?engagement=` and `?fee=` (both
`nofollow` and `noindex`; `?page=` alone stays crawlable at thirty a page). It
renders for a firm that sells work even with nothing live, because its catch-all
enquiry is the page's release valve; a goods seller with no services 404s.

`/b/:slug` for a firm whose `sellsKind` is `services` is **its own composition**,
not the goods overview with sections hidden — board `1d-s`. It has no catalogue
tab and `/b/:slug/products` 404s for it (B1); `/b/:slug/credentials` exists for
any firm that sells work and holds a credential. Which tabs a storefront has is
`lib/storefront/tabs.ts`, read by the header, every tab route and the sitemap, so
the three cannot disagree. A firm that sells `both` keeps the goods overview and
gains the services and credentials sections, with a service row opening its
composer in a drawer. The overview takes `?service=<slug>`, which the composer
opens on (B11) — `1g-s`'s *Enquire about this* and the services tab link there.
`services`, `s`, `credentials` and `coverage` are reserved template-page slugs.
`/b/:slug/coverage` replaces `/b/:slug/branches` for a firm that sells only work — the old
address 308s to it — and 404s for a seller of goods; a firm selling `both` has both tabs.

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
