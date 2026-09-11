# The service track — 28 boards, audited

**Audited against the working tree at `d5455a8`, 11 Sep 2026.** Fourteen agents, seven audit slices,
each re-checked by an adversary told to downgrade. Twelve states fell on the second pass.

The input is `docs/epic-2026-09-11.md`, the design side's second epic, which counts 72 of 128 boards
pending and adds a fourth lane of 28 service variants. That document's own §8 says *"Re-check any
epic against the tree before sequencing from it, including this one."* This is that check.

Companion to `docs/build-plan.md`, which sequences the other 44 and stays the sequencer for them,
and to `docs/services-spec.md`, which specifies nine of these screens as S1–S9.

---

## 1 · The finding

**There is no service code in this repository.** Not thin, not partial — absent.

`TradeKind`, `tradeKind`, `trade_kind`, `feeBasis`, `scopeSheet`, `exclusions`, `pricingUnit` and
`turnaround` return hits in `docs/services-spec.md` and `docs/epic-2026-09-11.md` and **nowhere
else** — no `.prisma`, no migration, no `.ts`. There is no `model Service` among the schema's 178
declarations, no `lib/services/`, no `/dashboard/services`, no `/b/:slug/s/:service`. Ninety-three
migration directories, none touching services.

| State | Count | Of 28 |
|---|---|---|
| **built** | **0** | |
| partial | 1 | `3c-s` coverage manager |
| scaffold | 5 | |
| **not started** | **22** | |

This is the opposite of the finding on the other 44 boards, where *nothing* was unbuilt and 40
already rendered. **The unit of work here really is *draw a screen*.** The epic's §2 warning — that
the tracker over-reports pending because it cannot see code — does not apply to this lane.

### Two placeholders exist, and neither document names them as built

- `components/storefront/Services.tsx` — a real component in the registry
  (`components/storefront/registry.tsx:42`) whose section type carries `comingSoon: true`
  (`lib/storefront/section-types.ts:256-269`), filtered out of every live storefront. It renders
  `lib/i18n/en.ts:7367`: *"Not built yet. Services are their own model and this card is here so the
  gap is legible rather than hidden."*
- `app/(dashboard)/dashboard/listing/ListingWorkspace.tsx:102` — `TABS` already contains
  `'services'`, and line 308 renders it as a panel reading "Not built yet."

Both are labelled absences, which is the honest thing. Neither is a foundation.

---

## 2 · Four corrections to the epic

### 1. The Open / Taken column is close to inverted

Four of the six decisions the epic calls **open** shipped in code, two of them in migrations dated
*after* the epic was written. Four of the five it calls **taken** have zero code.

| Epic | Tree |
|---|---|
| D1 plan limits — *Open* | **Shipped.** `prisma/migrations/20260928090000_plan_caps_ratified/migration.sql:42-71` |
| D2 placement term — *Open* | **Shipped** (#152), with a live defect — see §5 |
| D3 attribute dictionary — *Open* | **Answered no.** Table dropped, `20260929090000_drop_spec_field_proposal` |
| D4 enquiry cap — *Open* | **Settled**, deferred to GTM by the owner |
| D6 editorial attribution — *Open* | **Shipped** (#153) |
| D5 services — *Taken* | Zero code |
| D7 sizing — *Taken 10 Sep* | Zero code. The spec dates the same decision 9 Sep |
| D8 mixed catalogues — *Taken* | Zero code; nothing can hold the answer |
| D9 copy drift — *Taken* | Zero code, and **no instrument exists that could charge its cost** |
| D10 credentials — *Taken 11 Sep* | **Refused by the tree** — see below |
| D11 availability — *Partly taken* | Zero code, and contradicts D4 — see below |

The epic's summary line — *"D1, D3 and D11 are the live ones"* (`docs/epic-2026-09-11.md:102`) — is
wrong on two of three.

### 2. D10 contradicts a CLAUDE.md non-negotiable by name

D10 reads *"Evidence. Optional upload, no register, no expiry tracking, no renewal chasing."* It is
a decision to **remove** three things that are shipped:

- **Expiry tracking** — `Document.validUntil` (`prisma/schema.prisma:1601`), plus
  `Business.licenceExpiry` swept by `lib/verification/expiry-job.ts:65` against
  `EXPIRED_LICENCE_TIER = 1` (`lib/verification.ts:40`), scheduled at
  `app/api/jobs/daily/route.ts:222`.
- **Renewal chasing** — `lib/verification/licence-notice-job.ts:55`, off `LICENCE_NOTICE_DAYS` /
  `LICENCE_URGENT_DAYS` (`lib/verification.ts:124-125`).
- **A register** — `lib/verification/credentials.ts:26` fences `trade_licence` and
  `vat_certificate` as the kinds checkable against an issuing authority.

`CLAUDE.md` non-negotiable 2 names `lib/verification/expiry-job.ts` by file and says it *"is correct
as it stands — do not give it a synthetic one."* **Enacting D10 as written means deleting a rule the
project calls architectural.**

The epic also contradicts itself inside twelve pages: line 99 rules *no register*; line 223
specifies `4c-s` as *"A register lookup, not a photo judgement."*

**The resolution is a rewrite, not a build.** D10 is right about *service credentials* — an ISO
certificate, a lift-maintenance approval — which have no register and should be optional evidence.
It is wrong to generalise that over the trade licence, which does. Scope D10 to credentials that
are not the licence, and both halves are true.

### 3. D11 forecloses on D4, which was already ratified

D11 proposes an accepting / waitlisted / closed toggle, with `1e-s` carrying an *"Include
waitlisted"* facet and a *"Join the waitlist"* button. That is a buyer-facing statement that a
supplier is at capacity.

The owner's D4 answer, verbatim: **"Don't ever let buyers know that sellers are 'at capacity'. This
defeats the purpose of the platform."** And `docs/services-spec.md:86-88` rules out availability
windows entirely.

Both of D11's nouns are also already taken by live models. `Availability` is a per-product stock
enum (`prisma/schema.prisma:1211`) rendered as a public facet
(`app/(public)/_results/Results.tsx:73`). `waitlist` is the sponsored-slot queue
(`prisma/schema.prisma:2071`) with a shipped seller control.

**Recommendation: close D11 as *no*.** It was already removed from `3c-s` and `1f-s` on the right
principle — a listed business is taking work.

### 4. §4's ranking amendment rests on a factual error, and the real defect is elsewhere

The epic says a service supplier *"can never earn those 12"* spec-completeness points. On the tree
they earn **six**. `lib/metrics/spec-completeness.ts:102` returns `null` for a business with no
products, and `lib/search/ranking.ts:349` scores a null at `UNKNOWN = 0.5`
(`lib/search/ranking.ts:296`). The exposure is half what the epic states.

Three things the amendment does not know, all of them worse:

- **The total is not 100 on the live search path.** `weightsForShape`
  (`lib/search/origin.ts:130-134`) overwrites `distance` with a literal `4` on a SKU query and `14`
  on a service-shaped one, renormalising nothing. Against the seeded 34/22/18/12/8/6 the six total
  **96 and 106** at `lib/db/queries/search.ts:409` and `:609`. `lib/search/ranking.ts:130-152`
  argues at length that the 100 total is a rule and not a workaround, and
  `lib/search/settings.ts:136-137` enforces it on the authored vector only — `validateWeights` never
  sees the shape vector. So "12 of 100" is false on two of three query shapes.
- **`RankingWeights` is a Postgres singleton.**
  `prisma/migrations/20260827220000_ranking_weights/migration.sql` carries
  `CHECK ("id" = 'current')`. "Gains a kind key" is a drop-and-re-key migration on the live ranking
  table, not a column add.
- **The affected-seller count already lies.** `lib/search/directory.ts:106` takes
  `MAX_LISTINGS + 1`, so `unread` at `:113` is **1 whenever it is non-zero**, at any directory size
  above the cap. `app/(admin)/admin/search/ImpactTable.tsx:96-98` prints "1 past the sampling cap
  were not ranked" before an ops lead presses publish. That is a constant wearing a query's clothes
  on a decision surface. And the 30,000 in §4 cannot be printed at all — the sampler caps at 20,000.

The epic is right that a second vector is owed. It is wrong about the size of the hole, and it does
not name the three defects that have to be fixed before a second vector is even coherent.

---

## 3 · The three decisions — all settled 11 Sep 2026

### The model — **a service is its own entity**

`docs/build-plan.md:161` said a service supplier keeps the same catalogue table;
`docs/services-spec.md` §3 gave services their own editor and their own public page. Both are mine,
and they are different products — one is a `kind` discriminator on `Product`, the other is a second
model, a second editor, a second public route, a second catalogue and a second search path.

**Settled in the spec's favour.** The reason is not aesthetic: `Product` carries `availability`,
`stockQty`, `minOrderQty`, `sku` and `specValues`, all NOT NULL or defaulted, all rendered by
shipped components, and every one of them is a lie about a service. `Product` has readers in
search, fan-out, the storefront, the importer, the media library, quotes and four scheduled jobs; a
`kind` column makes each of them grow a branch, and the cheaper model is only cheaper until the
first bug in the eighth branch. `docs/build-plan.md` has been corrected.

### D10 credentials — **split by whether a register exists**

Trade licence and VAT certificate keep the register (`lib/verification/credentials.ts:26`), the
expiry sweep (`lib/verification/expiry-job.ts:65`) and the renewal notices
(`lib/verification/licence-notice-job.ts:55`) exactly as they are — `CLAUDE.md` non-negotiable 2
names that file and says it is correct as it stands. Everything else — an ISO certificate, a
lift-maintenance approval, a municipality permit — is **optional evidence**: uploadable, skippable,
no register lookup, no expiry chasing.

This also resolves the epic's internal contradiction between line 99 (*no register*) and line 223
(`4c-s` is *"a register lookup"*). Both are now true of different kinds. `8b-s` and `4c-s` are
unblocked; `4c-s` narrows to the two checkable kinds and refuses to imply verification for the
rest, which is what `lib/i18n/en.ts:322` already tells sellers.

### D11 availability — **closed as no**

The accepting / waitlisted / closed toggle is cut from all five boards that still carried it —
`1c-s`, `1d-s`, `1e-s`, `1g-s` and `8c-s`, including `8c-s`'s "Waitlist is a real answer" card. It
showed buyers that a supplier is at capacity, which D4 forbids in the owner's own words: *"Don't
ever let buyers know that sellers are 'at capacity'. This defeats the purpose of the platform."*

Both of its nouns were already taken by live models — `Availability` is a per-product stock enum
rendered as a public facet, `waitlist` is the sponsored-slot queue — so keeping it would have cost
two new words as well as a reversal.

**The principle that survives:** a listed business is taking work.

---

## 4 · The stages

**Naming.** *Stages* are build order, numbered 0–7. *Screens* are `S1`–`S9` in
`docs/services-spec.md`, and `-s` board ids are the design side's. The three sets are unrelated —
screen `S1` (service detail) is built in **Stage 4**.

Ordering principle, inherited: **what is live and wrong, before what is live and thin, before what
does not exist yet.** In this lane almost everything is the third category — so the exception is
Stage 1, which is the only part of the service track that is live, wrong, and costing money today.

---

### Stage 0 · The three decisions
**Closed 11 Sep 2026.** See §3. Nothing below is blocked on a decision any more — only on a design
handoff, and Stages 1 and 2 do not need one.

---

### Stage 1 · Two signals nobody measures — **shipped**
*Live and wrong, kind-agnostic, and on neither planning document.*

**Scoped down on the way in, from five items to two.** Three of the five turned out to need
`Category.tradeKind` before they can be done honestly, and are re-filed below rather than half-done:

- **`coverage` from product count** moves to Stage 2. A supplier with no live products genuinely
  matches zero *product* lines — that is a correct measurement for a seller of goods and a question
  about the wrong noun for a seller of jobs, and nothing here can yet tell them apart.
- **`profileStrength` capping at 65** and **the setup hub that cannot close** move to Stage 3, where
  services exist to count toward `catalogue` and to give the hub's third card a destination. Fixing
  the hub earlier would ship a card pointing at a route that does not exist.

What shipped:

- [x] **1.1 `inStockLineCount` was a hardcoded `0`.** `lib/enquiry/service.ts` was the only
  production writer of the field and wrote a literal zero for every candidate on every enquiry, while
  `stock * 0.2` (`lib/enquiry/fanout.ts`) carried a fifth of the score. A zero is not "we did not
  look" — it is a measurement, and it said every supplier in the country has nothing on the shelf.
  Both planning documents framed this as a services-specific structural zero. **It was
  directory-wide**, and it is why a goods supplier topped out at 0.80 rather than 1.00.
- [x] **1.2 Locality read one arbitrary row and ignored the coverage table.** The candidate query
  took the first published location with `take: 1` and **no `orderBy`**, so a two-branch supplier's
  locality term was whichever row Postgres returned, re-decided on every enquiry. And
  `BusinessCoverage` — whose own schema comment says it is *"what `1h` routes on today"* — had one
  writer, two dashboard readers and no reader in the fan-out at all. A Sharjah depot promising
  next-day Dubai took the out-of-emirate penalty on every Dubai enquiry, contradicting its own
  storefront.
- [x] **1.3 `UNMEASURED`, named once.** The file already applied *unmeasured scores the midpoint,
  never zero* to `speed`, with a comment explaining that defaulting a new listing to slow "would make
  the cold-start problem permanent" — and applied it nowhere else. It now governs coverage, stock,
  locality and speed from one constant. A supplier with no stated location is unknown, not far away.

**Effect.** `matchedLineCount` and `inStockLineCount` are `number | null`; `emirate: string` became
`emirates: readonly string[]`. Nothing outside `lib/enquiry/` read the old field. The reachable
ceiling rises from 0.80 to 0.90 for every supplier, the stock term stops being dead weight, and a
service supplier's locality is decided by what they promised rather than by where their one office
happens to be.

**What it does not do.** The 0.34 coverage term is untouched, so a supplier with no catalogue still
loses it. That is Stage 2, and it is the larger half.

### Stage 2 · The fork — **built, awaiting the migration**
*One migration, one resolver, one ops screen. Stops for a person.*

- [x] **2.1 `TradeKind` and `Category.tradeKind`** — `20260930090000_category_trade_kind`.
  Additive and nullable, so it applies **before** the merge. Two values and no third: "both" is a
  property of a business, which `BusinessCategory` already expresses, not of a trade.
- [x] **2.2 The null-inherit resolver.** Written, not copied. `lib/taxonomy/sector.ts:44-55` is the
  precedent for the *shape* only — it looks for the top of the tree and returns an id, where this
  looks for the nearest ancestor holding a value, and it issues one `findUnique` per level. The rule
  is pure and unit-tested in `lib/taxonomy/trade-kind.ts`; the query half is in `./service.ts`.
- [x] **2.3 No database default, deliberately.** A default would write `goods` into all 440 rows and
  make "decided" and "never opened" the same fact. The fallback is `goods` in code — what every
  surface assumed before the column existed, so the day it ships nothing changes.
- [x] **2.4 `4d-s`/S9, the ops screen.** A SOLD column with three states and a panel whose bulk
  primitive is inheritance: thirteen writes cover the taxonomy, then the exceptions are typed.
  Impact shown before the button, separating what moves from what will not follow. Audited.
- [x] **2.5 The first consumer.** `findFanoutCandidates` resolves the enquiry's category once and
  stops counting products on a trade sold by the job — the 0.34 term, carried over from stage 1.

**The count is 440, not "~420".** 13 sectors and 427 subcategories. `pumps-and-motors` has **zero
children**, so a per-subcategory-only screen could never set it — which is one reason the panel takes
sectors as well. Two sectors are unambiguously all-services and take one write each.

### Stage 3 · The seller can describe what they sell
`8a-s` → `8b-s` → `8c-s` → `3g-s`/S3 → `3f-s`/S4 → `3h-s`

`8b-s` is unblocked by D10's split and narrows to optional evidence. `3h-s` follows the model
answer: services get their own scope template rather than reusing `SpecTemplate`. `3b-s` is a schema diff,
not a copy change: `ModeratedField` is a Prisma enum (`prisma/schema.prisma:1981-1988`) and
`lib/listing/service.ts:51-52` says the list is explicit *"so a new field is a deliberate choice on
one side or the other."* It stops for a person too.

---

### Stage 4 · The buyer can read it
`1g-s`/S1 → `1d-s` → `1e-s` → `5c-s` → `1f-s`

**A gate nobody has connected to this track:** the `certifications` section — the only public
credential surface, and the exact slot `1d-s` wants — is stripped on the Free plan
(`app/(public)/b/[slug]/page.tsx:600-604`). A free service supplier's storefront would show neither
a catalogue nor credentials.

---

### Stage 5 · The buyer can ask for it
`1h-s`/S2 → `3j-s` → `1n-s`, plus two schema changes the spec half-names.

- `EnquiryLine.qty` is `Int` **NOT NULL** (`prisma/schema.prisma:1790`).
- **`QuoteLine.qty` is the harder blocker and neither document names it.** Also NOT NULL
  (`prisma/schema.prisma:2757`), and `lib/quote/send-quote.ts:114-116` refuses `qty < 1` with
  `quote.error.bad_qty`. The quote side gates the terminal state of the entire product — an accepted
  quote — so a service enquiry that cannot be quoted cannot convert.
- `Enquiry.deliverToArea` is **free text** (`prisma/schema.prisma:1701`), not an `areaId`. So the
  area-level coverage match proposed as `coverage`'s replacement is not computable from the enquiry
  side at all today. Only `Enquiry.emirate` is structured. That is a second migration plus a
  composer control, and it belongs to this phase rather than S1.

---

### Stage 6 · Discovery
`1c-s` → `10c-s` → `6a-s`/S7

**The epic's premise for `1c-s` is false on the tree.** It warns that "a default of Products makes a
services-only firm invisible"; `lib/search/query.ts:182` defaults `tab` to `businesses`. The
products tab is opt-in. The board is still worth building for the kind badges; the urgency claimed
for it is not real.

`6a-s` is the expensive one and the epic is right that it roughly doubles the `6f` page matrix.

---

### Stage 7 · Ranking and ops
`12c-s` → `4e-s` → `4c-s` → `12g-s` + `6g-s`

`12c-s` cannot be built until §2's three ranking defects are fixed — the 96/106 totals, the
singleton CHECK, and the `unread` counter that can only print 1.

**`4e-s`'s named trap is not the one the epic names.** It flags "fee basis is an enum per family" as
"the field most likely to be built wrong" without saying why: **a Prisma enum is one fixed value set
for a column.** Per-family allowed bases is a second table keyed by family. It cannot be an enum.

**`12g-s` + `6g-s` have no instrument to charge D9's accepted drift.**
`scripts/check-vocabulary.sh` has no pair concept, and `lib/i18n/coverage.ts` counts keys. Nothing
in the tree records a copy *swap* at all.

---

## 5 · Found on the way — not services work, and one of them is money

Ranked by what it costs.

1. **The placement credit over-credits an annual seller.** `lib/placement/service.ts:225` writes the
   slot term as a literal `30 * 86_400_000` and never imports `SLOT_TERM_DAYS`, whose own docblock
   (`lib/placement/term.ts:46`) names `takeSlot` as the caller that reads it. Then
   `lib/billing/renewal-job.ts:335` resets `endsOn` to `nextRenewsAt` — a **year** out on an annual
   term (`:228`) — while `lib/placement/term.ts:81` always divides by 30. An annual seller who
   cancels with ~365 days left is credited roughly **12.2 months of placement against the 10 months
   actually charged** (`lib/billing/renewal-job.ts:140-151`), and it is issued as a real
   `credit_note` correcting a `tax_invoice` (`lib/placement/term.ts:198-213`). Even on monthly terms
   the denominator is wrong every month that is not 30 days. **This is mine, from #152.**
2. **The enquiry cap bypasses the entitlement snapshot D1 rests on.** `lib/enquiry/service.ts:186`
   reads `business.plan?.enquiriesPerMonth` straight off the live `Plan` row; `fanout.ts:103-104`
   caps on it. A grandfathered seller is capped at the new number.
3. **`publicPhotoLimit` has no editor.** `app/(admin)/admin/plans/PlanEditor.tsx:44-60` lists seven
   caps and omits it; `actions.ts:35-46` never writes it. An eighth plan number, staff-invisible —
   the exact thing D1 ratified against.
4. **An eighth divergent template resolver, in the writer of the ranking column.**
   `lib/metrics/strength-job.ts:109` resolves a product's template as
   `row.category?.defaultTemplateId ?? null` instead of `resolveTemplateId`
   (`lib/spec/resolve.ts:44-69`), the three-step rule board 4e wrote to end exactly this. Reachable
   by a shipped staff action: `setTemplateCategories` attaches a template and never writes
   `defaultTemplateId`, so the product resolves `rules = []` and counts **complete**, inflating that
   seller's `specCompleteness` to 1.00 — which is 12 ranking points.
5. **`removeCategory` has no capability check.** `app/(onboarding)/onboarding/profile/actions.ts:76-83`
   guards only on `actor?.businessId` and returns `{ ok: true }` whether or not a row was removed.
   Its dashboard sibling `removeCoverage` calls `assertCanEditListing`.
6. **`nav-config.ts:102`** — the verification row is the only one in the storefront group with no
   `capability`.
7. **12d prints a page cap as a total.** `app/(admin)/admin/crm/page.tsx:44` renders
   `rows.length` from `callList(200)` as "{count} prospects, from demand we measured". Its
   `reply_rate_falling` signal has a label and no producer, and `CallOutcome`'s only writer is
   `logCall`, whose only caller is an integration test — so the recently-called suppression is dead.
8. **Untranslated strings** at `lib/reports/service.ts:147,151`, returned to the UI verbatim.

Items 1–3 are one coherent billing batch. Item 4 is a ranking-honesty fix and belongs with `12c-s`.

---

## 6 · Records

- **`2e-s` is an orphan.** It appears once, in D1's *Blocks* column
  (`docs/epic-2026-09-11.md:90`), and in no phase. A 29th `-s` id in a document that says 28.
- **§5 says "72 boards, each placed once."** The phases hold **70**; `3b-s` and `3c-s` are placed
  zero times, as §6 itself admits.
- **Both documents mis-cite the most expensive line in the product.** `epic:255` and
  `services-spec.md:19` name `lib/enquiry/fanout.ts:181` for the weight formula. Line 181 is the
  bare `1,` argument to `Math.min`. The weights are on **182**, which `build-plan.md:167` cites
  correctly. `Math.min` there is dead anyway — the six weights sum to exactly 1.00 and every term is
  already clamped.
- **D7 carries two settlement dates** — `epic:96` says 10 Sep, `services-spec.md:143` says 9 Sep.
- **`ScopeDemand` is a false friend.** `prisma/schema.prisma:4743` is board 6f's keyword-volume
  table, not a scope sheet. With `PlacementWaitlist` and `enum Availability`, that is three
  service-sounding names in the schema that mean something else.
- **A `QueryShape` union already knows about services.** `lib/search/origin.ts:75` declares
  `"sku" | "spec" | "service"`, classified at `:91-120` on the rule that *"a query that no product
  matches is a query about a service — AMC contractor, PRO services"*. It is the one place in the
  tree that has heard of the concept.

---

## 7 · The handoff order

**Stages 1 and 2 are done and need no handoff.** Stage 1 was scoring and metrics — the fan-out score is never
persisted (there is no score column on `EnquiryRecipient`) and never rendered; `selectRecipients` is
called from a server action (`app/(public)/rfq/actions.ts:108`) and returns a recipient list, not a
number on a page. Stage 2's one screen, `4d-s`/S9, is a variant of `/admin/categories` — an existing
staff table plus a column and a bulk control, internal, no buyer or seller sees it. I will build it
against that table's own conventions unless the design side would rather draw it.

**Send them in build order, not hardest-first.** `docs/services-spec.md:239-241` suggested S1, S2,
S3 first on the grounds that they are the long poles. That is the right order to *design* in and the
wrong order to *deliver* in: a handoff that arrives early costs nothing to hold, and one that arrives
late blocks a stage. The stages below are the order I can actually build.

| # | Send | Screens | Builds in | Note |
|---|---|---|---|---|
| 1 | **S3 + S1 together** | service editor, service detail | Stage 3, Stage 4 | **A pair, not two handoffs.** Same field set from the seller's side and the buyer's. Designed apart, the editor collects fields the page never shows, and the "unfilled stays visible" rule makes that visible to both |
| 2 | S4 / `3f-s` | services list | Stage 3 | Close to `3f`. Shorter table, and only the bulk actions that mean something |
| 3 | S8 / `8a-s` + `8c-s` | setup hub, scope sheet + 3 services | Stage 3 | The hub card's destination is `/dashboard/services`, so it cannot land before S4 |
| 4 | `8b-s` | credentials task | Stage 3 | Narrowed by D10's split: optional evidence only, no register, no chasing. The licence keeps all three |
| 5 | S5 / `1d-s` · `1e-s` · `5c-s` | storefront services section | Stage 4 | `components/storefront/Services.tsx` already exists as a labelled placeholder — the renderer has a home |
| 6 | S2 / `1h-s` | service enquiry composer | Stage 5 | The expensive one, and the one carrying `EnquiryLine.qty` and `QuoteLine.qty` |
| 7 | `3j-s` + `1n-s` | reply with a proposal, compare proposals | Stage 5 | Consecutive. Four fee bases do not compare the way four unit prices do |
| 8 | S6 / `1c-s` · `10c-s` | search, kind-scoped facets | Stage 6 | |
| 9 | S7 / `6a-s` | area landing, service variant | Stage 6 | Roughly doubles the `6f` page matrix |
| 10 | `4e-s` · `4c-s` · `12c-s` | scope families, credential review, ranking | Stage 7 | `12c-s` waits on §2's three ranking defects |

**`1f-s` needs no handoff either.** D11 is closed, so what is left of that board is board `1f`'s
shipped page reading `BusinessCoverage` instead of two seller-claimed fields — which is Stage 1's
locality fix surfacing, not a new design.
