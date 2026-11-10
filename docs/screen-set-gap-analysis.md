# The screen set — gap analysis against both November handoffs

**Read against `7527e706` (#241), 9 November 2026.** Audits two design packages against the
working tree, board by board, with twelve parallel agents and a verification pass on every
load-bearing claim:

- `handoff-complete/` — the main canvas, **102 boards**, dated 8 Nov.
- `handoff-services/` — the services canvas, lane 04, **28 `-s` boards**, dated 8 Nov.

**130 boards in total.** The first version of this document covered only the first package, which
produced one wrong finding; it is corrected in §1.3 and the correction is instructive enough to
keep rather than quietly fix.

Sits beside `docs/build-plan.md` (44 boards, 9 Sep) and `docs/services-build-plan.md` (28 `-s`
boards, 11 Sep), both of which it reconciles against the new packages.

Companion documents, written from this one:

- `docs/design-prompt-book.md` — 65 ready-to-send Claude Design prompts, in six waves.
- `docs/production-build-plan.md` — the sprint plan from here to 41,000 listings in production.

---

## 1 · The finding

**The screen set is 93% routed. The gaps are not where either package thinks they are, and the
two packages disagree with each other and with themselves more than either disagrees with the
code.**

| | Count | What it means |
|---|---|---|
| Boards across both canvases | **130** | 102 goods + 28 services |
| Boards with an implementing route | **121** | the route exists and renders |
| Boards with **no** surface at all | **6** | `3n`, `1o` (selection), `7g`, `12h`×3, `13b` |
| Boards **deliberately cut** from the code | **7** | `5a`–`5h` (6 of them) + `5c-s` |
| Boards where the **code is ahead of the render** | **≈ 40** | the render is the older artefact |
| Boards that must **not** be built | **2** | `12j` (approved: no resend), `6g-s` (cut 14 Sep) |

Of the 28 services boards, **26 shipped** between 11 and 24 Sep 2026 and two are cut. Not one
services board is unbuilt. The services track is the most complete lane in the product, and the
package covering it is the one most out of step with the code.

### 1.1 · The unit of work, in order of volume

1. **Reconcile.** Roughly forty renders are older than the code. On the services canvas it is
   worse than on the goods one: four renders carry an availability column for a decision **closed
   as no on 11 Sep**, one carries `✓ OFFICE VISITED` for a tier **cut on 5 Sep**, and one carries
   `Join the waitlist`. An agent obeying the package's own rule — *"the render is the latest
   truth"* — would reintroduce every one of them.
2. **Finish six surfaces** that exist as tested backends with no screen.
3. **Carry the layer underneath to 41,000 rows**, which is where the actual launch risk is.
4. **Draw the states nobody drew** — loading, error, permission-denied, cold start, narrow, and
   the `both` seller.

### 1.2 · Four things the packages get wrong about this repository

**1 · The goods package omits the services canvas, and that omission is load-bearing.** It says
the 28 `-s` boards *"live on a separate canvas and are not in this package"* and nothing else. A
reader of that package alone cannot tell that half the directory sells by the job, that 26 of
those boards are in production, or that `/onboarding/kind` — a live screen in every seller's
critical path — has a board. §1.3 is what that cost.

**2 · Both packages re-propose the storefront builder, which was deleted on purpose.** The goods
package ships 5a–5h as eight first-handoff boards; the services package ships `5c-s` at
`/builder/sections`. The history:

| Commit | What went |
|---|---|
| `a5d129e2` (#180, 13 Sep) | `5c-s` **shipped** — 56 files, +4,080/−198, as a *staff* library at `/admin/storefront-templates/:id/sections`, not the handoff's seller route |
| `8ebfe9f1` (#214, 15 Sep) | the builder removed — 134 files, **+400/−12,557** |
| `29d341df` (#215) | five storefront-template tables dropped |
| `ebb4e054` (#216) | `business.theme_preset` and `business.theme_hex` dropped |

The drops were split from the code removal deliberately, because dropping a column under a client
that still declares it *"returns 500 on every storefront"*. Production held 2 seeded templates, 16
sections, **0 seller content rows and 0 audit rows naming a template** — nothing a person had
authored. The cut also closed two live defects: the landline reveal was returning team members'
private numbers, and Industrial storefronts were showing buyers seller-facing placeholders.

The services package asks to *"reconcile"* `5c` listing *Services & packages* as *Coming soon*
against `5c-s` existing. That placeholder was removed **by `5c-s` itself** — `a5d129e2` deleted
`components/storefront/Services.tsx` and stripped ten `comingSoon` occurrences. The only matches
left in the tree are three prose lines in `docs/services-build-plan.md`.

**Recommendation: keep the builder cut.** Two artefacts from `5c-s` survive and are load-bearing —
`components/domain/service-views.ts` and the paired-string layer. Take exactly one more thing out
of the eight-plus-one boards: a certifications block on the fixed overview, which is §1.4.

**3 · The services package calls a cut board "the most urgent gap in the track".** Its README says
section S5 names eight boards including `6g-s` — the copy-drift audit — and that only seven exist.
Both halves were cut **14 Sep 2026, unbuilt** (`docs/build-plan.md:728-731`,
`docs/services-build-plan.md:1781-1782`). The package contradicts itself: the `12g-s` spec,
written a day *after* the cut, records it as cut and converts it into an open question.

Is copy drift detectable today? **Partly.** A missing half is counted, a bad placeholder and a
banned pivot word are refused at save (`lib/i18n/paired-value.ts:21-32`), and every consumer is
held to reading its key. A *wrong* twin is not — and `scripts/check-vocabulary.sh:10` reads
`lib/i18n/en.ts` alone, so `string_entry` rows are invisible to CI and a rule tightened later
never re-checks an existing row. **Recommendation: close `6g-s` as a CI change and a table column,
not a screen.** The registry holds twelve pairs; a human reading both halves of twelve pairs is an
hour's work, and the structural half is a `check:vocabulary` change.

**4 · The services package ships a 4 Sep audit board as context, and four of its six recorded
decisions have since been reversed.** `source/Service Track Audit.dc.html` classifies all 95
boards by fork need, and `TASK-1-GAP-ANALYSIS.md` instructs the designer to compare against it.

| The audit board records | The repo does |
|---|---|
| ✓ settled: *"One `catalogue_item` with `kind = product \| service`"* | a separate `model Service` (`prisma/schema.prisma:2412`) |
| ✓ settled: *"Business carries `offering_type`"* | `enum SellsKind` on the business **plus** `Category.tradeKind` per subcategory — and `schema.prisma:763` names `offering_type` as *"the mistake"* |
| ✓ settled: *"Copy swaps hard-coded per screen. No string table"* | `12g-s` shipped a paired-string registry at `/admin/strings/paired` |
| Open Q1: where does the kind come from? | answered — declared by the seller on `2b-s`, per subcategory on `4d-s` |
| Open Q2: blended results, or a Products/Services tab pair? | answered — blended by default with kind badges (`cfa512aa`, `ed11018d`) |
| Credentials at **20 pts** | **32 pts**, and for a stated reason — `32 + 20 + 12 + 8 + 4 + 4 = 80`, exactly `STRONG_ENOUGH`, so a practice that finishes every task it *can* finish lands on the bar with nothing unnamed left (`docs/services-build-plan.md` §4h). A test pins it. The package's own README also says 32. |

Only the done-condition (three services) and the site-visit cut survive. **The audit board should
be withdrawn from the package**, or stamped with the reversals. Its one enduring contribution is
the fork classification in §1.5, which is still the best map of which goods boards need a services
sibling.

### 1.3 · A correction to the first version of this document

The first version said `/onboarding/kind` was *"built, live, in the critical path of every new
seller, and covered by no board on either canvas"*, logged it as gap G42, and commissioned prompt
P-19 to draw it.

**That was wrong. `2b-s` is that board.** Its render carries the licence-evidence card quoting
three activity codes verbatim, the three options with three bullets each, the `MATCHES YOUR
LICENCE` badge sitting on the licence's answer rather than the seller's selection, a *What this
answer decides* list over setup / dashboard / storefront / enquiries, and a *CHANGEABLE, BUT NOT
FREE* cost card. That is P-19's entire brief, already drawn. The board is labelled **NOT IN THE
AUDIT** because it was added after 4 Sep.

**P-19 is withdrawn and build-plan task T12.2 is deleted.** The cause is §1.2's first item: the
goods package omits the services canvas, so a board that exists reads as missing. It is the
cheapest possible demonstration of why the two packages must travel together.

### 1.4 · Credentials and certificates are two different objects

Two agents reached opposite conclusions about whether a Free services firm's storefront shows its
credentials. Both were right, about different things, and the code states the distinction at
`app/(public)/b/[slug]/_services.tsx:419-423`:

- **Credentials** — an FTA agent number, PI insurance, a professional accreditation. A trust line
  whose file never travels. Rendered on **every plan**, on `/b/[slug]` via `CredentialsSection`
  (`page.tsx:723`) and on `/b/[slug]/credentials`. The reasoning is written down: non-negotiable 2
  says trust signals render identically on every storefront, and *"gating them on a plan would
  make who checked it something a firm buys."*
- **Certificates** — the documents section on board 1d, a paid feature. A different object. After
  the builder cut they render on **no** public surface, while `/dashboard/verification` still tells
  sellers they *"can be shown on your storefront"*.

So the free-plan storefront is sound, and the certificates gap is real, is `8ebfe9f1`'s own open
question, and has been open since 15 Sep. It is the one piece worth taking out of the cut builder.

### 1.5 · The fork classification, as it stands today

From the audit board's 95-row table, updated against the tree. 27 boards were classified **new
variant**; 26 of those shipped. The exceptions:

- **`3e-s`** (verification & documents → *"credential register with expiry tracking"*) was
  classified a variant and a Tier-2 board and **never drawn**. Its function shipped anyway, inside
  board 3e: `/dashboard/verification` is the credentials surface, with lapsed, `daysLeft` and
  `validUntil` states (`docs/services-build-plan.md` §4h — *"`8b-s` is largely built, and is
  called `3e`"*). So this is an undrawn board rather than an unbuilt one.
- **`2b-s`** and **`7c-s`** were *not* classified variants — `2b` reads unaffected and `7c` reads
  copy-swap — and both shipped as full variants. The classification was wrong in the safe
  direction.
- **`11d`** was classified `N/A` with the note *"nobody imports four services; suppress the entry
  point for services-only"*. The entry point was dropped with Products in
  `nav-config.ts:404-425`, the importer writes only Product-family rows, and there is no CSV path
  on the services list. Correctly done.

The audit's remaining ~30 **copy swap** rows are `12g-s`'s scope: the paired-string registry is
where they live. Twelve pairs are registered today, and the goods package's own `12g` board says
27 of 34 templates need a services twin — so the registry is materially short of what the boards
assume, and nothing in the tree reports the gap since `6g-s` was cut.

---

## 2 · Board matrix

`BUILT` = route, model, service, tests, and the screen does its job end to end. `PARTIAL` = real
work landed; a named control, state, writer or gate is absent. `SCAFFOLD` = a route or a model
exists and the feature behind it does not. `CUT` = removed on purpose. The render axis:
`STALE` = the code is newer and right · `NEWER` = the render asks for something real that is
missing · `AGREED`.

### 2.1 · Goods canvas (102 boards)

Unchanged from the first version of this document except where noted. Only the rows carrying a
`BLOCKS` severity or a correction are repeated here; the full table is in git history at the
previous revision of this file.

**Blocks launch:**

| Board | Route | Verdict | The gap |
|---|---|---|---|
| 1a | `app/(public)/page.tsx` | BUILT | `lib/i18n/en.ts:4070` sells a verification tier cut on 5 Sep, on the homepage cold-start panel |
| 1l | `pricing/page.tsx` | STALE | render draws **AED 0/99/299**; ratified is **0/349/899** (`prisma/seed-data.mts:13-15`) |
| 1o | — | **ABSENT** | complete tested engine, zero UI, no refusal copy |
| 3n | — | **ABSENT** | whole backend shipped; `leads/actions.ts:133` carries the field with *"Absent from a composer that does not offer it yet"* |
| 7g | — | **ABSENT** | nothing reads `notification_delivery` |
| 7h | `account/company/approvals/[id]/page.tsx` | PARTIAL | `RequestSplitPart[]` computed at `queue.ts:381`, rendered by nothing; `request-words.ts:153` never consults `card.split` |
| 7e | `dashboard/settings/page.tsx` | PARTIAL | 8 rows against 16 seller events, and Save rebuilds the matrix from the rows it shows |
| 7a | `(auth)/signin/page.tsx` | BUILT | no carrier — phone OTP throws in production, SMTP unset |
| 2a | `onboarding/claim/page.tsx` | PARTIAL | `ClaimResults.tsx:147` prints `tradeName` on **claimed** rows |
| 2d | `onboarding/locations/page.tsx` | BUILT | see §2.3 — the route divergence is correct; the `both` body is the real gap |
| 8e | `dashboard/setup/done/page.tsx` | BUILT | **unreachable on Free**, and not kind-aware |
| 3m | `dashboard/billing/page.tsx` | PARTIAL | no failed-payment state at all |
| 11g | `dashboard/billing/invoice/[id]/page.tsx` | BUILT | issuer holds no TRN (`tax-invoice.ts:43`) |
| 11h · 11j | `dashboard/billing/cancel/**` | PARTIAL | `cancellation.ts:478` dates from `renewsAt`; `:494` writes `active` over `past_due`; render says *"not refunded"* |
| 4a · 4g | `admin/page.tsx` · `admin/revenue/page.tsx` | BUILT | every render signed in as ops lead, including Revenue, which `revenue.read` makes finance-only |
| 4e | `admin/spec-library/page.tsx` | PARTIAL | all 7 actions `throw new Error`, one an untranslated English string — **goods half only**, see §2.2 |
| 4f | `admin/businesses/page.tsx` | BUILT | no capability gate on the screen or its 22-column CSV export |
| 10g | `b/[slug]/page.tsx` (variant) | PARTIAL | held enquiry undrawn; `RecipientState` has no `held`, and 2a, 2b and 4c already print numbers that depend on it |
| 12a | `admin/ingest/page.tsx` | BUILT | cannot accept a 40,000-row file |
| 12f | `admin/support/page.tsx` | PARTIAL | a session left to expire never ends, and the next start fails on the one-live-session index |
| 12g | `admin/notifications/page.tsx` | PARTIAL | an event with no template has no way in |
| 12i | `admin/dunning/page.tsx` | PARTIAL | cannot say whether anything it did reached anyone |
| 13h | `(legal)/cookies/page.tsx` | STALE | publishes four untruths; the register's own test says so |
| 13i | `(legal)/verification-policy/page.tsx` | SCAFFOLD | names four tiers the DB `CHECK` forbids |

**Corrections to the first version:** G42 overstated — see §1.3. `5a`–`5h` remain CUT. `12j`
remains DO-NOT-BUILD.

### 2.2 · Services canvas (28 boards)

| Board | Handoff route | Actual route | Verdict | Render | The gap | Sev |
|---|---|---|---|---|---|---|
| 2b-s | `/onboarding/kind` | `app/(onboarding)/onboarding/kind/page.tsx` | BUILT | AGREED | two copy strings contradict each other and a third promises a re-ask nothing performs | DEGRADES |
| 2c-s | `/onboarding/profile` | `app/(onboarding)/onboarding/profile/page.tsx` | PARTIAL | STALE | **the strength meter measures a practice on the goods table** | **BLOCKS** |
| 2d-s | `/onboarding/coverage` | `app/(onboarding)/onboarding/locations/page.tsx` | BUILT | STALE | one route, two bodies — correct; the `both` body is undrawn; publish-gate refusals are raw English | DEGRADES |
| 8a-s | `/dashboard/setup` | `app/(dashboard)/dashboard/setup/page.tsx` | BUILT | STALE | the Free team card promises 8 points for work the platform refuses | DEGRADES |
| 8b-s | `/dashboard/setup/credentials` | `app/(dashboard)/dashboard/setup/credentials/page.tsx` | BUILT | STALE | `WE VERIFY THIS` gated on `registerLive`, suppressed in every deployment | POLISH |
| 8c-s | `/dashboard/setup/services` | `app/(dashboard)/dashboard/setup/services/page.tsx` | BUILT | STALE | render draws D11's availability column, closed as *no* on 11 Sep | DEGRADES |
| 3b-s | `/dashboard/profile` | `app/(dashboard)/dashboard/listing/page.tsx` | BUILT | STALE | render draws `11–25 people`; the live enum produces `11–50`; missing from `docs/routes.md` | DEGRADES |
| 1d-s | `/b/:slug` | `app/(public)/b/[slug]/page.tsx` | BUILT | STALE | render carries `Accepting new clients`; no `both` overview coverage statement | DEGRADES |
| 1e-s | `/b/:slug/services` | `app/(public)/b/[slug]/services/page.tsx` | BUILT | STALE | render carries `Join the waitlist` and *at capacity* | DEGRADES |
| 1g-s | `/b/:slug/s/:service` | `app/(public)/b/[slug]/s/[service]/page.tsx` | BUILT | STALE | B9's comparison instrument unbuilt; two orphan strings describe it | DEGRADES |
| 1f-s | `/b/:slug/coverage` | `app/(public)/b/[slug]/coverage/page.tsx` | BUILT | STALE | `deliveredWhere` is one value; remote **and** on-site cannot be stated | DEGRADES |
| 1c-s | `/search?q=…` | `app/(public)/search/page.tsx` | BUILT | STALE | render carries `✓ OFFICE VISITED`; superseded by `10c-s` — see §2.4 | DEGRADES |
| 10c-s | `/search?q=chiller` | `app/(public)/search/page.tsx` | BUILT | AGREED | `?bounds=` and wordless queries route to the goods path and say nothing about it | DEGRADES |
| 6a-s | `/vat-consultants-in-business-bay` | `app/(public)/[emirate]/[area]/[category]/page.tsx` | BUILT | STALE | **zero live today**; 1,267 addressable URLs behind one nullable column with no rollout policy | DEGRADES |
| 1h-s | `/rfq/new` | `app/(public)/rfq/new/page.tsx` | BUILT | AGREED | recipient cap is 8 where the design asked 5 — owner's one-line call | POLISH |
| 3j-s | `/dashboard/enquiries/:id` | `app/(dashboard)/dashboard/leads/[id]/page.tsx` | BUILT | STALE | **the handoff route 404s with no redirect** while both its siblings got one | DEGRADES |
| 1n-s | `/account/rfq/:id` | `app/(public)/enquiry/[id]/compare/page.tsx` | BUILT | AGREED | **the footing computes 4 of 19 authored bases** — see §2.5 | **BLOCKS** |
| 7c-s | `/account/enquiries/:id/accepted` | `app/(public)/enquiry/[id]/accepted/page.tsx` | BUILT | AGREED | no seller-side mirror of the won proposal; review form asks a goods question | DEGRADES |
| 3g-s | `/dashboard/services/:id` | `app/(dashboard)/dashboard/services/[id]/page.tsx` | BUILT | STALE | completeness has two real consequences and the editor states neither; no gallery story | DEGRADES |
| 3f-s | `/dashboard/services` | `app/(dashboard)/dashboard/services/page.tsx` | BUILT | STALE | `services.eyebrow` reads *Catalogue*; no gallery story | DEGRADES |
| 3c-s | `/dashboard/coverage` | `app/(dashboard)/dashboard/coverage/page.tsx` | BUILT | STALE | no gallery story | POLISH |
| 3h-s | `/dashboard/scope-templates` | `app/(dashboard)/dashboard/scope-templates/page.tsx` | BUILT | AGREED | — | — |
| 4d-s | `/admin/categories` | `app/(admin)/admin/categories/page.tsx` | BUILT | STALE | 83 rows classified by migration with no audit row, so `SET BY` is blank | POLISH |
| 4c-s | `/admin/queue/:id` | `app/(admin)/admin/queue/credential/[id]/page.tsx` | BUILT | AGREED | register dormant (`FTA_REGISTER_URL=""`); the *name near-match* state undrawn; `refetchRegister` outside the fence | DEGRADES |
| 4e-s | `/admin/spec-library` | `app/(admin)/admin/spec-library/page.tsx` | BUILT | STALE | *"39 subcategories"* is three weeks stale — see §2.6; the tab 404s for a moderator | DEGRADES |
| 12c-s | `/admin/search` | `app/(admin)/admin/search/page.tsx` | BUILT | AGREED | **no row seeded, so the services vector is unpublished**; a services firm scores half on the goods vector | **BLOCKS** |
| 12g-s | `/admin/strings` | `app/(admin)/admin/strings/paired/page.tsx` | BUILT | AGREED | 12 pairs registered against 27 of 34 templates the goods board assumes; no drift column | DEGRADES |
| 5c-s | `/builder/sections` | — | **CUT** | — | shipped 13 Sep, cut 15 Sep with the builder | — |

### 2.3 · The two route divergences, settled

The services package headers name `/onboarding/coverage` and `/dashboard/profile`. The repo serves
`/onboarding/locations` and `/dashboard/listing`, each as one route with two bodies branched on
`sellsKind`. **The repo is right, and the package contradicts itself:** its own bundled
`context/routes.md` lists `/onboarding/locations` and `/dashboard/listing`. Decisively, `2d-s`'s
own B1 and AC1 are only satisfiable on one route.

The real cost is three small things, not the twenty-pin-criteria problem the first version of this
document inferred: the page branches before it loads anything, `goLive` asks a different question
by kind, and `3b-s` is missing from `docs/routes.md` entirely.

`3j-s`'s divergence is different and is a defect: `/dashboard/enquiries/:id` **404s**, while
`next.config.ts:35-39` redirects `/account/rfq/:id` and `/account/enquiries/:id/accepted` for
`1n-s` and `7c-s`. One line closes it.

### 2.4 · `1c-s` and `10c-s` are one screen

Same route, same loader, same components. `10c-s`'s own spec is a joint `10c`+`10c-s` document
whose §D1 resolves the two tab models in `10c-s`'s favour, and `ed11018d` (#220) shipped that over
`1c-s`'s earlier three-way partition. **Hold the build to `10c-s` and retire `1c-s` as a separate
board.** `1c-s`'s render additionally carries `✓ OFFICE VISITED`, a tier cut on 5 Sep.

The blended path is sound where it runs: traced `matches` → `applyFilters` →
`tabCounts`/`facetRail`/`narrow`, every count on the page derives from one array, and it does
**not** share the goods path's 200-candidate pagination defect — it reads 1,000 per kind with a
deterministic `orderBy`, pages over the full ranked set and clamps.

But `lib/search/blended.ts:913` sends `?bounds=` to the goods path, and `:908` sends wordless
queries there too. Both are documented decisions with reasons — a map box is a browse, and a
service firm with one office covering seven emirates cannot be represented by a pin. The buyer is
simply never told. **One sentence on the map composition closes it; the deeper question of whether
coverage can be drawn as an area union is a real design problem and probably a `12h` dependency.**

### 2.5 · The footing computes four of nineteen fee bases

This is the sharpest defect in the services track and it is in the screen the whole lane builds
toward.

`lib/quote/proposal-footing.ts:130-170` switches on exactly four bases — `per_month`, `per_visit`,
`per_sqft_yr`, `fixed_fee` — and everything else falls to
`default: { kind: "not_computable", reason: "unknown_volume" }`. The taxonomy authors **nineteen**
distinct keys across six families; the seed carries `per_hour`, `per_return`, `retainer` and
`monthly` among them.

Three of the four bases the services README names as the headline problem — **day rate, retainer,
percentage** — are all in the fifteen that cannot be computed. The two that can,
`per_visit` and `per_sqft_yr`, live only on the two maintenance-shaped families. So for an audit,
VAT or legal brief the *Over 12 months* row — the page's entire instrument — renders all-cannot.

There are three layers disagreeing about closure: `String?` at the column
(`prisma/schema.prisma:2437`), closed per family at the write (`lib/services/service.ts:518-537`,
`foreign_fee_basis`), and closed to four literals at the footing. **Recommendation:** keep the open
set, keep the write-time closure, and delete the third layer by putting `unit` and `monthsPerUnit`
on `ScopeSheetFeeBasis`, so a staff-authored basis cannot silently become un-comparable.

Nothing totals across bases — verified across eight readers. The one leak is
`lib/placement/impact.ts:114-138`, which counts an accepted proposal as a win worth AED 0.

### 2.6 · Two numbers in the packages that are stale

- **`4e-s`'s "39 of 39 services subcategories"**. Migration `20261009090000_classify_trade_kinds`
  classified 13 sectors plus 70 exceptions and assigned a family to every resulting services leaf.
  The migration post-dates the passage in `docs/services-build-plan.md:1228` that says 39 of 440.
  Five families is right; the render's seven trades count one level up, because audit, VAT, legal,
  marketing and recruitment all land on `professional-services`. *I have not counted rows in a live
  database; this rests on the migration's content and its date.*
- **`6a-s` "roughly doubles the 6f matrix"** understates it. `resolveEmirateScope` opens the
  emirate class to the services subcategories, taking the addressable set from 84 to roughly
  **1,267** URLs. Zero are live: every services category has `servicesLandingOpenedAt` null
  (`prisma/schema.prisma:996`), and the only brake is that nullable column with no policy behind
  it.

---

## 3 · The gap register

Ordered by what it costs. `S` ≤ half a day · `M` ≤ 2 days · `L` ≤ 1 week · `XL` > 1 week.
Goods gaps keep their original ids `G1`–`G50`. Services gaps are `S1`–`S22`.

### 3.1 · Blocks launch — honesty defects in live copy

| # | The failure | Evidence | Size |
|---|---|---|---|
| G1 | Homepage cold-start panel sells a verification tier cut on 5 Sep | `lib/i18n/en.ts:4070` → `RfqPanel.tsx:153`; `lib/verification.ts:67` caps at 2 | S |
| G2 | `/pricing` and `/onboarding/plan` quote AED 99/299 against ratified 349/899 | `prisma/seed-data.mts:13-15` | M |
| G3 | `/cookies` publishes a banner, a settings screen, a withdrawal and GPC — none built | `lib/legal/cookie-register.test.ts:16` asserts it | M→L |
| G4 | `/verification-policy` names four tiers the DB `CHECK` forbids | `business_verification_tier_range` is `BETWEEN 0 AND 2` | S + design |
| G5 | `/review-policy` disagrees with the code on five points | `docs/design-exports.md` §13i | S |
| G6 | 2a prints the legal trade name on **claimed** rows | `ClaimResults.tsx:147` vs `claim.ts:138` | S |
| G7 | 1n tells a buyer *"You accept one supplier per enquiry"* | `lib/i18n/en.ts:5207`, false since `8815989` | S |
| G8 | 3m tells a seller to *"Reply to the email we sent"*; no email is sent | `lib/i18n/en.ts:8764`; staff twin at `:11213` | S |
| G9 | 3h tells sellers the CSV importer *"is not built yet"*; 11d shipped | `templates/[slug]/page.tsx:233` | S |
| G10 | 6f tells ops that board 12d *"is not built"* | `lib/crm/derive.ts:202` consumes those rows | S |
| **S1** | `/onboarding/kind` **contradicts itself**: switching *"rewrites your catalogue — nothing carries across"* against *"Nothing you have entered is converted or deleted"* | `lib/i18n/en.ts:9432` vs `:9443` | S |
| **S2** | `/onboarding/kind` promises *"we will ask again rather than quietly override you"* and **nothing re-asks** | `lib/i18n/en.ts:9433`; no `sellsKind` reader in `lib/onboarding/categories.ts` or `lib/moderation/service.ts` | S + design |
| **S3** | `/dashboard/verification` tells sellers certificates *"can be shown on your storefront"*; after the builder cut they render on no public surface | §1.4 | S |
| **S4** | `seo.business_description` promises a services firm's *"branches and catalogue"* in its meta description | no `sellsKind` branch at `b/[slug]/page.tsx:130` | S |
| **S5** | `services.eyebrow` reads *Catalogue* and `coverage_step.group_branches` reads *"Where your stock sits"* — to service firms | `lib/i18n/en.ts` | S |
| **S6** | Two orphan `service_public.compare_*` strings describe a surface that does not exist | `1g-s` B9 unbuilt | S |

### 3.2 · Blocks launch — a screen the backend is waiting for

| # | The failure | Size |
|---|---|---|
| G11 | **`3n` does not exist**, so `allowsPartial` is false on every row ever written, every branch of `lib/quote/split.ts` is dead, and `1o` and `7h` have nothing to render | design S, build M |
| G12 | **`1o` has no selection screen** and no refusal copy at all | design M, build L |
| G13 | **`7h` renders one supplier**, and `request-words.ts:153` never consults `card.split` | design M, build M |
| G14 | **`7g` does not exist**, so *"in app is locked on"* means *"written to a table nobody opens"* | design L, build L |

### 3.3 · Blocks launch — services

| # | The failure | Evidence | Size |
|---|---|---|---|
| **S7** | **`2c-s`'s strength meter measures a practice on the goods weight table.** `profileStrength(facts)` and `strengthItems(facts)` are called with no kind, and `sellsKind` is never selected in the file. A tax practice reads *"Add your first products"* and *"Fill in product specifications"* in its own meter, caps at 65, and sees a different number on `/dashboard/setup`. It loads every services fact at the cost of five queries and discards them | `lib/onboarding/profile.ts:158-159`; `lib/metrics/profile-strength.ts:185` has `weightsFor(kind)` | S |
| **S8** | **The footing computes 4 of 19 fee bases**, so the professional-services comparison row renders all-cannot — §2.5 | `lib/quote/proposal-footing.ts:130-170` | M |
| **S9** | **The services ranking vector is unpublished** — no row seeded and nobody has pressed publish — and on the goods vector a services firm's null spec completeness scores as *half*, 6 of 12 points, stuck | `lib/search/ranking.ts:417-420`; the gate at `lib/search/settings.ts:641-651` returns `[]`, so nothing is refused | M |
| **S10** | **The Free setup deadlock is in the services task set too, and worse.** `SERVICES_TARGETS` overrides only `photos`, so `team: 2` governs a practice; a Free practice's ceiling is **72**, not the goods case's 90 | `lib/setup/tasks.ts:139`, `:162`; `lib/team/service.ts:219` | S |
| **S11** | **`servicesOffered` is written only by onboarding and is the sole input to `8c-s`'s sheet matching.** The dashboard deliberately does not draw it, so a firm that mistypes it never gets a `MATCHES YOUR SERVICES` badge again — the exact failure `2c-s`'s spec names in bold | `lib/services/setup.ts:194` | S |

### 3.4 · Blocks launch — the notification engine, money, scale, governance

Unchanged from the first version: **G15**–**G39**. Summarised, because they remain the critical
path:

- **Notifications.** `lib/notify/service.ts:103` returns `[]` for a business with no preference
  row, so every imported business is deaf on every channel and `PLATFORM_FLOOR` is never reached
  (G15). `payment_failed` and `payment_final_notice` do not exist (G16). 7e's Save deletes routing
  it does not render (G17). 12g cannot write a first version (G18). In-app stores no message text
  (G19). Queued notifications drain at 200/hour (G20). SMS has no carrier (G21).
- **Money.** No payment provider and no card-capture board anywhere (G22). The invoice is not a
  UAE tax invoice (G23). `changePlan` skips the `provider.live` check (G24). Past-due cancellation
  dates from `renewsAt` and clears `past_due` (G25). No e2e (G26).
- **Scale.** Pagination is a lie above 200 matches (G27). One flat sitemap (G28). The importer
  cannot take the file (G29). `revalidate` is inert where it matters (G30). `MAX_LISTINGS = 20_000`
  (G31). Auth-user paging gives up at 4,000 (G32). Enquiry creation is unauthenticated, unrated and
  mints an auth user (G33).
- **Governance.** `check:audit` is not in CI (G34). No error tracking, alerting or documented
  backups (G35). `/admin/businesses` ungated (G36). 4e throws untranslated (G37). View-as expiry
  locks a staff member out (G38). Phone sign-in off end to end (G39).

**New, and services-adjacent:**

| # | The failure | Evidence | Size |
|---|---|---|---|
| **S12** | `refetchRegister` writes with a bare `prisma.credential.updateMany` — capability asserted, no fence, no audit row, no reason. `check:audit` is a per-module scan and structurally cannot see it | `lib/credentials/review.ts:251-262` | S |
| **S13** | `scripts/check-vocabulary.sh:10` reads `lib/i18n/en.ts` alone, so every string held in `string_entry` is invisible to CI — which is the gap `6g-s` was going to cover before it was cut | — | S |
| **S14** | `/admin/spec-library` 404s for a moderator while `/admin/categories` was widened to `taxonomy.read` with an e2e asserting read-only. The same seat, two answers | `docs/services-build-plan.md` §4c is stale here | S |

### 3.5 · Degrades — the biggest of them

Goods: **G40**–**G50** unchanged, with G42 corrected per §1.3 — the kind fork is drawn (`2b-s`),
so what remains of that gap is 2d's `both` body, 8e's kind-awareness and 3d's services answer.

Services:

| # | The failure | Size |
|---|---|---|
| **S15** | **No `8e-s`.** The terminal state of the entire services setup funnel has never been designed: the shipped screen draws four pips over three goods ticks, and `setup_done.changes_products` has no services equivalent | design M |
| **S16** | **The `both` seller is undrawn everywhere.** `2d-s`'s `both` body (branch list *and* coverage, grouped, neither behind a toggle), the `both` storefront overview — where a firm selling valves from a depot and AMC across four emirates has one page and two shapes of truth, and the overview tells only the depot half — and the `both` completion screen | design L |
| **S17** | **`6a-s` has no rollout policy.** 1,267 addressable URLs, zero live, one nullable column, no rule for how many trades open at once, on what evidence, with what rollback | decision + M |
| **S18** | **The area weight does not exist.** Three readers filter on area and none weighs it, so a seller who named Business Bay ranks level with one who ticked *anywhere in Dubai* — which teaches sellers to over-claim | decision + M |
| **S19** | **`deliveredWhere` is one value.** A service delivered remotely **and** on site is ordinary in facilities and freight and cannot be stated | M + migration |
| **S20** | **No seller-side mirror of a won proposal.** The winning supplier has no screen for the thing they won | design M |
| **S21** | **The review form asks a goods question** at the terminal state of the services chain — *"It arrived when they said"* | S |
| **S22** | **No gallery story for `3g-s`, `3f-s` or `3c-s`** — twenty-one documented states, on the three screens that write the record the other four read | M |

---

## 4 · Decisions only you can make

`N1`–`N15` from the first version stand, with one correction: **N-for-`/onboarding/kind` is
withdrawn** — the board exists. Services decisions are `N16`–`N25`.

| # | Decision | Recommendation |
|---|---|---|
| **N1** | The storefront builder: re-open or stay cut? | **Stay cut**, both canvases. Take one piece out: a certifications block on the fixed overview (§1.4). |
| **N2** | Who reads the revenue board? | Add a `revenue.read` row for ops lead. An ops lead who cannot see MRR cannot run the morning 4a is built for. |
| **N3** | Tier 1 is called *Claimed* and nothing sets it on a claim | Either the expiry sweep drops an unclaimed listing to 0, or tier 1 gets a label that is not about a claim. |
| **N4** | Which single number is listing health? | Ratify one. **Note:** services already has exactly one table (32/20/20/12/8/4/4 = 100, read through `weightsFor(kind)`), so the four-table problem is a goods problem only — fix goods to match the services shape. |
| **N5** | 3a: build the render, or ratify the code? | Ratify the code's shape and redraw. |
| **N6** | Free's service cap (`2e-s`) | **Three**, matching `8c-s`'s done-condition and the seed's `serviceLimit: 3`. Still *proposed, not ratified* — ratify it. |
| **N7** | Saved requirements: draw or delete? | Delete for launch. |
| **N8** | Does `ApiKey` survive? | Drop the table and the 12h API panel. |
| **N9** | Who issues the invoice, and under what TRN? | **Answered 10 Nov 2026:** Bearing Deployment Company, Inc, Delaware, operating from the US, no TRN. Leaves spec Q3 — the VAT treatment — for a tax advisor. |
| **N10** | SMS: carrier or retire? | Retire for launch. |
| **N11** | Support desk: build or buy? | Buy. Design the integration surface, not a helpdesk. |
| **N12** | The attribute dictionary | Hold D3's *no*. Strike the nav item, the button and the promotion path. |
| **N13** | 6a's quote-range row | Leave it off. |
| **N14** | Does the 6f publish floor count borrowed listings? | Take the list's predicate — primary **or** additional. |
| **N15** | 12f's business picker | Search-as-you-type. |
| **N16** | **The fee-basis set: open or closed?** | **Keep it open, closed at the write, and delete the third layer** — put `unit` and `monthsPerUnit` on `ScopeSheetFeeBasis` so a staff-authored basis cannot silently become un-footable (§2.5). This is the single most consequential services decision. |
| **N17** | **What does `1n-s` show when no column can be footed?** | A stated basis-by-basis table with no normalisation row at all, rather than a headline row of apologies. It is the common case outside facilities management. |
| **N18** | **`6a-s`'s rollout policy** | Open one trade per emirate per week, gated on the publish floor *and* on a written intro, with the nullable column as the rollback. 1,267 URLs is not a launch surface. |
| **N19** | **The area weight** | Give the brief matcher and `12c`'s locality term a real number, set on `12c-s`. Until then the product rewards over-claiming. |
| **N20** | **Team-size bands for a practice** | Keep the five existing bands and correct the renders. A migration over 123 live rows for a finer band set has no stated gain. |
| **N21** | **Does switching kind convert anything?** | Nothing is converted — so `kind.cost_body` is the string that is wrong, not `kind.settings_keeps`. Rewrite it to say what actually happens: the other kind's fields sit empty. |
| **N22** | **Who answers the disagreement question?** | `/onboarding/profile`. `2b-s` B4 assigns it there, `2c-s` has no state for it, and `3b-s` draws a statement rather than a question. One state closes a promise the product currently breaks. |
| **N23** | **Per-service reviews** | Not for launch. `Review` has no service column and the reviews boards do not know a service exists. Decide before adding the column, not after. |
| **N24** | **`deliveredWhere` as a set** | Yes, but after launch. It is a `3g-s` change with `1f-s` and `1c-s` facet consequences. |
| **N25** | **`6g-s`: board or CI change?** | **CI change plus a table column.** Twelve pairs; the structural half is a `check:vocabulary` change (S13), the judgement half is an hour of reading. |

---

## 5 · What both packages should be told

Send this back with the next handoff so the packages stop re-proposing cut work and stop
contradicting each other.

### Both packages

1. **5a, 5b, 5c, 5d, 5f, 5g, 5h and 5c-s are cut.** Retire the boards. Keep 5e as a seller screen
   at `/dashboard/domain`.
2. **12j is cut** — approved decision, no resend control. **6g-s is cut** — 14 Sep, unbuilt; it
   returns as a CI change and a table column, not a board.
3. **10j is superseded** by 13b–13h.
4. **Plan prices are AED 0 / 349 / 899**, and the caps are in `prisma/seed-data.mts:13-15`. Every
   board quoting a price or a cap reads that row.
5. **The acceptance viewport is 1280 × 720**, and seller screens are also drawn at 375px. Every
   render in both packages is 1440px, and **not one services board has a narrow layout**.
6. **Roughly forty renders are older than the code.** The rule *"the render is the latest truth"*
   needs an exception list; §2 of this document is it.

### The goods package specifically

7. **Ship it with the services canvas, or not at all.** Its omission caused §1.3's wrong finding.
   Every goods board that forks on kind needs its `-s` sibling in the same folder.
8. **`shared/foundation/permissions.md` §1 must drop both storefront-template rows and the
   theme-preset row.**
9. **`shared/source-specs/pre-flight.md` must say "Ask for a quote"**, not `Enquire`. One string,
   `listing.enquire`, since 16 Sep 2026.
10. **`routes.md` must drop `/admin/attributes`** (D3 = no) and correct
    `/dashboard/invoice/:id` → `/dashboard/billing/invoice/[id]`.

### The services package specifically

11. **Withdraw `source/Service Track Audit.dc.html`, or stamp it.** It is dated 4 Sep and four of
    its six recorded decisions have been reversed (§1.2.4). `TASK-1` currently instructs the
    designer to classify fork coverage against it.
12. **D11 was closed as *no* on 11 Sep.** There is no services availability enum and there should
    not be one. Four renders draw one: `8c-s`, `1d-s` (*Accepting new clients*), `1e-s` (*Join the
    waitlist*, *at capacity*) and the facet rail. Remove it.
13. **The site-visit tier was cut on 5 Sep.** `1c-s`'s render carries `✓ OFFICE VISITED`.
14. **Correct the board routes** to `/onboarding/locations`, `/dashboard/listing` and
    `/dashboard/leads/:id`. The package's own bundled `context/routes.md` already has the first
    two right.
15. **`1c-s` is retired into `10c-s`** — one screen, and `10c-s`'s spec already resolves the two
    tab models in its own favour (§2.4).
16. **Credentials at 32 pts, not 20**, and the arithmetic is the reason: `32 + 20 + 12 + 8 + 4 + 4
    = 80`, exactly `STRONG_ENOUGH`. The package README already says 32; the audit board says 20.
17. **`3e-s` was never drawn.** Its function shipped inside board 3e. Either draw the services
    shape of `/dashboard/verification`, or record that 3e serves both kinds.
18. **`8e-s` does not exist and is owed** — the terminal state of the whole track.
19. **`4e-s`'s "39 subcategories" is stale**; the classification migration took it to the services
    leaves of 13 sectors plus 70 exceptions (§2.6).
20. **`6a-s` is ~14× the 6f matrix, not 2×** — about 1,267 addressable URLs, zero live.
