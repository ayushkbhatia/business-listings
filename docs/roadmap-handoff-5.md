# Handoff 5 — SEO layer & content operations: roadmap

The acquisition engine. Everything before this handoff makes the product work; this one makes
buyers arrive.

Source: `handoffs/handoff-5-seo-content/README.md` and `KICKOFF.md`. Eight route families,
twelve acceptance criteria, no new components claimed.

Written against an audit of the repo at `c57daf4`, not against what the handoff assumes.
Where the two disagree, §1 says so.

---

## 1. What is already here

The handoff says it depends on handoffs 0–4. It does, and more of its machinery is already
standing than the README implies. Six things exist and are waiting for a caller.

- **`lib/publish-threshold.ts`** — the 60 listings / 30% verified / 250 intro words guard,
  written in handoff 1 as a pure function. `app/sitemap.ts` and `lib/content/matrix.ts`
  consult it. No landing-page row calls it yet, because no landing-page row exists. This is
  criterion 1, and it is the one thing in the handoff that cannot be retrofitted.
- **`/c/:category` and `/c/:category/:sub`** exist with `BreadcrumbList` JSON-LD and a
  `Category.intro` paragraph. Step 2 adds the SEO layer to routes that already render.
- **`/search` and `/compare` already carry `robots: { index: false }`** — half of criterion 6
  landed in handoff 1.
- **`Redirect`** is modelled with `fromPath` unique and a documented rule that deleting a
  published page without one is blocked. `lib/content/redirects.ts` writes rows from the admin
  screen. Nothing writes one automatically on a category rename. That is criterion 7's gap.
- **`ZeroResultQuery`** is written by `lib/db/queries/search.ts` and read by
  `lib/console/overview.ts` and the CRM call list. The alert half of criterion 8 does not
  exist: `SavedSearch.alerts` is a boolean nothing fires on.
- **`/admin/content/matrix`** is criterion 12's comparison target, and it currently governs
  categories only.

### 1.1 Where the handoff and the schema disagree

**`Area.publishedAt` is area-level; area landing pages are area×category.** The column carries
this comment, from handoff 0:

> Landing pages publish only above the board 6f thresholds. Enforced in the service layer, and
> unpublished automatically when supply drops below them.

One timestamp per area cannot express "HVAC in Al Quoz publishes, valves in Al Quoz does not",
and criterion 1 is stated per page. Step 3 adds an `AreaPage` row keyed `(areaId, categoryId)`
carrying its own `intro` and `publishedAt`. `Area.publishedAt` stays as the area-level gate —
whether `/dubai/al-quoz` itself is worth a page at all — and the two are read together.

Recorded here rather than discovered in step 3.

---

## 2. Decisions taken without asking

Reversible cheaply if wrong, and cheaper to state than to discover.

- **Guides are not threshold-governed pages.** `evaluatePublish` takes listings and verified
  share; a guide about payment terms has neither. Guides get their own gate, which reuses
  `DEFAULT_THRESHOLDS.minIntroWords` rather than inventing a second number — one 250 in the
  codebase, not two. A guide under 250 words of body cannot publish.
- **Guides carry their own block vocabulary**, not `lib/storefront/blocks.ts`. That one has a
  `certifications` kind reading a seller's documents and a `cta` hardwired to a seller's
  catalogue, and it is edited by staff per storefront template. Coupling the directory's
  editorial content to it means a template edit changes an article. Same shape
  (`{id, kind, values}`), same drop-the-unknown discipline, different kinds.
- **Guide mutations go through `taxonomy.write`.** Every content-ops mutation in handoff 4 —
  homepage curation, redirects, notification templates — went through it. A new
  `content.write` capability would be a fourth name for the same seat.
- **Criterion 12 compares the matrix to generated landing pages, not to every URL.** The
  README asks for "index plus per-type sitemaps"; guides are authored, not generated, and the
  matrix's three gates do not apply to them. The landing-page sitemap matches the matrix
  exactly; guides get their own segment. Asserted in step 6, not assumed.

## 3. Still to settle

- **The 22 guide topics.** The README names four themes — verification, quoting, payment
  terms, getting a supplier to turn up. Step 1 ships the machinery and one real article; the
  other 21 are content, and per `CLAUDE.md` content belongs in the admin screen, not in a
  commit. The admin editor is in step 1 for that reason.
- **FAQ answers grounded in platform data (criterion 3).** "AMCs in Al Quoz run
  AED 6,000–22,000" needs a quoted-value aggregate across `QuoteLine`. The lines are private
  to one buyer and one seller — non-negotiable 1. An aggregate over enough of them is not a
  price on a public surface, but the floor for "enough" is a decision. Step 3.

---

## 4. The steps

Each is one PR. Criterion coverage is stated per step so nothing goes unscheduled — handoff 4
lost board `12c` that way and only the acceptance pass caught it.

| # | PR | Criteria |
|---|---|---|
| 1 | Guides: model, admin editor, `/guides`, `/guides/:slug`, `Article` + `BreadcrumbList` | 11 (part) |
| 2 | Category index `/categories`, subcategory SEO layer | 2 (part), 11 |
| 3 | Area landing pages, `AreaPage` model, FAQ from platform data | 1, 2, 3 |
| 4 | Curated lists `/best/:slug`, selection criteria published and enforced | 4 |
| 5 | Campaign `/lp/:campaign` with UTM to enquiry, four legal pages | 9 |
| 6 | Technical layer: per-type sitemaps, `Product` without price, canonicals, 301s on rename, zero-result alerts | 5, 6, 7, 8, 12 |
| 7 | Acceptance walk, Lighthouse and axe over the three template types | 10, 11, 12 |

Criterion 10 (Core Web Vitals, Lighthouse SEO ≥ 95) is measured in step 7 but designed for
throughout: server-rendered, no client fetch on first paint, images lazy below the fold.

---

## 5. Step 1 — guides

**Checkpoint: one guide with `Article` structured data and a working directory CTA.**

Nothing of this exists. No `Guide` model, no `/guides`, no `/guides/:slug`.

- `Guide` model and migration. Slug unique, and frozen once published — the rule
  `Redirect` already states, applied at the service layer.
- `lib/guides/blocks.ts` — the vocabulary: `heading`, `text`, `list`, `steps`, `callout`,
  `cta`. Unknown kinds dropped, not thrown on.
- `lib/guides/service.ts` — publish, unpublish, edit, delete, all through `staffMutation`
  with a written reason. Publish refuses below the word floor and names the number.
- `/admin/content/guides` and `/admin/content/guides/:id`, in the content nav group beside
  homepage curation and redirects.
- `/guides` index and `/guides/:slug` article, server-rendered.
- `Article` and `BreadcrumbList` JSON-LD through the existing `JsonLd` escape.
- The directory CTA: every guide ends in the directory, and the link resolves to a real
  category or search that returns results.
- One seeded guide, so the checkpoint is demonstrable from `pnpm db:seed`.
- Unit tests on the block reader and the publish gate; an integration test on the service;
  a Playwright pass over both routes.

### What step 1 deliberately does not do

- **No related-guides block beyond a flat list.** Ranking what to read next wants more than
  one guide to be worth anything.
- **No author entity.** A byline is a string until somebody asks for author pages.
- **No per-type sitemap split.** The guides go into the existing single sitemap — six lines,
  and a published page absent from it for a whole handoff is worse than writing those six
  lines twice. Step 6 splits the file by type.

### §2 amended during step 1

The decision that guides would wait for step 6 to appear in the sitemap did not survive
contact with the fact that it is six lines. They are in `app/sitemap.ts` now, gated on
`publishedAt` and nothing else — `publishGuide` is the only path that sets it, so a row with
one has already cleared the word floor.

---

## 5a. Step 2 — the category index and the subcategory SEO layer

**Checkpoint: add a subcategory in the database and show the page appearing.**

- `/categories` — board 6c. Every sector, its subcategories, live counts.
- `lib/seo/facts.ts` — the numbers a landing page is built from. Area pages in step 3 call
  the same function with an `areaId`.
- `lib/seo/faq.ts` — criterion 3's FAQ, assembled from those numbers. Brought forward from
  step 3 because the README asks the subcategory template for "the same FAQ pattern", and
  building it twice was the alternative.
- `lib/seo/taxonomy.ts` — the three gates, computed once, read by the index, by the
  subcategory route's `robots`, and by `app/sitemap.ts`.
- Emirate breakdown, spec chips, FAQ and sibling cross-links on `/c/:category/:sub`, plus
  `noindex` while a page is below the floors.

### Four defects this step found in `main`

- **The page matrix and the taxonomy screen counted verified from tier 1.** Every public
  surface counts tier 2 — "trade licence checked against the issuing authority" — so a
  category could read "publishes" on board 6f and still be held out of the sitemap by the
  same gate computed with the stricter number. That is criterion 12's failure mode exactly.
  One `VERIFIED_TIER` now, in `lib/verification.ts`.
- **`app/sitemap.ts` hardcoded `introWords: 250`**, with a comment saying intro copy was a
  handoff 5 field. Handoff 4 added `Category.intro` and the matrix has counted its words
  since, so the copy gate passed vacuously in the sitemap while the admin screen applied it.
  Both now call `categoryIndex()`.
- **The RFQ fan-out matched `primaryCategoryId` exactly.** Search has covered a category and
  its children since handoff 1; the fan-out did not, so an enquiry sent to a sector reached
  none of the suppliers filed under its subcategories. Invisible until the seed had any.
- **A subcategory could not see its trade's specification template — in four places.**
  `getSpecFacets` rendered no filter chips and an empty rail; `getSpecTemplate` left the
  public spec table blank; `getSpecFieldOptions` gave the CSV mapper nothing to map onto; and
  `/dashboard/templates` told the seller there was no template. Templates belong to the trade
  and not to the niche, so all four now fall back to the parent. Filing a supplier under a
  subcategory was silently emptying their whole catalogue of specifications.

### One seed change

`prisma/seed-subcategories.mts` files a share of each sector's listings under one of its
children. Every one of the four seeded subcategories had zero listings, so board 10a rendered
blank on all of them and nothing about the step was demonstrable. Deterministic and
PRNG-free — the seed's random draw is a sequence and adding one renames every business after
it, which has cost fixtures before.


## 5b. Step 3 — area landing pages

**Checkpoint: a page blocked by the threshold, and the same page publishing once seed data
crosses it.** Both are in the seed: HVAC in Al Quoz Industrial 1 at 62 listings and 38%
verified, and Safety & PPE in Ras Al Khor Industrial 2 at 9. Both carry an intro over the
word floor, so the only thing separating them is supply.

- `AreaPage`, keyed `(areaId, categoryId)` as §1.1 said it would have to be.
- `/:emirate/:area/:category` — intro, suppliers, subcategory chips, a map, the emirate
  breakdown, the FAQ from step 2, and cross-links both ways.
- `lib/seo/area.ts` — the publish gate, the sweep, and `livePages` for the sitemap.
- Board 6a's rows on the board 6f matrix, with publish and unpublish.

### How criterion 1's second half is actually enforced

`AreaPage.publishedAt` is staff **intent**. Whether a page is live is intent AND the floors
holding *right now*, computed at read time. A stored flag alone would leave a thin page live
and indexable in the window between supply dropping and a job running — and the whole reason
board 6f exists is that a thin page in the index costs standing across the domain rather than
only its own. The route, the sitemap and the matrix all read the computed value, so they
cannot disagree; the sweep then clears the column so `publishedAt` stops lying to staff.

The sweep is **not audited**, following `runDunning`: it is the platform applying its own
published rule, there is no actor to attribute it to, and `AuditEvent.actorId` is NOT NULL
precisely so the log contains decisions. It rides on `/api/jobs/measure` beside the domain
poller, for the same reason — it writes no `Business` row, so it cannot race for `derivedAt`.

### Found on the way

- **`listing.unclaimed_body` said "Nothing has been verified by us"** on every unclaimed
  listing. Verification is platform-owned and does not need a claim, so an unclaimed listing
  can and does carry a verified licence — the badge and the notice contradicted each other on
  the same card. The notice now says what is actually true: nobody at the business has
  confirmed the details, and the badge says what we checked.
- **Six `<a>` elements pointing at internal pages.** Adding a three-segment dynamic route at
  the root made the lint rule resolve paths it had not before, and five pre-existing
  violations surfaced with it. All six are `<Link>` now.
- **`.claude/launch.json` had one dev configuration and I overwrote it** reaching for a
  production server. Both are in it now.

### Still to settle — and this one needs you

The README illustrates the FAQ with "across quotes on this platform, AMCs in Al Quoz run
AED 6,000–22,000". That is seller pricing, and `QuoteLine` is private to one buyer and one
seller by non-negotiable 1. An interquartile range over enough distinct sellers is not a price
on a public surface and is the thing no competitor can copy — but "enough" is a judgement with
a privacy consequence, and publishing it is your call rather than mine. **Not built.** The
area FAQ ships with the same non-price facts step 2 established. Say the word and it is a
small addition with a stated floor.


## 5c. Step 4 — curated lists

**Criterion 4**, which is the only one that asks for a test by name: *"A curated list displays
its selection criteria and cannot include a business that fails them; placement cannot be
bought into one — asserted by a test."*

### The rules are code, not columns

`CuratedList` carries what a list is about — a trade, optionally an area — and its editorial
framing. It does not carry its bar, and it does not carry its membership.

That is the whole design. A bar somebody can lower is a bar somebody can be sold, and every
other "best of" list in this market is sold. So `CRITERIA` and the three thresholds live in
`lib/seo/curated.ts`, the page renders them from the same constant the service applies, and
there is no per-list override to negotiate over.

Three consequences, each with a test:

1. **Membership is computed on every read.** A supplier whose median reply slips past four
   hours leaves the list with nothing run and nobody told. Removing one review drops a
   supplier on the next request.
2. **Nothing a seller buys is in the comparator.** Not `planId`, not `rankingMultiplier`, not
   `PlacementSlot`. Deliberately not `lib/search/ranking.ts` either — that one weighs plan
   tier, correctly, on a results page and never here.
3. **The table has no column that could hold a bought position.** A test reads
   `information_schema` and fails if `curated_list` ever gains `featured`, `rank`,
   `sponsored`, `position`, `placement` or `boost`. Somebody adding one has to argue for it in
   a review rather than in a migration.

### The fixture that carries the point

`al-hvac-005` is on the Pro plan, has been visited by the field team, has a verified licence
and fifteen reviews — everything the product sells. Its median reply is seven hours, measured
from enquiry timestamps, with no seller-writable field. It is not on the list, and the e2e
asserts its absence by name.

The reply times in the seed are **derived, not written**. Setting `responseTimeMedianMs`
directly would be the claim non-negotiable 6 forbids — and `deriveResponseTimes` runs after
the seed and would overwrite it anyway, which is the mechanism working. The fixture gives each
enquiry a real `firstReplyAt` and lets the median fall out.

### Found on the way

- **The breadcrumb is an ordered list and so was the members list**, both unnamed. A screen
  reader user got two anonymous lists on one page. The members list is named now.
- **`staff-refusals.test.ts` raised a verification tier to 4 and never put it back.** Its own
  comment says the database is not reset, which was harmless while the listing it borrowed
  with an unordered `findFirstOrThrow` was one nobody asserted on. Step 4 seeded visited
  listings whose slugs sort early, the query started picking one of those, and a curated list
  began reporting a supplier as "Audited" that the seed made tier 2. It restores now.


## 5d. Step 5 — campaign and legal pages

**Criterion 9**: *"campaign pages preserve UTM through to the enquiry and attribute it in
admin."* The hard word is "through to".

### Where attribution is captured, and why it moved twice

A buyer who lands on a campaign may read two guides, browse a trade and send an enquiry twenty
minutes later — by which time the query string is long gone. Threading it through every link
would be fragile, and would also put campaign tags in every URL anybody shares, which is
somebody else's attribution.

So it is a first-party cookie. Written first on the campaign page, which does not work: a page
component cannot modify cookies in the App Router, and Next says so per request rather than at
build time — the build was clean and every campaign page 500ed on the first e2e run.

It is written in `proxy.ts` now, which is better than the original plan rather than a
consolation. A tagged link points at a guide as often as at `/lp/...`, and the proxy catches
all of them.

The cookie holds three UTM values and the campaign **slug** — not its id, because the proxy
runs before any database client exists. `createEnquiry` resolves the slug, and one that no
longer matches resolves to null rather than failing the enquiry: losing attribution is a
reporting gap, losing the enquiry is a lost customer.

### Decisions worth reversing cheaply if wrong

- **First touch wins.** A buyer won by a campaign who returns through an organic search is
  still the campaign's. Last touch would credit the search engine for demand somebody else
  created. Stated in a test rather than implied.
- **Thirty days.** A marketing convention, not a discovered number, in one constant.
- **`utm_content` and `utm_term` are dropped on the way in.** Nothing reports on them, and an
  attribution column nobody reads is personal data kept for no reason.
- **Untagged is a row in the report, not an omission.** A report showing only attributed
  enquiries makes every campaign look like the whole of demand.
- **The report is counts and dates, never a buyer.** The privacy policy this step also ships
  says we do not build profiles; a marketing screen listing the people who asked for a quote
  would be one.

### Found on the way

- **A second dynamic segment at the root of the app collides with the area route.** The four
  policies were one `[policy]` segment; `[policy]` and `[emirate]` cannot coexist, and Next
  raises it per request rather than at build time. They are four small files sharing one
  renderer now, which is what `docs/routes.md` describes anyway.
- **A second seller had drifted onto the monthly cap.** `seedAtMonthlyCap` puts exactly one
  free seller on the line, because handoff 2 criterion 6 needs a seller who is offered
  nothing. Step 2's subcategory re-filing changed which listings sit in the valve pool, one of
  them was incidentally at 3 of 3, and the handoff-2 checkpoint — "send to 5 sellers" —
  started finding four. The test had not changed and neither had the code it tests.
  `onlyOneSellerAtCap` runs last in the seed and takes the surplus rows off anybody who is not
  the designated one.


## 6. Blocked on the user

Carried from handoff 4, unchanged. None stops a step; each narrows one.

- **The contrast decision**, pinned since handoff 1. Criterion 11 is "axe clean", and axe
  flags the documented token pairings. It reads as "clean outside the documented token
  pairings" until settled — the handoff 1-to-4 convention, stated plainly rather than implied.
- **`service_role` key rotation.**
- **`stores.businesslistings.me` and a Vercel domains token.** Not on this handoff's path.
