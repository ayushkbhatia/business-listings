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

---

## Checkpoint 6 findings

### An on-ink button treatment is unspecified
`ghost` is a light-surface variant: `--text-body` on `--ink` measures 1.66:1.
BuilderChrome's bar and the sidebar are ink, and the design system names no
button variant for a dark surface — only that `--moss-on-ink` is the sole
accent permitted there. The gallery uses `secondary` on the builder bar as a
stopgap. Two ways to resolve it, for the canvas to decide: a `tone="on-ink"`
prop orthogonal to the five variants, or a rule that ink surfaces only ever
carry secondary and moss-on-ink controls.

### The token block has to be inside `@layer base`
Not a design question, but worth recording because it is invisible and it bit.
Tailwind v4 puts utilities in a cascade layer, and unlayered CSS beats every
layer regardless of specificity. `tokens.css` pasted at the top level meant
`a { color: var(--moss) }` overrode `text-on-ink-muted` on every sidebar link,
rendering base moss on ink at 2.15:1 — the one pairing §01 forbids by name.
The block is byte-identical inside the layer. See docs/contrast.md.

### Ten colour pairings do not clear the §09.2 floor
Measured, not estimated, and left unchanged. `docs/contrast.md` has the table,
the reasoning and three ways out. This is the one open item that needs a design
decision before handoff 1 puts these colours in front of buyers.

---

## Handoff 1, steps 1 and 2

### The verification ladder — five rungs, all inferred
§06 is canvas-only. `components/domain/verification.ts` derives the rungs from
what the shipped documents state: the tier is 0..4 and staff-write-only, tier 3
requires `visitedAt`, and the tier drops to 2 the day the licence expires.

| tier | label | what was checked |
|---|---|---|
| 0 | Not verified | nothing on the page has been checked |
| 1 | Licence on file | trade licence number recorded |
| 2 | Licence verified | checked against the issuing authority |
| 3 | Site visited | premises visited by the field team |
| 4 | Audited | premises visited and trading history audited |

Tier 1 versus 2 is the least certain: the data model distinguishes them only by
implication. Tiers 3 and 4 both require a visit, and the difference drawn here
— an audit of trading history — is an invention that needs confirming.

### ResponseTime bands
Green under 4 hours, amber under 24, red past that. The design system names the
three colours and not the thresholds. Four hours is inside a UAE working
morning; a day is still same-business-day.

### Tier 4 imports `t()` directly
Tiers 1 to 3 take their strings as props and stay generic. A domain component is
domain-specific by definition, and threading twenty catalogue keys through props
would be ceremony. Recorded because it is a deliberate line, not an oversight.

### Map tiles
`NEXT_PUBLIC_MAP_STYLE_URL`, defaulting to a keyless style so nothing waits on a
paid account. MapCanvas nudges the provider's background and water layers toward
`--map-base` and `--map-water` where those layers exist, and otherwise leaves the
provider's own colours. **A style JSON that renders the five map tokens properly
is a design deliverable**, not a config change — the tokens define a map that no
off-the-shelf style matches.

### Locked panel dim
Raised from 40% to 70% opacity. At 40% the body copy computes to 2.07:1, which
is unreadable — and unreadable content defeats the rule the dim exists to serve.
The design system says "dimmed"; it also says never hide the feature.

### Still unknown
- Whether tier 4 is an audit, a re-visit cadence, or something else entirely.
- What a sponsored ListingCard looks like beyond "always labelled".
- Whether the map has a clustered state in the canvas; MapCanvas types the
  cluster circle in its documented hierarchy but does not yet render one, as
  nothing in the seed has enough co-located pins to need it.

---

## Handoff 1, step 4 — search

### Ranking is in the process, not in Postgres
The weights object is the deliverable board 12c specifies and it is exact. The
scoring runs in Node over a bounded candidate set of 200 rows, which is correct
at 41 listings and wrong at 41,000. Moving it to a Postgres-side score is a
query change; `lib/search/ranking.ts` moves unchanged, which is the point of
having it as config.

### Unmeasured signals score half, not zero
Not specified anywhere. A new supplier has no response time and no reviews, and
scoring those as "worst possible" would bury every listing on its first day and
freeze the top of every category. Half credit is the honest position: we do not
know. Same for distance, which is unknown for almost every buyer because the
site never asks where they are.

### Response-time bands
Full marks at four hours or better, zero at a week, linear between. Same
thresholds as the ResponseTime component.

### The sponsored slot
Top of page one when the buyer has set no verification filter; natural rank
position when they have. Either way it is labelled and there is at most one.
The rule in the README is "never outranks a verified supplier on a filter the
buyer explicitly set" — this reads that as the verification facet specifically,
which is the only facet where "outranking" has a trust meaning.

### Facet counts are measured with that facet cleared
Otherwise every unpicked option reads zero, which is the most common way a
filter rail becomes useless. Spec-facet counts are grouped in the process over
up to 1,000 matching rows rather than in SQL, because a JSON column with a
dynamic key does not group cleanly through the query builder.

### Imperial-first products in the seed
Added so criterion 3 has a real subject. A DN100 product that merely carries 4"
as a synonym does not demonstrate anything; a product named and specced `4"`,
found by a DN100 query, does. Both directions are now in the match surface.

### Still unknown
- Whether a category page should be indexable with filters applied. Currently
  the canonical drops the query string and /search is noindex, which is the
  conservative reading.
- Whether the results toolbar should carry a sort control. Nothing in the
  README mentions one, and ranking is the answer to sorting here.
- What the sponsored slot looks like beyond "always labelled".

---

## Handoff 1, step 5 — home and compare

### Unbuilt chrome routes are named, not linked
`/categories`, `/guides`, `/pricing` and the four policy pages are board 10j and
later handoffs. `docs/routes.md` says a later route is named so the nav config
is shaped correctly now. They render as greyed text with a title, the same
treatment AppSidebar gives an unbuilt admin route, rather than as links into a
404. Turning them into links is a one-word change per entry when the pages land.

### Compare is a real feature; only "Enquire with all" is disabled
The README puts /compare in scope as a page and disables the enquire action
specifically, so the Compare control on a listing card is a link rather than a
disabled button.

### The comparison tray lives in the URL
`?compare=slug,slug` on a results page, `?p=slug,slug` on /compare. No client
state and no cookie: adding a supplier is a navigation that preserves every
other facet, and the whole flow works before JavaScript arrives. Capped at four
because past that the table stops fitting on any screen a buyer has.

### The comparison table is transposed
Suppliers are columns and attributes are rows — the opposite of every other
table in the product. Four across is what fits, and a buyer reads down one
attribute at a time. Both `th scope="col"` and `th scope="row"` are used.

### Home ordering never uses plan tier
Featured suppliers are ordered by verification then reviews. Sponsored
placement is sold per category and emirate; on the home page a paid slot would
read as an editorial endorsement.

### Still open
- **`next/link` migration.** Everything is a plain `<a>`, which was deliberate
  for the works-without-JavaScript property — but `next/link` renders a real
  anchor too and adds prefetch and client-side navigation for free. One
  instance was converted where the Next lint rule fires; the rest is a
  mechanical sweep worth doing before launch, and it is a performance change,
  not a correctness one.

---

## Handoff 1, step 6 — SEO

### The board 6f guard applies to subcategories, not top-level categories
`routes.md` scopes the thresholds to "area landing pages and subcategory
pages". A top-level category is core navigation that the home page links to
directly, and holding it out of the sitemap while linking to it from the front
page would be the worst of both. All four seeded subcategories are held back,
which is the guard working.

### Intro-word count is not enforced yet
The 250-word floor is in `evaluatePublish` and tested, but the sitemap passes a
constant for it because the intro-copy field arrives with the handoff 5 pages
it belongs to. Only the supply floors bite today.

### An unclaimed listing stays in the sitemap
At priority 0.4 rather than 0.7, and without its catalogue, branches or reviews
tabs, which it does not have. Thirty thousand unclaimed pages are how a
supplier first finds us; excluding them would be excluding the acquisition
funnel.

### Lighthouse found a second §09.2 conflict
Type size. 11.5px captions and 9.5px eyebrows are both deliberate and both under
the 12px Lighthouse counts as legible, so only 30 to 40 per cent of a page
clears it. Criterion 10 asks for **SEO** ≥ 95 and that is 100 everywhere, so
this does not block — but it compounds with the contrast gap on exactly the same
`--text-muted` metadata. Written up in docs/contrast.md with three ways out.

### One real defect Lighthouse caught
Facet rows in the filter rail were 22px tall against a stated floor of 44px on
mobile. Fine with a mouse, bad with a thumb, and a filter rail on a phone is all
thumb.

### Raw-SQL indexes and `prisma migrate dev`
An index created in a hand-written migration is invisible to `schema.prisma`,
so the next `migrate dev` reads it as drift and generates a migration to drop
it. Any future raw-SQL object needs `IF NOT EXISTS` on creation and `IF EXISTS`
on removal, and the migration that follows it needs reading before it is
applied. See docs/database.md.

## Handoff 2, step 1 — the seller side

### The seed's clock now moves
`NOW` was a fixed instant, `2026-08-14T12:00:00+04:00`, which made two runs
byte-identical. Ten days later every "live" enquiry in the leads inbox rendered
as **Closed** and the seller screens had nothing to act on. A fixture that
expires is worse than one that moves, so `NOW` is now noon today in Asia/Dubai.
The PRNG stays fixed, which is what actually keeps content stable — the same
businesses, products, prices and names every run. Only the timeline slides. Set
`SEED_NOW` to an ISO instant to reproduce an exact dataset.

### A match floor, set by hand
`MATCH_FLOOR = 0.45` in `lib/quote/match.ts`. Nothing in the handoff states one.
It is set against the seeded catalogue so that a line naming a product the
seller stocks clears it and `API 6D trunnion ball valve DN600` clears nothing.
The matcher errs towards **unmatched**: a matcher that always finds something is
worse than none, because the seller stops reading the suggestions and one day
sends a DN600 line at the DN100 price with their name on it.

### The size veto is not a score
If an enquiry line and a product both name a readable bore and the bores differ,
the pair is removed rather than ranked last. "Gate valve DN100" and "Gate valve
DN150" share every word that matters and are not substitutes. A veto cannot be
reached by lowering a threshold; a low score can.

### Quote arithmetic is integer fils
`lib/quote/money.ts`. A quote total is what a buyer commits their company to,
and `0.1 + 0.2` has no business appearing on a line that says AED. This needed
`tsconfig.target` raised from create-next-app's ES2017 to ES2020 for bigint
literals; every browser Next.js 16 targets has supported BigInt since 2020.

### `AppSidebar` takes resolved labels
It took a `translate` function, which a server component cannot pass to a client
component. Rather than have the sidebar import `t()` — which the config exists
to avoid — callers now pass `resolveNav(DASHBOARD_NAV, t)`. Labels arrive as
strings, as they do for every other component here.

### The dashboard's nav badges were lies
`nav-config.ts` shipped `badge: 7` on leads and `badge: 2` on quotes as
placeholders. With the screens built, the sidebar said 7 above a page listing 2.
Both are now passed through `resolveNav` from real counts. The admin placeholders
stay until handoff 4 builds their screens.

### A development-only seller seat
Step 1 builds the seller side before step 2 builds auth, on the README's own
sequencing. `lib/auth/dev-seller.ts` resolves a seeded owner from
`DEV_SELLER_SLUG`, returns null when `NODE_ENV === "production"` before reading
anything, and is opt-in even locally. Step 2 deletes it. One consequence worth
knowing: `pnpm test:e2e` builds for production, so the seller screens cannot be
covered by Playwright until sign-in exists. Their proof lives in
`tests/integration/` instead, against a real database.

### Quote references
`QT-8863-ALMR1` — enquiry number, the supplier's three-letter mark, revision.
The seed's historical refs use an older positional shape (`QT-8841-B2R1`) and
are left as they are. A numeric suffix is appended if two suppliers on one
enquiry share a mark, because `Quote.ref` is unique and a clash must not lose a
quote.

## Handoff 2, step 2 — auth

### A wrong code cannot be told from an expired one
Supabase answers both with `otp_expired`. Rather than pass its guess on as
certainty, the verify screen says "that code did not match" and offers a fresh
one. `link_expired` — the board 7a state — is reached only from
`/auth/callback`, where Supabase does say so explicitly. Caught by a test that
expected the two to differ; they do not.

### Sign-in is enumeration-neutral, sign-up is not
Asking for a code says the same thing whether or not the account exists, and the
failed attempt is still counted so the throttle is not itself an oracle. Sign-up
does say when an address is rejected, because an address that does not exist is
the user's own typo and there is nothing to enumerate. Supplier numbers are
published on their own storefronts anyway; buyer numbers are not, and this was
the one place they could have been checked one at a time.

### The intent to list is not the role
Signup captures `wantsToList` on the profile. `seller_owner` is scoped to a
business, and there is no business until the claim flow in handoff 3 attaches
one, so granting the role at signup would grant it over nothing.

### A provisional identity is a real Supabase user
The alternative was a profile row with an id of our own, re-keyed on first
sign-in — which means updating a primary key that Enquiry, Message, Review,
ReviewRequest and SupplierReport all point at, under foreign keys that are
`ON UPDATE NO ACTION`. Creating the lightweight identity as an unverified
Supabase user makes the ids match from the start and removes the whole class of
problem. `createProvisionalIdentity` is the seam step 3 calls.

### A suspension has no reason column
It lives on the audit row, where CLAUDE.md puts every staff state change and
where a business suspension already keeps one. It is also not automatically the
text to show the suspended person — an investigative note is for staff — so the
screen names the date and offers an appeal instead.

### Two throttles, because the risks are opposite
Asking for a code is cheap to the user and costly to us: a WhatsApp
authentication message to the UAE is priced per delivery, so there is a
one-minute cooldown and five an hour. Submitting one is free to us and is the
only thing between a six-digit number and an account: no cooldown, five wrong in
fifteen minutes. Supabase enforces its own limits and does not expose the
counter, so "too many attempts" could not be a designed state without our own
record.

### `Checkbox` had never worked uncontrolled
Shipped in handoff 0. The tick and the filled box were driven by the `checked`
prop, which is `undefined` on an uncontrolled checkbox — so a user could click
it, the DOM would update, and nothing visible would change. Every gallery
specimen was controlled, so nothing caught it. Now driven by `:checked` in CSS,
which is how `Radio` was already written.

### `tsconfig.target` is ES2020
Raised in step 1 for bigint literals in the quote arithmetic. Recorded here too
because it is a project-wide setting that arrived inside a feature commit.

## Handoff 2, step 3 — the buyer flow

### Fan-out ranking is not search ranking
`lib/enquiry/fanout.ts` has its own weights. Search answers "who should this
buyer look at" and is weighted for relevance and browsing; fan-out answers "who
can actually answer this today", so coverage and stock carry most of it and the
plan's multiplier carries almost none. A paid plan reorders two similar
suppliers and can never promote one who cannot fill the order — there is a test
for exactly that line.

### The monthly cap is applied during matching, not at delivery
Rule 4 says the buyer never sees a capped seller in their recipient list. So a
capped seller is not a candidate at all, rather than a candidate who is shown
and then skipped. It applies even to a pinned supplier: if they cannot reply,
putting them on the enquiry costs the buyer a slot and gets them nothing.

### An enquiry reference comes from a Postgres sequence
`enquiry_ref_seq`, starting at 8901 — above the seeded refs so a fresh seed and
a live database never disagree about what `ENQ-8863` means. A retry loop
pretending to be a sequence was the alternative, and two enquiries sent in the
same second would have raced.

### A buyer with no account is identified by a bearer token in the URL
The tracking page cannot be public by reference: `ENQ-8901` is four digits in a
WhatsApp message and anybody could walk them. So the link carries the
provisional identity's `claimToken`, which is a random UUID, only ever grants
access to that identity's own enquiries, and stops working once the account is
claimed. It is the magic-link trade-off, taken deliberately.

### The provisional identity had a repair added
`createProvisionalIdentity` now recovers when Supabase already holds that phone
with no profile row beside it. Found by the browser walkthrough: an integration
test had deleted a profile row without its auth user, and that one orphan made
the number permanently unable to send an enquiry. In production the same drift
could come from a failed transaction, so the recovery is not test-only.

### Every enquiry affordance handoff 1 shipped disabled is now live
The README's "depends on" says so: `/b/:slug`, the catalogue tray, the product
page, the results rows, the comparison tray's "enquire with all", and the
zero-result RFQ. `ListingCard` and `ProductCard` take an optional
`enquireHref`; without one they stay disabled, which is how the gallery still
shows the state handoff 1 shipped. Three handoff-1 tests asserted the disabled
state and now assert the live one.

### `Select` passed both `value` and `defaultValue`
On every controlled select that also had a placeholder, which is most of them.
React warns and the element is ambiguous. Same family as the `Checkbox` bug in
step 2: a primitive whose state came from the wrong place.

### A link that looks like a button stays a link
`buttonClassName()` is exported from `Button` rather than making the component
polymorphic. An anchor navigates, middle-clicks into a new tab and announces as
a link; a polymorphic Button would let a caller put an `href` on something that
submits a form.

### `docs/routes.md` disagreed with the handoff on two paths
It listed `/account/enquiries/:id/compare` and `/account/enquiries/:id/accepted`;
the handoff 2 README's scope block says `/enquiry/:id/compare` and
`/enquiry/:id/accepted`. The README won — those pages are reachable by a buyer
with no account, and nesting them under `/account` would promise a section such
a buyer does not have. routes.md now matches.

## Handoff 2, step 4 — the thread

### Off-platform detection is context-dependent, and had to be
Rule 5 says an IBAN in a message raises a `SupplierReport`. But payment here is
*always* off-platform — buyers pay suppliers directly and we hold no funds — so
a supplier sending bank details after their quote is accepted is doing exactly
what comes next, not doing something wrong.

So: money signals raise a report **before** contact is released, and do not
after; steering language ("deal directly next time", "don't use the site")
raises one either way, because disintermediation is wrong whenever it happens;
and a flagged message is marked on the record in both cases, because rule 5's
first sentence is that everything stays on the record.

Reporting every post-acceptance invoice would make the queue mostly no-action,
and a queue nobody reads is worse than no queue. Criterion 7's canonical case —
bank details sent before acceptance — reports exactly as specified.

### The detector's false positives were the harder half
A TRN is fifteen digits, a UAE mobile is twelve, a letter of credit and a bank
guarantee are ordinary trade instruments, and "50% advance, balance on
delivery" is a payment term rather than a demand. All of them are stripped
before anything else runs. A detector that flags a TRN trains sellers to ignore
the warning, and then it catches nothing.

### `nudgedAt` is a timestamp because a counter would permit two
Board 11b says a second follow-up loses more deals than it wins. A column that
cannot count cannot be made to offer three, whatever a future screen wants.
There is a test asserting the column's type for that reason.

### A closed enquiry still lets the accepted pair talk
Cutting them off at the close date would push delivery arrangements — exactly
the conversation this platform wants on the record — onto WhatsApp. Everybody
else on the enquiry is done.

### The revision delta is computed once, for both sides
`lib/messaging/thread-view.ts`. If the seller's screen said the price came down
six per cent and the buyer's said five, the record would be worth nothing.

### `role="log"` on an `<ol>` removes its list role
Which leaves every `<li>` without a list parent — axe says so, and a screen
reader stops announcing "3 of 7". The live region is a wrapper now and the list
stays a list. Caught by the buyer thread's axe test.

### The seller's thread has no browser test, and cannot yet
Playwright builds for production, where the development seller seat is
deliberately inert, so `/dashboard` 404s under `next start`. Signing in for real
needs an OTP, which needs the Supabase admin API, which CI has no key for. The
seller side is covered by the integration tests and was checked by hand against
the dev server — the board 11b warning and the single nudge both render. This
is the second step where that gap has bitten; it closes when CI can sign a
seller in.

## Handoff 2, step 5 — notifications

### Criterion 8 has two halves and only one is about templates
The template guard checks that no template *names* a placeholder that could
carry contact details. That is the easy half — a template is written once and
reviewed once. The other half is `lib/notify/render.ts`: `{area}` is a
perfectly safe placeholder and `{ area: "+971 50 641 2288" }` is a leak. Values
are checked at the moment of substitution and a leak throws rather than sends.
The check is deliberately tight — a formatted price has separators and a
reference has a prefix, so neither trips it.

### The delivery log records what did not happen
A row is written for a skip and a defer as well as a send, with the reason. A
seller asking "why did I not hear about that enquiry" deserves an answer, and
the answer is usually one of their own settings. It is also how a WhatsApp
template still waiting on Meta shows up as a visible gap rather than silence.

### In-app is never deferred
Quiet hours silence WhatsApp and SMS. In-app is not an interruption — nothing
buzzes, and a notification waiting in a list at 07:00 is the same notification
whether it arrived at 22:00 or at dawn. Deferring it would only make the list
wrong.

### Buyers have no notification matrix, so they have a default
Board 7e is the seller's control panel and nothing in this handoff gives a
buyer one. Buyer-facing events (`quote_received`, `quote_revised`) route
through `BUYER_DEFAULT` in `lib/notify/events.ts`. Quiet hours still apply — a
WhatsApp at two in the morning is rude whoever receives it — and there is no
high-value override, because a buyer set no threshold to override.

### An enquiry's value comes from the buyer's own targets
For the quiet-hours override there has to be a number, and the only numbers on
a fresh enquiry are the buyer's target prices — there are no supplier prices
yet, by definition. Lines with no target contribute nothing, so the estimate
reads low, and a seller woken at midnight was woken for an enquiry that really
is large.

### Notification dispatch is inline, and should not stay that way
`createEnquiry` awaits the sends before returning. That is correct without a
queue — in a serverless function, work that is not awaited may never run — but
it means a buyer waits on eight suppliers' notifications. Batching the template
lookups took it from thirty-two queries to one per recipient, which made it
tolerable rather than right. A queue is the real answer and belongs with the
response-time measurement job.

### A `"use server"` module exporting a const array fails at runtime, not at build
Next reports "A \"use server\" file can only export async functions, found
object" at module evaluation. `next build` passes, so it ships and then fails
on the first request that touches the page. This happened twice in this
handoff — once with a pure function in step 3, once with a const array here.
`tests/unit/server-actions.test.ts` now checks every action module in the unit
suite, where it costs nothing.

### What is still switched off
Unchanged from step 2, and now it matters more: WhatsApp templates are
`pending_meta` and cannot send; SMS has no carrier because the Bird key has no
`sms` scope; email has no provider beyond the development SMTP's two messages
an hour. The layer treats all three as a skip with a reason rather than a
silent success, and board 7e says so to the seller in plain words.

## Handoff 2, step 6 — reviews

### The audit writer had never been wired
`lib/audit` shipped in handoff 0 as a port with a note that the Prisma writer
arrived "at checkpoint 3". `setAuditWriter` was never called, so `writeAudit`
threw `AuditNotConfiguredError` and **no audited staff mutation could run at
all**. Nothing had called one, so nothing noticed. Review removal is the first,
and `lib/audit/prisma-writer.ts` closes it.

The port's own comment asked for the audit row to share a transaction with the
mutation it records. `AuditWriter.write` now takes an optional transaction and
`staffMutation` passes it through, so a removal cannot reach the database
without its explanation. The type is structural rather than Prisma's own, so
lib/audit stays free of a Prisma import and keeps being testable against a fake.

### The removal-reason constraint schema.prisma promised did not exist
`Review.removalReason` carries the comment "Enforced by a check constraint in
the migration, not only by the service layer" and no such constraint was ever
written. It exists now, paired rather than merely non-null: a reason with no
removal is as wrong as a removal with no reason. Same for the seller reply and
its timestamp.

### Composing the reason before validating it defeated the validation
`removeReview` built `"${ground}: ${reason}"` and handed that to
`staffMutation`, so an empty reason arrived as `"abuse: "` — seven characters
containing letters, which passes. The moderator's own words are validated
first now. Caught by the test for criterion 9's "removal without a reason
throws", which is exactly what that criterion is for.

### Radios, not stars
A star widget is five buttons pretending to be one control: hard to reach by
keyboard, ambiguous to a screen reader, and five small targets on a phone where
one row of five would do. `RadioGroup` renders a fieldset with a legend, which
is `role="group"` — the canonical HTML pattern, and axe clean.

### A review page for an enquiry that does not exist is not a 404
It renders "this enquiry is not yours to review", the same answer as somebody
else's enquiry. The buyer arrived from a link somebody sent them and a blank
404 helps nobody; the message is identical either way, so it enumerates
nothing. This differs deliberately from the enquiry pages, which do 404 —
there, the visitor navigated themselves.

### Removed reviews stay on the seller's page
Marked, with their reason. A supplier who cannot see that one was taken down
cannot learn anything from it, and hiding it entirely would look like the
review had never existed — which is the one thing a removal must not resemble.

### The seed needed a second provisional enquiry
ENQ-8871 has to stay unaccepted so the compare screen has accept buttons for
its own tests; the review flow has to start from an accepted quote. One
enquiry cannot be both, so ENQ-8879 is accepted and unreviewed. Three browser
tests were skipping before that, which is a test suite quietly proving nothing.

## Handoff 2, step 7 — criterion 5, the measurement job

### The seed was inventing the number criterion 5 forbids
`responseTimeMedianMs` was set to `int(20, 2600) * 60_000` at business
creation, then partly overwritten by a hand-written SQL median. So most
suppliers displayed a fabricated reply time — which is exactly the "claimed,
never measured" thing the criterion exists to prevent, in the version a
reviewer looks at first. The seed now seeds a reply history and derives the
number through the same functions the scheduled job uses, so the two cannot
drift.

### Median, not mean, and the window is ninety days
One supplier who ignored an enquiry over Eid drags a mean into the red for a
quarter. The median says what usually happens, which is what a buyer is
actually asking. Ninety days is long enough to gather a sample where a supplier
sees a handful of enquiries a month, and short enough that improving shows up
in a quarter rather than never.

### An unanswered enquiry contributes nothing, rather than counting as infinity
"They did not answer" is a different fact from "they answered slowly", and
folding it in would let one ignored enquiry swamp a median meant to describe
the replies a buyer will actually get. Non-response already has its own
number in the recipient state.

### Three replies before anything is shown
Two is a coin toss, and publishing it invites a new supplier to game it by
answering their first enquiry in ninety seconds. `MIN_SAMPLE` is 3 and the
unmeasured state says "not enough enquiries to measure", which is true and is
not a penalty. One claimed, published supplier is left with no history in the
seed so that state has a public example.

### Removing a PRNG draw renames every business after it
Deleting the invented response time shifted the deterministic sequence and
renamed most of the seeded businesses, breaking the hardcoded slugs a dozen
test files pin. The draw is kept and discarded, with a comment, because a
deliberate discarded draw is a smaller lie than a fabricated reply time and
cheaper than churning every fixture. The underlying fragility is real: the seed
derives names from sequence position rather than from a stable per-business
seed, and any future change in the middle of it will do this again. Worth
fixing properly when something else touches the generator.

### `pnpm measure` needs `--conditions=react-server`
The job imports `server-only`, whose package main throws outside a React Server
Component; its `react-server` export condition is a no-op. Scripts that touch
server modules carry the flag rather than the fence being weakened.
## Handoff 2, step 7 — criterion 11, the seller screens

### The gap closed by signing in, not by weakening the fence
Four steps shipped their seller screens with no browser test, because Playwright
builds for production and `lib/auth/dev-seller.ts` is deliberately inert there.
The answer was never to make the development seat work in production — it was
to sign in properly, which step 2 built. `tests/e2e/auth.setup.ts` provisions a
seller, signs in through the real verify form, and saves the session; the
`seller` project reuses it.

The only substitution is delivery: `admin.generateLink` returns the code
Supabase generated without sending it. Everything after — verifyOtp, the
profile lookup, the roles claim, the redirect to /dashboard/leads — is the
production path. If the auth flow breaks, the setup fails loudly rather than
producing forty confusing failures.

### The seller projects are not registered without a key
Rather than registered and skipping. A suite that silently covers less than it
claims is worse than one that is visibly smaller, and the config says so on
stderr when it happens.

### Playwright cannot import the generated Prisma client
It transforms test files to CommonJS and the client uses `import.meta`. The
setup talks to Postgres through `pg` instead; three statements do not need an
ORM.

### The dashboard nav was full of dead links
Handoff 1's rule — "a `later` route is named so the nav shape is right now, and
is not a link until its handoff lands. No dead links" — was implemented in
AppSidebar and never applied to the dashboard config. Twelve of sixteen items
pointed at routes that do not exist. The first browser test signed in as a
seller found them all. Every unbuilt item is `later` now, on both the dashboard
and the admin nav.

### Which exposed a second defect
With most items rendering as text rather than links, the sidebar's scrollable
region had no focusable descendant — so it could not be scrolled by keyboard at
all. It carries `tabIndex={0}` now. Axe found it the moment the nav changed,
which is the argument for having had these tests four steps ago.

### One shared Supabase user across environments
The e2e seller is `bl.e2e.seller@gmail.com` in the real Supabase project, and
CI and a local run share it. The setup deletes any leftover before creating
one, so at most one accumulates — but two runs at the same moment would race.
Worth a per-run suffix if that ever bites.

## Handoff 2, step 7 — the acceptance pass

`pnpm acceptance:2` walks the twelve criteria from
`handoffs/handoff-2-enquiry-engine/README.md` and prints one line per criterion.
Seventeen checks, because five criteria have two halves that fail
independently — criterion 5 is measured and rendered, criterion 7 is detected
and warned about, criterion 11 is public and seller, criterion 12 is axe, build
and gallery. It needs the app built and served on `:3000` and the seed loaded.

### A name filter that matches nothing exits zero

The first run reported sixteen passes and one failure. The failure was real
enough — two `vi` call sites were missing their log-name argument, so `$3` was
unbound under `set -u`. The passes were not all real. Criterion 2 ran

```
vitest run --project integration -t "criterion 2"
```

against `tests/integration/seller-queries.test.ts`, whose describes were named
`before acceptance`, `scoping` and `after acceptance`. Nothing matched. Vitest
skipped 110 tests, ran none, and exited zero. The walk read that as a pass and
printed a criterion 2 line with a blank test count, which was the only visible
symptom.

This is the second time. Handoff 0's criterion 1 sat green for two commits
after the tier-4 commit renamed the test it grepped for. The fix there was to
change the grep, which fixed that instance and not the class. So both helpers
now assert the run actually reported passing tests:

```bash
vi() {
  pnpm exec vitest run --project "$1" -t "$2" >"$LOG/$3.log" 2>&1 || return 1
  grep -qE 'Tests +[0-9]+ passed' "$LOG/$3.log" || {
    printf '   \033[31mFAIL\033[0m  the filter "%s" matched no tests\n' "$2"
    return 1
  }
}
```

A green acceptance line is a claim about the product. It should not be
satisfiable by a typo. The describes in `seller-queries.test.ts` were renamed to
carry the criterion number as well, matching the convention the other four
integration suites already used — but the renaming is the convenience, and the
guard is the fix.

### What the walk asserts that the test suites do not

Three criteria are checked in the browser rather than in a test, because what
they forbid is a rendering, not a return value.

- **Criterion 2** greps the served `/dashboard/leads` HTML for the buyer's
  surname, phone number and company address. The query-layer tests prove the
  columns are never selected; this proves no screen puts them back.
- **Criterion 7's** second half greps the served page for the board 11b warning
  text, to catch it being present in the markup but commented out or visually
  hidden.
- **Criterion 3** counts rows in every table before and after an acceptance.
  The assertion is not that specific tables are untouched but that *no* table
  outside the expected four moved. There is no order table in this schema, and
  criterion 3 is the check that notices if one appears.

### The walk did not look at a phone, and four specs were red

Criterion 11 ran `--project=chromium --project=seller`. The mobile project was
never in it, and `pnpm test:e2e` — which does run it — had four failures. One
was the test's fault: `home-compare.spec.ts` asserted "Pricing" and "Guides"
were visible on every viewport, but those live in the nav's `hidden lg:flex`
list, so below 1024 they are correctly not shown. It now checks the footer's
four at every width and the nav's two only where the nav is drawn, while the
"named, not linked" assertion stays unconditional.

The other three were the product's fault, and they were the buyer's primary
flow: on a 412px phone the fan-out wizard's Continue button could not be
pressed.

### A scroll container inside a fieldset does not stop the page widening

`/rfq/new` measured 693 CSS px wide inside a 412px viewport. Nothing visibly
overflowed — every element outside a scroll container fitted, and
`document.body.scrollWidth` was 412. Only `document.documentElement.scrollWidth`
was 693, which is enough: the page pans sideways over blank space, and the
offset between layout and hit-testing put a `<th>Qty</th>` and a stepper label
under a tap aimed at a button several hundred pixels away. Playwright reported
a different interceptor on almost every retry, which is what that looks like
from the outside.

Two separate causes, both needed fixing:

- A `<fieldset>` defaults to `min-inline-size: min-content`. It will not narrow
  below its widest child, so the `overflow-x-auto` wrapper inside it was laid
  out at the table's full 640px and spilled out of a 276px card rather than
  scrolling. `Radio.tsx` had already worked around this with `min-w-0` on its
  own fieldset; `fieldset { min-inline-size: 0 }` now does it once for all four.
- With that fixed the wrapper scrolled correctly — `clientWidth` 242,
  `scrollWidth` 640 — and the document *still* reported 693. A scroll container
  nested in a fieldset does not stop the document counting the width it clips.
  `contain-paint` on the wrapper does. Of the fifteen `overflow-x-auto` wrappers
  in the app it is the only one inside a fieldset, and a sweep of every public
  route at 412px found it was the only route affected.

`tests/e2e/viewport.spec.ts` asserts `scrollWidth === clientWidth` on ten public
routes in both projects, so the third fieldset cannot repeat this quietly. The
walk's criterion 11 gained the mobile project for the same reason.

### What this does not fix

Six inputs behind a 40rem floor is still a poor way to enter line items on a
phone: the buyer now scrolls a 242px window sideways across the table instead
of the whole page, which is correct behaviour and a bad experience. Stacking
the row below some breakpoint is a board decision, not something to change
inside an acceptance pass, and it is carried.

### `pipefail` plus `grep -q` made criterion 9 a coin flip

CI went red on this branch at a step nothing in the branch touched:

```
FAIL — QuoteLine exists but has no unitPrice. That is the only price in the schema.
```

`prisma/schema.prisma` was byte-identical to the run twenty minutes earlier
that passed, and `pnpm check:schema` passed locally every time. The script ran

```bash
set -uo pipefail
code() { sed -E 's://.*$::' "$SCHEMA" | grep -v '^[[:space:]]*$'; }
if code | grep -qE '^model QuoteLine'; then
  if code | grep -qE '^unitPrice'; then ...
```

`grep -q` exits the moment it matches. If the producer is still writing when it
does, the producer takes SIGPIPE and exits 141, and under `pipefail` the whole
pipeline reports 141 — a successful match returning failure. The schema is
about the size of a pipe buffer, so which way it went depended on how loaded the
machine was:

```
pipeline status with a producer still running: 0
pipeline status when the producer outruns the pipe buffer: 141
```

Both branches were wrong in a different direction. The passing run never
reached the inner check at all, because the outer `if` had already read 141 —
so criterion 9's fourth assertion silently did not run. The failing run reached
it and then read 141 from the inner one. The check has been able to false-pass
and false-fail since it was written; the CI history just never showed it.

The strip now happens once into a variable and every check greps that with a
here-string, so there is no pipeline to race. The remaining `grep -q` calls in
the scripts read files, and the `| head -n` pipelines are inside `$(...)` used
for their output rather than their status, so neither can do this.

Worth stating plainly: this is the third defect this handoff where a check
reported success without having checked anything — the handoff 0 grep after a
rename, the `-t` filter that matched no tests, and now this. All three were
silent. A check that cannot fail is worse than no check, because it is counted.
