# Database

Supabase Postgres 17, `ap-south-1`. Prisma owns every application table; Supabase
owns `auth.*` and `storage.*` only.

## Connections

| Variable | Pooler | Port | Used by |
|---|---|---|---|
| `DATABASE_URL` | Supavisor, transaction mode | 6543 | the app at runtime |
| `DIRECT_URL` | Supavisor, session mode | 5432 | `prisma migrate`, the seed |

A transaction pooler cannot run DDL, which is why migrations use the session
port. The tenant lives on `aws-0`; `aws-1` answers `tenant/user not found`.
`db.<ref>.supabase.co` resolves AAAA only, so the pooler is the portable choice.
Percent-encode reserved characters in the password: `&` is `%26`.

## PostgREST is closed

This is the one piece of the setup that is not obvious, and it was a live hole
until `20260823175000_lock_down_postgrest`.

Supabase publishes every table in `public` through PostgREST, and the
publishable key is by design shipped to the browser. With RLS off, that key
could read anything. It was verified, not assumed:

```
GET /rest/v1/quote_line?select=unit_price  →  200, live prices
```

`quote_line` is the one table CLAUDE.md says is private to one buyer and one
seller. Enquiries, messages, users and the audit log were equally exposed.

The platform does not use PostgREST — every read and write goes through Prisma
on the server as the `postgres` role, which carries `BYPASSRLS`. So the fix is
deny-by-default rather than a policy per table:

- RLS enabled on every table, with no policies at all
- `anon` and `authenticated` revoked from tables, sequences, routines and the
  schema itself
- default privileges revoked, so future objects inherit the denial
- an event trigger enables RLS on any new table the moment it is created, so a
  future Prisma model cannot arrive unprotected

After the migration the same request returns `401 permission denied for table
quote_line`, and Supabase Auth still answers `200`.

If a surface ever needs direct client access — realtime on a message thread is
the plausible one — it gets an explicit, reviewed policy. Nothing becomes
reachable by accident.

## Invariants in the database, not only in code

`20260823173500_invariant_constraints` writes the rules the service layer also
enforces, so a manual SQL fix cannot quietly break them:

- a removed review must carry a non-blank `removal_reason`
- an audit reason cannot be blank
- `verification_tier` is 0..4, and tier 3 requires `visited_at`
- review scores are 1..5 on every axis
- a quote line has positive quantity and non-negative price
- an enquiry reaches at most 8 businesses (deferred constraint trigger)

## Search indexes

Trigram, not full text. `20260824100000_trigram_search` puts GIN `gin_trgm_ops`
indexes on `product.search_text`, `business.display_name` and
`business.trade_name`, plus a plain GIN on `category.synonyms` for the exact
array match an Arabic term needs.

Full text was the first attempt and was wrong for this data: it stems and
tokenises, while a buyer typing `DN100` or `4"` means an exact substring of a
machine string — and `4"` is not a legal tsquery at all.

**Raw-SQL indexes have to be idempotent.** `schema.prisma` cannot see an index
declared in a hand-written migration, so the next `prisma migrate dev` treats
it as drift and generates a migration to drop it. That happened here: a
handwritten migration created four indexes, Prisma immediately wrote and
applied a second migration dropping all four, and the repo kept only the
second. The database ran without any search index until it was caught by CI
failing to replay the history on a fresh Postgres. Every statement in the
replacement is `IF EXISTS` / `IF NOT EXISTS`.

At seed scale the planner picks a sequential scan over 97 products, which is
correct. `set enable_seqscan = off` confirms the index is usable:

```
Bitmap Heap Scan on product
  ->  Bitmap Index Scan on product_search_text_trgm_idx
```

## Seed

`pnpm db:seed`. Deterministic — a fixed PRNG and a fixed `NOW`, so two runs
produce the same rows and a screenshot diff shows real changes only.

40 businesses across 6 categories and 4 emirates · 14 claimed, 24 unclaimed,
2 disputed · verification tiers 0 through 4 all present · 55 locations of which
9 are deliberately unpinned · 101 products across all four availability states ·
one live spec template with three filterable fields · 78 enquiries, 7 quotes
including a revision 1 and 2 on the same enquiry and business · 2 reviews, one
of them removed with a reason · 3 supplier reports · 60 contact reveals ·
5 zero-result queries.

The queues admin drains: 6 listing change requests, 3 of them still pending,
covering all three moderated fields and all four statuses · 5 claim submissions,
3 undecided, both routes, contested both decided and not · 4 site visit requests
across asked, scheduled, completed and cancelled · 10 audit events, one for
every decided row.

`tests/integration/admin-queues.test.ts` asserts those shapes rather than the
counts, so adding a fixture does not break it and dropping the last one of a
kind does. The queues were empty here for three merges: handoff 3 fills them at
runtime and nothing filled them at seed time, which is invisible until a screen
opens on them.

**Adding to the seed changes the seed.** The PRNG is a sequence, so a new
`int()`, `pick()` or `rnd()` inserted anywhere shifts every draw after it and
renames every business generated later — which renames slugs a dozen test files
pin. Append at the end, and use literal data or values read back from rows
already written. Two existing draws are deliberately made and discarded for the
same reason; see the comments in `prisma/seed.mts`.

Staff ids are deterministic (`uuid(n)`): 1–4 staff, 10–11 buyers, 900 the
provisional buyer, 100 upward seller seats, 910 upward claimants.

Every name, licence number and phone number in the seed is fictional. The shapes
are real.
