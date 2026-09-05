# Product telemetry

The product had no event of any kind until board 8a. Every question about a
screen was answered by looking at the rows a feature happened to leave behind,
which answers *is it done now* and nothing else — not when, not in what order,
not how long it took, and never *what state somebody was in when they stopped*.

That last one is board 8a's actual question: **what score are sellers at when
they give up.** Nothing derived can answer it, because a seller who gave up
leaves behind exactly the same rows as one who has not got there yet.

This document is the decision, written down, because there was no prior decision
to cite in either direction.

| | |
|---|---|
| The table | `product_event`, plus the `listing_view_day` rollup |
| The write path | `lib/telemetry/record.ts`, and `POST /api/events` for the browser |
| The catalogue | `lib/telemetry/events.ts` — a closed set, checked at both ends |
| Retention | 180 days, enforced in `app/api/jobs/daily/route.ts` |
| Consent | none required, and §4 says exactly which properties earn that |

## 1. Why a new table and not `AuditEvent`

`AuditEvent` is the staff log. Its `actorId` and its `reason` are both NOT NULL,
and CLAUDE.md's third non-negotiable is the reason: the log records *decisions*,
and a decision has somebody who made it and a sentence saying why.

A product event has neither. Nobody decided to view the setup hub, and a storefront
view has no actor at all. Writing them into `AuditEvent` would mean either
inventing an actor and a reason for rows that have none — which is a log that
lies — or relaxing two NOT NULLs that exist precisely so it cannot.

There is a second cost and it is the one that would actually bite. The audit log
has to be readable by a person during a dispute: a tier change, a review removal,
a subscription credit. Ten thousand `setup_hub_viewed` rows a week in the same
table make that log unreadable, and an unreadable log is an absent one.

So: two tables, and the split is by *what the row is*. A decision goes in
`audit_event` with a reason. An observation goes in `product_event` with no
reason, because there is no reason to record.

`ContactReveal` made the same split earlier and for the same argument. This is
that decision applied a second time, not a new one.

## 2. Why the event set is closed

`lib/telemetry/events.ts` declares every name and every prop each name may
carry. A name outside the list is refused; a prop key the event does not declare
is dropped.

The evidence for closing it is already in the schema. `ContactReveal.surface` is
a `String` with a doc comment saying "e.g. `storefront` or `search_results`",
nothing checks it, and call sites drifted into per-listing values. Grouping by
that column now returns one row per storefront — which means it answers no
question at all. **A free-text dimension is a dimension you cannot aggregate**,
and by the time anybody notices, the fix is a backfill over a year of rows.

Two asymmetries in the validator are deliberate:

- **An unknown name is refused.** The name *is* the fact. A row called
  `setup_task_complete` is invisible to every query that groups on
  `setup_task_completed`, so storing it is worse than dropping it: it looks like
  data and behaves like a leak.
- **An unknown prop is dropped, and the event is kept.** A browser tab left open
  across a deploy keeps sending the props it was built with. Refusing the whole
  event would lose a real fact over a stale key.

Prop strings are capped at 64 characters. A task id is a slug; anything longer
is either a mistake or somebody using a public endpoint as free storage.

### Who may emit what

Each event declares an `emitter`, and it is not a permission detail — it is the
difference between a measurement and a claim.

| Emitter | Events | Because |
|---|---|---|
| `browser` | `setup_hub_viewed`, `setup_task_started`, `setup_hub_abandoned`, `setup_done_viewed`, `setup_done_exit`, `listing_viewed` | Attention facts. A screen was looked at, a task was opened, a tab went away, one of two exits was taken. The server cannot know any of them. |
| `server` | `setup_task_completed`, `setup_completed`, `setup_done_redirected`, `concierge_requested`, `setup_nudge_sent`, `setup_nudge_opened` | State facts. A task actually completed, every task completed, a route turned somebody away and knows why, a request row exists, a nudge went out, its link was followed. |

`/api/events` drops anything marked `server`. A browser asserting a state fact
is the browser's word for it, and CLAUDE.md's rule is that these numbers are
measured rather than claimed.

## 3. What the endpoint will not take from a caller

`POST /api/events` is public — it has to be, because `listing_viewed` fires for
signed-out visitors. So:

- **The actor is resolved server-side** with `getActor()`. There is no `actorId`
  field in the request body to trust or ignore.
- **`businessId` comes from the actor's own seat**, never from the body. A
  seller may emit events about their own business and about no other. The single
  exception is `listing_viewed`, which has no session at all and therefore has
  to name its business — and that id is checked against a **published,
  unsuspended** listing before it increments anything, in `recordListingView`.
  Without that check, anyone posting a made-up id writes view rows for listings
  that are drafts, suspended, or do not exist.
- **A session is required for everything except `listing_viewed`,** which is
  refused one. See §4.
- **It always answers 204.** A beacon that returns an error teaches a client to
  retry, and there is nothing worth retrying: these events describe a moment that
  has already passed, and a second copy of "the hub was viewed" is worse than
  none. `sendBeacon` cannot read a status code in any case. The silence about
  *what* was refused is the second half of that: an explanation on an
  unauthenticated endpoint is a description of the checks to somebody probing
  them.
- **Body and batch are capped** — 4 KB and 10 events — and the rate limiter is
  `lib/rate-limit`, keyed on the address rather than the actor. Keying it on the
  actor would mean paying for a `getUser()` round trip in order to decide whether
  to refuse the request, and resolving the actor is the expensive thing the limit
  is protecting.

One view per listing per request, whatever the batch claims. That does not make
the count unforgeable — nothing short of an audited pipeline would — which is
why **nothing ranks on it, and it is not an input to billing.** It is a number a
seller reads about their own listing.

## 4. Anonymous views, and why there is no consent banner

`listing_viewed` stores **no identifier of any kind**. Not an actor, not a
session, not an address, not a hash of one, not a `product_event` row. It
increments one integer on `listing_view_day`, keyed on the business and the day.

The claim being made is narrow and testable. Read it as a checklist, because if
any line stops being true the conclusion stops with it:

1. **No cookie, and nothing in browser storage.** The session id is a
   module-level variable in the tab (`lib/telemetry/session.ts`). It is not in
   `localStorage`, not in `sessionStorage`, not in a cookie. A reload produces a
   different one and there is nothing to read back.
2. **No session id is minted for an anonymous visitor at all.** The event
   declares `session: "never"`, the client component reads that same declaration
   and does not call `sessionId()`, and the route ignores one if a body carries
   it. An identifier minted and then discarded server-side is still an identifier
   that existed in the visitor's tab.
3. **No address is stored.** The rate limiter keeps a salted SHA-256 digest for
   the length of its window and nothing else; `listing_view_day` has no column
   for one.
4. **No third party.** No analytics vendor, no pixel, no script from another
   origin. The beacon posts to this application's own path.
5. **No cross-site anything.** There is nothing to correlate with, because
   nothing leaves and nothing persists.
6. **The stored row cannot single anybody out.** `("business-x", "2026-09-04",
   214)` says a listing was looked at 214 times. It is a counter, and no visitor
   is recoverable from a counter.

Taken together the storefront beacon stores no personal data and reads nothing
from the visitor's device, which is what a consent requirement attaches to. So
there is no banner, and that is a deliberate product decision as much as a legal
one: a directory that puts a consent wall in front of a supplier's phone number
converts worse and deserves to.

**What would have to change if any of this stopped being true.** Adding *any* of
the following turns this into a consent question, and none of them may be added
without revisiting this section in the same change:

- a cookie or any `localStorage`/`sessionStorage` write on a public page,
  including "just an anonymous id";
- storing the IP address, or any per-visitor value derived from one, on a row
  that outlives a rate-limit window;
- setting `sessionId` on `listing_viewed`, or giving any public-surface event a
  session;
- a third-party script or a beacon to another origin;
- joining `listing_view_day` to anything per-person — the moment a view can be
  attributed to a visitor, it is no longer a counter.

The signed-in side is different and is not covered by the above. A seller's
`setup_hub_viewed` carries their `actorId`, because they have an account with us
and the events are about their own listing. That is ordinary first-party
product data, and it is what §5's retention window is for.

## 5. Retention

**`product_event`: 180 days**, deleted by `prunedProductEvents` in
`app/api/jobs/daily/route.ts`. The constant and its reasoning live there, beside
the two prunes that make the same argument for `auth_attempt` and
`rate_limit_hit`.

Two quarters, because the question is a cohort question: a supplier's setup runs
over weeks, and a window has to hold several of those side by side before it says
anything. Past that these are rows that grow with traffic and that nothing
renders.

Note the difference from the other two prunes. Theirs is a *security* parameter —
deleting inside a throttle window hands back an allowance somebody already spent.
This one is not; it is how far back the funnel is worth reading, and the only
cost of getting it wrong is a shorter or a more expensive history.

**`listing_view_day` is not pruned.** It is a rollup — one row per business per
day, no identifier, a few hundred bytes a year per listing — and it is what
`setup.rail.views` reads for "since you went live". Deleting it would make that
sentence false. A row per view was the other option and it is the wrong one for a
directory built to be crawled; the model's own doc comment carries that argument.

The day in that table is the **Asia/Dubai** calendar day, resolved through
`dubaiDay()` in `lib/telemetry/record.ts`. Vercel runs in UTC, so a view at 01:30
on the 14th in Dubai is the 13th to the machine — and the supplier reading "since
you went live" is in Al Quoz. This is the decision `lib/format/date.ts` and
`lib/trade/open-now.ts` already made, reached the same way.

## 6. Adding an event

1. **Check nothing already means it.** The point of a closed set is that this
   step happens. Two names for one fact is the same defect as free text, arriving
   more slowly.
2. **Add it to `EVENT_NAMES` and `EVENT_SPECS`** in `lib/telemetry/events.ts`,
   with its `emitter`, its `session` and its props. Names are snake_case and past
   tense — the row records something that happened. The TypeScript prop shape is
   derived from the same table, so there is nothing else to keep in step.
3. **Decide `emitter` by §2's test:** does the browser know this, or is it
   asserting it? Attention is the browser's; state is the server's.
4. **Emit it.** Server-side, `recordEvent()` from `lib/telemetry/record.ts` —
   it never throws, so it is safe inside a render or a form submit. Browser-side,
   mount `<PageEvent>` from `@/components/telemetry`, which takes data props only.
5. **If it is a public-surface event, re-read §4 before giving it a session.**
   That is the section this document exists for.

A rename is not free: old rows keep the old name, and a query that groups on the
new one will show a cliff on the day of the deploy. Prefer adding the new name
and leaving the old one in the list until it has aged past the retention window.

## Board 8e's four, and the one number worth watching

`setup_completed` carries `hours` — first hub view to the last task closing,
from `SetupBaseline.firstSeenAt`. Board 8a estimates twenty minutes of work; if
the median is four days, the tasks are not the problem and the nudge sequence
is. That is the whole reason the baseline row exists.

The completion **order** is deliberately not on it. `setup_task_completed`
already writes one row per task with its own timestamp, so the order is a
`GROUP BY` away, and a second copy of the same fact is a second thing to get
wrong.

`setup_done_redirected` carries a reason — `tasks_open`, `already_seen` or
`suspended`. A rising `already_seen` is the signal that something is linking
into a screen board 8e §1 says must be reachable exactly once, on the
transition: an email, a bookmark, a stale tab. There is nothing to fix on the
day it is zero and something to find on the day it is not.
