# Design exports — five boards written against the tree

**Read against `11f904f2`, 1 Oct 2026.** `docs/build-plan.md` §4 marked five boards export-only or
scaffold: `10a`, `12f`, `7f`, `10i` and `13i`. The code for each is written, and reading it
closely found what each still owes. This file is what a designer needs to draw
them without opening the repo: the route, what renders from top to bottom, every state, the
strings as they stand, and where the tree answered something the canvas asked for differently.

Counts marked *seed* were read from a seeded local database with 154 of main's 157 migrations
applied; where one of the three newer migrations moves a count, it was read from its file and
added. They show what the queries return; they are not production numbers.

Each entry ends with what the code still owes. None of it is in this change, which is docs only.

---

## `10a` · Subcategory page

**Route.** `/c/:category/:sub` — `app/(public)/c/[category]/[sub]/page.tsx`. Public, revalidated
every 5 minutes. 427 subcategories on the seed; the handoff said ~418.

**Who reaches it.** A buyer from search, from a sector page's subcategory chips, from the related
trades row on a sibling, or cold from Google.

**What renders, top to bottom.**

1. Directory nav and breadcrumb: *Directory › {sector} › {subcategory}*.
2. Header. `h1` *"{subcategory} suppliers in the UAE"* — always "in the UAE", even with an
   emirate filter applied; the sector page (`/c/:category`) changes its heading to name the
   emirate or area, this page does not. Under it a mono eyebrow *"{verified} of {listings}
   verified"*, omitted at zero listings. Then the authored intro paragraph, omitted when empty —
   the one piece of per-page authoring.
3. Results — the same component as `/search` and the sector page. Filter rail on the left
   (spec fields from the **parent trade's** template first, then tier, emirate, free zone,
   availability, reply time, years trading), tabs *Suppliers (n)* and *Products (n)*, a toolbar
   with sort chips only above 20 suppliers and a sponsored explainer only when a sponsored card
   is in the list, applied chips, the list, pager.
4. *By emirate* — one chip per emirate, *"Dubai (34)"*, linking to the filtered list. Hint: *"A
   supplier with premises in two emirates is counted in both."*
5. *Filter by specification* — one chip row per filterable spec field, *"DN100 (12)"*. Hint:
   *"From the specification template for this trade. Adding a field adds a chip."*
6. *Questions buyers ask* — open `dl`, not disclosures. Up to five items, each written only when
   its number exists: how many, where (top three emirates named), reply time (only with five or
   more measurable suppliers, sample size in the sentence), stock vs made to order, and *"Why are
   there no prices?"*. `FAQPage` JSON-LD carries exactly the rendered items.
7. *Other trades in {sector}* — sibling subcategories as chips with counts.

**States to draw.**

- Populated, above 20 suppliers: sort chips show.
- Thin, 20 or fewer: no sort chips.
- With and without a sponsored card in the list: the explainer follows the card.
- Below the 6f publish floor: renders in full, `noindex, follow`, left out of the sitemap. No
  visual difference — draw it as a note, not a variant.
- Filtered (any facet set): `noindex`, canonical to the area page where one is live, else to
  this page.
- Zero results under a filter: *"Nothing matches all of that"*, a *"Drop the {facet} filter"*
  suggestion with the count it would return (or *"Removing any single filter still returns
  nothing…"*), *"Ask the whole trade instead"* with *Post a requirement* carrying the category,
  *"Browse {subcategory}"*, and *"Tell me when somebody lists it"* when there are search words.
- No intro, no spec template, no siblings, no measurable reply time: each block is dropped, not
  emptied.
- A moved or merged slug: 301 from 4d's redirect table. Unknown, or a subcategory under the
  wrong sector: 404.

**The ledger line, checked.** *"Two definitions of 'suppliers in this trade' render on one
page."* — **true, and it is three.** The tabs, the meta description and the sibling chips count a
supplier listed in this trade as its primary **or** an additional category
(`businessWhere` in `lib/db/queries/search.ts`). The header eyebrow, the emirate chips, the FAQ
and the 6f publish floor count primary only (`landingFacts` in `lib/seo/facts.ts`,
`lib/seo/taxonomy.ts`). Products split the same way: the Products tab counts products filed
under this subcategory; the FAQ's *"Of {n} listed products"* counts every product of a supplier
whose primary trade this is. So *"Sharjah (34)"* opens a list that can say 41.

The seed cannot show it — on all 427 subcategories the two supplier counts agree, because no
seeded business carries an additional category. Production can: a seller adds one at onboarding
(`lib/onboarding/categories.ts`) and a moderator approves another (`additional_category` in
`lib/moderation/service.ts`).

**Where the tree answered the canvas differently.**

- Handoff 5 asked for *"suppliers grouped by emirate"*. The tree gives a ranked list and a row of
  emirate counts that filter it. Grouping 20-row pages by emirate breaks ranking and the pager;
  the chips are the answer, and the design should draw chips.
- Handoff 5's FAQ example quotes a price range from platform quotes. The tree never does: a
  quoted price is private to one buyer and one seller, and the only price item is *"Why are there
  no prices?"*. Draw no price range.
- Spec chips come from the parent trade's template, because a subcategory rarely has one of its
  own. Counts stay the subcategory's.

**Owed in code.**

1. One predicate for "suppliers in this trade". The list is what the buyer checks, so every
   number above and beside it should be the list's — `landingFacts` takes `businessWhere`'s
   category clause. Whether the 6f floor should count borrowed listings is the owner's call.
2. The zero state's *"Browse {subcategory}"* links to `/c/{subcategory-slug}`, which 404s:
   `/c/:category` refuses any category with a parent. It should go to `/c/{sector}/{sub}` with
   the filters cleared. `/lp/:campaign` builds the same link and has the same exposure, see `10i`.

**New ledger line.** *Exported. Three counts read primary trade only, three read primary or
additional; one predicate is owed, and the zero state's Browse link 404s.*

---

## `12f` · Support desk & view-as

**Route.** `/admin/support` — `app/(admin)/admin/support/page.tsx`, service
`lib/support/view-as.ts`. Staff only, capability `support.view_as` (moderator and ops lead). Nav
item *Support desk* in the console's *Platform* group. 404 for any other seat.

**What renders.** Admin page, eyebrow *Platform*, title *Support desk*, meta *"{count} sessions in
the last while"*. Two panels, side by side from `lg`.

*Start looking* (no live session):

- *Ticket* — required, first, hint *"It goes on the audit row. Looking through a seller's eyes
  without a reason is a privacy event."* Three characters minimum.
- *Business slug* — required, free text. No search; staff paste the slug from the storefront URL.
- *Reason* — required, four characters minimum.
- *Start looking* — disabled until all three hold.
- Success, polite: *"Started. The dashboard now shows their account, read-only, for 30
  minutes."* Failure, assertive: *"No listing has that address. Check the slug from the
  storefront URL."* or *"You are already viewing another account. End that session first…"*.

*Start looking* (live session): a warning alert *"You are looking at {business} for {ticket}.
{minutes} minutes left."* and *Stop looking*.

Under both: *"A session is read-only, capped at 30 minutes and written to the audit log with the
ticket. Read-only is enforced where the seller's own mutations are, not by hiding buttons."*

*Recent sessions* — the 20 most recent across all staff: *"{staff name} · {business
displayName}"* with *"{ticket} · {date}"* in mono. Empty: *"Nobody has looked at an account
yet."* No live, ended or expired marker and no duration.

**The other half: the seller dashboard under view-as.** Every `/dashboard` page renders the
seller's screens for that business, with a warning strip above the header on every page: *"You
are looking at {business} for ticket {ticket}. Read-only, and it ends in {minutes} minutes."* The
minutes are computed at render and do not tick. The identity block and plan name are left out;
close-account is hidden and refused. The strip has no *Stop looking* and no link back to the
desk. `/admin/businesses/:id` lists each session on that business: *"{who} viewed as this
supplier · ticket {ticket}"*.

**The ledger line, checked.** *"View-as is the best-guarded thing in the console."* — **the
guarding is sound; the session's end is not.** Read-only is real: the actor stays the staff
member, every seller write asks a seller capability staff do not hold, and
`tests/integration/accounts-crm.test.ts` proves four writes refused and the listing unchanged.
The ticket is required, the start is one audited `staffMutation` with the ticket in front of the
reason, and expiry is checked on every read rather than by a sweep.

But expiry is only checked on read — nothing writes `endedAt` when 30 minutes pass. The
migration's `view_as_session_one_live_per_staff` unique index is on `staff_id WHERE ended_at IS
NULL`, so a session left to expire still counts as live to the index while the page shows the
start form. The next *Start looking* fails the insert on that index; the action catches only
permission and reason errors, so the unique violation reaches the error page.
*Stop looking*, the one control that would clear it, only renders while a session is live. The
only other writer of `endedAt` is staff deactivation. No test starts a second session after a
natural expiry; the expiry test ends its session by hand before the next one.

**Where the tree answered the canvas differently.**

- *Support desk* in the board's name implies tickets. There is no ticket entity: `ticketRef` is
  free text, and nothing lists, assigns or closes a ticket. 4c's handoff asked to link `12f`
  tickets and could not. Draw the ticket as a reference field, not a queue, until a ticket board
  exists.
- The board's business picker is a slug field. A search-as-you-type picker is a small build;
  draw it if wanted, and say so.

**Owed in code.**

1. The expiry lockout above. Close this staff member's expired session inside the start
   transaction (`endedAt = expiresAt`), and add the test that starts after a natural expiry.
2. The meta *"{count} sessions in the last while"* counts the 20 rows the panel fetched — a page
   cap wearing a total, the 1.3 pattern. It should be a count with a stated window.
3. The *Reason* field reuses `admin.review.reason_hint`: *"The seller reads this."* The seller
   never sees a view-as reason; it goes to the audit log. It needs its own hint.
4. `startViewAs` returns English sentences that reach the screen without `t()` — the
   needs-a-ticket and already-viewing messages.
5. The dashboard strip should carry *Stop looking*. Today a staff member has to go back to the
   console to end the session they are in.

**New ledger line.** *Exported. Read-only, the ticket and the audit row hold; a session left to
expire never ends, and the next start for that person fails on the one-live-session index.*

---

## `7f` · Notification specimens

**Route.** `/dev/notifications` — `app/dev/notifications/page.tsx`. A developer surface behind
`lib/dev/guard.ts`: it renders only against a loopback database, never on `VERCEL_ENV=production`,
and 404s otherwise. Nobody outside the team sees it.

**What renders.** A mono eyebrow *board 7f*, `h1` *Notification templates*, and a lede: *"Every
template in the database, rendered with plausible values. Each one states what happened, what it
is worth, and one action. None carries a buyer's phone number, email address or company name —
asserted in tests/integration/notifications.test.ts, not left to a reading."*

Then one section per event, headed by the raw event name in mono (`quote_accepted`), in enum
order. Under each, one card per template row — every channel, every version, every status:

- *"{channel} · v{version}"*, a status chip (*live* ok, *pending_meta* warn, *draft* and
  *retired* neutral), and Meta's template name for WhatsApp.
- The subject, when there is one; the body; the action label and path, or *"No action"*.
- A render failure prints the error in a bad-tone box in place of the body.

*Seed*: 63 template rows over 30 of the 31 events. 28 in-app, 26 email, 7
WhatsApp (all `pending_meta`), 2 SMS (`enquiry_received` and `quote_accepted`). The 31st event,
`product_alert_matched`, has no template and no emitter — deliberately, see below.

**The ledger line, checked.** *"All four channels render; SMS has no carrier and records a skip
with a reason."* — **true and not the fact that decides the work.** SMS has no sender in
production (`lib/notify/senders/index.ts`) and the service writes `no_carrier_configured`. What
decides the work is that the page invents its own sample values: a 22-key `PLAUSIBLE` map, while
`sampleParams` in `lib/notify/params.ts` is the typed per-event set the `12g` editor previews
with. 25 of the 41 placeholders in the seeded templates have no key in the map and print as
literal `{approver}`, `{planName}`, `{quotes}`. A page whose job is to show how a message arrives
shows half of them broken.

**Where the tree answered the canvas differently.**

- The page's own docblock says *"shown as it will arrive on each channel"*. It does not: an SMS,
  an email and an in-app row draw the same card. No inbox chrome, no SMS segment count, no
  WhatsApp bubble. `12g`'s editor at `/admin/notifications` already previews the body with
  `sampleParams` and counts SMS segments — the production surface for this job exists.
- Goods, services and neutral twins of one event render as identical-looking cards. `kind` and
  `locale` are not shown.
- Every version renders, retired included. A specimen sheet would show the live row per line.

**Decision for the owner.** Either `7f` stays a dev page — then it reads `sampleParams`, labels
`kind`, and shows live rows only — or the specimens move into `12g` as a per-channel preview and
`/dev/notifications` is retired. The second avoids a second set of sample values drifting from
the first.

**Related, and already documented.** `product_alert_matched` has no params declared, so
`isEmitted()` is false and nothing sends it (`docs/roadmap-handoff-5.md`, criterion 8): the sweep
matches an alert and marks it notified, and the buyer is never told. The public form on every
zero-result page still says *"Leave a number and we will tell you once"*. That sentence is a
statement the product cannot keep until buyer-side delivery exists.

**New ledger line.** *Exported. A dev page, closed in production; 25 of 41 placeholders print raw
because it keeps its own sample values rather than `sampleParams`. SMS still has no carrier.*

---

## `10i` · Campaign landing

**Route.** `/lp/:campaign` — `app/(public)/lp/[campaign]/page.tsx`. Public, revalidated hourly.
404 unless the `Campaign` row exists and `publishedAt` is set. Indexable, canonical to itself, not
in the sitemap. One campaign on the seed: `find-a-supplier`.

**What renders.** No `PublicShell`: no nav, no search field, no footer.

1. Header: the wordmark *Business Listings* as a link home, labelled *"Go to the directory"*.
   That is the whole chrome.
2. `h1` — `headline`. Under it `standfirst`, two or three sentences, when set.
3. Actions: a primary button *"Find {category} suppliers"* to `/c/{category}` when the campaign
   names a trade, else *"Search the directory"* to `/search`; and a text link *"Describe what
   you need instead"* to `/rfq/new`.
4. A caption: *"{listings} listed businesses · {verified} with a trade licence we have checked ·
   no price until a supplier quotes you directly"* — both counts live.
5. `body` as prose, a paragraph per blank line, when set.
6. The way out, near the bottom in a card: *"Not what you came for? {listings} licensed UAE
   businesses are in the directory, and the search is free and needs no account."* and *"Go to
   the directory"*.

**Attribution.** Not on this page. `proxy.ts` reads UTM values off any tagged request and keeps
them in a first-party cookie for 30 days, first touch wins; the enquiry carries them.
`/admin/content/attribution` reports *"{attributed} of {total} enquiries carry a source"* by
campaign, source and medium, with no buyer named. Capability `taxonomy.write`.

**The ledger line, checked.** *"The model exists so content avoids a deploy; a second campaign
costs one."* — **true.** The only writer of `Campaign` is `prisma/seed-campaign-legal.mts`, and a
seed does not run against production. There is no admin screen. A second campaign today is a
seed edit and a deploy, or a hand-written SQL insert that shows within the hour.

**Where the tree answered the canvas differently.**

- Handoff 5: *"no site nav beyond the wordmark and one escape link, but always offers the
  directory as an alternative"*. The tree has the wordmark and **two** ways to the directory —
  the wordmark itself and the bottom card — plus the trade and RFQ actions. Draw both; the
  wordmark is a link because a visitor who wants out should not need the back button.
- The RFQ link reads *"Describe what you need instead"*. The house verb for a link that opens an
  empty composer is *"Request a quote"* (`CLAUDE.md`, vocabulary). A copy question for the
  board, not a defect yet.

**Owed in code.** A campaign editor in the console — headline, standfirst, body, meta title and
description, the trade the button names, publish — so the model does what it was built for. And
the CTA picks any category: a subcategory there would build `/c/{sub}`, which 404s, the same
link defect as `10a`'s zero state. The seeded campaign names a sector, so nothing is broken
today.

**New ledger line.** *Exported. The model exists so content avoids a deploy; nothing writes it
but the seed, so a second campaign still costs one.*

---

## `13i` · Verification & review policy

**Routes.** `/verification-policy` and `/review-policy` — one renderer,
`app/(public)/(legal)/_Policy.tsx`. Public, revalidated hourly. The wording is a `LegalPage` row
per policy; no admin screen writes either row. The footer links the first as *How we verify*.

**What renders.** Public shell, breadcrumb, `h1` the row's title, a mono eyebrow *"In effect
since {date}"* and, when the row has changed since, *" · Last changed {date}"*. The body as
prose. Then *The other policies*, linking the three siblings. A missing row renders *"This policy
has not been written yet."* and *"That is a gap rather than a position…"* rather than a 404.

This is the shape board `10j` built for all four policies. Terms and privacy (`13f`, `13g`) have
since moved to the numbered `LegalPage` template — section nav, a rail, real tables — with their
wording in `lib/legal/documents.ts`. These two have not. Drawing `13i` means drawing them in that
template.

**The ledger line, checked.** *"The published policy names a fourth rung the DB CHECK forbids."*
— **it resolves toward three, and the tree already has.** `business_verification_tier_range` is
`CHECK (verification_tier BETWEEN 0 AND 2)` since `20260919090000_cut_trade_references`; the
screens draw three rungs (`components/domain/verification.ts`); the seed's policy came down to
three in #150 (build plan 1.5). Raising the CHECK to four would publish a rung whose evidence
nobody gathers, which is the reason the top two were cut. Three it is: *Not verified*,
*Claimed*, *Licence verified*.

What is still wrong is production's row. The policy lives in `LegalPage`, so the correction is a
data change against production, not a deploy, and it has not been made. By its pre-#150 text the
live page names four rungs — *Not verified*, *Licence on file*, *Licence verified*, *Audited* —
and says an expired licence drops to *licence verified*. That is the dangerous direction: the
page tells a buyer that a lapsed licence keeps the badge, and the sweep removes it the same day.
Owed, below.

**The review policy disagrees with the code on five points.** Seed and production both say:

1. *"One review per enquiry."* Since #236 it is one per supplier per enquiry — an enquiry
   accepted across suppliers carries a review for each (`@@unique([enquiryId, businessId])`).
2. Removal grounds: the policy names four — identifies a person, contact details, off-topic, not
   from the buyer. The code has five: `no_traceable_enquiry`, `abuse`, `private_information`,
   `provably_false` and the staff-only `incentivised`. *Off-topic* is not a ground; *abuse*,
   *provably false* and *incentivised* are missing from the policy.
3. Holds are missing: a review can be held pending a decision, taken off every surface and out of
   every average, with a written reason, and released exactly.
4. The 28-day reply window is missing, and so is staff removal of an abusive reply.
5. The 90-day window to write a review is missing.

The 14-day edit window and *one reply, never edited* match.

**A rung question the export surfaces.** The licence-expiry sweep drops any business above tier 1
to tier 1, claimed or not, and tier 1's badge reads *Claimed*. An unclaimed listing whose licence
was checked from the register — 36 on the seed, 23 in production by 10g's count — would wear
*Claimed* the day its licence lapses, beside 10g's banner saying nobody has claimed it. The
policy's sentence *"drops to claimed"* says the same thing. Either the sweep drops an unclaimed
listing to 0, or tier 1 needs a label that is not about a claim. The owner's call; it decides one
line of the policy and one `where` in `lib/verification/expiry-job.ts`.

**Owed to production — data, not a deploy.**

1. **The `LegalPage` row `kind = 'verification_policy'`.** Replace `body` with the text in
   `prisma/seed-campaign-legal.mts`. No admin screen writes `LegalPage`, so it is one `UPDATE`.
   The expiry rule changed in substance, so `effective_from` should move to the day it is
   corrected; the page then says *"In effect since"* that day.
2. **The `Guide` rows carrying the fabricated byline.** Set `byline` *Ayush Bhatia* and
   `byline_role` *Founder* (D6) at `/admin/content/guides/:id` — the editor takes both fields and
   writes an audit row, so this needs no SQL. The seed only ever stamped two guides:
   `what-supplier-verification-actually-proves` and `check-a-uae-trade-licence`. Build plan 1.5
   says four, which is the number of `byline:` writes in the seed (create and update for each);
   one query on production will show whether any other row carries *Rana Habib*.
3. **The `LegalPage` row `kind = 'review_policy'`** — after the five points above are written
   into the seed. Same shape as 1.

**New ledger line.** *Resolves toward three: the CHECK, the screens and the seed's policy agree on
0..2. Production's verification-policy row still names four and is owed as a data change; the
review policy disagrees with the code on five points.*
