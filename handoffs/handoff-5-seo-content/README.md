# Handoff 5 — SEO layer & content operations

**Goal:** the acquisition engine. Everything before this handoff makes the product work;
this one makes buyers arrive. 84 category×emirate pages, ~418 subcategory pages, curated
lists and guides — governed by a publish threshold that keeps the whole thing from becoming
a doorway-page farm.

**Depends on:** handoffs 0–4. The directory browses, enquiries flow, sellers self-serve, and
admin already owns the page matrix `[6f]`, the taxonomy thresholds `[4d]`, redirects and
homepage curation `[12g]`. This handoff builds the pages those controls govern.

**Reference:** boards `6a` `6b` `6c` `6d` `10b` `10i` `10j` · `6f` (built in handoff 4, the
governing surface) · flow map `9d` acquisition handoff · design-system §07 public column,
§08 voice.

---

## The one rule this handoff exists to enforce

**A page publishes only above 60 listings and 30% verified, with 250 words of intro copy —
and auto-unpublishes if supply drops below the floor.**

It was built as a service-layer guard in handoff 1 and given a UI in handoff 4. Handoff 5 is
the first time it does real work, because this is where the page volume arrives.

Business Bay HVAC has 3,940 searches a month and 78 listings. Publishing it now creates a
page that ranks and disappoints. It stays queued behind supply recruitment, and that queue is
what feeds the CRM call list in `[12d]`. The flywheel only turns if the threshold holds:
demand data tells us who to recruit, recruiting them unlocks the page, the page brings more
demand.

If a task in this handoff proposes generating pages ahead of supply, the task is wrong.

---

## Scope

```
/:emirate/:area/:category     Area landing page                    [6a]
/c/:category/:sub             Subcategory (built h1, SEO'd here)  [10a]
/categories                   Category index                       [6c]
/best/:slug                   Curated list                         [6b]
/guides                       Guide index                         [10b]
/guides/:slug                 Guide article                        [6d]
/lp/:campaign                 Campaign landing                    [10i]
/terms · /privacy · /verification-policy · /review-policy         [10j]
```

Plus the technical layer: sitemaps, structured data, redirects, canonicals, and the
zero-result → gap-report loop closing.

---

## The four page types, and what each is for

**Area landing `[6a]` — the workhorse.** 84 category×emirate combinations plus area-level
depth. Real intro copy about the area, not spun text: why HVAC clusters in Al Quoz, what the
travel time means, how many are verified. Then verified suppliers ranked, subcategory chips,
a map, an FAQ block answering what buyers actually ask, and cross-links to the same trade in
other areas and other trades in the same area.

The FAQ answers must be grounded in platform data — "across quotes on this platform, AMCs in
Al Quoz run AED 6,000–22,000" — because that is the thing no competitor can copy.

**Subcategory `[10a]`.** 418 of them. Suppliers grouped by emirate, spec-filter chips from
the category template, the same FAQ pattern. This template has to scale further than any
other, so it must be entirely data-driven with no per-page authoring beyond the intro.

**Curated list `[6b]`.** Editorial, with the selection criteria published on the page:
licence verified required, median reply under 4h required, 15+ reviews from enquiries
required, site visit weighted, **paid placement never**. Every other "best of" list in this
market is sold; stating the rules is the only thing that makes ours worth reading — and it is
why sellers chase verification instead of chasing us.

**Guides `[6d]` and index `[10b]`.** 22 articles on verification, quoting, payment terms and
getting a supplier to turn up. These bring in buyers who are not searching for a supplier yet
and earn the links that make the 84 area pages rank at all. Each one ends in the directory.

**Campaign landing `[10i]`.** No site nav beyond the wordmark and one escape link, but always
offers the directory as an alternative — a page that traps the visitor converts worse and
ranks worse. UTM preserved through to the enquiry and attributed in admin.

---

## Technical SEO

**Structured data.** `LocalBusiness` on storefronts with `aggregateRating` only where reviews
exist. `Product` with `offers.availability` and **no price** — `PriceSpecification` is omitted
deliberately, not left blank. `ItemList` on area pages and curated lists. `FAQPage` on the FAQ
blocks. `BreadcrumbList` everywhere. `Article` on guides.

**Sitemaps.** Index plus per-type sitemaps, published pages only, `lastmod` from real content
changes rather than a nightly touch. A page that auto-unpublishes drops out on the next build.

**Canonicals.** `/c/:category?emirate=dubai` canonicalises to the area page where one exists,
so filtered views never compete with the page we want ranking. `/search` and `/compare` stay
`noindex`.

**Redirects.** Already modelled in handoff 4 — merging listings and renaming categories create
301s automatically. Deleting a published page without one is blocked at the service layer.

**Performance.** These pages are the majority of organic traffic and most of it is mobile:
server-rendered, no client-side data fetching on first paint, images lazy below the fold,
Core Web Vitals green on the three template types.

---

## Closing the gap loop

Zero-result queries have been written since handoff 1 and read by admin since handoff 4.
This handoff closes the loop: a buyer on a zero-result page can set an alert
("tell me when a stainless DN100 UL/FM is listed"), and that alert fires when a matching
product appears — which is usually because the CRM recruited the supplier who lists it.

That is the complete flywheel, and it is worth building the alert properly: it is the only
mechanism that converts a failed search into a future enquiry.

---

## Voice

Design-system §08 governs, and it matters more here than anywhere because these pages are
read by strangers deciding whether to trust us.

Say the number: "218 companies, 96 with verified trade licences, 41 open now". Never spin.
Never publish a page that says "the best HVAC companies in Al Aweer" when there are eighteen
of them. The intro copy is the one place a human writes per page, and the 250-word floor
exists to make sure a human actually did.

---

## Acceptance criteria

1. An area page below 60 listings or 30% verified cannot be published, by API or by admin
   action; an existing page auto-unpublishes when supply drops and disappears from the sitemap
   on the next build.
2. Area and subcategory pages render entirely from data plus a single authored intro — adding
   a new emirate or subcategory needs no code change.
3. FAQ answers derive from platform data and update as the data does.
4. A curated list displays its selection criteria and cannot include a business that fails
   them; placement cannot be bought into one — asserted by a test.
5. `Product` structured data omits price entirely rather than emitting an empty field.
6. Filtered category views canonicalise to their area page where one exists; `/search` and
   `/compare` are `noindex`.
7. Renaming a category or merging two listings produces a working 301; deleting a published
   page without one is blocked.
8. A zero-result alert fires when a matching product is later listed.
9. Campaign pages preserve UTM through to the enquiry and attribute it in admin.
10. Core Web Vitals green and Lighthouse SEO ≥ 95 on an area page, a subcategory page and a
    guide.
11. Axe clean; `pnpm build` clean.
12. Sitemap contains only published pages, and page count matches the admin matrix `[6f]`
    exactly.

---

## Out of scope

Mobile app. Arabic content — the localisation layer exists from handoff 0 and the strings
admin from handoff 4, but translation is a separate project. Service and booking model.

---

## Sequencing

Guides first. They are self-contained, they earn the links the area pages need to rank, and
they are the only content that works before supply density exists. Then the category index
and subcategory pages, which are pure data. Then area pages, once the threshold guard has
something real to gate. Curated lists after that — they need reviews and reply-time history
to select from honestly. Campaign and legal pages last.

---

## What remains after this handoff

Two things, both deliberate deferrals recorded on flow map `9d`:

**Mobile.** 68% of traffic. Everything is responsive, but the seller reply app — the thing
that protects the response-time number the whole ranking model rests on — is not built.

**Services and booking.** Five of the twelve categories (salons, clinics, legal, FM,
training) cannot use a product catalogue. Today they are a phone number with a verified
badge. That is a real product gap, not a polish item.
