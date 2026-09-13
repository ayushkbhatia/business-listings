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
| partial | 0 | `3c-s` shipped 13 Sep (§4p) |
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
they earn **six**. `lib/metrics/spec-completeness.ts` returns `null` for a business with no
products, and `lib/search/ranking.ts` scores a null at `UNKNOWN = 0.5`. The exposure is half what
the epic states.

Three things the amendment does not know, all of them worse. **Two are fixed, 13 Sep, in #173.**

- ~~**The total is not 100 on the live search path.**~~ **Fixed #173.** `weightsForShape` overwrote
  `distance` with a literal `4` on a SKU query and `14` on a service-shaped one and renormalised
  nothing, so the six totalled **82 or 92** — the rule held on the stored row and not on the number
  that ranks results. `redistribute`'s largest-remainder body is extracted as `spread`, and
  `weightsForShape` spends the difference across the absorbers with `planTier` pinned.

  It also moved out of the `server-only` `lib/search/origin.ts` into the pure
  `lib/search/ranking.ts`, which is the part worth remembering: **being behind that wall is why the
  invariant never reached it.** The seven unit tests in `lib/search/shape-weights.test.ts` are only
  possible on this side of it.
- **`RankingWeights` is a Postgres singleton.** Still true, and deliberately not fixed.
  `prisma/migrations/20260827220000_ranking_weights/migration.sql` carries `CHECK ("id" =
  'current')`, so "gains a kind key" is a drop-and-re-key on the live ranking table rather than a
  column add. One vector is correct while there is one vector; restructuring it is `12c-s`'s own
  first step and undesigned board work, not a defect. **It is a cost note for that handoff.**
- ~~**The affected-seller count already lies.**~~ **Fixed #173.** `lib/search/directory.ts` took
  `MAX_LISTINGS + 1` and reported `unread` as **1 whenever it was non-zero**, at any directory size
  above the cap — printed to an ops lead as "1 past the sampling cap were not ranked" on the screen
  where they press publish. It counts now, and only when the cap was actually reached.

  The 30,000 in §4 still cannot be printed: the sampler caps at 20,000.

So `12c-s` is blocked on **one** thing rather than three, and that one thing is its own opening
move rather than a prerequisite somebody else owes it.

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
| **3.1** | The `Service` model | **shipped 12 Sep**, with `ScopeSheetFamily`, `ScopeFieldValue` and `ServiceRevision` |
| **3.2** | `2e-s` — `Plan.serviceLimit` | **shipped 12 Sep** in the same migration, at 3 / 15 / unlimited — proposed, not ratified. See §4g |
| **3.3** | **`3g-s` / S3** — the service editor | **shipped 12 Sep.** Its field set is the contract every later board renders |
| **3.4** | **`3f-s` / S4** — the services list | **shipped 12 Sep**, with `1g-s` alongside it. See §4g |

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
| **`2d-s`** Coverage, not branches | **shipped 11 Sep** | `/onboarding/locations`, one route and two bodies. See §4f — five corrections, and the taxonomy went from four free zones to forty-two |
| **`8a-s`** Setup hub | **shipped 12 Sep** | **Four tasks**, and the epic was right after all — the *code's* stale prose said three. Credentials lead at 32, photographs fall to 4. See §4h |
| **`8b-s`** Credentials task | **shipped 12 Sep** | `/dashboard/setup/credentials`. Two tiers rather than three, the trade licence is not a credential row, and the FTA register is a seam nothing is plugged into. See §4i |
| **`8c-s`** Scope sheet + first 3 services | **shipped 12 Sep** | `/dashboard/setup/services`. D11 was already closed, three authored sheets rather than seven, and the hub's task 2 now counts completeness rather than live rows. See §4j |
| **`3b-s`** Listing profile | **shipped 13 Sep** | `/dashboard/listing` with the services field set, the same component onboarding mounts. See §4p |
| **`3c-s`** Coverage manager | **shipped 13 Sep** | Per-service rows in #173; the manager at `/dashboard/coverage` with this handoff. See §4p |

**`profileStrength` was fixed with `8a-s`, 12 Sep.** `catalogue: 20` + `filterableSpecs: 15` of 100
were unreachable without products, against a published `STRONG_ENOUGH` of 80, so a service supplier
could never be strong enough. The fix is not services counting toward `catalogue` — it is a second
weight table, because the two kinds are not measured on the same things at all. See §4h.

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


## 4f · Handoff `2d-s` — coverage, and the taxonomy that was four rows deep

Shipped 11 Sep at `/onboarding/locations`. **One route, two bodies**, chosen by `sellsKind` — the
same shape as `2c-s`, and for the same reason.

### Five corrections to the handoff

**1 · There is no `/onboarding/coverage`.** The board's header names one and its own B1 says
"conditional screen body keyed on `Business.sellsKind`, **not a second route**". B1 wins. A second
URL is a second place for `goLive` to be called from and a bookmark that lands a seller on the wrong
body after they change their mind.

**2 · `CoverageArea` already exists, under the name `Area`.** The board proposes a new seeded table
of "7 emirates + Al Ain" with an `isEmirate` flag. `Area` is already a seeded table of places, each
carrying its `Emirate`, already joined by locations, coverage, area pages, curated lists and demand.
Building a parallel one would have given the directory two taxonomies of the same places. So Al Ain
is an `Area` row with `emirate = abu_dhabi`, and a coverage row is `(emirate, areaId?)` — the exact
shape `BusinessCoverage` already uses, which is why the union in `lib/locations/service-coverage.ts`
needs no translation for anything downstream. **AC4 holds exactly as written**: Al Ain is selectable,
stored under Abu Dhabi, and `Emirate` still has seven values.

What `Area` did not have is a way to say *this one sits beside the emirates on a coverage picker*.
That is `Area.searchedAsEmirate`, one column, set on one row. Board Q2's "Khor Fakkan and Ruwais come
up" is then a row somebody adds, not a deploy — which is what Q2 asks for.

**3 · The free-zone list had four rows, not "over 40".** B4 says free zones come from "the existing
free-zone list … reused here, not duplicated", and Dependencies calls it "already seeded". It was
JAFZA, SAIF Zone, KIZAD and Ajman Free Zone — enough for a cross-cutting toggle that filters a
warehouse's address, and nowhere near enough for a picker a firm uses to name the zones it is
approved to work in. **Thirty-eight more ship with this board**, taking it to 42, and the screen
**counts the rows** rather than printing "over 40": a number in a placeholder is a number that
survives the list changing. `nameAr`, `lat` and `lng` are null on every new row, deliberately — an
Arabic name or a coordinate typed from memory is a fact this directory has not got.

**4 · `ServiceCoverage` ships without `serviceId`.** The board's model has `serviceId String?`, null
for the default this screen writes. **There is no `Service` model yet** — it lands in stage 3 with
`3g-s`. A nullable column pointing at nothing, always null, with no writer, is the defect this
project has already paid for twice: `Area.publishedAt` and the dropped `spec_field_proposal`. The
column arrives with the table it references. What B5 and AC6 actually protect — *the default is never
copied down onto a service* — is enforced by `effectiveCoverage`, which resolves inheritance **at
read time**, and pinned by tests that run today.

**5 · `check:schema-invariants` does not forbid a delivery-mode table.** §4's own note said it did.
It bans models named `Order`, `OrderLine`, `Payment`, `Fulfilment` or `Fulfillment`, and the strings
`payout`, `commissionRate`, `transactionFee`, `escrow`. `DeliveryMode` is an enum on `Business`
because three values multi-selected is what the question is, not because a check refused a table.

### Two tables, not one, and the reason

`BusinessCoverage` is a **delivery promise**: this emirate, in this many hours. `ServiceCoverage` is
**where the work happens**, and carries no promise because nothing is being moved. The tempting
saving is one table with a nullable `leadTimeHours`; it is wrong for a `both` business, which
genuinely delivers valves to all seven emirates and commissions them only in Dubai. Two claims, two
tables, one shape, one union helper.

### The gate, which is the whole board

`2d` blocks publish until a branch has coordinates. **Carried across unchanged, no services business
could ever publish** — a tax practice has no gate to pin, and nobody would be able to say why the
listing never went up. `goLive` now asks by kind: a branch for goods, a mode and an area for
services, both for `both`.

### One thing added that the board did not ask for

Coverage rows narrower than the eight chips are **listed read-only** rather than dropped. `3c-s` will
write finer default rows from the dashboard, and a screen that renders eight chips and replaces the
set on save would delete a claim it never showed anybody. The chip writer touches one row at a time.

### Found on the way, and fixed

The fan-out's locality term read `BusinessCoverage` only, so a practice that had just claimed all
eight areas reached it with an empty set and scored `UNMEASURED` — the same as a listing that had
said nothing. It now reads both tables. The `coverage * 0.34` term still means *does this business
have any products*; replacing that with geographic match is `1h-s` and is not this.

### Still owed

- **The dashboard mirror is `3c-s`**, and it is not built. A published services seller changes their
  coverage by returning to the step, which the copy now says instead of promising a dashboard screen
  that does not exist. Same precedent as `2c-s`, whose mirror is `3b-s`.
- **`/admin/areas` [12h] does not exist**, so an unmatched free-zone search offers no *request a
  free zone* route. The no-match line says the list is closed and stops, rather than linking nowhere.
- **Q3, verifying a registration** against the zones' published approved-provider lists: no
  `verifiedAt` column ships, because a column with no writer renders an unverified claim as a checked
  one. It belongs to the credentials chain, `8b-s` → `4c-s`.
- **Q4 stays open and is now measurable.** `deliveryModes` and `ServiceCoverage` together answer
  whether remote-only sellers claim all eight at a higher rate than everyone else.

### Verified by clicking it

All three bodies, on a seeded database. A services seller: the chips inert until a mode was picked,
the framing line changing with the answer, Al Ain written as `(abu_dhabi, al-ain)`, `Select all`
writing eight and the second press a no-op, `Search 41 free zones` counting the published rows, and
`Continue` refused with "Pick at least one way the work reaches the client" when the mode was
cleared. A `both` seller: the branch list under *Where your stock sits*, the coverage set under
*Where you work*, neither behind a toggle. A goods seller: step 4 exactly as it was, rail included.
Axe at 1280 and at 375 found nothing but the project's pinned contrast gap.

---

## 4g · Handoff `3g-s` + `3f-s` + `1g-s` — the scope sheet, end to end

Shipped 12 Sep 2026. Three screens, one record: `/dashboard/services/:id` writes the scope sheet,
`/dashboard/services` counts it, `/b/:slug/s/:service` renders it as a comparison table. Taken out
of wave order on the re-sequence, and the handoff agreed — these three define the record the rest of
the track reads.

### D11 was already closed, which unblocked §3

The README asks that `3g-s`'s `Capacity` field and `1g-s`'s *Accepting new clients* chip wait for
D11. **D11 closed as no on 11 Sep** (§3 above) and names `1g-s` among the five boards it cuts it
from. So neither shipped, and that is the board's own stated position rather than a divergence: a
listed business is taking work, and a stale flag is worse than no flag because a buyer who acts on
one and gets no reply blames the directory rather than the firm.

Twelve fields therefore become **eleven**, and the optional set five rather than six.

### One place this build diverges from a build note, and why

**`1g-s` B2 and AC2 ask for unfilled rows to be omitted from the DOM. They are rendered, grey,
reading "Not provided".**

`CLAUDE.md` § Interface honesty says the opposite in as many words, about the table this one
replaces: *"Unfilled spec rows render grey reading 'Not provided', never hidden. The buyer sees what
is unanswered and the request becomes high-intent; the seller sees the same grey rows in their
editor."* It is a checked-in project rule with a product reason, and the board's argument against it
is aesthetic — a page of empty rows "makes a competent small firm look like an abandoned form".

The board's own render settles it on the board's own terms. It prints *"9 of 12 rows on the audit
sheet are filled"* **under a table with the empty ones removed** — so the buyer is already told
three rows are unanswered and simply cannot see which. That is the abandoned-form signal, with less
information attached and no way to ask about it.

The line under the table now reads *"6 of 9 rows filled. The rest are unanswered rather than hidden
— ask about them in your enquiry"*, which is the `CLAUDE.md` rationale made into the call to action.
Reversing it is one branch in `scopeRows`, and the rule is pinned by a test either way.

### Six other corrections

**1 · Five filterable rows, not six.** The spec's prose says five; the render marks six. B5's own
rule settles it — *"a row only becomes filterable when its values are enumerable across the family"*
— and a turnaround is never that: "24/7 callout, 4-hour attendance" and "3–4 weeks from complete
records" are both right and neither is a facet value.

**2 · The `FILTERABLE` marker does not render to buyers.** `1c-s` and `6a-s` do not exist, so a chip
claiming a filter would claim one the product has not got. The flag lives on the family, as B5 asks,
and its reader today is the **editor**, which tells the seller which answers buyers will filter on —
a true reader, and a more useful one.

**3 · `ScopeFieldValue` carries four keys, not five.** `indicativeFee` is a column rather than a row,
which the board's own model sketch already has: the safest place for a field that must not leak is
outside the structure everything maps over.

**4 · The public page has no prose paragraph above the chips.** The render carries a description
distinct from the scope; the model this same handoff specifies has one prose field for an
engagement. Rendering it twice on one screen is not a description, it is a duplicate.

**5 · A draft service redirects to the storefront rather than 404ing.** AC's "404 at this route"
against the product page one route over, which redirects for a stated reason: the buyer came for
this supplier and the supplier still exists. Two behaviours for one situation is worse than either.

**6 · The comparison strip is not built.** B9 scopes it to *family and area*, and no category has a
family yet — every one resolves to the seeded default — so the query would return the whole
directory. Widening to the whole country is the one thing B9 refuses. What ships in its place is the
firm's other services; `1c-s` brings the strip.

### What had to be built underneath

**`Plan.serviceLimit` — the eighth number, and §4's Stage 3.2 said it was not optional.** The moment
services became their own model, a Free seller could create them without end. It ships at **3 / 15 /
unlimited**, and those are **proposed rather than ratified**: D1 settled seven numbers and services
were not a model yet. They are rows, so changing them is an UPDATE; and `/admin/plans` grew a sixth
cap editor in the same change, because the eighth number must not be the only one a person cannot
change without writing the row by hand.

**`ScopeSheetFamily`, and it is not `CoverageArea` all over again.** The family is genuinely new: a
per-family fee-basis list, per-family row labels and a row order, reached from
`Category.scopeFamilyId` by the same ancestor walk `tradeKind` uses and falling back to a seeded
`general` family. That fallback is **not** the global enum B2 refuses — it is what an unclassified
trade resolves to, exactly as an unset `tradeKind` resolves to `goods`, and today that is all 440 of
them.

**A services fixture, at last.** Every seeded business was `sells_kind = unset`, so every screen on
this track had only ever rendered its empty state in CI. `seedServicesFirm` adds Meridian Chartered
Accountants — a new business, not a repurposed one — with three services, one of them deliberately
**live at 4 of 6** because that is the rule `3f-s` exists to demonstrate. It gets its own e2e seat
and its own Playwright project, which every remaining `-s` board now inherits.

**`/b/:slug/services`, which is not `1e-s`.** A detail page linked from nowhere is a route rather
than a screen. The storefront tab and the index behind it are the link surface; `1e-s` replaces the
index and keeps the tab.

### Still owed

- **`serviceId` on `ServiceCoverage`.** `1g-s` B8 is satisfied by `effectiveCoverage`, which resolves
  inheritance at read time and is tested — but no service can narrow its coverage until `3c-s`
  writes the rows, and the column arrives with its writer.
- ~~**The credentials block on `1g-s`.**~~ Shipped with `8b-s` as *Who signs it* — and it renders
  its empty state rather than being omitted, because § Interface honesty says a section that
  disappears when thin tells a buyer nothing about whether it was ever asked. See §4i.
- **`12c`'s ranking term.** This is the data it will read: scope-sheet completeness replacing a
  spec-completeness factor a services business can never earn. The amendment belongs to `12c`.
- **`3h-s` scope templates.** B6 is already true by omission — nothing clones a scope sheet yet, and
  when something does it must leave `scope` and `excluded` empty.

### Verified by clicking it

All three screens, against the seeded firm. The list: the rail offering *Services* and no
*Products*, "2 live · 1 draft", a live row at 4 of 6 with the line naming it, `Not set` in a draft's
enum columns, and bulk publish/unpublish with no bulk delete. The editor: the family's own fee bases
in the select, a foreign key refused, the sidebar moving as fields were typed, and a change log
reading *"Turnaround, from '24/7 callout, 4-hour attendance' · now · Dev owner"*. The public page:
included and excluded side by side at equal weight, enums worded, unfilled rows grey, no fee
anywhere in the DOM, and a draft redirecting to the storefront.

Axe at 1280 found one real defect — an unnamed actions column on the table, now named — and
otherwise nothing but the project's pinned contrast gap.

---

## 4h · Handoff `8a-s` — the same hub, with the weights turned upside down

Shipped 12 Sep 2026 at `/dashboard/setup`. Structurally board `8a` unchanged — one score, the
largest remaining weights as cards, the traction rail, one reminder, a collapsed done row — and a
conditional task set keyed on `sellsKind`, which is B1 and the same shape `2c-s` and `2d-s` use.

### Q1 answered: the proposed table is right, and the arithmetic says why

The board leaves the residual 36 points across licence, profile and coverage as a proposal needing a
decision. **Adopted as written**, and there is a property that makes it more than a preference:

> `32 + 20 + 12 + 8 + 4 + 4 = 80`, and `STRONG_ENOUGH` is 80.

**Licence verification is the one component a seller cannot finish** — `verificationTier` is
writable only by an `ops_lead`, which is `CLAUDE.md` non-negotiable 2. Everything else sums to
exactly the threshold, so a practice that does every task on the hub lands on 80 with nothing it can
act on left unnamed. That is the property the site-visit cut was made to restore, and this table
holds it by arithmetic rather than by luck. A test asserts it.

The numbers remain **adopted, not ratified** — they are a `const`, and moving one is a line.

### `8b-s` is largely built, and is called `3e`

The README says shipping this hub first "leaves two live cards pointing at nothing". It does not.
`/dashboard/verification` — board 3e — is already the credentials surface: it splits *Verified by
us* from *Uploaded by you*, captures an expiry at upload, holds the four states, and **refuses to
call a seller-uploaded certificate verified**. The 32-point card points there. `8b-s` becomes a
services-shaped refinement of a working screen rather than a new build, which is the "check the tree
first" caution firing for the second time on this track.

### Three corrections

**1 · Credentials complete at two on file, not at "one verified".** The board's completion rule asks
for a state this product does not have, and deliberately: board 3e's whole design is that a document
nobody here has looked at says `On file` and never `Verified`. Requiring it would put the largest
lever permanently out of the seller's hands — the defect the site-visit cut removed — and would
break the 80-point property above.

**2 · The `+N PTS` badge stays what this seller would still gain, against B3.** B3 asks for the
component's full weight so the four badges sum to a hundred. The repository already argues the
other way in two places, and the argument is better: *"showing the weight would tell a seller who
has done half of something that they can earn it all again."* A seller reads one card and asks what
they get for doing it; nobody sums badges. The full weights are on the screen — in the weights card,
which is where a table belongs — and the partial state renders beside the badge as the render draws
it, `2 OF 3` and `~4 MIN`. One line to flip if the owner disagrees.

**3 · The closing line is computed, and `both` does not get it.** The render writes "the other 36"
and "4 here and 16 on the goods hub" as constants; both are read from the tables, and the goods
figure is **20** rather than 16 because the site-visit cut redistributed that table after the render
was drawn. A `both` seller gets the goods heading and no inversion sentence at all: on the
renormalised union photographs read 11 against 20, which is an artifact of a larger denominator
rather than a claim about what matters.

### What `both` actually does — B9

One renormalised score from a union table, derived rather than written: where a component is in both
tables the larger weight wins, and the result is divided by its own total. Five cards, which is the
longest this screen gets. Summing the two tables — which B9 forbids in as many words — would give a
denominator of 176 and a meter that never fills.

### Nothing moved for a seller of goods

`unset` and `goods` resolve to the table they always had, and the 123 live businesses are all
`unset`. The six new facts are read for every listing and scored for none of them, the concierge
still renders, and the levers footnote keeps its own heading. A test pins it.

### Still owed

- **The Export Tracker entry for `8b-s`** still says *20 pts*. This board puts credentials at **32**.
- **`12c`'s ranking term.** Scope-sheet completeness now exists as data and as a lever.

### Verified by clicking it

The practice: four cards with credentials first and photographs last, `+32%` over a card with
nothing banked and `+7%` over the one at two of three, `~5 MIN · 0 OF 2` beside it, the weights
footnote reading *Weighted for a practice* with every figure computed, no concierge. A `both`
seller: five cards, nine renormalised levers, the concierge back, and the goods heading. A goods
seller: the screen exactly as it was.

Axe found nothing but the project's pinned contrast gap.

---

## 4i · Handoff `8b-s` — credentials, and the register nobody is connected to

Shipped 12 Sep. `/dashboard/setup/credentials`, a `Credential` table, a trust block on `1g-s`, and
the 32-point card on the hub now points at its own screen instead of at board 3e.

### The README's one factual error, and it is the load-bearing one

> *"The trade-licence register lookup already exists from onboarding verification — the FTA agent
> lookup is the new integration."*

**It does not exist.** What `lib/verification/licence/` holds is number normalisation and text
extraction from an uploaded PDF; the tier that follows is set by an `ops_lead` who looked the licence
up themselves. `lib/verification/review.ts` says it outright: *"Nothing on this platform checks an
ISO number against a registrar."* This is the "check the tree first" caution firing for the third
time on this track, and this time in the other direction — twice it found things already built, and
here it found the one thing the handoff took for granted missing.

So `lib/credentials/fta.ts` is a **seam and not an integration**. It is pure of Prisma, gated on
`FTA_REGISTER_URL`, and until that is configured it answers `register_unavailable`, which the screen
prints inline. Every FTA number on the platform today saves as a claim. That is `8b-s` Q2's own
position — *save it and show the mismatch, because a hard block on a live register call is a bad
failure mode* — and the reason is stronger with no register than with one: a hard block on a call
that cannot be made at all is a screen nobody can finish.

### Three corrections

**1 · `trade_licence` is not a `CredentialKind`.** The board's data model lists it first. It lives on
`Business` — number, authority, expiry, `verifiedAt` — and the screen renders it read-only from
there, which is B4's own instruction. A row beside it would be a second source of truth for the only
fact on a listing anybody has actually checked, and the two would drift the first time an expiry
sweep touched one of them.

**2 · Two `TrustTier` values, not the spec's three.** *Register-verified* and *verifiable on
submission* are the same statement differing only in **when**. A row cannot be in a "we will verify
this" state: either a register answered for it or it is the seller's word. So `WE VERIFY THIS`
renders as `promiseFor(kind)` — a label a *field* wears before anything is typed into it — and it is
suppressed entirely when no register is configured, which is every deployment today. Shipping it as
a stored tier would have produced a badge that means "nobody has looked at this" and reads as though
somebody had.

**3 · The hub's credentials counter moved off `Document(kind: certificate)`.** `8a-s` counted files,
which counted an uploaded PDF naming nothing and missed an FTA agent number typed with no
certificate to hand. It counts `Credential` rows now, in both readers — the hub and the nightly
strength job — because two counters for one lever is the drift that makes a meter untrustworthy.
**Lapsed rows still count**: `8b-s` is explicit that a credential expiring changes nothing, so a
count that dropped one on its expiry date would be renewal chasing arriving as a silent regression.

### Nothing here is required, and that is a property of the code

The screen says it four times. The way to keep a sentence like that true is for the refusal not to
exist: `lib/credentials/service.ts` has exactly two failures, a kind that is not a kind and a
business that does not exist, and neither is reachable by leaving a field alone. A credential with no
number, no issuer, no expiry and no file saves as what it is — the seller telling us they hold
something. An integration test asserts precisely that (AC1), and the `Add` button is disabled only
while a save is in flight.

The database carries the other half. `credential_verified_has_a_register` refuses a `register_verified`
row without both `verified_on` and `verified_by`, and refuses a `seller_claim` that carries either —
so the forged shape cannot be written even by a direct query. `CredentialInput` has no `trust` field
at all (B3, AC3).

### The suggestion rate, and its denominator

*68% of verified suppliers in your subcategory hold it* is the whole mechanism of the suggestion
rows: a seller does not know what their competitors show, and a rate answers it in one line where a
generic *you might also add…* gets ignored. It is computed over **verified, published suppliers in
the seller's primary category and nobody else** — an unclaimed licence import holds no credentials
and never will, so counting it would drag every rate toward zero and suppress every row, a number
wrong in the direction of saying nothing. Below `SUGGESTION_FLOOR` (25%, Q3's starting point) the row
is not drawn.

Which means it needs a denominator to exist at all, and on a fresh database there is none. The seed
gives two of every three verified suppliers in the fixture's trade the MoF approval — deterministic,
by index, landing at 50% — on **existing** businesses rather than new ones, because
`seedServicesFirm` is appended for the reason every builder near it is: the PRNG is a sequence, and
adding suppliers would rename every business generated after them.

### Documents are private, and the defence is that they are never fetched

`publicCredentialsFor` does not select `documentId`. Not hidden in the template, not filtered in a
mapper — absent from the query, which is the same defence `indicativeFee` gets one board over. A
certificate uploaded here writes a `Document` row in the same private bucket `/dashboard/verification`
writes to, with `isPublic` false, because it is the same kind of object and a second store for it
would be a second place to get privacy wrong. A document id belonging to another business is dropped
to null rather than refused — refusing is the thing this screen does not do.

### What `1g-s` owed, and now has

**Who signs it**, where a product page shows stock availability. A checked credential names the
register and the date; a claim reads *Stated by Meridian Chartered Accountants*. The separation is
structural rather than a colour, which is `8b-s`'s binding rule on its two downstream renderers: an
unverified claim must never render like a verified one. `1d-s` is the other, and it is wave 4.

### Found on the way, and fixed

- **The `Alert` contract.** A `warn` or `bad` notice must carry the action that fixes it, and the
  component says so in development. Two of the three register answers are the seller's to act on and
  now carry their own fix line; the third — no register reachable — is **not a warning at all**,
  because nobody could have done anything differently, so it renders as information. Inventing a fix
  line for it would have been the apology the rule exists to prevent. Every refusal on the screen now
  travels with its own way out, from the server, which is the only thing that knows which happened.
- **A cross-file e2e race.** `8b-s`'s tests started in a file of their own. The suite is
  `fullyParallel`, so outside CI two files run at once — and while the credentials tests held two
  credentials, the hub two files away had correctly moved the credentials card into its done-summary
  and that card's own test failed looking for a link no longer drawn. Neither assertion was wrong;
  they were reading one listing through two windows. Playwright serialises within a file and not
  across them, so everything driving this seat now lives in `services.spec.ts`, serial. CI runs this
  shard on one worker, which is exactly why the race was invisible there.

### Two numbers on the render that are not shipped

- The sidebar draws **10 min** against the services task. `8a-s`'s hero says fifteen minutes across
  the four and 5 + 10 + 2 + 4 is not fifteen; the shipped estimate is 4, read from `setupBoard`. B8
  says one source, so the screen reads the table rather than the render.
- The header draws **TASK 1 OF 4**. `TaskChrome` replaced that with a completion rail when `8b` (the
  goods board) shipped, and the reason is in the component: the four tasks are independent and
  free-order, and a rail that counts steps re-imposes the sequence the hub exists to remove.

### Verified by clicking it

Signed in as the practice: the trade licence read-only with its authority and check date, one held
credential labelled *Your own claim* with its unfilled rows grey and visible, the MoF suggestion at a
computed 50%, the sidebar reading 32 / 20 / 8 / 4 over 64. Selected the FTA kind, typed an agent
number, pressed Add — saved as a claim, *We could not reach the FTA register* inline, the line below
moved to *2 added, 32 points earned* and the chrome's primary to *Done — back to setup*. The service
page's **Who signs it** block reads *Stated by Meridian Chartered Accountants* under both rows.

Axe found nothing but the project's pinned contrast gap.

---

## 4j · Handoff `8c-s` — the screen that started the track

Shipped 12 Sep. `/dashboard/setup/services`, two steps, a counting rule that is not the
publishing rule, and a live preview that mounts the public page's own component.

### The board is not blocked, and D11 closed before it was written

The README calls this board *partially blocked on D11* and lists three availability
affordances to leave out: the `TAKING WORK` column, the *Waitlist is a real answer* card
and the preview's `Accepting new clients` chip. **D11 closed as no on 11 Sep** (§3), the
`3g-s` `Capacity` field went with it when that board shipped, and none of the three exists
in this tree to leave out. B9 and criterion 10 are satisfied by construction, and an e2e
test keeps them that way.

That is three handoffs running where the blocking claim was stale — `8b-s` said a register
lookup existed, `8a-s` carried a two-month-old weight table, and this one names a decision
already taken. **Check the tree first** has now paid for itself four times on this track.

### Q1 answered by counting: three sheets, and one is the blank one

The board says *seven trades are authored so far*; `4e-s`'s tracker note says *five
families cover 420 subcategories*. **Both are wrong.** `ScopeSheetFamily` holds
`general` (the blank default), `audit-and-assurance` and `facilities-management`.

So the sentence counts the cards rather than claiming a figure, and the card's shape line
is counted off the family's own rows: the board draws `12 fields · 6 required · 5
filterable · used by 214 firms` and **three of those four numbers are wrong here** while
the fourth is a constant where B3 itself asks for a query. The screen reads `9 rows · 6
required · 5 filterable`, and `used by N firms` is counted live — rendering `no firms on
it yet` where it is zero, because a directory at its cold start owes a seller the truth
about how thin it is.

`used by N firms` counts **sellers of work only**. Counting every listing put 176 valve
traders on the blank sheet, since an unclassified category resolves to the default — a
number that is arithmetically true and answers a question nobody asked.

### The counting rule, and it changes a shipped board

B4 asks for the task to close on three services at **four of six** required fields, where
`8a-s` shipped a count of live rows. Adopted, because the alternative is a hub whose
largest remaining task closes on three services carrying nothing but a name — and the
task is the one asking for a *complete* list rather than a long one.

`mayPublish()` is untouched and still returns `true` unconditionally: gate publication on
a score and sellers type "TBC" into six fields, which destroys the comparison the fields
exist to create. So a thin service is **published, findable and excluded**, and the
screen says so in the seller's terms with the missing fields named — *"Turnaround,
where it is delivered and deliverable are the ones missing"* rather than *"incomplete"*.

The fact was renamed `servicesCounting` rather than left as `servicesLive`, because a
field that no longer counts live services is the trap `normalised is two things` is a note
about. Four modules read it — the hub, the setup chrome, the onboarding meter and the
nightly job — and all four now share `COUNTABLE_SELECT` and `countCounting`.

**B5 needed no change at all.** `strengthItems` already pays 7, 13 and 20 at one, two and
three of the target, which is exactly the board's `+7%` / `+13%` / `+20%`. Verified by
running it rather than by reading it.

### Two corrections underneath

- **`Business.scopeSheetFamilyId` had to exist for step 1 to mean anything.** A service's
  family resolved from its category, and all 440 category rows are null — so every seller
  resolved to `general` and a screen offering a choice would have changed nothing when
  they used it. It is an **override** in the existing chain rather than a replacement:
  business choice → `Category.scopeFamilyId` up the tree → the seeded default. The firm's
  own statement is the more specific one.
- **A third reader of the credentials lever was still counting files.**
  `lib/onboarding/profile.ts` kept `Document(kind: certificate)` after `8b-s` moved the
  other two to `Credential` rows, so a firm with two credentials and no certificates read
  zero on the onboarding meter and two on the hub, on the same afternoon. Fixed here.

### What the preview is, and why it is not a mock

B11 asks for *a real render of `1g-s`*. The scope table moved to
`components/domain/ScopeTable.tsx` and both surfaces mount it, and the preview is fed by
`publicServiceFor` — so it is not merely the same markup but the same **data path**,
including the fact that `indicativeFee` is absent from that select and therefore cannot
reach the pane any more than it can reach the page.

### Found on the way

- **A caption repeating its own heading.** The table's `sr-only` caption restated the h2
  directly above it, which is a screen reader hearing the sentence twice — the correction
  `1g-s` already carries, arriving again one screen over.
- **Six field labels in two places.** `3f-s` held the only copy of the required-field
  names and the join that lists them; `8c-s`'s callout needs the same six. Both now read
  `lib/services/gaps.ts`.
- **A fee basis cannot be cleared from any screen.** The `Select` placeholder is disabled
  on purpose — `3g-s`'s own correction against a select that invented data on save — so
  there is no path that unsets one. Intended, and now written down.

### Still owed

- **`3h-s` scope templates** closes wave 2. Its one firm rule is already true by omission:
  nothing clones a scope sheet, and the seed list here sets names only for the same reason.
- **`4e-s`'s authored families.** Two trades and a blank sheet is the cold start, and the
  screen is honest about it. Seven was never true.
- **`12c`'s ranking term**, unchanged from `8a-s`: scope-sheet completeness now exists as
  data, as a lever and as a counting bar.

### Verified by clicking it

Step 1 with no sheet: three cards, `MATCHES YOUR SERVICES` on the one the firm's own
services named, `used by 1 firm` and `no firms on it yet` beside the other two, and step 2
inert saying why. Chose the audit sheet: step 2 activated, *Start from our Audit &
assurance list* appeared, and pressing it added four drafts at 1 of 6 carrying nothing but
a name. Emptied a turnaround inline: 4 of 6 became 3, the tally moved to *2 live · 2 more
to finish this task*, and the callout named the three missing fields. The preview rendered
the real scope table with `FEE ON ENQUIRY` and no amount anywhere in the DOM.

Axe at 1280 found nothing but the project's pinned contrast gap.

---

## 4k · Handoff `3h-s` — the variant that is not one

Shipped 13 Sep. `/dashboard/scope-templates`, a template per group of work, a clone
that lands on `8c-s`'s counting bar, and an edit that offers rather than writes.
**Wave 2 is closed.**

### `3h` is not clone-and-rename, so this was not a copy pass

The handoff's premise, stated three times: *the clone-and-rename mapping behaves
exactly as `3h` does for spec sheets, which is why this is a variant rather than a new
build*, and B1 — *if `3h` is built, reuse it: clone, rename, edit, offer-on-edit,
delete.*

**None of those five interactions exists in `3h`.** What is in the tree is an
*overlay*: one `SellerTemplate` per platform template per business — enforced by
`@@unique([businessId, platformTemplateId])` — storing only overrides, with
`draftMappings` → `applyDraft` → `SellerTemplateRevision` → `rollbackTo` and a
`/history` route. No clone-into-many, no rename, no delete, no per-product offer, no
usage count.

So this is a new build that borrows the vocabulary. The one idea worth keeping is the
one it does keep, and it is `3h`'s best: a change is **proposed and reviewed before it
lands**, never written through.

That is the fifth handoff running whose central claim about the tree was wrong, and
the first where it changed the size of the job rather than a number on a card.

### Offers are derived; only the refusal is stored

B4 asks for a template edit to produce a per-service offer, accepted or declined
individually. The offer is the difference between the template's value and the
service's own, computed on read — a stored queue would be a second copy of the
template that goes stale the moment either side moves.

What cannot be derived is a decline: *I saw this and said no* is a fact about the
past, and without it the same offer reappears for ever. So `ScopeTemplateDecline`
stores the refused **value** rather than a flag, which means a template edited again
to something new offers again — declining "Per certificate" says nothing about "Per
day". Accepting clears the decline, because a stale one would suppress the next
genuine offer.

Accepting goes through `patchServiceField` rather than a direct write, so `3g-s`'s
fee-basis validation applies and the change log records that a person accepted it.

### The rule that is a CHECK

B3 asks for the model boundary and gives the reason — *UI-only avoidance will not
survive the first import script.* `scope_template_travelling_keys_only` is a
**whitelist**: stripping the five allowed keys must leave `{}`, so a field added to
`Service` later cannot start travelling by accident. An integration test writes each
of the four forbidden keys with raw SQL and asserts the refusal.

`name` and `turnaround` join `scope` and `excluded` there, which is this board's
correction to `3g-s` B6's looser wording. Turnaround is `3h-s` Q2 and the only real
design decision on the board: templating it would make a clone arrive complete, and
produce four services claiming the same turnaround.

### One number the screen says differently from the board

The board's arithmetic is two steps — *template fills four, seller names it, five.*
This screen does both on one press, because an unnamed service is what
`Service.name` exists to prevent. So a clone arrives at **five** of six with
turnaround the only field left, and the copy says five rather than restating the
board's intermediate figure. `CLONE_FILLS` is still four and is still asserted equal
to `8c-s`'s `COUNTING_BAR` — that relationship is what makes the template worth
having, so it is a test rather than a sentence.

### Found on the way

- **A heading order jumping h1 → h3.** `SellerPage` owns the `h1` and the card
  headings started at `h3`; axe's `heading-order` caught it, and a screen reader's
  heading list is how a seller skips to the part they came for.
- **A role name matching as a substring, for the fourth time.** `getByRole("combobox",
  { name: "Scope" })` found *Which scope sheet is it based on*. It is in `docs/`, in
  the notes and in two previous boards' write-ups, and it still reads as fine.
- **The row menu is a disclosure, not a menu widget** — `DataTable` says so
  deliberately, because `role="menu"` without arrow-key navigation is a promise the
  markup does not keep. So it has no `button` or `menuitem` role to find it by.

### Still owed

- **`4e-s`** authors the families. Two trades and a blank sheet is the cold start, and
  both this board and `8c-s` are honest about it.
- **`12c`'s ranking term**, unchanged since `8a-s`.

### Verified by clicking it

The template with its five pre-filled rows and four dashes, the services it is used by
named beside the count, and eight changes waiting across two of them. Accepted one:
it left the list and the other four stayed. Declined another: it left, said it would
be offered again if the template moved, and the service kept its value. Added a
service from the template: a draft at 5 of 6 with scope and exclusions empty and
turnaround the one left.

Axe at 1280 found one real defect, now fixed, and otherwise the project's pinned
contrast gap.

---

## 4l · Handoff `4e-s` — five families, and a taxonomy nobody has classified

Shipped 13 Sep. A tab on `/admin/spec-library`, the five families authored with their fee
bases and rows, every services subcategory assigned, and the three rules that make the
three shipped boards downstream of it work.

### The board's 420 is 39 here, and that is `4d-s`'s gap rather than this board's

B5 asks for *420 subcategories, 420 assignments*. **`Category.tradeKind` is null on 434 of
440 rows** — `4d-s` shipped the column and the resolver and classified six — so the walk
resolves **39** leaves to services and everything else to goods.

All 39 are assigned. Reaching 420 would have meant inventing 381 classifications, which is
`4d-s`'s job done badly by this board and exactly the padding § Interface honesty forbids.
The screen counts what is there — *5 families · 39 of 39 services subcategories assigned* —
so the number moves on its own as the taxonomy is classified.

### `8c-s` Q1 closed, and the README's reconciliation is right

The README argues that *seven trades* and *five families* count different things one level
apart, and it is correct. What this build takes from it is the narrower half — Q1, the only
open decision — in the position the board itself argues for: **the assigned family leads the
card list on `8c-s` and the rest follow**. A marine surveyor filed under Inspection &
certification is not one click from a per-container fee basis, and is not prevented from
reaching one either.

The two families this tree already had were **renamed rather than joined by five more**.
`audit-and-assurance` became `professional-services` and `facilities-management` became
`on-site-maintenance`; seven families would have left B10's *resist new families* with
nothing to resist. Every foreign key to the table is `ON UPDATE CASCADE`, checked before
the migration was written, so the templates, businesses, categories, fee bases, rows and
seed lists moved with them.

### Three rules, and each is enforced where it cannot be forgotten

- **B4 — the six are platform-level.** They are columns on `Service` and a family holds
  rows, so there is no shape a family could take that adds a seventh. A test writes an
  invented row key and watches `scopeRows` drop it, because a label with nowhere to read a
  value from renders an empty row for ever.
- **B9 — removing a fee basis flags, never clears.** The count comes back with the result
  and is stated before the press as well as after. A seller's fee basis is their statement
  about their own pricing, and tidying a taxonomy is not a reason to unmake it; `3g-s`
  refuses the key on the *next* save, where the seller is present to choose a replacement.
- **B3 — a prompted credential is not a gate.** `mayPublish()` takes no argument at all, so
  no family can reach it. The test asserts `mayPublish.length === 0`, which is the strongest
  available form of that claim.

### Q3 answered by prompting nothing

The board's credential column reads *Regulator-dependent* for Professional services, and Q3
answers its own question: that is a lookup, not a kind — the FTA for tax, the Ministry of
Finance for audit, ADGM or DIFC for legal. Prompting a law firm for an FTA tax agent number
is worse than prompting it for nothing, so it prompts for nothing and the panel says why.
Inspection & certification prompts `professional_body` and Logistics & clearance `other`;
the two families whose column reads *trade licence only* prompt nothing, because the trade
licence is on `business` rather than a `credential` row.

### Q4, in the label

*Percentage of value* ships on Project & advisory as **"A percentage of the value (yours,
not ours)"**. The platform takes nothing either way, and on a no-commission directory
somebody would otherwise read it as our cut.

### Still owed

- **`4d-s`'s classification.** 39 of 440 subcategories carry a trade kind. Every one of the
  39 has a family; the other 401 are goods by default and may not all be.
- **`12c`'s ranking term**, unchanged since `8a-s`.

### Verified by clicking it

The tab reading *Scope sheets · 5* beside *Templates*, the six required fields rendered with
no control at all, Professional services expanded with *Retainer · 1 service* beside *Per
return · unused*, the reorder warning naming two published pages, and the credential panel
saying prompted-never-gating and then why this family prompts nothing. Unassigned one
subcategory, assigned it from the screen with a reason, watched the header move 38 → 39 and
the audit row land with the reason and the before/after.

Axe at 1280 found nothing but the project's pinned contrast gap.

---

## 4m · Handoff `1d-s` — the storefront with the catalogue taken out of it

**Shipped 13 Sep 2026.** The first buyer-facing board of the track. Migration
`20261012090000_storefront_services_1ds` — additive: `sector_engagement`,
`enquiry_line.service_id`, `enquiry.scale`.

### Its own composition, not the goods page with sections hidden

`app/(public)/b/[slug]/_services.tsx`, chosen in the page by `sellsKind = services`. The goods
overview is template sections around a catalogue; this answers a different question, so it is
a different composition: what we take on, services as rows, credentials, sectors, the licence
record; a composer, location, hours, coverage and what we checked in the rail. A `both` firm
keeps the goods overview and gains the services and credentials sections (B2).

**Which tabs exist is one pure module** — `lib/storefront/tabs.ts` — read by the shared
header, every tab route and the sitemap. B1 is true three ways at once: no tab, a 404 on
`/products`, and no sitemap entry.

### Six corrections to the handoff

1. **The composer asks four things every job has, not the render's audit form.** Financial
   year end and turnover band are an audit firm's questions; the owner's standing rule is that
   the track serves every firm that sells work. The fields are *which service*, *what you need*,
   D7's free-text **scale** and *needed by*. The trade speaks through placeholders looked up by
   scope-sheet family — *Size of your business · AED 20–50m turnover, 40 staff* for professional
   services, *Size of the site · 4,000 sq m* for on-site maintenance — with a general fallback,
   so a family created on `4e-s` tomorrow renders correctly today.
2. **The attachment prompt is the firm's own data.** *Attach what they work from:* followed by the
   service's `requires_from_client` row, when it filled one in. PDF, JPEG or PNG — the private
   bucket's allow-list, which refuses spreadsheets; widening it is a `storage:setup`, not a
   constant.
3. **The hero credential chip only renders for a register-verified credential.** No register is
   connected (`8b-s`), so on every live listing it is absent, and correctly: a claim beside the
   licence badge reads as a second platform check. The claims are still listed, as claims.
4. **"Goes to the partner who handles new work"** became *goes to whoever handles new work at
   {name}* — "partner" is a practice's word, and lead routing sends to a seat.
5. **Ministry of Finance, not Economy.** `8b-s` shipped the kind as `mof_audit_approval`; the
   render's label is not re-decided here.
6. **The render draws a credentials list; the build draws a table**, with visible column heads —
   non-negotiable 4, and a visually hidden `<thead>` leaves the heads off their columns, which
   `gallery.spec.ts` measures.

### Two decisions taken rather than asked

- **Credentials render on every plan.** Board 1d strips *certificates* — the documents section,
  a paid feature — from a Free storefront. A credential is a trust line whose file never travels,
  and non-negotiable 2 says trust signals render identically everywhere. Gating them would make
  *who checked it* something a firm buys. One condition in `CredentialsSection` reverses it.
- **B6 on the overview, the scope table's rule on `1g-s`.** A summary row omits an unfilled chip;
  the scope table one click away shows every unanswered row grey, which is where §4g put the
  honesty rule and where it stays. **Amended by `1e-s` Q1:** the services list renders *Not
  stated* in its four-field block, because four cards are read down one column and a missing
  cell misaligns every cell after it. Three surfaces, three rules, each for its comparison axis —
  not a bug to reconcile.

### What was not there to build on

- **An enquiry could not name a service.** `1g-s`'s *Enquire about this* linked
  `/rfq/new?business=…&service=…`, and that composer reads neither parameter: the buyer landed
  on a goods form asking quantities, with the service gone. `EnquiryLine.serviceId` is the
  service-side twin of `productId`; `createEnquiry` keeps it only for a live service of a
  recipient. The line is written **unquantified** — `qty` null, which pull request 173 made
  possible — so neither the buyer's page nor the seller's quote invents a *×1*.
- **Coverage is the union of live services' effective coverage**, read through
  `publicCoverageFor` now that pull request 173 gave `ServiceCoverage` a `serviceId`: a service
  narrowed to Dubai never shrinks the listing, and one that travels further widens it.
  `1g-s`'s page reads the one service's effective coverage through `publicServiceCoverage`.
- **A buyer's file had no path at all.** `DocumentKind.enquiry_attachment` existed with no
  writer, no reader and no route. The upload is signed **after** the enquiry exists, under its
  own folder — signing on pick would hand a private-bucket write to anyone who opens a public
  page. The confirm checks the buyer (session or claim token), the path, what storage actually
  holds, and one file. The seller reads it through `/dashboard/leads/:id/attachments/:doc`,
  which re-checks the recipient row and redirects to a two-minute signed link.
- **Declared sector counts had no column.** `sectorsServed` is a string array; a second
  index-aligned array is one bug from printing one sector's count under another, so
  `sector_engagement` is keyed by the sector's matching form, CHECKed 1–99,999, written by
  `2c-s`'s field set in the same transaction as the sectors.

### Found on the way, and fixed

- **The services tab never carried template pages.** It passed the business id to `navPages`,
  which takes a sector — the shared header rendered differently on that one tab.
- **`services`, `s` and `credentials` were not reserved page slugs.** A staff page at
  `/b/x/services` would have been unreachable behind `1g-s`'s route.
- **The sitemap never submitted `1g-s`'s services tab or service pages**, and would have
  submitted a services firm's catalogue. It reads `tabRoutes` now.
- **The buyer's tracking page printed `net_30`** for payment terms, and `×1` beside a service.
- **A services firm's business details showed *Payment terms* and *Delivery* as *Not
  provided*** — goods fields `2c-s` never asks it.
- **`publicCredentialsFor` ordered by trust then date**; the board orders by trust then kind.

### Still owed

- **`1f-s`.** The tab still reads *Branches* for a services firm and the rail still carries the
  location card; `1f-s` replaces both with coverage.
- **`3j-s`.** The seller's quote composer tells a services firm *nothing in your catalogue
  matches this line* for a service line. It prices correctly at quantity one; the copy is the
  proposal board's.
- **The tracking page's *what happens next*** still says *compare line by line* — `1h-s`.
- **Q4, per-service reviews** — noted for the reviews board, not built.

### Verified by clicking it

Signed out at 1440 and 1280: no Products in the tab row, *Services 2 · Credentials 1*, the
indemnity row reading *Stated by Meridian Chartered Accountants* with a dash rather than a
check, *Contracting 41 · Trading 28 · Free zone entities* with the disclaimer beneath, *Works
across Abu Dhabi, Dubai, and Sharjah*. Typed a requirement, pressed *Enquire* on the VAT row:
the select moved, the text stayed, focus landed in it. Sent it with a PDF: the tracking page
read *VAT and corporate tax filing* with no quantity, *Size of the job* and *Attached*; the row
landed private with storage's own byte count. Signed in as the owner: the lead showed
*Service*, *Size of the job* and the file, which downloaded through a signed link; a guessed
document id and another enquiry's path both 404.

---

## 4n · Handoff `1e-s` — the services list, rows not a photo grid

**Shipped 13 Sep 2026**, stacked on `1d-s` (#174). No migration: it reads `EnquiryLine.serviceId`,
which `1d-s` added.

### D11 was already closed, so the board's biggest block was not one

The README calls this *substantially blocked* and asks for a second look before cutting the
waitlist. D11 closed as **no** on 11 Sep (§3), before this board was drawn. Nothing about
availability shipped: no *taking work* filter group, no chip, no *Join the waitlist*, no capacity
sentence. The panel has two groups, not three.

### The three open questions, taken as the board recommends

- **Q1 — `Not stated` stays on this page.** The four-field block is the page's only comparison
  mechanism; a vanishing cell misaligns the column. Written into §4g and §4m as a deliberate
  third rule rather than a contradiction.
- **Q2 — no completeness figure on a buyer page.** The render's *THIN SCOPE — 2 OF 6 ROWS
  FILLED* is cut, and so is the *n of 9 rows filled* line the placeholder index it replaces had been
  printing on every card. The scope table on `1g-s` keeps its own line (§4g); B2 is about this list.
- **Q3 — enquiry volume sorts, the seller's order breaks ties.** And where no service has volume —
  every firm on the day this ships — the list *is* the seller's order, and the sort line says so:
  *in the order the firm lists them*. The `3f-s` reorder hint now says what the drag order drives:
  the overview outright, the services tab after volume.

### Four decisions the board left open or drew loosely

- **Q4, thirty to a page**, with `?page=` as the one crawlable key.
- **Ninety trailing days, said as "in the last 90 days".** The render's *this quarter* resets on
  the first of a month and would tell a buyer on 2 April that the firm's busiest service had two
  enquiries. Counted as distinct enquiries the firm actually received.
- **`MOST ENQUIRED` only for a clear leader** — not at a tie, not at zero, not with one service.
  The count shows on that card alone.
- **The filter note has two wordings.** B6 wants it on every firm; *these filters do almost nothing*
  is false at thirty, so past eight it says what the filters do instead.

### Every *Enquire* opens the drawer

The card's primary, the heading's *Enquire about anything* and the footer's *Enquire anyway* (B9)
all open the service composer over the list — on the card's service, or on *something not
listed*. Sending a buyer to the overview to write would lose the list they were choosing from.
`ServiceEnquireDrawer` mounts the form only while open, so thirty cards are thirty buttons.

### Found on the way, and fixed

- **The gallery rendered four unnamed composer `<form>`s**, which `landmarks.spec.ts` counts as
  duplicate landmarks — CI failed `1d-s` on it. The form is named now, per instance.

### Verified by clicking it

At 1280: the audit card leads with *Most enquired* and *1 enquiry in the last 90 days*, the VAT
card reads *Not stated* under *Delivered* and has no *You provide:*, *Fee on enquiry* on both.
Ticked *Fixed fee*: one card, `nofollow` on every filtered href, `noindex, follow` in the head;
*Clear filters* back. *Enquire* on the VAT card opened the drawer on VAT; *Enquire anyway* opened
it on *Something not listed* and sent an enquiry that arrived with no quantity. At 375 the filters
sit behind a button in a drawer. Axe at 1280: nothing.

---

## 4o · Handoff `1f-s` — coverage, where branches and hours were

**Shipped 13 Sep 2026.** No migration: `ServiceCoverage.serviceId` (#173) and `FreeZoneRegistration`
(`2d-s`) were already the model. **The public storefront set is complete** — `1d-s`, `1e-s`,
`1g-s`, `1f-s`.

### D11 was already closed, so the H1 is two words shorter

*Where they work*, and the title is *Coverage*. The render's *and whether they are taking it on*
promised a column the board never drew; with D11 closed as no there is nothing to promise.

### Four corrections

1. **The reply time is the platform's one measurement, not a second one.** The board asks for a
   median over *the last 40 enquiries* with a floor of 10 (Q1). The header of the same page already
   prints `Business.responseTimeMedianMs`, measured nightly over **90 days with a floor of 3**
   (`lib/metrics/response-time.ts`). A second definition would print two reply times for one firm
   on one screen. So the card shows the header's figure and the sample it stands on — *measured by
   us across N replies in the last 90 days* — counted through the same `latencies` function. **Raising
   the floor to 10 is a platform decision** — it would move search ranking and every card's reply
   line. **The owner kept it at 3, 13 Sep 2026**: at 10, twelve of seventeen measured sellers in
   production would go unmeasured, and fast repliers would lose ranking to thin samples.
2. **Free zones say *registered in*, not *approved*.** A `FreeZoneRegistration` is where the firm is
   registered; *DMCC approved* is a claim about an auditor list nothing records. They print beside a
   row only where that service reaches the zone's emirate, and are never places or filter values (B4).
3. **The office line is derived, not invented.** *Visits by appointment* is a claim no field holds;
   the card says *they see clients here* when the firm's delivery modes include its office, and
   *their registered office* otherwise.
4. **The fan-out CTA is *Request a quote*, not *Ask for quotes*.** The vocabulary rule. It opens
   `/rfq/new` with the service's subcategory and the emirate seeded, and is `nofollow`. (It seeded
   *{service} in {emirate}* as the requirement until `1h-s`, whose B2 sends a description as the
   buyer writes it — see §4p.)

### How the offer picks its emirate

The service with the narrowest reach, then the emirate it does not reach where the most other
firms' same service does — counted live in SQL with effective coverage resolved the way
`effectiveCoverage` resolves it, over published, claimed, unsuspended firms. A zero is not printed;
the offer then makes itself without a number. A firm whose every service reaches all seven has no
offer.

### Q2 and Q3

- **Q2 — the emirate filter** renders past eight services, the threshold `1e-s`'s filters use, as
  `nofollow` chips; a filtered view is `noindex`.
- **Q3 — `How`** is `Service.deliveredWhere`, one value per service. A mixed-mode service needs the
  field to become a set, which is a `3g-s` change, not this page's.

### Found on the way

- **`/b/:slug/branches` for a firm that sells only work now 308s to coverage.** The tab was gone and
  the old address still rendered a branch page.
- **`coverage` joined the reserved template-page slugs.**

### Verified by clicking it

With the audit narrowed to Dubai and a DIFC registration on the local database: *Coverage differs
by service here* above two rows reading *Dubai · Registered in DIFC · Remotely* and *Abu Dhabi,
Dubai, and Sharjah · Not stated*; *Not measured yet* with the floor stated; *English and Arabic ·
Their own claim*; *2 firms cover Ajman for Statutory audit* on the offer, whose link landed on
`/rfq/new?category=valves-and-fittings&q=Statutory+audit+in+Ajman`. `/branches` 308'd to
`/coverage`; a goods seller's `/coverage` 404'd. No map, no second table, no horizontal overflow at
375. Axe at 1280: nothing.

---

## 4p · Handoff `1h-s` — the brief, and no field asks a quantity

**Shipped 13 Sep 2026.** One migration, `20261014120000_service_brief_1hs`, additive: a
`service_brief` table and two enums. `/rfq/new` mounts a second composer when the trade is sold by
the job; the goods `1h` beside it is untouched.

### What a brief is, in the schema

**One `ServiceBrief` per enquiry**, holding only what an enquiry did not already have: the trade,
the engagement (`3g-s`'s enum, imported rather than restated — B3), the cadence (a CHECK allows it
only on an ongoing contract — B4), the start (`from_date` with a date, or `asap`, another CHECK), and
the building. The description is `Enquiry.requirement`, **stored byte for byte** for a brief (B2) and
trimmed for goods as it always was; the site is `Enquiry.emirate` + `Enquiry.areaId`, picked and
written directly rather than resolved from text; the scale is D7's `Enquiry.scale`, null when left
empty (B6, B7); the files are `Document` rows, one set for every recipient.

### Six corrections to the render and the spec

1. **The brief still writes one line.** The spec's model says *no lines*. `sendQuote` requires every
   quote line to answer an enquiry line, so a brief with none could not be quoted until `3j-s`
   rebuilds the composer — the accepted quote, the terminal state, would be unreachable. The line
   names the trade (or the service a named firm's brief came from) and has **no quantity**. The page
   renders no lines table and asks nothing per line (B1).
2. **The privacy card said *your name and company go with the brief*.** Rule 1 at the query layer
   (`seller-visibility.ts`) gives a supplier a first name and nothing else until acceptance, and the
   `1d-s` lead screen already corrected the same render. The card says so.
3. ***Most buyers get their first proposal back in under an hour* was a claim.** It is now a median of
   brief-to-first-reply over the last 90 days at the owner's floor of 3, or the sentence is left out.
   Production has no brief yet, so production shows it left out.
4. ***A verified licence for Hard FM*** — a trade licence is not per subcategory. *Suppliers of Hard FM
   & MEP maintenance who … hold a verified trade licence.*
5. **The site is a select, not a text box.** One native `<select>`, an optgroup per emirate, *anywhere
   in {emirate}* first, then its areas with free zones labelled. The value is `(emirate, areaId)`, the
   exact shape every coverage table is keyed on; typed text would need the resolver, which refuses on
   ambiguity and would leave the matcher with nothing.
6. **The attachment warning states the match.** *Up to 8* before a site is chosen; *3 firms will each
   hold a copy* once one is — B8's warning, with the number.

### Matching — B5, per service

**Per service, never per business.** The first export of this handoff said *the business-level union
(`2d-s` B6), not per-service*; the amended `1h-s` carried by the `3b-s`/`3c-s` and `5c-s` exports says
the opposite, and `3c-s` B8 with it — *a fan-out for statutory audit in Ajman does not reach this firm
even though their listing says Ajman*. The newer record wins. The union is the listing's headline;
routing reads the rows.

`findBriefCandidates`: published, claimed, `sellsKind` services or both, **verification tier ≥ 2 with
a licence not yet expired**, and **a live service filed in the trade** (or a child of it). Then, per
such service, its `effectiveCoverage` — its own rows, else the firm's default — must reach the site:
the area or its whole emirate, or anywhere in the emirate once the buyer widens. A firm merely listed
under the subcategory, with nothing live in it, is not a recipient. `selectBriefRecipients` drops a
firm at its monthly cap into `MissedEnquiry` (D4) and ranks the rest: a matched service sold on the
chosen engagement, exact trade, measured reply time, id. **No plan multiplier**, the goods fan-out's
rule. The preview and the send call the same function.

**The engagement ranks and never filters.** A firm whose sheet says *ongoing contract* can still price
a one-off job; filtering would narrow the match silently, which is what B3 warns about.

### The open questions

- **Q1, the cap** — **left at 8**, as criterion 5 and the render say, in one constant
  (`BRIEF_MAX_RECIPIENTS`). The design side argues 5 for services. Owner's call; it is one line.
- **Q2, a budget field** — no. There is none.
- **Q3, attachments** — one set, every recipient, up to five files at 10 MB, warned once before the
  first. No per-recipient files.
- **D11** — closed; no availability clause (B12).

### Found on the way, and fixed

- **`/rfq/new?revise=` has been a dead link since board 1i.** The tracking page's *Edit the
  requirement* opened a blank composer and `reviseRequirement` had no caller. It is a small page now,
  for goods and briefs: the words, and for a brief the scale; a revision that changes nothing is
  refused because it would still supersede every quote. The link carries the claim token.
- **`tradeKindFor` resolved an id missing from its day-long cache to `goods`.** A category written by a
  seed or a migration revalidates nothing, so a freshly seeded Hard FM brief opened the parts list. A
  cache miss on the id now reads the table.
- **`1f-s`'s offer counted firms the brief could never reach.** It now requires the verified, current
  licence too. Both route per service, so *N firms cover Ajman* can understate the brief's match and
  never overstate it; and its link seeds the emirate rather than a sentence the buyer did not write.
- **A constant exported from a `"use client"` module arrives in a server component as a reference.**
  `EMPTY_BRIEF` spread to nothing and the seeded brief lost every key but two — the function-boundary
  defect, in constant form. It lives in the pure module.

### Not done here

- **`?from=` (*add two more suppliers*)** — answered in the pull request after this one: a
  confirmation page that re-runs the goods matcher with every current recipient excluded. A brief
  hides the link: it already went to every firm that covers the site.
- **The quote composer still says *nothing in your catalogue matches*** on a brief's line — `3j-s`.
- **Fan-out scoring for goods** still does not read `areaId`; the brief's matcher filters on it.

### Verified by clicking it

Before the per-service correction, anonymous, on the local database with the new fixture (every
firm in it has a live Hard FM service, so the names hold): Hard FM · *anywhere in Dubai* named Emirates
Facilities Group, Al Shirawi and Khansaheb (Al Quoz only) and not Sand and Steel (unverified); Deira
dropped Khansaheb and said *only 2 suppliers match*; Ajman Free Zone offered *send to suppliers across
Ajman* and, taken, *Send to 1 supplier*. A sent brief wrote one enquiry, three recipients, one
`service_brief`, one line with a null quantity, and the tracking page read it back with *Scale, in
your words*. Revised to R2 through the tracking page's link. Signed in as Meridian's owner, a named
brief read *Site Sharjah · Engagement Ongoing contract · Starts As soon as possible · Scale Not given*
under the first name only.

---

## 4q · Handoff `12c-s` — a second vector on the ranking board

**Shipped 13 Sep 2026.** One additive migration, `20261015090000_ranking_vector_by_kind`:
`RankingWeights`, `RankingDraft` and `RankingPublish` gain a `kind`, and `ListingFactorDay` gains the
`vector` that ranked each listing that night. **No services row is seeded**, so on the day this ships
the services vector is *not published*, services listings rank on the goods vector, and no result
anywhere moves until an ops lead publishes one.

### One board, keyed — and where the key lives

Every function in `lib/search/settings.ts` that reads or writes a weight takes the kind with no
default, so the amendment's fourth item — *anything that reads or writes a weight needs the key* — is
a compile error rather than a review note. The editor, preview, publish strip and history are the
`12c` components with a `kind` prop; `?vector=services` is a query parameter on `/admin/search`, not
a second route. The goods row keeps `id = 'current'` (pinned by `ranking_weights_one_row_per_kind`)
because the code serving production when the migration applies reads nothing else.

**The slots keep their column names.** `spec_completeness` and `distance` are what each vector stores
in its fourth and fifth slot; `FACTOR_SOURCES` in `lib/search/ranking.ts` is what a slot *measures* —
spec or scope, kilometres or coverage. Renaming the columns would have made the migration a
drop-and-add, which has no safe order. `factorScores` reads the map, and so does B2's gate.

### Six corrections to the handoff

1. **The defect is a stuck half, not a zero.** A business with no products has `specCompleteness =
   null`, and the ranker scores null as unmeasured — half. So a services firm holds 6 of the 12
   points and can move neither way, whatever it fills in; *"half the directory ranks 12 points
   light"* is 6. The board's argument survives (a factor nobody can earn is a fixed input dressed as
   a signal) and the copy on the board says *half, whatever they fill in*. Distance behaves the same
   way for an unpinned branch.
2. **B10 describes a `setWeights` that no longer exists.** `validateWeights` has refused a total other
   than 100 since `12c`'s second pass (`WEIGHT_TOTAL` carries the argument). What B10 protects — no
   second convention on the services vector — is kept by running both vectors through the same five
   rules, the total among them. `ranking-services.test.ts` asserts the refusals are identical.
3. **Q1 is answered in one function, as the board recommends.** `rankBlended` ranks each kind on its
   own vector and merges the two orders by relevance band — the one signal both vectors score
   identically — and inside a band in proportion to how many of each there are. Scores from two
   vectors are never compared, within-kind order is exactly `rank`'s, and with no services vector
   published there is one group and the result is the single-vector ranking. `1c-s` changes this
   function and nothing else. Category listings in the snapshot and preview never blend: a scope is
   one category, and the category decides the vector.
4. **The status chip has three states, not one.** *Not published* (no row, no draft), *Draft · not
   published*, *Live · published {date}* from the vector's own history.
5. **"Up from 22" is a query.** Each services slot states the goods vector's live number beside its
   reason, so the comparison survives the goods vector moving.
6. **The amendment panel is not on the product.** *"The 12c handoff has shipped twice without
   mentioning any of this"* is a note to a developer about a design document; it is recorded below
   instead of rendered to an ops lead.

### What each build note became

| # | How it holds |
|---|---|
| B1 | One editor, strip, preview and history, keyed by `kind` |
| B2 | `unwiredSlots(kind)` reads `FACTOR_SOURCES`; `publishDraft` refuses `not_wired`. Unit-tested against a map that is wrong, so the closed branch has been seen |
| B3 | `scopeCompleteness` in `lib/search/service-signals.ts` — complete sheets out of live sheets, six of six, two places, null with none. **Computed on read**, as `3g-s` B3 requires |
| B4 | `coverageMatch` resolves each *matched* service through `effectiveCoverage`; an unmatched service's reach is never lent to the listing, and with no match the default is read, not the union |
| B5 | `planTierAgrees` checks the other vector's live number **or the draft waiting to follow it** — against the live number alone the pair deadlocks. Refused at publish, warned at save |
| B6 | Both vectors pass `validateWeights`, so the effective-browse ceiling holds on both |
| B7 | The sampler ranks each scope on its category's vector, so a services draft moves only services scopes and every count is counted from those |
| B8 | Every write is keyed; the integration test publishes services over a sitting goods draft and diffs the goods row, draft and history |
| B9 | By construction — `verificationTier`'s writers are the verification service and the expiry sweep. A credential added to a services firm leaves its score unchanged, asserted |
| B10 | See correction 2 |
| B11 | Live search resolves each listing's kind from the category the result set matched it through; seller screens from the primary category (`vectorForBusiness`). Reclassifying a sector moves a firm's vector with `sellsKind` untouched, asserted |

`weightsForShape` moves the goods vector only: coverage match already answers *does the firm come
to you*, and moving it again because the words typed looked service-shaped would be the same
judgement made twice. Attribution treats a change of vector between two nights as state 09 — the
night a services firm's slots start measuring scope, `decompose` alone would tell them their scope
completeness rose.

### The amendment to `12c`, as it now stands in the tree

1. `spec completeness` cannot be earned by a services listing; the services vector scores scope
   completeness in that slot, at the same weight.
2. `distance` scores kilometres between offices; the services vector scores coverage match — binary,
   per matched service — in that slot, at the same weight, pinned.
3. `browseRelevanceMode` and the effective-browse plan ceiling apply to both vectors.
4. `RankingWeights`, drafts, publishes and nightly factor rows are keyed by kind; the affected-seller
   count is scoped to the vector by construction.

### Found on the way, and fixed

- **Any staff seat could run the preview.** `runPreview` required a staff seat and never checked
  `search.ranking.write`, so a moderator on the read-only board could start a whole-directory
  ranking and overwrite the preview an ops lead was about to publish against.
- **The strip said *1 category move*.** The verb now agrees with the count.
- **The editor's *Draft saved* notice outlived the draft**, standing over a board with nothing
  drafted after a publish.

### Still owed

- **Emirate listings are branch membership, not coverage.** `businessWhere` filters an emirate by
  published `Location`, and the snapshot's emirate scopes do the same, so a remote practice that
  covers Sharjah with no branch there is absent from Sharjah — coverage match only ever separates
  firms that already have a branch. Kept consistent with the live pages on purpose; it is `10c-s` and
  `6a-s`'s to change, and both should change together.
- **No seeded published listing sits in a services category**, and Meridian Chartered Accountants —
  the track's fixture firm — is filed under *Valves & fittings*, so on a fresh database the services
  vector moves nothing and Meridian ranks on goods. Not repurposed: four boards assert on it.
- **Q3 and Q4 are the owner's.** The tier ladder is shared (register-checked licence and VAT only,
  per D10), and reply time weighs 20 on the same 3-reply floor `1f-s` left open.

### Verified by clicking it

On a throwaway database with four services firms in *Testing & commissioning*: the services toggle
opened on *Not published*, the defect stating *4 services listings*, and the six slots with each
goods number beside its reason. A draft saved as *Draft · not published*; the preview listed
*Testing & commissioning · UAE* and *· Dubai*, *Who gains: Complete scope sheets*, and Gulf
Commissioning Engineers — tier 2 with a half-finished sheet — falling two places; publish read *up
to 4 sellers told*. After it the chip read *Live · published 13 Sep 2026*, the goods vector still
read 34 · 22 · 18 · 12 · 8 · 6 live since 4 Sep, the two histories held one row each, and
`/c/hvac-and-ventilation/hvac-testing` listed the two complete sheets above Gulf. Keyboard: toggle,
sliders, mode, reason and rail links in order, no trap. One `h1`. No server errors.

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
*Three migrations. Both blockers are gone; what is left is the expensive screen.*

| Step | What | Note |
|---|---|---|
| **6.1** | ~~`EnquiryLine.qty` nullable~~ | **Shipped #173**, `20261010090000_nullable_line_qty`. Null means **unquantified, not none**: `lineTotalFils` multiplies by 1 so a priced line still totals, and every render site omits the figure rather than printing `×1` |
| **6.3** | ~~`QuoteLine.qty`~~ | **Shipped in the same migration.** It was the harder half and neither planning document named it: `sendQuote` refused `qty < 1`, so it gated the **accepted quote** — the terminal state of the whole product |
| **6.1b** | `Enquiry.areaId` | **Shipped #178.** The third migration, below |
| **6.2** | ~~**`1h-s` / S2** — the brief~~ | **Shipped 13 Sep**, `20261014120000_service_brief_1hs`. See §4p |
| **6.4** | `3j-s` Reply with a proposal | |
| **6.5** | `1n-s` Compare proposals | Consecutive with `3j-s`. Four fee bases do not compare the way four unit prices do |

~~**`Enquiry.deliverToArea` is free text**, not an `areaId`~~ — **fixed #178**. It is a real
`areaId` beside the free text now, so an area-level coverage match is computable from the enquiry
side for the first time, against the same `(emirate, areaId)` shape `ServiceCoverage` and
`BusinessCoverage` already use. The composer control that would let a buyer *pick* one is still
`1h-s`'s: what shipped is the column, the backfill and the resolver.

**Scoring is deliberately untouched.** `lib/enquiry/fanout.ts` still scores
same-emirate and nothing finer, because "how much is an area match worth
against an emirate match" is a design decision with a weight behind it, and
changing who receives an enquiry without one is not a migration. The data is
there for the board that makes that call. The one reader that did move is
`lib/leads/router.ts`, which routes a lead between one seller's own seats and
was already matching area names as lower-cased strings.

**`1d-s` has already built most of `1h-s`.** `lib/enquiry/service-enquiry.ts` is a four-field
services composer — which service, what you need in your own words, how big the job is (D7's
`Enquiry.scale`, a new column), needed by, plus one attachment. A handoff drawn cold will draw a
screen that mostly exists. What is genuinely still owed is the *where* — now that `areaId` exists,
a control to set it — and "how often", which has no field at all.

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

**`12c-s` shipped 13 Sep — see §4q.** Two of §2's three ranking defects went in #173 — the shape vector totals
100 on every query shape now, and the affected-seller counter is a real count. The third,
`RankingWeights` being a Postgres singleton with `CHECK ("id" = 'current')`, is deliberately left:
a kind key is a drop-and-re-key on the live ranking table, which is this board's own opening move
rather than something owed to it. Budget for it in the handoff.

`4c-s` narrows under D10 to the two kinds a register can answer. `12g-s` and `6g-s` are one piece of
work and there is currently no instrument in the tree that can charge D9's accepted drift.

---

### Deferred, and conditional on a decision
**`4e-s` scope-sheet families · `3h-s` scope template.**

These exist only if scope sheets are templated. See the open questions below — the two planning
documents disagree, and the answer decides whether these are two boards or none.

---

## 4p · Handoff `3b-s` + `3c-s` — the two maintenance screens

Shipped 13 Sep at `/dashboard/coverage` (new) and `/dashboard/listing` (the goods `3b`, with a
second field set). The seller-dashboard lane closes with these two. Migration
`20261014130000_practice_facts_3bs` adds `business.qualified_count` and `business.typical_client`.

### `3c-s` — the coverage manager

One row per service under the business default, and **every marker, count and union on the page is
derived from the rows on the request** (B3, B4). The union is `businessCoverage` over live services —
the function `1d-s` renders — and the free-zone qualifier is `1f-s`'s own `rowQualifiers`, so the
seller screen and the buyer pages cannot disagree about what a buyer sees.

- **The board's spec contradicts itself on a fourth state.** Its prose says *equal is inherited*;
  its pseudocode files equal under *narrowed*. Neither is true: rows that match the default do not
  follow it. So `coverageMarker` has four states, and `same` is labelled *Same as default, set
  separately* with the one action that fixes it.
- **Both editors stage.** Onboarding saves each chip as it is clicked; here a default edit moves
  every inheriting service at once, so the dialog names the count (B11) and nothing is written until
  Save. The fields are `2d-s`'s `CoverageFields`; the chips became one `CoverageChipGroup`, used by
  onboarding, the service editor and this screen.
- **The publish gate still holds after publish.** A live listing cannot empty its default modes or
  areas through the back door — the same refusal `2d-s` B2 gives before publish.
- **The free zone renders beside every row that reaches its emirate**, not only the audit row the
  board draws — `1f-s`'s rule, since that is the page buyers read.
- **No availability control** (B10). The tree carries no services waitlist state anywhere; `D11` was
  cut before `1d-s` was built, so the handoff's worry about a public state with no field does not
  apply to what shipped.
- **Fan-out matching (B8) is `1h-s`'s**, built by a sibling session. This board exports
  `reachesScope`, `withinCoverage` and `coverageMarker` for it and does not touch the matcher.
- The nav gains *Coverage areas*; *Locations* leaves the rail for a services-only firm, as `1f-s`
  made `/branches` redirect to `/coverage`. **Hours stays** — the handoff names it a decision
  (remove, or the `3d-s` placeholder), not a render change.

### `3b-s` — the listing profile

- **Route is `/dashboard/listing`, not `/dashboard/profile`.** That is where the goods `3b` lives and
  where the nav has always pointed.
- **The three goods fields the board takes out never existed on `business`.** Brands, minimum order
  and lead time were drawn against a goods profile that does not carry them, so B2 is true by
  construction. What is goods-only on this screen is payment terms, and the action leaves it
  untouched when the field is not drawn.
- **Practice size stays a band.** The board wants a number with the band derived (B4); the tree
  stores the band the seller picks, filtered and compared on across the directory. One field, so
  nothing drifts — B4's actual concern. What a band cannot hold is the qualified count, which is the
  new column, checked against the band's ceiling.
- **Sectors are free entry with a suggestion index, not a closed list** (B5). That is what `2c-s`
  shipped and its own spec required (*deliberately not the attribute dictionary*), and B8 requires
  one field set. **The cap is six** (Q1), down from twenty; no services listing in production had
  named a sector, so it cost nothing on the day it changed.
- **Categories stay editable through moderation** rather than read-only (B7). The board's premise —
  categories follow from a subcategory assignment — is the same `BusinessCategory` row this screen
  already queues for review, and `2c-s` edits them; read-only here would strand the seller B8 warns
  about. The mechanism sentence is added beneath, counted from how each category resolves.
- **Qualified count renders for every services seller** (Q3). `ScopeSheetFamily.credentialKind` looked
  like the family signal and is not: *Professional services* has none. Tying it to a family needs a
  flag that does not exist.
- The board's two rail notes name other boards (*mirrors 2c-s*, *— 4d-s*). They are annotations for
  the build, and a seller reading a board number is reading our filing system; the substance ships
  in the seller's voice.
- On the storefront: **Practising since** replaces *Trading since* for a firm that sells work, the
  qualified count joins the team band, and typical client sits under *What we take on* beside the
  prose it has to agree with.

### Found on the way, and fixed

1. **The primary-category picker moved listings.** It offers leaves only, and a `<select>` whose value
   is not an option shows and posts its first. **89 of 123** production listings carry a non-leaf
   primary, so the screen showed *3D printing & prototyping* and any save — a corrected description —
   also queued a request to move the listing there. Eleven were claimed.
2. **`2c-s` dropped every services seller's languages.** The chips rendered, the value sat in state,
   and nothing posted it.
3. **`2c-s` never asked a services seller for a description**, while `1d-s` leads the storefront with
   it and renders nothing when it is empty — every onboarded firm had no lead section.
4. **`ServiceProfileFields` said the dashboard mounted it.** Nothing did, so the one-liner and sectors
   were uneditable after onboarding.
5. **Three seller writes guarded on having a seat, not a capability** — the per-service coverage
   actions from #173 and onboarding's services save. A sales seat could change where a firm works.
6. An over-long one-liner was reported with the *services* count in place of its own length.

### Still owed

- **Seed fixture: Meridian is filed under *Valves & fittings***, a goods trade, so the mechanism
  sentence shows its mismatch case — *set to goods, but you told us you sell work* — for the track's
  demo firm. Moving it touches the
  fan-out counts other suites pin; worth doing once, deliberately.
- The fixture-name split the handoff raises (*Nexus* on `8b-s` and `4e-s`'s preview) is design-side.
- A `both` seller's languages use the goods screen's fixed list of eight, while a services-only
  seller types free entries. One column, two vocabularies; only matters on a change of kind.

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

## 5 · Found on the way — not services work, and one of them was money

**All eight are closed.** Seven went in #176, item 1 was already fixed by the
time this register was re-read, and each entry below keeps what it was so the
next reader can tell a fixed defect from one nobody has looked at.

Ranked by what it cost.

1. ~~**The placement credit over-credits an annual seller.**~~ **Already fixed
   when re-checked, 13 Sep.** `unusedPlacementFils` takes a `BilledPeriod` and
   caps `billable` at `periodDays`; `lib/placement/term.ts:153-165` now records
   the 975 AED over-credit in the past tense, and `takeSlot` imports
   `SLOT_TERM_DAYS` rather than writing `30 * 86_400_000`. The register was
   stale about its own most expensive item, which is the reason every entry
   here is now dated.
2. ~~**The enquiry cap bypasses the entitlement snapshot D1 rests on.**~~
   **Fixed #176.** `findFanoutCandidates` reads the whole cap set through
   `effectiveCaps`, so a grandfathered seller keeps the allowance they signed up
   on in the one reader that decides whether they are shown an enquiry at all.
   `rankingMultiplier` stays the live plan's, deliberately — `effectiveCaps`
   says the name, the price and the multiplier are facts about the plan today.
   Found underneath: `toCaps` and its column list existed twice, so both moved
   to `PLAN_CAPS_SELECT` in `lib/plan/entitlements.ts`.
3. ~~**`publicPhotoLimit` has no editor.**~~ **Fixed #176**, and it was worse
   than recorded: `serviceLimit` had had a box on the screen since board `2e-s`
   and no read-back in the action, so staff typed the services cap, saved, and
   were told nothing had changed. Both lists are one now,
   `lib/plan/editable-caps.ts`, read by the form that draws the boxes and the
   action that reads them back — and the editor's seed map was a third literal
   with `publicPhotoLimit` already missing from it.
4. ~~**An eighth divergent template resolver, in the writer of the ranking
   column.**~~ **Fixed #176.** `lib/spec/resolve.ts` gained `resolveTemplateIds`
   — board 4e's three-step rule in bulk, three queries for a whole-table sweep
   — and `lib/metrics/strength-job.ts` uses it. Nine integration cases assert
   the bulk reader against the single one on the same category, including step
   3's quirk of preferring the newest live template across the category *and*
   its parent rather than the category's own.
5. ~~**`removeCategory` has no capability check.**~~ **Fixed #176**, with
   `addCategory`, which had the identical gap. `removeExtraCategory` reports
   whether a row actually went, and the chip row renders the refusal instead of
   discarding it — `at_cap` and the rest were being swallowed too.
6. ~~**`nav-config.ts:102`**~~ **Fixed #176.** The verification row carries
   `listing.edit`, like the three siblings above it and like all four of the
   writes on the screen it points at.
7. ~~**12d prints a page cap as a total.**~~ **Fixed #176.** `callList` returns
   a real `total` counted before the screen's limit, scan depth is its own
   constant so the page and the console tile no longer read different candidate
   pools, and `reply_rate_falling` — a `SignalKey` with a catalogue label and no
   producer — came out with the query that would have set it.

   **Still open, and not a defect:** `CallOutcome`'s only writer is `logCall`,
   whose only caller is an integration test, so the recently-called suppression
   can never fire in production. That needs a call-logging screen, which is
   board 12d's work.
8. ~~**Untranslated strings** at `lib/reports/service.ts:147,151`.~~ **Fixed,
   #176 and #178**, and the same shape was in five modules rather than one:
   `lib/reports/service.ts`, `lib/onboarding/conflict.ts`,
   `lib/moderation/service.ts` and `lib/verification/review.ts` in #176, and
   `lib/verification/service.ts` and `lib/business/service.ts` in #178. Every one of them is a staff-facing
   service layer returning raw English that an action handed straight to the
   screen; two interpolated a raw enum and one a raw slug. The rule they now
   follow: **a service returns the fact as a key, the action does the wording.**

   **Still open, and buyer-facing:** `lib/alerts/service.ts` returns nine
   sentences of raw English across three refusal keys — five different wordings
   share `no_identity` alone, so moving them needs finer keys rather than a
   mechanical swap, and flattening nine considered sentences into three would
   be worse than leaving them. It is the one remaining module of this kind and
   the only one a *buyer* reads.

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
| **1** | **The service editor, its list, and the buyer's page** | `3g-s` · `3f-s` · `1g-s` | Stages 3 and 5 | **shipped 12 Sep.** One handoff, three screens, and it was right: the editor fixed the field set, the list reported on it, the page rendered it. See §4g |
| **2** | Creating a service | `8a-s` · `8c-s` · `8b-s` | Stage 4 | **All three shipped 12 Sep.** `8b-s` turned out not to be a refinement of `3e` after all (§4i), and `8c-s`'s D11 block had already been lifted (§4j). Wave 2 closes on `3h-s` |
| **3** | The seller's own details | `2b-s` · `2c-s` · `2d-s` · `3b-s` · `3c-s` | Stage 4 | **Complete.** `2b-s`, `2c-s`, `2d-s` shipped 11 Sep; `3b-s` and `3c-s` 13 Sep (§4p) |
| **4** | The storefront | `1d-s` · `1e-s` · `5c-s` · `1f-s` | Stage 5 | **`1d-s`, `1e-s` and `1f-s` shipped 13 Sep** (§4m–§4o) — the public storefront set is complete. `5c-s` has a placeholder waiting |
| **5** | Asking, and answering | `1h-s` · `3j-s` · `1n-s` | Stage 6 | **`1h-s` shipped 13 Sep** (§4p). `3j-s` and `1n-s` must be consecutive, and both read the brief |
| **6** | Discovery | `1c-s` · `10c-s` · `6a-s` | Stage 7 | `6a-s` roughly doubles the `6f` page matrix |
| **7** | Ranking and ops | `12c-s` · `4c-s` · `12g-s` · `6g-s` | Stage 8 | **`12c-s` shipped 13 Sep** (§4q) — the third ranking defect, the singleton, was its own first step. `4c-s`, `12g-s` and `6g-s` remain. `1c-s` is unblocked on Q1, which `rankBlended` answers |
| — | **Q1 said families** | `4e-s` · `3h-s` | — | Both **shipped 13 Sep** — `3h-s` closed wave 2 (§4k) and `4e-s` authored the five families (§4l) |

**What needs no handoff at all:**

- `4d-s`/S9 — shipped. A staff table plus a column and a bulk control, and nobody outside sees it.
- `1f-s` — D11 is closed, so what remains is board `1f`'s shipped page reading coverage instead of
  two seller-claimed fields. Since `2d-s` that means **both** tables through `businessCoverage()` in
  `lib/locations/service-coverage.ts`, which is the one helper B6 asks for. Stage 1's locality fix
  surfacing, not a design.
- Every migration in stages 3 and 6, and the `profileStrength` re-weighting in stage 4.
- `2e-s` — the plan's service cap. It is a column and a number, not a screen, which is why it is in
  stage 3 and not in the table above. It still has to be **answered** before handoff 2 ships.

All 29 `-s` ids in `docs/epic-2026-09-11.md` are placed above exactly once — the 28 it counts, plus
`2e-s`, which it names once and puts in no phase.

**Why not hardest-first.** `docs/services-spec.md:239-241` suggested S1, S2, S3 on the grounds that
they are the long poles. That is the right order to *design* in and the wrong order to *deliver* in:
a handoff that arrives early costs nothing to hold, and one that arrives late blocks a stage. Design
may draw them in any order it likes — this table is the order they can be built.
