# Component inventory — design system §09.3

The authoritative list. 64 components in four tiers, plus the four approved additions below,
so **68 today**. **Variants are props on one component, never separate components** — one
`Button` with a `variant` prop, not five.

The 64 count treats `ListingCard` as one component with a `context` prop (four contexts) and
`Button` as one component with five variants. If you have built more files than the running
total, check whether you split a variant into its own component.

`/dev/gallery` asserts the same figures — 18 · 17 · 17 · 16 — and the tier headings below are
the tables alone, so an addition has to move three numbers rather than one. That is
deliberate: `ReviewCard` was written into the tier 4 table and never added to the gallery,
which left the gallery reading 15 over a table holding 16 for a whole handoff.

---

## Tier 1 — primitives (18) · handoff 0

| # | Component | States to cover |
|---|---|---|
| 1 | `Button` | 5 variants (primary, secondary, quiet, danger, on-ink) × 4 sizes (46/38/32/28) × default, hover, focus, disabled, loading |
| 2 | `IconButton` | default, hover, focus, disabled · always `aria-label` |
| 3 | `SplitButton` | main + caret, open menu |
| 4 | `SegmentedControl` | 2–4 items, selected, disabled item |
| 5 | `Input` | default, filled, focus, error, success, locked, with prefix (e.g. +971) |
| 6 | `Textarea` | default, focus, error, with character counter |
| 7 | `Select` | default, focus, open, disabled |
| 8 | `MultiSelect` | empty, with chips, focus, at-limit |
| 9 | `SearchField` | placeholder, typed, with scope pill |
| 10 | `Checkbox` | checked, unchecked, indeterminate, disabled, focus, nested (24px indent) |
| 11 | `Radio` | selected, unselected, disabled, focus |
| 12 | `Toggle` | on, off, on-with-consequence (warn tone), disabled |
| 13 | `RangeSlider` | single and two-handle |
| 14 | `Stepper` | default, at-min, at-max |
| 15 | `TimePair` | enabled with times, disabled/closed, split shift |
| 16 | `FileDrop` | idle, uploading with progress, done, error |
| 17 | `Label` | default, with secondary note, required |
| 18 | `FieldError` | single message |

## Tier 2 — structure (17) · handoff 0

| # | Component | Notes |
|---|---|---|
| 19 | `DataTable` | the one to get right — two surfaces live in it |
| 20 | `TableToolbar` | search, filters, attention chip, sort statement |
| 21 | `SelectionBar` | ink bar replacing the toolbar when rows are selected |
| 22 | `Pagination` | above 50 rows; never infinite scroll on a work surface |
| 23 | `KeyValuePanel` | two-column, alternating tint by row |
| 24 | `Card` | flat default, raised, promoted |
| 25 | `Panel` | 12px radius, section container |
| 26 | `Tabs` | 1.5px ink underline, with optional count |
| 27 | `Breadcrumb` | mono caps, last crumb ink and not a link |
| 28 | `PublicNav` | 68px, search in the bar; two rows and 112px below `sm` |
| 29 | `AppSidebar` | 236px, one component, nav config drives seller vs admin |
| 30 | `PageHeader` | 58px, title + badges + actions |
| 31 | `StepHeader` | done/current/future, count not percentage |
| 32 | `FilterRail` | generated from filterable spec fields |
| 33 | `BuilderChrome` | ink bar, no sidebar, full-screen editing |
| 34 | `Drawer` | right-side, overlay elevation |
| 35 | `Modal` | 420px confirm, and larger content variant |

## Tier 3 — display (15, plus 65 and 68 below) · handoff 1

| # | Component | Notes |
|---|---|---|
| 36 | `StatusBadge` | pill, 4 tones × wash; always carries a word |
| 37 | `PlanBadge` | 4px square radius, mono caps — deliberately not a status pill |
| 38 | `FilterChip` | pill (facet + count), square (applied, removable ×), dashed (mode) |
| 39 | `Tag` | 4px radius, content label, no interaction |
| 40 | `StatCard` | one number, one label, one comparison. Never two numbers |
| 41 | `ProgressBar` | with optional target marker |
| 42 | `StepProgress` | segment pills |
| 43 | `StackedBar` | two series over time |
| 44 | `FunnelBars` | drop-off with percentages |
| 45 | `ShareBars` | share of total |
| 46 | `Waterfall` | start / +new / −churn / end |
| 47 | `ImagePlaceholder` | striped (expected), dashed (absent), solid+label (document) |
| 48 | `LogoTile` | logo, initials fallback, overlap variant with white ring |
| 49 | `CategoryMark` | moss tile, two-letter mono code |
| 50 | `MapCanvas` | 4-level pin hierarchy + cluster count |

## Tier 4 — domain (14, plus 66 and 67 below)

| # | Component | Lands in |
|---|---|---|
| 51 | `VerificationBadge` | handoff 1 |
| 52 | `VerificationLadder` | handoff 1 (read-only), writable in 4 |
| 53 | `ListingCard` | handoff 1 — one component, `context` prop: search row, map result, grid, unclaimed |
| 54 | `ProductCard` | handoff 1 — availability-led, no price |
| 55 | `SpecTable` | handoff 1 |
| 56 | `CompletenessMeter` | handoff 1 |
| 57 | `ResponseTime` | handoff 1 (component), handoff 2 (real data) |
| 58 | `EnquiryComposer` | handoff 2 |
| 59 | `QuoteLineEditor` | handoff 2 |
| 60 | `ModerationRow` | handoff 2 (written), handoff 4 (displayed) |
| 61 | `AuditRow` | handoff 2 (written), handoff 4 (displayed) |
| 62 | `HoursEditor` | handoff 3 |
| 63 | `EmirateAreaPicker` | handoff 3 |
| 64 | `PlanCard` | handoff 3 |
| 66 | `Thread` | handoff 2 — one component, boards 10h and 11b are two views of it |
| 67 | `ReviewCard` | handoff 4 — one review, on the reviews page and in the storefront section |

---

## Approved additions

**65 · `Alert`** — the inline notice from design-system §05.1. Five tones (ok, warn, bad,
info, neutral), optional single action, no icon; the copy carries the tone. Approved as an
addition to tier 3, replacing hand-rolled notice blocks. Any notice describing a problem must
also carry the action that fixes it.

**66 · `Thread`** — the enquiry conversation, added to tier 4. Built in handoff 2 against
boards 10h and 11b and left out of this list; the gallery carried it uncounted until it was
given a row.

One component, not two. The buyer's view and the seller's view are the same exchange, and the
only differences are the chips, the off-platform warning and whose messages sit on which side.
Two implementations would have let them drift, and a buyer and a seller reading different
renderings of the same record is the one thing a record must never do.

The quote delta — the previous price struck through beside the new one — is computed once in
`lib/messaging/thread-view.ts` for the same reason, so both sides read the same numbers.

**67 · `ReviewCard`** — extracted, not added. `/b/[slug]/reviews` rendered a review as inline
JSX, and the storefront Reviews section needed the same markup. Copying it would have been two
renderings of one record, which is the failure the `Thread` note above describes.

It takes resolved strings rather than a Prisma row, because the reviews page and the section
reach the data by different queries and a component typed to one breaks when the other changes.

**68 · `RatingMarks`** — a rating as five squares, added to tier 3 for board 1m. Squares
rather than stars, and not decoration: a star is the shape every directory in this market
prints over ratings nobody trusts, and the argument of `/b/:slug/reviews` is that these were
earned through a gate. Borrowing the visual language of the pages that were not is the wrong
first impression.

**No partial mark, ever.** The numeral carries the decimal. A half square is a rendering of
4.6 that a reader has to decode, and it is a lie at any width narrower than the difference
between 4.6 and 4.7. The marks are `aria-hidden` behind one `role="img"` label, because five
filled squares announced one at a time is five announcements of nothing.

It pairs with `formatRating`, which is the reason that formatter exists: `formatDecimal` drops
a trailing zero, so a 4.0 printed "4" in the rating card and "4.0" in the storefront header —
one figure with two renderings on one page.

## Built, and not yet given a number

**`PlanComparison`** — the plans side by side, from board 1l. A real `<table>` above 768px and
one block per plan below it, because a four-column table on a phone puts the column being sold
off the right edge.

It is not claiming a row here. The design canvas has no component for it, so which tier it
belongs to is the design owner's call rather than the build's — `Alert` and `Thread` were each
approved into a tier by somebody, and inventing a number to make a total come out right is the
failure the `Thread` note above describes from the other direction. It renders in the gallery's
`UNLISTED` group, which exists for exactly this.

Why it is a component at all rather than page-local JSX: `2e` and `11f` compare the same plans,
and a second copy of this markup is how two screens start disagreeing about one record.

**The fourteen storefront sections are not in this list, deliberately.** Their catalogue is
`lib/storefront/section-types.ts`, which declares each type's data source, its seller-fillable
fields and whether it is a singleton — things a component inventory has no column for. Two
lists of fourteen things is one list too many, and the `Thread` note above is what happens when
a component lives in one list and not the other. `tests/unit/section-registry.test.ts` asserts
the catalogue and the renderers are the same set, and
`/admin/storefront-templates/specimens` is their gallery.

## Naming

PascalCase components. kebab-case CSS variables. `data-density` on the shell, never a size
prop per component. `data-theme` on a storefront root only.
