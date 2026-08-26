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
| [#27](https://github.com/ayushkbhatia/business-listings/pull/27) | Step 6b — fourteen sections that render, and the page that proves it | open |

## Next

**Step 6c — the builder shell** (`5a`), plus themes (`5b`) and the page editor (`5d`).

Three panes on `BuilderChrome`: section list left, live canvas centre, settings right. The
canvas renders the template against a real seller's data at 50% — the renderers landed in 6b,
so this is composition rather than new drawing. Publish is a two-step: a diff of what changed,
then a confirm naming the store count. `publishTemplate` and `restoreVersion` already exist and
already carry the count; 6c is the screen in front of them.

**Checkpoint: change one template and see the store count before and after the save.**

Then:

- **6d** — domain verification `5e`, behind a `CertificateIssuer` port with a fake. §0.7.
- **6e** — the public storefront rewrite. The four `/b/[slug]` routes still render hardcoded
  JSX; `renderSection` and `resolveSections` exist and no route calls them. Criterion 2 is
  proved against the service and the resolver, not against a page, until this lands.

Then steps 7–8: content ops `[6f]` `[12g]`, and the acceptance pass.

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
