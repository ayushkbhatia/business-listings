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
