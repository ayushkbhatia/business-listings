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
| [#22](https://github.com/ayushkbhatia/business-listings/pull/22) | Step 2b — board 12b, dedupe and the reversible merge, the 301 resolver | open |

## Next

**Step 3 — trust `[4h]` `[4i]` `[12h]`.**

- `[4h]` supplier reports. Already being filled automatically by
  `lib/messaging/service.ts` when off-platform payment steering is detected — a producer with
  no drain, exactly like the three queues handoff 3 left.
- `[4i]` staff, roles and the audit log, including the "own actions only" narrowing that is
  implemented at `lib/auth/subject.ts:196` and called from nowhere.
- `[12h]` field visits with the two-photo report, PDPL requests, API keys, staff security.
- Checkpoint: prove a moderator cannot change a verification tier. Already true and tested
  since step 0; the checkpoint is showing it on a screen.

Then steps 4–8 per the roadmap: accounts and CRM, commercials, the storefront builder,
content ops, the acceptance pass.

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
