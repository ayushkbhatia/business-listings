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

## Handoff 3, step 1 — the two overviews

### The number board 11a argues from was never written down

`lib/enquiry/fanout.ts` has always computed which suppliers the fan-out skipped,
and its own comment says what for:

> Who was left out for a reason worth recording. Not shown to the buyer — this
> is for the seller's own "you missed N enquiries this month" nudge.

`createEnquiry` returned `skipped` to its caller and wrote nothing. The list
existed for the length of one request and then went away, so acceptance
criterion 5 — "a Free-plan seller at their cap sees the missed-enquiry list with
real dates and requirements" — had nothing to read. The roadmap for this handoff
said those rows already existed. They did not.

`MissedEnquiry` now carries them, written in the same transaction as the
recipients: a seller who was left out was left out of *this* enquiry, and
recording it afterwards means a crash in between produces an enquiry nobody was
told they missed.

### Not a RecipientState

The obvious shape was a `skipped` value on `RecipientState`, and it is wrong.
`enquiry_recipient` means the business received the enquiry. A capped seller did
not, and three separate queries filter on that state — the leads inbox, the nav
badges, and the response-time median. Each would have had to remember to exclude
a delivery that never happened, and the one that forgot would have quietly
counted a non-delivery as an unanswered lead or poisoned a public number.

It is also the structural half of rule 1. `MissedEnquiry` has no buyer relation,
so the board can show the requirement and the date and has no column to leak a
name from. That is a fence rather than a `select` discipline.

### Profile strength was the same lie, one column along

`Business.profileStrength` was `int(38, 98)` in the seed. Handoff 2 caught
exactly this in `responseTimeMedianMs` and gave it a measurement job; the column
next to it kept its random number, and step 1 was about to render it at the top
of the seller's own home screen.

`lib/metrics/profile-strength.ts` is the pure function, `strength-job.ts` runs it
over every business, and both the cron route and `pnpm measure` call it beside
the response-time job. The seed derives it with the same function rather than a
second implementation. That is criterion 11's second half, arriving in step 1
because step 1 is what put the number on a screen.

The weights are published: board 8a states what each setup task is worth in
percentage points, so `WEIGHTS` has a test asserting it sums to a hundred. No
seeded business reaches the 80% threshold, because the seed has **zero** media
rows and photographs are twenty of those hundred points. That is honest, and it
is what step 2's media library is for.

### A locked panel has to name something real

The first version dimmed "Analytics" and "Sponsored placement" and offered a
plan for each. Neither is a column on `Plan`. Naming a price for an entitlement
the schema does not hold is the kind of thing a seller discovers is untrue at
the moment they pay, so the two locked panels are now `customDomain` and
`siteVisitIncluded` — real booleans on real rows, and the sentence under each is
checkable. Analytics and sponsored placement arrive in step 4, with whatever
gates turn out to be true.

`cheapestPlanUnlocking` returns null when there is nothing to sell, and the
panel then opens rather than locking. A lock on a feature the seller already has
is an advert for something already bought.

### A fixture that contradicts the rule it demonstrates

The free-plan fixture first read "8 of 3" under a panel saying a three-enquiry
limit had been reached. Both numbers were true — `seedReplyHistory` spreads
answered enquiries across ninety days and five of them landed in the current
month — and together they made the board argue against itself.

The seed now moves that supplier's earlier rows out of the month before adding
exactly `enquiriesPerMonth` fresh ones, and throws if the count is not exactly
the cap. Backdated rather than deleted: the response-time median is measured
over ninety days and still wants them.

### Two seats, because two plans

Board 3a and board 11a cannot be checked from the same session. `auth.setup.ts`
now provisions a Pro seat and a Free seat and saves two storage states, with a
`seller-free` Playwright project for the second. Criterion 9 will want a third
for the `sales` role.

### Two tests that were passing by luck

- `send-quote.test.ts` asked for "some other business with an owner" in no
  particular order and called it a business the enquiry was never sent to. It
  was not the same question: the row it picked *had* been sent the enquiry, so
  it sailed past the recipient guard and failed on the catalogue check instead.
  Seeding one extra user changed the physical row order and exposed it. It now
  asks for `recipients: { none: { enquiryId } }` with an explicit `orderBy`.
- A `testIgnore` of `/(dashboard|overview)\.spec\.ts/` does not match
  `overview-free.spec.ts` — the hyphen falls outside the pattern — so the
  signed-out projects picked up the signed-in spec and produced eighteen
  failures across chromium and mobile.

### The component count still does not add up

`docs/design-system.md` says tier 4 is 14 and the four tiers make 64. Twelve are
built and handoff 3's README names three more, which is 15 and 65. The gallery's
denominator read `/7`, a number twelve components had already passed, and is now
15 — the newest source rather than the one that makes 64 come out right.
Criterion 12 counts to 64, so one of the two documents is wrong and it is worth
settling before that check is treated as meaningful.

## Handoff 3, step 2 — the catalogue loop

### The importer is a fence, not a validator

CLAUDE.md non-negotiable 1 says `Product` has no price field. Every other path
into that table is a typed form with no price input on it, so the rule holds by
construction. A CSV importer is the one path wide enough to break it, because
the seller brings their own column names — and a supplier's own export almost
always has a price column in it, since it was written for their accounting
system rather than for us.

So `lib/import/columns.ts` refuses by name, and the refusal is checked before
any other rule gets a chance to claim a column. "Price Description" is blocked
rather than read as a product name.

Erring wide is deliberate and the asymmetry is the argument: a false positive
costs the seller one column they map by hand, and a false negative puts a price
on a public product row, which is a migration to undo. Matching only the word
"price" would catch "Unit Price AED" and wave through "Rate", "Cost", "Landed",
"MRP", "Ex-Works" and "List" — all the same field.

`assertNoPriceEscapes` runs in the service before anything is read, because the
plan travels through a form and through a saved mapping, and both are strings a
seller could edit. It throws rather than warns; there is no partial success
worth having.

### `stockvalue` contains `kvalue`

The exception list exists because a valves directory sees "K Value", "Kv Value"
and "Flow Rate" constantly — a Kv value is a flow coefficient, and refusing it
would be refusing a spec. Written as substring matches on the squashed header,
"Stock Value" was exempted: `stockvalue`.includes(`kvalue`) is true.

That is the third time this repo has been bitten by substring matching on
squashed identifiers. Handoff 2 fixed it in the quote matcher, where `as`
matched inside `cast`. Both sides now match whole words, with the exceptions
written as consecutive token pairs.

Whole words alone were not enough for the last-resort tier either: "Internal
notes ref 4" was read as a SKU because `ref` is genuinely a word in it. A header
of four words carrying one incidental match is not that field, so the guess tier
only fires on headers of two words or fewer. A wrong column mapped to SKU is
worse than one left alone — the seller has to notice a bad guess in order to
undo it, and has to notice nothing at all to fill in a blank.

### Provenance on the row, not a timestamp

Criterion 7 gives twenty-four hours to reverse an import. Counting backwards
from `ImportRun.createdAt` would also catch anything the seller typed by hand in
the same minute, so `Product.importRunId` names the rows a run created. The run
is marked reverted rather than deleted: the record of what was imported and
undone survives the undo.

`ImportMapping` stores the plan **as applied**, blocked columns included. A
mapping reused next month has to refuse the same column again without
re-deriving why, and a mapping overridden at the last moment must not come back
different.

### The mapping a rename cannot drop

Criterion 6 asks that cloning preserves the mapping to platform fields and that
renaming keeps it. Both fall out of the storage rather than being enforced on
top of it: `Product.specValues` is keyed by platform `SpecField` id — lib/spec.ts
has always read it that way — and `SellerTemplate.fieldMappings` is keyed by the
same id. The seller's label is a *value* hanging off that key, so a rename
physically cannot drop the mapping.

A clone stores an empty mapping object rather than a copy of every label. A
clone that copies labels is a snapshot: rename a platform field later and every
seller who cloned before the rename keeps the old wording forever, with nothing
able to say the two are the same field. Typing the platform's own label back
removes the override entirely, so the field starts following the platform again.

The warning is a courtesy on top of a guarantee, and what it says matters more
than that it exists. The fear when renaming is that products already filled in
lose their values, so the sentence names how many products are affected and says
they keep them. "Are you sure?" would answer nothing.

### The same client-component mistake, twice more

"Functions cannot be passed directly to Client Components" is a runtime error on
the rendered page, not a build error, so it ships. Handoff 2 hit it three times —
QuoteLineEditor, ResendButton, EnquiryComposer. This step hit it twice more in
one hour, in ImportWizard and CatalogueTable, and the shape was identical every
time: a `labels` object with members like `apply: (n) => t("...", { n })`, which
reads as data and is a function prop.

`tests/unit/client-labels.test.ts` now fails the build instead. Getting it right
took three attempts, and the two wrong ones are worth recording:

- Flagging *declarations* of function props caught nine existing files. Most were
  legitimate: a client component taking `formatValue` from another client
  component is fine, and several primitives do it. The rule is about the call
  site.
- Flagging any `=>` inside a JSX element caught six more, all false. An arrow
  inside `.map(...)` is an argument to a call that returns an array, and the
  array is what crosses.

The discrimination falls out of bracketing. Collapse every balanced paren pair,
innermost first: `specFields.map((f) => ({ id: f.id }))` loses `(f)` and
`({ id: f.id })`, then loses the `( => )` they leave behind, and ends as
`specFields.map` with no arrow in it. `labels={{ apply: (n) => t("x") }}` has no
enclosing call, so it survives as `{ apply:  => t }` and the arrow is still
there. Server action props are exempt by name.

The test was checked against the real bug by reintroducing it, which failed, and
then removing it again.

### Storage is not a migration

`storage.*` belongs to Supabase, and CI runs a plain Postgres with no storage
schema at all. A migration creating buckets would fail every build for a feature
CI cannot exercise anyway, so `pnpm storage:setup` creates them idempotently
against a real project.

Two buckets, and the split is the point. Photographs are on a public storefront
and are meant to be seen; trade licences are documents a supplier handed us to
be verified, and nothing about that implies consent to publish them. A single
bucket with per-object rules would make the private case the exception, and the
exception is the one that must not fail.

Bytes go from the browser straight to Storage with a signed URL issued per
object, after the server has checked the seller owns the path and has a
photograph left on their plan. An eight-megabyte photograph posted through a
server action is eight megabytes of base64 in a request body, twenty times over
for a supplier uploading a gallery. There is no bucket-wide write policy to get
wrong. `recordMedia` re-checks that the path starts with the seat's own business
id, which is the only check that survives a bug in the signing step.

### What CI cannot prove here

The upload path needs a real Supabase project. The `seller` e2e project covers
the mapper, the catalogue, the template and the editor, but the media library's
upload is exercised only by hand — verified in the browser with a generated PNG,
which uploaded, stored and rendered back through the public URL. The library's
read path is covered wherever the seed has media, and the seed has none.

## Handoff 3, step 3 — listing maintenance

### The narrowness is the feature

Criterion 8 is two claims, and they fail in opposite directions. A change that
should queue and does not is a listing saying something nobody checked. A change
that should publish and queues instead is a dashboard where nothing a seller
does appears — which, at 41,000 listings, is the one that kills the product.

So `MODERATED` and `INSTANT` are both written out in `lib/listing/service.ts`
rather than one being inferred from the other. A new field has to be put on a
side deliberately; defaulting by omission would default towards moderating more,
because moderating more always feels safer in the moment and only stops feeling
safe at scale. `ModeratedField` is a Postgres enum for the same reason: adding a
fourth is a migration, which makes it a product decision.

The board draws both states on one screen and that is not a layout convenience.
A seller who has only ever seen the moderated half assumes everything waits and
stops editing, so "publishes as soon as you save" sits above the fields that do.

### A pending request replaces the field, rather than sitting beside it

While a change is queued the input is gone, replaced by what was asked for and a
withdraw control. Leaving an editable box under a pending request invites a
second submission — and a second submission supersedes the first, so a seller
who does it twice has no idea which one a moderator is holding.

`requestModeratedChange` withdraws any earlier pending request for the same
field in the same transaction. Without it, two rows sit in the queue and a
moderator approves the one the seller has already replaced.

### Ramadan is a table, not a calculation

Ramadan is lunar and begins on a moon sighting announced a day or two
beforehand, so it cannot be computed to the day in advance. `RAMADAN` in
`lib/trade/hours.ts` holds the published astronomical estimates per Hijri year,
right to within a day at each end — close enough to switch a supplier's hours
automatically, not close enough to state as fact. `ramadanFor` returns null past
the table rather than extrapolating: a lunar calendar extrapolated by arithmetic
drifts, and it drifts silently.

Public holidays are handled the other way round, and deliberately. Eid moves
with the moon too and is announced by the government weeks out, so a table of
holiday *dates* would be wrong within a year. What a buyer needs to know is
whether this supplier trades on them at all, and the supplier is the authority
on that — so it is a three-way statement of practice, not a calendar.

### Free zones were seeded unpublished, so the feature had no example

`prisma/seed.mts` read `publishedAt: a.isFreeZone ? null : days(-120)`. Every
free zone in the country was therefore absent from every area list in the
product.

Handoff 3's README makes free zone a cross-cutting toggle precisely because "a
JAFZA company is in Dubai *and* in a free zone". With JAFZA unpublished the
toggle filtered an empty list, no buyer could browse it, and the one seeded
branch sitting in it could not be edited.

Two fixes, and the second is the one that matters:

- The seed publishes free zones. One area is held back on purpose so the
  unpublished state still has an example.
- **The picker offers published areas *plus* any the business already sits in.**
  An area can legitimately be unpublished while the taxonomy is checked, and a
  branch assigned to one would then have no matching option in the select — the
  seller opens the branch, saves an unrelated field, and the area silently
  becomes whatever the select fell back to. Losing a supplier's address by
  editing their phone number is the kind of bug nobody reports, because nobody
  sees it happen.

### The emirate comes from the area

`saveLocation` reads the emirate off the chosen `Area` rather than from the
form. Two independent fields that must agree is two fields that eventually will
not, and the disagreement shows up as a Sharjah supplier filed under Dubai.

### An integration test ate the seed

`saveHours` with `locationId: "all"` is a real feature and the tests exercise it,
which means they overwrite every branch of a seeded business. Left alone, the
next person to open `/dashboard/hours` sees six branches closed every day but
Sunday and spends an hour looking for a bug in the editor.

The suite now snapshots the locations in `beforeAll` and puts them back in
`afterAll`. Restored rather than reseeded: a full reseed between suites would
make the integration tests take minutes instead of seconds.

### Two landmarks with the same name

The verification page wrapped `VerificationLadder` — a `<section aria-label>` —
inside a `Panel`, which is also a `<section>` named by its title. Both carried
"The verification ladder", so a screen reader's landmark list had two identical
entries. This is the same defect `tests/e2e/landmarks.spec.ts` guards on the
gallery, arriving on a product page where that spec does not look; the axe check
on the new route caught it. The ladder is now named by the tier, which is the
more useful of the two names anyway.

### Two `className`-less primitives, one layout bug

`Input` deliberately takes no `className`, which is right — it stops call sites
reaching into a primitive's styling. It also means a caller who needs a narrow
field has to wrap it. Left unwrapped, the open and close times in HoursEditor
filled the row and stacked, which reads as two separate questions rather than
one time range. The width lives on a wrapper div.

## Handoff 3, step 4 — account

### Criterion 9 is a claim about refusal, so it is tested against services

A screen that does not render a button passes a manual check and fails the
moment somebody posts the form directly, which is exactly what an unhappy
employee with a sales seat would do. So `tests/integration/roles.test.ts` calls
the service for every mutation the criterion names and asserts a
`PermissionError` — never a page.

`assertCan*` is the first line of each mutation rather than a check further
down, because a check further down is one some future early return can skip, and
because a guard that runs after the first query has already leaked whether a
record exists.

Three capabilities were added rather than reusing `billing.manage`:
`plan.change`, `placement.purchase` and `analytics.read`. Reading an invoice and
moving the business onto a different plan are different-sized acts even where
the same two seats hold both today, and criterion 9 names them separately for
the same reason. `analytics.read` excludes the sales seat: the per-person
response stats on board 7d include the uncomfortable one, and a seat being
measured is not the seat that should choose what the measurement says.

### Proration is integer arithmetic, and floors in the seller's favour

Money is whole fils, the same rule `lib/quote/money.ts` follows. A proration is
a division, and a division in floats produces 349.00000000004 often enough to
matter on an invoice a supplier keeps for their accountant.

Both roundings go the seller's way on purpose. Days remaining are floored, so a
part-day is not charged as a whole one. The daily rate is floored, so 349 over
30 days is 1163 fils rather than 1164. Neither direction is neutral and the one
that favours us is the one a supplier notices.

The renewal date does not move. A change on the 12th swaps what is being paid
for over the days that were left; it does not restart the month.

A downgrade produces a credit, and the credit lands on the next invoice rather
than being paid out — CLAUDE.md is explicit that this platform holds no funds
and refunds none, and `subscription_credit` already existed as an
`InvoiceLineKind` for exactly this.

### The charge happens before the switch, outside the transaction

A provider that is slow must not hold a database transaction open, and a
provider that fails must not leave a seller on a plan they were never charged
for. So the charge is first, and the entitlement change and the invoice follow
it in one transaction only on success.

`consoleProvider.live` is `false` and the billing screen reads it, saying "no
card has been charged" rather than rendering a receipt for a payment that did
not happen. A stub that pretends to succeed silently is how a staging
environment convinces somebody the billing works.

### Cancel is the screen a seller is most anxious about

What is kept comes first and is the longer list, because everything the anxiety
is about is in it: the catalogue is hidden rather than deleted, the reviews are
untouched, the badge stays, and none of it happens on the day they click.

Products drop to `draft` at period end — the same state the CSV importer uses,
for the same reason. The verification tier is deliberately untouched: it records
what we checked, and cancelling a subscription does not un-check it.

No retention offer, which board 11f says deliberately. A discount offered at the
moment somebody leaves buys a month and costs the only honest signal we get
about whether the product is worth it. The e2e asserts the absence.

### The seed stamped a reply that nobody had sent

`seedReplyHistory` wrote `EnquiryRecipient.firstReplyAt` directly. In production
that column is set *by* a message or a quote — see `lib/messaging/service.ts` —
so the seed had 72 recipients claiming a reply and **zero messages from a seller
seat**.

Nothing had noticed, because the business-level median reads the timestamp and
the timestamp was real-shaped. Board 7d reads the *message*, because a median
needs to belong to somebody, and every seat rendered "not enough replies yet"
underneath a business median of 32 minutes.

The seed now creates the message alongside the timestamp, alternating between
the seats so the owner is measurably slower on some accounts. That is the
uncomfortable number the board asks for, and it is not one worth faking in only
one direction.

### A line that is arithmetically certain is not a finding

"The owner is often the slowest to reply" rendered whenever the owner topped the
list — including when they were the only measured person, where it is true by
construction. It now needs at least two measured people, because with one the
sentence dresses a certainty as an observation.

### Postgres does not stop you joining a queue twice

`@@unique([businessId, categoryId, emirate])` does not constrain the rows where
`emirate IS NULL`, because two NULLs are distinct in a unique index. The
national slot — the only kind the screen sells today — was therefore joinable
twice. A partial unique index `WHERE emirate IS NULL` closes it.

Prisma's generated `where` for that composite cannot express a null either, so
`takeSlot` does find-then-create rather than upsert. A race there loses to the
database, which is the correct place to lose it.

### A schema edit that did not apply

The `Subscription` columns went into the migration and not into
`schema.prisma` — a string replacement whose anchor did not match, which
`prisma validate` and `migrate deploy` both accept because the migration is raw
SQL and does not consult the model. The drift surfaced as a type error on the
first query that used `endsAt`. Worth knowing that neither of those commands
catches this shape of mistake; only the compiler did.

### A test pinned to a temporary state

`dashboard.spec.ts` asserted that Analytics was named-but-not-linked, which was
true while it was unbuilt. Step 4 built it and the test failed. That is the
right failure — but only if it is read as one, so the test now points at Setup,
which is still unbuilt, and additionally asserts that Analytics *is* a link.
Both halves of the rule, rather than whichever half happens to be observable.

### The component inventory is complete

`HoursEditor`, `EmirateAreaPicker` and `PlanCard` bring tier 4 to fifteen, and
the gallery says 15/15. The count still does not reconcile with
`docs/design-system.md`, which says tier 4 is 14 and the four tiers make 64 —
this makes 65. Criterion 12 counts to 64, so that document and handoff 3's
README disagree and one of them is wrong.

## Handoff 3, step 5 — onboarding and setup

### The listing goes live one step before the plan screen

Criterion 3 is a single call in a single place: `goLive` at the end of board 2d,
not at the end of the funnel. Everything after that point happens to a listing
that is already on the directory, so a supplier who closes the tab at the
pricing table is listed, findable, and receiving enquiries up to the Free cap.

The plan screen then opens with the address of the live listing, because a
pricing table shown to somebody who believes they are still blocked reads as a
paywall however carefully it is worded. "Stay on Free" is a button rather than a
link in small type, for the same reason.

`goLive` is idempotent and also publishes the locations. A listing that is
"live" with every branch unpublished is a listing with no address a buyer can
see, which is not live in any sense that matters.

### A claim attaches; it does not migrate

Criterion 2 — "claiming preserves existing reviews and any historical
enquiries" — reads like something that could not go wrong, right up until
somebody implements claiming as create-then-migrate rather than attach. Then it
goes wrong silently, and the supplier whose fourteen reviews vanished is the one
who tells us.

It holds by construction here: a claim writes one `ClaimSubmission` row and
attaches the user to a business that already exists. Nothing that hangs off the
business is touched, and the integration test asserts the full before/after
shape rather than spot-checking two counts.

The screen says it with a number — "14 reviews and 38 enquiries stay exactly as
they are" — rather than a reassurance. "Your data is safe" is what a product
says whether or not it is true.

### A contested claim is taken, not refused

If a former employee or an agency claimed the listing, the second person is
often the real owner. Closing the door in front of them is the wrong side to be
wrong on, so the submission is recorded with `contested: true` and staff see
both. Nothing about `claimStatus` moves either way; handoff 4 decides.

The seat, though, is attached immediately. Criterion 1 asks that a supplier
reaches a dashboard without staff involvement — making them wait for a human
before they can fill anything in would fail it, and a rejected claim is detached
by the queue that rejects it.

### The phone route calls a number the claimant cannot choose

Anybody can answer their own phone. The check only means something because the
number comes from the public licence record, so board 2b offers *that* number
and there is no field to type one into. The e2e asserts the absence of the
field, not just the presence of the sentence.

### Setup completion is derived, never flagged

Criterion 4 wants four tasks that are independent and resumable after logout.
There is no `taskCompleted` column and there should not be: a flag can be set by
something other than the work, goes stale when a seller deletes the photographs
afterwards, and would give no credit to a seller who added products from the
catalogue screen instead of from the task.

`setupStateFor` counts rows. "Resumable after logout" then needs no
implementation at all, which is the test: two reads with nothing between them
give the same answer because nothing is held in a session.

`TASK_POINTS` reads from `WEIGHTS` rather than restating the numbers. Board 8a
publishes what each task is worth and the meter shows the result; two copies
that drifted would be a promise the product breaks in front of the person it
made it to. The visit is worth zero and the hub says so — it moves trust, not
strength, and implying otherwise would be selling a number the task does not
touch.

### ON DELETE SET NULL against a CHECK that requires the column

`claim_submission.document_id` was `ON DELETE SET NULL`, and the check
constraint requires a licence claim to carry its document. Deleting the document
therefore produced a row violating its own constraint — and the error came back
as a confusing complaint about the claim rather than a clear one about the
document.

`ON DELETE RESTRICT` is right: a licence claim without its licence is not a
claim, so deleting the evidence is refused while the claim is open. Worth
remembering that a `SET NULL` foreign key and a `NOT NULL`-ish check on the same
column are a contradiction the database will only mention at the worst moment.

### The onboarding layout had no landmarks

Written bare rather than through `DashboardShell` or `PublicShell`, so it
inherited neither's `<main>`. Every step failed `landmark-one-main` and put all
its content outside any landmark — on the first screen a supplier ever sees. The
axe check on the new routes caught it; nothing else would have.

### A test with an expiry date, twice

`dashboard.spec.ts` asserted that a named-but-unlinked route was named and
unlinked. It picked Analytics; step 4 built it. It was changed to Setup; step 5
built that. Each step builds one more, so any test naming *which* route is
deferred has an expiry date — and when it goes off, the failure looks like a
regression rather than like progress.

It now reads `DASHBOARD_NAV` and asserts both halves of the rule for every item:
deferred ones named and not linked, built ones linked. There are no deferred
seller items left, and the test asserting nothing on that side is the honest
answer rather than a gap.

Two smaller things fell out of writing it. A group heading carries the same word
as one of its items — "Overview" is both — so text matching has to be scoped to
the list rows. And an item with a badge has the count in its accessible name,
so "Leads & RFQ" is never an exact match for the link whose name is
"Leads & RFQ 13"; the assertion anchors at the start of the label instead.

## The canvas arrived — what the inferred matrix had wrong

`docs/permissions.md` and `docs/component-inventory.md` are now in the repo, and
`lib/auth/capabilities.ts` is transcribed from the first rather than inferred.
The file that shipped before it carried a warning to diff it against §07 before
handoff 1. That never happened, and by handoff 3 it was wrong in nine rows.

They were not all wrong in the safe direction:

**Over-granted** — a seat could do something the design does not allow:

- `plan.change` was owner + finance; §07 gives it to the owner alone. A finance
  seat reads what was spent and does not decide what the business buys.
- `visit.request` was folded into `listing.edit`, handing it to a manager. It is
  the owner's alone: somebody from this platform coming to the premises is not a
  manager's call.
- `review.remove` was moderator + ops lead; §07 holds it at ops lead. A
  moderator approves and rejects submissions and resolves reports, and does not
  remove a buyer's published words.
- `placement.boost` was finance + ops lead on the theory that a sold slot
  belongs to finance. Moving a listing up a results page is a ranking decision.
- `subscription.credit` and `revenue.read` both carried ops lead as well as
  finance.

**Under-granted** — a seat could not do its job:

- `team.manage` was owner-only. A manager who cannot add the person who answers
  enquiries has to ask the owner every time.
- Lead routing had no capability at all and rode on `team.manage`, so it was
  withheld from the manager too. It is now `routing.manage`.
- `analytics.read` included finance and excluded sales. §07 has it the other way
  round: sales sees their own leads, finance does not have the row.
- `enquiry.create` was buyer-only. §07's cross-surface table is ✓ for buyer *and*
  seller — a supplier buying from another supplier is ordinary trade.

Three of the over-grants shared one assumption: that the most senior role can do
everything. `can.test.ts` asserted it outright — "gives ops_lead every audited
capability" — and §07 denies it. Two rows are finance's alone, and the
separation is the point: the role that can suspend an account and change a
verification tier is not the role that can move money.

`tests/unit/permission-matrix.test.ts` now transcribes both tables and asserts
them row by row, thirty-seven tests. A comment asking somebody to check is not a
check.

### Three rows a role cannot answer

permissions.md: *"Role is an input, never the check itself — three of the rows
above are subject-dependent and a role-only check gets them wrong."*

Each fails **open**, which is why they are in `lib/auth/subject.ts` rather than
in the matrix:

- A field verifier may set a tier **for a visit they recorded**. Role-only, that
  is a field verifier who may set any tier on any business — the row CLAUDE.md
  calls a non-negotiable. Missing information denies: no visit, or somebody
  else's, is a no.
- A sales seat scoped to a branch is limited to that branch's enquiries and
  locations. Role-only, the scoping does nothing at all. An enquiry routed to no
  branch stays visible — it was not routed *away* from them, and hiding it loses
  the enquiry rather than scoping it.
- "See another business's enquiries" is granted to two staff roles **as an
  audit-only action**. Role-only, the grant survives and the audit row does not,
  which is exactly the silent version §07 says must be impossible. The reason is
  required by the *signature*: a caller with nothing to write cannot form the
  argument.

Two of these return a scope rather than a boolean — `analyticsScopeFor` and
`auditScopeFor` — because a caller given a yes would have invented the narrowing
itself, then invented it differently on the second screen.

The bare guards for those rows were **removed** from `guards.ts`. A function
named the obvious thing and taking only an actor is the mistake the subject
check exists to prevent, so it is not offered, and the compiler forced every
call site to the fuller version.

### The dispatch row

Board 7d carried "Dispatch orders & upload PODs" from before the e-commerce
pivot, deleted rather than renamed because there is no order entity. The
inferred matrix never had it, but a test now refuses any capability whose name
or rationale mentions dispatch, fulfilment, shipment or proof of delivery —
deleting a row is only durable if something stops it coming back under a
friendlier name.

### The count reconciles

Tier 1 is 18, tier 2 is 17, tier 3 is 16 with `Alert`, tier 4 is 14. Sixty-five.

The discrepancy was a category error on my side: the inventory counts
*components*, and `ListingCard` is one component with a `context` prop while
`Button` is one with five variants and four sizes. A file count runs higher and
always will.

`Thread` — board 11c, built in handoff 2 — has no row in the inventory at all.
It is shown in the gallery under its own heading rather than counted, because a
component the design system has not described is worth surfacing rather than
folding into a tier to make a total come out right.

### Alert, and the twenty-one copies it replaced

Component 65, the §05.1 inline notice. The repo had grown twenty-one hand-rolled
versions of the same four classes and a `role="alert"`, each copied from the
last screen, so nothing governed how a validation message looked or how it
announced itself — on one of the highest-traffic surfaces in the product.

Five tones, one optional action, **no icon**: an icon on a notice is a second
channel saying the same thing to people who can already read the sentence, and
nothing to the ones who cannot.

The inventory's one stated rule — a notice describing a problem must carry the
action that fixes it — is enforced rather than reviewed: a `warn` or `bad` Alert
with neither `action` nor `fix` logs an error in development. It caught two real
ones immediately. `/dashboard/products` named a number of products missing
filterable specs and offered nowhere to fix them; `/dashboard/verification` said
a licence had expired and stopped there.

### Eight client components very nearly became server components

The codemod that added the `Alert` import put it **above** `"use client"` in
eight files. A directive prologue only counts before the first statement, so all
eight silently stopped being client components — and tsc, eslint and the type
checker all stayed quiet, because nothing in the toolchain looks at line order.

`tests/unit/client-labels.test.ts` now fails on any file with code above the
directive, verified by reintroducing it.

## Handoff 3, step 6 — the acceptance pass

`pnpm acceptance:3` walks the twelve criteria and prints one line each. Twenty-
eight checks, because most criteria have halves that fail independently: a
service-layer proof and a browser proof are different claims, and a criterion
green on one and red on the other is worth seeing as two lines rather than one.

Needs the app built and served on `:3000` with the seed loaded.

### Criterion numbers collide across handoffs

Handoff 2 has a `criterion 1` and so does handoff 3. Handoff 2's walk selected
tests by title alone, which was safe while only one handoff had numbered its
tests; with two it silently widens — `-t "criterion 1"` now matches the enquiry
fan-out tests as well as the onboarding ones, and a criterion would report a
pass earned partly by another handoff's work.

So this walk selects by **file** first and narrows by title inside it. The two
guards from handoff 2's pass are kept: a filter matching nothing fails rather
than exiting zero, and the mobile project is in the run.

### What criterion 12 actually counts

The README says 64. `docs/component-inventory.md` says 65, because `Alert` was
approved as component 65 after the README was written. The walk checks 65 and
says why on the line beneath, rather than checking a number that was correct
when it was written and is not now.

The gallery reads 18/18, 17/17, 16/16, 14/14. `Thread` is built, has no row in
the inventory, and is shown under its own heading rather than counted.

### The count the walk could not read

The gallery check failed on its first run, and the gallery was fine. React puts
a comment marker between two adjacent expressions, so `{TIER_1.length}/18`
serves as `18<!-- -->/18` and a grep for `18/18` finds nothing. The same page
then carries the RSC flight payload, which repeats the shape, so matching the
whole document finds each tier twice.

Both are the same class of mistake as the ones the earlier walks made: a check
that reads a rendered artefact has to be written against what is actually
served, not against what the source looks like.

## Thread is component 66

Given a row in `docs/component-inventory.md`, moved out of the gallery's
"unlisted" heading into tier 4, and the totals updated everywhere they are
stated: tier 4 is 15, and the four tiers make 66.

`UNLISTED` is kept in the gallery as an empty array rather than deleted. A
component the design system has not described is worth surfacing, and the next
one wants somewhere to go that is not a guess about which tier it belongs to.

### The acceptance walk was running seller tests without a session

Adding one row to the inventory turned criterion 10's browser half red, and the
component count had nothing to do with it.

`playwright test --project=seller -g "board 11f"` applies the grep to **every**
project in the run, `setup` included. `auth.setup.ts`'s tests are called "sign
in as a seller on Pro" and "on Free", so a filtered run matches neither, the
setup project executes nothing, and no fresh storage state is written. The
seller specs then go out with whatever session happens to be on disk.

While that session is fresh it works, which is why the first two runs of the
walk were green. Once it is stale, every seller route reaches
`requireSellerSeat()` → `notFound()`, and the failure surfaces as **an axe
violation about a missing main landmark** — a report about accessibility, on a
page the test never meant to be looking at, caused by authentication.

The walk now mints both sessions once, unfiltered, before anything else, and
every filtered run passes `--no-deps`. Verified by deleting
`tests/e2e/.auth/*.json` and running the whole walk from nothing: 29 for 29.

Worth stating plainly, because it is the second time a Playwright dependency
has behaved differently under a filter than without one: **a `-g` filter is not
scoped to the project you named.**

### And the 404 had no landmarks

The symptom was misleading; the defect it named was real. Next's default 404
has no `<main>`, so every not-found in the app failed `landmark-one-main` —
including the one a signed-out visitor reaches by typing a dashboard URL, which
is the most likely way anybody meets it.

`app/not-found.tsx` now has a main landmark and copy naming all three reasons a
page might not be there. The most common of them is "you are not signed in",
which is exactly what a bare "page not found" misleads somebody about.

---

## Handoff 4, step 0 — the console frame

### Service levels are ours, not the design system's

Board 4a says queues show "age and SLA breach before volume" and names no numbers,
so `lib/console/overview.ts` sets them: moderation 2 days, claims 3, supplier
reports 5, site visits 14, failed payments 14.

They are set against what the delay costs somebody outside the building rather
than against how hard the work is. A contested claim is the most expensive
because buyers are enquiring on a listing whose owner is undecided; a supplier
report next; a taxonomy edit least. Dunning is 14 because D14 is when the plan
drops, so the deadline is already fixed by the sequence.

The numbers are stated on the screen that uses them. A queue with no published
deadline is a queue nobody can be behind on, and "behind" is the whole question
board 4a exists to answer.

### A metric with no table returns null, not zero

Licence records staged, storefront templates and the CRM call list have no table
until steps 2, 6 and 4. Each returns `null` and renders as "not measurable yet".

Zero on a queue means the work is done. On a queue that does not exist it is the
one lie a console must never tell, and it is an easy one to tell by accident:
`count()` over a table that is empty because nothing writes to it returns 0 quite
happily.

### The console overview links only to routes that exist

Every number on 4a is meant to be a link into the queue that fixes it. Most of
those queues are `later` in `ADMIN_NAV`, so the page reads that flag and renders
those metrics as plain text with the same "soon" mark the sidebar uses.

Nothing needs editing when a step lands — dropping `later` from a nav row turns
its number into a link on its own. This is the rule handoff 1 arrived at after
the seller sidebar shipped a dozen dead links, applied before the same thing
could happen here.

### Three invented badge counts, removed

`ADMIN_NAV` carried `badge: 34` on the approval queue, `3` on reports and `5` on
dunning. They were placeholders from before there was anything to count, and the
seed's real pending count is 3.

Same shape of invention as the seed's `responseTimeMedianMs` and
`profileStrength`, both caught in earlier handoffs — and this one sat on the
screen whose entire job is saying what is behind. Counts now come from
`getAdminNavBadges`, and a count nobody may act on is not loaded at all: a
moderator has no `revenue.read`, and a badge on a row they cannot open is
telling them about somebody else's backlog.

### Two audit writers existed, and load order decided which one won

A real defect, found while wiring the first admin service.

`lib/audit/prisma-writer.ts` honours the transaction handle `staffMutation`
passes it and registers itself on import. `lib/db/writers.ts` held a **second**
implementation that ignored that argument and read the transaction from an
`AsyncLocalStorage` set by `runInAuditedTransaction` — a function nothing in the
repo ever called. `instrumentation.ts` installed the second at process start,
and the first module to import `prisma-writer` replaced it.

So whether an audit row joined the transaction of the mutation it records —
which is the guarantee `staffMutation`'s own doc comment makes — depended on
module load order. `lib/db/writers.ts` is now a one-line import of the single
implementation.

### `staffMutation` refuses a subject-dependent capability without its subject check

`assertCan` is a role-array membership test. For `business.verification_tier.write`
a role test passes for **every** field verifier, including one setting a tier on
a business they have never visited — the exact grant `docs/permissions.md` calls
"not a general grant", and the thing CLAUDE.md's second non-negotiable exists to
prevent.

The old contract let that call compile, run, and write a tidy audit row saying it
was fine. `staffMutation` now throws `SubjectCheckRequiredError` unless the
caller passes `subjectChecked: true`, which it may only do after calling the
matching assert in `lib/auth/subject.ts`. Passing the flag where it is not needed
is also an error: a flag that can be set anywhere is a flag that means nothing.

### No development staff seat

`lib/auth/dev-seller.ts` exists because a seller dashboard is unusable without a
business, and it is inert in production. There is deliberately no equivalent for
staff. It would be a way to become an ops lead by setting an environment
variable, and the blast radius is every audited capability in the matrix.

The browser tests sign in properly instead, through the same OTP path a person
uses — two staff seats, and the moderator one exists to prove a negative that an
ops lead's session cannot.

### The admin layout does not guard

`app/(admin)/layout.tsx` returns its children and nothing else. Next runs a
layout for every matching route, but a layout cannot stop a page's own data
fetching from running — the two render concurrently. A guard there would look
like protection and provide none. Every page calls `requireStaff()` itself.

A missing staff role is a 404 rather than a 403, so a guessed URL does not
confirm the URL exists.

---

## Handoff 4, step 1 — the queue

### One conflict row, not two flags

Handoff 3 set `ClaimSubmission.contested` when a second person claimed a listing
somebody already held. It is a write-once derived boolean that links nothing, so
noticing that two submissions were a *pair* was left to whoever read the queue
carefully.

`ClaimConflict` is the pair, opened by `submitClaim` the moment a second
undecided claim lands. A partial unique index allows one open conflict per
business, which is what stops two staff settling the same dispute in opposite
directions.

### The four outcomes needed their own enum

`ClaimStatus` is `unclaimed | claimed | disputed` and describes the *listing*. It
cannot describe what staff decided, and two of board 4c's four outcomes create or
restructure businesses — so `ClaimConflict` records the resolution and what it
produced. Without that, the audit row says "claim_resolved" and nothing about
which way, which is unreadable a year later.

`buyersWaiting` is stored rather than recomputed. It is board 4c's argument for
deciding today, and it is only true at the moment somebody looked.

### One decision, one audit row

Settling a conflict decides two submissions. It is still one decision, so it
writes one `claim_resolved` row whose subject is the conflict rather than either
submission.

The step-0 test asserted an audit row per decided claim, which was right when a
claim could only be decided on its own and wrong the moment the resolution
existed. Corrected to the real invariant: one row per resolved conflict.

### Service levels, and why an age is never negative

The queue bands by service level rather than sorting by it — late rows first,
each band in age order. Sorting purely by age buries a five-day-old claim under
a three-day-old edit that is not late at all.

`ageInDays` clamps at zero. The seed anchors its clock to the start of the Dubai
day, so a row it stamps "five hours ago" can sit slightly ahead of a reader whose
clock is real, and `-1d waiting` makes the whole column look broken.

### Approving applies the change, and writes the 301

A queue row is a request, not a record of something that already happened. An
approval that sets `status = approved` and stops leaves a seller reading that
their new trade name was approved on a listing that still shows the old one —
and that failure looks exactly like success from the console.

A trade-name change moves the slug, and `docs/routes.md` says slugs are immutable
once published and a rename creates a 301 automatically. The redirect is written
in the same transaction rather than left to whoever remembers.

Two refusals worth having: a rename onto an address another listing holds, and a
**stale** request whose before-value no longer matches the listing. The second
prevents an approval overwriting a change nobody reviewed.

### The spec grace period is a date, not a flag

Criterion 4 needs a new required field not to invalidate the products already
filed against a template. So `required` stops being a boolean at a point in time:
`SpecField.requiredFrom` is the date it starts applying, null meaning "from the
beginning". Read together — required now if `required` and (`requiredFrom` is
null or past).

`SpecTemplate` already carries `version` and `status` with a unique
`(categoryId, version)`, so a new version is a new row. The roadmap proposed a
separate `SpecTemplateVersion`; the existing shape is better and is what step 1
uses.

### A `::before` on a `<tr>` added a column to every table in the product

The row tone edge was a pseudo-element on the `<tr>`. The CSS table fixup rules
wrap a non-cell child of a table-row in an **anonymous table-cell**, and
`position: absolute` does not prevent the box being generated — so every
six-column `DataTable` was laid out as seven, with the body sitting one column
right of its own headers.

It shipped in handoff 0 and was found in handoff 4 step 1, by which point every
table in the seller dashboard and the console had it. Nobody caught it by eye:
the column heads are small mono uppercase and the misalignment reads as loose
placement rather than a broken table. Measuring is the only way to see it, so
`tests/e2e/gallery.spec.ts` now measures — the test was confirmed to fail against
the old markup before the fix landed.

The edge now rides the row's first cell.
