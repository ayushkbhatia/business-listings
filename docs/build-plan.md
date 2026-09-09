# The build plan — 44 boards, phase by phase

**Audited against the working tree at `d646086`, 9 Sep 2026.** Supersedes the sequencing in
`Epic — Pending build plan`, which was written from the design export tracker and is provisional
by its own admission (§2 of that document asked for exactly this audit before anything was
sequenced).

Read this file before starting any board. Each phase names its steps, and each step names the
file and line the work is anchored to. When a step lands, tick it here in the same commit.

---

## 1 · The finding

| State | Count | What it means |
|---|---|---|
| **built** | **0** | route, model, service, tests, and the screen does its job end to end |
| **partial** | **31** | real work landed; a named control, state, writer or gate is absent |
| **scaffold** | **9** | a route or a model exists and the feature behind it does not |
| **not started** | **4** | nothing in the tree |

Sixteen boards were downgraded when a second pass was told to refute the first — **eight of them
from `built`**. An audit run once, without an adversary, would have reported the storefront
builder finished.

The epic's "44 pending" counts **design exports, not code**. Forty of the 44 already render. That
changes the unit of work from *draw a screen* to *name the missing control, state, writer or gate
and add it*.

### The four corrections to the epic

1. **The work is finishing, not designing.** Only `13c`, `13b`, `6g` and `13e` are genuinely
   absent.
2. **The enquiry loop is not missing — it is built and broken, in production.** The epic puts the
   buyer half in its Phase 5 and calls it the largest coherent gap. Every route exists. The
   tracking page's own Compare button 404s, and the live review-request email links a URL that
   `tests/e2e/reviews.spec.ts:40` *asserts* returns 404. It moves to Phase 3.
3. **The storefront builder is one shipped system, and its gap was smaller than reported.** Eight
   "from scratch" boards are a working sector-scoped tool with fifteen renderers and a publish
   path with an integration test. Nothing served a hostname — but the claim that no middleware
   existed was wrong: Next renames it `proxy.ts` here, and that file was already wired. Closed on
   9 Sep 2026 by the subdomain work.
4. **Half the dependency graph is not load-bearing.** Twenty-one boards report `blockedBy:
   nothing`. `10a` does not wait on `4d`. `10c` is not gated on D3 — it has no facet rail at all.
   `10d` compares ten fixed business attributes and touches the dictionary nowhere. Three real
   chains survive: D5 → `4d`, D2 → `11e`, and `12a` → `12b` → `4b`.

### The ordering principle

The epic's was *whoever owns the model goes before whoever renders it*. The models mostly exist,
so it changes to:

> **What is live and wrong, before what is live and thin, before what does not exist yet.**
> Severity outranks dependency when the dependency is already satisfied.

---

## 2 · The six decisions

**All six answered by the owner on 9 Sep 2026.**

| # | Decision | Answer | Status |
|---|---|---|---|
| **D1** Plan-limit config | Ratify the seven numbers | **Shipped** | migration `20260928090000_plan_caps_ratified` |
| **D2** Placement term | The slot belongs to the subscription | **Shipped** | #152 |
| **D3** Attribute dictionary | **No.** Comparison stays at business level | **Shipped** | panel rebuilt on real data (#154); table dropped (#155) |
| **D4** Enquiry cap | Keep it, stack the leads, **paywall the unlock**. Buyers never see capacity | **Settled, deferred** | GTM work, later |
| **D5** Services | **Their own screens**, per subcategory | **Settled** | `docs/services-spec.md`, awaiting handoffs |
| **D6** Guide bylines | A named editor now, more names later | **Shipped** | #153 — Ayush Bhatia, Founder |

Two of the answers changed what was proposed, and both changes matter:

- **D3 came back "no".** The attribute-dictionary migration is off the plan entirely. `10d`
  stays as it is — ten fixed business attributes — and `10c`'s facet rail can still work inside
  a scoped category, because `SpecField` remains per-template. What is now dead rather than
  half-built: `SpecFieldProposal` and its counter, which had no writer anyway. Retired — the
  panel was rebuilt on `SellerTemplate.ownFields` in #154 and the table dropped in #155.
- **D4 is not the ratification it was offered as.** The cap stays and buyers still never see it
  — but a capped seller's enquiries **stack up behind a subscription paywall** rather than being
  written off as missed. `MissedEnquiry` already is that stack; what is missing is the
  notification, the unlock and the wording. It is the go-to-market engine and it is scheduled
  later, by the owner's own instruction.

### D1 · Plan-limit config — **settled: ratify the seven numbers**

Free today is **1 category, 1 branch, 10 products, 30 photos, 3 enquiries a month, 1 seat, 50 MB**
(`prisma/seed-data.mts:13`). Real columns on `plan`, staff-editable at `/admin/plans` with a
`NOT NULL` reason, grandfathered by entitlement snapshot. Ratify these and rule that the `plan`
table is the only place they may live.

**The real defect:** no migration ever creates a plan row — `rg 'INSERT INTO "plan"'
prisma/migrations/` returns nothing — and the only writer is a seed refused against non-loopback
hosts. Three conditional patches have already moved production away from the seed, so the live
Free row gives **2 seats and unlimited storage**. The storefront's three-photo Free cut is a
constant in a page file (`app/(public)/b/[slug]/page.tsx:338`), not a column.

### D2 · Placement term — **settled: the slot belongs to the subscription**

Only a `sponsoredEligible` plan may take a slot; it bills as a line on that subscription's
invoice; it ends the day that subscription ends (cancel, downgrade off eligibility, or dunning
lapse), with unused days returned as a subscription credit and the waitlist told that day.
`PlacementSlot` and `PlacementWaitlist` already carry every column this needs.

**Why not the other answer:** a standalone term needs a payment provider to charge a standalone
booking, and `lib/billing/provider.ts` has none live. One shipped screen already states both
answers at once — `lib/billing/cancel-table.ts:375-385` prints "Runs to 30 Sep 2026 under its own
term" in the Free column and stamps the row `ends`, rendered as a red ✕.

### D3 · Attribute dictionary — **settled: no**

Comparison stays at business level. Everything below is the case that was put and refused;
it is kept because the reasoning is what a future reversal would have to argue against.

#### The case that was made and declined

> Every measurable thing a buyer can filter or compare on gets one platform-owned name that means
> the same thing in every category. A seller may rename it on their own pages and may still add
> extra fields of their own, but those extras are never filterable and never comparable.

The second clause is what the code already does (`ownFields` render YOURS ONLY, never a facet —
`lib/catalogue/template.ts:251`).

**The whole of D3 in one fact:** `SpecField` is unique on `[templateId, key]`
(`prisma/schema.prisma:465`), not on `key`. `nominal_diameter` / "Nominal diameter" / unit `DN` is
one row on the valve template and a second unrelated row on the pump template, with overlapping
options DN50–DN200. **Do it now:** the backfill is 11 rows today against ~150 seeded
subcategories. `lib/spec/versions.ts:687` already warns what it costs at 40,000 businesses.

Two things the owner is also approving: indexed facet URLs change shape and need redirects, and
ops gains a standing job — deciding what an attribute is, once, for every category.

### D4 · Enquiry cap — **settled: keep it, stack the leads, paywall the unlock**

See `memory/enquiries-stack-behind-the-paywall.md`. The cap is a matching filter and buyers
never see it — that half was ratified. The half that changed: a capped seller's enquiries
accumulate and are unlocked by subscribing, rather than being reported as missed. Deferred to
the GTM work by the owner.

#### What was ratified

It is a **seller-side matching filter**. A capped supplier is silently left out of the recipient
list and told afterwards on their own dashboard. Never buyer-facing, never a hold, never counted
against contact reveals. The only public sentence it produces is the honest all-capped fallback at
`lib/i18n/en.ts:2085`.

**Consequences:** `13a` must be redrawn without its reveal counter — nothing counts reveals
against anything. And the cap does not hold: `lib/enquiry/service.ts:319-330` intersects the
buyer's chosen ids against the raw uncapped pool instead of the capped selection.

### D5 · Services — **settled: their own screens, split per subcategory**

Specified in `docs/services-spec.md` — nine screens, four of them new designs, plus three
pieces of work with no design attached. Awaiting design handoffs screen by screen.

#### The model

Add one setting saying whether a trade is sold **by the item or by the job**. Set it on the ~420
subcategories, not the 13 sectors — IT holds Servers & storage next to Cybersecurity. Blank
inherits from the parent; `lib/taxonomy/sector.ts:44-55` already walks the tree that way.

A service supplier keeps the same catalogue table. The row reads "Annual statutory audit, made to
order" instead of "DN100 gate valve, 240 in stock". **Explicitly out of scope:** no calendar, no
appointment, no slot, no availability window. The conversion event stays the enquiry. "Booking" is
not available as a word — it already means a sponsored placement and is printed on tax invoices.

**The cost of leaving it:** `lib/enquiry/service.ts:184` sets `matchedLineCount` from product
count and hardcodes `inStockLineCount` to 0; `lib/enquiry/fanout.ts:182` weights those at 54% of
the score. A freight forwarder caps at 0.46 where a goods supplier reaches 0.80. **This decides
who receives an enquiry.**

### D6 · Editorial attribution — **settled: a named editor now, more names later**

One real name and one real role, entered in the admin. Content, not code — a revalidation
rather than a deploy. **Still owed by the owner: the name.**

Publish under a real named member of staff entered in the admin; where no name is supplied, leave
the byline empty so the page credits Business Listings, which the code already does. Needs one
real name and one real role. The name is content, so changing it costs a revalidation, not a
deploy. **Do not** build author pages or an `Author` model — both were cut deliberately.

**Urgent because it is live:** `prisma/seed-guides.mts:334` defines `BYLINE = "Rana Habib"`, role
"Verification lead", stamped onto all four seeded guides and emitted as schema.org `Person`.
Meanwhile `/guides/how-we-check` tells the reader guides carry no individual byline because naming
a person is a decision that has not been taken. Both are published.

---

## 3 · The phases

### Phase 1 · What is live and wrong — one batch, one deploy

Every item is on a surface someone uses today and none waits on anything. Land it as **one batch**
per the working agreement: one production deploy, not twelve.

- [x] **1.1 Dead controls on 30,000 unclaimed listings.** Both were `disabled` under the tooltip
  "Enquiries open in the next release" — stale, and wrong twice. Claim now links to
  `/onboarding/claim?q=<name>`, which `2a` already reads and already names as one of its four entry
  points; report goes where its two siblings go, the verification policy, until `13c` replaces all
  three. `crawlRel` on the claim link, because ~30,000 distinct `?q=` URLs into a noindex funnel
  step is the shape `lib/seo/crawl-policy.ts` exists to stop. Same pair on the shared card.
- [x] **1.2 Buyer links that 404.** Two halves. `getBuyerEnquiry` and `getAcceptedRecord` now
  resolve a reference *or* an id through one `byRefOrId` helper, the way the parent route always
  did — so the tracking page's own Compare and "View accepted" buttons resolve. And every buyer
  notification's action URL now carries the claim token, stamped once in `buyerActionUrl` at the
  one place all buyer deliveries pass through rather than in each template, because the templates
  are database rows that a commit cannot edit.
- [x] **1.3 Numbers that are page caps wearing a total.** `/admin/businesses` counts with two
  queries instead of slicing 300 rows — and `claimed` now counts claim status rather than a
  precedence chain where `suspendedAt` won, which was dropping suspended-but-claimed businesses
  (37 against the old 35 on the seed). `/admin/ingest/dedupe` gets `openCandidateCounts()`, a
  `groupBy` over the real predicate. `/admin/audit` names its window — "The 200 most recent
  entries" — rather than pretending a `limit` is a total. `/admin/reports` renders no meta at all
  on an empty queue, because the oldest of no reports is not zero days. `/admin/queue` takes the
  maximum age rather than the head of a sort banded by a per-kind SLA.
- [~] **1.4 Gates.** `rescan` now asserts `business.merge` — it writes `MergeCandidate` rows, so it
  is a mutation, and it was resolving a seat and discarding it in a `finally`. `/dashboard/promote`
  gained a route gate and a nav capability, so a seat that cannot buy no longer reads the whole
  screen and is refused at the button. **Deferred to 7.1 with a reason:** `/admin/crm` and
  `/admin/businesses` state in their own comments that any staff seat may read them, and the fix is
  a capability that does not exist — inventing one is `4i`'s job, not a defect batch's.
- [x] **1.5 Statements the product cannot keep.** The console's expiring-licence metric was
  `verificationTier >= 3` against a ladder that ends at 2; it is bound to `VERIFIED_TIER` now and
  the label says "Verified licences" rather than "Tier 3+". The MRR caption is conditional, so the
  page no longer asserts the ledger agrees eight lines under an alert saying it does not. The
  published verification policy loses its fourth rung, renames "Licence on file" to "Claimed" to
  match the badge, and says an expired licence drops to *claimed* — which is what
  `EXPIRED_LICENCE_TIER` does. `BYLINE` is null, so the seeded guides credit the organisation, the
  way `/guides/how-we-check` already told the reader they did.
- [x] **1.6 The cap that does not hold, and the placement with no plan gate.** `createEnquiry` now
  excludes `selection.skipped` from the buyer's chosen ids — by the cap decision, not by
  `selection.recipients`, which is the matcher's top N and would have silently dropped a supplier
  the buyer deliberately ticked. `takeSlot` reads `sponsoredEligible` through `effectiveFor`, so a
  Free-plan owner is refused by name and a grandfathered seller keeps what they bought.
- [x] **1.7 Decided, 9 Sep 2026, twice.** First the feature was cut; the cut branch was
  deleted before anything shipped. The standing decision is the second one: **domains stay, as a
  label under our own zone.** `indus-hydraulics` gets
  `indushydraulics.businesslistings.me`. Pro only, label derived from the slug, `/b/<slug>` stays
  canonical.

  **And a correction to this document's own finding.** §1 correction 3 said there was "no
  `middleware.ts` at the repo root". The filename was right and the conclusion was wrong: this
  Next version renames middleware to **`proxy.ts`**, which exists, runs on every non-static
  request and already returns the response a hostname rewrite hooks into. `5e` was never missing
  its infrastructure — it was missing forty lines in a file that was already wired.

**Owed to production, and not carried by this branch.** The two content corrections in 1.5 are
seed edits, and a seed does not run against production. The `LegalPage` row holding the
verification policy and the four `Guide` rows holding the fabricated byline are live and still
wrong until somebody updates them — a data change, not a deploy.

**Also landed, ahead of their phases, because the work was in front of us:**
`tests/integration/placement.test.ts` is the first test `lib/placement/` has ever had, which starts
9.6; `tests/integration/console-overview.test.ts` is the first for `consoleOverview`.

### Phase 2 · Settle the six — your desk, not the keyboard

- [ ] **2.1** Ratify D1, then write the migration nobody wrote: one idempotent migration writing
  all seven caps onto Free/Basic/Pro; one nullable `publicPhotoLimit` column; photo and category
  rows on the plan grid; branch and category gates moved onto `effectiveFor`.
- [ ] **2.2** Ratify D4 and redraw `13a` without its counter.
- [ ] **2.3** Answer D6 with one name and one role.
- [ ] **2.4** Take D2 and D5.
- [ ] **2.5** Take D3 and schedule the migration before the catalogue grows.

### Phase 3 · The enquiry loop, end to end — 8 boards

The conversion event and the terminal state. Seven of eight already render; the one genuine build
is `7b`, and it is a tenancy question, not a screen.

- [ ] **3.1 `7a`** — `signInWithPassword` appears zero times in the repo, yet /signin offers "Use
  a password instead" and `setPasswordAction` writes one. `/reset` is a magic link wearing a
  password label. `User.suspendedAt` has no writer outside a test fixture.
- [ ] **3.2 `10e`** — `requireBuyerSeat` needs a session; the product's default buyer has no
  account. Their claim token opens one enquiry and never the list. No pagination, no test.
- [ ] **3.3 `10h`** — `getThread` returns `automatic`; the buyer page drops it. The one party the
  tag exists for is the one party who cannot see it. No in-app navigation into the route at all.
- [ ] **3.4 `1n` + `7c`** — `lib/quote/send-quote.ts` fences only on `closesAt`, never on
  acceptance, while the dashboard's read-only comment claims it enforces "the same three
  conditions the service refuses on" — false for two. The accepted record's contact panel has no
  empty state and picks a branch phone with no `orderBy`.
- [ ] **3.5 `10f`** — the storefront computes eligibility for *this* business then links
  `/review/new?enq=` with no `&about=`. `?about=` has zero producers repo-wide.
- [ ] **3.6 `13a`** — redraw against D4. The `card` layout, the only one that masks, has no
  caller; `bar` never masks. Two other public surfaces print the numbers unmasked and record
  nothing.
- [ ] **3.7 `7b`** — build it, or delete the columns. `BuyerCompany` has five relation readers and
  no writer; `approvalThresholdAed` has neither.

### Phase 4 · A queue with no worker — 6 boards, strict order

Both ends of the pipeline are inert. The importer stages rows it cannot categorise and nothing
assigns a category afterwards, so `approveRun` refuses with "Categorise the queue first" for a
queue with no screen. The dedupe candidate list has no production writer, so on a real database
the screen is permanently empty above copy reading "Run the matcher after an import".

- [ ] **4.1 `12a`** — a categorise screen for `needs_category`, a writer for `discarded`, and a
  screen that renders a staged row. Approval permanently strands every row it skipped.
- [ ] **4.2 `12b`** — the rescan control, a capability on it, `selectable` bulk merge, and a merge
  rule that is not `a.id < b.id` (`lib/dedupe/service.ts:145`).
- [ ] **4.3 `4b`** — settle the 62% (see §4), then build the bulk rules.
- [ ] **4.4 `4c`** — let the credential lane open the credential; filter conflict rows a moderator
  will 404 on.
- [ ] **4.5 `4f`** — search, pagination, a detail route, and an appeal path the terms page already
  promises.
- [ ] **4.6 `10g`** — the composition is keyed on a caller-supplied `context` string rather than
  claim status, and two of three call sites never pass it.

### Phase 5 · Taxonomy, facets and comparison — 4 boards

- [ ] **5.1 `4d`** — `createCategory` does not exist; `parentId` is written by nothing outside the
  seed; `slugCollision` has no production caller.
- [ ] **5.2 `10a`** — export-only. Two definitions of "suppliers in this trade" on one page.
- [ ] **5.3 `10c`** — no facet rail of any kind on `/search`. Not a D3 problem.
- [ ] **5.4 `10d`** — decide what `/compare` compares. The spec machinery exists in
  `lib/db/queries/product-detail.ts:81`.

### Phase 6 · Money and trust, closed out — 5 boards

The pattern underneath all five: **a sale with no ledger row.**

- [ ] **6.1 `12e`** — five Plan columns including `monthlyPriceAed` are editable by nobody; no
  plan creation; `VAT_RATE` is a module constant; `/admin/dunning` has no controls at all.
- [ ] **6.2 `4g`** — `mrrNow` groups subscriptions only; a sold placement is neither billed nor
  counted. The subscription list fetches six fields including the slug and maps none.
- [ ] **6.3 `11e`** — build the sale D2 defines: plan gate, billing line, ender on cancel and
  downgrade, waitlist writer, the emirate dimension.
- [ ] **6.4 `4h`** — the off-platform panel has no control and no outcome path. Four of seven
  report kinds have no producer.
- [ ] **6.5 `11i`** — the closure and retention promises the legal pages already publish.

### Phase 7 · The console learns to run itself — 7 boards

The epic feared `4i` was writers with no reader. It is the opposite: the audit log has a scoped
reader and three levels of tests. **The staff half has nothing at all.**

- [ ] **7.1 `4i`** — grant, revoke, invite, deactivate. Then: raw enum keys in the Action column
  (19 of 27 actions have no label string), no filters though the service takes them, no
  before/after diff though the service selects both, no pagination behind a 200-row cap rendered
  as a total. `AuditRow.actorRoleLabel` is unfillable without a schema column — add it or drop the
  field.
- [ ] **7.2 `12d`** — `logCall`'s only caller is an integration test.
- [ ] **7.3 `12f`** — export it; view-as is genuinely sound and is the best-guarded thing in the
  console.
- [ ] **7.4 `12g` + `7f` + `10i`** — record that `/admin/strings` is a report by design, then fix
  the template create path. `ramadan_dates_moved` fires nightly against no template.
- [ ] **7.5 `6g`** — stays here, not Phase 1: what it must read is prose held in the database,
  half of it template copy `12g` owns.
- [ ] **7.6 `12h`** — split into two boards (see §4), then build the areas half.
- [ ] **7.7 `4a`** — last, and now small. Twelve of fourteen numbers are honest queries.

### Phase 8 · The storefront builder — 8 boards, mostly export

**Invert the epic's order.** `5c`, `5g`, `5h` and most of `5d` are export-against-tree; `5e` is
the only large piece and the only one selling something it does not deliver.

- [x] **8.1 `5e`** — done, as subdomains rather than as bring-your-own-domain. `proxy.ts` matches
  `<label>.businesslistings.me` and rewrites to `/b/<label>`; `getBusinessBySlug` resolves a label
  as well as a slug, so all six storefront routes work on a seller's address without knowing
  addresses exist. The DNS half — records, propagation states, the give-up clock, five failure
  causes, the hourly poll and a certificate we could not issue — is deleted rather than kept for a
  bring-your-own that may not return. **Still outside the repo:** the wildcard DNS record and the
  wildcard domain on Vercel.
- [ ] **8.2 `5f`** — the public page filters `header` and `enquiry_form` out of the template run
  and the builder canvas applies no such filter.
- [ ] **8.3 `5b`** — five of eight theme columns reach no storefront, including a density
  `globals.css` already defines.
- [ ] **8.4 `5a` + `5d`** — no create, no delete, no unpublish. `TemplateStatus.retired` is set by
  nothing. Template pages are absent from the sitemap despite carrying `allowIndexing`.
- [ ] **8.5 `5c` + `5g` + `5h`** — export, and decide whether `5h` exists as a separate board.

### Phase 9 · The four that do not exist, and the standing lane — 3 boards + hygiene

- [ ] **9.1 `13c`** — report a listing, from the buyer's side.
- [ ] **9.2 `13e`** — maintenance, and the 500 that has no board either. No `error.tsx` exists
  anywhere; draw both in one board. A 503 needs `Retry-After` or a crawler deindexes 2,000 landing
  pages.
- [ ] **9.3 `13b`** — reconcile a platform hand-off with a detector that reports sellers for
  off-platform steering before drawing it.
- [ ] **9.4 Standing: three capabilities the product never consults.** `enquiry.create`,
  `quote.accept` and `review.create` each have an assert helper with zero callers — the conversion
  event, the terminal state and the trust signal.
- [ ] **9.5 Standing: 29 scheduled jobs, no run persisted.** Two crons, 29 steps, no row written
  anywhere. If the nightly stops firing nothing changes appearance and nobody is told.
- [ ] **9.6 Standing: the sale path has no test.** `rg -l "lib/placement" tests/` returns nothing,
  and `takeSlot`'s comment claims a unique index that is on the wrong table. Three
  `lib/billing/` files feeding live admin screens are likewise untested.
- [ ] **9.7 Standing: reconcile the three registers.** 129 route files, ~100 rows in
  `docs/routes.md`, 48 in `lib/dev/surfaces.ts`. `/admin/questions` is in neither and has zero
  tests. Board `12i` exists in the tree and appears zero times in the epic, so the 100-board total
  is short by at least one.

---

## 4 · The ledger

`export only` means the code is finished and the work is a design export against the tree.
`↓` marks a state the refutation pass downgraded.

| Board | Name | State | Effort | The fact that decides the work | Step |
|---|---|---|---|---|---|
| `4i` | Staff, roles & audit | partial | medium | Audit log has a scoped reader and three levels of tests. The staff half has no route, service or writer. | 7.1 |
| `12e` | Plans, dunning, VAT | partial | medium | Seven caps are staff-editable with an audit row. Price is editable by nobody. | 6.1 |
| `4d` | Category taxonomy | partial | large | `createCategory` does not exist; `parentId` is written by nothing outside the seed. | 5.1 |
| `12a` | Licence-record importer | partial | medium | Rows staged `needs_category` are terminal — nothing assigns them a category. | 4.1 |
| `12b` | Dedupe & merge | scaffold ↓ | small | The candidate list has no production writer, so the screen is permanently empty. | 4.2 |
| `4b` | Approval queue | partial | medium | The 62% auto-pass figure has no source in the tree and no denominator exists. | 4.3 |
| `4c` | Review a submission | partial | small | The credential lane cannot open the credential; moderators get conflict rows that 404. | 4.4 |
| `4f` | Businesses & health | partial | small | No search, pagination or detail route on the screen that owns suspension. | 4.5 |
| `10g` | Unclaimed listing | partial | small | Both calls to action render `disabled`; the claim destination exists and only the href is absent. | 1.1 / 4.6 |
| `10a` | Subcategory page | partial ↓ | export only | Two definitions of "suppliers in this trade" render on one page. | 5.2 |
| `13c` | Report a listing | not started | medium | The admin queue is built; both live entry points go to the verification policy. | 9.1 |
| `4h` | Reports, flags & disputes | partial | medium | The off-platform panel has no control and no outcome path. | 6.4 |
| `4g` | Subscriptions & revenue | partial | small | Placement revenue is reported nowhere; a sold slot is neither billed nor counted. | 6.2 |
| `11e` | Sponsored placement | scaffold ↓ | medium | A slot is created at 450 AED with no invoice, no charge, no ledger row — and no plan gate. | 6.3 |
| `11i` | Close account | scaffold | large | Terms and privacy publish a closure promise and eight retention windows; nothing implements either. | 6.5 |
| `7a` | Auth — four states | partial ↓ | export only | `signInWithPassword` appears zero times; a password can be set and never used. | 3.1 |
| `7b` | Buyer company account | scaffold | medium | A tenant table with no writer: `User.buyerCompanyId` is null for every non-seeded user. | 3.7 |
| `10e` | Buyer enquiry inbox | partial | small | The product's default buyer has no account and so cannot open their own inbox. | 3.2 |
| `10h` | Negotiation thread | partial | small | The AUTOMATIC badge exists for the buyer and renders only for the seller. | 3.3 |
| `1n` | Compare quotes | partial | small | The tracking page's own Compare button builds a reference the route cannot resolve. | 1.2 / 3.4 |
| `7c` | Accepted quote record | partial | small | The terminal state has no service-level fence against a post-acceptance quote send. | 3.4 |
| `10f` | Write a review — gated | partial | small | The live review-request email links a URL the e2e suite asserts returns 404. | 3.5 |
| `13a` | Contact reveal | partial | medium | The only layout that actually masks has no caller. | 3.6 |
| `13b` | WhatsApp hand-off | not started | medium | Must be reconciled with a detector that reports sellers for off-platform steering. | 9.3 |
| `12g` | Notifications, strings | partial | small | Templates have no create path, so a nightly event fires against nothing. | 7.4 |
| `7f` | Notification specimens | partial ↓ | export only | All four channels render; SMS has no carrier and records a skip with a reason. | 7.4 |
| `6g` | Admin copy audit | not started | medium | The CI scan reads exactly one file; every word held in the database is invisible to it. | 7.5 |
| `10c` | Search — products tab | scaffold ↓ | medium | No facet rail of any kind on `/search`. | 5.3 |
| `10d` | Comparison tray | partial | medium | Compares ten fixed business attributes and touches the dictionary nowhere. | 5.4 |
| `12d` | Ops CRM — supply gaps | partial | medium | `logCall`'s only caller in the tree is an integration test. | 7.2 |
| `12f` | Support desk & view-as | partial ↓ | small | View-as is the best-guarded thing in the console. | 7.3 |
| `5a` | Builder shell | partial | medium | `createTemplate` has no route caller. | 8.4 |
| `5b` | Theme presets | scaffold ↓ | medium | Five of eight theme columns reach no storefront. | 8.3 |
| `5c` | Section library | partial ↓ | export only | One dead helper; the library cannot say which sections the template already uses. | 8.5 |
| `5g` | Section specimens I | partial ↓ | export only | All fifteen types render. | 8.5 |
| `5h` | Section specimens II | partial ↓ | export only | A records gap: one surface where the epic counts two boards. | 8.5 |
| `5d` | Page template editor | partial ↓ | small | No delete and no unpublish, so a page on 1,842 storefronts cannot be taken down. | 8.4 |
| `5e` | Domains & publishing | scaffold ↓ | large | No `middleware.ts` — a verified custom domain serves nothing. | 8.1 |
| `5f` | The published result | partial ↓ | small | Staff publish against a canvas showing two sections the storefront never renders. | 8.2 |
| `12h` | Visits, areas, API | scaffold | large | At least two boards. None of the three routes exist. | 7.6 |
| `10i` | Campaign landing | partial ↓ | export only | The model exists so content avoids a deploy; a second campaign costs one. | 7.4 |
| `13e` | Scheduled maintenance | not started | medium | No error boundary exists anywhere either. | 9.2 |
| `13i` | Verification & review policy | scaffold ↓ | medium | The published policy names a fourth rung the DB CHECK forbids. | 1.5 |
| `4a` | Platform overview | partial | small | Twelve of fourteen numbers are honest queries. One queries a tier the ladder cannot reach. | 7.7 |

---

## 5 · The epic's five questions, answered

**Is `4b`'s 62% auto-pass rate measured or illustrative?** Neither — **absent**. `rg -ni
'auto.?pass|auto.?approv|autoApprove'` returns zero hits across the tree. Not a constant either,
so not yet an *every number is a query* violation — putting it on a screen would make it one. What
exists instead is a static field split decided at edit time: four moderated fields against ten
instant. That is 71%, and it is a count of field names, not a rate. Nothing counts instant edits,
so there is no denominator to measure against today.

**`12h`: one board or two?** **At least two**, and the title names a fourth thing that no longer
exists. `/admin/areas` is a taxonomy editor owning emirates, areas, free-zone flags and the
lat/lng distance sort reads; its model already promises "a data change, never a deploy".
`/admin/api` and `/admin/compliance` are a different board for a different audience, and neither
can be usefully drawn yet — `ApiKey` has no scope vocabulary and no HTTP surface to authenticate
against. Splitting moves the screen total off 100.

**Where does the audit log have readers?** It has one, and a scoped one, so §6.6's fear does not
apply. 78 `staffMutation` call sites write; `/admin/audit` reads through `auditScopeFor`, which
returns null without `audit.read` and narrows every other staff role to their own rows. Tested at
three levels. **`4i` gets more expensive for the opposite reason:** the staff-management half has
no route, no service and no writer.

**Correct the phases where the audit contradicts them.** `4f`, `4h`, `11e` and `12d` are all
partial or scaffold, none built. `11e` was downgraded — it sells something and writes no ledger
row. **And `12g` is built, but `6g` still stays late**, because what it must audit is prose held in
the database, half of it the template copy `12g` owns.

**The built-state audit.** §4, all 44 rows, each verified twice — an auditor working from the
tree, then a second agent instructed to refute it. Sixteen claims were downgraded on that second
pass, eight from `built`.

---

## 6 · Found in the tree, on no board at all

Not screens — the reasons a screen can be wrong without anyone finding out. Scheduled in 9.4–9.7.

- **Three capabilities the product never consults.** `assertCanCreateEnquiry`,
  `assertCanAcceptQuote` and `assertCanWriteReview` (`lib/auth/guards.ts:147,150,153`) have zero
  callers. The conversion event, the terminal state and the trust signal are gated on eligibility
  rather than the matrix, so `pnpm matrix` prints permissions for three actions the permission
  system never asks about.
- **Twenty-nine scheduled jobs, no run persisted.** `vercel.json:6-15` runs `/api/jobs/daily` (24
  steps) and `/api/jobs/sweep` (5). No model records an execution; the only outputs are
  `console.info`. The daily route argues this against itself — it added a PDF retry step because a
  failed write "went to a `console.warn`, which is a message with no reader" — and then returns the
  operator's number in a JSON body.
- **`ApiKey` is fully dead.** Zero readers, zero writers, zero tests, zero fixtures, and its
  docblock opens "The only way anything outside this codebase reads our data." There is no
  `/api/v1`, no key verification, no scope enforcement.
- **`ProductEvent` is written, aged and pruned without ever being queried.** Its schema comment
  names the one question it exists for; the daily cron deletes the rows on a retention window
  before anything has asked it.
- **`CuratedListAudit` is written in production and read only by tests.** `/best/:slug` publishes
  a `consideredCount` and promises staff the names behind it; `/admin/content/lists` never queries
  the table holding them.
- **`TeamMember` has readers and no writer.** The "Meet the team" storefront section renders
  whatever the seed put there and no seller can add a person.
- **No error boundary.** No `error.tsx` or `global-error.tsx` anywhere, so a thrown error on any
  of 129 routes renders Next's default — the exact defect `app/not-found.tsx` was written to fix
  for the 404.
- **`lib/placement/` has no test of any kind** and holds `takeSlot()`, the only path that sells
  anything. Its comment claims a partial unique index enforces one slot per scope; that index is
  on `placement_waitlist`, not `placement_slot`. `dunning-queue.ts`, `invoice-delivery.ts` and
  `subscription-list.ts` are likewise untested and each feeds a live admin screen.
- **Three registers disagree.** 129 route files, ~100 rows in `docs/routes.md`, 48 in
  `lib/dev/surfaces.ts` — whose own docblock names this disease and then reproduces it one
  directory over. `/admin/questions` is in neither register and has zero tests. `/admin/reviews` is
  in one and carries no board id. Board `12i` is registered and appears zero times in the epic. All
  three `planned: true` rows in `surfaces.ts` now resolve to real files.

---

## 7 · Method

Nine agents audited the 44 boards against `d646086`, each briefed with its boards, the epic's
claims about them, and the specific questions to answer. A second agent per batch received every
`built` or `partial` claim and was instructed to **refute** it — downgrade on a writer with no
reader, a stub action, a staff mutation with no audit row, a number that should be a query, an
undocumented state, an absent gate. Six more settled D1–D6. A final pass swept for work on no
board at all. Every claim is anchored to a file and a line.

25 agents, 1,751 tool calls, 40 minutes.
