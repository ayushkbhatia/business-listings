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

### Stage 2 · The fork — **shipped**
*One migration, one resolver, one ops screen. Stopped for a person.*

- [x] **2.1 `TradeKind` and `Category.tradeKind`** — `20260930090000_category_trade_kind`, applied to
  production before the merge. Two values and no third: "both" is a property of a business, which
  `BusinessCategory` already expresses, not of a trade.
- [x] **2.2 The null-inherit resolver.** Written, not copied — `lib/taxonomy/sector.ts:44-55` is the
  precedent for the *shape* only. Pure and unit-tested in `lib/taxonomy/trade-kind.ts`.
- [x] **2.3 No database default.** The fallback is `goods` in code, so an unset taxonomy behaves
  exactly as the product did before the column existed, and "decided" stays distinguishable from
  "never opened".
- [x] **2.4 `4d-s`/S9, the board** — **handoff received and built out, 11 Sep.** Its own tab at
  `/admin/categories?tab=kind`: unset-first ordering, 25-row pages over 440, multi-select with a
  bulk bar, an atomic write, a confirmation naming the listings it moves, a set-by column read from
  the audit log, and the two explanatory cards. See §4c for what the handoff asked that the tree
  already had, and the three places this build diverges from the render.
- [x] **2.5 The first consumer.** `findFanoutCandidates` resolves the enquiry's category once and
  stops counting products on a trade sold by the job.

**The count is 440, not the handoff's "420".** 13 sectors and 427 subcategories. `pumps-and-motors`
has **zero children**, so a per-subcategory-only screen could never set it — which is why the board
lists sectors as selectable rows rather than filtering them out.

---

## 4c · Handoff `4d-s` — what was already built, and where this diverges

The handoff's §5 asked for exactly this note: *"check the tree before building. If `tradeKind` or
something like it already exists, tell us, and this becomes an export-against-tree rather than a new
build."*

**It did.** `Category.tradeKind`, the enum, the bounded resolver and an audited write shipped in
#157 on 11 Sep, before the handoff arrived. Four of its eight acceptance criteria were already met.

| | Criterion | Before the handoff | Now |
|---|---|---|---|
| 1 | Resolves for every category, no unbounded recursion | ✓ | ✓ |
| 2 | Null inherits; root fallback is `goods` and is visible | ✓ resolves · not surfaced | ✓ counted and stated on the screen |
| 3 | Every write records author, timestamp and reason | ✓ | ✓ |
| 4 | Bulk set is atomic | — | ✓ one transaction, one audit row per category |
| 5 | Confirmation naming the listing count | — | ✓ and it counts what *moves*, not what was selected |
| 6 | Flipping a kind never converts existing rows | ✓ by omission | ✓ and the dialog says so |
| 7 | Progress figure and unset-first sort from one query | — | ✓ `loadTradeKindBoard` returns both |
| 8 | Resolved map cached, invalidated on write | — | ✓ read-through, dropped from the action |

### Three divergences, each deliberate

**Two tabs, not four.** The render draws Sectors / Subcategories / Trade kind / Scope sheets.
Sectors and subcategories are one table here and always have been, and splitting them is a change
with no stated purpose. *Scope sheets* is `4e-s` — a board that may never exist, because it turns on
Q1 in §4b. A tab for a board that might be cancelled is a dead end somebody has to click to find.

**The cache is read-through, not strict.** `unstable_cache` throws outside a Next request, and
`revalidateTag` throws in the service layer for the same reason. So the reader falls back to the
query when there is no request context — a job, a script, a test — and the invalidation happens at
the action boundary. A cache that made the taxonomy unreadable from a scheduled job would be a worse
defect than the round trip it saves.

**Non-ops-lead staff still get a 404, not a read-only view.** The handoff's states table asks for the
column to stay visible to other staff, *"how they answer why does this seller see that screen"*. The
whole route is gated on `taxonomy.write` today and `tests/e2e/admin-console.spec.ts` asserts a
moderator gets 404 there. **Widening who can see a screen is not a side effect of building one**, so
the gate is unchanged and the request is recorded here instead. It needs a decision, and it is
really a question about `4d` rather than about this board.

### The handoff's open questions, answered

- **Q1, a third kind for equipment-rental-with-an-operator:** **no**, and the schema comment says so
  — a third value would let a subcategory be neither, and every one of ~40 consumers would need a
  branch for a state the taxonomy cannot act on.
- **Q2, who can set it:** ops lead only. Already true — `taxonomy.write` is `OPS_LEAD_ONLY`.
- **Q3, who sets the 13 sectors:** by hand on this screen, so each is audited. The seed sets six as
  fixtures only, and production has **0 of 440 set** — the work is real and it is ops's.

### Stage 3 · A service exists, and one screen owns its fields
*The editor first. Nothing above it in this lane can be drawn until its field set is fixed.*

**Re-sequenced 11 Sep 2026 on the owner's instruction:** the editor moves ahead of every screen
that creates a service. The epic had it the other way — `8c-s` and `3f-s` in its Phase 2, `3g-s` in
its Phase 6 — so a seller would have created services through onboarding four phases before a screen
existed to change one.

The generalised rule, which is what the instruction is a case of:

> **Nothing creates a row no screen can edit. Nothing renders a field no screen can fill. Nothing is
> capped by a number that does not exist.**

| Step | What | Note |
|---|---|---|
| **3.1** | The `Service` model | A migration, so it **stops for a person**. Additive, applies before the merge |
| **3.2** | `2e-s` — `Plan.serviceLimit` | **Same migration, and it is not optional.** See below |
| **3.3** | **`3g-s` / S3** — the service editor | The first screen of the lane. Its field set is the contract every later board renders |
| **3.4** | **`3f-s` / S4** — the services list | The editor's entry point. An editor reachable from nowhere is a route, not a screen |

**Why `2e-s` stops being an orphan here.** It appears exactly once in the epic
(`docs/epic-2026-09-11.md:90`, D1's *Blocks* column) and in no phase — a 29th `-s` id in a document
that says 28. It is load-bearing all the same: `Plan` carries `productLimit` and **no service
limit**, so the moment services are their own model a Free seller can create them without end. D1
ratified seven numbers and none of them is this one. **The eighth number is owed before `8c-s`, not
after it**, or the first board that creates services creates uncapped ones.

**`3g-s` and `3f-s` are one handoff.** The list's columns are a summary of the editor's fields;
drawn apart, the list shows a column the editor cannot fill or omits one it can.

---

### Stage 4 · Services get created
*Everything that writes a `Service` row, now that a screen exists to change one.*

`2b-s` → `2c-s` → `2d-s` → `8a-s` → `8b-s` → `8c-s`, then the two maintenance screens.

| Board | State | Note |
|---|---|---|
| **`2b-s`** Claim result | **shipped 11 Sep** | `/onboarding/kind`, between verify and profile. See §4d |
| **`2c-s`** Profile basics | **shipped 11 Sep** | One screen, conditional field set. See §4e |
| **`2d-s`** Coverage, not branches | | `BusinessCoverage` exists and onboarding never writes it. Free zone is **already** a second axis — `Area.isFreeZone`, whose own comment says so. What is missing is a delivery mode, and `scripts/check-schema-invariants.sh` forbids it being its own table |
| **`8a-s`** Setup hub | | **Three tasks, not four** — the epic is wrong and the code's own stale prose is where it got it |
| **`8b-s`** Credentials task | | Unblocked by D10's split: optional evidence, no register, no chasing |
| **`8c-s`** Scope sheet + first 3 services | | Lands **after** the editor, not four phases before it |
| **`3b-s`** Listing profile | | A schema diff, not copy: `ModeratedField` is a Prisma enum, so it **stops for a person** |
| **`3c-s`** Coverage manager | mostly built | Panel, writer, capability guard and listing revision all ship |

**`profileStrength` is fixed here, not in stage 1.** `catalogue: 20` + `filterableSpecs: 15` of 100
are unreachable without products, against a published `STRONG_ENOUGH` of 80 — so a service supplier
can never be strong enough. It needs services counting toward `catalogue`, which needs stage 3.

---

## 4d · Handoff `2b-s` — the declaration, and what it settled

Shipped 11 Sep at `/onboarding/kind`. It sits at the end of verify, after ownership is proven and
before profile, and **adds no numbered step** — `step="verify"` keeps the indicator on 2 of 5,
because this is not a task the seller performs but the question that decides what the tasks are.

### It answered §4b's Q2, and better than the recommendation there

§4b asked whether a business's kind is **derived or declared**, and recommended derived-only. The
handoff's answer is **both, with different jobs**, and it is the better one:

- `Category.tradeKind` decides how **one listing** renders. A fact about a trade.
- `Business.sellsKind` decides which **onboarding, nav and setup tasks** the seller gets. Their own
  declaration.

Derived-only could not have captured intent, and intent is what sizes the setup — "roughly twice the
setup, so pick it only if you mean it" is a sentence the taxonomy cannot say. Where the two disagree,
`2c-s` asks again rather than overriding either, which `BusinessCategory.unverifiedActivityAt`
already has the column for.

`both` lives on `SellsKind` and deliberately not on `TradeKind`: on the category a third value would
let a subcategory be neither, and ~40 consumers would branch for a state the taxonomy cannot act on.

### The rule that shaped the build

**A recommendation may only come from a decision somebody made.**

`resolveTradeKind` never returns null — an unset category falls back to `goods` so the product
behaves as it did before the column existed. That fallback is right for rendering and useless as
evidence. Production has **0 of 440 categories set**, so if the fallback counted, every seller on the
platform would be shown *"we sell products · MATCHES YOUR LICENCE"* over a licence nobody had read.

The recommendation is therefore built from `tradeKindOrigin`, which distinguishes a decision from a
fallback, and an undecided taxonomy produces no recommendation at all — the handoff's AC2. Three
silences are told apart, because they send a seller to different places: no trades yet, trades but
nothing decided, and a licence that states no activity.

### What was built beyond the render

- **B5's Settings path.** The screen promises "you can switch in Settings at any time", and B5 says
  not to ship that copy without the behaviour. `/dashboard/settings` now carries the control,
  confirmed, outside the tab split — a fact about the business is neither a notifications setting nor
  a channels one, and one that appears under a single tab is one most sellers never find.
- **AC1 enforced on the way in.** Profile redirects an `unset` seller back, rather than trusting the
  link that got them there.
- **The fork only where it is unanswered.** Verify hands off to profile as before for a seller who
  has already answered, so a published one is never routed into a screen that would bounce them.

### Verified by clicking it

The recommendation rendered `services` from a decided trade with the licence's own words beside it;
selecting **products** against it added **zero characters** of copy and no warning — AC4 — while the
badge stayed on services so the seller could see what they were disagreeing with; the override
persisted; a direct URL to profile bounced back; and changing the kind in Settings on a published
listing left all **8 products intact, 3 still in stock**.

One copy defect was found that way and not by any test: the saved message read *"Saved. You now sell
We sell services."* — an option title is a whole sentence and cannot be read back inside another one.
Short forms added.

### Still open from this handoff

**Q2, the ambiguous case.** The handoff recommends shipping the neutral three-option version and
measuring, rather than asking a second question. Shipped neutral.

**Q3, existing sellers.** Shown the screen once rather than migrated by inference — which is what
`sellsKind` defaulting to `unset` does, and why there is no backfill in the migration.

## 4e · Handoff `2c-s` — the field swap, and what was not there to swap

Shipped 11 Sep at `/onboarding/profile`. **Same route, same step, same shell** — a conditional field
set keyed on `sellsKind`, which is B1 and the reason this is a variant rather than a fork.

### Two corrections to the handoff

**There was nothing to remove.** The board lists four goods-only fields to take away — brands
carried, minimum order value, typical lead time, delivery radius. **Not one of them is on this
screen.** `minOrderQty` and `leadTimeDays` are on `Product`, `serviceRadiusKm` is on `Location`, and
brands do not exist anywhere. Four fields out on paper, zero in the tree. The copy explaining the
absence still ships, because a seller benefits from being told the goods questions do not apply.

**Two of the four additions were already there.** *People on the team* is `teamSize`, *practising
since* is `establishedYear`, both collected from every seller since board 2c. They are **relabelled,
not duplicated** — a second year column is two writable paths to one truth. The real additions are
three: `headline`, `sectorsServed`, `servicesOffered`.

`TeamSizeBand` is **not** re-banded to the board's proposal. Ours are `b1_10 … b500_plus` and 123
live rows hold them; changing them is a migration over live data for no stated gain.

### The one-liner is a new field, not a shorter description

`description` is six hundred characters and 123 listings hold one; the one-liner is ninety and shows
in every search result. Capping the existing column would truncate live data, so `headline` is its
own column and the long description is **hidden for a services seller, never dropped**.

### The sector index, and its cold start

B2's index is a materialised table rebuilt by the nightly job: the most-picked sectors **within the
seller's own categories**, so a tax practice is offered free-zone entities and a valve trader
contracting. A sector a seller types joins the index and may become a chip for the next one.

Where nobody has filled the field in it is **empty**, and the screen says so rather than rendering a
plausible twelve — which would be the curated list the board rejects, wearing the clothes of data.

### Caps, and why two of them

The service cap is the board's, at five. The **sector cap is not in the board and was added**: free
entry on an unbounded array that every search result reads is a Friday afternoon away from a card
carrying two hundred sectors. Twenty, each under forty characters.

Nothing truncates. Over a cap is a refusal naming the cap — B4 — and the row is left alone, so a
seller who is over does not lose the five they had while being told about the sixth.

### AC7 is satisfied by construction

`components/domain/ServiceProfileFields` is one component, and the dashboard mirror `3b-s` mounts
the same one. A shared field set that exists twice is two field sets that agree today.

### Verified by clicking it

The counter read 76 of 90; a sixth service was refused with the cap named and the input disabled; a
chip and a never-seen sector — *P&I clubs* — both landed; the autosave wrote exactly five services
and both sectors; `description` survived untouched. Typing 95 characters turned the counter amber
**and the row did not change**, so the colour is a gate rather than decoration.

---


### Stage 5 · The buyer can read it
`1g-s` → `1d-s` → `1e-s` → `5c-s` → `1f-s`

**`1g-s` / S1 is drawn with `3g-s`, built here.** Same field set from the buyer's side. Designing
them apart is how the editor ends up collecting a field the page never shows, and the
"unfilled stays visible" rule makes that mismatch visible to both people at once.

**A gate nobody has connected to this lane:** `certifications` — the only public credential surface,
and the exact slot `1d-s` wants where stock would be — is stripped on the Free plan
(`app/(public)/b/[slug]/page.tsx:600-604`). A free service supplier's storefront would show neither
a catalogue nor credentials. That is a pricing decision hiding inside a layout one.

`5c-s` has a labelled placeholder already: `components/storefront/Services.tsx`, registered and held
off live storefronts by `comingSoon: true`.

---

### Stage 6 · The buyer can ask, and the seller can answer
*Two migrations, and the second is the one that gates the terminal state.*

| Step | What | Note |
|---|---|---|
| **6.1** | `EnquiryLine.qty` nullable | `Int` NOT NULL today. **Stops for a person.** Three render sites print `×{qty}` |
| **6.2** | **`1h-s` / S2** — the brief | The expensive screen. Where, what, how often, when, how big — and no quantity |
| **6.3** | `QuoteLine.qty` | **The harder blocker, and neither planning document names it.** Also NOT NULL, and `lib/quote/send-quote.ts:114-116` refuses `qty < 1`. It gates the **accepted quote** — the terminal state of the whole product. A service enquiry that cannot be quoted cannot convert |
| **6.4** | `3j-s` Reply with a proposal | |
| **6.5** | `1n-s` Compare proposals | Consecutive with `3j-s`. Four fee bases do not compare the way four unit prices do |

**`Enquiry.deliverToArea` is free text**, not an `areaId`, so an area-level coverage match is not
computable from the enquiry side. That is a third migration plus a composer control, and it belongs
to `1h-s` rather than to stage 1's locality fix, which used the emirate.

---

### Stage 7 · Discovery
`1c-s` → `10c-s` → `6a-s`

**The epic's urgency for `1c-s` is not real.** It warns a Products default makes a services-only
firm invisible; `lib/search/query.ts:182` defaults the tab to `businesses`. Worth building for the
kind badges, not for the stated reason.

`6a-s` roughly doubles the `6f` page matrix, which is the real cost in this stage.

---

### Stage 8 · Ranking and ops
`12c` defects → `12c-s` → `4c-s` → `12g-s` + `6g-s`

**`12c-s` cannot be built until §2's three ranking defects are fixed**: the vector totals 96 and 106
on two of three query shapes, `RankingWeights` is a Postgres singleton so a kind key is a
drop-and-re-key, and the affected-seller counter can only ever print `1`.

`4c-s` narrows under D10 to the two kinds a register can answer. `12g-s` and `6g-s` are one piece of
work and there is currently no instrument in the tree that can charge D9's accepted drift.

---

### Deferred, and conditional on a decision
**`4e-s` scope-sheet families · `3h-s` scope template.**

These exist only if scope sheets are templated. See the open questions below — the two planning
documents disagree, and the answer decides whether these are two boards or none.

---

## 4b · What the re-sequence opens up

Three questions the new order forces, in the order they bite.

### Q1 · Scope sheets: five families, or one fixed field set?

`docs/epic-2026-09-11.md:220` draws **`4e-s`**, five families covering the subcategories with a
**fee basis enum per family**, and **`3h-s`**, a clone-and-rename template mirroring `3h`.
`docs/services-spec.md:207-211` says the opposite — hold services out of the template system
entirely, *"the cheaper and more coherent answer"*.

**Recommendation: a fixed field set, with `pricingUnit` as one small global enum.**

- D3 was answered **no**, so service fields are never filterable and never comparable. A template
  system exists to make fields comparable; if nothing compares them it buys nothing.
- The goods template system it would mirror covers **2 of 427** subcategories today.
- `4e-s`'s central instruction cannot be built as written: a Prisma enum is one fixed value set for
  a column, so "an enum per family" is a second table keyed by family. The epic calls this
  *"the field most likely to be built wrong"* without naming why.
- D7 already took exactly this trade on the neighbouring field — sizing ships as free text with a
  per-subcategory placeholder, structure added where traffic argues for it. Fee basis is the same
  shape of question and deserves the same answer, one notch more structured because the values are
  few and known: per visit, per month, per square metre, per job, per person, per vehicle.

**If yes:** `4e-s` and `3h-s` leave the plan, and the count drops from 28 to 26.
**If no:** both are upstream of `3g-s` and stage 3 grows by two boards and a dictionary for ops.

### Q2 · Is a business's kind derived, or declared?

`4d-s` shipped `Category.tradeKind`, and a business holds categories — so what it sells is already
derivable. `2b-s` proposes asking the seller directly at claim, which makes a second source of truth
for the same fact.

**Recommendation: derived, and `2b-s` confirms rather than asks.** *"Your licence puts you in
customs clearance and freight forwarding — both sold by the job. Right?"* is a better question than
a blank choice, it cannot disagree with the taxonomy, and it satisfies D8 (a firm holding one
category of each sells both) without a column. `CLAUDE.md` already forbids a writable path for
anything derived.

**If declared instead:** `Business` gains a kind column, and every reader needs a rule for what
happens when it contradicts the categories.

### Q3 · What is Free's service cap?

D1 ratified seven numbers. None is this one, and `Plan` has no column for it. Free is
**1 category, 1 branch, 10 products, 30 photos, 3 enquiries a month, 1 seat, 50 MB**.

**Recommendation: 3 services on Free.** It matches `8c-s`'s own "first three services" framing, it
is the same shape of number as the 10-product cap relative to what a small seller actually lists,
and it makes the onboarding task completable exactly at the cap rather than leaving a seller one
short of a hub that will not close.

**It is owed before `8c-s` ships**, not after.

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

**Re-sequenced 11 Sep 2026: the editor leads.** The epic drew `8c-s` and `3f-s` into its Phase 2 and
`3g-s` into its Phase 6, so services would have been created four phases before a screen existed to
edit one. The owner reversed it, and the ordering rule is now **nothing creates a row no screen can
edit**.

**Stages 1 and 2 are shipped and needed no handoff.** Everything below does.

| # | Send together | `-s` ids | Builds in | Why these, in this order |
|---|---|---|---|---|
| **1** | **The service editor, its list, and the buyer's page** | `3g-s` · `3f-s` · `1g-s` | Stages 3 and 5 | **One handoff, three screens.** `3g-s` fixes the field set the whole lane renders; `3f-s`'s columns are a summary of those fields; `1g-s` is the same set from the buyer's side. Drawn apart, the editor collects what the page never shows and the list carries a column nothing fills |
| **2** | Creating a service | `8a-s` · `8c-s` · `8b-s` | Stage 4 | The hub, the onboarding task and credentials. Needs Q3 answered first, or it creates uncapped rows |
| **3** | The seller's own details | `2b-s` · `2c-s` · `2d-s` · `3b-s` · `3c-s` | Stage 4 | Needs Q2 answered. `3c-s` is mostly built; `2d-s` needs a delivery mode that cannot be its own table |
| **4** | The storefront | `1d-s` · `1e-s` · `5c-s` · `1f-s` | Stage 5 | `5c-s` has a placeholder waiting. `1d-s` needs the Free-plan certifications gate decided |
| **5** | Asking, and answering | `1h-s` · `3j-s` · `1n-s` | Stage 6 | The expensive one, and the two that must be consecutive |
| **6** | Discovery | `1c-s` · `10c-s` · `6a-s` | Stage 7 | `6a-s` roughly doubles the `6f` page matrix |
| **7** | Ranking and ops | `12c-s` · `4c-s` · `12g-s` · `6g-s` | Stage 8 | `12c-s` waits on §2's three ranking defects |
| — | **Only if Q1 says families** | `4e-s` · `3h-s` | before Stage 3 | Otherwise these two leave the plan |

**What needs no handoff at all:**

- `4d-s`/S9 — shipped. A staff table plus a column and a bulk control, and nobody outside sees it.
- `1f-s` — D11 is closed, so what remains is board `1f`'s shipped page reading `BusinessCoverage`
  instead of two seller-claimed fields. That is stage 1's locality fix surfacing, not a design.
- Every migration in stages 3 and 6, and the `profileStrength` re-weighting in stage 4.
- `2e-s` — the plan's service cap. It is a column and a number, not a screen, which is why it is in
  stage 3 and not in the table above. It still has to be **answered** before handoff 2 ships.

All 29 `-s` ids in `docs/epic-2026-09-11.md` are placed above exactly once — the 28 it counts, plus
`2e-s`, which it names once and puts in no phase.

**Why not hardest-first.** `docs/services-spec.md:239-241` suggested S1, S2, S3 on the grounds that
they are the long poles. That is the right order to *design* in and the wrong order to *deliver* in:
a handoff that arrives early costs nothing to hold, and one that arrives late blocks a stage. Design
may draw them in any order it likes — this table is the order they can be built.
