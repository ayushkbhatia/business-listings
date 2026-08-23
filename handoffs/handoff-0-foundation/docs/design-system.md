# Design system — build reference

The authoritative visual and behavioural spec is the canvas file
**`Business Listings Design System.dc.html`** (9 chapters, 64 components, every state drawn).
Open it alongside this document. This file is the developer-facing extract: the parts you
need in the editor rather than on screen.

Chapter map:

| § | Chapter | What you need it for |
|---|---|---|
| 01 | Foundations | colour families, type scale, 4px spacing, radii, elevation, motion |
| 02 | Form primitives | every control, every state, validation timing |
| 03 | Data display | DataTable anatomy, badges vs chips vs tags, stats, 4 chart types |
| 04 | Navigation & shells | the three shells, tabs, breadcrumb, builder chrome |
| 05 | Feedback | notices, toasts, confirms, and four kinds of empty |
| 06 | Domain components | verification, listing card, product card, spec table, enquiry |
| 07 | Surface rules | may-use / must-not-use per surface, permission matrix |
| 08 | Content & voice | the instead-of/write table, formatting rules |
| 09 | Handoff | CSS variables, a11y floor, 64 components in 4 tiers |

---

## Tokens

Copy §09.1 verbatim into `globals.css`. Summary of intent:

**Neutrals.** `--paper #FAF9F6` is the page. `--card #FFFFFF` is a raised surface only —
never a page background. `--ink #211F1B` is headings and dark surfaces. Pure black is never
used. Text ramps faint → muted → body → prose → ink; use `prose` for long-form reading and
`body` for interface copy.

**Accent.** `--moss #46584A` marks action and nothing else. `--moss-on-ink #8FA892` is the
only accent permitted on dark surfaces; base moss fails contrast there.

**Status.** Four tones, each with a wash and a surface: ok (verified, in stock, open), warn
(expiring, pending, slow), bad (overdue, blocked, error), info (neutral state). Status never
appears as a bare colour — always a word beside it.

**Seller themes.** Six presets plus one validated hex. A theme recolours the storefront
header, headings, buttons, links and form focus. It never recolours verification badges,
status tones or platform chrome. Contrast-check on save and reject with a reason.

## Type

Instrument Serif — page heroes, editorial headings, the wordmark, guide titles, one big
number. Never in a table, never below 18px, never a UI label.
Geist — everything else. Weights 400 and 500 only; emphasis comes from colour and size.
JetBrains Mono — machine strings: IDs, SKUs, licence and TRN numbers, counts, timestamps,
URLs, column heads, eyebrows. Tabular figures on. If a human wrote it, it is not mono.

Floor: 11.5px for anything a user must read; 9.5px mono only for uppercase eyebrows and
column heads. Prose measure caps at 640px regardless of container.

## Density

One attribute on the shell, inherited. Roomy for public, comfortable for the dashboard,
compact for admin queues. Components read the density variables; they never take a size prop
for this.

## Interaction rules that are easy to get wrong

- **Selection** is a 1.5px moss border plus a moss-tinted fill. Never a shadow.
- **Dashed borders** mean "empty, add or drop something here". Nothing else.
- **Toggle** applies immediately; **checkbox** applies on save. Never mix them in one section.
- **Validation**: format errors on blur, required-field errors on submit, revalidate as the
  user types once a field has failed.
- **Autosave** everywhere in the dashboard, with `Saved 20 seconds ago` in the header.
  Explicit Save exists only where a change goes to moderation.
- **Destructive actions** get an Undo toast where reversible, a confirm dialog where not.
  The confirm button repeats the verb — never "OK". Cancel sits left and is never styled red.
- **Empty states** are four different things: first-run, filtered-to-zero, loading skeleton,
  and failure. Never illustrate them; say what it is and give the one action that fills it.
- **Locked by plan** shows the real panel dimmed with a lock and one line naming what unlocks
  it. Never hide the feature — a seller cannot want what they cannot see.
- **Errors** carry a mono reference code and say whose fault it is.

## Motion

state 120ms ease-out · reveal 180ms ease-out · overlay 220ms cubic-bezier(.2,.8,.2,1) ·
skeleton 1200ms. Never animate route transitions, counting numbers, scroll reveals, or
anything on a table row beyond its own hover. All of it off under `prefers-reduced-motion`.

The one exception: a new lead arriving gets a 180ms slide and a single moss pulse on the
count. It is the only event where drawing the eye is the point.

## Accessibility floor

Body text ≥ 4.5:1, large text and UI borders ≥ 3:1. Visible focus on every interactive
element — 2px offset ring in moss, or in the status colour on a danger control; never
`outline:none` without a replacement. Never colour alone: status carries a word, charts carry
a legend and a value, required fields say "required" rather than showing an asterisk. Targets
44px on mobile, 32px on desktop, 8px minimum gap. Real table markup with `scope`. Toasts and
new-lead counts announce politely; only a failed save announces assertively.

## Component inventory

Tier 1 (18) and tier 2 (17) are this handoff. Tier 3 (15) is stubbed. Tier 4 (14) arrives
with the slice that needs it. Full list in §09.3.

Naming: PascalCase components, kebab-case CSS variables, variants as props on one component.
`data-density` on the shell, not per component.

## The three things that become migrations if ignored

1. A verification badge must never take a seller theme colour.
2. A product must never gain a price field on a public surface.
3. Every superadmin state change must write an audit row with a reason.
