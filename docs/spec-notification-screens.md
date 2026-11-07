# Notification delivery — screen spec sheet

**Date** 14 Sep 2026 · **Refreshed** 8 Nov 2026 · **Base** `main` at `7527e70` ·
**For** Claude Design, as a handoff brief · **Companion to** `docs/plan-notification-delivery.md`

The plan says what the engine must do. This says what people see. **Seven screens**: five in the
seller dashboard, one in the admin console, and one set of outbound message specimens. Two are
new — the notification centre and the message specimens — and five amend a board that already
ships.

Every screen below was read off the running tree before it was written up. Where a screen
already makes a promise it cannot keep, that is called out, because those are the ones a
design must not repeat.

## What the November refresh changed

Fifty-two commits landed between the first draft and this one. Three things moved under it:

1. **The platform floor shipped** (board 12g, `#205`). `PLATFORM_FLOOR` in `lib/notify/routing.ts`
   names six events the platform sends whatever the seller's matrix says, `route()` merges
   floor channels on top of chosen ones, and the alerts screen renders a floor channel as a
   ticked, locked cell with its reason (`floorLocked`, `alerts.floor_locked`). The first draft
   proposed this as a `Default` tag per row. **It exists, solved differently. S1 is rewritten
   around what shipped.**
2. **The admin template console was rebuilt** (same PR). `templateBoard()` reports a `missing`
   count per event and channel, `saveTemplateVersion` takes an event and a channel instead of
   an existing row's id, and the console carries a `FIRED BY` column. The create path the first
   draft asked for exists. **The A1 screen is withdrawn — see the appendix.**
3. **The event list went from 17 values to 31**, and `lib/notify/params.ts` now records an
   audience per event: **16 seller, 10 buyer**. Fourteen events are routed for buyers by
   `BUYER_DEFAULT`, six are on the platform floor, and eleven have a row on the alerts screen.
   Of the 16 seller events, eleven have a row, two are floor-only, one
   (`enquiry_unanswered`) has no emitter by design — and **two reach a seller only by accident**.
   The gap the plan describes is narrower than it was and has not closed.

---

## Index

| # | Screen | Surface | Route | Board | New or amended | Plan phase |
|---|---|---|---|---|---|---|
| S1 | What reaches you where | Seller dashboard | `/dashboard/settings` | 7e | Amended | 1, 2 |
| S2 | Notification centre | Seller dashboard | shell header + `/dashboard/notifications` | *7g, proposed* | **New** | 1, 2 |
| S3 | Failed payment, and what we have sent | Seller dashboard | `/dashboard/billing` | 3m | Amended | 2 |
| S4 | Cancelling while a payment has failed | Seller dashboard | `/dashboard/billing/cancel`, `/cancel/confirm` | 11h, 11j | Amended | 4 |
| S5 | Where buyers saw you | Seller dashboard | `/dashboard/analytics` | 3l | Amended | 3 |
| M1 | Six notices, as they arrive | Email · WhatsApp · in app | `/dev/notifications` | 7f | **New specimens** | 1, 2 |
| A2 | Failed payments, with the notices | Admin console | `/admin/dunning` | 12e | Amended | 2 |
| ~~A1~~ | ~~Template coverage~~ | ~~Admin console~~ | `/admin/notifications` | 12g | **Shipped `#205` — withdrawn** | — |

**Needs no screen:** default routing itself, the build check for an emitted event with no
route, both migrations, the dunning job's emitter wiring, and the `renewsAt` fix. Each of them
is visible only *through* the screens above.

**Recommended build order for design:** **S2 first** — it is the only wholly new screen, the
floor that shipped in September put more events on in-app than before, and nothing anywhere
reads them. Then S1, then S3, M1 and A2 together (one sequence, three views of it), then S4,
then S5.

---

## Rules every screen here inherits

These are the project's rules, restated only where they bite on this work. `CLAUDE.md` and
`docs/design-system.md` are the source.

- **Vocabulary.** *Subscription credit*, never refund. *Payment*, never purchase or checkout.
  No exclamation marks, no emoji, no "just", "simply", "easily". Sentence case, except mono
  eyebrows and column heads.
- **Say the number and the date.** "We try the card again on 17 Sep", not "soon". Every date
  comes from one source per screen and is never typed beside it.
- **Errors say what is wrong and what correct looks like**, and never blame the reader.
- **Real table markup** for every grid: `<table>`, `<thead>`, `<th scope>`. The routing matrix
  and both admin tables are tabular data with headers.
- **No layout assumes LTR.** Timelines, progress rails and chevrons must mirror.
- **Every string goes through `t()`.** Designs should mark every piece of copy as a string, not
  bake it into an image.
- **Unfilled stays visible.** A channel with no template, a notice that was not delivered, a
  seat with no verified number — each renders as a grey or amber state with a reason, never as
  an absent row.
- **Acceptance viewport is 1280 × 720.** Design at that width first; tables scroll inside
  their own container and the page never scrolls sideways.
- **Every documented state renders in `/dev/gallery`**, including empty and loading.
- **Trust signals never take a seller theme colour.** Not directly relevant here, but the
  billing notices must not borrow storefront theming either.

**Existing primitives to reuse, not redraw:** `Panel`, `Card`, `Alert` (tones `info`, `warn`,
`bad`; takes a `fix` sentence instead of a button when there is no control to offer),
`StatusBadge` (tones `ok`, `warn`, `bad`, `neutral`), `Tag`, `DataTable`, `Tabs`,
`StepHeader`, `Checkbox`, `Select`, `Button`, `IconButton`.

---

## S1 · What reaches you where

**Board 7e, amended.** Seller dashboard › Settings › Notifications tab.
**Rewritten 8 Nov** against the platform floor that shipped in September.

### Who and where

- **Sees it:** any seller seat. **Edits the matrix:** owner and manager (`routing.manage`). A
  sales seat lands on the Channels tab and never sees this one.
- **Reached from:** the dashboard sidebar (Settings); the notification centre's footer link
  (S2); a billing notice's "Change where this reaches you" link (M1).
- **Leads to:** the Channels tab, to verify a number; the Hours page, for quiet hours.

### What ships today

A real table, events down and channels across (WhatsApp, SMS, email, in app), with a `Goes to`
column naming whose handset each row reaches. **Eleven rows.** Two kinds of locked cell, each
ticked, disabled and carrying its reason in the cell's accessible name:

- **In-app locked** for the three deadline events (`enquiry_received`, `enquiry_escalated`,
  `quote_expiring`) — 7e §2.2.
- **Floor locked**, from `PLATFORM_FLOOR`, for a channel the platform sends whatever the matrix
  says. Six events: `document_expiring`, `ramadan_dates_moved`, `placement_slot_freed` on email
  and in app; `quote_declined`, `enquiry_nudged`, `quote_partly_accepted` on in app.

A channel with no carrier is disabled with its reason. `ROUTES_LIKE` lets an event inherit the
seller's choice for the event it extends (`quote_partly_accepted` follows `quote_accepted`), and
`withInheritedChoices` writes that inherited choice into the form so saving keeps it. Quiet
hours, escalation and nudge controls sit below.

**This is a well-built screen.** The redesign is additive. Do not re-solve the floor, the locks
or the inheritance.

### What is wrong with it today, and must not be repeated

1. **Eleven rows, sixteen seller events.** `params.ts` is the authority on which audience an
   event has; the fourteen buyer events never belong here. Of the sixteen, eleven have a row,
   `placement_slot_freed` and `ramadan_dates_moved` are floor-only, `enquiry_unanswered` has no
   emitter by design — and **two have no row and no floor entry**, so they reach a seller only
   if that business's stored matrix happens to contain them:
   - `subscription_renewed` — goes to the owner and the finance seat.
   - `review_dispute_decided` — goes to the owner. Board 11c's dispute rail promises in shipped
     copy that "the outcome and the reason are logged and sent to you".
2. **Saving still deletes routing the screen does not show.** `saveAlerts` builds a fresh
   `routing` object by looping over the eleven rows, so any stored event outside that list is
   dropped on the next save. A business whose matrix carries `review_dispute_decided` loses it
   the first time anybody presses Save on this screen. **The rows and the save loop must cover
   the same set**, and that set is every seller-facing emitted event.
3. **A tick can still promise a message with no template behind it.** The admin console now
   reports a `missing` count for exactly this, but the seller's screen does not know about it.
   The cell accepts the tick and nothing arrives.
4. **The floor is invisible as a concept.** A locked cell says why *in that cell*. A seller
   reading the table cannot tell that three of these rows are ours to send and eight are
   theirs to choose, which is the thing the groups below fix.

### What changes

**Rows, grouped.** Five groups, each with a quiet group heading row (`<th scope="rowgroup">`).
Two new rows, marked below; every other row already exists and keeps its current behaviour.

| Group | Event key | Row label (draft copy) | Goes to | Locked |
|---|---|---|---|---|
| Leads and quotes | `enquiry_received` | A new enquiry arrives | The assigned seat | In app |
| | `enquiry_escalated` | An unanswered enquiry escalates to the owner | The owner | In app |
| | `enquiry_nudged` | You nudge a buyer who has gone quiet | The assigned seat | In app (floor) |
| | `quote_accepted` | A buyer marks your quote won | The assigned seat and the owner | |
| | `quote_partly_accepted` | A buyer accepts part of your quote | The assigned seat and the owner | In app (floor) |
| | `quote_declined` | A buyer declines your quote | The assigned seat | In app (floor) |
| | `quote_expiring` | A quote you sent is about to expire | The assigned seat | In app |
| Reviews | `review_posted` | Someone leaves a review | The owner | |
| | `review_dispute_decided` **new row** | We decide a review you disputed | The owner | |
| Listing | `document_expiring` | A licence or certificate is about to expire | The owner and finance | Email, in app (floor) |
| | `setup_nudge` | Your listing is still unfinished | The owner | |
| | `ramadan_dates_moved` | We move the published Ramadan dates | The owner | Email, in app (floor) |
| Billing | `subscription_renewed` **new row** | Your subscription renews | The owner and finance | |
| | `placement_slot_freed` | A sponsored slot you are waiting for frees up | The owner | Email, in app (floor) |
| | `payment_failed` **new row, Phase 2** | A payment does not go through | The owner and finance | Email, in app (floor) |
| | `payment_final_notice` **new row, Phase 2** | Final notice before your plan changes | The owner and finance | Email, in app (floor) |
| Summary | `weekly_digest` | The weekly summary | The owner | |

Seventeen rows at Phase 2. `ramadan_dates_moved` and `placement_slot_freed` are floor-only
today and gain a row so the seller can see what they receive and add WhatsApp to it.

**A `We always send this` group note.** Rather than a tag per row, each group that contains
floor rows carries one line under it naming them: *"We always email you about a licence
expiring, moved Ramadan dates and a freed slot. You can add WhatsApp."* The per-cell reason
stays as it is — it is what a screen reader reads.

**An `Inherited` marker.** Where `ROUTES_LIKE` filled a row from another event's choice, a small
neutral `Tag` after the row label: *Follows "A buyer marks your quote won"*. It disappears once
the seller saves a choice of their own for that row.

**A cell state for "ticked, and not sent yet".** When a channel is on for an event with no live
template on that channel, the checkbox stays ticked and a muted caption sits under it: *Not sent
yet*. One footnote per table, not per cell. The count comes from the same `missing` figure the
admin console reports, so the two screens cannot disagree.

**Billing rows cannot be silenced.** Email and in app are floor-locked for both payment rows —
the same mechanism, not a new one. The seller can add WhatsApp. Pending your decision, Q1.

### Layout

Unchanged frame: the matrix `Panel` full width, quiet hours and escalation in a two-column grid
below. The table gains rows, not columns. At 1280 × 720, seventeen rows plus five group
headings put Save well below the fold, so **design a sticky save bar** that appears once the
form is dirty: *Unsaved changes* and Save.

### States

| State | What renders |
|---|---|
| Never saved | Platform defaults render as ticks; floor rows locked. Group notes explain what is ours. |
| Inherited row | `Follows …` tag; saving replaces it with the seller's own choice. |
| Dirty form | Sticky save bar with *Unsaved changes*. Leaving prompts. |
| Saving | Save pending, form inert. |
| Saved | Inline *Saved at 14:32* beside Save, polite live region. |
| Save failed | `Alert` tone `bad`, assertive live region, one sentence, values kept. |
| Channel has no carrier (SMS today) | Column cells disabled; amber footnote with the reason. |
| WhatsApp templates with Meta | Amber strip above the table (exists today). |
| Ticked, no live template | *Not sent yet* under the cell, plus one footnote. |
| In-app locked cell | Checked, disabled; accessible name gives the deadline reason. |
| Floor locked cell | Checked, disabled; accessible name gives the platform reason. |
| Seat with no verified channel | Existing reachability rail; must stay visible beside the new rows. |
| Sales seat | Tab not rendered; lands on Channels. |

### Data each element reads

Stored routing per event · `PLATFORM_FLOOR` · `ROUTES_LIKE` and the inherited choice ·
live template status per event × channel · available senders · pending-Meta count ·
reachability per seat.

### Acceptance

- Every seller-facing emitted event has a row. No row exists for an event routed by
  `BUYER_DEFAULT`.
- Saving a matrix and reloading keeps every event that was stored, including one the seller did
  not touch and one with no row.
- A floor-locked cell cannot be unticked, and is still ticked after a save.
- A ticked cell with no live template reads *Not sent yet*, and the count agrees with the admin
  console's `missing`.

---

## S2 · Notification centre

**New. Proposed board 7g.** A bell in the seller shell header, a popover, and a full page.

### Why it has to exist

Two shipped sentences promise it and nothing delivers it:

- 7e today: *"In app stays on for anything with a deadline. Turn every other channel off and
  the work still appears in a list."* There is no list.
- `lib/notify/senders/in-app.ts`: *"the seller's bell reads that table."* There is no bell, and
  no screen reads `notification_delivery` at all. Confirmed again on 8 Nov: there is no
  `/dashboard/notifications` route and no reader anywhere in `app/`.

In-app is the channel the whole plan leans on: it is never deferred by quiet hours, it is
locked on for deadlines, and it is the recommended floor for payment notices. Without this
screen, "locked on" means "written to a table nobody opens".

**September's floor made this worse, not better.** `PLATFORM_FLOOR` now puts six events on
in-app that a seller cannot switch off, three of them in-app only — `quote_declined`,
`enquiry_nudged`, `quote_partly_accepted`. Each is the answer to work the seller has open, each
is written to the delivery table, and none of them can be read by anybody. That is three
promises kept by a row in a table with no reader.

### Who and where

- **Sees it:** every seller seat. Each seat sees the notifications addressed to *them* — a
  delivery is to one recipient — not the whole business's.
- **Bell:** right of the seller shell header, before the account menu, on every dashboard page.
- **Page:** `/dashboard/notifications`. Not a sidebar row; reached from the bell only, the way
  the setup hub is reached from its progress figure.
- **Leads to:** each item's action link (the enquiry, the quote, the review, billing), and to
  S1 from the page footer: *"Change what reaches you where"*.

### Bell

- `IconButton` with a bell glyph and an accessible name that carries the count:
  *"Notifications, 3 unread"*.
- Unread count badge; hidden at zero; *9+* above nine.
- Opens a popover: the latest eight, newest first, each as a compact item. Footer: *See all*.
- Keyboard: Enter or Space opens, Escape closes and returns focus to the bell, arrow keys move
  between items. No focus trap beyond the popover's own.

### Page

- Header: eyebrow `NOTIFICATIONS`, title *Notifications*, meta *"{n} unread"*.
- `Tabs`: *All* · *Unread*. A third tab, *Billing*, only if a billing notice exists in the
  window — never an empty tab.
- Action: *Mark all as read* (secondary), disabled at zero unread.
- List grouped by day: *Today*, *Yesterday*, then `14 Sep`. A real list (`<ul>`), not divs.
- 50 per page with `Pagination`; the count above the list is the query's total, not the page
  size.

### An item

| Part | Source |
|---|---|
| Unread dot | delivery not yet read |
| Group glyph | event group from S1 (leads, reviews, listing, billing, summary) |
| Title | the in-app template's subject line, rendered |
| One-line body | the rendered body, truncated with the full text on the page |
| Time | relative under 24 hours (*2 h ago*), date after |
| Action | the template's action label and link |

**A billing item is visually weighted**, not by colour alone: tone-`bad` left rule plus the
word *Payment* in the eyebrow, so it survives greyscale and the contrast floor.

### States

| State | What renders |
|---|---|
| Brand-new seller | Empty state: *"Nothing yet. Enquiries, quotes and billing notices land here, including ones sent while your other channels were quiet."* No illustration padding. |
| Unread items | Dot, bold title, count badge on the bell. |
| All read | No badge; *Unread* tab shows *"Nothing unread."* |
| Item whose target is gone (quote withdrawn, review removed) | Action link replaced by muted *No longer available*. The item stays. |
| Item from a retired template | Renders the text it was sent with, not today's template. |
| Loading (popover and page) | Skeleton rows at item height; no spinner in the bell. |
| Failed to load | Popover: one line and *Try again*. Page: `Alert` tone `bad`. |
| Marking all read | Optimistic; reverts with an error line on failure. |
| Very long body | Popover truncates to two lines; page shows in full. |

### Engineering note for the design review

The delivery table still has no read marker — re-checked on 8 Nov against
`model NotificationDelivery`, which has `status` and `sentAt` and no `readAt`. S2 needs one, so
it carries a migration and should ride with Phase 2's rather than take its own. Name it after
`20261117091000_claim_templates_4c`.

### Acceptance

- A payment-failure notice written for a seat appears in that seat's bell without a reload on
  the next navigation, and not in another seat's.
- The count on the bell equals the count on the *Unread* tab.
- The popover is fully operable by keyboard and returns focus to the bell.

---

## S3 · Failed payment, and what we have sent

**Board 3m, amended.** Seller dashboard › Billing, top of page.

### Who and where

- **Sees it:** owner and finance seats (the billing page's existing fence).
- **Reached from:** the sidebar; every payment notice's action link (M1); S2.
- **Leads to:** S4 (cancel), invoices.

### What ships today

A tone-`bad` `Alert`: *"We could not take AED 1,499 on 4 Sep"*, the bank's reason, the next
retry date, and *"Your plan and your listing do not change before {deadline}."* No button,
because no card capture exists; a `fix` sentence instead.

### What is wrong with it today

The fix sentence still reads, word for word on 8 Nov: *"Reply to the email we sent about this
payment and we will take it manually."* **No email is sent.** The dunning job advances the stage and sends nothing. The
banner points a seller at a message that does not exist, on the one screen they reach when a
payment has actually failed. Phase 2 makes the email real; until it ships, this sentence is
false and the redesign must not depend on it.

### What changes

**The banner gains a sequence rail**: the dunning schedule as five dated steps, so the seller
sees what has happened and what is next. Dates come from the same schedule the job runs on.

| Step | Day | Label (draft) | Done state | Upcoming state |
|---|---|---|---|---|
| 1 | 0 | We tried the card | *Tried 4 Sep* | — |
| 2 | 3 | Email | *Emailed 7 Sep* | *We email you on 7 Sep* |
| 3 | 7 | WhatsApp | *Messaged 11 Sep* | *We message you on 11 Sep* |
| 4 | 14 | Final notice | *Final notice sent 18 Sep* | *Final notice on 18 Sep* |
| 5 | 15 | Plan changes to Free | — | *Your plan changes to Free on 19 Sep* |

Each done step also says *where* it went: *"Emailed billing@… on 7 Sep"*. A step whose notice
did not reach anyone says so in amber: *"Not delivered — nobody on your team has a verified
WhatsApp number"*, linking to Settings › Channels.

Below the rail, the existing promise stays verbatim: *"Your plan and your listing do not change
before 19 Sep."* And the drop is described as what it is — a plan change — never as a
suspension. The listing stays live, the reviews stay, the badge stays.

**The fix sentence is rewritten against what is true on the day it ships**: while no card
capture exists it names the email that *was* sent, by date, and only once that email exists.

### States

| State | Banner tone | What renders |
|---|---|---|
| Day 0–2, retried | `warn` | Step 1 done; next retry date; rail shows the rest as upcoming. |
| Day 3–6, emailed | `bad` | Steps 1–2 done, with recipient. |
| Day 7–13, messaged | `bad` | Steps 1–3 done. |
| Day 14, final notice | `bad` | Steps 1–4 done; headline changes to *"Your plan changes to Free on 19 Sep"*. |
| A notice not delivered | `bad` + amber step | Step reads *Not delivered*, with reason and link. |
| Paid during the sequence | `ok`, dismissible | *"Payment received on 9 Sep. Nothing changes."* Shown once. |
| Dropped to Free | `neutral` | *"Your plan changed to Free on 19 Sep because the payment did not go through."* What is still live, stated. Link to change plan. |
| Cancellation scheduled while past due | see S4 | The scheduled-cancellation banner and this one must not contradict each other's dates. |
| No gateway configured | as above | Step 1 reads *"No card was retried"* rather than implying a retry happened. |

### Acceptance

- Every date on the rail equals the date the job will act on.
- No sentence on the banner refers to a message that has no delivery row.
- The dropped state never uses *suspended*, *unpublished* or *removed*.

---

## S4 · Cancelling while a payment has failed

**Boards 11h and 11j, amended.** Seller dashboard › Billing › Cancel.

### Who and where

- **Sees it:** owner only (unchanged).
- **Reached from:** 3m's cancel card. **Leads to:** 11j confirm, then back to 3m.

### What ships today, and why it is broken for this case

The consequence table dates everything from the renewal date. When a renewal fails, the
subscription is marked past due and the renewal date is not moved, so it is already in the
past. A past-due seller who opens cancel reads *"Free from 4 Sep"* on 14 Sep, and confirming
writes an end date in the past, so the account drops on the next nightly run.

Confirming also marks the subscription *active*. One button clears the past-due status while
the dunning stage stays set, so every count that reads status treats the account as a healthy
paying subscription. The file now carries three comments about exactly this hazard for a
*trial* — the trial case was fenced in `#147` — and `past_due` appears in it nowhere, so the
same hole is still open for a failed payment.

### What changes

**A distinct state for step 1 when the subscription is past due**, the way a trial already
gets its own state instead of the table.

- Header unchanged; `StepHeader` unchanged.
- Above the consequence table, a tone-`warn` `Alert`: *"A payment did not go through on 4 Sep.
  Your plan already changes to Free on 19 Sep if it is not paid."*
- The table's *From* column is dated from **one** date, chosen by Q2 below — never from the
  stale renewal date.
- The side card restates the choice in one line: cancelling now changes *when* the plan ends,
  or only stops the retries, depending on Q2.

**11j confirm** repeats the same single date in its summary. **3m after confirming** shows one
banner that carries both facts, not two banners with two dates.

### States

| State | What renders |
|---|---|
| Past due, before final notice | Alert + table dated per Q2. |
| Past due, final notice sent | Alert headline uses the drop date; primary action copy does not imply the seller can avoid a change that is one day away. |
| Past due, cancellation already scheduled | Redirect to 3m, as today; 3m shows the combined banner. |
| Not past due | Today's screen, unchanged. |
| Trial | Today's trial sentence, unchanged. |

### Acceptance

- No date on 11h, 11j or 3m is earlier than today for a past-due account.
- Confirming does not change a past-due subscription's status to active.

---

## S5 · Where buyers saw you

**Board 3l, amended — small.** Seller dashboard › Analytics.

### Why

The funnel's first stage counts search results pages only. Area and emirate landing pages list
businesses and record nothing, while a storefront view from anywhere counts in the next stage —
so *"clicked through to your listing"* overstates itself against an undercounted top. Phase 3
adds a source to each impression so landing pages can be counted without polluting *"What
buyers searched to reach you"*, which must stay phrases a buyer actually typed.

### What changes

- **Funnel, stage 1:** the stage row gains a disclosure — *"Seen in: search 1,204 · area and
  emirate pages 388"*. The bar is still the stage total.
- **Queries panel:** unchanged content, plus one caption: *"Searches only. Area and emirate
  pages count toward how often you were seen, not here."*
- **Export:** a `source` column in the impressions table of the CSV.

### States

| State | What renders |
|---|---|
| Window entirely after Phase 3 ships | Breakdown shown. |
| Window straddling the ship date | Breakdown shown for the dated part, with *"Area and emirate pages counted from {date}"*. No invented split for earlier days. |
| Window entirely before | Stage 1 as today, with *"Search results only in this period"*. |
| Seller with no impressions | Existing cold-start state. |

### Acceptance

- The source figures sum to the stage 1 figure.
- No landing-page impression appears as a query phrase.

---

## M1 · Six notices, as they arrive

**Board 7f, new specimens.** The messages themselves: email, WhatsApp and in app, rendered in
`/dev/notifications` from the database rows.

### Why they need design, and why the copy is not code

Four events emit today and have no template, and two are new with Phase 2. The words are
content: they live as template rows authored in the admin console (A1), not in a commit. Design
gives each one its structure, its hierarchy and a **draft** in the product's voice; staff put
the final wording live through A1. WhatsApp wording also needs Meta's approval before it can
send.

`lib/notify/params.ts` now records, per event, the placeholders it supplies, the board that
owns it, and its **audience** (`seller` or `buyer`). All six below are `seller`. Design should
read that file for the authoritative placeholder list rather than this table, which is a
snapshot.

### What a template can contain

Subject (email only) · body · one action label and link · for WhatsApp, the Meta template name.
A body may use only the placeholders its event supplies — anything else refuses to send.

| Event | Channels | Placeholders available | Action link | Draft intent |
|---|---|---|---|---|
| `payment_failed` | Email day 3, WhatsApp day 7, in app | *to be declared in Phase 2:* amount, failedOn, reason, retryOn, dropsOn | `/dashboard/billing` | What failed, when we retry, the date nothing changes before, and what to do. No blame. |
| `payment_final_notice` | Email day 14, in app | *Phase 2:* amount, dropsOn, planName | `/dashboard/billing` | The date the plan changes to Free, and what stays: listing, reviews, badge. |
| `subscription_renewed` | Email, in app | `planName`, `amount`, `renewsAt`, `shortLink` | the tax invoice | Plan renewed, amount, next date, invoice link. |
| `setup_nudge` | WhatsApp, email, in app | `taskList`, `minutes` | `/dashboard/setup` | The unfinished tasks by name and how long they take. Sent once, ever — the copy must not read like a series. |
| `ramadan_dates_moved` | Email, in app | `year`, `from`, `to` | `/dashboard/hours` | Our published dates moved; the seller's own hours are untouched and there is nothing to re-answer. |
| `review_dispute_decided` | Email, in app | `outcome`, `ground` | the review | The outcome and the ground. Never the moderator's prose, never contact details. |

### Specimen states to design

For each event × channel: **live**, **draft**, **with Meta** (WhatsApp), and **broken** — a body
using a placeholder the event does not supply, shown with the refusal. Email specimens at
desktop and 375 px; WhatsApp as a phone bubble with its action button; in app as the S2 item.

### Voice rules that bite here

No *refund*, no *purchase*, no *suspended*. Say the amount with `AED` and the date as `19 Sep`.
The final notice must state what does **not** change as clearly as what does.

---

## ~~A1 · Template coverage~~ — withdrawn, shipped

**Board 12g shipped as `#205`.** Nothing to design. Kept here as a record of what the first
draft asked for and what the build answered, because S1 and A2 both read from it.

What the September draft asked for, and what exists on `main` today:

| Asked for | Shipped |
|---|---|
| A coverage grid, events × channels, gaps marked | `templateBoard()` returns a per-event, per-channel board with a `missing` count |
| A `Missing` state for an emitted event with no template | The `missing` state, with a `FIRED BY` column showing both directions — a template nothing sends, and a sender with no template |
| A create path for an event with no row | `saveTemplateVersion` takes an event and a channel and validates them against `EVENT_PARAMS`, instead of superseding an existing row's id |
| A count that is a query | The page's figures are queries (`B1`) |

Also shipped alongside it: `recordMetaDecision` for the WhatsApp approval step, `sendTestToMe`,
and a services twin picked at send time.

**What S1 and A2 take from it:** the `missing` figure. Both screens report template gaps and
must read that one number rather than compute their own.

---

## A2 · Failed payments, with the notices

**Board 12e, amended.** Admin console › Commercials › Failed payments.

### Who and where

- **Sees it:** staff with `revenue.read`. **No controls** — criterion 10 stands: nothing on this
  page suspends, unpublishes or removes a badge, and the sequence's only account effect is one
  plan change.
- **Reached from:** admin sidebar. **Leads to:** A1 when a notice has no template; the business
  record.

### What ships today

A table of nine columns: business, plan, **amount**, **the bank's reason**, stage, days past
due, *Next* (e.g. *"Send the email notice"*), **the date the plan drops**, and attempts. The
three in bold arrived after the September draft, with `#221` and `#239`, so the header count
this draft proposed is half-built already — the drop date is on every row.

It says what the sequence will do. It still cannot say whether anything it already did reached
anyone — and still nothing did: the `send` branch of `lib/billing/dunning-job.ts` increments
`notified` and writes no delivery row, re-checked 8 Nov.

### What changes

**A `Last notice` column**: channel, date, and delivery result as a `StatusBadge` —
`ok` *Delivered*, `warn` *Deferred to 07:00*, `bad` *Failed*, `neutral` *Skipped — no verified
channel*, `bad` *No live template*.

**An expandable row** with the full sequence for that subscription: the same five steps as S3,
each with what was attempted, on which channel, to which seat, and the result and reason.
This is the screen that answers *"did we tell them?"* before a plan changes.

**A header count that matters:** *"2 accounts change plan in the next 3 days · 1 has had no
notice delivered"*. The first half is derivable today from the `drops` column; the second half
is the part that needs Phase 2.

### States

| State | What renders |
|---|---|
| Nobody past due | Existing empty state. |
| No gateway | Existing info alert; attempts column reads *none*. |
| Notice delivered | `ok` badge. |
| Notice skipped — no verified channel | `neutral` badge, reason, seat named. |
| Notice lost — no live template | `bad` badge, link to A1's cell. |
| Drops within 72 hours with no delivered notice | Row highlighted with a `bad` left rule; sorted first. |
| Dropped | `neutral` stage, as today. |

### Acceptance

- For every row, the last notice's result equals the delivery record.
- The page has no control that changes an account.

---

## Decisions that change the design — yours

**Q1. Can a seller switch off payment notices?**
Now cheaper to answer than in September: `PLATFORM_FLOOR` is the mechanism, it shipped, and six
events already use it. My recommendation: no. Email and in app are locked on for both payment rows, shown on S1 so the
seller can see they receive them. A seller who silenced the notice and then lost their plan is
the worst outcome this sequence can produce.

**Q2. What date does cancelling a past-due subscription end on?**
(a) **The drop date the sequence already shows** — cancelling stops the card retries and the
plan changes to Free on the same day it would have anyway; one date on every screen.
(b) **Today** — the plan changes to Free immediately.
My recommendation: (a). It keeps S3 and S4 on one date, and a seller whose card expired has not
chosen to lose the rest of their grace period by pressing cancel.

**Q3. Is S2 seller-only?**
Weightier than it was: `BUYER_DEFAULT` now routes eleven events for buyers, five of them the
`claim_*` set, and several are in-app.
Buyer notices also write in-app deliveries, and buyers have no list either — but most buyers
have no account, so a buyer bell reaches few people. My recommendation: seller-only now, buyer
list later with board 10e.

**Q4. Does A2 get a resend control?**
My recommendation: no, for the same reason the page has no other control. A missing notice is
fixed in A1 or S1's channels, not by staff sending one by hand.

---

## Handoff checklist for each screen

When a board comes back from design, it is complete when it has:

1. Every state in its table drawn, including empty, loading and error.
2. Desktop at 1280 × 720, and the seller screens at 375 px.
3. Every string marked as copy, with the draft text.
4. Tables drawn as tables, with header scope noted.
5. A keyboard path noted for anything interactive (bell, popover, matrix, expandable rows).
6. No new colour outside the tokens, and every status carried by text or shape as well as tone.

**Before handing any screen to design, check this file's base commit against `main`.** This
spec went stale twice in two months: the platform floor and the whole admin console shipped
underneath it. Anything older than a few weeks needs the same pass this one had.
