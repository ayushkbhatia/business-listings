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
