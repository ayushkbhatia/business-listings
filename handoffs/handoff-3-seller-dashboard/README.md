# Handoff 3 — Seller onboarding & dashboard

**Goal:** a supplier can find their own listing, prove they own it, fill it in, and run it
every day without talking to us. This is the handoff that turns 41,000 imported records into
a paying supply side.

**Depends on:** handoffs 0–2. The directory browses, the enquiry engine works, seller accounts
exist as seed fixtures. This handoff replaces those fixtures with a real self-serve path.

**Reference:** boards `2a` `2b` `2c` `2d` `2e` · `8a` `8b` `8c` `8d` `8e` · `3a` `3b` `3c`
`3d` `3e` `3f` `3g` `3h` `3i` `3l` `3m` · `7d` `11a` `11d` `11e` `11f` · flow map `9b` ·
design-system §07 (client column).

---

## The shape of it

Onboarding is **linear and finishes**. Everything after it is a **loop**. Board `9b` draws
this and it is the organising idea of the whole handoff:

```
1l pricing → 2a claim → 2b verify → 2c profile → 2d locations → 2e plan → 8a setup hub → 3a
```

then four recurring loops off the dashboard: the enquiry loop (daily — built in handoff 2),
the catalogue loop (weekly), listing maintenance (as needed), and measure/account (monthly).

The dashboard opens on **what needs a reply**, never on a chart. An SME owner opens this
product to answer someone, not to admire their numbers.

---

## Scope

### Onboarding — linear, five steps

```
/onboarding/claim       Find or add the business                 [2a]
/onboarding/verify      Prove ownership                          [2b]
/onboarding/profile     Profile basics, live preview             [2c]
/onboarding/locations   Locations, hours, Ramadan                [2d]
/onboarding/plan        Pick a plan, goes live                   [2e]
```

**Claim `[2a]`** searches the 41,000 imported records by trade name, licence number or phone.
Three outcomes: match found and unclaimed → claim it; match found but already claimed →
dispute route; no match → add from scratch. Claiming preserves existing reviews and search
history — say so on screen, because a supplier's first fear is that claiming resets them.

**Verify `[2b]`** — two routes, both human-checked, typically within four working hours.
Licence upload (we read number and expiry automatically) or phone verification against the
number on the public licence record. Conflicting claims go to the admin queue built in
handoff 4; here, show the "someone else claimed it" state and take the submission anyway.

**Profile `[2c]`** — trade name locked to the licence, display name editable, primary plus
additional categories, description with a 600-char counter, established year, team size,
logo and cover. Live preview panel showing the search-result card as it will appear, and the
profile-strength meter with the 80% threshold marked.

**Locations `[2d]`** — the `EmirateAreaPicker` and `HoursEditor` components land here. Pin
dragging with the "drag to your gate, not the street" instruction. Ramadan hours as an
automatic toggle. Service radius. Plan caps enforced with the locked-panel pattern.

**Plan `[2e]`** — three tiers, monthly/annual, and the listing is **already live on Free**
before this screen. Nobody is blocked behind a paywall.

### Setup — four independent tasks, resumable

```
/dashboard/setup            Hub with honest time estimates        [8a]
/dashboard/setup/photos     Task 1, with quality feedback         [8b]
/dashboard/setup/products   Task 2, template + first ten          [8c]
/dashboard/setup/team       Task 3, invites + routing             [8d]
/dashboard/setup/visit      Task 4, booking + completion          [8e]
```

Each task returns to the hub. Nothing blocks the listing being live; it all just makes the
listing work. The hub shows profile strength against the 80% marker and states what each task
is worth in percentage points, because a vague "complete your profile" prompt gets ignored.

One WhatsApp reminder after three days if anything is open, then nothing. We do not chase.

### Dashboard — the four loops

```
/dashboard              Overview, Pro                             [3a]
/dashboard (free)       Overview, Free — the upgrade funnel      [11a]
/dashboard/listing      Listing profile, moderated fields         [3b]
/dashboard/locations    Locations & coverage                      [3c]
/dashboard/hours        Hours, holidays, Ramadan                  [3d]
/dashboard/verification Verification ladder & documents           [3e]
/dashboard/products     Catalogue, bulk actions                   [3f]
/dashboard/products/:sku Product editor, template-driven          [3g]
/dashboard/products/import CSV mapper                            [11d]
/dashboard/templates/:slug Spec template, seller clone            [3h]
/dashboard/media        Media library                             [3i]
/dashboard/analytics    Analytics                                 [3l]
/dashboard/billing      Subscription & invoices                   [3m]
/dashboard/billing/change · /cancel · /invoice/:id                [11f]
/dashboard/promote      Sponsored placement                      [11e]
/dashboard/team         Team, roles, lead routing                 [7d]
```

### Tier 4 components — the last three

**HoursEditor** — per-day toggle and time pair, split shifts, copy-to-all-branches, public
holidays, Ramadan block with automatic dates.
**EmirateAreaPicker** — seven emirates, areas nested one level, free zone as a cross-cutting
toggle rather than an area. A JAFZA company is in Dubai *and* in a free zone.
**PlanCard** — three tiers, the recommended one promoted with the tinted shadow, used on
`1l`, `2e` and `11f`.

That completes all 64 components.

---

## The four things that decide whether this handoff works

**1. The free-plan dashboard is the upgrade funnel `[11a]`.** It is not a degraded Pro
dashboard — it is a designed argument. It shows the enquiries the seller *missed* because of
the 3-a-month cap, by date and by requirement, with the blocked state named. Locked panels
show the real feature dimmed with one line naming what unlocks it. Never hide a feature: a
seller cannot want what they cannot see. And Free is a real product, not a trial — nothing
expires.

**2. Spec templates are cloned, not authored `[3h]`.** Admin ships a per-category template;
the seller clones and edits. The seller's fields map back to the platform field so
cross-seller comparison survives a rename — warn before saving a rename, keep the mapping,
never silently drop it. Fields that drive site-wide filters are marked `FILTER` in the editor,
which is what turns boring data entry into "this is why you get found".

**3. The CSV importer must refuse to import prices `[11d]`.** The mapper's blocked state is
in the board: a "Unit Price AED" column maps to "Do not import" with the reason shown. Two
fields in one column ("DI / SS316") offers a split. Every import is reversible for 24 hours
and mappings are saveable for next month.

**4. Moderation is narrow.** Only trade name, category and licence details queue for review.
Photos, hours, products and description publish instantly. Board `3b` shows both states side
by side. If the queue gates everything, it becomes the bottleneck on 41,000 listings and the
whole dashboard feels dead.

---

## Billing

Subscription and sponsored placement only. No commission, no payouts, no order fees.

`[11f]` covers plan change with proration shown line by line, cancel with a plain statement
of what is kept (listing stays live on Free, products saved and hidden, reviews untouched,
badge retained) and what is lost, and a tax invoice with both TRNs. **No retention offer** —
the board says so deliberately: if the product is not worth it we would rather know.

`[11e]` sponsored placement: one slot per subcategory and emirate, not auctioned, waitlist if
taken. Always labelled, never outranks a verified supplier on a filter the buyer explicitly
set. The panel that says "fix the free stuff first — 62 products are missing filterable specs"
is not decoration; it is why sellers trust the upsell.

---

## Team & routing `[7d]`

Four roles: owner, manager, sales, finance. The matrix in design-system §07 is the source of
truth — a sales seat replies and quotes but cannot see invoices, change the plan or touch
licence details.

Lead routing is the setting that protects the response score: round-robin between sales,
by-branch from the buyer's location, or everyone-sees-everything. Escalation to the owner
after a configurable interval, default two hours. Per-person response stats, including the
uncomfortable one — the owner is often the slowest.

---

## Acceptance criteria

1. A supplier can find an unclaimed record, verify by licence upload, complete all five
   onboarding steps and reach the dashboard without staff involvement.
2. Claiming preserves existing reviews and any historical enquiries on that listing.
3. The listing is live on Free before `[2e]`; no step blocks publication.
4. All four setup tasks are independently completable, resumable after logout, and each
   returns to the hub with profile strength updated.
5. A Free-plan seller at their cap sees the missed-enquiry list with real dates and
   requirements, and every locked panel names what unlocks it.
6. Cloning a spec template preserves the mapping to platform fields; renaming a cloned field
   warns before saving and keeps the mapping.
7. A CSV with a price column cannot import prices — the mapper blocks it with the reason
   shown. An import is reversible for 24 hours.
8. Only trade name, category and licence changes enter the moderation queue; photos, hours,
   products and description publish immediately.
9. A `sales` role user is rejected server-side from billing, plan and licence mutations.
10. Plan change prorates correctly and unlocks entitlements within a minute; cancel drops to
    Free at period end, hides products without deleting them, and keeps the verified badge.
11. Response-time and profile-strength figures have no seller-writable path.
12. Axe clean on all dashboard routes; `pnpm build` clean; gallery renders all 64 components.

---

## Out of scope

No admin screens — the moderation queue this handoff feeds is handoff 4. No SEO landing
pages or guides (handoff 5). No storefront builder: it is a superadmin tool and belongs with
admin. No mobile app.

---

## Sequencing

Dashboard before onboarding. The dashboard is where a seller spends their life and it is
harder; onboarding is a five-screen funnel into it and is much easier to get right once you
know what it must produce. Build `3a`/`11a` first, then the catalogue loop (`3f` `3g` `3h`
`3i` `11d`), then listing maintenance (`3b` `3c` `3d` `3e`), then account (`3l` `3m` `7d`
`11e` `11f`), then onboarding and setup last as the on-ramp.
