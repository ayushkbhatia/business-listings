# The build plan — 44 boards, phase by phase

**Audited against the working tree at `d646086`, 9 Sep 2026.** Supersedes the sequencing in
`Epic — Pending build plan`, which was written from the design export tracker and is provisional
by its own admission (§2 of that document asked for exactly this audit before anything was
sequenced).

Read this file before starting any board. Each phase names its steps, and each step names the
file and line the work is anchored to. When a step lands, tick it here in the same commit.

**The service track is sequenced separately.** `docs/services-build-plan.md` audits the 28 `-s`
boards the 11 Sep epic (`docs/epic-2026-09-11.md`) added, against the tree at `d5455a8`. None of
them is built. That document also records four corrections to that epic and the one contradiction
between this file and `docs/services-spec.md` that has to be settled before any of them start.

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
   absent. `6g` was cut on 14 Sep 2026, before anything was built (see 7.5).
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
  *18 Sep:* the `10d` half is overtaken by the board itself, which compares products — but
  within **one trade**, on that trade's own template, so it still needs no dictionary and D3
  stands.
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

Add one setting saying whether a trade is sold **by the item or by the job**. Set it on the
subcategories, not the 13 sectors — IT holds Servers & storage next to Cybersecurity. Blank
inherits from the parent.

Two corrections to what this paragraph said before 11 Sep 2026, both from the audit in
`docs/services-build-plan.md`:

- **It is 440 `Category` rows — 13 sectors and 427 subcategories — not "~420".** One sector,
  `pumps-and-motors`, has no children at all, so a per-subcategory-only screen cannot set it.
- **`lib/taxonomy/sector.ts:44-55` is not the precedent claimed here.** It walks `parentId` to the
  root and returns an id; it never looks for the nearest non-null value of a *field*, and it does
  one `findUnique` per level. The null-inheriting resolver has to be written, not copied.

**Settled 11 Sep 2026: a service is its own entity, not a catalogue row.** This paragraph used to
say a service supplier keeps the same catalogue table. That contradicted `docs/services-spec.md`
§3, which gives services their own editor and their own public page, and the owner settled it in
the spec's favour. The reason is not aesthetic: `Product` carries `availability`, `stockQty`,
`minOrderQty`, `sku` and `specValues`, all NOT NULL or defaulted and all rendered by shipped
components, and every one of them is a lie about a service — while `Product` has readers in search,
fan-out, the storefront, the importer, the media library, quotes and four scheduled jobs. A `kind`
discriminator makes each of those grow a branch.

**Explicitly out of scope:** no calendar, no appointment, no slot, no availability window. The
conversion event stays the enquiry. "Booking" is not available as a word — it already means a
sponsored placement and is printed on tax invoices.

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

- [x] **3.1 `7a`** — `signInWithPassword` appears zero times in the repo, yet /signin offers "Use
  a password instead" and `setPasswordAction` writes one. `/reset` is a magic link wearing a
  password label. `User.suspendedAt` has no writer outside a test fixture.
  **Done with board `7a`'s handoff, 14 Sep 2026.** Sign-in is password-first as drawn with the code
  one button below on the same form (Q1 left as drawn); a wrong password and no password are one
  answer, and wrong passwords are their own attempt kind, so the lockout leaves the code open (`B5`).
  Reset is ours: an hour-long, single-use `password_reset` grant from an emailed link or a code
  verified for a reset (`B2`, `B6`). Sign-up asks which door, takes mobile and work email, records
  terms versions with the tick time (`B10`), and sends the code to the email when mobiles cannot be
  reached — production has never confirmed a phone. `lib/account/suspension.ts` is the writer that
  keeps "the reason is in your email" true; `getActor` refuses a suspended profile on every request.
  Sign-in lands a closing owner on the reversal (Q2). **Found on the way and fixed:** a wrong code on
  `/verify` redirected to the door it came from, so "that code did not match" appeared above the
  sign-up form; sign-up on a mobile an account already held quietly became a sign-in to a code that
  could never arrive; a slowly reached lockout opened before the fifteen minutes it quoted; the
  verify screen printed a masked number from the query string. Migration
  `20261023140000_password_signin_7a`.
- [x] **3.2 `10e`** — `requireBuyerSeat` needs a session; the product's default buyer has no
  account. Their claim token opens one enquiry and never the list. No pagination, no test.
  **Done with board `10e`'s handoff, 14 Sep 2026.** One read (`lib/enquiry/inbox.ts`) gives the
  rows, the chips, NEEDS YOU and the history card, so every row is in exactly one chip (`B1`) and
  status is derived, never stored (`B2`, `lib/enquiry/inbox-status.ts`); twenty a page, and a phone
  reads the rows as a list with the verb in reach. *Nudge N sellers* is one conditional update, one
  per seller ever (`B5`), and the seller now sees it on the lead rail — before this the nudge
  reached nobody. *Re-send* seeds the composer from an expired enquiry and the new one records
  `resentFromId` (`B3`, Q4: matched again). Saved searches gained a cadence, a category, counters
  and an hourly sweep that emails when the new-match count rises; opening clears it and email does
  not (`B7`); a search that found nothing is kept as `zeroResult` and feeds the CRM call list
  (`B6`). Q1 taken: dynamic public pages carry an account menu with sign-out, which production
  had no way to do. **Found on the way and fixed:** any stored composer draft beat a seeded
  arrival, so *Add to an RFQ* and re-send landed on a blank row after one earlier visit; the nudge
  service's comment claimed a WhatsApp message it never sent. **Still owed:** the nudge reaches
  the seller in-app only (WhatsApp/email need an event, the 7e matrix and a Meta template); a
  buyer who sent without an account still cannot reach the list (7a/7b); *Company & team* and
  *Saved requirements* are not drawn until 7b and `/account/requirements` exist; Q5 (per-person
  inbox on a company account) is the owner's. Migration `20261025140000_buyer_inbox_10e`.
- [x] **3.3 `10h`** — `getThread` returns `automatic`; the buyer page drops it. The one party the
  tag exists for is the one party who cannot see it. No in-app navigation into the route at all.
  **Done with board `10h`'s handoff, 14 Sep 2026.** `/enquiry/:id/thread/:seller` (reference or id)
  is the board: a rail of every supplier the enquiry reached in the four states a fan-out produces —
  revised, partly quoted, quoted, and *no reply yet*, kept as a row (`B9`) — each previewed by the
  last message's own opening clause (`B4`); a header naming the supplier by `displayName` with the
  shared badge, the last seat that typed and the measured reply time; and the thread, shared with
  11b so both sides render one revision one way. A revision arrives as a table of every line it
  prices with the previous figure struck through, its requirement lines left unpriced grey and
  totalling nothing (`B3`), every total summed from lines at render (`B1`) and every comparison
  made between whole revisions (`B2`) — `lib/messaging/negotiation.ts`, unit-tested on the board's
  corrected 14,880 → 14,600 and −AED 280. A superseded revision is a document card with its lines
  in place and a PDF generated from the same figures; every revision states its window (`B8`, Q2
  answered by the model: `validityDays` is per revision). Accepting is `acceptQuoteAction` with a
  return path (`B6`), stated in a dialog that names the suppliers it declines. Tracking rows and
  the comparison columns link in. Q5 answered: files attach both ways, reach only the two sides of
  one thread (`MessageAttachment`, document kind `thread_attachment` with no enquiry or business),
  and are type- and size-checked from storage — not scanned, and the composer does not claim so.
  `Message.readAt` gives the board's `READ`, symmetric and set once. **Found on the way and
  fixed:** every reader derived a message's side from the sender's seat today, so removing a seat
  moved its replies to the buyer's side on both threads, the report evidence page, the follow-up
  guard, the inbox counts and the accepted record's commitments — `Message.authorSide` (`B5`);
  nothing held the thread immutable — trigger `message_is_the_record` refuses edits and direct
  deletes (`B10`); a thread whose enquiry was accepted elsewhere still took messages from both
  sides; `acceptQuote` accepted on an enquiry `10e` already calls expired, and the comparison
  offered it. Migration `20261028090000_negotiation_thread_10h`.
- [x] **3.4 `1n` + `7c`** — `lib/quote/send-quote.ts` fences only on `closesAt`, never on
  acceptance, while the dashboard's read-only comment claims it enforces "the same three
  conditions the service refuses on" — false for two. The accepted record's contact panel has no
  empty state and picks a branch phone with no `orderBy`.
  **Done with board `7c`'s handoff, 14 Sep 2026.** One rule, `lib/quote/fence.ts`, read by the
  send, autosave, extend and the lead screen; the send re-checks under a row lock, and
  `acceptQuote` claims the enquiry conditionally, so a send and an accept cannot both land and two
  accepts cannot both release contact. The contact panel says what is missing and the branch is
  chosen deterministically. The record itself was rebuilt against the board: quoted payment terms
  and delivery (new `Quote` columns), the buyer's reference, commitments selected from the
  supplier's own words, a quote PDF from the same value, and a supplier report with the thread
  attached. Migration `20261016090000_accepted_record_7c`.
  **Held by the database as well, 14 Sep 2026 (Lane C).** `quote_not_sent_after_acceptance` refuses
  a quote sent, promoted, revived, revised or extended onto an enquiry whose contact is released —
  for the writer that skips the fence. Read receipts, acceptance and drafts pass. `extendQuote` was
  the one writer checking outside the lock; it re-reads under `lockQuoteFence` now and answers
  `decided` instead of writing a window onto the record. One seed fixture (ENQ-8846's revision 1)
  and two test helpers wrote the release before the quotes, an order acceptance never produces.
  Migration `20261026090000_quote_fence_7c`.
- [x] **3.5 `10f`** — the storefront computes eligibility for *this* business then links
  `/review/new?enq=` with no `&about=`. `?about=` has zero producers repo-wide.
  *Done 15 Sep 2026:* the storefront's *Write a review* links `?enq=<ref>&about=<business>` and
  asks the window too. The page is the board: the job named first, overall as its own input over
  1m's four dimensions (one label map for the form, RATED ON and 11c — there were three), each
  skippable to null (`Review` dimensions nullable), a grapheme-counted 40–800 body that refuses
  contact details, up to six photos shrunk in the browser and stripped of EXIF on the server
  (`lib/images/strip-metadata.ts`), the signing choice, and a live preview through 1m's own row
  mapping. Autosaved drafts live in `review_draft`, which no review reader can see (`B9`). The
  window is 90 days from acceptance (from the term's end for an ongoing engagement) — the 11c
  request window, now one constant (`Q1`). Edits
  keep what they replace in `review_revision`; `review_words_are_fixed` holds the fortnight and
  the freeze on a seller reply in the database. Posting lands on `/b/:slug/reviews#review-<id>`
  (`B10`). Signed out with no token redirects to sign in rather than 404ing the review-request
  email's link. Migration `20261030090000_write_a_review_10f`.
- [x] **3.6 `13a`** → **`1d-v`, contact revealed in place** (15 Sep 2026). `13a` was deleted from
  the canvas; the reveal is a state of `1d`. The landline renders masked and nothing more — the
  numbers come back in a server action's reply, and JSON-LD no longer carries `telephone` on the
  overview, the services overview or the branches tab (`B2`). A first click on a listing opens a
  three-field dialog (name, work email, UAE mobile) in the viewport; submitting writes a
  `contact_lead` (once per visitor and listing, `B10`) and a `contact_reveal` (once per session,
  listing and channel, `B1`/`B6`, with the source path, `B9`). WhatsApp is a `wa.me` link, recorded
  and never gated (`B4`). The branches tab's numbers sit behind the same reveal — board 1f printed
  them for free, which would have been the form with a side door. Leads are read on
  `/dashboard/leads/phone` (owner, manager) and `/admin/leads` (ops lead) — the owner's answer to
  `Q1`: the seller receives the three fields, and the form says so. The dead `card` layout is gone.
  Migration `20261101090000_contact_reveal_leads_1d`.
- [x] **3.7 `7b`** — build it, or delete the columns. `BuyerCompany` has five relation readers and
  no writer; `approvalThresholdAed` has neither.
  **Built with board `7b`'s handoff, 19 Sep 2026.** `/account/company` creates the company (the
  first writer `buyerCompanyId` has had, through a membership table the column now mirrors by
  trigger), holds its details, structured delivery addresses, a team of admin / procurement /
  requester seats with monthly limits and a used-this-month counter, invitations that expire, and
  one rule rendered from its settings. The gate is on accepting a quote: `acceptQuote` evaluates
  it under the company lock, a held quote becomes a request that approving accepts, and nobody
  approves their own. Open, and the owner's: Q2 (a finance role needs an invoice surface), Q3
  (per-seller credit terms — not built, not lost), Q4/Q5 (verified-only stays on the approval gate;
  one rule per company), Q6 (verifying a buyer company).

### Phase 4 · A queue with no worker — 6 boards, strict order

Both ends of the pipeline are inert. The importer stages rows it cannot categorise and nothing
assigns a category afterwards, so `approveRun` refuses with "Categorise the queue first" for a
queue with no screen. The dedupe candidate list has no production writer, so on a real database
the screen is permanently empty above copy reading "Run the matcher after an import".

- [x] **4.1 `12a`** — a categorise screen for `needs_category`, a writer for `discarded`, and a
  screen that renders a staged row. Built against the board-level handoff (14 Sep 2026), which
  arrived after this line was written and settles its two open decisions the way the build notes
  read them. `/admin/ingest/categorise` groups the queue by licence activity, so one decision files
  every waiting record with a phrase across every open run; the chosen category's resolved trade
  kind is shown with where it came from, an inherited kind has to be confirmed, and a kind nothing
  sets is refused (B7). A decision can be remembered, and staging applies it before the keyword
  signals (B5). `/admin/ingest/records/:id` renders the raw row in the file's own column order.
  Approval no longer strands anything: a run publishes what is complete and categorised, states the
  split beside the button (B3), and publishes again from the same run as its queue clears. Discard
  and a thirty-day rollback exist; the rollback unpublishes, never deletes, and leaves any listing
  somebody has claimed, subscribed or started claiming standing (B4). Upload, publish, categorise,
  discard and rollback are all `staffMutation`s (B8). **Found on the way and fixed:** approval
  created every listing unpublished, so the cold-start pages were unreachable; it also invented
  `PENDING-XXXXXXXX` licence numbers and a "one year from today" expiry for records with neither,
  and dropped the emirate, area, phone and activity on the floor; a keyword signal whose slug was
  not in the database staged as `ready` with no category; the 24-month floor was 720 days; the
  keyword matcher filed "Copper Wire Trading" under PPE and "Food Products" under HVAC; the run
  screen printed the uploader as the approver. Exact-licence duplicates are marked at staging and
  at publish and never published here (B9); Q2's renewed-licence case is left to `4.2`.
- [x] **4.2 `12b`** — built. `/admin/ingest/dedupe` is the board's queue: one pair filling the
  frame, record A always the side B1 keeps (claimed, then paying, then history — `chooseParent`,
  never `a.id < b.id`), reviews, products and plan drawn beside the licence, address and phone, and
  three outcomes decided from the keyboard — J/K, 1/2/3, Ctrl+Enter, S to skip, which leaves the pair
  pending (B3, B7). A pair is now either a listing against a listing or a staged record against a
  listing: the importer writes one for every duplicate it stages and every collision at publish, so
  the queue has a production writer. *Add as a branch* creates a location carrying the record's own
  licence number (B9); *keep separate* resolves the pair and returns the record to its run, and the
  matcher never pairs that licence with that listing again (B2). Bulk merge takes every pending pair
  at or above the certain line in one transaction, one `MergeBatch`, one audit row, reversible as a
  unit (B4); two claimed listings are never merged by it (Q3). Every decision is a `staffMutation`,
  the today rail reads the audit log (B6), and each is reversible for thirty days from a table on
  the screen, restoring both records exactly (criterion 9). `Tune matching` stores the floor and the
  certain line in `platform_setting`, previews the resulting queue with the real matcher and applies
  only the lines previewed (B8); the certain line cannot go below 90%. Near misses under the floor are
  counted per run and shown on the run's duplicates card and the queue's rail (B10, Q1). A run
  rollback unwinds the merges made from its records first, or refuses and names the listings whose
  owners confirmed a branch (B5). Q2 is built: a manual-band branch added to a claimed listing is held
  unpublished until the owner confirms it on `/dashboard/locations`, and a bulk-merged one is live and
  still rejectable there while the decision is reversible. **Found on the way and fixed:** a reversed
  merge left the absorbed listing unpublished, so putting a merge back took a live company off the
  directory; moved locations lost their licence numbers and visibility on the way back. **Not
  decided here:** Q4 (a resolution training the matcher beyond "never re-pair"), and whether a
  branch a merge adds counts against the plan's location cap — it does not today.
- [x] **4.3 `4b`** — built. The 62% is settled as a **reading**: the share of waiting submissions
  where every automated check passed, computed from the rules as they stand at the moment the queue
  is read (B2) — never stored and never targeted (Q4 left to the owner). `/admin/queue` reads six
  kinds from five tables — claims, profile edits, category changes, branches published outside the
  licensed emirate, credentials and conflicts — and every chip, the over-SLA badge, the pass rate and
  the rows are counted off one array (B4, B5). Each row carries its checks' own sentences in the
  colour of their outcome (B3), and the per-row action follows them: approve, request a document,
  reject, or review (B6). Bulk approve re-reads and re-checks every selected row on the server and
  skips, naming why, any row whose checks no longer all pass (B1); request documents, reject and
  reassign are unrestricted and skip what they cannot act on. SLA is per kind and the same figures
  `/admin` measures against (B7); over-SLA sorts first, then oldest, and survives every filter (B9).
  Every decision is a `staffMutation` with a written reason (B8). `/admin/queue/rules` (ops lead,
  new `queue.rules`) switches checks off and moves three thresholds, previewing the pass rate and the
  bulk set before anything applies; two checks cannot be switched off. **Found on the way and
  fixed:** an uncontested claim had no decider anywhere — handoff 3 promised "handoff 4's queue" and
  only conflicts got one, so every plain claim waited forever with its claimant holding an owner seat.
  `/admin/queue/claim/:id` decides them, detaches the seat on rejection, and opens the uploaded
  licence through a two-minute signed link. The document classifier's verdict was shown to the
  claimant and thrown away; it is stored on the document now. The conflict resolver wrote `claimed`
  onto the losing submission of an award; `claim_submission.outcome` says which way each went. Every
  review screen names its position under the filter it came from (§Flagged 2). **Not built:** a *New
  businesses* chip — no seller path creates a business, so the kind has no writer (§Flagged, B5
  holds for every kind that exists); and a `CHECK` pairing `outcome` with `decided_at`, which follows
  once the running resolver writes it.
- [ ] **4.4 `4c`** — let the credential lane open the credential; filter conflict rows a moderator
  will 404 on.
- [x] **4.5 `4f`** — search by name, licence number and TRN; filters, pages and saved segments;
  health derived from a measured reply rate; an export that records its filter; and a detail route
  where the account decisions now live. **Not built:** the appeal path the terms page promises
  (§11, "You may appeal once, to a person") — it needs a seller-side request and a queue, and is
  its own board.
- [ ] **4.6 `10g`** — the composition is keyed on a caller-supplied `context` string rather than
  claim status, and two of three call sites never pass it.

### Phase 5 · Taxonomy, facets and comparison — 4 boards

- [x] **5.1 `4d`** — built. Tree and editor on `/admin/categories`: `createCategory`, the details
  save, three switches, an address change and a merge, each audited with a reason. The header total
  is the sum of the tree and is held equal to `1a`'s hero count. Category redirects are now served
  on all four category routes — they had been written and never read.
- [ ] **5.2 `10a`** — export-only. Two definitions of "suppliers in this trade" on one page.
- [x] **5.3 `10c`** — built with `10c-s` as one handoff. D1 settled: the tab row filters one
  list and never partitions the index, so every query with words is the blended screen and the
  map composition survives only for a viewport or a browse with no words. The rail is in three
  declared scopes — place and tier over everything, stock and the majority trade's spec fields
  over products, the scope sheet over services — and a kind-specific facet switches the tab
  rather than returning nothing. Three zero states, not one. `Suppliers` is a distinct count of
  firms with a row that says what each returned (Q2). One cross-kind order plus *most complete
  specs* in the products scope (Q3), a pager that states its window (Q5), and compare on the two
  shapes whose subject is a supplier (Q1). **Not built:** a services-capable anonymous alert —
  `ProductAlert` fires on a product, and the kind-agnostic watch is a saved search (Q4).
- [x] **5.4 `10d`** — built 18 Sep 2026. `/compare` compares **products**, not suppliers: up to
  four, one trade, rows from that trade's resolved spec template in template order whether or
  not anyone filled them (`B1`). A tinted row is computed, not painted — closed vocabularies
  compare the option chosen, free text compares through `valueAliases`, so `DN100` and `4"`
  agree and `Not provided` never makes a row differ (`B4`–`B6`). Availability tints on the
  state, never the count; reply time is measured and completeness is a count with no colour,
  and neither seller row ever tints (`B9`, `B11`). *Hide matching rows*, print, per-column and
  all-at-once *Ask for a quote*. The tray is the `bl_cmp` session cookie written by
  `POST /api/compare`, four at most with the fifth refused and the four named, one trade at a
  time with another trade starting afresh and saying so. The supplier comparison and the URL
  tray are retired. The cookie policy's register named none of the three cookies a buyer's own
  actions set; all three were added under Essential on 22 Sep 2026, dated in the policy's rail.

### Phase 6 · Money and trust, closed out — 5 boards

The pattern underneath all five: **a sale with no ledger row.**

- [x] **6.1 `12e`** — the board-level export of 16 Sep, and the four corrections on it. The screen
  is the board's matrix: entitlements down, plans across, every cell an input, and a review step
  between the table and the write that names which change, how many accounts and then commits.
  `monthlyPriceAed` and `annualMonthsCharged` are editable and audited; `customDomain` gained the
  writer its five readers never had; a plan can be added and is born withdrawn from sale. No
  ranking field, which is correction 1. `DROPS TO FREE` replaces `SUSPENDS`, which is correction 4
  and a different action under a different capability. The VAT return export is cut — `/admin/tax`,
  its FTA route and `lib/billing/vat.ts` went with it — so `VAT_RATE` stays a constant with `11g`
  stamping the rate on each invoice. `/admin/dunning` still has no controls: `12i` audits the
  notices and `12j` sanctions a send, and neither is exported.
- [x] **6.2 `4g`** — one Dubai month at a time: five figures that print their formulas, a
  waterfall that reconciles with cancellations and lapses as separate lines, reasons that sum to
  the cancellations line, the reply-rate cross-reference measured at the moment each seller
  asked, revenue by licence emirate, and a finance export. `mrr_movement` gained a cause and a
  pointer to the change it carried out. Placement is reported beside MRR at list price, pro rata,
  never inside it. The subscription list's unmapped fields are untouched and still owed.
- [x] **6.3 `11e`** — the sale D2 defines, closed out. The plan gate, the billing line, the three
  enders and the waitlist writer landed with D2; this board added the two halves that were left.
  **The emirate is the inventory**: a slot is one trade in one emirate, enforced at booking by an
  advisory lock on the scope — the check was a read-then-write and the partial unique index its
  comment cited is on the waitlist table, which 9.6 caught. **The price is measured**: every scope
  is cut into one of ten demand bands from appearances and clicks over a trailing quarter, recut on
  the first of each month, priced `300 × 1.1^(band − 1)` from a rate card the owner edits at
  `/admin/placement`. Clicks needed a counter and now have one. The band and the price are frozen
  onto the booking, so a change never re-prices a slot somebody holds. VAT is its own line and the
  only total says `incl. VAT`; the start date is derived; the waiting list tells everybody and the
  first to answer takes it.
- [x] **6.4 `4h`** — shipped against its board-level handoff (16 Sep 2026). One queue over two
  tables: the header, the chips, the over-SLA badge and the auto-detected share are all counted
  off one array, which closes the board's own correction 3 — three buckets over five types, with
  Dispute, Fraud and Content homeless. A service level per type in `lib/reports/sla.ts`, and the
  age colour derived from it rather than set by hand, which is where the render's red `6 h` over
  an amber `2 d 4 h` came from. Three buyers reporting one telephone number collapse to one work
  item, and deciding it closes the rest as `duplicate` — the fourth outcome the closed set of
  three had nowhere to put. `Suspend` and `Archive` are not on this board: `12c` refused the
  first in writing and `11i` owns the second, so the row escalates and the detail screen links to
  where each decision lives. `/admin/reports/:id` answers for every kind rather than for the one
  carrying an enquiry, and `/admin/reports/disputes/:id` is its twin. Two producers landed with
  it: a nightly shared-number sweep and a licence-long-expired sweep, both tunable on
  `/admin/reports/detectors` (no confidence — the platform has no scoring detector), and
  `/report/:slug`, the form the storefront's two *Report this listing* links had been opening a
  policy page instead of. `11c`'s `B4`, `B5`, `B6` and `B9` are answered. `Q5` is answered too:
  `report_resolved` writes back to every reporter in the group who has an account.
- [x] **6.5 `11i`** — the closure and retention promises the legal pages already publish.
  Closure is a reversible status transition with a 14-day window; the platform half (B8) runs
  nightly. Two retention halves are not built — see `docs/platform-state.md`.

### Phase 7 · The console learns to run itself — 6 boards, one cut

The epic feared `4i` was writers with no reader. It is the opposite: the audit log has a scoped
reader and three levels of tests. **The staff half has nothing at all.**

- [x] **7.1 `4i`** — grant, revoke, invite, deactivate, on `/admin/staff`; the field verifier
  retired from the enum. The log's defects: every action has a sentence (a unit test holds all
  of them to it), filters by actor, action and subject, keyset pages with a true "showing 51–100
  of N", a before/after line for scalar fields, an export carrying the filter, blast radius on
  twelve bulk writers, and an append-only trigger. `AuditRow.actorRoleLabel` is left unfilled:
  the role at the time needs a snapshot column, and the log's sentence names the person.
- [x] **7.2 `12d`** — the call list is tasks a derivation run writes from five demand signals,
  with a lock, call-backs, cooling, reveals that are logged, outcomes that move the task, and
  rows that leave when their signal clears. Three tabs; *Users* (Q2) is not built. The banner
  states a held page's supply gate so every figure derives, and 6f's `recruit` status learned
  the verified-share gap it had been routing to content ops.
- [ ] **7.3 `12f`** — export it; view-as is genuinely sound and is the best-guarded thing in the
  console.
- [x] **7.4 `12g`** — shipped against its board-level handoff (14 Sep 2026). `/admin/notifications`
  is one row per event and channel with 30-day volume queried from the delivery log, `FIRED BY`
  read from `EVENT_SOURCES`, and a services twin column that tells *no trade-kind language* from
  *not written*; the carrier picks the twin for a services brief and records when it fell back. A
  save is a version: live on email, SMS and in-app, `pending_meta` on WhatsApp with Meta's
  answer recorded against it. Production held 15 of the seed's 27 templates — migration
  `20261027091000_notification_template_backfill` wrote the rest — and `ramadan_dates_moved` had
  no template **and** no routing row; it is on the platform floor with licence expiry now.
  `/admin/strings` stays a report and belongs to `12g-s`. `7f` and `10i` are still owed.
- [x] **7.4c `12g-s`** — paired strings, shipped against its split handoff (15 Sep 2026).
  `/admin/strings/paired` lists the keys one screen renders for both kinds of business, declared in
  `lib/i18n/paired.ts` with the files that read them (a test holds each file to reading its key),
  and the count of services halves nobody has written — a query over the registry and
  `string_entry` rows, never a counter. A half is written, suppressed or restored from the console
  with a reason on the audit log, checked against placeholders the screen supplies and the
  vocabulary scan's own patterns, and reaches the storefront, dashboard, setup hub, listing, search,
  plan change and cancellation on the next render. The registry holds this codebase's twelve pairs,
  not the canvas's 214: the services track mostly forked screens rather than swapping words. Two are
  real gaps (the dashboard's missed-enquiry line) and CSV import is suppressed for a firm that sells
  work. Q1 is half answered (a banned word is refused on save; a wrong meaning is not), Q2 is
  answered by pointing at Templates' own twin count, Q3 is the owner's.
- [x] **7.4b `6h`** — homepage curation, split out of `12g` and shipped against its board-level
  handoff (14 Sep 2026). `/admin/content/home` is the four "Verified this week" slots
  (`HomepageSlot`, eligibility read live through `featureBlock`, a lapsed or suspended business
  held and rendered empty rather than backfilled), the popular-search chips typed as a label and
  the `/search` query they run (`CuratedQuery`, six at most), and a map of the nine rails with
  counts read through the home page's own getters. The sector grid stopped being chosen by hand
  and computes by listing count; the mined popular chips and their fallback list went into the
  table by migration. New capability `homepage.curate`, ops lead only (Q5). Q1 (per-slot
  click-through), Q3 (`1a`'s LLC) and Q4 (scheduling) remain the owner's.
- ~~**7.5 `6g`**~~ — **cut 14 Sep 2026.** Not needed for launch, and nothing had been built. The
  gap it named stays open: `check:vocabulary` reads `lib/i18n/en.ts` alone, so prose held in the
  database, such as the template copy `12g` owns, is checked by no scan.
- [ ] **7.6 `12h`** — split into two boards (see §4), then build the areas half.
- [ ] **7.7 `4a`** — last, and now small. Twelve of fourteen numbers are honest queries.

### Phase 8 · The storefront builder — 8 boards, mostly export

**Cut 15 Sep 2026, except `5e`.** The owner removed the storefront builder from the console:
`5a` (builder shell), `5b` (theme presets) and `5c` (section library), and with them the boards
that only existed inside the builder — `5d` (page templates), `5f` (the published result) and
`5g`/`5h` (section specimens), plus `5c-s`. What went: every `/admin/storefront-templates` route,
`/b/:slug/:page`, the template service, the section catalogue and its fourteen renderers that no
fixed layout draws, the six seller theme presets and the custom hex, and the
`storefront.template.write` capability. What stayed: `/b/[slug]` draws one fixed run — hero, trust
strip, catalogue, reviews, branches — which is what 110 of 123 published storefronts already
rendered, in one palette. The tables (`storefront_template`, `template_section`,
`storefront_content`, `template_page`, `template_version`) and `business.theme_preset` drop in a
contract migration after the code that stopped reading them is live.

**Invert the epic's order.** `5c`, `5g`, `5h` and most of `5d` are export-against-tree; `5e` is
the only large piece and the only one selling something it does not deliver.

- [x] **8.1 `5e`** — done, as subdomains rather than as bring-your-own-domain. `proxy.ts` matches
  `<label>.businesslistings.me` and rewrites to `/b/<label>`; `getBusinessBySlug` resolves a label
  as well as a slug, so all six storefront routes work on a seller's address without knowing
  addresses exist. The DNS half — records, propagation states, the give-up clock, five failure
  causes, the hourly poll and a certificate we could not issue — is deleted rather than kept for a
  bring-your-own that may not return. **Still outside the repo:** the wildcard DNS record and the
  wildcard domain on Vercel.
- ~~**8.2 `5f`**~~ — **cut 15 Sep 2026.** No template run, no canvas to reconcile against.
- ~~**8.3 `5b`**~~ — **cut 15 Sep 2026.** One storefront palette remains.
- ~~**8.4 `5a` + `5d`**~~ — **cut 15 Sep 2026.** The builder and template pages are gone.
- ~~**8.5 `5c` + `5g` + `5h`**~~ — **cut 15 Sep 2026.** No section library, no specimens.

### Phase 9 · The four that do not exist, and the standing lane — 3 boards + hygiene

- [x] **9.1 `13c`** — report a listing, from the buyer's side. *Done 18 Sep 2026:* a modal over the
  storefront at `/b/:slug?report=1` (a URL, `noindex`, 404 on a dead slug), degrading to
  `/report/:slug` — one form component, one action, one writer. It captures the field, the value
  read from the listing and the reporter's correction (`B1`, `B2`), the suggested trade (`B9`), an
  optional email used once and a reference (`B4`), and writes the licence record's answer into
  every evidence line (`B3`). Three distinct sources about one value flag the listing on `4h`. The
  ownership reason routes to the claim flow (`B10`). `/report` is the footer's hub and reads a
  reference.
- [x] **9.2 `13e`** — maintenance, and the 500 that has no board either. No `error.tsx` exists
  anywhere; draw both in one board. A 503 needs `Retry-After` or a crawler deindexes 2,000 landing
  pages. *Done 14 Sep 2026:* `proxy.ts` answers a recorded window with a whole document, 503 and
  `Retry-After`, on exactly the routes of the systems the window marks down (`lib/maintenance`,
  runbook in `docs/maintenance.md`); `app/error.tsx` and `app/global-error.tsx` carry the
  unplanned error in the same grammar. Design drew only the maintenance half.
- [ ] **9.3 `13b`** — reconcile a platform hand-off with a detector that reports sellers for
  off-platform steering before drawing it.
- [x] **9.4 Standing: three capabilities the product never consults.** `enquiry.create`,
  `quote.accept` and `review.create` each have an assert helper with zero callers — the conversion
  event, the terminal state and the trust signal. *Done 24 Sep 2026.* Asked as written, all three
  would have refused the buyer the funnel is built for: a provisional identity holds no role, and
  each row was a role grant. Accept and review also refused a supplier's seat on the enquiry §07 lets
  it send. Fixed in the definition, not at the call sites: `CapabilitySpec.provisional` names what a
  provisional identity holds — these three and nothing else — and the three rows share one list of
  holders, so no seat can start an enquiry it cannot finish. Each `assertCan*` is now the first line
  of its service, asked of the record through `actorFor` so no caller can skip it or hand in a role:
  `createEnquiry` (including a signed-out send whose number belongs to an account) and `addSuppliers`;
  `acceptQuote`, `requestApproval` and `approveRequest`; `createReview`, `saveReviewDraft` and
  `writableSubject`. A suspended account resolves to nothing. The `may*` halves take the controls off
  the composer, both comparisons, the thread, the company accept page, the accepted record and the
  review page. `tests/integration/buyer-capabilities.test.ts` fails all twelve of its refusals with
  the asserts removed, and the seven passes that depend on the new definition with the old one
  restored. Found alongside, not fixed: nothing stops a seller's own seat enquiring to, and then
  reviewing, its own business.
- [ ] **9.5 Standing: 29 scheduled jobs, no run persisted.** Two crons, 29 steps, no row written
  anywhere. If the nightly stops firing nothing changes appearance and nobody is told.
- [x] **9.6 Standing: the sale path has no test.** Closed by 6.3. `lib/placement` now has three test
  files — the band ladder and the two arithmetic decisions inside the classifier as unit tests, and
  the sale, the queue, the race and the frozen price as integration ones. `takeSlot`'s comment
  claimed a unique index that is on `placement_waitlist` rather than on `placement_slot`; the rule is
  now held by an advisory lock on the scope, and the race is a test that fails without it. The race
  test also found the check could not see a slot whose start was microseconds later than the
  caller's clock. Three `lib/billing/` files feeding live admin screens are still untested.
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
| `4i` | Staff, roles & audit | built | medium | Staff screen, invitations, role changes and deactivation under one lock; the log filtered, paged, exported and append-only. | 7.1 |
| `12e` | Plan config & failed payments | built | medium | The board's matrix, every cell a control, save/review/commit, add a plan. The VAT return is cut. | 6.1 |
| `4d` | Category taxonomy | built | large | Tree, editor, add, merge with redirects, and one switch per public surface. Q1, Q4 and Q5 answered in code; the home-grid switch read-only per `6h`. | 5.1 |
| `12a` | Licence-record importer | built | medium | Rows staged `needs_category` are terminal — nothing assigns them a category. Closed by 4.1. | 4.1 |
| `12b` | Dedupe & merge | built | small | Pairs from the importer, three outcomes, bulk merge as a unit, tuning previewed, owner confirmation. Closed by 4.2. | 4.2 |
| `4b` | Approval queue | built | medium | Six kinds, checks computed from tunable rules, bounded bulk bar, claims decided. Closed by 4.3. | 4.3 |
| `4c` | Review a submission | partial | small | The credential lane cannot open the credential; moderators get conflict rows that 404. | 4.4 |
| `4f` | Businesses & health | built | small | Health derived from measured reply rate, search, filters, segments, export, detail route. The suspension appeal path is not built. | 4.5 |
| `10g` | Unclaimed listing | partial | small | Both calls to action render `disabled`; the claim destination exists and only the href is absent. | 1.1 / 4.6 |
| `10a` | Subcategory page | partial ↓ | export only | Two definitions of "suppliers in this trade" render on one page. | 5.2 |
| `13c` | Report a listing | built | — | Modal over the storefront and the page it degrades to; value capture, reference, one-shot email, three-source flag, claim door. | 9.1 |
| `4h` | Reports, flags & disputes | built | — | One queue, one taxonomy, a service level per type, and two detectors filling it. | 6.4 |
| `4g` | Subscriptions & revenue | built | small | One Dubai month from the ledger; every ratio prints its formula, NRR excludes new business, placement stays out of MRR. | 6.2 |
| `11e` | Sponsored placement | built | large | One trade in one emirate, priced from measured demand in ten bands, frozen at booking, with an editable rate card. | 6.3 |
| `11i` | Close account | scaffold | large | Terms and privacy publish a closure promise and eight retention windows; nothing implements either. | 6.5 |
| `7a` | Auth — four states | built | 14 Sep 2026 | Password sign-in, reset grants, sign-up fallback, suspension writer. | 3.1 |
| `7b` | Buyer company account | scaffold | medium | A tenant table with no writer: `User.buyerCompanyId` is null for every non-seeded user. | 3.7 |
| `10e` | Buyer enquiry inbox | built | 14 Sep 2026 | Derived chips and verbs, nudge-all, re-send, saved-search alerts, account menu with sign-out. | 3.2 |
| `10h` | Negotiation thread | built | — | Built with board `10h`'s handoff (3.3). | 3.3 |
| `1n` | Compare quotes | partial | small | The tracking page's own Compare button builds a reference the route cannot resolve. | 1.2 / 3.4 |
| `7c` | Accepted quote record | **built** | small | Fenced, and rebuilt against its board-level handoff, 14 Sep 2026. Services variant owed (`7c-s`, see `docs/services-build-plan.md` §6). | 3.4 |
| `10f` | Write a review — gated | built | small | Board built 15 Sep 2026: window, drafts, photos, edit history, the three label sets made one. Q2–Q5 open. | 3.5 |
| `13a` → `1d-v` | Contact reveal, in place | built | 15 Sep 2026 | A state of `1d`: masked landline, three-field dialog, `contact_lead` + session-idempotent `contact_reveal`, seller and staff lead lists. Q5 (consent basis, retention) open. | 3.6 |
| `13b` | WhatsApp hand-off | not started | medium | Must be reconciled with a detector that reports sellers for off-platform steering. | 9.3 |
| `12g` | Notification templates | built | 14 Sep 2026 | Versions per line, a services twin the carrier picks, Meta's queue recorded, volume queried, a delivery log. Strings moved to `12g-s`. | 7.4 |
| `6h` | Homepage curation | built | 14 Sep 2026 | Four slots chosen by a person with eligibility read live, chips typed not mined, a rails map whose counts are the page's own queries. | 7.4b |
| `12g-s` | Paired strings | built | 15 Sep 2026 | A registry of pairs held to their consumers, halves written and suppressed from the console, a count that is a query. | 7.4c |
| `7f` | Notification specimens | partial ↓ | export only | All four channels render; SMS has no carrier and records a skip with a reason. | 7.4 |
| ~~`6g`~~ | ~~Admin copy audit~~ | **cut** | — | Cut 14 Sep 2026, unbuilt. The CI scan still reads exactly one file; every word held in the database is invisible to it. | ~~7.5~~ |
| `10c` | Search — one blended set | **built** | medium | Three-part rail, three zero states, D1. | 5.3 |
| `10d` | Product comparison | **built** | 18 Sep 2026 | Products only, one trade, template rows; tints computed on normalised values; cookie tray capped at four. Supplier comparison retired. | 5.4 |
| `12d` | Ops CRM — supply gaps | built | medium | Tasks only a derivation writes; the lock is `assignedToId`; every rate carries its denominator. | 7.2 |
| `12f` | Support desk & view-as | partial ↓ | small | View-as is the best-guarded thing in the console. | 7.3 |
| ~~`5a`~~ | ~~Builder shell~~ | **cut** | — | Cut 15 Sep 2026 with the rest of the builder; code and routes removed. | ~~8.4~~ |
| ~~`5b`~~ | ~~Theme presets~~ | **cut** | — | Cut 15 Sep 2026. One storefront palette; no seller picks a colour. | ~~8.3~~ |
| ~~`5c`~~ | ~~Section library~~ | **cut** | — | Cut 15 Sep 2026, with `5c-s`. `/b/[slug]` draws a fixed run of five sections. | ~~8.5~~ |
| ~~`5g`~~ | ~~Section specimens I~~ | **cut** | — | Cut 15 Sep 2026 with the section catalogue. | ~~8.5~~ |
| ~~`5h`~~ | ~~Section specimens II~~ | **cut** | — | Cut 15 Sep 2026 with the section catalogue. | ~~8.5~~ |
| ~~`5d`~~ | ~~Page template editor~~ | **cut** | — | Cut 15 Sep 2026; `/b/:slug/:page` removed. | ~~8.4~~ |
| `5e` | Domains & publishing | scaffold ↓ | large | No `middleware.ts` — a verified custom domain serves nothing. | 8.1 |
| ~~`5f`~~ | ~~The published result~~ | **cut** | — | Cut 15 Sep 2026; nothing left to reconcile. | ~~8.2~~ |
| `12h` | Visits, areas, API | scaffold | large | At least two boards. None of the three routes exist. | 7.6 |
| `10i` | Campaign landing | partial ↓ | export only | The model exists so content avoids a deploy; a second campaign costs one. | 7.4 |
| `13e` | Scheduled maintenance | **built** | 14 Sep 2026 | A 503 the proxy serves per system, a window record in Global Config or the environment, and the unplanned error beside it. | 9.2 |
| `13i` | Verification & review policy | scaffold ↓ | medium | The published policy names a fourth rung the DB CHECK forbids. | 1.5 |
| `4a` | Platform overview | partial | small | Twelve of fourteen numbers are honest queries. One queries a tier the ladder cannot reach. | 7.7 |

---

## 5 · The epic's five questions, answered

**Is `4b`'s 62% auto-pass rate measured or illustrative?** Neither — **absent**. `rg -ni
'auto.?pass|auto.?approv|autoApprove'` returns zero hits across the tree. Not a constant either,
so not yet an *every number is a query* violation — putting it on a screen would make it one. What
exists instead is a static field split decided at edit time: four moderated fields against ten
instant. That is 71%, and it is a count of field names, not a rate. Nothing counts instant edits,
so there is no denominator to measure against today. *Settled by 4.3:* a reading — waiting
submissions whose every check passed, over all waiting submissions, computed at read time.

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
the database, half of it the template copy `12g` owns. *(`6g` was cut on 14 Sep 2026.)*

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
  system never asks about. *Closed by 9.4 — and `pnpm matrix` prints a `prov` column now.*
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
