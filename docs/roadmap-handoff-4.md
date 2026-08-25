# Handoff 4 — superadmin console: roadmap

The machinery that keeps a 41,000-listing marketplace honest and growing. Six jobs: get
listings in, keep the data comparable, build what sellers fill, grow and keep accounts, take
the money, protect the trust.

Source: `handoffs/handoff-4-superadmin/README.md` and `KICKOFF.md`. Thirty-one routes, twelve
acceptance criteria, no new components claimed.

This roadmap is written against an audit of the repo as it stands at `49612e1`, not against
what the handoff assumes. Where the two disagree, §1 says so.

---

## 0. What needs deciding before I start

The KICKOFF says to stop and ask rather than pick. §0.1 is now answered — the storefront spec
arrived and settles it. What remains is three decisions from the first draft (§0.2–§0.4),
five rulings the storefront spec left open (§0.5), one sequencing question it raised (§0.6),
and two pieces of infrastructure the domain flow needs that are not app code (§0.7).

Every one of these changes the shape of the work. Picking silently would waste a step each.

### 0.1 ~~The storefront builder has no specification~~ — RESOLVED

`handoffs/handoff-4-superadmin/storefront-templates.md` arrived and settles it. Four objects,
fourteen section types with declared data sources and seller-fillable fields, board-by-board
layouts for `[5a]`–`[5e]` and `[5g]`/`[5h]`, twelve acceptance criteria of its own, and a cut
list in priority order. That is more specification than any handoff has shipped with.

It is also written against the real system rather than around it. The six theme presets it
names — `industrial`, `default`, `trade`, `mono`, `clinic`, `salon` — are already in
`docs/tokens.css:146-151` as `[data-theme]` blocks with those exact keys, `Business.themePreset`
already stores one, the ink `BuilderChrome` bar matches what `docs/inferred.md:171` recorded,
and "a theme never recolours verification badges, status tones or platform chrome" is
non-negotiable 2 restated.

Ten of the fifteen rows in the section table name a data source that exists and is queryable
today. What it left open is now §0.5.

### 0.2 Criterion 1's 8,000 records have no source

> "An import run of 8,000 records stages without publishing, categorises what it can, queues
> what it cannot, and lists rejections by countable reason."

The seed has 40 businesses and a name pool that caps at 40. Nothing in the repo produces
8,000 licence records. Options:

1. **A deterministic generator** — `scripts/make-licence-fixture.mts`, seeded PRNG over the
   `AREAS`, `CATEGORIES` and `AUTHORITY_BY_EMIRATE` tables already in `prisma/seed-data.mts`,
   emitting an 8,000-row CSV with a known distribution of the four rejection grounds. This is
   what I would build. It makes the criterion provable and the importer's performance real.
2. **A real sample** you have from a licence authority. Better data, but it is real company
   information and it would land in the repo — I would want it gitignored and generated into
   place, not committed.
3. **Reduce N.** The criterion's substance is "stages without publishing" and "rejections are
   countable", both of which are provable at 200 records. 8,000 only tests that the importer
   does not fall over.

Recommendation: option 1, and keep the number at 8,000.

### 0.3 "Axe clean at compact density" cannot mean literally clean

Criterion 12 as written is unreachable today. Sixteen colour pairings fail WCAG AA, they are
pinned in `tests/e2e/gallery.spec.ts` at an exact count, and `docs/contrast.md` records that
no token may change without a canvas decision. A compact-density console is *more*
muted-text-dense than any surface built so far — queue rows, column heads, mono eyebrows, SLA
ages are all `--text-muted` or `--text-faint` at caption or eyebrow size — so admin will
multiply the failing node count on exactly the two tokens already at issue.

Three honest readings:

1. **Clean outside the known pairings**, which is what criteria in handoffs 1–3 meant and how
   `tests/e2e/gallery.spec.ts` is already structured: one run with `color-contrast` disabled
   expecting zero, one run with only `color-contrast` expecting the failing set to be a subset
   of the documented list. Cheap, honest, and consistent.
2. **Decide the contrast question first**, then criterion 12 means what it says. This is the
   option that actually closes the gap, and it is the decision pinned since handoff 1.
3. **Accept a growing number** and re-pin the count. Defensible only if the product is not
   claiming WCAG AA.

Recommendation: 2 if you are willing to settle the token question now — admin is the densest
surface in the product and deciding after thirty screens is a retrofit across all three
surfaces. Otherwise 1, stated plainly in the acceptance walk.

### 0.4 What is a "landing page" for criterion 6?

> "A landing page below 60 listings or 30% verified cannot be published, and an existing page
> auto-unpublishes when supply drops below the floor."

Handoff 5 owns the pages themselves; handoff 4 owns the matrix that governs them. The floor
logic exists and is correct (`lib/publish-threshold.ts`, unit-tested) but it is wired only to
`app/sitemap.ts` with hardcoded inputs, and it never reads the per-category
`Category.publishThreshold` / `verifiedShareMin` columns that already exist for exactly this.

The asymmetry that will bite: **`Area` has a `publishedAt` column and `Category` does not.**
So an area landing page can record published/unpublished state and a subcategory page has
nowhere to write it. Criterion 6's auto-unpublish half has no target for half its subjects.

I propose a `PageMatrixEntry` model — one row per (kind, subject) pair, carrying the computed
counts, the state, and why it last moved — which gives `[6f]` a real table to render and both
page kinds the same state machine. Confirm that is the right shape, or tell me the pages are
handoff 5's entity and handoff 4 should only compute eligibility.

### 0.5 What the storefront spec left open — five rulings, one cut

Reconciled across six areas with an adversarial verify pass. Fifteen findings confirmed, five
refuted or downgraded. These are the ones that change what gets built.

**A fifth object is missing, and it has to be decided before the first migration.** All four
objects the spec defines are template-and-sector scoped. Ten of the fifteen section rows have
a "Seller fills" column — eyebrow, headline, button label, intro line, logo picks, names,
roles, numbers — and there is nowhere to put what a *specific seller* filled in. Proposal:
`StorefrontContent`, one row per (business, section), a Json blob validated at write time
against the `SectionType`'s declared fields, seller-writable only for fields listed in
`TemplateSection.sellerEditableFields`. The key matters more than the shape: criterion 12
says publish is reversible from version history, and if seller values are keyed to a section
row that a version restore replaces, restoring a template silently destroys seller content
across every store on it. Key by a stable section id that survives versions.

**Certifications and Downloads both point at `Document`, which holds trade licences.** Same
model, same private Supabase bucket (`lib/storage/buckets.ts:15-21`), separated from a licence
only by a seller-chosen enum value. Worse: `lib/i18n/en.ts:1395` ships a promise to sellers
that these files are "never on your public listing and never linked from it". Building those
two sections literally breaks a promise the product already makes. Ruling needed, and my
recommendation is the narrow one — restrict both sections to `certificate`, `catalogue` and
`datasheet` at the service layer, refuse `trade_licence` and `vat_certificate` at the enum
level, and add a test that a licence cannot reach a public surface by any path.

**The offer banner's `code` field needs one word from you.** If it is a redeemable discount
code it is a price mechanism on a public surface and non-negotiable 1 refuses it. If it is an
opaque reference a buyer quotes inside an enquiry — "mention RAMADAN26" — it is a marketing
string and it is fine. I recommend the second, renamed to `reference`, never validated, never
stored against a value, with the existing price-fence test extended to cover the offer banner
specimen so no currency-shaped string can appear there.

**"Auto-pick most-enquired" has no data and cannot be backfilled.** `EnquiryLine` carries no
`productId` (`prisma/schema.prisma:752`) and the RFQ tray discards the product id into a
free-text description (`ProductTray.tsx:99`). Recommendation: add the nullable column now
while the table is small, set it where the id is currently thrown away, and ship Featured
products as manual-pick until there are enough rows to rank on.

**"Meet the team — names, roles, numbers" publishes personal phone numbers** with no entity
to hold them, no consent record, and no erasure path — in the same handoff that builds
`/admin/compliance` for PDPL requests. Either cut it from the fourteen, or give it a
`TeamMember` row with a per-person consent timestamp and a phone that defaults to the branch
number on `Location`. Never `User.phone`.

**Cut the embed.** This is the one place I would override the spec, and its own cut list
already ranks it first. Three independent reasons: `data-theme="inherit"` means host CSS
cascades into our markup and would recolour verification badges with whatever the seller's
site says, which is a direct hit on non-negotiable 2 and already pinned by a test asserting
the badge renders identically across all six themes; an embedded enquiry form is an
unauthenticated cross-origin path into `createEnquiry`, which has no throttle, creates a
Supabase auth user per unseen phone via the service role, and fans out per-delivery-priced
WhatsApp messages to up to eight sellers; and there is no public API, no CORS, no origin
allowlist and no frame policy anywhere in the repo. It also needs the `ApiKey` model that
step 3 builds, so it cannot come first. It belongs in handoff 5, after that lands.

Three more that need an answer but do not block the start of step 6:

- **What is a "sector"?** `Business.primaryCategoryId` is not constrained to top level and
  roughly a third of businesses carry a second `BusinessCategory` row. The store count is the
  number this entire design is organised around, and it is not computable until this is
  defined. Proposal: sector is the top-level ancestor of `primaryCategoryId`, `BusinessCategory`
  rows ignored, denormalised onto `Business` and indexed.
- **Who owns theme choice?** Three sources disagree. `docs/permissions.md:19,41` makes it an
  owner+manager role capability with no plan gate; `prisma/seed.mts:359` gates it on Pro with
  no code enforcing that; board 5b makes the offered set a per-template staff decision.
  `permissions.md` is the stated source of truth, so I would honour it and fix the seed.
- **Which plan carries badge removal?** No column, no capability, no string, no plan row, and
  the spec does not say. Proposal: `Plan.badgeRemovable` alongside `customDomain`, plus a
  seller-written `Business.hideAttributionBadge` refused server-side when the plan flag is off.

### 0.6 Does step 6 rewrite the public storefront?

The largest open question in the whole handoff, and the spec does not address it. The four
`/b/[slug]` routes are hardcoded JSX with no section registry, no ordering and no enabled
flags. Criterion 2 — "reordering, enabling or disabling a section changes every live
storefront on that template and nothing else" — is false until the storefront renders *from*
the template.

Two honest options. Land the model, the builder and the specimens page in step 6 and treat
the storefront rewrite as its own numbered step with its own checkpoint; or accept that
criterion 2 is proved against a pure `resolveSections()` that no route calls, and say so
plainly in the acceptance walk rather than letting it read as proved. I recommend the first,
and it changes the sequencing: the rewrite is large enough that it should not be last.

### 0.7 Infrastructure the domain flow needs, which is not app code

Board 5e's six-step flow is buildable here for steps 1–3 and 5. Step 4 — "certificate issued
automatically" — is a Vercel platform API operation, and this repo has no `VERCEL_TOKEN`, no
SDK, and no outbound call to vercel.com anywhere. Two things need provisioning before step 6
can finish rather than half-finish:

- **`stores.businesslistings.me` does not exist.** It is NXDOMAIN today, and the apex
  `businesslistings.me` is parked on Spaceship nameservers resolving to two AWS IPs, not
  Vercel. Nothing in the repo names either host; `lib/site.ts` reads `NEXT_PUBLIC_SITE_URL`,
  which is `localhost:3000` in both `.env.local` and CI.
- **An access token for the project-domains API**, in `.env.example` with the same fail-closed
  comment style `CRON_SECRET` has.

Until both exist, criterion 8's certificate clause cannot be proved in CI. The honest way to
build it anyway is a `CertificateIssuer` port in the shape of `lib/billing/provider.ts` — a
fake for tests, a `live: boolean` so screens can say what has and has not actually happened,
which is the same trick the payment port uses to avoid implying a card was charged.

**One thing already shipping on a promise:** Pro is AED 899 and sells "Your own web address"
on the pricing page, in onboarding and on the plan-change screen, with four tests asserting
that copy is visible. `Plan.customDomain` is a real boolean and there is nothing behind it.
If domain verification slips, that feature line should come out in the same PR.

---

## 1. Where the handoff README and the repo disagree

Eight findings from the audit. Each is verified against files, not inferred.

**The component count is 66, not 64.** `Alert` (65) and `Thread` (66) were approved after the
canvas was written. `docs/design-system.md`, `docs/component-inventory.md` and `/dev/gallery`
all say 66. No action beyond knowing it; the README's "all 64 exist" is stale, not wrong in
spirit — every component it needs is built.

**"ModerationRow and AuditRow are consumed here" is half true, and the other half contradicts
non-negotiable 4.** Both were genuinely built in handoff 2. But they render as `<li>` and
`<div>`, and CLAUDE.md requires real `<table>`/`<thead>`/`<th scope>` markup for tabular data,
which is what `DataTable` provides. They cannot go inside a table. Resolution: `DataTable` for
the queues and the log; `ModerationRow` and `AuditRow` keep the detail and card surfaces
(`[4c]`'s submission review, the audit trail on a business page). Not a conflict once stated,
but a planner following the README literally would build the queue out of `<li>`s.

**"Probably a DataTable configuration" does not survive the screen list.** `DataTable` today
has no sticky header, **no error state** (a failed query renders as "nothing to do", which in
a queue is the worst possible failure), no row grouping or banding for the dedupe confidence
bands, no totals row for revenue, no column-visibility config and no page-size control. These
are extensions to one component, not new components — the README's spirit holds — but they are
step-0 work, not free.

**`ImportRun` is a name collision, not a foundation.** It is handoff 3's seller CSV *product*
importer: `businessId` is NOT NULL with a cascading FK, its only child relation is `Product[]`,
and its revert path reads business + created_at. A licence-record run has no owning business
and produces listings, not products. Reusing it means making `business_id` nullable and would
break handoff 3's 24-hour revert. Handoff 4 gets its own `LicenceImportRun`.

**`Business.importRunId` records nothing.** A bare TEXT column with no foreign key, no Prisma
relation, no index, and no reader or writer anywhere. It predates `ImportRun` and looks
exactly like the provenance link the ingestion step wants. It is not one.

**Ranking weights are a frozen module constant.** `DEFAULT_WEIGHTS` in
`lib/search/ranking.ts:22-29`. `searchBusinesses` accepts an override parameter that no caller
ever passes. The file's own comment says the weights live there "so the admin editor in
handoff 4 has one thing to write to" — but there is nothing to write *to*. Criterion 5 needs a
persistence row before it needs a UI.

**Exactly one audited mutation exists in the whole repo.** `staffMutation` is real, correct,
and validates the reason before anything is read — and `lib/reviews/service.ts:203` is its
only production caller. The other fifteen audited capabilities have a guard, an audit action
name and an i18n label, and no service behind them. Criterion 11 ("every mutation writes an
audit row") is currently true of the harness and vacuous about the console.

**`app/(admin)/layout.tsx` is eight lines and unauthenticated.** It sets
`data-density="compact"` and renders its children. No actor resolution, no auth check, no
capability check, no shell. There is no `requireStaff()`. There are zero pages under
`app/(admin)/`, so every admin URL 404s — which is the only reason the missing guard has not
mattered.

---

## 2. What already exists, so nothing gets rebuilt

Handoffs 0–3 built more of this console's foundations than the README assumes.

| Already there | Where |
|---|---|
| 35 capabilities, all 17 staff rows of §07 covered, every one marked `stated` | `lib/auth/capabilities.ts` |
| Three subject-dependent checks, including audit-log "own actions only" | `lib/auth/subject.ts` |
| `staffMutation()` — reason validated and capability checked before any write, audit row joins the caller's transaction | `lib/audit/staff-mutation.ts` |
| `ACTION_FOR_CAPABILITY` — 17 audited capabilities, one action each, test-enforced | `lib/audit/types.ts` |
| `AuditEvent.reason` NOT NULL, in schema and service layer | `prisma/schema.prisma:1364` |
| `AdminShell`, `AppSidebar`, `resolveNav`, `DataTable`, `TableToolbar`, `SelectionBar`, `Pagination`, `Drawer`, `Modal`, `FilterRail`, `KeyValuePanel`, `BuilderChrome` | `components/structure/` |
| `ModerationRow`, `AuditRow` | `components/domain/` |
| `ADMIN_NAV` — 20 items in 6 groups, every item `later: true` | `components/structure/nav-config.ts:142` |
| `ListingChangeRequest` with a CHECK refusing a decision without a reason | `prisma/schema.prisma:853` |
| `ClaimSubmission` with the `contested` flag and route-evidence CHECK | `prisma/schema.prisma:972` |
| `SupplierReport` with `ReportOutcome` = seller_corrected / upheld / no_action | `prisma/schema.prisma:1204` |
| Three queues seeded with every status, plus matching audit rows | `prisma/seed.mts`, `tests/integration/admin-queues.test.ts` |
| `lib/publish-threshold.ts` — the 60/30% gate, unit-tested, correct | `lib/publish-threshold.ts` |
| `Category.publishThreshold` (60) and `verifiedShareMin` (0.30) columns | `prisma/schema.prisma` |
| Trigram GIN indexes on `Business.tradeName` and `displayName` | `prisma/schema.prisma:479` |
| `Redirect` — fromPath unique, statusCode default 301 | `prisma/schema.prisma:1456` |
| Payment provider port, proration in whole fils, entitlement caps, invoices | `lib/billing/` |
| `NotificationTemplate` with versioning and `TemplateApproval.pending_meta` | `prisma/schema.prisma:1516` |
| `ZeroResultQuery` and `MissedEnquiry` — the CRM's demand signals, already being written | `prisma/schema.prisma` |
| `InvoiceLineKind.subscription_credit`, and no refund kind | `prisma/schema.prisma:1336` |
| Four review-removal grounds | `lib/reviews/eligibility.ts:13` |
| CI with postgres:17, migrate and seed before every job | `.github/workflows/` |
| The `signin()` / `pwx --no-deps` acceptance idiom | `scripts/acceptance-handoff-3.sh:49` |

Baseline: **648 unit tests, 218 integration, 416 Playwright instances.** Every number in this
roadmap's acceptance section is measured against those.

Three of the demand signals the CRM needs are already being written by handoff 1 and 2 code
and read by nothing. The call list is a query over data that exists, not a table to fill.

---

## 3. Schema additions

Twenty-six models and eight enums, which is more than handoffs 1–3 combined. That is the
honest shape of the work: the spine exists, the console's own machinery does not.

**Step 0 — the frame.** None. `requireStaff()` reads `User.roles`, which is already there.

**Step 1 — moderation and taxonomy.**
1. `ClaimResolution` enum — `award_to_a` | `award_to_b` | `split_into_two` | `merge_as_branches`.
   `ClaimStatus` (unclaimed/claimed/disputed) cannot express any of the four, and split and
   merge both produce structure the audit row has to be able to name.
2. `ClaimSubmission.competingSubmissionId` and `resolutionId` — today `contested` is a
   write-once derived boolean that links nothing, so `[4c]` cannot show both sides.
3. `SpecTemplateVersion` — the library is versioned in the README and not in the schema.
4. `SpecField.requiredFrom` — the grace period, stored as the date a field starts being
   required rather than a flag, so an existing product is incomplete-but-valid.
5. `SpecFieldProposal` — seller-proposed fields with an occurrence count across businesses and
   a promotion state. `SellerTemplate.fieldMappings` is an opaque Json blob today, so "fields
   that appear often enough" is not a countable thing.

**Step 2 — ingestion.**
6. `LicenceImportRun` — platform-scoped, no owning business. Explicitly not `ImportRun`.
7. `StagedListing` — a parsed licence row with nullable category and free-text authority.
   Staging into `Business` is illegal: `slug`, `primaryCategoryId`, `licenceExpiry` and
   `licenceAuthority` are all NOT NULL and a record whose category could not be inferred has
   nowhere to sit.
8. `RejectionGround` enum — the README's four, countable because the repo's own convention
   (see `SkipReason`) says a reason you count is an enum.
9. `MergeCandidate` — left, right, score, band, decision, decidedBy, reason.
10. `Merge` — with the **moved-row manifest**, not just a pointer. Reviews, enquiries,
    locations and products all cascade from `business_id`, so a naive merge that deletes the
    loser destroys reviews irreversibly. Reversal must be a replay of a stored manifest, not a
    recomputation.
11. `Business.mergedIntoId` / `mergedAt`.

**Step 3 — trust.**
12. `SiteVisitReport` — two geotagged photos plus the premises/signage/stock checks, attached
    to the `SiteVisitRequest` that handoff 3 already writes.
13. `PdplRequest` — subject-access and erasure, with a due date and a completion reason.
    Note erasure collides with the FK graph: deleting a user cascades their enquiries.
14. `ApiKey` — hashed secret, scope, rotation and revocation timestamps.
15. `WebhookEndpoint` and `WebhookDelivery`. `NotificationDelivery` is for user notifications
    and is not reusable here.
16. `ReviewRemovalGround` enum — promoting the four grounds from a const to a database value,
    so `/admin/audit` can count them.

**Step 4 — accounts and CRM.**
17. `CallTask` — but see §4.4: the generation half is a query, not an insert path, because
    "no manual entry" is a property you get by having nowhere to type.
18. `CallOutcome` enum and the outcome row that drives the account state transition.
19. `ViewAsSession` — staffId, businessId, ticketRef, startedAt, expiresAt. The 30-minute cap
    has to be data; an audit row can name a ticket but cannot expire a session.

**Step 5 — commercials.**
20. `PaymentAttempt` and `Subscription.dunningStage` — `SubStatus.past_due` is the only marker
    today. The stage must be stored or the sequence does not survive a restart.
21. **Fix `Subscription.entitlementSnapshot`.** The column exists and its doc comment promises
    grandfathering, but all three writers store `{ planId, capturedAt }` — no cap values —
    and nothing reads it; `lib/plan/entitlements.ts` resolves caps from the live `Plan` row.
    Grandfathering does not work today. Criterion for "apply to existing" depends on it.
22. `RankingWeights` — versioned rows, so a change is diffable and the audit before/after
    means something.
23. `Boost` — `reason` NOT NULL and `expiresAt` NOT NULL. NOT NULL is the enforcement, the
    same trick `AuditEvent.reason` uses. `PlacementSlot` is paid sponsored placement with a
    nullable end date and no reason column, so it satisfies neither half of criterion 5.
24. `QueryRoute` — the phrase-to-category routing table.

**Step 6 — content ops, and the builder if it is in scope.**
25. `PageMatrixEntry` — see §0.4.
26. `LocaleString` — `/admin/strings` has nothing to write to today.
27. `HomepageFeature` — with the tier-2+ rule enforced at the service layer.
28. **Builder models, revised from the spec.** My guesses in the first draft were wrong; the
    spec names the real four and the reconciliation found a fifth:
    `StorefrontTemplate` (sector, status, version, default theme, derived `businessCount`) ·
    `TemplateSection` (type, sort order, enabled, `sellerEditableFields`, `showOnMobile`) ·
    `SectionType` (the platform-owned catalogue of 14; adding one is a code change, not a
    config change) · `TemplatePage` (slug, block list, SEO fields) · **`StorefrontContent`**,
    the fifth object §0.5 argues for, which is where a seller's own values live.
    `CustomDomain` stands, with the verification state machine and a consecutive-failure count
    stored on the row so a transient DNS miss cannot walk the state backwards.
    `TypePairing` and `Specimen` were both wrong: type pairing is a per-template setting on
    `StorefrontTemplate`, not an entity, and the specimens page is a route over `SectionType`,
    not a table.
    Dropped pending §0.5: `TeamMember` only if "Meet the team" survives, and
    `EnquiryLine.productId` added now so Featured products can rank later.

Every one lands as a raw-SQL migration with idempotent index creation, per `docs/database.md`.
Note the event trigger that force-enables RLS on every new table — twenty-six new tables means
twenty-six RLS-on-zero-policies tables, which is the intended lockdown and will make every one
of them invisible to a browser-side Supabase query. That is correct and worth expecting.

---

## 4. The steps

The KICKOFF names seven. I am proposing **nine**, and both additions are deliberate rather
than scope creep. Step 0 is the frame, because step 1 assumes one that does not exist and it
is the only step that touches every subsequent screen — it is also where criterion 9 gets
written first. And the storefront builder is now large enough, and specified enough, to be its
own step rather than sharing one with content ops; §0.6 may make it two.

### Step 0 — the frame `[4a]`

Not in the KICKOFF's list. Everything else depends on it.

- `requireStaff()` — the missing equivalent of `requireSellerSeat()`. Resolve the actor,
  assert a staff role, 404 otherwise. `lib/auth/flow.ts:476` has no `staff_*` branch in
  `destinationFor`, so signing in as staff currently sends them nowhere.
- `app/(admin)/_shell.tsx` wiring `AdminShell` + `ADMIN_NAV`, replacing the eight-line div.
- `ADMIN_NAV` covers 20 of the 31 routes; the missing 11 include `/admin/plans`, `/admin/tax`,
  `/admin/users`, `/admin/notifications`, `/admin/strings`, `/admin/api`,
  `/admin/content/home`, `/admin/content/redirects` and all of `/admin/storefront-templates`.
- The `DataTable` extensions §1 lists — error state first, because a queue that renders a
  failed query as "nothing to do" is the failure mode this console exists to prevent.
- `[4a]` itself: every number a link into the queue that fixes it.
- **Criterion 9 is written here, first**, for the reason `docs/roadmap-handoff-3.md` §5 gives:
  it is the only criterion that is a claim about what the code refuses to do, and those are
  the ones that pass by accident. A moderator cannot change a tier today only because nobody
  can; that is not the same thing as being refused.

**Checkpoint: sign in as each of the four staff roles and see a different console.**

### Step 1 — moderation and taxonomy `[4b]` `[4c]` `[4d]` `[4e]`

First because handoff 3 is already filling this queue and it is the only genuinely blocking
backlog.

- `[4b]` the queue, ordered by age with SLA breach before volume.
- `[4c]` submission review, including the four-way conflicting-claim resolution and the count
  of buyers currently waiting on that listing — a query over `EnquiryRecipient`, and the real
  cost of the delay.
- `[4d]` taxonomy, wiring `Category.publishThreshold` and `verifiedShareMin` to
  `lib/publish-threshold.ts`, which has never read them.
- `[4e]` the versioned spec library with the grace-period path and an accurate affected count.

*Assumption to state on delivery:* the affected count needs a real `specCompleteness`
computation. The column exists and the seed writes a fabricated value from
`0.4 + rnd() * 0.6`. That is the same shape of invention criterion 5 of handoff 3 forbade for
response time and profile strength, sitting one column along. It gets the same treatment: a
pure function, computed by the existing hourly job.

**Checkpoint: resolve a conflicting claim four different ways.**

### Step 2 — ingestion `[12a]` `[12b]`

What makes launch-day supply real.

- `[12a]` stage, categorise, queue, reject. Nothing publishes.
- `[12b]` dedupe with the confidence bands. Above 90% bulk-merge, 60–90% needs a human,
  below 60% is not a match.
- The merge manifest, the 30-day reversal, the 301, **and a resolver that serves it** — a
  `Redirect` row nothing reads is not a 301. There is no `middleware.ts` in this repo; Next
  16's `proxy.ts` does session-cookie refresh only and has no path logic.

**Checkpoint: import 8,000 records without publishing any, then bulk-merge above 90%.**

### Step 3 — trust `[4h]` `[4i]` `[12h]`

- `[4h]` supplier reports. Already being filled automatically: `lib/messaging/service.ts:95`
  writes a report with `reporterId: null` whenever off-platform payment steering is detected.
  So this queue has a producer and no drain, exactly like the three from handoff 3.
- `[4i]` staff, roles and audit log — including the "own actions only" narrowing, which is
  implemented at `lib/auth/subject.ts:196` and called from nowhere.
- `[12h]` field visits with the two-photo report, PDPL, API keys, staff security.

**Checkpoint: prove a moderator cannot change a verification tier.**

### Step 4 — accounts and CRM `[4f]` `[12d]` `[12f]`

- `[4f]` account health.
- `[12d]` the self-building call list. The signals exist and are unread.
- `[12f]` support desk and view-as. **Read-only must be enforced where the seller's own
  mutations are**, not by hiding buttons — a hidden button is a UI opinion and a server action
  is a URL.

### Step 5 — commercials `[4g]` `[12e]`

Revenue, MRR movement, entitlements as data, dunning, VAT export, invoices and credits.

`StatCard` hardcodes `font-serif` in both branches, and the README says no serif anywhere in
admin. Either `StatCard` takes a prop or the revenue screens do not use it; I will take the
prop, because the alternative is a second stat component and the inventory says no new ones.

No commission, no payouts, no GMV. The D14 drop to Free is a plan downgrade, never a refund.

### Step 6 — the storefront template builder `[5a]`–`[5e]` `[5g]` `[5h]`

Specified now. Build in the spec's own priority order, which is the inverse of its cut list:
the section library and builder shell (`5a`, `5c`), domain verification (`5e`), and the
specimens page (`5g`/`5h`) are what make the template model real rather than theoretical.
Theme editor (`5b`) ships as the six fixed presets first, per-sector selection second. Page
template editor (`5d`) after that. The embed does not ship here at all — §0.5.

The organising fact is that a template edit is a fan-out: changing one template changes every
live storefront in that sector. Every screen has to show the blast radius before the save, and
publish is a two-step — a diff of what changed, then a confirm naming the store count.

`/admin/storefront-templates/specimens` is the acceptance surface for the whole step, the way
`/dev/gallery` is for components. Fourteen types rendered at real scale with their data source
and seller-fillable fields labelled, and the Services & packages card visibly disabled —
because the services model is not built, and leaving the gap legible is better than hiding it.

**Checkpoint: change one template and see the store count before and after the save.**

### Step 7 — content ops `[6f]` `[12g]`

`[6f]` page matrix, `[12g]` notification templates, localisation, homepage curation,
redirects. Small, self-contained, and the least blocking thing in the handoff — which is why
it moved behind the builder rather than sharing a step with it.

### Step 8 — the acceptance pass

`scripts/acceptance-handoff-4.sh`, walking the twelve criteria, copying both halves of the
`signin()` / `pwx --no-deps` idiom that handoff 3's walk paid for.

---

## 5. Where each acceptance criterion is proved

| # | Criterion | Proved by | Step |
|---|---|---|---|
| 1 | 8,000 records stage without publishing; rejections countable | integration over the generated fixture, plus a count query per ground | 2 |
| 2 | Dedupe bands; merge reversible 30 days, audit row, 301 | integration: merge, assert the audit row, unmerge, assert the reviews came back, and fetch the old path | 2 |
| 3 | A conflicting claim resolves four ways and notifies both parties | integration, one test per resolution — the checkpoint's own demand | 1 |
| 4 | A new required field does not invalidate existing products | unit on the pure affected-count function, integration on the grace path | 1 |
| 5 | Weights reorder live results; a boost needs reason and expiry | unit on `rank()` under two weight objects; integration writing weights then re-running the real query; NOT NULL does the boost half | 5 |
| 6 | A page below the floor cannot publish and auto-unpublishes | unit is done; integration crosses the floor in both directions and asserts which half failed | 1 + 6 |
| 7 | The call list generates from signals with no manual entry | integration for generation; a grep-style negative check for "no insert path" | 4 |
| 8 | View-as is read-only, expires at 30 minutes, names the ticket | integration for the audit row; clock-advanced test for the cap; a negative test that a mutation as the impersonated seller is refused | 4 |
| 9 | A moderator cannot change a tier, credit, or suspend | integration calling each service as a moderator — written first, in step 0 | 0 |
| 10 | Dunning runs D0/D3/D7/D14 and never deletes or unbadges | unit on the pure step function; integration running the sequence and asserting the listing and badge survive | 5 |
| 11 | Every console mutation writes an audit row; no reason throws | table-driven integration iterating `ACTION_FOR_CAPABILITY`, plus a static check that no admin service calls `prisma.*.update` directly | all |
| 12 | Axe clean at compact density; build clean | the acceptance walk, under whichever reading §0.3 settles on | 8 |

The storefront spec carries twelve criteria of its own for step 6. Two need restating before
they can be proved. Criterion 4 says "visual test": there is no screenshot infrastructure in
this repo — `toHaveScreenshot` appears nowhere — and the honest substitute is stronger anyway,
a computed-style assertion plus a static check that every `[data-theme]` block in
`app/globals.css` sets only `--brand*` properties, extending the existing six-theme badge test
to cover status tones and platform chrome. Criterion 2 depends on §0.6: until the public
storefront renders from the template, it can only be proved against a resolver no route calls,
which is a test that passes while the feature does not exist.

Criterion 11 needs an enforcement that does not exist. Nothing structurally stops a future
admin service from calling `prisma.business.update` directly — no test, no lint rule, no
migration. A static check over `app/(admin)` and the admin services is the only thing that
makes "every mutation" true rather than aspirational, and it is cheap.

---

## 6. Known risks

**Forty rows is not a console.** The seed has 40 businesses, 5 zero-result queries, no merge
candidates, no import run, no redirects and no failed payments. Six of handoff 4's screens
have no fixture to render and five of the twelve criteria are only meaningful above a scale
the seed does not reach. Step 0 should extend the seed before the screens exist, not after —
handoff 3 shipped three empty queues for three merges precisely because the seed came second.

**The permission layer is complete and the service layer is empty.** Fifteen of sixteen
audited capabilities have a guard, an action name, an i18n label and no function. That is a
good problem — the hard thinking is done — but it means the volume of step 1 through 5 is
almost entirely new service code, and every one of those services must route through
`staffMutation` or criterion 11 is false.

**`assertCan` is a role-array membership test.** `staffMutation` enforces the reason and the
capability, and nothing else. Three rows in §07 are subject-dependent and fail *open* under a
role-only check — that is what `lib/auth/subject.ts` exists for, and it is easy to call
`assertCan` and think the job is done. Tier setting in step 3 is the one that matters:
`assertCanSetVerificationTier(actor, visit)`, never `assertCan(actor, "…tier.write")`.

**`Actor.branchId` is never populated.** No code path in the repo sets it, so every
`own_branch` subject check takes the unscoped branch at runtime. Pre-existing, not handoff 4's
doing, and worth fixing where the staff console touches branch-scoped seats.

**Grandfathering does not work.** §3 item 21. It is written down as if it does, which is worse
than it being absent.

**Twenty-six new tables under RLS-on-zero-policies.** Correct and deliberate, per
`docs/database.md`, and it will make every browser-side query against them fail by design.
Expected; noting it so it is not diagnosed twice.

**Carried from earlier handoffs, still open:** the contrast and type-size pairings under the
§09.2 floor, which criterion 12 now depends on; the design canvas §02–§07 never supplied,
which §0.1 now depends on; the Supabase phone provider off and WhatsApp templates
`pending_meta`, which the dunning sequence at D7 depends on; and the `service_role` key that
needs rotating.
