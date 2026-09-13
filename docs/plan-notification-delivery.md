# Notification delivery, and the pending migration flags

**Date** 9 Sep 2026 · **Base** `main` at `36e74bb`, rechecked 14 Sep at `ee2a9a7` · **Status: planned, not built**

A plan rather than a record. It lives in `docs/` because everything in it was read off
**production** on the day, and those readings go stale — a phase that has since shipped, or a
count that has since moved, should be corrected here rather than remembered differently.

Companion to `docs/platform-state.md`, which says what is wired; this says what is wired and
still silent.

## Rechecked 14 Sep 2026, against `ee2a9a7`

Thirty-one PRs landed after the base. None of them touches this plan's substance, and every
code claim below was re-read on the new tree:

- `DEFAULT_ROUTING` exists nowhere. `route()` still reads `preference.matrix[context.event] ?? []`.
- `NotificationEvent` has no `payment_failed` or `payment_final_notice`, and the `send` branch of
  `lib/billing/dunning-job.ts` still advances the stage with no emitter.
- `search_impression_day` is still keyed `[businessId, day, normalised]` with no `source`, and
  `docs/platform-state.md` still carries the flag.
- The seeded routing matrix (`prisma/seed.mts`) carries five of fifteen events. The gap is
  reproducible on a fresh seed, not only on production.

**One claim was wrong and is corrected below:** the missing templates cannot be authored
through `/admin/notifications`. `saveTemplate` supersedes an existing row by id and returns
`not_found` without one, and `templateLibrary()` lists only rows that exist — so an event with
no template has no way in. `docs/build-plan.md` workstream 7.4 already owns that create path.

**Not rechecked:** the production readings. The database connection was unavailable on
14 Sep, so the counts, the four missing templates and the Ironbridge dates are as read on 9 Sep.

New migrations in Phases 2 and 3 must sort after `20261015090000_ranking_vector_by_kind`.

I flagged two things as "waiting on the next migration": a payment-failure notification event
so dunning's D3/D7/D14 stop sending nothing, and a source column on
`search_impression_day` so landing-page impressions can count without polluting the query
panel.

Both are real. **Neither is the main problem.** Reading production to size them turned up
something larger, and one thing with a date on it.

---

## What production actually says

Read directly, not inferred.

| Table | Rows on production |
|---|---|
| `search_impression_day` | **0** |
| `listing_view_day` | 0 |
| `category_position_day` | 45 |
| `notification_preference` | 14 |
| `subscription` | 8, of which **1 is `past_due`** |

### 1 · A subscription is five days into dunning and has been told nothing

`ironbridge-trading-co-llc`, Basic, `past_due_since` **4 Sep**, `dunning_stage` **`emailed`**,
last advanced **8 Sep**. The nightly job is running and moving it along.

The schedule is `{ retry: 0, emailed: 3, messaged: 7, final: 14 }` with one day of grace after
the final notice. So:

```
 4 Sep   payment failed, silent retry
 7 Sep   → emailed      (nothing sent)
11 Sep   → messaged     (nothing will be sent)
18 Sep   → final        (nothing will be sent)
19 Sep   → drop_to_free
```

**On 19 September this account silently loses its plan**, having received no email, no
WhatsApp and no final notice. It is a seeded fixture rather than a paying customer, so nobody
real is harmed — but the mechanism is live, the date is real, and the first genuine failed
card gets the same silence.

That is what makes this the first phase rather than a queued chore.

### 2 · I was wrong about `3m` Q2

I said twice that the grace period and retry schedule were "a finance decision nobody has
made". They are **decided and in code** — `SCHEDULE` and `GRACE_AFTER_FINAL_DAYS` in
`lib/billing/dunning.ts`, with the reasoning written above them. Nothing is blocked on you
here.

What is genuinely missing is narrower: nothing in the cancel flow *reads* dunning state, so
board 11h's "cancelling during a grace period" state is unbuilt. That is code, not a decision.

### 3 · The finding that reframes all of it

An event reaches a seller only if **four** things exist. Production has the first and fourth
and is missing the middle two, for four events that already emit:

| Event | Emitter | Enum | Template on prod | Routed on prod |
|---|---|---|---|---|
| `subscription_renewed` | ✅ | ✅ | ❌ none | ❌ 0 of 14 |
| `setup_nudge` | ✅ | ✅ | ❌ none | ❌ 0 of 14 |
| `ramadan_dates_moved` | ✅ | ✅ | ❌ none | ❌ 0 of 14 |
| `review_dispute_decided` | ✅ | ✅ | ❌ none | ❌ 0 of 14 |

`route()` returns `[]` for an event absent from a business's matrix, and `notify()` returns
before writing anything — so these do not even leave a skipped `NotificationDelivery` row.
They are silent in a way nothing reports.

`review_dispute_decided` is the one I shipped yesterday. It works, it is tested, and on
production it sends nothing.

**So adding two dunning events to the enum would buy exactly nothing.** The migration is the
cheapest quarter of the job.

---

## The root cause, and the fix worth making

`NotificationPreference.routing` is a **JSON snapshot of the event list as it stood when the
row was written.** Every event added since is invisible to every business created before it.
There is no backfill step, and nothing fails when one is missed.

Two ways out:

**(a) Backfill the JSON.** A data migration per new event, forever. It fixes today and
guarantees the same bug next time.

**(b) Make the matrix a set of overrides rather than an exhaustive list.**
`route()` reads `preference.matrix[event] ?? DEFAULT_ROUTING[event] ?? []`, with the
per-event default beside the event union in `lib/notify/routing.ts`.

**(b) is the plan.** It is a change to one pure function with an existing unit suite, it fixes
the four silent events without touching a row, and it means the next event to be added works
on the day its emitter lands. The seller's own choices keep priority, because an override is
still an override.

---

## Phases

### Phase 1 · Make notifications reach people at all

No migration. Ships alone, first, because of the 19 September date.

1. `DEFAULT_ROUTING` in `lib/notify/routing.ts`, one entry per event, and `route()` falling
   back to it. Unit tests: an override wins; an absent event uses the default; an event with
   neither still returns `[]`.
2. Board 7e's screen shows the effective routing and marks which rows are defaults, so a
   seller can see what they will receive without having chosen it.
3. The four missing templates. **Blocked on a create path** (corrected 14 Sep): the editor
   at `/admin/notifications` can only supersede a template that already has a row, and none of
   these do on production. Build-plan 7.4 adds the path; the copy itself is still content, not
   a commit — see §Yours below.
4. A check that fails the build when an emitted event has no default route. The class of bug
   here is "nobody noticed", and the answer to that is a scan, not vigilance.

### Phase 2 · The dunning migration

One `ALTER TYPE … ADD VALUE`, twice — the pattern this repo already uses five times.

**Two events, not one.** The `DunningAction` union already distinguishes them with
`final: true`:

- `payment_failed` — D3 email and D7 WhatsApp. One message, two channels, which the template
  system handles natively.
- `payment_final_notice` — D14. A genuinely different message: it names the date the plan
  drops.

Then `onPaymentFailed` / `onPaymentFinalNotice` in `lib/notify/events.ts`, called from the
`action.kind === "send"` branch of `lib/billing/dunning-job.ts`, which today advances the stage
and returns.

`NotificationDelivery` needs no new column — `subscription_renewed` established that a
subscription-shaped notification carries `shortLink` and no subscription id.

**Params:** the amount, the date it failed, and the date the plan drops. Not the card's last
four — `render()` refuses anything that looks like contact details, and a card number is the
one thing that must never be in a template.

### Phase 3 · The impressions source column

**Do this now or accept losing the data.** `search_impression_day` has **zero rows on
production**, so today the change is free. Every day it waits is a day of landing-page history
that board 3l says cannot be recovered.

The catch, and it is why this is not a one-line `ADD COLUMN`: the primary key is
`(business_id, day, normalised)`. A landing impression and a typed search can share a phrase
on a day, so `source` must be **in the key** — drop the PK, add the column, recreate it. On an
empty table that is instant; on a full one it is a rewrite.

Then: `recordSearchImpressions` takes a source; the query panel and `demandGap` filter to
typed searches; the funnel's stage 1 counts both. That closes the gap this batch withdrew —
"clicked through to your listing" becomes a click-through rate.

### Phase 4 · The two cancel-flow states dunning unblocks

Neither needs schema, and both were parked on a decision that turns out to be made.

- **Cancelling during a grace period.** The cancel flow reads no dunning state, so it offers a
  seller mid-dunning the ordinary consequence table. It should say what is already happening
  to them.
- **Cancelling while past due schedules a date in the past.** `renewal-job` marks `past_due`
  without advancing `renewsAt`, and cancellation derives every date from `renewsAt` — so the
  screens print a past date and the account drops on the next nightly run.

---

## Sequencing, and why

```
Phase 1 ──▶ Phase 2 ──▶ Phase 4
   (no migration)  (migration)   (no migration)

Phase 3 ── independent, and the clock is running
```

Phase 1 first because **Phase 2 does nothing without it** — a new event would join the four
that already route nowhere. Phase 3 is independent of all of it and I would ship it in the
same migration as Phase 2 to keep it to one schema step and one deploy.

Suggested: **one PR for Phase 1** (no migration, so I can merge it), then **one PR carrying
Phases 2 and 3** (one migration, stops for you), then Phase 4 folded into whatever comes next.

---

## Yours, not mine

1. **Six templates need copy.** Four that already emit and send nothing
   (`subscription_renewed`, `setup_nudge`, `ramadan_dates_moved`, `review_dispute_decided`)
   and the two new dunning ones. They are content in the database — CLAUDE.md is explicit that
   content does not belong in a commit — but the admin screen cannot create a first version
   yet (see Phase 1, step 3), so the copy waits on build-plan 7.4. I can draft all six in the
   product's voice and you publish them, or you write them; either way they are not code.

2. **Can a seller switch off a payment-failure notice?** My recommendation: it appears on
   board 7e so they can see they receive it, and cannot be turned off — the same argument that
   makes in-app never suppressed. A seller who silenced it and then lost their plan is the
   worst outcome this sequence can produce.

3. **The 19 September drop.** Ironbridge is seed data, so the honest options are to let it run
   as a live test of the sequence, or to reset `past_due_since`. The 11 Sep step has passed
   without a recheck; read the row before deciding.

## Not in any phase

3DS and card capture still need a real PSP, and no amount of notification work substitutes for
a seller being able to fix the card the notification is about. That remains the largest thing
between wave 4 and taking money.
