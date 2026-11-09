# Design prompt book — 65 prompts, six waves

**Written from `docs/screen-set-gap-analysis.md`, revised 9 November 2026** to cover both
November packages — the 102-board main canvas and the 28-board services canvas. Each entry is a
prompt to send to Claude Design as-is. They are ordered so that nothing is drawn before the
decision it depends on, and so that the prompts unblocking already-built backends come first.

**P-19 is withdrawn.** It asked a designer to draw `/onboarding/kind`, and board `2b-s` on the
services canvas already is that board. See `docs/screen-set-gap-analysis.md` §1.3.

## How to use this

Send one prompt per conversation. Paste the prompt verbatim, then attach the handoff folder it
names under **Read first**. Every prompt assumes the standing rules below, so do not restate
them — but do paste the **Standing preamble** once at the top of each conversation.

### Standing preamble — paste this above every prompt

> This is Business Listings, a UAE B2B trade directory. Buyers find licensed suppliers and send
> enquiries; suppliers pay a subscription to be found and to answer faster. It is **not
> e-commerce**: there is no cart, no checkout, no order entity, no payment capture, no payout and
> no refund of buyer money. The conversion event is an **enquiry** and the terminal state is an
> **accepted quote**.
>
> Non-negotiables that bind every board:
> 1. **No price on a public surface.** Prices exist only inside a `QuoteLine`, private to one
>    buyer and one seller. Public surfaces show availability and an enquiry action where a price
>    would sit. The correct string is "Price on enquiry".
> 2. **Verification is platform-owned.** Three rungs only — *Not verified*, *Claimed*, *Licence
>    verified*. There is no site-visit rung; it was cut on 5 Sep 2026. Badges never take a
>    storefront colour.
> 3. **Every staff state change writes an audit row with a written reason.** The reason field is
>    required. No screen may offer a staff action without one.
> 4. **Real table markup** — `<table>`, `<thead>`, `<th scope>`. Draw tables as tables.
> 5. **Every user-visible string is a string**, marked as copy with its draft text, never baked
>    into an image. English is the only locale; no layout may assume LTR.
> 6. **Response time is measured, never claimed.** Same for profile strength, spec completeness
>    and quoted value. No seller-editable field behind any of them.
>
> Vocabulary. Use: enquiry, RFQ, quote, accepted quote, quoted value (self-reported), supplier
> report, subscription credit, trade licence, TRN, free zone, emirate, made to order, indent
> order. Never: order, invoice from us, purchase, GMV, dispute (payment sense), refund, cart,
> basket, checkout, buy, payout, dispatch, POD, "Get quote", "Price: low to high", "Price on
> request", "Download price list".
>
> Which enquiry verb, where: **"Request a quote"** opens an empty composer · **"Send enquiry"**
> submits a filled one · **"Ask for a quote"** is the compact form on cards and rows. "Ask for a
> quote" replaced "Enquire" on 16 Sep 2026 — the pre-flight sheet in the November package is
> stale on this point and says `Enquire`. Ignore it.
>
> Voice. Specific beats enthusiastic: say the number — "218 suppliers in Al Quoz", not "many
> suppliers". Sentence case everywhere except mono eyebrows and column heads. No exclamation
> marks, no emoji, no "just", "simply" or "easily". Errors say what is wrong and what correct
> looks like, and never blame the reader.
>
> Interface honesty. Never pad a list to fill a grid — a slot with nothing eligible renders empty
> and is never backfilled, and a section with nothing renders not at all. Every number is a query,
> not a constant. Unfilled data stays visible as a grey row reading "Not provided", never hidden.
> An unclaimed listing says plainly that nothing is verified. **The cold-start state is a designed
> state** — at 40 listings the page must read honest rather than broken.
>
> Seller identity is always `displayName` — h1, identity strips, comparison rows, cards, search
> results, recipient lists, JSON-LD. The legal `tradeName` reaches exactly one surface: the
> details panel on the storefront overview, marked `licence-locked`. An unclaimed licence record
> on board 2a is the other exception; a **claimed** row takes the display name like everywhere
> else.
>
> **Plan prices are AED 0 / 349 / 899 per month.** Free is 1 category, 1 branch, 10 products,
> 3 services, 30 photos (3 public), 3 enquiries a month, 1 seat, 50 MB. Basic is 3 / 3 / 150 /
> 15 / 40 / 40 enquiries / 3 seats / 300 MB. Pro is unlimited categories, 10 branches, unlimited
> products and services, 200 photos, unlimited enquiries, 10 seats, 500 MB, custom subdomain and
> sponsored eligibility. Any board quoting a price or a cap uses these numbers.
>
> **A business has a kind: goods, services, or both.** Half the directory sells by the job and has
> no SKU. Where a board forks on kind, draw both bodies, or say explicitly that it does not fork.
>
> The services rules, which bind every `-s` board and every board that forks:
> - **A service is its own entity**, not a product with a flag. The fork is `Category.tradeKind`
>   per subcategory, nullable and inheriting from its parent, set on `4d-s`. The business
>   separately declares `SellsKind` — goods, services or both — on `2b-s`. There is no
>   `offering_type` and there never will be: a business-level flag deciding how a *listing*
>   renders is the mistake that field made.
> - **A scope sheet replaces the spec sheet**: six required fields — service name, engagement type,
>   turnaround, fee basis, deliverable, delivered where — and six optional, authored per service
>   family. *Indicative fee* is among the optional ones and is **private, routing only, never
>   published**.
> - **The done-condition is three services**, not ten products. A practice has four or five and
>   the bar is a complete list, not a long one. A sixth scores nothing extra.
> - **There is no services availability enum.** Decision D11 was closed as **no** on 11 Sep 2026.
>   Do not draw *Accepting new clients*, *Join the waitlist*, *at capacity*, *seasonal* or
>   *not accepting*. Four renders in the November services package still carry one; they are wrong.
> - **Credentials are evidence, not compliance.** Optional upload, verified only where a register
>   can answer, no expiry chasing. The trade licence is **not** a credential row. A credential
>   renders on every plan, because gating a trust signal would make *who checked it* something a
>   firm buys. A *certificate* is a different object — a document, a paid feature — and is not a
>   credential.
> - **Coverage, not branches.** One office and a coverage set, resolved **per service**. Setup
>   weights for a practice are credentials 32, services 20, licence 20, profile 12, team 8,
>   coverage 4, photos 4 — and they sum to 100 with the first six summing to exactly 80, the
>   *strong enough* bar, so a practice that finishes everything it can finish lands on the bar.
> - **Search is blended by default** with kind badges; tabs filter rather than partition.
> - **A proposal has a fee basis**, never priced line items, and **never a total**. No field on a
>   brief asks a quantity.
> - **The word "product" leaks.** Copy for a service surface goes through the paired-string
>   registry (`12g-s`), one key with two halves chosen by the business's kind.
>
> Draw at **1280 × 720** first — that is the acceptance viewport — and every seller screen also at
> **375px**. Tables scroll inside their own container; the page never scrolls sideways. Use the
> tokens in `shared/foundation/tokens.css` and no colour outside them. Every status must be
> carried by text or shape as well as tone. Every documented state gets drawn, including empty,
> loading and error. Note a keyboard path for anything interactive.

### Decisions to answer before sending certain prompts

Prompts marked **Blocked on Nn** must not be sent until that decision in
`docs/screen-set-gap-analysis.md` §4 is answered. Send the decision in the prompt as a stated fact.

### Do not commission these

| Board | Why |
|---|---|
| 5a, 5b, 5c, 5d, 5f, 5g, 5h | the storefront builder was deliberately deleted on 15 Sep 2026; keep it cut |
| **5c-s** | shipped 13 Sep as a staff library, cut 15 Sep with the builder. Its two surviving artefacts — `service-views.ts` and the paired-string layer — are load-bearing and stay |
| 12j | the approved decision is no resend control; the question belongs on 12i's expandable row |
| **6g-s** | cut 14 Sep 2026, unbuilt, despite the services README calling it "the most urgent gap in the track". It returns as a CI change and a table column — see **P-62** |
| **1c-s** | retired into `10c-s`: one screen, one route, one loader, and `10c-s`'s own spec resolves the two tab models in its favour |
| 10j | superseded — its panels became 13b–13h |
| 4e's attribute dictionary | decision D3 answered *no* on 9 Sep 2026 |
| **P-19 / `/onboarding/kind`** | **withdrawn** — board `2b-s` already is this screen |

---

# Wave D1 · Unblocks shipped code — send these first

Eight tested backends and two engines are waiting on a screen. Every prompt here is small and
each one converts work already paid for.

### P-01 · `3n` · The quote composer's part-quote opt-in

**Route:** `/dashboard/leads/:id` — a control inside board 3j's composer, not a new page.
**Read first:** `screens/3n-quote-composer/`, then `screens/3j-leads-and-rfq-inbox-with-quote/`.
**Why this first:** the entire split-acceptance engine shipped — `Quote.allowsPartial` with a
database trigger, `QuoteLine.acceptedAt`, the pricing and footing module, the accept service, the
buyer-company approval path, three migrations and 490 lines of integration test. None of it has
ever run in production, because the composer has no control that sets the flag. Boards `1o` and
`7h` cannot be drawn against anything until this is. It is the smallest prompt in the book and it
unlocks the most.

**Draw:** one opt-in inside the composer that says what it gives up and what it gains — a buyer
may accept some of your lines and not others. The two send-bar texts that follow from it (opted
in, and all-or-nothing). Four specimens of a sent quote: whole-quote, part-quote not yet decided,
part-quote with some lines accepted, part-quote with the rest lapsed.
**States:** unticked (the default) · ticked · ticked with a line the seller has since removed ·
read-only on a sent revision · refused for a `seller_finance` seat.
**Copy rules:** never the word *partial* to a buyer if a plainer phrase exists; the seller's
label must state the consequence, not the mechanism.
**Do not draw:** per-line opt-in. The decision is per quote.

### P-02 · `1o` · Accept lines from several suppliers — one decision

**Route:** `/enquiry/:id/compare` and a selection step after it.
**Read first:** `screens/1o-accept-lines-from-several-suppliers/`, then `screens/1n-buyer-account/`.
**Why:** the engine is complete and tested and has zero interface, and **there is no refusal copy
at all** — nothing tells a buyer why a cell cannot be chosen.
**Blocked on:** P-01 shipping, since a split is only offered where a supplier opted in.

**Draw:** the selection surface over 1n's comparison grid — a choosable cell per line per
supplier, the running footing as cells are chosen, the suppliers the choice commits to, and the
one decision that sends it. Then the confirmation, which must state per supplier what they will
be told.
**States:** nothing chosen · a valid split chosen · a cell unchoosable because that supplier is
all-or-nothing · a cell unchoosable because the line is already accepted elsewhere · no split
available at all (every supplier all-or-nothing) · the cheapest computed split shown but not
acceptable · over the buyer company's delegated authority, so it routes to approval instead of
accepting · a supplier's quote expiring mid-decision.
**Each refusal needs its own sentence.** The current code has none, and "you cannot do that" is
not one of the six.
**Also draw:** the narrow layout. A five-column price grid with a clickable cell per line has no
phone version, and the accept decision arrives by notification.
**Do not draw:** a price anywhere outside the comparison grid and the footing.

### P-03 · `7h` · Split approval — several suppliers, one decision

**Route:** `/account/company/approvals/:id`.
**Read first:** `screens/7h-split-approval/`, then `screens/7b-buyer-company-account/`.
**Why:** the route exists and renders one supplier. The split parts are computed in the service
and rendered by nothing — and worse, the approval card on 7b never consults the split, so a split
request is approvable today under a dialog naming one supplier and one total that supplier never
quoted.
**Blocked on:** P-02.

**Draw:** the approver's view of a split — every part, its supplier, its lines, its footing, and
the total against the delegated monthly authority. The 7b card that opens it, with the split case
drawn so the summary cannot name one supplier. The query and the answer path. The withdraw path.
**States:** pending · queried, awaiting the raiser's answer · answered · approved · refused ·
withdrawn · viewer is the raiser (cannot approve their own) · viewer is an admin on the company ·
over authority with no approver configured.
**Also draw:** 375px. The approver taps an email on a phone; `onApprovalRequested` already sends.

### P-04 · `7g` · Notification centre — bell, popover, page

**Route:** a bell in the seller shell header, plus `/dashboard/notifications`.
**Read first:** `shared/source-specs/spec-notification-screens.md` **§S2**, which is a complete
spec for this board. Then `screens/7e-settings/`.
**Why:** in-app is the channel the whole delivery plan leans on — never deferred by quiet hours,
locked on for deadlines, the floor for payment notices. Two shipped sentences promise a bell and
nothing reads the delivery table. Today "locked on" means "written to a table nobody opens".
**Decided already:** seller-only. A buyer list comes later with 10e.

**Draw:** everything in §S2 — the bell with the count in its accessible name and a `9+` badge;
the popover of the latest eight with a *See all* footer; the page with an `{n} unread` meta,
*All* / *Unread* tabs, a *Billing* tab only when a billing notice exists in the window, *Mark all
as read* disabled at zero, a real `<ul>` grouped by day, 50 per page with the count above the
list being the query's total rather than the page size. An item carries an unread dot, a group
glyph, the in-app template's rendered subject as its title, a one-line body, relative time under
24 hours and the template's own action label and link. A billing item is weighted by a tone-`bad`
left rule **and** the word *Payment* in its eyebrow, so it survives greyscale.
**States:** brand-new seller (no illustration padding) · unread · all read · the item's target
gone, where the action becomes a muted *No longer available* and **the item stays** · an item
from a retired template, rendering the text it was sent with · loading, as skeleton rows at item
height with no spinner in the bell · failed to load, in the popover and on the page · marking all
read, optimistic, with the revert · a very long body, truncated in the popover and full on the
page.
**Keyboard:** Enter or Space opens, Escape closes and returns focus to the bell, arrows move
between items, no focus trap beyond the popover.
**Tell the engineers, in the handoff note:** this needs a `readAt` column on
`notification_delivery` **and** a stored rendered message — subject, body, action label, action
url — on every delivery rather than only deferred ones. Today nothing stores the text of a sent
in-app notice, so there is literally nothing to render.

### P-05 · `3m` · The failed-payment sequence rail

**Route:** `/dashboard/billing`, top of page.
**Read first:** `shared/source-specs/spec-notification-screens.md` **§S3**. Then
`screens/3m-subscription-and-billing/`.
**Why:** the shipped board has **no failed-payment state at all**, while the staff side already
renders the five steps at `/admin/dunning`. A seller whose card failed opens this screen and is
told to reply to an email that is never sent.

**Draw:** the five dated steps as the amendment specifies — tried the card (day 0), email (day 3),
WhatsApp (day 7), final notice (day 14), plan changes to Free (day 15). Each done step says
*where* it went: *"Emailed billing@… on 7 Sep"*. A step whose notice reached nobody says so in
amber with its reason and a link to Settings › Channels. Below the rail, verbatim: *"Your plan and
your listing do not change before 19 Sep."*
**States:** day 0–2 retried (`warn`) · day 3–6 emailed · day 7–13 messaged · day 14 final notice,
where the headline becomes the drop date · a notice not delivered · paid during the sequence
(`ok`, dismissible, shown once) · dropped to Free (`neutral`, saying what is still live) · a
cancellation scheduled while past due, which must not contradict P-06's dates · no gateway
configured, where step 1 reads *"No card was retried"* rather than implying a retry happened.
**Copy rules:** the drop is a **plan change**, never a suspension, an unpublishing or a removal.
The listing stays live, the reviews stay, the badge stays. Never *refund* — it is a *subscription
credit*. Rewrite the fix sentence so it names only a message that has a delivery row.
**Do not draw:** a resend control. Approved decision.

### P-06 · `11h` + `11j` · Cancelling while a payment has failed

**Route:** `/dashboard/billing/cancel` and `/cancel/confirm`.
**Read first:** `shared/source-specs/spec-notification-screens.md` **§S4**. Then both screen folders.
**Why:** the consequence table dates everything from the renewal date, which a failed renewal never
advances — so a past-due seller reads a date in the past, and confirming writes an end date that
has already gone by. Confirming also clears the past-due status while the dunning stage stays set.
**Decided already:** a past-due cancellation takes effect **on the drop date the sequence already
shows**. One date on every screen.

**Draw:** a distinct step-1 state for a past-due subscription, the way a trial already gets one
instead of the table. A tone-`warn` Alert above the consequence table: *"A payment did not go
through on 4 Sep. Your plan already changes to Free on 19 Sep if it is not paid."* The table's
*From* column dated from the drop date and from nothing else. The side card restating the choice
in one line — cancelling stops the card retries and the plan changes to Free on the day it would
have anyway. 11j repeating the same single date. And 3m afterwards showing **one** banner carrying
both facts, not two banners with two dates.
**States:** past due before the final notice · past due with the final notice sent, where the
primary action must not imply the seller can avoid a change that is one day away · past due with a
cancellation already scheduled · not past due (today's screen, unchanged) · trial (unchanged).
**Copy rules:** the render currently says *"not refunded"*. Banned. The shipped copy is *"the
unused part is not paid back"*.

### P-07 · `12i` · Failed payments & notices

**Route:** `/admin/dunning`.
**Read first:** `shared/source-specs/spec-notification-screens.md` **§A2**. Then
`screens/12e-plan-config-and-failed-payments/`.
**Why:** the screen says what the sequence *will* do and cannot say whether anything it already
did reached anyone. It is the screen that answers *"did we tell them?"* before a plan changes.

**Draw:** a `Last notice` column — channel, date, and the result as a status badge: *Delivered*
(ok), *Deferred to 07:00* (warn), *Failed* (bad), *Skipped — no verified channel* (neutral), *No
live template* (bad). An expandable row with the full five-step sequence for that subscription,
each step naming what was attempted, on which channel, to which seat, and the result with its
reason. A header count that matters: *"2 accounts change plan in the next 3 days · 1 has had no
notice delivered"*. A row dropping inside 72 hours with nothing delivered gets a `bad` left rule
and sorts first.
**States:** nobody past due · no gateway, where the page must say both that no card was retried
**and** that no notice was sent · notice delivered · notice skipped, naming the seat · notice lost
to a missing template, linking to 12g's cell · dropping within 72 hours undelivered · dropped.
**Do not draw:** any control that changes an account, and no resend. This page is read-only by
design — the sequence's only account effect is one plan change.

### P-08 · `12g` · Template coverage grid and the create panel

**Route:** `/admin/notifications`.
**Read first:** `shared/source-specs/spec-notification-screens.md` **§A1**, then
`screens/12g-admin/12g-admin.md` (the rewritten spec).
**Why:** there is **no way to write the first version of a template**. The editor supersedes an
existing row by id and refuses without one, and the list shows only rows that exist — so an event
with no template never appears, and the one gap that silences a notification is the one gap this
screen cannot show or fix. It also flags only the harmless direction of mismatch (a template with
no emitter) and not the direction that loses messages.

**Draw:** a coverage grid above the version table — events down, channels across, one cell per
event × channel, with six cell states: *Live v3* (ok, *Edit*), *Draft* (neutral, *Review*), *With
Meta* (warn, *View*), *Missing and the event emits* (bad, ***Write first version***), *Missing and
the event routes nowhere by default* (muted dash, secondary *Write first version*), and *Nothing
sends this yet* (dormant). Each row header shows the event's human label, its key in mono beneath,
and a `Default route` caption naming the channels the platform routes it to. A meta line that is a
query: *"4 events emit with no live template on at least one channel."* Gap rows sort first.
Then the create panel: *Write first version* opens the existing editor in a **new** mode with the
event and channel fixed and shown, the placeholders that event supplies listed, a subject required
for email, a Meta template name required for WhatsApp, and the audit reason required. Saving
creates version 1 as a draft; the existing publish flow takes it live.
**States:** full coverage, where the meta reads *"Every emitted event has a live template"* ·
gaps · creating · a placeholder the event does not supply (inline refusal naming it) · email
without a subject · a WhatsApp draft, where the action is *Send to Meta* not *Put it live* · no
reason given (field error, nothing saved) · staff without the capability (404).
**Also owed, as its own frame:** a twin-status indication, since 27 templates need a services
version and the grid as drawn cannot show which. And the buyer-events tab — half the notification
surface is buyer-side and there is no view of whether those events can send.

### P-09 · `7e` · Settings — what reaches you where, at its real size

**Route:** `/dashboard/settings`, Notifications tab.
**Read first:** `shared/source-specs/spec-notification-screens.md` **§S1**, then
`screens/7e-settings/7e-settings.md` (the rewritten spec).
**Why:** the shipped screen renders **8 rows against 16 seller events**, and Save rebuilds the
stored matrix from the rows it shows — so a business with routing for an event this screen omits
loses it the first time anybody presses Save. The rewritten spec draws 13 rows. The schema has 16
and will have 18 once the two payment events land.
**Decided already:** payment notices are **locked on** in every channel. The seller may add
WhatsApp; they may not switch email or in-app off.

**Draw for 18 rows in six groups**, each group with a quiet heading row using `<th
scope="rowgroup">`. A `Default` tag after any row the business has never chosen for, with one
footnote under the table: *"Rows marked Default use ours until you change them."* A *Not sent yet*
caption under a cell that is ticked for a channel with no live template, with one footnote per row
rather than per cell. A **sticky save bar** that appears once the form is dirty — eighteen rows
plus six headings must not push Save below the fold at 1280 × 720. A **sticky event column** at
375px.
**States:** never saved (every row tagged) · some rows changed · dirty · saving · saved, with
*Saved at 14:32* in a polite live region · save failed, assertive, values kept · a channel with no
carrier, where the column is disabled with an amber footnote saying the setting is kept for when
one is configured · WhatsApp templates with Meta (amber strip) · ticked with no live template ·
a locked cell, checked and disabled with the reason in its accessible name · a seat with no
verified channel (the existing reachability rail, which must stay visible beside the new rows) ·
a `sales` seat, which never sees this tab and lands on Channels.

### P-10 · `7f` · Notification specimens, reconciled to real events

**Route:** a design-system sheet; the dev page at `/dev/notifications` renders it.
**Read first:** `shared/source-specs/spec-notification-screens.md` **§M1**, then
`screens/7f-notification-specimens/`.
**Why:** the shipped page invents its own sample values, so **25 of 41 placeholders print raw** as
`{approver}`, `{planName}`, `{quotes}` — a page whose job is to show how a message arrives shows
half of them broken. And four of its in-app specimens have **no event behind them at all**: a
buyer reported a problem, a product has been out of stock N days, a gated field was approved, a
platform template changed. Two numbers on it — 61% and 3.4× — measure nothing.
**This prompt needs a product answer first:** either those four become real events, each with an
emitter, templates, a 7e row and a 12g coverage cell — or the in-app panel is redrawn from the
16 seller events that exist. Recommend the second. The *description edit approved* item must
change either way: board 3b does not gate descriptions.

**Draw:** for each of the six events the amendment names — `payment_failed`,
`payment_final_notice`, `subscription_renewed`, `setup_nudge`, `ramadan_dates_moved`,
`review_dispute_decided` — a specimen per channel, in the product's voice, as a **draft** staff
will put live through 12g. A specimen may use only the placeholders its event supplies.
Email at desktop and 375px with real inbox chrome; WhatsApp as a phone bubble with its action
button; in-app as a 7g item. Label `kind` (goods, services, neutral) and show the live row per
line, not every version.
**States per event × channel:** live · draft · with Meta · and **broken** — a body using a
placeholder the event does not supply, shown with the refusal.
**Copy rules:** say the amount with `AED` and the date as `19 Sep`. The final notice must state
what does **not** change as clearly as what does. No *refund*, no *purchase*, no *suspended*.
`setup_nudge` sends once ever, so its copy must not read like a series.

### P-11 · Card capture — a screen the canvas does not have

**Route:** new, reached from `/dashboard/billing` and from `/onboarding/plan`.
**Read first:** `screens/3m-subscription-and-billing/`, `screens/2e-pick-a-plan-then-first-run/`,
`screens/11f-plan-change/`.
**Why:** **nothing on the 102-board canvas is a payment screen.** The money path runs end to end
as bookkeeping with no money moving: the provider is a console stub, nothing calls the setter,
there is no webhook route, and `PaymentMethod` rows come only from the seed. Without this board
nobody can pay for anything.
**Blocked on N9** — who issues the invoice and under what TRN. Do not draw a payment screen for an
entity that cannot issue a UAE tax invoice.

**Draw:** a provider-hosted card form, so card data never reaches our server — which means the
board draws the frame, the trust copy around it and every state, not the fields themselves. The
entry point from 3m's failed-payment banner (*Update payment method*). The stored-method display,
which already exists. The success and failure states. What happens on first payment during
onboarding versus a replacement later.
**States:** no method on file · adding · provider frame failed to load · declined, with the bank's
reason and what correct looks like · succeeded, and what changes immediately · a method expiring
within 30 days · replacing a method while past due, which must say that it retries now.
**Copy rules:** *payment*, never *purchase* or *checkout*. Never imply the platform holds funds
for a buyer–seller transaction — this is a subscription to the directory and nothing else.

### P-12 · `1l` + `2e` · Pricing, redrawn against the ratified plan table

**Route:** `/pricing` and `/onboarding/plan`.
**Read first:** `screens/1l-pricing-and-plans/`, `screens/2e-pick-a-plan-then-first-run/`.
**Why:** the render draws **AED 0 / 99 / 299**. The ratified numbers are **AED 0 / 349 / 899**,
and they are the only place the caps may live. A page quoting 99 against a 349 plan is the single
failure the pricing module exists to prevent, and `/pricing` is the first step of the money flow.

**Draw:** three cards and the comparison table, every row read from the plan table and nothing
typed beside it. Move the rows that are uniform across all three plans into a *The same on every
plan* block rather than printing three identical ticks. Both goods caps and services caps, since
half the directory has no SKU.
**Also fix on this board:** the *Lead response SLA badge* row. A trust signal sold for money
breaks non-negotiable 2 — strike it. And `3× + top slot` must be qualified rather than left bare.
**States:** anonymous visitor · signed-in seller on Free, where the current plan is marked ·
signed-in seller on Basic · on Pro · annual toggle where a plan can be sold annually and where it
cannot · a plan whose price changed after a seller subscribed (grandfathered by entitlement
snapshot), which needs one sentence somewhere.
**Do not draw:** any cap the plan table does not carry.

---

# Wave D2 · The states nobody drew — one job each, many boards

Four cross-cutting design jobs. Each is drawn once and applied everywhere, so each is one prompt
rather than one per board.

### P-13 · The loading state, as a system

**Why:** there is **no `loading.tsx` anywhere in 168 routes and no `Skeleton` primitive in the
component library**, while four public renders draw a skeleton that cannot be built from anything
in the repo. Board 1c's spec is specific — *"map pins dimmed to 60%, never cleared; a blank map
reads as broken"* — and nothing implements it.
**Read first:** `shared/foundation/component-inventory.md`, `screens/1c-search-results-map/`,
`screens/1a-directory-home/`.

**Draw:** one skeleton vocabulary at the token level — a row, a card, a table row, a chip, a
figure, a map — and then the composition for each of five surface families: a faceted list
(1b, 1c, 10a, 10c, 1e), a storefront (1d, 1f, 1g, 10g), a dashboard page with panels (3a, 3l,
3m), an admin table page (4b, 4f, 4h, 12i), and a modal or drawer. Say what never skeletons: the
nav, the sidebar, a heading that is already known, and a count that would read as a real number.
**Rules to settle on this board:** how long before a skeleton appears at all; whether a figure
skeletons or holds its last value; and the one case the specs already name — a map dims rather
than clears.

### P-14 · The error state, in the shell — and the unplanned 500

**Why:** there is **no `error.tsx` below `app/`**, so one failed read on a page composing four to
eight cached queries loses the entire shell. Board 4e's only refusal path is a thrown error that
lands outside the console. And `app/error.tsx` and `app/global-error.tsx` ship with copy nobody
drew.
**Read first:** `screens/13e-scheduled-maintenance/`, `screens/13d-listing-not-found/`.

**Draw:** three things. (1) A route-level error that keeps the shell — nav or sidebar intact, the
page body replaced, a retry, and a sentence saying what is unavailable rather than what broke.
One per surface family: public, dashboard, admin. (2) A panel-level error for a single failed
panel on an otherwise good page, which is the common case on 3a, 3l and 4a. (3) The unplanned
500, which is the only page a visitor meets when something is actually wrong — it must sit beside
13e's planned maintenance and read differently from it.
**Copy rules:** errors say what is wrong and what correct looks like, and never blame the reader.
A 500 does not apologise twice. Do not promise that we have been notified unless an error tracker
exists.

### P-15 · Permission denied, drawn once

**Why:** three incompatible treatments ship today, and no board in the package draws any of them.
Four seller seats exist (`owner`, `manager`, `sales`, `finance`) and four staff roles
(`ops_lead`, `moderator`, `field_verifier` — retired — and `finance`). Four onboarding and
dashboard screens refuse a write, and one of them refuses only after the file has been chosen.
**Read first:** `shared/foundation/permissions.md`, then `screens/7d-seller-team-roles-and-lead-routing/`.

**Draw:** the four distinct cases, because they are not the same screen. (1) **The route is not
yours** — a 404, which is what staff get today and is correct. (2) **The page is yours, the
control is not** — the control renders disabled with the reason in its accessible name, which is
the pattern the locked notification cells already use. (3) **The page is yours read-only** — a
strip above the header, as view-as already does. (4) **The write was refused** — an assertive
alert with the reason, values kept, which is the one that must never arrive after a file picker.
**Then specify which of the four each of these gets:** a `sales` seat on billing, a `finance`
seat on the catalogue, a moderator on a tier change, a moderator on the revenue board (see N2),
and a seller under an active view-as session.

### P-16 · The cold-start pass at 40 listings

**Why:** the project's own rule is that the cold-start state is a designed state and 40 listings
is the launch state, so it gets tested. No board draws the product at 40 listings. The places a
thin directory looks broken are specific: 4a's five-row category table, three-row search card and
twelve-month chart; 6a's four bands; 6c's chip-row matrix; 1a's rails; 12d's call list; 3l's four
panels; 6h's four curated slots.
**Read first:** `screens/4a-platform-overview/`, `screens/1a-directory-home/`,
`screens/6a-area-landing-page/`, `screens/6h-admin/`.

**Draw:** each of those surfaces at 40 listings, one emirate thin and one trade empty. The rule to
hold throughout: **a section with nothing eligible is dropped, never padded and never emptied** —
and a slot that lost eligibility renders empty rather than being backfilled. Say per surface
whether the honest thin version is the same composition with fewer rows, or a different
composition.

### P-17 · Narrow layouts — the discovery set

**Why:** *mobile buyer web* is an open route on the Flow Tracker and every render in the package is
1440px. This is the highest-traffic half of the product and the layouts most hostile to a phone:
filters, the map on search, and the spec table.
**Read first:** every board in `screens/1b`, `1c`, `1e`, `1g`, `10a`, `10c`, `10d`, `6a`, `6c`, `6d`.

**Draw at 375px:** 1c's *Filters (2)* drawer and the map's phone behaviour · 10d's four-column
comparison, which is the hardest one in the set · 1g's spec table and the enquiry panel's hoist ·
1d's overview, where the code has already made these calls itself and names a missing fourth
control · 1e's compact card and its selection bar · 6a's four bands · 6c's chip-row matrix · 6d's
pull quote at length · and **10a, whose own spec says in as many words that mobile is not drawn**
and which is the most-served template class on the site.
**Settle on this board:** whether a facet rail becomes a drawer or a sheet; where a sticky enquiry
action sits; and what a 12-column spec table does — scroll inside its container, or restack.

### P-18 · Narrow layouts — the seller reply set

**Why:** *a seller reply app* is the other open route, and the Flow Tracker's own argument is the
strongest in the package: reply speed decides ranking, and sellers are in a warehouse rather than
at a desk. Until this exists, the response-time band on every card is measuring how often someone
happens to be near a laptop.
**Read first:** `screens/3j-leads-and-rfq-inbox-with-quote/`,
`screens/11b-seller-message-thread-and-follow-up/`, `screens/3k-quotes-sent/`, plus P-04's output.

**Draw at 375px:** the leads inbox · a lead with its composer, which is the screen that matters —
a seller must be able to price and send a quote from a phone · the message thread · the quotes
pipeline · the notification centre's popover and page.
**Settle on this board:** whether the composer is the same screen narrowed or a different flow;
what the minimum viable reply is on a phone (a line, a price, a validity); and whether a
part-quote opt-in survives at this width.

---

# Wave D3 · Journey holes

Steps a real user reaches today with no drawing behind them.

### ~~P-19 · `/onboarding/kind`~~ — **WITHDRAWN. Do not send.**

This prompt asked a designer to draw `/onboarding/kind` on the grounds that it was *"built, live,
in the critical path of every new seller, and covered by no board on either canvas."*

**Board `2b-s` on the services canvas is that screen.** Its render carries the licence-evidence
card quoting three activity codes verbatim, the three options with three bullets each, the
`MATCHES YOUR LICENCE` badge sitting on the licence's answer rather than the seller's selection, a
*What this answer decides* list over setup / dashboard / storefront / enquiries, and a *CHANGEABLE,
BUT NOT FREE* cost card. Every item this prompt asked for is already drawn. The board is labelled
**NOT IN THE AUDIT** because it was added after the 4 Sep inventory.

The error came from reading the goods package alone, which omits the services canvas — which is
itself the strongest argument for shipping the two together.

**What survives, and where it went:** the board's two live copy defects are now **P-53** — one
string tells a seller switching kind that it *"rewrites your catalogue"* while another says
*"nothing you have entered is converted or deleted"*, and a third promises *"we will ask again"*
when nothing re-asks.

### P-20 · `2d` · Coverage, not branches — the services body

**Route:** `/onboarding/locations` — one route, two bodies.
**Scope narrowed on 9 Nov.** Board `2d-s` on the services canvas draws the services-only body, and
the one-route-two-bodies choice is correct — the services package's own bundled `context/routes.md`
names `/onboarding/locations`, and `2d-s`'s B1 and AC1 are only satisfiable on one route. **What
remains is the `both` body**, which `2d-s` B7 and AC8 require (the branch list *and* the coverage
set, grouped, labelled, neither behind a toggle) and which the package draws nowhere — the folder
holds one render.
**Why:** this is the longest version of the heaviest step in the funnel, and it is the publish gate
for every firm that both supplies equipment and services it, which is ordinary in this market.
**Read first:** `screens/2d-locations-and-hours/`, `shared/source-specs/services-spec.md`.

**Draw:** the services body — emirates and areas a firm covers, with the publish gate stated; the
`both` body, where coverage and branches coexist without nesting one inside the other; and the
goods body unchanged.
**States:** no coverage chosen (the gate, with what it blocks) · one emirate · emirate-wide versus
named areas · coverage that cannot be met by any branch (for a `both` seller) · a firm covering
every emirate, which must not render as seven identical blocks.

### P-21 · `8b-s` + `8c-s` · The two services setup tasks

**Route:** `/dashboard/setup/credentials` and `/dashboard/setup/services`.
**Why:** two built task screens — review states, suggestion tiles, a read-only licence row, a
scope-sheet step and a live preview rendering the real public scope table — and **neither is in
the package**. For a practice these are two of its four setup tasks.
**Read first:** `screens/8b-task-1/`, `screens/8c-task-2/`, `shared/source-specs/services-spec.md`.

**Draw:** both, to the same shape as 8b and 8c, including the one rule that differs — the
completion condition is **three services**, because a practice has four or five and the bar is a
complete list rather than a long one. The trade licence is **not** a credential row.
**States:** nothing added · one service · three (complete) · a service with a thin scope sheet ·
a credential under review · a credential with no register to check it against · a credential
reviewed but not verified, which must read *On file* and must never read *verified*.

### P-22 · `8e` · Setup complete, for a practice

**Route:** `/dashboard/setup/done`.
**Why:** the completion ticks are hardcoded to photos, products and team, so a practice's
completion screen prints *"0 products indexed on their own pages"*. It is the last thing a
practice reads in first-run.
**Also fix here:** **the Free seller cannot reach this screen at all.** Setup asks for two team
members against a one-seat plan, so the open count never reaches zero. The design decision is
whether the team task targets the plan's seat allowance or disappears on a one-seat plan — board
8d's own spec flagged this and recommended two seats on Free.
**Read first:** `screens/8e-setup-complete/`, `screens/8d-task-3/`.

**Draw:** a kind-aware tick set; the Free variant with whichever answer you take on the team task;
and the destination, which is board 3a's first-day state (P-23).

### P-23 · `3a` · The dashboard overview — decide, then draw

**Route:** `/dashboard`.
**Blocked on N5 and N4.**
**Why:** the render's five hero figures, twelve-week chart, triage queue and spec-completeness card
are **a different screen** from what ships, and the repo's choice is recorded as a product decision
rather than an omission: *"the charts are a link."* The two versions disagree about what the screen
is for. And before either can be drawn, one question has to be answered: which single number is
listing health — profile score, spec completeness, or the ranking composite? Four surfaces render
whichever wins.
**Read first:** `screens/3a-dashboard-overview/`, `screens/11a-free-plan-dashboard/`.

**Draw, once the two decisions land:** the steady state, leading with what needs a reply rather
than with charts, because the enquiry loop is the only one that opens daily. **The first-day
state**, which every seller sees exactly once immediately after being told setup is complete, and
which today renders as the steady state with zeros and no narrative. The Free variant (11a) with
its limits block and its locked-analytics card — see P-31.

### P-24 · `10g` · The held enquiry

**Route:** `/b/:slug` — the unclaimed variant.
**Why:** this is the one undrawn state that is **already blocking a schema change and three other
boards' numbers.** `RecipientState` has no `held` value, and boards 2a, 2b and 4c already print
figures that depend on held enquiries existing — 4c is a shipped admin screen displaying a number
nothing can produce. 10g's own spec says to draw it first.
**Read first:** `screens/10g-unclaimed-listing-page/`.

**Draw:** the pre-send warning a buyer sees before enquiring with an unclaimed listing; the
composer on a page that currently has none; the suggestions alongside it, so the buyer is not left
with one unclaimed option; and the expiry notice the buyer gets when a held enquiry lapses
unclaimed. Plus the seller's side: what a claimant sees on arrival when enquiries were held for
them, which is the strongest claim incentive the product has.
**Two more states on this board while you are in it:** the reviews-exist composition (a read-only
block with count and rating, and where it sits relative to the record card), and the
**lapsed-licence frame** — the state 30,000 pages drift into, which nobody has seen with the claim
card gone from both the banner and the rail.

### P-25 · `13b` · WhatsApp hand-off, reconciled with the detector

**Route:** `/enquiry/:id/whatsapp`.
**Why:** no route exists, and today **every `wa.me` chip on the site leaves with no reference
line** — a seller gets a WhatsApp message with nothing tying it to an enquiry. The build plan has
made one thing this board's prerequisite since 14 Sep: it must be reconciled with the detector that
reports sellers for steering conversations off the record.
**Read first:** `screens/13b-whatsapp-hand-off/`.

**Draw:** the hand-off itself, with the prefilled message and its reference. And carry the product
argument in the right-hand column: what the platform keeps a record of, what it does not, and why
a platform-initiated hand-off is not the same thing as a seller steering a buyer off-platform. The
board has to say this, because the two features contradict each other until it does.
**States:** buyer has WhatsApp · buyer on desktop, where the hand-off is a QR or a link · the
seller has no verified WhatsApp number · the enquiry is closed · the reference could not be
generated.

### P-26 · `13d` · Listing not found — and the 404/410 split

**Route:** `/b/:slug` returning 404 or 410.
**Why:** unbuilt down to the status code, and its suggestion query exists and was written for it —
its comment says so in the future tense — but serves only 10g. Thirty thousand unclaimed listings
and a live redirect table guarantee dead slugs.
**Read first:** `screens/13d-listing-not-found/`.

**Draw:** the five ways out, and the **`HOW WE RESOLVED THIS ADDRESS` diagnostic** with its three
verdicts — moved (301, so this page never renders), merged into another listing, and never existed.
The board must state which status code each case returns.
**States:** merged · removed on a report · closed by the seller · a slug that never existed · a
slug under the wrong parent.

### P-27 · `13i` · Verification & review policy, on the numbered legal template

**Route:** `/legal/verification` and `/legal/review`.
**Blocked on N3.**
**Why:** the live verification policy **names four tiers the database forbids and tells a buyer that
a lapsed licence keeps its badge** — while the sweep removes it the same day. The review policy
disagrees with the code on five separate points. Boards 13f and 13g have since moved to a numbered
template with section nav, a rail and real tables; these two have not. Drawing 13i means drawing
them in that template.
**Read first:** `screens/13f-legal/`, `screens/13g-legal/`, and `docs/design-exports.md` §13i in
the repository.

**Draw:** both policies in the 13f template. The verification policy carries **three** rungs — Not
verified, Claimed, Licence verified — what each one means, what we check, what we do not check,
and what happens the day a licence lapses. It must settle what tier 1 is called for an unclaimed
listing whose licence lapsed, which is decision N3. The review policy carries **five** removal
grounds (no traceable enquiry, abuse, private information, provably false, and the staff-only
incentivised), holds with a written reason and an exact release, the **28-day** reply window, the
**90-day** window to write a review, one review per supplier per enquiry, the 14-day edit window
and *one reply, never edited*.
**Do not carry over:** *off-topic* as a ground. It is not one.

### P-28 · Cookie consent — the banner and the settings screen

**Route:** a banner on every page, plus `/cookies/settings`.
**Why:** the published cookie policy asserts a consent banner, a settings screen, a withdrawal
that clears identifiers, and Global Privacy Control. **None of the four is built** — the code's own
test says so in its assertion — so the page is inaccurate on the one point a regulator or a buyer
would check.
**Read first:** `screens/13h-legal/`, and `lib/legal/cookie-register.ts` in the repository.

**Draw:** the banner, with the most privacy-preserving option as the default and no dark pattern —
declining is as easy as accepting. The settings screen with its four categories. The withdrawal
path and what it says it clears. And the state for a visitor whose browser sends Global Privacy
Control, which must be honoured without asking.
**Note for the handoff:** the register and the code disagree in both directions. Nine of twelve
registered cookies are set by nothing, while two that **are** set — the attribution cookie and the
session cookie — are unregistered or registered under the wrong name. The board should carry the
corrected register as a table.

### P-29 · `10i` · The campaign capture step, and a campaign editor

**Route:** `/lp/:campaign` step 2, and a new admin screen.
**Why:** the shipped landing page is a headline, two links and a caption where the board draws a
two-step quote form — and step 2 is where a paid visitor converts or does not. Separately, nothing
but the seed writes a campaign, so a second landing page costs a deploy, which is the one thing
the model was built to avoid.
**Read first:** `screens/10i-campaign-landing-page/`.

**Draw:** step 2 — name, mobile, the OTP, then the enquiry confirmation. And a campaign editor in
the console: headline, standfirst, body, meta title and description, the trade the primary button
names, the recipient cap, and publish.
**One defect to fix in the drawing:** the call-to-action may name any category, and a subcategory
builds a URL that 404s. The button must link to the parent-plus-child path with filters cleared.
**Copy rule:** the board's RFQ link currently reads *"Describe what you need instead"*. The house
verb for a link that opens an empty composer is **"Request a quote"**.

### P-30 · `11a` · The Free-plan dashboard's limits block

**Route:** `/dashboard` with `plan=free`.
**Why:** the four limit meters currently live on a billing screen a Free seller has no other reason
to open, and three rules on the board are undecided: count what you list rather than what you
could; the word is *limits*, not *caps*; and danger tone only where a limit is actually costing
them something. Plus the open question — do we mute a limit that has not been hit?
**Read first:** `screens/11a-free-plan-dashboard/`, `screens/3m-subscription-and-billing/`.

**Draw:** the limits block with the muting rule settled, on the dashboard rather than on billing.
The **locked-analytics card** — Free sellers meet analytics only as a redirect today, and the
silhouette treatment the board describes is drawn nowhere, though the locked-panel pattern exists.
**States:** no limit near · one limit at 80% · one limit reached and costing them (an enquiry
refused, a product that cannot be added) · several limits reached · a seller whose entitlement
snapshot grandfathers a higher cap than the current Free plan.
**Do not draw:** any capacity figure on a public surface. The cap never reaches a buyer.

### P-31 · The held-enquiry paywall (decision D4)

**Route:** a panel on `/dashboard`, plus the notification and the release path.
**Why:** the owner's ratified answer to D4 reframes a capped seller's missed enquiries as **revenue
waiting rather than leads lost** — the rows already exist as `MissedEnquiry`. What is missing is
the panel, the notification, the wording and a release path on subscribe. No board covers any of
it, and it is the go-to-market engine.
**Read first:** `screens/11a-free-plan-dashboard/`, `screens/3m-subscription-and-billing/`.

**Draw:** the seller's panel — how many enquiries are waiting, from which trades, how recent, and
what unlocks them, without naming a buyer or quoting a requirement in enough detail to answer it
off-platform. The notification that tells a capped seller an enquiry is waiting. The unlock
moment, immediately after subscribing, where the held enquiries are released and the seller sees
them for the first time.
**Hard rule:** **capacity never reaches a public surface.** A buyer must never learn that a
supplier is at their monthly limit, and must never be told their enquiry was held.

### P-32 · Saved requirements — draw it or delete it

**Blocked on N7.** Recommendation: delete for launch.
**Why:** it is drawn as a card on 10e, a panel on 1i, and a fifth account tab on 1n, 1o and 7h —
and there is **no model behind any of it**. Five screens reference an object that does not exist.
**If the answer is delete:** this prompt is a revision pass removing the panel and the tab from
five boards, which is the cheaper and the recommended option.
**If the answer is draw:** the list, the editor, the re-send, and the relationship to a saved
search (which does exist and does alert). Plus what happens to a saved requirement whose category
was merged.

---

# Wave D4 · Console completeness

### P-33 · `/admin/areas` — the geography editor, on its own board

**Route:** `/admin/areas`.
**Why:** board 12h draws four unrelated panels on one screen — geography, API keys, compliance and
security — which have nothing in common but a sidebar group. **None of the three routes exists.**
Geography is the only one of the four that is both needed now and buildable now: the schema
already promises *"a data change, never a deploy"* and today it is a migration.
**Read first:** `screens/12h-system/12h-system.md`.

**Draw:** the emirate and area list with listing counts per row; the editor; a `searchAliases`
field, which does not exist yet and which is the reason a buyer searching "Al Quoz" and "AlQuoz"
gets two different result sets; the 60-listing publish threshold shown per row so an ops lead can
see which areas are near it; free-zone flagging; and the slug-change confirmation with its 301.
**States:** an area with no listings · an area below the publish floor · an area above it · a
rename that will issue a 301 · a merge of two areas · an emirate with no areas yet.
**Do not draw:** field visits. Cut on 5 Sep 2026. The board's current render still shows them.

### P-34 · `/admin/compliance` — the PDPL queue, on its own board

**Route:** `/admin/compliance`.
**Why:** a data-subject queue with a statutory clock is a different audience, a different urgency
and a different failure mode from an area editor. The table exists with **zero readers and zero
writers**. And before any of it is drawn, the deletion rule has to be reconciled with board 11i's
account closure and board 13g's privacy promises, which currently describe three different things.
**Read first:** `screens/12h-system/12h-system.md`, `screens/11i-close-account/`,
`screens/13g-legal/`.

**Draw:** the queue with its statutory clock per row; the request detail; the export-generating
state; and the **deletion-refused** state, which is the interesting one — some data is not ours to
delete, and 11i already carries that argument for a seller closing an account.
**States:** no requests · a request inside its clock · a request near its deadline · export
generating · export ready · deletion done · deletion refused with a ground · a request about a
person with no account.

### P-35 · `4c` · The four edit bodies at `/admin/queue/:id`

**Route:** `/admin/queue/:id` and its five siblings.
**Why:** board 4c draws the **conflict** body only, and its own spec says the four edit kinds need
a before/after body drawn before they are built. The repo has built all six anyway — claim,
conflict, credential, document, location and the generic edit — so what is missing is the design
against which five of the six detail screens in the console's highest-volume board have **never
been reviewed**.
**Read first:** `screens/4c-review-a-submission/`, `screens/4b-approval-queue/`.

**Draw:** a before/after body for each gated edit kind — name, category, licence details — plus the
location and document bodies. One shared shape, four fillings, because a moderator moves between
them all day.
**States per body:** approve · refuse with a reason · the submitting seller has since changed it
again · the subject was merged or closed while queued · read-only for a moderator where the
decision is ops-lead-only.

### P-36 · `4c` · The challenge case — a claim against a granted claim

**Route:** `/admin/queue/conflict/:id`, a second body.
**Why:** a new claim against an already-granted one moves a subscription, a catalogue and an
enquiry history between two real companies. **The build refuses it by name** and offers only
keep-owner or escalate, which is the spec's own interim position — and the refusal is the product
until the screen exists. Until then the only route for a wronged owner is board 2a's dispute form.
**Read first:** `screens/4c-review-a-submission/`, `screens/2a-find-or-add-your-business/`.

**Draw:** the comparison that lets an ops lead decide between a sitting owner and a challenger on
the same evidence rows; what moves and what does not if the challenge succeeds — subscription,
catalogue, enquiry history, reviews, seats; and the escalation path.
**States:** challenger's evidence stronger · sitting owner's stronger · neither conclusive · the
sitting owner unresponsive · the challenge withdrawn · a challenge on a listing with an active
paid subscription, which is the case that costs money.

### P-37 · `12a` · A file that cannot go through a form

**Route:** `/admin/ingest`.
**Why:** board 12a is specified at 8,000 rows. **The real file is 40,000+** and the product refuses
it at the upload control — the body limit is 4 MB and a 40,000-row licence export with name,
number, authority, expiry, emirate, area, activity and phone is 6–10 MB. No amount of tuning fixes
it on the current transport. And there is a design question underneath the engineering one: the
three stat cards' whole claim is that they **sum to the file**, which stops being true the moment
one registry export arrives as several runs.
**Read first:** `screens/12a-licence-record-importer/`.

**Draw:** the large-import path — an object-storage upload rather than a form post, a staging job
with real progress, and what the operator does while it runs. Then the thing that decides the
board: what the three stat cards mean when one export is several runs. Either they sum across a
named batch, or they stop claiming to sum.
**States:** uploading · staging, with progress and a cancel · staged with rejects · partially
staged because a chunk failed · publishing · published · rolled back · a run that is one of
several in a batch.
**Also settle, once, for every board that renders the sidebar:** ingestion's home in the
navigation. The screen that produced the entire directory currently borrows *Businesses*.

### P-38 · `12f` · The view-as expired state, and the support-desk decision

**Route:** `/admin/support`, and the strip on every `/dashboard` page under a session.
**Blocked on N11** for the desk half.
**Why:** the expired state is **the state that currently breaks the feature** — nothing ends a
session at thirty minutes, expiry is only applied on read, and once any staff member lets a
session lapse the next one they start fails on a unique index and lands on an error page. It is
drawn nowhere. Separately, 12f draws a full helpdesk — SLAs, queues, threads, canned replies,
assignment, cross-ticket pattern detection — and **there is no ticket entity at all.**
**Read first:** `screens/12f-support-desk-and-view-as/12f-support-desk-and-view-as.md`.

**Draw:** what the desk shows when the last session ended by expiry rather than by a person; what
the seller-dashboard strip does at minute thirty, given that the minutes are computed at render and
do not tick; and *Stop looking* **on the strip**, since today a staff member has to go back to the
console to end the session they are in.
**Then, for the desk:** if the answer to N11 is *buy*, the design owed is the integration surface —
how a ticket reference reaches the session, what the account-context panel reads, and where *Raise
a product issue* goes. Draw that, not a helpdesk.
**Two corrections to the current render:** it shows `Tier 3 · visited`, a rung cut twice over —
build it as `Tier 2 · licence verified`. And the business picker is a bare slug field; make it
search-as-you-type, because staff pasting slugs out of storefront URLs is exactly the pattern the
project calls a defect.

### P-39 · A certifications block on the fixed storefront overview

**Route:** `/b/:slug`.
**Why:** this is the one piece worth taking out of the eight cut builder boards, and it is the
owner's own open item from the cut commit — `/dashboard/verification` still promises sellers a
surface for certificates that no longer exists on the storefront.
**Read first:** `screens/5h-section-specimens/` §07, `screens/3e-verification-and-documents/`.

**Draw:** the block, to rules that are already written: **names and expiry month only, never the
document**; *verified* only where ops checked it; and the block collapses entirely where a seller
has none rather than rendering an empty frame.
**The one state the existing specimens do not draw**, and the reason this needs a prompt: a
certificate that has been **reviewed but not verified**, which must read *On file* and must never
read *verified*.
**Note:** a Free plan currently strips certifications from the storefront, which means a free
service supplier's page shows neither a catalogue nor credentials. That is a pricing decision
hiding inside a layout one, and the board should surface it.

### P-40 · A reporter-facing outcome notice

**Route:** an email and an in-app notice; no screen of its own beyond a specimen.
**Why:** board 4h's own argument is that 58% of reports end in a fix, and **nobody tells the person
who reported it.** There are 46 open items and a 2.4-day median, and no notification key for *"we
looked at what you reported"*.
**Read first:** `screens/4h-reports-flags-and-disputes/`, `screens/13c-report-a-listing/`.

**Draw:** the specimen per channel, in the product's voice. It must say what was decided and on
what ground, and it must never carry the moderator's prose, the reporter's identity to the
supplier, or the supplier's contact details to the reporter.
**States:** upheld, something changed · upheld, nothing visible changed · refused · duplicate of a
report already decided · the reporter was anonymous and cannot be told.

---

# Wave D5 · Decide, then draw or delete

Each of these is a drawn promise with nothing behind it. The cheap answer is usually *delete*, and
the prompt says so where it is.

### P-41 · `1b` · The capability facets — decide the backing data, or strike the group

**Why:** three of five drawn rail groups are absent from the build, and two of the drawn facets
have **no field in the data model that could answer them** — *"Delivers UAE-wide"* and *"Has online
catalogue"*. A third, *"Open now"*, depends on the hours resolver and is answerable.
**Recommendation:** strike the two that nothing backs; keep *Open now*; and draw the area rail,
which is the most-used control on the page and is currently a static block with no expanded panel
and no behaviour when an emirate is unticked.

### P-42 · `1c` · Draw an area on the map

**Why:** named on 1c and on its services sibling and drawn **nowhere** — no handle, no in-progress
shape, no way to clear it. The control cannot be built honestly until it is drawn, and today the
link points at the page it is on. Separately, a bounded search silently drops the products and
services the buyer just saw, so the board must either draw a map over a blended result set or state
that bounds means suppliers only.
**Also on this board:** the *"thousands of hits"* narrow prompt — the three highest-signal facets
inline above the results — which the spec names and nothing draws.

### P-43 · `6d` · The guide at production length

**Why:** every drawn block appears exactly once in a 520-word render, against an enforced
**1,200-word** floor. Nobody has designed the rhythm at production length, which is what the
one-pull-quote rule and the three-to-eight heading band have to hold against.
**Also decide:** what happens above eight `h2`s. The board's own position is *"this should have
been two guides"* — is that a warning on the content matrix, or a hard refusal?

### P-44 · `6f` + `6h` · The panels that need a decision, not a drawing

**Why:** three things on these two boards are promises. The **sitemap status** panel is named on
both and drawn on neither, and cannot be true without a Search Console connection. 6f's **two
analytics cards and its `Sessions` column** have no importer, so the screen ships three permanent
em-dashes. And 6h's **per-slot click-through** is an open question.
**Recommendation:** scope the analytics importer or redraw 6f without those cards. Three em-dashes
on a staff screen is the *"every number is a query"* rule failing quietly.
**Also owed:** 6f's *"category not viable in this emirate yet"* footer, named in the states table
with no copy and no drawing; and 6h's *"what buyers searched"* panel, which **shipped without a
drawing** and is the only unreviewed surface on that board.

### P-45 · `6b` · The below-floor curated list

**Why:** the spec says a list below the member floor does not publish, but three live strings imply
somebody intended a reader-facing *"nobody qualifies yet"* page. The intent is ambiguous in the
codebase, and the floor itself is unenforced — the page checks for zero members where the rule is
five.
**Recommendation:** no reader-facing page. Delete the three strings and enforce the five-member
floor.

### P-46 · `Notify me` on an out-of-stock product — draw or delete

**Why:** drawn as a call to action with no screen behind it. No board covers creating, sending or
managing a back-in-stock subscription, and it is **the one call to action in the whole set that
promises the platform will contact a buyer later.** Related: the zero-result page's *"Leave a
number and we will tell you once"* is a promise the product cannot keep, because the event behind
it is declared with no parameters and therefore never emits.
**Recommendation:** delete both until buyer-side delivery exists — which means after P-04 and the
notification engine work. Then draw them together.

### P-47 · What a lapsed plan serves on a seller's own subdomain

**Why:** board 5f's open question 3, and 5e's dependency on cancellation and dunning. Not drawn,
not built, and **it will happen on the first Pro cancellation.** 5f's own recommendation is a 301
to the platform URL on the drop date.
**Recommendation:** ratify the 301 and draw the one notice the seller gets before it happens. This
is a prompt for a decision and two sentences, not a screen.

### P-48 · `3g` · Variants — decide the model before any screen

**Why:** the render draws a variants panel and a push-to-shared-spec offer. The schema has exactly
one flag, `SpecField.variesByVariant`, and **nothing consumes it.** Until the data model is decided
— a variant set? a parent product? a naming convention? — the render's panel and board 3h's
`varies` column are both promises.
**Recommendation:** cut both from the boards for launch and re-open with a model. A spec table that
cannot say which value belongs to which variant is worse than one that does not claim to.
**Also on this board, separately:** quote attachments. The render's *+ Attach datasheets (3)* chips
need a drawn picker scoped to publishable documents — the media library already names what may not
go — and a read-only view on a sent quote. And *Load from a previous quote*, drawn on 3j, unbuilt,
and undrawn as a flow: which quote, which lines, and what happens to a line whose product is now
out of stock or whose SKU has moved template.

---

---

# Wave D6 · Services — the lane that is built and undrawn

Twenty-six of the twenty-eight services boards are in production. So almost nothing here is a
screen that does not exist; it is a ruling the package needs, a state nobody drew, or a surface
that forks on kind and was only ever drawn one way. Two prompts here (**P-51**, **P-54**) are the
highest-value in the wave and both are small.

### P-49 · `8e-s` · Setup complete, for a practice and for a firm that does both

**Route:** `/dashboard/setup/done`.
**Why:** there is **no `8e-s` on either canvas.** The terminal state of the entire services setup
funnel has never been designed, and the shipped screen draws four progress pips over three goods
ticks — so a practice that has just finished setup reads *"0 products indexed on their own pages"*.
**Read first:** `handoff-complete/screens/8e-setup-complete/`,
`handoff-services/screens/8a-s-setup-hub/`.

**Draw:** four tick lines for a practice — credentials, services, team, photographs — and five for
a firm that does both. A replacement for the goods closing line, about scope pages and briefs
rather than SKUs and specs. And the destination, which is the dashboard's first-day state (**P-23**).
**One blocker to draw, not to inherit:** **a Free seller cannot reach this screen.** Setup asks for
two team members against a one-seat plan, the invite is refused at the cap, and the open count
never reaches zero — and it is worse for a practice, whose ceiling is 72 rather than 90. So the hub
needs a drawn *not available on your plan* state for the team card, or the card is dropped on Free
and `team` is named as a lever the way the licence is. The pattern exists for enquiries and
photographs and not for seats.

### P-50 · The `both` seller, drawn once

**Why:** a firm that supplies equipment and services it is **ordinary in this market** — the audit
board says so in as many words — and it is drawn nowhere. Three surfaces currently compose it by
addition and each gets it slightly wrong.
**Read first:** `handoff-services/screens/2d-s-coverage-not-branches/` (B7, AC8),
`handoff-services/screens/1d-s-storefront-overview/`, `handoff-complete/screens/1d-storefront/`.

**Draw three things:**
1. **The `both` body of `/onboarding/locations`** — the branch list *and* the coverage set,
   grouped, labelled, neither behind a toggle, with a decision about which group leads. This is
   P-20's surviving half.
2. **The `both` storefront overview.** A firm selling valves from a depot and annual maintenance
   across four emirates has one page and two shapes of truth, and the overview currently tells only
   the depot half — it makes no coverage statement at all.
3. **The `both` setup hub and completion** — five tasks, five ticks, and what *roughly twice the
   setup* looks like when it is real rather than a warning on the kind screen.
**States:** both kinds with content · both declared, only goods filled · both declared, only
services filled · a `both` firm whose coverage and branches disagree (coverage claims an emirate no
branch serves).

### P-51 · `1n-s` · The comparison when nothing can be footed

**Route:** `/enquiry/:id/compare`.
**Blocked on N16 and N17.**
**Read first:** `handoff-services/screens/1n-s-compare-proposals/`, then
`handoff-complete/screens/1n-buyer-account/`.
**Why this is the most consequential services prompt:** the page's whole instrument is a
normalisation row — *Over 12 months* — and the code can compute it for exactly **four** fee bases
(`per_month`, `per_visit`, `per_sqft_yr`, `fixed_fee`). The taxonomy authors **nineteen**. Three of
the four bases the services package names as the headline problem — day rate, retainer, percentage
— are all in the fifteen that return *cannot be computed*, and the two that work live only on the
two maintenance-shaped families. **So for an audit, VAT or legal brief — the trades the track was
drawn against — the headline row renders all-cannot.** `1n-s`'s own states table covers *all on the
same basis* (suppress the row) and *one column cannot be computed*, and not *none can*.

**Draw:** the professional-services case. A `retainer` column beside a `per_return` column beside a
`day_rate` column, none normalisable, on a page whose reader still has to choose. Recommended shape
per N17: a stated basis-by-basis table with **no normalisation row at all** and no apology — the
bases printed as what they are, with the scope and exclusions doing the comparing. Then the mixed
case: two columns footable and two not, where a partial normalisation row is more misleading than
none.
**States:** every column on the same basis · one column un-footable · **none footable** · two of
four footable · a column whose basis is footable but whose volume input is missing (needs visits,
needs area) · a proposal withdrawn mid-comparison · a proposal expiring mid-comparison.
**Hard rules:** **no total, ever, across bases.** Nothing on this page may add two fee bases
together. And no price reaches any surface outside this page and the thread.

### P-52 · `3e-s` · The services shape of verification, and where a certificate renders

**Route:** `/dashboard/verification`, plus a block on `/b/:slug`.
**Read first:** `handoff-complete/screens/3e-verification-and-documents/`,
`handoff-services/screens/8b-s-setup-task-1/`. **Send together with P-39**, which is the goods half
of the same question.
**Why:** `3e-s` was classified a new variant and a Tier-2 board in the 4 Sep inventory and **was
never drawn**. Its function shipped anyway, inside board 3e — `/dashboard/verification` is the
credentials surface, with lapsed, days-left and valid-until states. So this is an undrawn board
rather than an unbuilt one, and the undrawn part matters because the screen currently tells sellers
that certificates *"can be shown on your storefront"* and, since the builder cut on 15 Sep, they
render on **no** public surface.

**Draw:** the services shape of the screen — two tables, *checked by us* and *uploaded by you*,
with a credential's register state where a goods seller sees a document's review state. Then the
public block, which is P-39's subject: names and expiry month only, never the document, *verified*
only where a register answered, and the block collapses where a firm has none.
**The state neither canvas draws:** a credential **reviewed but not verified** — it must read *On
file* and must never read *verified*.
**States:** nothing uploaded (the cold start, which at 40 listings is the common case) · one
credential under review · one verified against a register · one the register cannot answer for ·
one lapsed · a firm whose only credential is its trade licence, which is **not** a credential row.
**One ruling this prompt needs:** does board 3e serve both kinds, or does `3e-s` become a real
board? Either answer is fine; the current state — a goods board serving a practice, with no record
that it does — is not.

### P-53 · `2b-s` + `2c-s` · The disagreement question, and what switching kind costs

**Route:** `/onboarding/kind` and `/onboarding/profile`.
**Blocked on N21 and N22.**
**Read first:** `handoff-services/screens/2b-s-claim-result/`,
`handoff-services/screens/2c-s-profile-basics/`.
**Why:** `2b-s` is a good board with two live copy defects and one unkept promise. It tells a
seller that switching kind *"rewrites your catalogue — a product with a stock level has no scope,
and a service has no SKU, so nothing carries across"*, while the settings copy says *"Nothing you
have entered is converted or deleted."* Those cannot both be true, and the second is what the code
does. And the board promises *"If you say products and then choose Audit & assurance, we will ask
again rather than quietly override you"* — **nothing re-asks.** No reader of the declared kind
exists in the category path or the moderation path.

**Draw:** one state on `/onboarding/profile` — what a seller sees when their declared kind and
their chosen trades disagree. `2b-s` B4 assigns the question there, `2c-s` has no state for it, and
`3b-s` draws a *statement* rather than a question, so three boards point at each other and none
carries it.
**Rewrite:** the cost card, to say what actually happens — the other kind's fields sit empty for
you to fill, nothing is destroyed.
**States:** declared goods, picked a services trade · declared services, picked a goods trade ·
declared both, picked only one kind · changed the answer after publishing · changed it after
receiving an enquiry.

### P-54 · The services retraction pass — availability, and the visited tier

**Not a new board. A revision pass over four existing renders, and the cheapest prompt in the book.**
**Read first:** `handoff-services/screens/8c-s-task-2/`, `1d-s-storefront-overview/`,
`1e-s-services-list/`, `1c-s-search-results/`.
**Why:** the services package is dated 8 Nov and four of its renders draw features that were
killed in September. **Decision D11 — a services availability enum — was closed as *no* on 11 Sep**,
and `8c-s` draws an availability column, `1d-s` carries *Accepting new clients*, `1e-s` carries
*Join the waitlist* and *at capacity*, and the facet rail carries the enum. Separately, `1c-s`
carries **`✓ OFFICE VISITED`**, a verification tier cut on 5 Sep — twice over, since the whole
physical-visit feature set went with it. An agent obeying the package's own rule that *"the render
is the latest truth"* would reintroduce every one of them.

**Do:** remove the availability column, every availability string and the facet from all four
renders, and remove the visited tier from `1c-s`. Then state in each board's note that the field
does not exist, so the next reader does not restore it.
**What replaces it:** nothing. That is the decision. A service firm's availability is not a
publishable fact — the conversion event is the enquiry, and a firm that is busy answers slowly,
which the measured reply time already says.

### P-55 · `3b-s` · Practice size — two fields, and the band set

**Route:** `/dashboard/listing`.
**Blocked on N20.**
**Read first:** `handoff-services/screens/3b-s-listing-profile/`.
**Why:** the board draws `14 — of whom 9 are qualified` as one field. The code renders a band
`<select>` plus a separate qualified-count number checked against the band's ceiling, and the only
place that control exists is in the code. Separately, every services render draws `11–25 people`
and the live enum produces `11–50`, with the board's own spec proposing a third set — so the
renders now ask for a number this product cannot show.

**Draw:** the two-field control as it is, including the refusal when the qualified count exceeds
the band ceiling, and correct the band labels to the five that exist. Per N20 the five bands are
the answer and the renders are what changes; a migration over 123 live rows for a finer set has no
stated gain.
**States:** no size given · a band chosen with no qualified count · both given and consistent ·
qualified count above the ceiling (the refusal) · a sole practitioner.

### P-56 · `6a-s` · The rollout policy for 1,267 landing pages

**Route:** `/[emirate]/[area]/[category]` and the trade-opening control on `/admin/content/matrix`.
**Blocked on N18.**
**Read first:** `handoff-services/screens/6a-s-area-landing-page/`,
`handoff-complete/screens/6f-admin/`.
**Why:** the services build plan says `6a-s` *"roughly doubles the 6f page matrix"*. It does not —
it takes the addressable set from about 84 URLs to about **1,267**, roughly fourteen times. **Zero
are live today**: every services category's rollout column is null, and that nullable column is the
only brake. There is no rule for how many trades open at once, on what evidence, or how to roll
back. This is an ops-process design, not a screen — but it needs a surface, because the thing
being decided is which 1,267 pages exist.

**Draw:** the trade-opening control on the page matrix — one row per services trade with its
listing count, its verified share, whether an intro has been written, and whether it is open. The
open action with its confirmation, naming how many URLs it creates. The close action and what
happens to the pages (they must 404 or 301, not linger). And the per-row state when a trade is
open but below the publish floor.
**States:** closed · open and above the floor · open and below it · open with no intro written ·
closing, with the URL count it removes.
**Note for the handoff:** the publish floor is 60 listings, 30% verified **and** 250 words of
unique intro plus four FAQ rows. The services member definition is marginally stricter than the
goods one. So the real constraint on this page class is editorial capacity, not data — and the
board should say so.

### P-57 · `12c-s` · The area weight, and the night a whole kind changes vector

**Route:** `/admin/search`.
**Blocked on N19.**
**Read first:** `handoff-services/screens/12c-s-ranking-for-services/`.
**Why two things:** first, **the area weight does not exist.** Three readers filter on area and
none weighs it, so a seller who did the work of naming Business Bay ranks level with one who
ticked *anywhere in Dubai* — which teaches sellers to over-claim coverage, and over-claimed
coverage is the one thing that makes a services directory useless. The decision needs a number for
the brief matcher and a number for the locality term, and this board is where a staff user would
expect to set them. No board covers it.

Second, **the services vector has never been published** — no row is seeded and nobody has pressed
publish — and in the meantime a services firm is ranked on the goods vector, where its null spec
completeness scores as *half*: six of twelve points, stuck, for a field that cannot apply to it.
Nothing draws the before-and-after an ops lead sees the first time a whole kind of listing changes
vector, and nothing warns that the night the slots start measuring scope, the per-seller
attribution would report *"your scope completeness rose"* to a seller who did nothing.

**Draw:** the area-weight control, with the two numbers named and the explainer that says what
over-claiming costs. The publish moment for a kind: the preview, the impact table, the *up to N
sellers told* count, and the attribution warning.
**States:** no services row yet (today's state, which must say so rather than showing goods
weights) · a draft · published · a draft that would move more than N sellers · the first publish,
which is the one that needs the warning.

### P-58 · `1f-s` + `3g-s` · A service delivered remotely **and** on site

**Route:** `/b/:slug/coverage`, `/dashboard/services/:id`.
**Blocked on N24** — recommendation is *yes, after launch*.
**Read first:** `handoff-services/screens/1f-s-coverage-and-availability-public/`,
`handoff-services/screens/3g-s-service-editor/`.
**Why:** *delivered where* is one value. A service delivered remotely and on site is ordinary in
facilities management and freight, and the product cannot state it. The public coverage page's
*How* column renders one value, so a firm that does both has to pick a lie.
**Draw:** the multi-value control in the editor, and the multi-value render on the public page and
in the facet rail. Say what the facet does when a buyer filters on *remote* and a service is both.

### P-59 · `10c-s` · What the map says about work sold by the job

**Route:** `/search` with a drawn area.
**Read first:** `handoff-services/screens/10c-s-search/`,
`handoff-complete/screens/1c-search-results-map/`.
**Why:** a bounded search and a wordless search both route to the goods path, which **drops every
service row, draws no services tab, and says nothing about it**. Both are deliberate decisions with
good reasons written down — a map box is a browse, and a firm with one office covering seven
emirates cannot be represented by a pin. The buyer is simply never told.
**Draw, minimum:** one line on the map composition saying that work sold by the job is not in this
view, with a link to the same query unbounded. **Draw, properly:** decide whether coverage can be
drawn on a map at all — an area-polygon union rather than a pin — which is a real design problem
and probably depends on `/admin/areas` existing first (**P-33**).
**States:** bounded with services matches outside the view · bounded with none · wordless browse ·
the unbounded link's destination.

### P-60 · `1g-s` · The comparison instrument, or delete the two strings

**Route:** `/b/:slug/s/:service`.
**Why:** `1g-s` B9 promises a comparison instrument for a service — *"how does this engagement
compare"* — and it is unbuilt because its scope had no data. The data now exists: families are
assigned across the services leaves. Meanwhile two strings sit in the catalogue describing a
surface that does not exist.
**Decide, then draw or delete:** what *comparable* means for an engagement. A strip, a side-by-side,
or nothing. Recommendation: nothing for launch, and delete the two strings — a scope table that a
buyer reads against its own exclusions list is already the comparison, and a cross-firm instrument
on a page with no price is thin.

### P-61 · `4c-s` · The name near-match — the one state a human decides

**Route:** `/admin/queue/credential/:id`.
**Read first:** `handoff-services/screens/4c-s-review-a-credential/`.
**Why:** the spec names this *"the judgement case — and the one the queue really exists for"* and
then explicitly declines to draw it. The build settles everything else at submission, so the
near-match **is** the realistic contents of this queue: the register answers, the name is close but
not identical, and a person has to decide. The screen renders a verdict per field; what is not
designed is the text diff against the register's value that the spec asks for.
**Draw:** the diff, and the two decisions either side of it. Note that the register is dormant in
every current deployment, so draw the *no register configured* state too — it is what staff see
today.
**States:** exact match (settled, no queue) · near match (the judgement) · no match · register
unreachable · register not configured · a credential whose identifier is malformed.

### P-62 · `12g-s` · The drift column — the affordable remainder of `6g-s`

**Route:** `/admin/strings/paired`.
**Blocked on N25.**
**Read first:** `handoff-services/screens/12g-s-paired-strings/`.
**Why:** the services package calls `6g-s` — a copy-drift audit board — *"the most urgent gap in the
track"*. It was **cut on 14 Sep, unbuilt**, and the `12g-s` spec written a day later records the cut
and converts it into an open question. The package contradicts itself. And drift is already partly
detectable: a missing half is counted, and a bad placeholder or a banned pivot word is refused at
save. What is not detectable is a half that is *wrong* — and the vocabulary scan reads one source
file, so every string held in the registry is invisible to CI.
**Draw, not a board but a column:** mechanically checkable disagreement between two written halves
— a different placeholder set, an order-of-magnitude length gap, one half interrogative and the
other not. Plus the *unwritten half* state, which exists, and an owner for it.
**Say in the note:** the registry holds twelve pairs while the goods `12g` board assumes 27 of 34
templates need a services twin. So the registry is materially short of what the boards expect, and
the count on this screen is the only thing that will say so.

### P-63 · `3g-s` · What the completeness number actually does

**Route:** `/dashboard/services/:id`.
**Why:** the editor shows a completeness meter and says nothing about what it is for. It has **two
real consequences**: it is a live search-ranking input, and it is the counting bar for setup task 2.
A number with two consequences and no stated one is the opposite of this product's rule that a
measurement is stated rather than implied.
**Draw:** one consequence line, and decide how much to claim — *measured, never promised* applies
here too. Recommendation: name the setup consequence plainly and the ranking one as a direction,
not a promise.

### P-64 · `7c-s` · The seller's won proposal, and a review a practice can answer

**Route:** a seller surface near `/dashboard/quotes`, plus `/review/new`.
**Blocked on N23** for the review half.
**Read first:** `handoff-services/screens/7c-s-accepted-proposal/`,
`handoff-complete/screens/10f-write-a-review/`.
**Why two things:** the winning supplier has **no screen for the thing they won.** The buyer gets
an accepted-proposal record; the seller sees a sent proposal on the leads screen and nothing with
the buyer's contact released and the term running. And at the terminal state of the whole services
chain, **the review form asks a goods question** — *"It arrived when they said"* — of a firm that
delivered an audit.
**Draw:** the seller's mirror, as a state on the quotes pipeline rather than a new route, per the
build's own recommendation. And a neutral dimension set for a service review, or per-family
dimensions authored on `4e-s`. Recommendation: one neutral set, because per-family dimensions make
averages incomparable across a shelf.

### P-65 · Services narrow layouts

**Why:** **not one of the twenty-eight services boards has a narrow layout**, and the two open
routes on the Flow Tracker are *mobile buyer web* and *a seller reply app*. Reply speed decides
ranking.
**Read first:** every board in `handoff-services/screens/`, then **P-17** and **P-18**, whose
decisions this inherits.
**Draw at 375px, in this order:** `3j-s`'s proposal reply — a practice partner answering a brief
from a phone is the single highest-value narrow screen in the product · `1n-s`'s basis-by-basis
table, which is harder than the goods comparison because the columns are not commensurable ·
`1g-s`'s scope table · `8c-s`'s scope-sheet step · `1f-s`'s coverage set · `3c-s`'s per-service
coverage manager · `1e-s`'s services rows, which should be easier than the goods grid and should be
checked rather than assumed.

### P-66 · Gallery stories for the three screens that write the record

**Why:** `3g-s`, `3f-s` and `3c-s` have **twenty-one documented states between them and no rendered
reference**, and they are the three screens the other four services boards read from. The project's
own done-checklist makes a gallery story item 1. Also owed: `8e-s`'s states from **P-49**, and the
`both` states from **P-50**.
**Not a drawing job so much as a cataloguing one:** list every state each of the three screens
documents, mark which have a story, and draw the ones that do not — concentrating on empty, draft,
cap-reached and cold-start, which are the four a seeded database will not show you.

---

## Sending order, and why

| Wave | Prompts | Send when | What it unblocks |
|---|---|---|---|
| **D1** | P-01 … P-12 | now, in this order | eight tested backends and the money path |
| **D2** | P-13 … P-18 | alongside D1 | every board in both packages; no board ships its documented states without these |
| **D6a** | **P-54**, **P-51**, **P-53** | **now, with D1** | P-54 is a retraction pass and stops four renders reintroducing cut features; P-51 is the services track's one blocking screen defect; P-53 closes two contradictory live strings |
| **D3** | P-20 … P-32 (P-19 withdrawn) | after N3, N4, N5, N7 | the journeys a real user cannot complete |
| **D6b** | P-49, P-50, P-52, P-55 | after N20, N21, N22 | the services funnel's terminal state, the `both` seller, and verification |
| **D4** | P-33 … P-40 | after D1 lands | the console, and the 40,000-row import |
| **D6c** | P-56, P-57, P-61, P-62 | after N18, N19, N25 | the services console and 1,267 landing pages |
| **D5** | P-41 … P-48 | last | drawn promises with nothing behind them |
| **D6d** | P-58 … P-60, P-63 … P-66 | last | the services polish, and the narrow layouts |

**P-01 is still the single highest-value prompt in the book:** it is the smallest, and three boards
and one complete tested engine are waiting behind it.

**P-54 is the cheapest:** it is a retraction pass over four renders, it takes a designer an hour,
and without it an engineer building those boards faithfully will reintroduce a decision closed on
11 September and a verification tier cut on 5 September.
