# Business Listings — project rules

UAE trade directory. Buyers find licensed suppliers and send enquiries; suppliers pay a
subscription to be found and to answer faster. Read `docs/design-system.md` before writing
any component, and `docs/routes.md` before adding any route.

## What this product is not

- **Not e-commerce.** There is no cart, no checkout, no order entity, no payment capture,
  no escrow, no payouts, no delivery tracking, no returns, no refunds of buyer money.
- The platform never becomes party to a transaction. Buyers pay suppliers directly on
  terms the two of them agree. We hold no funds and cannot refund any.
- The conversion event is an **enquiry**, and the terminal state is an **accepted quote**.
  Nothing is created after that.

## Non-negotiables

These are architectural. Retrofitting any of them later is a migration, not a patch.

1. **No price on a public surface.** `Product` has no public price field. Prices exist only
   inside a `QuoteLine`, which is private to one buyer and one seller. Public surfaces show
   availability and an enquiry action where a price would sit.
2. **Verification is platform-owned.** `verification_tier` is writable only by staff with
   the `ops_lead` role. No API path, no self-service, no seller-editable field. Badges never
   take a seller theme colour — trust signals must render identically on every storefront.
3. **Every staff state change writes an audit row with a written reason.** Review removals,
   tier changes, subscription credits, suspensions, merges, boosts. The reason field is
   `NOT NULL`. Build the audit write into the service layer, not into each screen.
4. **Real table markup.** `<table>`, `<thead>`, `<th scope>`. The design document draws
   tables with divs for layout reasons; the build must not.
5. **Localisation layer from day one.** Every user-visible string goes through `t()` even
   though English is the only locale. No layout may assume LTR. Arabic is a later
   translation project, not a rebuild.
6. **Response time is measured, never claimed.** Computed from enquiry-to-first-reply
   timestamps. No seller-editable field.

## Vocabulary — use these exact words

| Use | Never |
|---|---|
| enquiry, RFQ | order |
| quote, accepted quote | invoice from us, purchase |
| quoted value (self-reported) | GMV, revenue via platform |
| supplier report | dispute (payment sense) |
| subscription credit | refund |
| trade licence, TRN, free zone, emirate | business registration, tax number, zone |
| made to order, indent order | backorder |
| AMC, PRO services, Ramadan hours | maintenance contract, visa agent, holiday hours |

"Made to order", "indent order", "min order qty" and a buyer's own "orders over AED 25,000
need approval" are all correct — they describe the buyer's or supplier's own process, not a
platform order entity.

## Voice

Specific beats enthusiastic. Say the number: "218 suppliers in Al Quoz", not "many
suppliers". Sentence case everywhere except mono eyebrows and column heads. No exclamation
marks, no emoji, no "just", "simply" or "easily". Errors say what is wrong and what correct
looks like, and never blame the user. Full rules in `docs/design-system.md` §08.

## Stack

Next.js App Router · TypeScript strict · Postgres via Prisma · Tailwind with the tokens in
§09 as CSS variables · Vitest + Playwright. No component library — the primitives are ours.

## How work lands

No direct pushes to `main`. One branch, one PR, one squash merge — the same
cadence as the other projects in this workspace.

- Branch off `main` as `feat/<short-kebab>` or `fix/<short-kebab>`. A phrase,
  not a ticket number: `feat/buyer-enquiry-flow`, `fix/drift-units`.
- The PR title is the commit subject in the usual voice — `type(scope): what
  changed, in a sentence`. Squash merge puts it in the log with its `(#N)`.
- The PR body is the commit body. Say what moved, what it cost, and anything
  found on the way that was fixed in passing.
- `pnpm verify` and `pnpm test:e2e` pass before the PR opens, not after. CI has
  caught what local runs did not more than once; running both is cheaper than
  a red `main`.
- Claude opens the PR. A person merges it. The handoff checkpoints are the
  review, and a PR is where that review has somewhere to sit.

## Definition of done for any component

Renders in the gallery at `/dev/gallery` in all documented states · keyboard reachable with
a visible focus ring · passes the contrast floor in §09.2 · no raw hex, only `var(--*)` ·
no hardcoded strings outside `t()` · story covers the empty and loading states.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
