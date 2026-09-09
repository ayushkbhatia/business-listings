# Amendment — search position and ranking attribution

**Amends** handoff 3, boards `3a` (seller overview) and `3l` (analytics).
**Status** design required · one board of states, no new screen.
**Written** 8 Sep 2026, against the repo at `f3dad8d`.

Board `3l` shipped as PR #144. It built both position tables and the analytics screen
around them. Two things its spec assumed do not exist in the platform, and a third was
never specified at all. This amendment covers the gap and asks for the states that close
it.

---

## 1. Why this exists

`3l` §B3 says every attribution sentence must trace to *"a factor changed, by how much, in
the window."*

That rule shipped. The history it reads does not exist.

`Business.responseTimeMedianMs`, `profileStrength`, `specCompleteness` and
`verificationTier` are **current-value columns**, overwritten every night by
`measureResponseTimes` and `measureProfileStrength`. Nothing anywhere keeps yesterday's.
So the platform cannot say what a factor *was*, only what it *is* — and B3's sentence
cannot be written.

Second gap: both position tables are **impression-driven**. `recordCategoryPositions`
writes only when a real buyer loads a category page, behind the crawler gate. A quiet day
produces no row, so the series has holes, and at 40 listings most sellers have holes on
most days. `3l` §B2 asked for snapshot tables; what landed is a counter.

Third: `3a`'s search-position card was switched off pending `3l` (§6 of the epic).
`3l` has landed. `CategoryPositionDay` now has a writer and **zero readers** — its own
schema comment says it is *"the one board `3a`'s hidden card reads"*, and `3a` does not
read it.

## 2. What is being built (no design needed)

Recorded here so the board knows what it can assume exists.

- **A · Gap-fill job.** Nightly, ranks each category once and writes every listing's
  position from the ordered result. Position stops depending on a buyer happening to
  browse.
- **B · Factor history.** One row per published business per day: the factor vector and
  the weights vector in force that day. Stored as vectors rather than named columns, so a
  seventh factor is a value and not a migration.
- **C · Factor set.** Six or seven — see §6, Q0. A decision, not a build.

Retention joins the existing 90-day prune (`lib/analytics/retention.ts`, currently four
tables).

## 3. What needs design

**One component, drawn once, placed twice.** A position row carrying a rank, a movement
and — where there is one — a reason.

| Surface | Object | State |
|---|---|---|
| `3a` overview, search-position card | Category position — `Cold rooms · UAE — #11` | Drawn in `3a`, never switched on |
| `3l` analytics, "What buyers searched to reach you" | Query position — `skf bearing distributor — #14` | Shipped |

These are **not the same number** and the schema is explicit that they must not share a
table. They are the same *component*. The repo's most-repeated defect is a shared
component that renders differently on two screens — draw it once and show both
placements.

`3l`'s version is live. `3a`'s must match it rather than reinvent it. Whoever draws this
needs `3a`'s exported board open beside them.

## 4. The states to draw

### Position

1. **Ranked, improved** — `#2 ↑1`
2. **Ranked, fell** — `#14 ↓6`
3. **Ranked, held** — `#1 held`. Not `↔0`, not a dash.
4. **Ranked, no comparison yet** — first day of history. Must not render as `0`. The
   platform already models this as `{kind: "none"}` and renders *no comparison yet*; reuse
   it, do not invent a second absence.
5. **Not ranked** — buyers searched the phrase, this listing did not appear. Shipped on
   `3l`; `3a` needs its category equivalent.
6. **No snapshot at all** — unpublished, suspended, or the job has not run. Distinct from
   state 5: "you are not in the results" and "we do not know" are different sentences.
7. **Cold start** — `#3` where the category holds five listings. See Q1.

### Attribution — the new work

8. **Seller-caused.** A factor they control moved. *"fell 6 places after measured reply
   time rose from 4h to 31h."*
9. **Platform-caused.** Staff moved a ranking weight on `12c`. Every listing shifted and
   none of them did anything. This must never read as the seller's fault. Never drawn.
10. **Commercial.** A manual boost expired. A paid reason, and it must say so plainly
    rather than presenting a purchased position as an earned one that was lost.
11. **Competitor-caused.** This listing's factors did not move; someone else's improved.
    **Probably the most common real case, and neither mockup draws it.**
12. **Several factors moved at once.** One named, or all of them? See Q2.
13. **Movement with no explanation.** History gap — the 90-day prune boundary, or a night
    the job did not run. Says so. Does not invent a cause.

## 5. Constraints the board must hold

From `CLAUDE.md`, and each has already caught a real defect in this project.

- **Derived metrics have no writable path.** Position and attribution are both derived. No
  seller-editable field, anywhere, ever.
- **Every number is a query, not a constant.** Including any denominator the card shows.
- **Never pad.** A card with three of five rows shows three rows.
- **The cold-start state is a designed state.** At 40 listings the card must read honest
  rather than broken. It is the launch state, so it gets drawn.
- **Errors and bad news say what is wrong and never blame the user.** States 9, 10 and 11
  are all cases where the honest sentence is *"this was not you."*
- **Voice.** Specific beats enthusiastic — say the number. Sentence case except mono
  eyebrows and column heads. No exclamation marks, no emoji, no "just", "simply",
  "easily".
- **Vocabulary.** `enquiry` not order, `quote` not invoice, `supplier report` not dispute.
  Banned outright: cart, checkout, buy, purchase, payout, refund, GMV, "Get quote", "Price
  on request". Enforced by `pnpm check:vocabulary`.
- **Every string through `t()`.** No layout may assume LTR.
- **Real table markup** where a table is drawn — `<table>`, `<thead>`, `<th scope>`.

## 6. Open questions the board must answer

**Q0 · Six ranking factors, or seven?**
The `3l` analytics mockup carries the sentence *"…was out of stock for 11 days. Stock
status is a ranking factor."* **It is not.** `WEIGHT_KEYS` holds six — relevance,
verification tier, measured reply time, spec completeness, distance, plan tier — and the
`12c` mockup drawn beside it shows those same six. Two problems: a seventh slider changes
`12c`'s "must total 100" and its redistribute maths; and stock is a **product** field
(`Availability`, four values) while the six weights rank a **business**, so one SKU going
out of stock cannot move a business's position without a business-level derived factor
such as share-of-catalogue-in-stock. Answer decides whether §7 below applies.

**Q1 · Does the position show a denominator?**
`#3` of five listings is not an achievement. `#3 of 7 in Cold rooms · UAE` is honest and
longer. Cold start makes this decisive rather than cosmetic.

**Q2 · How many factors does one attribution sentence name?**
One — the largest contributor — or every factor that moved? A threshold below which a
factor is not worth naming?

**Q3 · What does the sentence say when a competitor improved?**
State 11, the most common case, has no draft copy anywhere. It is also the hardest to
write without either blaming the seller or sounding like an upsell.

**Q4 · How plainly is a staff weight change disclosed?**
"We changed how results are ordered" is transparent and exposes internal tuning to every
seller at once. "Ranking changed" is vaguer and safer. State 9 needs a decision, and it
sits on the line between interface honesty and operational discretion.

**Q5 · Is `3a`'s card Free, or Basic and above?**
`/dashboard/analytics` is already gated at Basic. `3a` is on both plans. If gated, the
overview's own doctrine settles the rendering — *"panels are dimmed and named, never
hidden; a seller cannot want what they cannot see"* — so it is a locked panel naming the
plan and its price, not an absent one.

**Q6 · One category or several?**
A business carries a primary category and others. Does the card show the primary only, or
a row per category it ranks in?

**Q7 · Does the sentence name the factor, or the events behind it?**
`3a`'s exported clause reads *"Cold rooms fell after two enquiries went unanswered"* —
which counts **enquiries**. The ranking factor is measured reply time, a median in
milliseconds. Naming events requires joining attribution back to the enquiries that moved
the median; naming the factor does not. Two different data requirements, and the clause as
exported promises the more expensive one.

## 7. Conditional, only if Q0 answers "seven"

`12c` `/admin/search` gains a seventh slider, and the six-slider layout, the total-100
rule and the browse-relevance redistribution all move. `12c` is built (PR #35 — ranking
weights and manual boosts are live) but has never been exported, so this would be drawn
against a running screen.

Out of scope either way: **query routing overrides**, which appear in the `12c` mockup and
do not exist in the platform in any form — no model, no screen, no rows — and the
**zero-result queue**, which exists but renders on `/admin/crm` rather than here.

## 8. Delivered against

- States 1–13 drawn, at 1440×760, in the section the sibling boards use.
- Q0–Q7 answered in the spec, not left to the build.
- The position component shown in both placements, identical.
- Cold-start rendering shown, not described.
- Copy written as final strings, ready for `lib/i18n/en.ts`.
