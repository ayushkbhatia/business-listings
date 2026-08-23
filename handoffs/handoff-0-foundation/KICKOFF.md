# Kickoff prompt — paste this into Claude Code

Copy everything below the line into a fresh Claude Code session in an empty repo, with the
four files in `handoff-0-foundation/` available.

---

Read these four files before writing any code:

- `CLAUDE.md` — project rules, vocabulary, non-negotiables
- `README.md` — this handoff's scope and acceptance criteria
- `docs/routes.md` — the full route table for all three surfaces
- `docs/data-model.md` — entities and the rules that live on them
- `docs/design-system.md` — token, type, density and interaction rules
- `docs/tokens.css` — the complete token block, paste it into `globals.css` unchanged

You are building **handoff 0: foundation only**. No user-facing screens. When you are done a
developer should be able to build any screen in the project without inventing a token, a
component, a route name or a database table.

Work in this order and stop for review at each checkpoint:

**1. Scaffold + tokens.** Next.js App Router, TypeScript strict, Tailwind, Prisma, Vitest,
Playwright. Three route groups per `docs/routes.md`. Paste `docs/tokens.css` into
`globals.css` unchanged, map the variables into `tailwind.config.ts`, self-host the three
fonts. Add a lint rule that fails on any raw hex outside
`globals.css`. **Checkpoint: show me `globals.css` and the Tailwind config.**

**2. Formatters and plumbing.** `lib/format` (currency, counts, dates, relative time, 24-hour
times, phone, phone masking, TRN masking, sizes), `lib/i18n` with `t()`, `lib/audit` with
`writeAudit()` where reason is required, `lib/auth` with the nine roles and one server-side
function per capability from design-system §07. Tests first for the formatters — inconsistent
number formatting is the fastest way to make a directory look unreliable.
**Checkpoint: show me the formatter tests passing.**

**3. Prisma schema.** Everything in `docs/data-model.md`. Seed with enough real-shaped UAE
data to exercise the gallery: ~40 businesses across 6 categories and 4 emirates, mixed
verification tiers and claim states, one spec template with a filterable field, products in
all four availability states, two enquiries with quotes at different revisions.
**Checkpoint: schema + `prisma migrate` clean, and confirm no `price` on Product, no order
table, no payout field.**

**4. Tier 1 primitives (18).** Every component, every state from design-system §02. Build
them into `/dev/gallery` as you go so each is reviewable.
**Checkpoint: gallery renders all 18.**

**5. Tier 2 structure (17).** DataTable first and most carefully — read §03.1 twice; two of
the three surfaces live inside it. Then the rest, then the three shells at their three
densities.
**Checkpoint: gallery renders all 17 plus the shells.**

**6. Acceptance pass.** Walk the ten criteria in `README.md` and show me each one, including
the greps, the permission-rejection test, the audit-without-reason throw, and axe on the
gallery.

Rules while you work:

- Variants are props on one component, never separate components.
- No screens. If a task seems to need one, build the component and put it in the gallery.
- No domain components (tier 4) — those belong to later handoffs.
- If the design system and your instinct disagree, follow the design system and tell me why
  you disagreed.
- If something in these docs is ambiguous or contradictory, stop and ask rather than picking.
  Six of the eight review rounds on this design were caused by exactly that kind of guess.
