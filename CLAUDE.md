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
   The one non-staff writer is the licence-expiry sweep in `lib/verification/expiry-job.ts`,
   which drops a lapsed licence on a schedule and writes no audit row: `AuditEvent.actorId`
   is `NOT NULL` because the log records decisions, and a cron following a published sequence
   has no actor to attribute. It is correct as it stands — do not give it a synthetic one.
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

**Banned in UI copy**, because they name things that do not exist: cart, basket, checkout,
buy, purchase, payout, refund, dispatch, POD, GMV, "Get quote", "Price: low to high", "Price
on request", "Download price list". "Price on enquiry" is the correct one.

**Which enquiry verb, where:** "Request a quote" opens an empty composer · "Send enquiry"
submits a filled one · "Enquire" is the compact form on cards and rows.

`pnpm check:vocabulary` enforces this against `lib/i18n/en.ts`, where every user-visible
string lives.

## Voice

Specific beats enthusiastic. Say the number: "218 suppliers in Al Quoz", not "many
suppliers". Sentence case everywhere except mono eyebrows and column heads. No exclamation
marks, no emoji, no "just", "simply" or "easily". Errors say what is wrong and what correct
looks like, and never blame the user. Full rules in `docs/design-system.md` §08.

## Interface honesty

A directory's only asset is that its numbers are true. These are the rules most likely to be
broken quietly, in the name of a fuller-looking page.

- **Never pad a list to fill a grid.** "Verified this week" shows only businesses whose tier
  actually rose in the window. Widen the window, then drop the section. A padded row is a lie
  with a layout reason.
- **Every number is a query, not a constant.** Counts, subcategory tallies, "218 companies".
  A hardcoded count is the fastest way to make a directory look unreliable.
- **Derived metrics have no writable path.** Response time, profile strength, spec
  completeness, quoted value. Measured beats claimed, and a seller-editable field is neither.
- **Unfilled data stays visible.** Unfilled spec rows render grey reading "Not provided",
  never hidden. The buyer sees what is unanswered and the request becomes high-intent; the
  seller sees the same grey rows in their editor.
- **An unclaimed listing says plainly that nothing is verified.** No invented hours, no zero
  rating rendered as a rating, no empty star row. Honest thinness converts; padding does not.
- **The cold-start state is a designed state.** At 40 listings the page must read honest
  rather than broken. It is the launch state, so it gets tested.

## Shared components and seller identity

The most repeated defect in this project.

**A shared component renders identically on every screen that carries it.** The storefront
header appears on four boards; a supplier's name must not change between tabs. When touching
a shared component, check every sibling screen, not only the one in hand.

**Seller identity is always `displayName`** — `h1`, identity strips, comparison rows, cards,
search results, recipient lists, JSON-LD. `tradeName` reaches a surface in exactly one place:
the details panel on the storefront overview, marked `licence-locked`. A comparison row links
to that seller's storefront, so a trade name in the row means the buyer reads one name and
lands on another.

The visual rules — colour, type, density, motion, interaction grammar — are in
`docs/design-system.md`. They live there once, not here as well.

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

## Before you say a screen is done

Not "it looks right". Each of these caught a real defect.

1. Renders in the gallery at `/dev/gallery` in all documented states, story covering the
   empty and loading ones.
2. `pnpm verify` clean — that carries `check:tokens` for raw hex and untranslated strings,
   `check:vocabulary` for the pivot words and seller identity, and `check:contrast`.
3. Read the context of every hit a scan prints, and fix every one, not the first. A count
   alone tells you nothing: `Price × 10` on one page was eight correct and two defects, and a
   page once shipped claiming one correction when the scan had printed two.
4. Check every asserted number against the markup. A completeness header read `18 OF 22` over
   a table holding 16 rows — three numbers, no two agreeing. If a header, a note or a section
   title states a count, count the elements.
5. Confirm shared components match their siblings, and that identity is `displayName`.
6. Keyboard-only pass: every interactive element reachable, visible focus ring, no trap.
7. Axe pass: the contrast floor in §09.2, one `h1`, real `<table>` with `scope`, lists as
   lists, live regions polite except a failed save.
8. Cold-start pass: render with thin seed data and confirm the page reads honest.
9. Click it. Not the diff — the running thing. Reading code is how you miss that a button
   does nothing.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
