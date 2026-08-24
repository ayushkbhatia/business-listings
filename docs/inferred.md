# Inferred decisions, pending the design canvas

`docs/design-system.md` names **`Business Listings Design System.dc.html`** as the
authority for chapters §02–§06 — every component, every state, drawn. That file
has not been supplied. `docs/tokens.css` covers §01 and §09.1; nothing covers the
component chapters.

Everything below was derived from what the shipped documents do say: the
prose rules in `docs/design-system.md`, the non-negotiables in `CLAUDE.md`, the
route table, the data model, and the accessibility floor. Each entry names what
was decided and what it was decided from, so diffing against the canvas is
mechanical rather than a re-read.

`pnpm matrix` prints the permission matrix, which is tracked the same way.

---

## Tier 1 primitives — checkpoint 4

### Button, the five variants
`primary` · `secondary` · `ghost` · `danger` · `link`

The README names `danger` explicitly and the design system says moss marks
action and nothing else. Primary is moss; secondary is the outlined form for a
second action beside it; ghost is the toolbar and table form with no border;
link is the inline text form. Five was the stated count, not five I chose.

### Button, the four sizes
`sm` 32px · `md` 36px · `lg` 44px · `xl` 52px

The accessibility floor is 32px on desktop and 44px on mobile, so `sm` sits on
the desktop floor exactly and `lg` on the mobile one. `xl` is for a single
full-width mobile action. Anything under 32px belongs to an IconButton inside a
table row, where the row is the target.

### Loading keeps the label
A loading button shows a spinner *beside* its label rather than replacing it,
and keeps `aria-busy` rather than only `disabled`. Derived from the voice rule
that a control should say what it is doing; a bare spinner where "Send quote"
was is a control that stopped explaining itself mid-request.

### Control heights
`sm` 32px · `md` 36px · `lg` 44px, shared by Input, Select, SearchField,
Stepper and TimePair through one shell so they cannot drift apart.

### Selection treatment
1.5px moss border plus `--moss-wash` fill, never a shadow. Stated in
design-system §"Interaction rules that are easy to get wrong". Applied to
SegmentedControl's selected segment and MultiSelect's chips.

### Dashed borders
Only FileDrop's idle state. Stated: dashed means "empty, add or drop something
here" and nothing else. The moment a file exists the border goes solid.

### Toggle is a switch, and can be pending
`role="switch"`, not a checkbox, because the announcement is on/off. It carries
a `pending` state because the design system says a toggle applies immediately —
which means it can fail, and a switch that silently reverts three seconds later
is worse than one that never moved. The pending state is inferred; the
apply-immediately rule is stated.

### Textarea's counter is soft
Typing past the limit is allowed and flagged rather than blocked. A hard
`maxLength` silently swallows a paste, and a buyer pasting a requirement out of
an email should see it truncated by their own hand. Counter goes muted → warn in
the last tenth → bad once over.

### Select is native, MultiSelect is not
A native `<select>` gets the platform picker, which is what a buyer on a phone
in a warehouse already knows. No platform multi-select is worth putting in front
of anyone, so that one is ours.

### MultiSelect shows a filter box past eight options
Threshold is a prop with a default of 8. Six certifications do not need a search
box; forty areas do.

### RangeSlider is two native inputs
Rather than a div with drag handlers. Arrow keys, Home and End work for free,
and the current pair is always rendered as text — a slider whose position is the
only readout is unusable for anyone who cannot see it.

### Focus ring
`--focus-ring` on everything, `--focus-ring-danger` on a danger control. Stated
in the accessibility floor: 2px offset ring in moss, or in the status colour on
a danger control.

### `data-force` pinned states
A gallery-only affordance. `hover` and `focus` are overridden as custom variants
in `globals.css` so a specimen can be pinned with `data-force="hover"` and show
the real styles. A gallery that hand-copies a hover style lies the first time
the variant changes. Nothing in production sets the attribute.

---

## Still unknown, and not guessed

- The exact component inventory of §02 beyond the eighteen names in the README.
- Whether the canvas draws states this build does not have (a Button `active`
  press state, for one — currently the hover treatment carries it).
- Whether `xl` is a real Button size or whether the fourth size is smaller than
  `sm`. If the canvas has a 28px table-row button, `sm` moves down and a new
  size joins the top.
- Icon set. These are drawn to a 16px grid at 1.5 stroke to sit with Geist at
  13px; the canvas may specify a different family.

---

## Tier 2 structure — checkpoint 5

### DataTable, the rules that were stated
Everything in README §3's DataTable paragraph is implemented literally: real
table markup, mono uppercase heads on `--paper-sunk`, hairline row dividers,
no vertical rules, no zebra, right-aligned tabular numbers, tone carrying
meaning, one visible row action, sortable heads with a visible arrow,
indeterminate select-all, a selection bar that replaces the toolbar, and
pagination above 50. §03.1 is canvas-only, so anything below is inferred.

### Row tone edge
A 2px bar on the leading edge, drawn with a pseudo-element so it costs no
column, alongside the tint. Inferred: the spec says the tint carries meaning
but a tint alone is colour-alone, which the accessibility floor forbids.

### Row menu is a disclosure, not a menu
`<details>`/`<summary>` with plain buttons inside. `role="menu"` promises arrow
keys and type-ahead; implementing the role without the interaction is worse for
a screen reader than the plain truth. Revisit if the canvas draws menu-style
keyboard behaviour.

### `rowMenuLabel` is per row
"More actions for Al Marwan Trading", not "More actions". Six identical
triggers in a column is six identical announcements.

### Card elevations
`flat` (1px line, the default) · `raised` · `promoted`. Taken from the four
elevation tokens; `overlay` belongs to Modal and Drawer, not to Card.

### Panel `locked`
Renders the real panel dimmed with a line naming what unlocks it. Stated as an
interaction rule — "never hide the feature" — and given a shape here.

### Modal and Drawer are native `<dialog>`
The platform supplies the focus trap, the inert background, Escape and the top
layer. Inferred, but hand-rolling those is the usual way a modal ends up with a
tabbable page behind it.

### Drawer sides are `start`/`end`
Not left/right. No layout may assume LTR.

### Sidebar width and header height
236px and 58px, both stated in README §4. The nav groups themselves are derived
from `docs/routes.md`, six per surface as stated.

### Locked and later nav items
A capability the actor lacks renders locked; a route named in `routes.md` but
not yet built renders as "soon" and is not a link. Inferred from two stated
rules: never hide a feature, and routes marked `later` are named so the nav
shape is right now.

### Still unknown here
- The exact grouping and order of the sidebar, beyond "six groups".
- Whether the results toolbar in PublicShell is part of the shell or a page
  concern; it is a slot either way.
- Whether pagination is bottom-only or also top on long admin tables.

---

## Checkpoint 6 findings

### An on-ink button treatment is unspecified
`ghost` is a light-surface variant: `--text-body` on `--ink` measures 1.66:1.
BuilderChrome's bar and the sidebar are ink, and the design system names no
button variant for a dark surface — only that `--moss-on-ink` is the sole
accent permitted there. The gallery uses `secondary` on the builder bar as a
stopgap. Two ways to resolve it, for the canvas to decide: a `tone="on-ink"`
prop orthogonal to the five variants, or a rule that ink surfaces only ever
carry secondary and moss-on-ink controls.

### The token block has to be inside `@layer base`
Not a design question, but worth recording because it is invisible and it bit.
Tailwind v4 puts utilities in a cascade layer, and unlayered CSS beats every
layer regardless of specificity. `tokens.css` pasted at the top level meant
`a { color: var(--moss) }` overrode `text-on-ink-muted` on every sidebar link,
rendering base moss on ink at 2.15:1 — the one pairing §01 forbids by name.
The block is byte-identical inside the layer. See docs/contrast.md.

### Ten colour pairings do not clear the §09.2 floor
Measured, not estimated, and left unchanged. `docs/contrast.md` has the table,
the reasoning and three ways out. This is the one open item that needs a design
decision before handoff 1 puts these colours in front of buyers.

---

## Handoff 1, steps 1 and 2

### The verification ladder — five rungs, all inferred
§06 is canvas-only. `components/domain/verification.ts` derives the rungs from
what the shipped documents state: the tier is 0..4 and staff-write-only, tier 3
requires `visitedAt`, and the tier drops to 2 the day the licence expires.

| tier | label | what was checked |
|---|---|---|
| 0 | Not verified | nothing on the page has been checked |
| 1 | Licence on file | trade licence number recorded |
| 2 | Licence verified | checked against the issuing authority |
| 3 | Site visited | premises visited by the field team |
| 4 | Audited | premises visited and trading history audited |

Tier 1 versus 2 is the least certain: the data model distinguishes them only by
implication. Tiers 3 and 4 both require a visit, and the difference drawn here
— an audit of trading history — is an invention that needs confirming.

### ResponseTime bands
Green under 4 hours, amber under 24, red past that. The design system names the
three colours and not the thresholds. Four hours is inside a UAE working
morning; a day is still same-business-day.

### Tier 4 imports `t()` directly
Tiers 1 to 3 take their strings as props and stay generic. A domain component is
domain-specific by definition, and threading twenty catalogue keys through props
would be ceremony. Recorded because it is a deliberate line, not an oversight.

### Map tiles
`NEXT_PUBLIC_MAP_STYLE_URL`, defaulting to a keyless style so nothing waits on a
paid account. MapCanvas nudges the provider's background and water layers toward
`--map-base` and `--map-water` where those layers exist, and otherwise leaves the
provider's own colours. **A style JSON that renders the five map tokens properly
is a design deliverable**, not a config change — the tokens define a map that no
off-the-shelf style matches.

### Locked panel dim
Raised from 40% to 70% opacity. At 40% the body copy computes to 2.07:1, which
is unreadable — and unreadable content defeats the rule the dim exists to serve.
The design system says "dimmed"; it also says never hide the feature.

### Still unknown
- Whether tier 4 is an audit, a re-visit cadence, or something else entirely.
- What a sponsored ListingCard looks like beyond "always labelled".
- Whether the map has a clustered state in the canvas; MapCanvas types the
  cluster circle in its documented hierarchy but does not yet render one, as
  nothing in the seed has enough co-located pins to need it.

---

## Handoff 1, step 4 — search

### Ranking is in the process, not in Postgres
The weights object is the deliverable board 12c specifies and it is exact. The
scoring runs in Node over a bounded candidate set of 200 rows, which is correct
at 41 listings and wrong at 41,000. Moving it to a Postgres-side score is a
query change; `lib/search/ranking.ts` moves unchanged, which is the point of
having it as config.

### Unmeasured signals score half, not zero
Not specified anywhere. A new supplier has no response time and no reviews, and
scoring those as "worst possible" would bury every listing on its first day and
freeze the top of every category. Half credit is the honest position: we do not
know. Same for distance, which is unknown for almost every buyer because the
site never asks where they are.

### Response-time bands
Full marks at four hours or better, zero at a week, linear between. Same
thresholds as the ResponseTime component.

### The sponsored slot
Top of page one when the buyer has set no verification filter; natural rank
position when they have. Either way it is labelled and there is at most one.
The rule in the README is "never outranks a verified supplier on a filter the
buyer explicitly set" — this reads that as the verification facet specifically,
which is the only facet where "outranking" has a trust meaning.

### Facet counts are measured with that facet cleared
Otherwise every unpicked option reads zero, which is the most common way a
filter rail becomes useless. Spec-facet counts are grouped in the process over
up to 1,000 matching rows rather than in SQL, because a JSON column with a
dynamic key does not group cleanly through the query builder.

### Imperial-first products in the seed
Added so criterion 3 has a real subject. A DN100 product that merely carries 4"
as a synonym does not demonstrate anything; a product named and specced `4"`,
found by a DN100 query, does. Both directions are now in the match surface.

### Still unknown
- Whether a category page should be indexable with filters applied. Currently
  the canonical drops the query string and /search is noindex, which is the
  conservative reading.
- Whether the results toolbar should carry a sort control. Nothing in the
  README mentions one, and ranking is the answer to sorting here.
- What the sponsored slot looks like beyond "always labelled".

---

## Handoff 1, step 5 — home and compare

### Unbuilt chrome routes are named, not linked
`/categories`, `/guides`, `/pricing` and the four policy pages are board 10j and
later handoffs. `docs/routes.md` says a later route is named so the nav config
is shaped correctly now. They render as greyed text with a title, the same
treatment AppSidebar gives an unbuilt admin route, rather than as links into a
404. Turning them into links is a one-word change per entry when the pages land.

### Compare is a real feature; only "Enquire with all" is disabled
The README puts /compare in scope as a page and disables the enquire action
specifically, so the Compare control on a listing card is a link rather than a
disabled button.

### The comparison tray lives in the URL
`?compare=slug,slug` on a results page, `?p=slug,slug` on /compare. No client
state and no cookie: adding a supplier is a navigation that preserves every
other facet, and the whole flow works before JavaScript arrives. Capped at four
because past that the table stops fitting on any screen a buyer has.

### The comparison table is transposed
Suppliers are columns and attributes are rows — the opposite of every other
table in the product. Four across is what fits, and a buyer reads down one
attribute at a time. Both `th scope="col"` and `th scope="row"` are used.

### Home ordering never uses plan tier
Featured suppliers are ordered by verification then reviews. Sponsored
placement is sold per category and emirate; on the home page a paid slot would
read as an editorial endorsement.

### Still open
- **`next/link` migration.** Everything is a plain `<a>`, which was deliberate
  for the works-without-JavaScript property — but `next/link` renders a real
  anchor too and adds prefetch and client-side navigation for free. One
  instance was converted where the Next lint rule fires; the rest is a
  mechanical sweep worth doing before launch, and it is a performance change,
  not a correctness one.

---

## Handoff 1, step 6 — SEO

### The board 6f guard applies to subcategories, not top-level categories
`routes.md` scopes the thresholds to "area landing pages and subcategory
pages". A top-level category is core navigation that the home page links to
directly, and holding it out of the sitemap while linking to it from the front
page would be the worst of both. All four seeded subcategories are held back,
which is the guard working.

### Intro-word count is not enforced yet
The 250-word floor is in `evaluatePublish` and tested, but the sitemap passes a
constant for it because the intro-copy field arrives with the handoff 5 pages
it belongs to. Only the supply floors bite today.

### An unclaimed listing stays in the sitemap
At priority 0.4 rather than 0.7, and without its catalogue, branches or reviews
tabs, which it does not have. Thirty thousand unclaimed pages are how a
supplier first finds us; excluding them would be excluding the acquisition
funnel.

### Lighthouse found a second §09.2 conflict
Type size. 11.5px captions and 9.5px eyebrows are both deliberate and both under
the 12px Lighthouse counts as legible, so only 30 to 40 per cent of a page
clears it. Criterion 10 asks for **SEO** ≥ 95 and that is 100 everywhere, so
this does not block — but it compounds with the contrast gap on exactly the same
`--text-muted` metadata. Written up in docs/contrast.md with three ways out.

### One real defect Lighthouse caught
Facet rows in the filter rail were 22px tall against a stated floor of 44px on
mobile. Fine with a mouse, bad with a thumb, and a filter rail on a phone is all
thumb.

### Raw-SQL indexes and `prisma migrate dev`
An index created in a hand-written migration is invisible to `schema.prisma`,
so the next `migrate dev` reads it as drift and generates a migration to drop
it. Any future raw-SQL object needs `IF NOT EXISTS` on creation and `IF EXISTS`
on removal, and the migration that follows it needs reading before it is
applied. See docs/database.md.

## Handoff 2, step 1 — the seller side

### The seed's clock now moves
`NOW` was a fixed instant, `2026-08-14T12:00:00+04:00`, which made two runs
byte-identical. Ten days later every "live" enquiry in the leads inbox rendered
as **Closed** and the seller screens had nothing to act on. A fixture that
expires is worse than one that moves, so `NOW` is now noon today in Asia/Dubai.
The PRNG stays fixed, which is what actually keeps content stable — the same
businesses, products, prices and names every run. Only the timeline slides. Set
`SEED_NOW` to an ISO instant to reproduce an exact dataset.

### A match floor, set by hand
`MATCH_FLOOR = 0.45` in `lib/quote/match.ts`. Nothing in the handoff states one.
It is set against the seeded catalogue so that a line naming a product the
seller stocks clears it and `API 6D trunnion ball valve DN600` clears nothing.
The matcher errs towards **unmatched**: a matcher that always finds something is
worse than none, because the seller stops reading the suggestions and one day
sends a DN600 line at the DN100 price with their name on it.

### The size veto is not a score
If an enquiry line and a product both name a readable bore and the bores differ,
the pair is removed rather than ranked last. "Gate valve DN100" and "Gate valve
DN150" share every word that matters and are not substitutes. A veto cannot be
reached by lowering a threshold; a low score can.

### Quote arithmetic is integer fils
`lib/quote/money.ts`. A quote total is what a buyer commits their company to,
and `0.1 + 0.2` has no business appearing on a line that says AED. This needed
`tsconfig.target` raised from create-next-app's ES2017 to ES2020 for bigint
literals; every browser Next.js 16 targets has supported BigInt since 2020.

### `AppSidebar` takes resolved labels
It took a `translate` function, which a server component cannot pass to a client
component. Rather than have the sidebar import `t()` — which the config exists
to avoid — callers now pass `resolveNav(DASHBOARD_NAV, t)`. Labels arrive as
strings, as they do for every other component here.

### The dashboard's nav badges were lies
`nav-config.ts` shipped `badge: 7` on leads and `badge: 2` on quotes as
placeholders. With the screens built, the sidebar said 7 above a page listing 2.
Both are now passed through `resolveNav` from real counts. The admin placeholders
stay until handoff 4 builds their screens.

### A development-only seller seat
Step 1 builds the seller side before step 2 builds auth, on the README's own
sequencing. `lib/auth/dev-seller.ts` resolves a seeded owner from
`DEV_SELLER_SLUG`, returns null when `NODE_ENV === "production"` before reading
anything, and is opt-in even locally. Step 2 deletes it. One consequence worth
knowing: `pnpm test:e2e` builds for production, so the seller screens cannot be
covered by Playwright until sign-in exists. Their proof lives in
`tests/integration/` instead, against a real database.

### Quote references
`QT-8863-ALMR1` — enquiry number, the supplier's three-letter mark, revision.
The seed's historical refs use an older positional shape (`QT-8841-B2R1`) and
are left as they are. A numeric suffix is appended if two suppliers on one
enquiry share a mark, because `Quote.ref` is unique and a clash must not lose a
quote.
