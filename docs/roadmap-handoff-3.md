# Handoff 3 — seller onboarding & dashboard: roadmap

The handoff that turns imported licence records into a paying supply side. A supplier finds
their own listing, proves they own it, fills it in, and runs it daily without talking to us.

Source: `handoffs/handoff-3-seller-dashboard/README.md` and `KICKOFF.md`. Twenty-four routes,
three remaining tier-4 components, twelve acceptance criteria.

---

## 1. Three decisions taken before starting

The KICKOFF says to stop and ask rather than pick. Three things changed the shape of the
work and were settled first.

**Billing is a pluggable provider port.** There is no payment dependency in the stack and
CLAUDE.md is explicit that the platform holds no buyer funds — but sellers do pay a
subscription. A `PaymentProvider` interface with a console/dev implementation, exactly the
shape `lib/notify/senders/` and the OTP delivery already use. Proration, entitlement
application and invoicing are ours and fully tested; a real gateway drops in behind the port
without touching a screen. Criterion 10's "unlocks entitlements within a minute" is then a
property of our own code rather than a webhook we cannot run in CI.

**Uploads use Supabase Storage for real.** Buckets, signed upload URLs and storage policies.
`Media.storagePath` and `Document.storagePath` have been strings pointing at nothing since
handoff 0. The media library `[3i]`, the photo quality feedback `[8b]`, the licence upload
`[2b]` and the verification documents `[3e]` are all hollow without bytes, and Supabase is
already the auth and database provider.

**The permission matrix stays the inferred one.** The README calls design-system §07 "the
source of truth" for the four seller roles. `docs/design-system.md` is a 112-line summary
with no §07 — the canvas file has never been supplied, which is the same gap carried since
handoff 0. `lib/auth/capabilities.ts` already carries a matrix with every seller row marked
`inferred` and a note to diff it against §07 before handoff 1, which never happened. It
already satisfies criterion 9 literally: `billing.manage` is owner + finance, `listing.edit`
is owner + manager, `team.manage` is owner only, so a sales seat is excluded from all three.
Handoff 3 extends it with the new rows and keeps the `stated` / `inferred` markers honest.

---

## 2. What already exists, so nothing gets rebuilt

Handoff 0 laid far more of the data model than the README assumes. Present and usable as-is:

| Already there | Where |
|---|---|
| `Plan` × 3 (free / basic / pro) with every cap as a column | `prisma/seed-data.mts` |
| `Subscription`, `Invoice`, `InvoiceLine`, `PlacementSlot` | `prisma/schema.prisma` |
| `SpecTemplate`, `SpecField` (with `isFilterable`), `SellerTemplate.fieldMappings` | schema |
| `Media`, `Document`, `Location.hours` / `.ramadanHours` as Json | schema |
| `Role` enum with all four seller seats, `User.roles[]`, `User.businessId` | schema |
| Capability matrix and one `assertCan*` per capability | `lib/auth/capabilities.ts`, `guards.ts` |
| Seller seat resolution, nav, `SellerPage` frame | `app/(dashboard)/dashboard/_shell.tsx` |
| `FileDrop` primitive | `components/primitives/FileDrop.tsx` |
| Response-time measurement, and the job that writes it | `lib/metrics/` |

Free-plan caps are already real numbers: 3 enquiries a month, 10 products, 1 location,
5 photos, 1 seat. Board `[11a]` argues against those, not against invented ones.

Fifty-one component files export the inventory; twelve of tier 4 are built. `HoursEditor`,
`EmirateAreaPicker` and `PlanCard` are the three this handoff adds.

---

## 3. Schema additions

Eleven, each because a criterion needs it. Every one lands as a raw-SQL migration with
idempotent index creation, per `docs/database.md`.

1. **`ListingChangeRequest`** — the moderation queue rows criterion 8 produces. Trade name,
   category and licence changes only. Handoff 4 builds the screens that drain it; this
   handoff must fill it correctly or handoff 4 has nothing to work on.
2. **`ImportRun`** — criterion 7's twenty-four-hour reversibility. `Business.importRunId` is
   already a bare string with no model behind it; this gives both the licence import and the
   seller CSV import somewhere to point.
3. **`Product.importRunId`** — so an import can be undone without guessing which rows it
   created.
4. **`ImportMapping`** — "mappings are saveable for next month" is in the README.
5. **`Business.leadRouting`** enum (`round_robin` | `by_branch` | `everyone`) and
   **`leadEscalationMinutes`** default 120 — board `[7d]`, and the setting that protects the
   response score.
6. **`TeamInvite`** — seats are invited, not created. Needed by `[7d]` and `[8d]`.
7. **`ClaimSubmission`** — board `[2a]`/`[2b]`. Carries the route taken (licence upload or
   phone), the document, and the "someone else claimed it" conflict state. `ClaimStatus`
   already has `disputed`; this is what makes a listing reach it.
8. **`SiteVisitRequest`** — `[8e]` books a visit. `Business.visitedAt` is staff-written and
   feeds a trust signal, so a seller's *request* needs its own row.
9. **`PlacementWaitlist`** — `[11e]`, one slot per subcategory and emirate, waitlist if taken.
10. **`Subscription.providerRef`** — nullable, so the payment port has somewhere to record an
    external id when a real gateway arrives.
11. **Storage buckets and policies** — `business-media` and `business-documents`, with
    documents private and media public-read. Documents hold trade licences; they are never
    world-readable.

Deliberately **not** added: any per-seller setup-task completion table. Criterion 4 wants the
four tasks resumable, and criterion 11 wants profile strength with no seller-writable path.
Both are satisfied by deriving completion from the rows that already exist — photo count,
product count, team size, visit request — rather than by a flag a seller could set.

---

## 4. The six steps

Dashboard first, onboarding last, on the README's own sequencing: the dashboard is where a
seller spends their life and it is harder; the five-screen funnel is much easier once you
know what it must produce. One branch, one PR, one squash merge each, per CLAUDE.md.

### Step 1 — the two overviews `[3a]` `[11a]`

The Pro overview and the Free overview, plus the locked-panel pattern every later screen
reuses.

The Free board is the load-bearing one. It is not a degraded Pro dashboard — it lists the
enquiries the seller **missed** because of the 3-a-month cap, with real dates and real
requirements, and every locked panel shows the real feature dimmed with one line naming what
unlocks it. The data for this already exists: `EnquiryRecipient` rows are written with a
skipped state when `atMonthlyCap` fires during fan-out, so the missed list is a query, not a
fabrication. Free is a real product, not a trial; nothing expires.

Also here: `lib/plan/entitlements.ts`, one place that answers "what does this plan allow",
and the `LockedPanel` component the whole handoff leans on. The dashboard opens on what needs
a reply, never on a chart.

**Checkpoint: both overviews, and a locked panel.**

### Step 2 — the catalogue loop `[3f]` `[3g]` `[3h]` `[3i]` `[11d]`

The weekly loop, and the step with the sharpest rule in the handoff.

- `[3f]` catalogue list with bulk actions.
- `[3g]` product editor driven by the seller's cloned template, with `FILTER` markers on the
  fields that drive site-wide filters — which is what turns data entry into "this is why you
  get found".
- `[3h]` spec template cloned from the platform template with the mapping to platform fields
  preserved. Renaming a cloned field warns before saving and keeps the mapping, so
  cross-seller comparison survives a rename.
- `[3i]` media library, on real Supabase Storage.
- `[11d]` the CSV mapper, and **the importer must refuse to import prices**. A "Unit Price
  AED" column maps to "Do not import" with the reason shown. Two fields in one column
  ("DI / SS316") offers a split. Every import reversible for twenty-four hours, mappings
  saveable.

The price refusal is not a validation nicety — CLAUDE.md non-negotiable 1 says `Product` has
no public price field, and a CSV importer is the one path wide enough to smuggle one in.

**Checkpoint: import a CSV containing a price column and show it blocked with the reason.**

### Step 3 — listing maintenance `[3b]` `[3c]` `[3d]` `[3e]`

Listing profile, locations, hours, verification ladder. Two tier-4 components land here:

- **`HoursEditor`** — per-day toggle and time pair, split shifts, copy-to-all-branches,
  public holidays, and a Ramadan block with automatic dates.
- **`EmirateAreaPicker`** — seven emirates, areas nested one level, and free zone as a
  cross-cutting toggle rather than an area. A JAFZA company is in Dubai *and* in a free zone.

And moderation stays narrow: only trade name, category and licence changes queue for review.
Photos, hours, products and description publish instantly. If the queue gates everything it
becomes the bottleneck on 41,000 listings and the whole dashboard feels dead.

*Assumption to state on delivery:* Ramadan is lunar, so "automatic dates" needs a source. A
small table of Gregorian start and end dates per Hijri year, with a comment saying it is
observation-dependent and approximate at the edges, rather than a computed approximation
presented as fact.

### Step 4 — account `[3l]` `[3m]` `[7d]` `[11e]` `[11f]`

Analytics, billing, team and lead routing, sponsored placement, plan change and cancel.
`PlanCard` lands here and completes the component inventory.

- `[11f]` plan change with proration shown line by line; cancel with a plain statement of
  what is kept (listing stays live on Free, products saved and hidden, reviews untouched,
  badge retained) and what is lost; a tax invoice carrying both TRNs. **No retention offer** —
  the board says so deliberately: if the product is not worth it we would rather know.
- `[11e]` sponsored placement, one slot per subcategory and emirate, not auctioned, waitlist
  if taken. Always labelled, and never outranks a verified supplier on a filter the buyer
  explicitly set. The panel that says "fix the free stuff first — 62 products are missing
  filterable specs" is not decoration; it is why sellers trust the upsell.
- `[7d]` four roles, and lead routing: round-robin between sales, by-branch from the buyer's
  location, or everyone-sees-everything, with escalation to the owner after a configurable
  interval, default two hours. Per-person response stats including the uncomfortable one —
  the owner is often the slowest.

No commission anywhere. No payouts, no order fees.

Criterion 11 also gets settled here: **profile strength becomes measured**, computed by
`lib/metrics/profile-strength.ts` and written by the existing hourly job, alongside response
time. Handoff 2 caught the seed inventing `responseTimeMedianMs`; `profileStrength` is
currently the same shape of lie and gets the same treatment.

### Step 5 — onboarding and setup `[2a]`–`[2e]`, `[8a]`–`[8e]`

The on-ramp, built last.

```
1l pricing → 2a claim → 2b verify → 2c profile → 2d locations → 2e plan → 8a setup hub → 3a
```

- `[2a]` claim searches imported records by trade name, licence number or phone. Three
  outcomes: unclaimed match → claim, claimed match → dispute route, no match → add from
  scratch. **Claiming preserves existing reviews and historical enquiries, and says so on
  screen**, because a supplier's first fear is that claiming resets them (criterion 2).
- `[2b]` verify by licence upload or phone against the number on the public licence record.
  Both human-checked. Conflicting claims show the "someone else claimed it" state and take
  the submission anyway; the admin queue that resolves them is handoff 4.
- `[2c]` profile with trade name locked to the licence, live preview of the search-result
  card, and the profile-strength meter with the 80% threshold marked.
- `[2d]` locations, using the two components built in step 3.
- `[2e]` plan — and **the listing is already live on Free before this screen**. Nobody is
  blocked behind a paywall (criterion 3).
- `[8a]`–`[8e]` four setup tasks, independent and resumable, each returning to the hub with
  profile strength updated. The hub states what each task is worth in percentage points,
  because a vague "complete your profile" prompt gets ignored.
- One WhatsApp reminder after three days if anything is open, then nothing. We do not chase.

### Step 6 — the acceptance pass

`scripts/acceptance-handoff-3.sh`, walking the twelve criteria and printing one line each,
in the shape handoffs 1 and 2 established — including the two lessons handoff 2's pass paid
for: a filter that matches no tests fails rather than passing silently, and the walk runs the
mobile project rather than only chromium.

---

## 5. Where each acceptance criterion is proved

| # | Criterion | Proved by | Step |
|---|---|---|---|
| 1 | Full self-serve onboarding to dashboard, no staff | e2e walk of all five steps | 5 |
| 2 | Claiming preserves reviews and historical enquiries | integration test, before and after row counts | 5 |
| 3 | Listing live on Free before `[2e]` | integration: `publishedAt` set before the plan step | 5 |
| 4 | Four setup tasks independent, resumable, strength updated | e2e with a sign-out between tasks | 5 |
| 5 | Free seller at cap sees missed enquiries; locked panels name the unlock | e2e on `[11a]` against seeded skipped recipients | 1 |
| 6 | Template clone preserves mapping; rename warns and keeps it | integration on `SellerTemplate.fieldMappings` | 2 |
| 7 | CSV cannot import prices; import reversible 24h | integration + the checkpoint demo | 2 |
| 8 | Only trade name, category, licence moderate; rest publishes instantly | integration on `ListingChangeRequest` row counts | 3 |
| 9 | `sales` rejected server-side from billing, plan and licence | integration calling each mutation as a sales actor | 4 |
| 10 | Proration correct; entitlements within a minute; cancel keeps badge and hides products | integration through the payment port | 4 |
| 11 | Response time and profile strength have no seller-writable path | grep test plus the measurement job's own tests | 4 |
| 12 | Axe clean on dashboard routes, build clean, gallery renders 64 | the acceptance walk | 6 |

Criterion 9 is the one to write first within its step, not last: it is the only criterion
that is a claim about what the code **refuses** to do, and those are the ones that pass by
accident.

---

## 6. Known risks

**The component count does not add up.** `docs/design-system.md` says tier 4 is 14 components;
twelve are built; the README says three more completes 64. That is 15. The gallery's own
denominator still reads `/7`, which twelve components already exceed. Criterion 12 says
"gallery renders all 64", so the denominators need reconciling before that criterion can mean
anything. Small, but it is a counted check that currently cannot be satisfied as written.

**41,000 records is the ambition, not the fixture.** The seed has 40 businesses. Claim search
`[2a]` works identically at either scale, but the moderation-is-narrow argument only bites at
the real number, and no query here will have been exercised against it.

**Storage is new surface.** Buckets, policies and signed URLs are the first thing in this
project that stores bytes. Documents hold trade licences and must never be world-readable;
the existing RLS lockdown (`docs/database.md`) means the policies have to be written
deliberately rather than inherited.

**Carried from earlier handoffs, still open:** the contrast and type-size pairings under the
§09.2 floor; the design canvas §02–§07 never supplied; the Supabase phone provider off and
WhatsApp templates `pending_meta`; and the `service_role` key that needs rotating.
