# Business Listings — Platform State

**Codebase audit · 30 August 2026 · `main` @ `8fc0ab9`**
PRs #37–#44 merged · every claim verified against the tree · database queried live

> **Status, same day.** Everything below was then acted on in PR #45. Eight of the
> ten findings are fixed, one was **wrong** and is corrected in place (finding 7),
> and one is deferred with a reason (finding 3, partially). Each finding carries
> its outcome. The parts that cannot be fixed from inside the repo — Supabase
> project settings, a Meta template approval, an SMTP provider, a key rotation —
> are listed under *Still yours* at the end.

Six design handoffs are shipped. Ninety-eight routes render and ninety-five of ninety-seven server actions are wired to a screen. The platform is not blocked on screens — it is blocked on four things underneath them, and one of those breaks a non-negotiable.

---

## Where it stands

| | |
|---|---|
| Page routes | **98** |
| Server actions wired to a UI | **95 / 97** |
| Businesses seeded | **431** |
| Published | **198** |
| Orphaned staff mutations | ~~8~~ → **2**, both deferred with reasons |
| People who can sign in | ~~0~~ → **anyone with `pnpm dev:seat`** |
| Scheduled jobs | ~~1 of 5~~ → **5 of 5** |
| Playwright projects in CI | ~~4 of 8~~ → **7 of 8** |

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

**Fixed.** `dismissCandidate` goes through `staffMutation` under `business.merge`. Three integration tests pin the audit row, a blank reason, and a moderator. It also closed a hole nobody had recorded: the path had **no capability check at all**, so any staff seat could post to the server action even though the screen 404s for them.

`dismissCandidate` updates `mergeCandidate` with a bare `prisma.mergeCandidate.update`. No `staffMutation`, no `assertCan`, no audit row, no reason. Every other staff write goes through the fence; this one does not.

This is your non-negotiable #3, and it is the kind of thing that is cheap now and a migration later. Dismissing a merge candidate is a judgement call about two real companies — it is exactly the decision you would want a written reason for when a supplier disputes it.

> `lib/dedupe/service.ts` · reachable from `/admin/ingest/dedupe`

### 2. Nobody can sign in — BLOCKER

**Partly fixed — the rest is not in the repo.** The stack was never the problem; it is complete and it works. Three real bugs are fixed: sign-in *failed open* (it discarded the Supabase error and said "code sent" even when the phone provider was off, so people waited for a code that was never generated), signing up as a seeded seat returned a **500** on a P2002, and a session whose claim write failed stayed roleless forever. `pnpm dev:seat <kind>` now provisions a seat and prints a working code — walked end to end in a browser to `/admin`. Enabling `external.phone`, the auth hook, the Meta template and real SMTP still need the Supabase dashboard.

Staff seats are Prisma rows with no corresponding Supabase auth user, and supplier sign-in is phone OTP with no SMS provider configured, so it fails closed. Both surfaces are reachable today only through test fixtures.

This is why the panels have never been exercised by a person. It is also why the eight orphaned mutations went unnoticed — there was no way to click the buttons.

> `app/(auth)/*` · `app/api/auth/send-otp` · `lib/auth/capabilities.ts`

### 3. Eight staff mutations are defined and never called — BLOCKER

**Five of eight fixed. Three deferred, and one was misclassified.** Wired: `setVerificationTier`, `suspendBusiness`, `liftSuspension`, `unmergeBusinesses` (which needed a new `recentMerges` reader — nothing listed reversible merges), `issueSubscriptionCredit`, `stageRun`. Deferred with reasons under *Still yours*: `recordVisit` needs a geotagged photo upload path that does not exist admin-side, and `removeReview` has no host screen — **no admin screen lists reviews at all**, and `SupplierReport` has no `reviewId` to join on. `editReview` was on this list wrongly: it takes a `buyerId`, asserts no capability and writes no audit row. It is a *buyer* action with a 14-day window, and putting it behind a staff screen would let staff rewrite a buyer's published words untracked.

Each is a complete, audited, capability-checked function with tests — and zero references outside its own file and its test. Verified against a control (`publishGuide`, which shows real call sites) to rule out a grep artefact.

`setVerificationTier` · `removeReview` · `editReview` · `suspendBusiness` · `recordVisit` · `issueSubscriptionCredit` · `unmergeBusinesses` · `stageRun`

Read that list as a product statement: **you cannot verify a supplier, remove a bad review, suspend a bad actor, or credit an account.** Those are the four things a marketplace operator does. The logic exists; it needs a server action and a button.

> `lib/verification.ts`, `lib/reviews/*`, `lib/billing/*`, `lib/visits/*`, `lib/dedupe/*`, `lib/ingest/*`

### 4. Four of five background jobs are never scheduled — HIGH

**Fixed.** Two new routes grouped by cadence — `/api/jobs/sweep` hourly and `/api/jobs/daily` — plus the `CRON_SECRET` guard extracted to `lib/jobs/authorize.ts` so there is one copy, and the first tests `app/api/jobs/` has ever had. One caveat kept visible rather than papered over: `flushDeferred` moves a delivery from `deferred` to `queued`, and **nothing reads `queued`**. Scheduling it is necessary and not sufficient.

`vercel.json` has exactly one cron: `/api/jobs/measure`, hourly. `runDunning`, `applyEndedCancellations`, `flushDeferred` and `pruneAttempts` have no schedule and no API route to reach them.

Consequence in order of pain: subscriptions that should lapse stay active, dunning never starts, deferred notifications never send, and `auth_attempt` grows without bound (922 rows already).

> `vercel.json` · `app/api/jobs/`

### 5. CI runs half the Playwright suite — HIGH

**Fixed.** All three staff projects run in CI. The suite is green — 145 tests — which took fixing one genuinely red test: saving a new guide worked and said nothing, because moving the address from `new` onto the guide's id changes a dynamic segment, so Next re-resolves the route and remounts the editor.

Eight projects are configured; CI runs four — `chromium`, `mobile`, `seller`, `seller-free`. The three staff projects (`staff`, `staff-moderator`, `staff-finance`) and `setup` never run.

The staff panel is both the least-exercised surface and the one with the most orphaned logic. That is not a coincidence — this line is why.

> `.github/workflows/ci.yml:153`

### 6. A pinned supplier can be dropped from their own enquiry — HIGH

**Fixed**, and in `findFanoutCandidates` rather than at the seven `?to=` call sites, so the comparison tray's four-suppliers-from-four-trades case is covered too. Two adjacent ways the same supplier could vanish went with it: `take: 60` had no `orderBy`, and the page's pinned lookup did not match the fan-out's `claimStatus` filter.

`/rfq/new?to=some-supplier` with no `?category=` falls back to the first `showOnHome` category by sort order. `selectRecipients` then only *sorts* by pinned — it operates on candidates already filtered by that category, so it cannot add a supplier who is not in the set.

A buyer clicking "Request a quote" on a storefront outside that first category gets an enquiry that does not include the supplier they clicked. The code comment claims pinned suppliers are always included; that is true only within the category.

> `app/(public)/rfq/new/page.tsx:38` · `lib/enquiry/fanout.ts`

### 7. The seed does not reset 28 of 73 tables — ~~MEDIUM~~ **WRONG**

**This finding was wrong, and it is left here rather than deleted because it is
the most instructive mistake in the audit.**

The claim was that `pnpm db:seed` leaves 28 of 73 tables untouched, and that
`staged_listing` (8,600 rows) and `merge_candidate` (416) hold debris after a
reseed. It was derived by reading the truncate list and diffing it against the
schema's models — which is exactly the kind of reasoning that looks rigorous and
is not.

`truncate … cascade` also empties every table holding a foreign key to a named
one, transitively, whatever the `ON DELETE` action says. Measured after a clean
reseed:

| | audit claimed | actually |
|---|---|---|
| `staged_listing` | 8,600 | **0** |
| `merge_candidate` | 416 | **0** |
| businesses | 431 | **111**, exactly what the seed writes |

Twenty-six of the twenty-eight are already cleared. The 431 businesses were real
but were stale debris from runs where nobody reseeded — not something the seed
misses.

**One table genuinely survived**: `auth_attempt`, which has no relations at all,
so nothing reaches it. It is named in the list now. `ranking_weights` also
survives and deliberately stays out — its singleton row comes from a migration
and never from the seed, so truncating it would leave `liveWeights()` returning
null for good.

The real fix for production, where no seed ever runs, is scheduling
`pruneAttempts` — finding 4.

### 8. The nav search does nothing on 27 of 28 pages — MEDIUM

**Fixed.** A real GET form, unnamed so axe does not see two identically-named landmarks on the home page.

The header `SearchField` has no `name` and sits in no form. The only working search is the one on the home page. Every buyer who lands on a category or storefront page and types into the header gets nothing.

> `app/(public)/_chrome.tsx:19`

### 9. The legal pages are unreachable — MEDIUM

**Fixed.** All four linked, with a test that clicks each one through to its page — the existing test fetched the paths directly and would have passed however unreachable they were.

Privacy, terms, review policy and verification policy all render correctly and are linked from nothing. There is no footer. A test asserts the current nav shape, so it stays green while the pages stay orphaned.

For a platform taking subscriptions in the UAE, unreachable terms is a commercial exposure, not a tidiness issue.

> `app/(public)/(legal)/*`

### 10. Two dead exports in the media actions — LOW

**Fixed.** Both removed.

`deleteMediaForm` and `mediaUrl` are exported and referenced nowhere. The second matters slightly more than it looks: if nothing calls `mediaUrl`, confirm that uploaded images actually render with a signed URL rather than a broken one.

> `app/(dashboard)/dashboard/media/actions.ts:173,178`

---

## Still yours

Everything else in this document was done in PR #45. These are the parts that
could not be, and why.

### Outside the repo — needs the Supabase dashboard

The auth stack works; the project it talks to is not configured for phone.

- Enable `external.phone`. Until then the phone leg is dead — and now says so,
  instead of sending people to wait for a code that was never generated.
- Register `/api/auth/send-otp` under **Authentication → Hooks** with the same
  `AUTH_HOOK_SECRET` that is already in `.env.local`.
- Set the project OTP length to **6** and the expiry to **600s**, to match
  `OTP_LENGTH` and `OTP_EXPIRY_MINUTES`. The verify screen says "6 digits" and
  the project currently issues 8.
- Get the Meta authentication template approved, and replace the built-in SMTP,
  which sends two messages an hour.
- **Rotate the `service_role` key.** It was pasted into a chat and is still
  live. This one is not optional.

Until those land, `pnpm dev:seat <kind>` is how anybody signs in.

### Two mutations still without a screen

Both were deferred on purpose rather than half-built.

- **`recordVisit`** needs a visit report: a date, three booleans, and at least
  two geotagged photographs, each with a `mediaId`, coordinates and a timestamp.
  The coordinates are re-checked against a UAE bounding box by a database CHECK
  constraint, so this is a real form, not a row strip — and there is **no
  admin-side media upload path** today; the only `FileDrop` wiring is
  seller-side. It also blocks something visible: `setVerificationTier`'s subject
  check reads `Business.visitedByStaffId`, which only `recordVisit` writes, so
  until it exists a field verifier sees no tier control anywhere and only an ops
  lead can set one.
- **`removeReview`** has nowhere to live. **No admin screen lists reviews at
  all**, and `SupplierReport` has a `review_integrity` kind but no `reviewId` to
  join on — only free text. So this is a choice between a migration that adds
  the column and a new `/admin/reviews` screen over `Review` directly. Worth
  knowing: `components/domain/ModerationRow.tsx` was built for exactly this and
  has only ever rendered in `/dev/gallery`. Also note `review.remove` is **ops
  lead only** — a moderator may resolve a supplier report and may not remove the
  review it is about.

### One gap a cron does not close

`flushDeferred` is scheduled now, and it moves a delivery from `deferred` to
`queued`. **Nothing in the codebase reads `queued`.** There is no carrier
hand-off, so a released notification still reaches nobody. The route says so in
its own docblock rather than letting the cron entry imply otherwise.

### Vercel's cron allowance

Three entries now (`measure`, `sweep`, `daily`). Hobby caps at two and allows
daily granularity only. If the project is on Hobby, fold `sweep` into `measure`
and lose the independent failure isolation.

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

### Confirm the two bugs are gone

Both were two-minute checks and both are now the other way round.

- `/rfq/new?to=al-areen-industrial-supplies-llc` — no `?category=`. Al Areen is
  among the recipients, and the eyebrow names *their* trade rather than the first
  category on the home page.
- `/c/pipes-and-tubing` — type into the *header* search and press Enter. It goes
  to `/search`.

### Check the SEO layer as a crawler sees it

Handoff 5's whole argument is that these hold without a human in the loop.

- `/dubai/al-quoz-industrial-1/hvac-and-ventilation` — live, clears the floors
- `/dubai/ras-al-khor-industrial-2/safety-and-ppe` — deliberately held back, must carry `noindex`
- `/best/hvac-suppliers-al-quoz` — membership by comparator, nothing purchasable
- `/guides/what-supplier-verification-actually-proves`
- `/lp/find-a-supplier?utm_source=test` — then walk to an enquiry and confirm attribution survives
- `/sitemap.xml` — must contain Al Quoz and must *not* contain Ras Al Khor

**The one to actually check:** view source on the product page and search for "price". Zero hits is the pass. An empty `priceSpecification` would be a worse claim than silence.

### Run the suites

CI runs seven of eight projects now (`setup` is pulled in as a dependency rather
than named). The staff trio is the part that never ran.

```bash
lsof -ti:3000 | xargs kill -9
```

```bash
pnpm verify && pnpm test:e2e --project=staff --project=staff-moderator --project=staff-finance
```

Kill the stale dev server first — Playwright reuses port 3000 and will silently test an old build.

**Expect them to pass** — 145 of 145. The audit predicted red here and was
wrong: the staff surface had exactly one genuinely failing test, not a broken
panel. That prediction is in the Corrections below.

---

## Corrections

The parallel audit flagged 98 things as missing or stubbed. Verification killed a number of them; these are the ones that mattered, so you know which direction the errors ran.

- **"The admin screens are shells."** False, and it was my working assumption too. I counted every exported server action against its call sites: 95 of 97 are wired to a UI. The gap is at the service layer, not the screen layer — a much better position to be in.
- **"`Business.ratingOverall` is never written."** False. It has a seed-time writer.
- **"`/admin/strings` is a read-only stub."** Read-only, but by design — the locale catalogue is a source file and this is a viewer.
- **"Pinned suppliers are dropped only at the monthly cap."** That is what the code comment says and it is incomplete. Pinning only reorders within the category's candidate set, so a wrong-category fallback drops the supplier before the cap is ever consulted.

And three the audit itself got wrong, found only by acting on it:

- **"The seed leaves 28 tables holding debris."** Wrong — see finding 7. Derived
  by reading a truncate list instead of querying the database.
- **"Turn on the staff CI projects. Expect red."** Wrong. 141 of 142 passed on
  the first run. The surface was under-tested, not broken, and the difference
  matters: the recommendation was "budget a day for what it surfaces" when the
  honest answer was "one test, half an hour".
- **"`editReview` is an orphaned staff mutation."** Misclassified. It takes a
  `buyerId`, asserts no capability and writes no audit row — a buyer action with
  a 14-day window. Wiring it into a staff screen would have let staff rewrite a
  buyer's published words with no audit trail, which is the opposite of the
  non-negotiable it appeared to serve.

---

*Audit performed against `main` at `8fc0ab9` on 30 August 2026, and acted on the same day in PR #45. Route counts from the filesystem; record counts queried live against the Supabase instance; every finding above re-verified by hand after the parallel pass, with a control case used to rule out grep artefacts.*
