# Handoff 4 — progress

Working state for an autonomous run through `docs/roadmap-handoff-4.md`. Updated at the end
of every PR. If you are picking this up cold, read the roadmap first, then this.

**Cadence:** branch → build → `pnpm verify` and `pnpm test:e2e` green locally → PR → CI green
→ squash merge → next step. No direct pushes to `main`.

**Standing authorisation (2026-08-26):** merge own PRs when CI is green and start the next
sprint without asking, through to the end of the handoff.

---

## Done

| PR | What | Merged |
|---|---|---|
| [#18](https://github.com/ayushkbhatia/business-listings/pull/18) | Step 0 — `requireStaff`, the admin shell, board 4a, criterion 9 written first, six DataTable capabilities | `e5aff31` |
| [#19](https://github.com/ayushkbhatia/business-listings/pull/19) | Step 1a — boards 4b/4c, the four-way claim resolution, the DataTable column bug | `1208f52` |
| [#20](https://github.com/ayushkbhatia/business-listings/pull/20) | Step 1b — boards 4d/4e, `specCompleteness` measured, versioning corrected | `1a2262e` |
| [#21](https://github.com/ayushkbhatia/business-listings/pull/21) | Step 2a — board 12a, the licence importer, the silent CSV truncation | `c84209f` |
| [#22](https://github.com/ayushkbhatia/business-listings/pull/22) | Step 2b — board 12b, dedupe and the reversible merge, the 301 resolver | `e864692` |
| [#23](https://github.com/ayushkbhatia/business-listings/pull/23) | Step 3 — boards 4h/4i/12h, the visit report the tier check was waiting for | `991fcf9` |
| [#24](https://github.com/ayushkbhatia/business-listings/pull/24) | Step 4 — boards 4f/12d/12f, view-as and a call list with no insert path | merged |
| [#25](https://github.com/ayushkbhatia/business-listings/pull/25) | Step 5 — boards 4g/12e, the MRR ledger, dunning, grandfathering that grandfathers | `531046d` |
| [#26](https://github.com/ayushkbhatia/business-listings/pull/26) | Step 6a — the storefront template model, and a sector column the database keeps | `386856c` |
| [#27](https://github.com/ayushkbhatia/business-listings/pull/27) | Step 6b — fourteen sections that render, and the page that proves it | `ffdbffb` |
| [#28](https://github.com/ayushkbhatia/business-listings/pull/28) | Step 6c — the builder, and a publish that says what it is about to do | `4eabc20` |
| [#29](https://github.com/ayushkbhatia/business-listings/pull/29) | Step 6e — the storefront renders from its template | `0539933` |
| [#30](https://github.com/ayushkbhatia/business-listings/pull/30) | Step 6d(i) — themes, and the floor a seller's own colour has to clear | `258e779` |
| [#31](https://github.com/ayushkbhatia/business-listings/pull/31) | Step 6d(ii) — domain verification, and a certificate that says it is not issued | `dfe5c34` |
| [#32](https://github.com/ayushkbhatia/business-listings/pull/32) | Step 6d(iii) — pages on every storefront, and a slug that stops moving | `31997a3` |
| [#33](https://github.com/ayushkbhatia/business-listings/pull/33) | Step 7a — the page matrix, and a gate that stopped passing vacuously | open |

## Next

**Step 7b — notification templates and localisation `[12g]`**, plus redirects and homepage
curation.

`NotificationTemplate` is already read by `lib/notify/events.ts` and `service.ts`, so that
editor changes what actually sends — the good case. `Redirect` is read by
`lib/listing/redirect.ts` and by the template-page route.

**Localisation is the honest one.** The catalogue is `lib/i18n/en.ts`, a compile-time file
`t()` is type-checked against. A live editor would need a runtime override table read by `t()`,
which is an architecture change nobody has asked for, and CLAUDE.md says Arabic is "a later
translation project, not a rebuild". Plan: a read-only browser with coverage stats, and say
plainly that editing belongs to that project rather than shipping a form that cannot write.

**Step 8 — the acceptance pass**, and `scripts/acceptance-handoff-4.sh`.

## What step 7a found

- **`tests/integration/domains.test.ts` broke `account.spec.ts` at a distance.** I shipped it
  in #31. It borrowed the first claimed business with a seller owner — the e2e Pro seat — and
  deleted its subscription without restoring it, so the cancel page had nothing to describe.
  It builds its own listing now. Third time this session that a fixture reaching into shared
  data has broken somebody else's test.
- **`categoryHealth` took `introWords` as a parameter defaulting to `MAX_SAFE_INTEGER`.** The
  third publish gate passed vacuously on every page since handoff 0, because there was nowhere
  for a category's copy to live. `Category.intro` is that place.
- **The `.first()` region assertions were right and unclear.** "The reply queue is the first
  panel" is the claim and `.first()` expresses it — but it reported "the page did not render"
  and "the queue is not first" identically, which cost twenty confusing minutes on a red main.
  Both now assert the named panel exists *and* that it is first.

## What step 6d(iii) found

- **The page route put a second `h1` on the storefront.** `StorefrontHeader` already carries
  one and it is the business name. Two is two answers to "what is this page about", and every
  other sub-page already used `h2`.
- **The seeded About page scored 2 of 4, not the 3 its own comment claimed.** 191 words against
  a 250 bar. The copy was extended rather than the comment corrected — a seed page that fails
  the bar it ships with is a poor demonstration of the bar.
- **`Panel` puts its title in a header div**, so `getByRole("heading").locator("..")` selects
  the header rather than the body. Third time; the fix each time is to give the thing an
  accessible name and address it by that.

## What step 6d(ii) found

- **`checkHostname` refused our own apex with the wrong message.** `businesslistings.me` is
  both ours and an apex, and the apex check fired first — a seller told it was an apex would
  go and try `shop.businesslistings.me`. The more specific refusal wins now.
- **The poller runs on the measure job's cadence, not the board's sixty seconds.** Said out
  loud in the route rather than left to be noticed: a seller watching the screen sees
  `Waiting` for longer than board 5e describes. Its own schedule is the honest fix, and it is
  worth doing when there is a certificate provider to make verification mean something.

## What step 6d(i) found

- **The contrast maths lived only in `scripts/contrast-audit.mts`.** Fine while contrast was
  only audited; criterion 5 makes it a rule the product enforces, and two implementations of
  WCAG relative luminance eventually disagree — the audit saying one thing and the form
  another about the same hex. It is `lib/theme/contrast.ts` now, and the script imports it.
- **The brand floor is measured against `--paper`, not white.** The criterion says "against
  white"; the page background is `#FAF9F6`, so paper is stricter and is the surface the colour
  is actually painted on. A test pins the constant to the token.
- **Both raw-hex checks — the shell script and the eslint rule — flagged the new files.**
  Rather than weaken either, three sites carry a written exemption: the arithmetic constant,
  its test, and a placeholder that has to look like a hex to show what is being asked for.

## What step 6e found

- **`Document` has no title and no validity dates.** `filename`, `kind` and `mimeType` are the
  whole of it. The board's Certifications card draws an expiry beside each one; that needs
  columns nobody has argued for, so the card shows what exists. Carried forward.
- **The document bucket is private, and storefront pages are cached for five minutes.** A
  signed URL baked into a cached page outlives its own expiry. Documents link to
  `/b/:slug/d/:id`, which signs at request time and 404s for a licence, a mismatched business
  or an unpublished one.
- **A pure template rewrite would have dropped the licence panel, the masked TRN, the contact
  card and the verification ladder.** None of the fourteen section types covers them. They are
  chrome now, outside the template, and the argument is non-negotiable 2: a trust signal that a
  template can reorder or switch off is not one that renders identically on every storefront.

## What step 6c found

- **A staff e2e test that performs an audited mutation broke seat provisioning.**
  `audit_event.actor_id` is `Restrict` — correctly — so once the ops lead owned audit rows,
  `auth.setup.ts` could no longer delete and recreate that user, and every later run failed in
  setup rather than anywhere informative. Provisioning now reuses an existing seat, which is
  also closer to what a seat is.
- **One reason field for edits and publish was wrong.** The edit consumed it and the publish
  button sat there dead with nothing saying why. Publishing is its own decision with its own
  version row, so it has its own field.
- **`BuilderChrome` left its bar outside every landmark.** A `header` that is not a direct
  child of `body` carries no role. It became a `banner` when it owns the page — and the first
  attempt moved the toolbar onto the ink surface, which put an unselected tab at 3.69:1 and was
  caught by the gallery's contrast set within one run.
- **A controlled checkbox driven by a server action shows the old value until the round-trip
  lands.** The builder keeps an optimistic map, cleared when the server refuses.

## What step 6b found

- **`/b/[slug]/reviews` rendered a review as inline JSX.** The storefront Reviews section
  needed the same markup and the choice was copy or extract. `ReviewCard` is component 67, used
  in both, for the reason the inventory's own `Thread` note gives.
- **The fourteen sections are not in the component inventory, deliberately.** Their catalogue
  is `lib/storefront/section-types.ts`, which carries columns an inventory has no room for —
  data source, seller-fillable fields, singleton. `tests/unit/section-registry.test.ts` asserts
  the catalogue and the renderers are the same set, so one list stays safe.
- **My own copy tripped my own test.** The certifications note says a trade licence is never
  shown there, and the assertion that no specimen mentions a trade licence caught it. The
  assertion was scoped to document titles; the note stayed.

## What step 6a found

- **`spec-library.test.ts` had no cleanup of any kind** — no `afterAll`, no deletes — and
  created a top-level category per run. A top-level category is a *sector*, the unit the whole
  template model is organised around, so the suite was leaking a fresh empty sector every run.
  Same class of leak as the one that made the dedupe scan miss its own pair.
- **`findCandidates` was not the only silent cap.** Fixed in step 5; noted here because the
  dedupe tests now pass an explicit limit and the default remains 500.

## What step 5 found in `main`

Four of these were live defects, not gaps in the new work.

- **`consoleProvider.charge` returns `ok: true` for every charge.** Dunning would have read
  that as payment received and marked every past-due subscription active again — no card
  touched, no seller told, the sequence never starting. `runDunning` now asks
  `provider.live` first and records no `PaymentAttempt` when there is no gateway.
- **`billing.test.ts` restored `Business.planId` and not the subscription**, leaving the row
  on whatever the last test set. Invisible until the MRR ledger began reconciling.
- **The console overview linked an ops lead into a 404.** §07 puts `revenue.read` with
  finance; the sidebar knew and the overview did not. `visibleTo` now reads the same
  capability the nav declares, and the panel stays with a line rather than vanishing.
- **`findCandidates` ran two database round-trips per candidate pair.** Half a minute against
  a few thousand listings, and the blocking above it exists precisely to avoid that. Two
  queries now. It also silently dropped everything past 500; `RescanResult.dropped` says how
  many and the screen reads it.

## Carried forward

- **PDPL requests and API keys have tables and no screens.** `/admin/compliance` and
  `/admin/api` are still `later`. Small, and neither is blocking.
- **Staff role management** (`/admin/staff`) is not built. `staff.manage` is a capability with
  no service behind it.
- **The dedupe candidate list has no scheduled rescan.** It runs on demand from the screen.
- **Merged listings are filtered out of `/b/[slug]` and the call list**, and not yet out of
  search, category pages or the sitemap.

## Carried forward

- **The taxonomy and spec-library screens are read-only.** `editCategory` and
  `publishVersionWithField` are built, tested and unwired to a form.
- **The dedupe candidate list has no scheduled rescan.** `findCandidates` runs on demand from
  the screen. It belongs on the hourly job beside the metrics, in a later step.
- **A merged listing is excluded from the public surface by `mergedIntoId`**, and the four
  `/b/[slug]` routes now redirect. Other surfaces that list businesses — search, category
  pages, the sitemap — do not yet filter merged listings out.

---

## Blocked on the user, and routed around

None of these stop a step; each narrows one.

- **`stores.businesslistings.me` does not exist**, and there is no Vercel API token. Step 6's
  certificate issuance is a platform operation, not app code. Building behind a
  `CertificateIssuer` port with a fake, in the shape of `lib/billing/provider.ts`, so the five
  DNS states are provable and the certificate half is honestly marked as not-yet-live.
- **The contrast decision**, pinned since handoff 1. Criterion 12 reads as "clean outside the
  documented token pairings" until it is settled — the handoff-1-to-3 convention, stated
  plainly in the acceptance walk rather than implied.
- **`service_role` key rotation.**

## Decisions taken without asking, and why

Recorded so they can be reversed cheaply rather than discovered.

- **Step 1 split into two PRs.** 1a was already 3,000 lines and carried the checkpoint.
- **`SpecTemplateVersion` dropped.** `SpecTemplate` already has `version`, `status` and a
  unique `(categoryId, version)`, so a new version is a new row. The roadmap's proposal was
  redundant.
- **`/admin/queue/conflict/:id` added** as a sibling of `/admin/queue/:id`, recorded in
  `docs/routes.md`. One detail route could not carry two different decisions.

## Conventions this run relies on

- Every staff mutation goes through `staffMutation`, which refuses a blank reason and a
  subject-dependent capability with no subject check.
- A metric with no table returns `null` and reads "not measurable yet". Never zero.
- Fixture failures throw. `if (!result.ok) return` turns a test green with no assertions run.
- The seed truncates `user`, so `pnpm db:seed` invalidates saved Playwright sessions —
  re-run `--project=setup` after seeding.
- A filtered Playwright run applies `-g` to every project including `setup`. The acceptance
  walk mints sessions unfiltered first, then passes `--no-deps`.
