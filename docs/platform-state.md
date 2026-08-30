# Business Listings — Platform State

**Codebase audit · 30 August 2026 · `main` @ `8fc0ab9`**
PRs #37–#44 merged · every claim verified against the tree · database queried live

Six design handoffs are shipped. Ninety-eight routes render and ninety-five of ninety-seven server actions are wired to a screen. The platform is not blocked on screens — it is blocked on four things underneath them, and one of those breaks a non-negotiable.

---

## Where it stands

| | |
|---|---|
| Page routes | **98** |
| Server actions wired to a UI | **95 / 97** |
| Businesses seeded | **431** |
| Published | **198** |
| Orphaned staff mutations | **8** |
| People who can sign in | **0** |

### The verdict

You have far more working software than a project at this stage usually has. The three surfaces are all built, the enforcement is real — Postgres CHECK constraints, partial unique indexes, triggers, a capability layer — and the audit fence around staff mutations is genuine architecture rather than a convention. The screens are not shells: I checked every exported server action against its call sites, and only two are dead.

What is missing sits one layer below the screens, and it is unglamorous: **nobody can actually sign in**, eight staff mutations exist as definitions nobody calls, one mutation escapes the audit fence entirely, and four of the five background jobs are never scheduled. None of these is a large build. All four are launch blockers, and the third is a breach of your own non-negotiable #3.

My recommendation: **stop building features.** The next unit of work is closing these four gaps and turning on the CI projects that would have caught them. That is roughly a week, and it converts a demo into something you can put a real supplier in front of.

---

## Surface one — the buyer interface

28 public routes under `app/(public)`. The most complete surface — the enquiry funnel works end to end, and the SEO layer from handoff 5 is real rather than decorative.

| Route | Status | Notes |
|---|---|---|
| `/` | Wired | Home search posts to `/search`. The only working search field on the site. |
| `/search` | Wired | Facets, `noindex`, and the zero-result alert capture. |
| `/c/[category]`, `/c/[category]/[sub]` | Wired | Filters, canonicalisation to area pages, spec templates now inherited by subcategories. |
| `/b/[slug]` + 4 children | Wired | Storefront, products, branches, reviews, custom pages. Theming applied, badges exempt. |
| `/b/[slug]/p/[product]` | Wired | Product JSON-LD omits price entirely rather than emitting an empty field. |
| `/rfq/new` | **Partial** | **Drops the pinned supplier** when `?to=` arrives without `?category=`. See findings. |
| `/enquiry/[id]` + 3 children | Wired | Thread, quote comparison, accepted-quote terminal state. The funnel closes. |
| `/account/enquiries` | Wired | Buyer's own enquiries, reachable by magic link. |
| `/compare` | Wired | Tray persists, `noindex`. |
| `/review/new` | Wired | Gated on a real enquiry. |
| `/[emirate]/[area]/[category]` | Wired | Publish floors computed at read time — a thin page stops being indexable in the same request. |
| `/guides`, `/guides/[slug]` | Wired | 1 guide seeded. |
| `/best/[slug]` | Wired | Membership is a comparator in code. Nothing here is purchasable. |
| `/categories` | Wired | Full taxonomy index. |
| `/lp/[campaign]` | Wired | Attribution captured in `proxy.ts`, survives the whole walk to enquiry. |
| `/privacy`, `/terms`, `/review-policy`, `/verification-policy` | **Orphaned** | All four render. **Nothing links to them** — no footer, no nav. A passing test currently pins that absence in place. |
| nav search field | **Inert** | On 27 of 28 pages the header search is an input with no `name` and no form. It cannot submit. |

---

## Surface two — the supplier dashboard

24 routes under `app/(dashboard)`, plus 5 onboarding steps and 4 auth screens. 13 action modules. Every screen has a working form behind it; the blocker is that no supplier can reach any of them.

| Route | Status | Notes |
|---|---|---|
| `/signin`, `/signup`, `/verify`, `/reset` | **Blocked** | Phone OTP fails closed with no SMS provider configured. `/api/auth/send-otp` is one of only two API routes. |
| `/onboarding/claim` → `profile` → `locations` → `verify` → `plan` | Wired | Full 5-step wizard. Mobile Continue button fixed and now covered in CI. |
| `/dashboard` | Wired | Overview with real counts. |
| `/dashboard/leads`, `/dashboard/leads/[id]/thread` | Wired | The core loop. Fan-out now descends into subcategories. |
| `/dashboard/quotes` | Wired | Quote lines are the only place a price legally exists. |
| `/dashboard/products` + `[id]`, `/import` | Wired | CSV import included. |
| `/dashboard/listing`, `/media`, `/locations`, `/hours`, `/team` | Wired | `mediaUrl()` in the media actions is exported and never called — check uploaded images actually display. |
| `/dashboard/verification` | Wired | Submits evidence. Tier itself stays staff-only, correctly. |
| `/dashboard/billing` + `/change`, `/cancel` | Wired | No payment capture, as designed. |
| `/dashboard/analytics` | Thin | Depends on `/api/jobs/measure`, the one job that *is* scheduled. Will populate. |
| `/dashboard/promote` | Wired | Boosts write audit rows. |
| `/dashboard/reviews` | Wired | Reply only. Removal is staff-side and orphaned — see findings. |
| `/dashboard/domain` | **Fail-closed** | `VERCEL_DOMAINS_TOKEN` is blank and `stores.businesslistings.me` is not provisioned. Screen works, integration cannot. |
| `/dashboard/setup`, `/setup/visit`, `/templates`, `/settings` | Wired | Visit scheduling exists; `recordVisit` behind it does not run — see findings. |

---

## Surface three — your staff panel

35 routes under `app/(admin)` — the largest surface, and the one carrying the most risk. 16 action modules. The screens are built and connected; the problem is what sits behind eight of the buttons, and one mutation that skips the fence.

| Route | Status | Notes |
|---|---|---|
| `/admin` | Wired | Queue counts and the day's work. |
| `/admin/queue` + `[id]`, `/conflict/[id]` | Wired | Moderation queue with conflict resolution. |
| `/admin/businesses` | **Partial** | Lists and filters. `setVerificationTier` and `suspendBusiness` have no caller. |
| `/admin/reports` | **Partial** | Supplier reports land. `removeReview` and `editReview` have no caller. |
| `/admin/ingest` + `[id]`, `/dedupe` | **Fence breach** | `dismissCandidate` writes with a bare Prisma update. `stageRun` has no caller. 8,600 staged rows and climbing. |
| `/admin/subscriptions`, `/dunning`, `/invoices`, `/revenue`, `/tax` | **Partial** | Screens read correctly. `issueSubscriptionCredit` has no caller; `runDunning` is never scheduled. |
| `/admin/visits` | **Partial** | `recordVisit` has no caller — visits can be scheduled but never marked done. |
| `/admin/audit` | Wired | Every audited mutation appears here. `reason` is `NOT NULL` and enforced in Postgres. |
| `/admin/content/matrix`, `/guides` + `[id]`, `/home`, `/redirects`, `/attribution` | Wired | Handoff 5's CMS. Content added here costs no deploy — use it. |
| `/admin/categories` | Wired | Rename moves every affected URL and repoints existing redirects to avoid chains. |
| `/admin/storefront-templates` + `[id]`, `/theme`, `/pages`, `/specimens` | Wired | Theme editor with contrast specimens. |
| `/admin/plans`, `/crm`, `/support`, `/search`, `/notifications`, `/spec-library` | Wired | `product_alert_matched` is deliberately declared with no params, so it never emits. A test pins that. |
| `/admin/strings` | By design | Read-only. The locale catalogue is a source file; this is a viewer, not an editor. Correct. |

---

## What is not wired

Ranked by what it costs you.

### 1. An audited mutation escapes the audit fence — BLOCKER

`dismissCandidate` updates `mergeCandidate` with a bare `prisma.mergeCandidate.update`. No `staffMutation`, no `assertCan`, no audit row, no reason. Every other staff write goes through the fence; this one does not.

This is your non-negotiable #3, and it is the kind of thing that is cheap now and a migration later. Dismissing a merge candidate is a judgement call about two real companies — it is exactly the decision you would want a written reason for when a supplier disputes it.

> `lib/dedupe/service.ts` · reachable from `/admin/ingest/dedupe`

### 2. Nobody can sign in — BLOCKER

Staff seats are Prisma rows with no corresponding Supabase auth user, and supplier sign-in is phone OTP with no SMS provider configured, so it fails closed. Both surfaces are reachable today only through test fixtures.

This is why the panels have never been exercised by a person. It is also why the eight orphaned mutations went unnoticed — there was no way to click the buttons.

> `app/(auth)/*` · `app/api/auth/send-otp` · `lib/auth/capabilities.ts`

### 3. Eight staff mutations are defined and never called — BLOCKER

Each is a complete, audited, capability-checked function with tests — and zero references outside its own file and its test. Verified against a control (`publishGuide`, which shows real call sites) to rule out a grep artefact.

`setVerificationTier` · `removeReview` · `editReview` · `suspendBusiness` · `recordVisit` · `issueSubscriptionCredit` · `unmergeBusinesses` · `stageRun`

Read that list as a product statement: **you cannot verify a supplier, remove a bad review, suspend a bad actor, or credit an account.** Those are the four things a marketplace operator does. The logic exists; it needs a server action and a button.

> `lib/verification.ts`, `lib/reviews/*`, `lib/billing/*`, `lib/visits/*`, `lib/dedupe/*`, `lib/ingest/*`

### 4. Four of five background jobs are never scheduled — HIGH

`vercel.json` has exactly one cron: `/api/jobs/measure`, hourly. `runDunning`, `applyEndedCancellations`, `flushDeferred` and `pruneAttempts` have no schedule and no API route to reach them.

Consequence in order of pain: subscriptions that should lapse stay active, dunning never starts, deferred notifications never send, and `auth_attempt` grows without bound (922 rows already).

> `vercel.json` · `app/api/jobs/`

### 5. CI runs half the Playwright suite — HIGH

Eight projects are configured; CI runs four — `chromium`, `mobile`, `seller`, `seller-free`. The three staff projects (`staff`, `staff-moderator`, `staff-finance`) and `setup` never run.

The staff panel is both the least-exercised surface and the one with the most orphaned logic. That is not a coincidence — this line is why.

> `.github/workflows/ci.yml:153`

### 6. A pinned supplier can be dropped from their own enquiry — HIGH

`/rfq/new?to=some-supplier` with no `?category=` falls back to the first `showOnHome` category by sort order. `selectRecipients` then only *sorts* by pinned — it operates on candidates already filtered by that category, so it cannot add a supplier who is not in the set.

A buyer clicking "Request a quote" on a storefront outside that first category gets an enquiry that does not include the supplier they clicked. The code comment claims pinned suppliers are always included; that is true only within the category.

> `app/(public)/rfq/new/page.tsx:38` · `lib/enquiry/fanout.ts`

### 7. The seed does not reset 28 of 73 tables — MEDIUM

`pnpm db:seed` creates 111 businesses. The database holds **431**, of which 198 are published — so two-thirds of what you would see today is accumulated debris, not fixtures. `staged_listing` holds 8,600 rows and grows by 8,000 on every licence-ingest test run; `merge_candidate` holds 416.

This makes every manual test unreliable, because you cannot tell a seeded record from a leftover. Fix the truncate list before you trust anything you click.

> `prisma/seed.ts`

### 8. The nav search does nothing on 27 of 28 pages — MEDIUM

The header `SearchField` has no `name` and sits in no form. The only working search is the one on the home page. Every buyer who lands on a category or storefront page and types into the header gets nothing.

> `app/(public)/_chrome.tsx:19`

### 9. The legal pages are unreachable — MEDIUM

Privacy, terms, review policy and verification policy all render correctly and are linked from nothing. There is no footer. A test asserts the current nav shape, so it stays green while the pages stay orphaned.

For a platform taking subscriptions in the UAE, unreachable terms is a commercial exposure, not a tidiness issue.

> `app/(public)/(legal)/*`

### 10. Two dead exports in the media actions — LOW

`deleteMediaForm` and `mediaUrl` are exported and referenced nowhere. The second matters slightly more than it looks: if nothing calls `mediaUrl`, confirm that uploaded images actually render with a signed URL rather than a broken one.

> `app/(dashboard)/dashboard/media/actions.ts:173,178`

---

## The path to a supplier you can charge

Sequenced because each one makes the next testable. Step 1 first — until people can sign in, nothing below can be verified by a human.

**1. Make sign-in work** — *~1 day, unblocks every manual test below*
Create Supabase auth users for the staff seats and bind them to the Prisma rows. Configure an SMS provider for supplier OTP, or add a dev bypass gated on `NODE_ENV` so the flow is walkable now. Rotate the `service_role` key while you are in there — it was pasted into a chat and is still live.

**2. Fix the audit fence breach** — *~half a day, closes non-negotiable #3*
Route `dismissCandidate` through `staffMutation` with a required reason and an `assertCan` check. Then add a test that fails if any `lib/**` function writes to an audited table outside the fence — the rule should be enforced, not remembered.

**3. Turn on the rest of CI** — *~1 line, then a day fixing what it surfaces*
Add `--project=staff --project=staff-moderator --project=staff-finance` to `ci.yml:153`. Expect red. The red is the point — it is the staff surface reporting its true state for the first time.

**4. Give the eight orphaned mutations a button** — *~2 days*
Verification tier, review removal and edit, suspension, subscription credit, visit completion, unmerge, ingest run. Each needs a server action and a form on the screen that already lists the records. The hard part — the audited, capability-checked service — is done. This is what makes you an operator rather than a directory.

**5. Schedule the four jobs** — *~half a day*
An API route each under `app/api/jobs/`, guarded by `CRON_SECRET` exactly as `measure` is, then four entries in `vercel.json`. Stagger the schedules so they do not collide with the hourly measure run.

**6. Fix the seed, then the three buyer papercuts** — *~1 day*
Add the 28 missing tables to the truncate list so a reseed gives you a known database. Then: give the nav search a form and a `name`, add a footer linking the four legal pages, and carry the pinned supplier's category into `/rfq/new`. Do the seed first, or you cannot verify the other three.

---

## How to test what you have

Every slug below is real and currently in your database — queried rather than read from the seed file. Reseed first: two-thirds of what is in there now is test debris.

### Reset to a known state

Do this before every session. Until the truncate list is fixed, this will *not* clear the 28 tables listed in the findings — `staged_listing` and `merge_candidate` especially will still hold debris.

```bash
pnpm db:seed && pnpm dev
```

### Walk the buyer funnel

The path that works today, and the one that has to keep working. Do it in one sitting, in this order — the enquiry you create in the middle is what makes the later screens non-empty.

- `/` — search "valve" from the home field (the only one that works)
- `/c/valves-and-fittings` — filter by area, watch the canonical change
- `/b/al-areen-industrial-supplies-llc` — storefront, theme applied, badge unthemed
- `/rfq/new?category=valves-and-fittings` — send an enquiry
- `/enquiry/[id]` — the link lands in the buyer's thread

**Expect to see:** no price anywhere on a public surface, and an enquiry action where a price would sit. If you ever see a number outside a quote line, that is a non-negotiable breaking.

### Confirm the two bugs

Both are two-minute checks, and both are worth seeing yourself before deciding how to prioritise them.

- `/rfq/new?to=al-areen-industrial-supplies-llc` — no `?category=`. Check whether Al Areen is actually among the recipients.
- `/c/pipes-and-tubing` — type into the *header* search and press Enter. Nothing happens.

### Check the SEO layer as a crawler sees it

Handoff 5's whole argument is that these hold without a human in the loop.

- `/dubai/al-quoz-industrial-1/hvac-and-ventilation` — live, clears the floors
- `/dubai/ras-al-khor-industrial-2/safety-and-ppe` — deliberately held back, must carry `noindex`
- `/best/hvac-suppliers-al-quoz` — membership by comparator, nothing purchasable
- `/guides/what-supplier-verification-actually-proves`
- `/lp/find-a-supplier?utm_source=test` — then walk to an enquiry and confirm attribution survives
- `/sitemap.xml` — must contain Al Quoz and must *not* contain Ras Al Khor

**The one to actually check:** view source on the product page and search for "price". Zero hits is the pass. An empty `priceSpecification` would be a worse claim than silence.

### Run the suites the way CI does not

CI only runs four of eight Playwright projects. Run the staff ones locally before you touch the admin panel — they have never been green in CI, so treat their current state as unknown rather than passing.

```bash
lsof -ti:3000 | xargs kill -9
```

```bash
pnpm verify && pnpm test:e2e --project=staff --project=staff-moderator --project=staff-finance
```

Kill the stale dev server first — Playwright reuses port 3000 and will silently test an old build.

**Expect failures.** That is the first honest signal you will have had from the staff surface. Fix them before step 4 of the path above, not after.

---

## Corrections

The parallel audit flagged 98 things as missing or stubbed. Verification killed a number of them; these are the ones that mattered, so you know which direction the errors ran.

- **"The admin screens are shells."** False, and it was my working assumption too. I counted every exported server action against its call sites: 95 of 97 are wired to a UI. The gap is at the service layer, not the screen layer — a much better position to be in.
- **"`Business.ratingOverall` is never written."** False. It has a seed-time writer.
- **"`/admin/strings` is a read-only stub."** Read-only, but by design — the locale catalogue is a source file and this is a viewer.
- **"Pinned suppliers are dropped only at the monthly cap."** That is what the code comment says and it is incomplete. Pinning only reorders within the category's candidate set, so a wrong-category fallback drops the supplier before the cap is ever consulted.

---

*Audit performed against `main` at `8fc0ab9` on 30 August 2026. Route counts from the filesystem; record counts queried live against the Supabase instance; every finding above re-verified by hand after the parallel pass, with a control case used to rule out grep artefacts.*
