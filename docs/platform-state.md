# Business Listings — Platform State

**Codebase audit · 30 August 2026 · `main` @ `8fc0ab9`**
PRs #37–#44 merged · every claim verified against the tree · database queried live

> **Status.** Everything below was acted on in PR #45, and the job schedule was
> revised in PR #46. Eight of the ten findings are fixed, one was **wrong** and is
> corrected in place (finding 7), and one is partly deferred with reasons
> (finding 3). Each finding carries its outcome.
>
> **Two of the four blockers are fully closed** — the audit fence and the
> background jobs. Sign-in is fixed in code and waiting on provisioning that is
> not in this repository. **All eight orphaned mutations now have a caller** —
> `removeReview` gained `/admin/reviews` and `recordVisit` gained a report form
> and the admin upload path it needed. `editReview` left the list as a
> misclassification: it is a buyer action, not a staff one.
>
> The three surface tables describe the platform **as it is now**, not as the
> audit found it. They were left stale for a while after the findings below were
> updated, which made this document contradict itself — worth knowing if you read
> a copy of it from before that was fixed. The parts that cannot be fixed from
> inside the repo — Supabase project settings, a Meta template approval, an SMTP
> provider, a key rotation — are under *Still yours* at the end.

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
| `/rfq/new` | Wired | Was dropping the pinned supplier when `?to=` arrived without `?category=`. Fixed in `findFanoutCandidates`, so the comparison tray's multi-trade case is covered too. |
| `/enquiry/[id]` + 3 children | Wired | Thread, quote comparison, accepted-quote terminal state. The funnel closes. |
| `/account/enquiries` | Wired | Buyer's own enquiries, reachable by magic link. |
| `/compare` | Wired | Tray persists, `noindex`. |
| `/review/new` | Wired | Gated on a real enquiry. |
| `/[emirate]/[area]/[category]` | Wired | Publish floors computed at read time — a thin page stops being indexable in the same request. |
| `/guides`, `/guides/[slug]` | Wired | 1 guide seeded. |
| `/best/[slug]` | Wired | Membership is a comparator in code. Nothing here is purchasable. |
| `/categories` | Wired | Full taxonomy index. |
| `/lp/[campaign]` | Wired | Attribution captured in `proxy.ts`, survives the whole walk to enquiry. |
| `/terms`, `/privacy`, `/cookies` | Wired | Boards 13f, 13g and 13h on the shared `LegalPage` template — 16 clauses, 12 sections, and a register of nine cookies. Content is `lib/legal/documents.ts` over `lib/i18n/en.ts`; a change costs a deploy. |
| `/review-policy`, `/verification-policy` | Wired | Still board 10j's wording-in-a-row renderer, reading `legal_page`. Linked from the footer on every page, with a test that clicks each one through. |
| Cookie consent — banner, `/cookies/settings`, GPC | Owed | The cookie policy asserts all three and none is built. `bl_consent` is not set, so no consent state exists to honour. |
| Cookie register vs. what the code sets | Drifted | `bl_attr` is set by `proxy.ts` and is not in the register; the session cookie the register calls `bl_session` is Supabase's `sb-*`. Pinned in `lib/legal/cookie-register.test.ts`. |
| nav search field | Wired | A real GET form now. Was an input with no `name`, in no form, inert on 27 of 28 pages. |

---

## Surface two — the supplier dashboard

24 routes under `app/(dashboard)`, plus 5 onboarding steps and 4 auth screens. 13 action modules. Every screen has a working form behind it; the blocker is that no supplier can reach any of them.

| Route | Status | Notes |
|---|---|---|
| `/signin`, `/signup`, `/verify`, `/reset` | **Partial** | The code is fixed — sign-in no longer fails open, a seeded-seat signup no longer 500s, and a failed claim write repairs itself. Reaching a real person still needs SMTP and the Supabase phone provider. `pnpm dev:seat <kind>` signs you in today. |
| `/onboarding/claim` → `profile` → `locations` → `verify` → `plan` | Wired | Full 5-step wizard. Mobile Continue button fixed and now covered in CI. |
| `/dashboard` | Wired | Overview with real counts. |
| `/dashboard/leads`, `/dashboard/leads/[id]/thread` | Wired | The core loop. Fan-out now descends into subcategories. |
| `/dashboard/quotes` | Wired | Quote lines are the only place a price legally exists. |
| `/dashboard/products` + `[id]`, `/import` | Wired | CSV import included. |
| `/dashboard/listing`, `/media`, `/locations`, `/hours`, `/team` | Wired | The dead `mediaUrl()` export is gone; the page calls `publicUrl` directly, so images do display. |
| `/dashboard/verification` | Wired | Submits evidence. Tier itself stays staff-only, correctly. |
| `/dashboard/billing` + `/change`, `/cancel` | Wired | No payment capture, as designed. |
| `/dashboard/analytics` | Thin | Fed by the measurements in `/api/jobs/daily`, which run nightly. Numbers appear after the first run against real traffic; nothing to build. |
| `/dashboard/promote` | Wired | Boosts write audit rows. |
| `/dashboard/reviews` | Wired | Reply only. Removal is staff-side and orphaned — see findings. |
| `/dashboard/domain` | **Fail-closed** | The screen works; the integration cannot. Needs `VERCEL_DOMAINS_TOKEN` and `stores.businesslistings.me` provisioned — both outside the repo. Refuses rather than pretending, which is the intended behaviour until then. |
| `/dashboard/setup`, `/setup/visit`, `/templates`, `/settings` | Wired | Visit scheduling exists; `recordVisit` behind it does not run — see findings. |

---

## Surface three — your staff panel

35 routes under `app/(admin)` — the largest surface, and the one carrying the most risk. 16 action modules. The screens are built and connected; the problem is what sits behind eight of the buttons, and one mutation that skips the fence.

| Route | Status | Notes |
|---|---|---|
| `/admin` | Wired | Queue counts and the day's work. |
| `/admin/queue` + `[id]`, `/conflict/[id]` | Wired | Moderation queue with conflict resolution. |
| `/admin/businesses` | Wired | Tier, suspend and lift all have a control, gated per row and per seat. The screen also had **no capability gate at all** — line 23 was dead code — and now has one. |
| `/admin/reports` | Wired | Supplier reports land. `removeReview` has a screen of its own at `/admin/reviews` — reports are one route to a bad review, not the only one. `editReview` left this row: it is a buyer action, not a staff one. |
| `/admin/ingest` + `[id]`, `/dedupe` | Wired | `dismissCandidate` is inside the fence, `stageRun` has an upload form, and `unmergeBusinesses` has a screen with the reader it needed. The "8,600 staged rows" in the first draft of this audit was wrong — the table is empty after a reseed. |
| `/admin/subscriptions`, `/dunning`, `/invoices`, `/revenue`, `/tax` | Wired | `issueSubscriptionCredit` has a panel, gated on `subscription.credit` alone rather than the page's wider OR. `runDunning` runs daily. |
| `/admin/visits` | Wired | A request links to a report at `/admin/visits/[id]`: date, three separate findings, and at least two geotagged photographs. The admin upload path it needed was built with it. |
| `/admin/reviews` | Wired | Removal with a ground and a written reason, ops lead only. Removed reviews stay listed and marked. |
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

`vercel.json` had exactly one cron: `/api/jobs/measure`, hourly. `runDunning`, `applyEndedCancellations`, `flushDeferred` and `pruneAttempts` have no schedule and no API route to reach them.

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

The auth stack works. Every Bird variable and `AUTH_HOOK_SECRET` are already
set. Nothing here is a code change.

**The quickest way to a working sign-in is email, not WhatsApp.** Point Supabase
at a real SMTP provider — Project Settings → Auth → SMTP — and the email OTP
path works immediately: `normaliseIdentifier` already accepts an address,
`startSignIn` already handles one, and `pnpm dev:seat` proves the whole
`verifyOtp` → `adoptProfile` → `syncClaims` chain on it. The built-in sender
exists for development and sends two messages an hour, which is the only reason
that path is not usable today.

WhatsApp is the slower half and is not blocked on us:

- **A Meta-approved authentication template.** Category `authentication`, one
  `otp` variable. Meta approves it, not Bird, and the WhatsApp Business number
  must clear business verification first. Days, not hours.
- **Enable `external.phone`.** Until then the phone leg is dead — and now says
  so, instead of sending people to wait for a code that was never generated.
- **Register `/api/auth/send-otp`** under Authentication → Hooks with the same
  `AUTH_HOOK_SECRET`.
- **Set the project OTP length to 6 and the expiry to 600s**, to match
  `OTP_LENGTH` and `OTP_EXPIRY_MINUTES`. The verify screen says "6 digits" and
  the project currently issues 8.

Two more, both easy to miss:

- **Copy the secrets into Vercel.** `BIRD_*`, `AUTH_HOOK_SECRET` and
  `CRON_SECRET` live only in `.env.local`. `resolveOtpSender` deliberately
  throws in production rather than falling back to the console sender, so the
  first production sign-in fails without them — and the cron routes answer 500
  without `CRON_SECRET`.
- **Rotate the `service_role` key.** It was pasted into a chat and is still
  live. This one is not optional.

Until the mail provider is set, `pnpm dev:seat <kind>` is how anybody signs in.

### Nothing in the orphan list

All eight have a caller. The last two landed together: `/admin/reviews` for
`removeReview`, and `/admin/visits/[id]` for `recordVisit` — the latter needed a
staff-side media upload path, which is why it was last. Visit photographs are a
`visit` media kind in the private document bucket, read through a signed URL,
because `lib/storefront/blocks.ts` renders `gallery` and a verifier's
photographs of somebody's warehouse are not that supplier's marketing.

Recording a visit also unblocked something that had been quietly broken:
`setVerificationTier`'s subject check reads `Business.visitedByStaffId`, and
until `recordVisit` had a screen only the seed ever wrote it — so a field
verifier saw no tier control anywhere.

### One gap a cron does not close

`flushDeferred` is scheduled now, and it moves a delivery from `deferred` to
`queued`. **Nothing in the codebase reads `queued`.** There is no carrier
hand-off, so a released notification still reaches nobody. The route says so in
its own docblock rather than letting the cron entry imply otherwise.

### Vercel's cron allowance

**Two** entries, not the three this section used to claim: `/api/jobs/sweep` on
`42 * * * *` and `/api/jobs/daily` on `23 20 * * *`. `measure` has no entry —
the advice that used to sit here, to fold `sweep` into `measure`, named a cron
that does not exist.

The count is now inside the Hobby cap of two. The **schedule** is the open
question: Hobby allows daily granularity only, and `sweep` asks for hourly. Which
plan the project is on is not inferable from the repo, and a deploy carrying an
hourly schedule succeeds either way, so a green deployment is not evidence that
`sweep` runs hourly.

Settle it in the dashboard — Settings → Cron Jobs lists each job with the
schedule Vercel actually registered, which is the only place the two can be seen
to disagree. If the project is on Hobby, `sweep` runs once a day whatever the
expression says, and the hourly sweep that `docs/deployments.md` documents is not
happening.

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

---

## What is left, in one place

Nothing in this repository blocks a launch. Everything below is either
provisioning outside it, or a decision.

### Provisioning — yours

1. **DNS for `businesslistings.me` at Spaceship.** The single thing between
   "sign-in works" and "a supplier can sign up". Resend refuses to send from an
   unverified domain, so email today reaches one address. The authoritative
   nameserver serves none of Resend's records.
2. **Rotate the `service_role` key.** It was pasted into a chat and is still
   live.
3. **Secrets into Vercel** — `BIRD_*`, `AUTH_HOOK_SECRET`, `CRON_SECRET`,
   `RESEND_API_KEY`, `RESEND_FROM`. `resolveOtpSender` throws in production
   rather than falling back to the console sender, and the cron routes answer
   500 without `CRON_SECRET`.
4. **OTP length 6, expiry 600s** in Supabase. The project issues eight digits
   while the verify screen says six.
5. **A public address.** `businesslistings.me` has no A record and the Vercel
   deployment sits behind SSO protection, so nothing is reachable from outside.

### Decisions — not mechanical, so not made unattended

- **`business_sector_id_fkey`.** The one statement `prisma migrate diff` still
  reports. Declaring the relation gets the diff to zero and makes a CI drift
  check trivial; leaving it means anybody running `migrate dev` drops the
  constraint. It is now the *only* thing that command would do, which makes it
  more exposed than when it hid among nine index drops.
- **`flushDeferred` writes `queued`, and nothing reads it.** Releasing a
  quiet-hours notification moves it from one waiting state to another. Closing
  it means re-rendering a delivery from its row — `NotificationDelivery` stores
  the recipient, event and channel but not the body — which wants a path out of
  `events.ts` that does not exist.
- **WhatsApp OTP** waits on Meta approving an authentication template. Not ours
  to grant, and email works without it.
