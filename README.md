# Business Listings

UAE trade directory. Buyers find licensed suppliers and send enquiries; suppliers pay a
subscription to be found and to answer faster.

Not e-commerce. No cart, no order entity, no payment capture, no payouts. The conversion
event is an **enquiry**; the terminal state is an **accepted quote**. Read
[CLAUDE.md](CLAUDE.md) before writing anything.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 App Router, React 19, TypeScript strict |
| Styling | Tailwind v4, tokens as CSS variables in `app/globals.css` |
| Database | Supabase Postgres 17, `ap-south-1` (Mumbai) |
| Schema | Prisma 7 — owns every application table |
| Identity | Supabase Auth — phone OTP first-class, plus email |
| Tests | Vitest + Testing Library, Playwright + axe |
| Hosting | Vercel |

Prisma owns the application schema. Supabase owns `auth.*` and `storage.*` only.
Permission checks are server-side functions per capability, keyed off the matrix in
`docs/design-system.md` §07 — not scattered role comparisons in components.

## Layout

```
app/(public)/       buyer-facing, roomy density
app/(dashboard)/    seller, comfortable density
app/(admin)/        staff, compact density
app/dev/gallery/    component gallery — the acceptance surface for handoff 0
components/
  primitives/       tier 1 — 18 components
  structure/        tier 2 — 17 components
  display/          tier 3 — 15 components (stubs)
  domain/           tier 4 — 14 components (later handoffs)
lib/
  db/               prisma client + generated client
  supabase/         browser, server and middleware clients
  auth/             session, the nine roles, permission checks
  i18n/             t(), string catalogue
  audit/            writeAudit() — every staff mutation
  format/           currency, dates, phone, TRN masking, sizes
docs/               design system, routes, data model
handoffs/           the design handoffs, verbatim
```

Density is set once on the shell via `data-density="roomy|comfortable|compact"` and
inherited. Never a size prop on an individual component.

## Getting started

```bash
pnpm install
cp .env.example .env.local   # then fill in the four blanks
pnpm dev
```

`.env.local` needs `SUPABASE_SECRET_KEY`, `DATABASE_URL` and `DIRECT_URL`. Copy the two
connection strings verbatim from the Supabase dashboard → Connect; the pooler hostname
is not the same on every project.

## Scripts

| Command | Does |
|---|---|
| `pnpm dev` | Dev server |
| `pnpm build` | `prisma generate` then `next build` |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint, including the no-raw-hex rule |
| `pnpm test` | Vitest |
| `pnpm test:e2e` | Playwright |
| `pnpm check:tokens` | Acceptance criteria 3 and 4 — raw hex, untranslated strings |
| `pnpm check:schema` | Acceptance criterion 9 — no price on Product, no order table, no payout |
| `pnpm test:e2e` | Playwright + axe on the gallery |
| `pnpm acceptance` | The ten handoff-0 criteria, walked in order |
| `pnpm acceptance:1` | The twelve handoff-1 criteria, walked in order |
| `pnpm lighthouse` | SEO, accessibility and best-practices on the three routes criterion 10 names |
| `pnpm check:contrast` | Every token pairing against the §09.2 floor |
| `pnpm report:contrast` | What axe finds on the running gallery, grouped by colour pair |
| `pnpm check:formatters` | Every formatter has a test |
| `pnpm matrix` | The permission matrix, for diffing against §07 |
| `pnpm verify` | Typecheck, lint, both greps, schema, unit tests, build |
| `pnpm db:migrate` | `prisma migrate dev` |
| `pnpm db:seed` | Seed UAE-shaped fixture data |
| `pnpm db:studio` | Prisma Studio |
| `pnpm db:pending` | What a database has not applied yet, and who wrote it |
| `pnpm db:deploy` | Apply those, after showing you what they are |

## Deploying

Production tracks `main` and deploys on merge as usual. **The database does not
go with it.** Schema reaches production only when a person runs `pnpm db:deploy`,
which prints every migration the database has not applied — with the PR and
author behind each — and asks before applying them. `prisma migrate deploy`
applies every pending migration rather than yours, so that list is the review.

**Preview builds are opt-in**: a push to a branch does not build unless the
commit message contains `[preview]`.

```bash
git commit --allow-empty -m "chore: preview build [preview]"
```

The rule lives in `scripts/vercel-ignore-build.sh`, wired to `ignoreCommand` in
`vercel.json`. A deploy is billed build time and each new deployment starts with
a cold ISR cache, so building every push cost real money on a site with no
traffic. Full reasoning, the inverted exit codes and the other escape hatch are
in [docs/deployments.md](docs/deployments.md).

## The three things that become migrations if ignored

1. A verification badge must never take a seller theme colour.
2. A product must never gain a price field on a public surface.
3. Every superadmin state change must write an audit row with a written reason.

## Build order

`handoffs/handoff-0-foundation/KICKOFF.md` sets the sequence and the review checkpoints.
Handoffs 1–5 arrive one at a time.
