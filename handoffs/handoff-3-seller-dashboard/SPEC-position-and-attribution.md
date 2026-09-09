# `3a` + `3l` &middot; Search position and ranking attribution

**Amends** handoff 3, boards `3a` (seller overview) and `3l` (analytics)
**Against** the repo at `f3dad8d` &middot; brief `AMENDMENT-position-and-attribution.md`
**Render** `3a-3l-position-attribution.html` — three frames at 1440&times;760
**Delivers** states 1&ndash;13, both placements, Q0&ndash;Q7 answered
8 Sep 2026

---

## The rule this component runs on

**A rank the seller cannot explain is a rank they learn to ignore.** Every position renders
three things where all three exist: where you are, which way you moved, and why. The third is
optional and frequently absent, and an absent reason is a finished state rather than a gap.

The second rule is the one that made the amendment necessary: **a fall the seller did not cause
must not read as one they did.** Three of the six attribution states — platform, commercial,
competitor — are cases where the honest sentence begins by saying it was not them.

---

## Answers

### Q0 · Six ranking factors, not seven

**The sentence that prompted this question was mine, and it was wrong.** `3l`'s attribution line
shipped reading *"…was out of stock for 11 days. Stock status is a ranking factor."* It is not
one. `WEIGHT_KEYS` holds six — relevance, verification tier, measured reply time, spec
completeness, distance, plan tier — and the `12c` board drawn beside it shows the same six.

Three reasons to stay at six:

1. **Stock is a product field.** `Availability` has four values and belongs to a SKU. The six
   weights rank a business. One SKU going out of stock cannot move a business's position without
   a business-level derived factor — share-of-catalogue-in-stock, or similar — which is a new
   factor with a weight, a definition and a tuning history, not a relabelling.
2. **A seventh slider is not a seventh slider.** `12c` enforces "weights must total 100" and
   redistributes on change. Adding a seventh changes the layout, the constraint and the
   redistribution maths on a screen that is built and has never been exported.
3. **Nothing needs it.** The out-of-stock observation is still true and still useful — it belongs
   in the product table on `3l`, where it already appears as a row flag, and not in a ranking
   sentence.

**Actioned:** the line is corrected on `3l`'s canvas board and in `exports/3l/`. Every
seller-caused example on this board names one of the six. §7 of the brief does not apply and
`12c` keeps six sliders.

### Q1 · The denominator always renders

`#3 of 5`, not `#3`. The cold-start frame is the argument: at forty listings, a rank without its
denominator is the difference between a report and a flattery. It renders on both placements
because the component is one component, and it is a query on both — the count of businesses in
the ranked set for that category and emirate, or for that query.

### Q2 · One factor named, the rest counted

Name the largest contributor and count the others: *"Three factors moved. Most of the fall was
your measured reply time, up from 4h to 31h."* Where no single factor accounts for most of the
movement, the count stands alone with no name — naming an arbitrary one of three is worse than
naming none. A factor that did not move the position by at least one place is not named at all.

### Q3 · Competitor-caused says what happened, and stops

*"Your factors did not change. Two suppliers above you improved their measured reply time."*

Two sentences, both facts, no instruction. The temptation is a third sentence suggesting the
seller improve their own reply time, and that turns the most common state on the board into an
upsell that fires on a fall the seller did not cause. State 11 has no call to action by design.

### Q4 · A staff weight change is disclosed, its size is not

*"We changed how search results are ordered on 2 Sep. This affected every listing in the
category."*

The seller learns three things: it happened, when, and that it was not them. They do not learn
which weight or by how much. That line is where interface honesty is satisfied and operational
discretion still holds — publishing the weights turns `12c` into a public document and every
tuning pass into a negotiation.

### Q5 · `3a`'s card is Basic and above, rendered locked on Free

`/dashboard/analytics` is already gated at Basic, and a Free seller seeing their category rank
while unable to see the analytics behind it is an incoherent product. The overview's own doctrine
settles the rendering — *panels are dimmed and named, never hidden* — so Free sees the card with
the plan and its price, not an absence. Position is the most motivating number on the overview,
which is exactly why it is the one worth showing locked.

### Q6 · Primary category always, others where the business ranks

A row per category the business actually ranks in, primary first. Never padded to a fixed count:
three categories means three rows, one means one. Cap the card at three rows with *"and N more"*
linking to `3l`; the full list belongs on analytics, not the overview.

### Q7 · The sentence names the factor, not the events behind it

`3a`'s exported clause reads *"Cold rooms fell after two enquiries went unanswered last week"* —
which counts enquiries. The factor is `responseTimeMedianMs`. Naming events requires joining
attribution back to the individual enquiries that moved the median; naming the factor is a read
of two rows in the factor-history table.

**The factor, with its before and after:** *"Fell 2 places after your measured reply time rose
from 4h to 31h."* Cheaper, truer to what the ranker actually did, and more actionable — a median
the seller can watch beats a count they cannot reconstruct. **`3a`'s exported clause changes.**

---

## The component

One row. A label, a rank, a movement, and where one exists, a reason attached beneath.

| Part | Content | Notes |
|---|---|---|
| Label | The ranked object | A query on `3l`, a category and emirate on `3a` |
| Rank | `#2 of 34` | Both numbers queried. Neither is ever stored on the listing |
| Movement | `↑1` / `↓6` / `held` / `no comparison yet` | Against the first snapshot inside the window |
| Reason | One sentence | Optional. Attached to its row, never floating |

**The reason attaches to the row.** `3l` today puts the explanation in a note below the table,
which reads correctly while exactly one row has one. Three rows with three reasons and a floating
note cannot say which row it explains. This is the change that makes the component reusable, and
it is a change to a shipped screen.

**Two objects, never joined.** `#2 of 34` on `3a` is a rank among businesses in a category and
emirate. `#2 of 34` on `3l` is a rank for a phrase a buyer typed. Two snapshot tables, as the
schema already requires.

---

## States

### Position — seven

| # | State | Renders | Rule |
|---|---|---|---|
| 01 | Improved | `#2 of 34 ↑1` | |
| 02 | Fell | `#14 of 88 ↓6` | |
| 03 | Held | `#1 of 34 held` | Not `↔0`, not a dash, not empty — all three read as missing data |
| 04 | No comparison yet | `#7 of 61 no comparison yet` | Reuses the platform's `{kind:"none"}` absence and its wording. Never `0`, never `↑0` |
| 05 | Not ranked | `Not ranked` | Buyers searched it, this listing did not appear |
| 06 | No snapshot at all | `Not measured` + *"We have not ranked this category since 2 Sep."* | Unpublished, suspended, or the job did not run |
| 07 | Cold start | `#3 of 5 held` | The launch state. Rendered on frame 2, not described |

**05 and 06 must not share a rendering.** "You are not in the results" and "we do not know" are
different sentences. With 04 that makes three kinds of absence: a rank with no history, history
with no rank, and neither.

### Attribution — six

| # | Cause | The string |
|---|---|---|
| 08 | Seller-caused | *Fell 6 places after your measured reply time rose from 4h to 31h.* |
| 09 | Platform-caused | *We changed how search results are ordered on 2 Sep. This affected every listing in the category.* |
| 10 | Commercial | *Your paid boost for Marine & oilfield ended on 30 Aug. Before the boost this category was #9.* |
| 11 | Competitor-caused | *Your factors did not change. Two suppliers above you improved their measured reply time.* |
| 12 | Several factors | *Three factors moved. Most of the fall was your measured reply time, up from 4h to 31h.* |
| 13 | No explanation | *We cannot explain this move. Factor history starts 10 Jun.* |

**10 exists to stop a seller reading a loss they did not have.** A boost ending is a return to the
earned position. Without the sentence it renders as a five-place fall with no cause.

**13 never invents a cause.** A history gap — the 90-day prune boundary, or a night the job did
not run — says so.

---

## Strings for `lib/i18n/en.ts`

```ts
position: {
  rank:            '#{rank} of {total}',
  up:              '↑{places}',
  down:            '↓{places}',
  held:            'held',
  noComparison:    'no comparison yet',
  notRanked:       'Not ranked',
  notMeasured:     'Not measured',
  notMeasuredWhy:  'We have not ranked this {scope} since {date}.',
  updatedNightly:  'Updated nightly.',
  categoryCount:   '{count, plural, one {One category, because you rank in one.} other {# categories, because you rank in #.}}',
  andMore:         'and {count} more',
},
attribution: {
  seller:      '{direction, select, up {Rose} other {Fell}} {places} {places, plural, one {place} other {places}} after your {factor} {trend, select, up {rose} other {fell}} from {before} to {after}.',
  platform:    'We changed how search results are ordered on {date}. This affected every listing in the category.',
  commercial:  'Your paid boost for {category} ended on {date}. Before the boost this category was #{rank}.',
  competitor:  'Your factors did not change. {count, plural, one {One supplier} other {# suppliers}} above you improved their {factor}.',
  multiple:    '{count} factors moved. Most of the {direction, select, up {rise} other {fall}} was your {factor}, {trend, select, up {up} other {down}} from {before} to {after}.',
  unexplained: 'We cannot explain this move. Factor history starts {date}.',
},
factors: {
  relevance:         'relevance to the query',
  verificationTier:  'verification tier',
  responseTime:      'measured reply time',
  specCompleteness:  'spec completeness',
  distance:          'distance from the buyer',
  planTier:          'plan tier',
},
```

Factor names are lowercase because every one of them appears mid-sentence. `enquiry`, `quote`
and `supplier report` only; no banned term appears in any string above.

---

## Build notes

**None of these are on the frames.**

| # | Note | To action |
|---|---|---|
| **B1** | **Gap-fill job (brief §2A)** must land before any movement renders. An impression-driven counter gives a series with holes, and an arrow computed across a hole is wrong rather than absent | Nightly rank per category, write every listing's position from the ordered result |
| **B2** | **Factor history (brief §2B)** is what state 08 and 12 read. Vectors, not named columns | One row per published business per day: factor vector plus the weights vector in force that day |
| **B3** | **`WeightChangeDay`, or equivalent.** State 09 needs to know a staff weight moved and when. The weights vector in `B2` gives this for free if it is stored per day rather than per change | Derive state 09 by diffing consecutive weights vectors. No separate audit read |
| **B4** | **Boost expiry must be queryable by date.** State 10 needs the boost's end date and the position immediately before it started | `12c` requires a reason and an expiry on every boost, so both exist. Confirm the pre-boost position is recoverable from `B1`'s series |
| **B5** | **Competitor movement (state 11)** compares this listing's factor deltas against the deltas of listings that passed it. It is the only state that reads another business's history | Aggregate only — a count and a factor name. No competitor is ever named to a seller |
| **B6** | **`3a`'s card is switched on by `B1` + `B2` landing**, not by this design. `CategoryPositionDay` has a writer and zero readers today | One flag, released with the tables |
| **B7** | **90-day retention** joins the existing prune in `lib/analytics/retention.ts`. State 13's date is the prune boundary and must be read, not hardcoded | Two new tables into the existing four |
| **B8** | **`3a`'s exported clause changes** (Q7) and **`3l`'s stock sentence is corrected** (Q0). Both are already-shipped strings | Re-export both boards' specs alongside this amendment |

---

## Constraints held

- **No writable path.** Neither placement has a seller-editable field, and no control on the
  component changes a number.
- **Every number is a query**, denominators included.
- **Never pad.** Two categories renders two rows.
- **Cold start is drawn**, frame 2, not described.
- **Bad news never blames.** States 09, 10 and 11 each open by saying it was not the seller.
- **Voice.** Sentence case outside mono eyebrows and column heads. No exclamation marks, no
  emoji, no "just", "simply", "easily".
- **Vocabulary.** `enquiry`, `quote`, `supplier report`. No banned term in any string.
- **Real table markup** on both state matrices and the `3l` panel: `<table>`, `<thead>`,
  `<th scope="col">`.
- **Every string through `t()`**, and no layout assumes LTR — the rank, movement and reason are
  ordinary inline flow inside a flex row, with no positional offsets to mirror.

---

## Out of scope

**Query routing overrides** — drawn on the `12c` mockup, absent from the platform in every form:
no model, no screen, no rows. **Zero-result queue** — exists, renders on `/admin/crm`, not here.
Also out: the `12c` seventh slider (Q0 answers six), the ranking model editor itself, and any
change to how the six factors are computed.

---

## Dependencies

**Lands with this amendment:** the gap-fill job, factor history, the position component, and the
switch-on of `3a`'s card.

- `3a` gains the component and loses its enquiry-counting clause.
- `3l` gains the attached-reason form and loses the stock sentence.
- `12c` owns the six weights and the boosts that state 10 reads. **Unchanged by this.**
- `lib/analytics/retention.ts` gains two tables.
- The ranking-factor model still has three hardcoded copies — `3a`, `8e`, `12c` — and this
  amendment adds a fourth reader. **`12c` should own it**, as `3l`'s handoff proposed.
