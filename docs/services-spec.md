# Services — what the product owes a supplier who sells by the job

**Decision D5, taken 9 Sep 2026: services get their own screens.** Not a setting on the
existing ones — their own.

This document says which screens that means, what each has to do, and which are genuinely new
designs rather than variants of something already drawn. It exists so the design handoffs can
come screen by screen against a list both sides agree on.

Written against the tree at `25fba6a`. Companion to `docs/build-plan.md`, which sequences it.

---

## 1 · What is actually wrong today

The platform assumes every supplier sells a thing with a stock level. Nine surfaces make that
assumption independently, and five of them charge a service supplier for it.

**The one that costs money.** `lib/enquiry/fanout.ts:181` scores a supplier for an enquiry as:

```
coverage * 0.34 + stock * 0.2 + category * 0.18 + locality * 0.12 + trust * 0.1 + speed * 0.06
```

`lib/enquiry/service.ts:184` fills `coverage` from whether the business has any products, and
hardcodes `inStockLineCount` to `0`. A freight forwarder has no products and no stock, so both
terms are zero and they cap at **0.46** where a goods supplier reaches **0.80** — on the same
enquiry, in their own category. This decides who receives an enquiry at all. It is the single
most expensive line in this document.

**The rest, in the order a supplier meets them:**

| Surface | What it does to a service supplier |
|---|---|
| `lib/setup/tasks.ts:36,73` | The setup hub's three tasks include "add 10 products". A service supplier can never finish onboarding, so the hub never disappears |
| `components/storefront/CatalogueGrid.tsx:17` | Their storefront shows a "Catalogue" heading over an empty state |
| `components/structure/nav-config.ts` | Their dashboard nav says "Catalogue → Products" |
| `app/(public)/_results/Results.tsx:73` | Search offers an "Availability" facet — in stock, made to order — against suppliers who stock nothing |
| `/search?tab=products` | A products tab that is empty for half the directory |
| Product editor | The category picker offers service subcategories as a place to file a SKU |
| `EnquiryLine.qty` | A service enquiry asks "how many" about a thing with no unit |
| Spec templates | Built around DN100 and wall thickness. A service has no such fields |

---

## 2 · The split is per subcategory, not per sector

This is the finding that shapes everything below, and it contradicts the obvious reading.

There are 13 sectors. **Not one of them is purely goods or purely services.** The taxonomy seed
proves it:

- **Logistics & freight forwarding** — *Customs clearance* and *Freight forwarding* are services;
  *Material handling equipment* is a product.
- **IT, telecom & software** — *Cybersecurity*, *Cloud & hosting* and *Software development* are
  services; *Servers & storage*, *Networking hardware* and *CCTV & access control* are products.
- **Printing, signage & events** — *Event management* is a service; *Corporate gifts &
  merchandise* is a product.
- **Construction & building materials** — mostly products, but *Heavy equipment rental*,
  *Steel fabrication* and *Joinery & carpentry* are sold by the job.
- **Legal, audit & business setup** — every subcategory is a service. The only clean one.

So a sector-level flag would be wrong on roughly half the tree. The unit is the **subcategory**,
of which there are around 420.

### The data model

One nullable field on `Category`:

```prisma
/// How this trade is sold. Null inherits from the parent, so a sector can be
/// set once and a subcategory overridden where it differs.
tradeKind TradeKind?

enum TradeKind {
  goods
  services
}
```

Null inherits from the parent. `lib/taxonomy/sector.ts:44-55` already walks the tree that way
and is bounded at depth 8, so the resolver has a precedent to copy rather than a pattern to
invent.

**This is a migration**, so it stops for a person under CLAUDE.md § *How work lands*. It is
additive, so it applies before the merge.

**Out of scope, explicitly:** no calendar, no appointment, no availability window, no slot, no
confirmation. The conversion event stays the enquiry and the terminal state stays the accepted
quote. "Booking" is not available as a word — it already means a sponsored placement and is
printed on tax invoices.

---

## 3 · The screens

Nine, in the order a handoff would be most useful. **Four are new designs**; the rest are
variants of screens that already exist and mostly need copy, a different facet set, or a
control.

### New designs

#### S1 · Service detail — the equivalent of `1g`, the product page
**Route:** `/b/:slug/s/:service` · **New**

The product page is a spec table, an availability chip and an enquiry action. A service has
none of those three. What a buyer needs before enquiring about *Hard FM & MEP maintenance* is
different in kind, not in degree:

- **Scope** — what the job includes, in the supplier's own words
- **What is not included** — the line that prevents the argument later, and the one thing
  buyers say they never get
- **How it is priced** — per visit, per month, per square metre, per job. **Not a price.** The
  no-price-on-a-public-surface rule holds: this is the *unit*, not the number
- **Turnaround or response** — "same day", "within 48 hours", "24/7 callout"
- **Where they cover** — emirates and areas, which for a service is the constraint that decides
  whether they are relevant at all
- **Credentials this job needs** — a trade licence covers the company; a lift maintenance
  contract needs a specific approval, and the buyer wants to see it

**Acceptance:** renders with every field unfilled, reading honest rather than broken. Carries no
price, no quantity and no availability chip. Enquiry action carries the service in as the
subject the way `1g` carries a product.

#### S2 · The service enquiry composer — `1h` for a job
**Route:** `/rfq/new` in a service scope · **New**

The highest-value screen here, and the reason S1 matters. The current composer collects lines
with a description and a **quantity**. A service enquiry has no quantity — it has a site, a
scope, a duration and a frequency.

What replaces the line table:

- **Where** — site address or area, because a cleaning contract in Fujairah and one in Al Quoz
  are different enquiries
- **What** — the scope, free text, with the subcategory as the frame
- **How often** — one-off, or recurring; and if recurring, roughly how often
- **When** — needed by, or ongoing from
- **How big** — the sizing question that varies by trade: square metres, headcount, number of
  units, number of vehicles. **This is the hard part of the design** and the reason this is a
  new screen rather than a variant

**Settled 9 Sep 2026: one free-text "scale" field.** Not a controlled set per subcategory.

The controlled version is better data and is a second dictionary for ops to own, on top of the
~420 `tradeKind` rows this document already asks them to set. Free text ships, and the volume
that would justify the structure does not exist yet — there is no service enquiry to learn the
shape from. Add structure where the traffic argues for it, per subcategory, rather than
inventing 420 sizing questions in advance and being wrong about most of them.

What that means for the design: one field, labelled by the subcategory so the buyer knows what
kind of answer is wanted, with a placeholder that names the unit that trade actually uses —
square metres for cleaning, headcount for manpower supply, vehicles for transport. The label
and placeholder are per-subcategory copy; the stored value is a string.

**Acceptance:** median time from opening the composer to sending stays inside `1h`'s 54-minute
promise. No field asks a quantity. Fan-out still reaches 3–8 suppliers.

#### S3 · Service editor — the equivalent of `3g`, the product editor
**Route:** `/dashboard/services/:id` · **New**

The seller's side of S1. Product editor fields — SKU, availability, stock, spec values, min
order quantity — are all wrong. Service fields are scope, exclusions, pricing unit, turnaround,
coverage and credentials.

**Acceptance:** the same "unfilled stays visible" rule as the product editor — a service with
half its fields empty shows the seller the same grey rows the buyer sees. No price field
anywhere. Saving writes an audit trail the way the product editor does.

#### S4 · Services list — the seller's catalogue equivalent
**Route:** `/dashboard/services` · **New, but close to `3f`**

`3f` is a table of products with availability, spec completeness and bulk actions. The service
version is a shorter table — name, coverage, turnaround, completeness — and the bulk actions
that make sense (publish, unpublish) rather than the ones that do not (stock, price).

**Acceptance:** works at 3 services and at 60. Completeness is measured, never seller-editable.

### Variants of existing screens

#### S5 · Storefront, service composition
`components/storefront/CatalogueGrid.tsx` → a services section. Same slot in the template, a
different renderer and a different heading. The empty state changes from "Nothing in the
catalogue yet" to its service equivalent.

#### S6 · Search in a service scope
The Availability facet and the Products tab are hidden. What replaces them is the question a
buyer actually asks about a service supplier: **coverage area**, **response time**, and
**one-off vs contract**. Response time is already measured and already a facet elsewhere, so
two of the three exist.

#### S7 · Category page for a service subcategory — `10a` variant
The counts and the framing change: "218 suppliers" is right, "218 products" is not.

#### S8 · Setup hub — `8a` variant
"Add 10 products" becomes the service equivalent, with a target that a service supplier can
actually reach. Without this the hub never closes for half the directory, which is the defect
that makes onboarding feel broken rather than incomplete.

#### S9 · Taxonomy screen — `4d` variant
The ops control that sets `tradeKind` per subcategory, with the inherited value shown where it
is null. This is where the ~420 rows get set, so it needs to be usable in bulk rather than one
row at a time.

---

## 4 · What is not a screen

Three pieces of work with no design attached. They are listed because the screens above will
not behave correctly without them.

1. **Fan-out scoring.** For a service scope, `coverage` and `stock` have to be replaced rather
   than zeroed — the obvious candidates are coverage-area match and response time, which are
   both already measured. Until this changes, every screen above renders correctly for a
   supplier who still loses the enquiry.
2. **Spec templates.** `SpecTemplate` is built around filterable fields like DN100. A service
   subcategory either gets a service analogue or is held out of the template system entirely.
   Given D3 was answered *no* — comparison stays at business level — holding services out
   entirely is the cheaper and more coherent answer.
3. **`EnquiryLine.qty`.** Nullable, or a service enquiry carries a single line with no quantity.
   This is a schema question that S2's design will answer.

---

## 5 · Order

The dependency is real but short. `S9` sets the data, everything else reads it.

```
migration + resolver  →  S9 (ops sets ~420 rows)  →  S8, S5, S7, S6   (a service supplier stops being told they are broken)
                                                 →  S3, S4            (they can describe what they sell)
                                                 →  S1                (a buyer can read it)
                                                 →  S2 + fan-out fix  (a buyer can ask for it, and the right supplier receives it)
```

**Suggested handoff order:** S1, S2, S3 first — they are the new designs and the long poles. The
six variants can follow in any order, and three of them are mostly copy.

---

## 6 · Nothing outstanding

The one open question — how the composer asks "how big is this job" — was settled on
9 Sep 2026 as a free-text scale field. See S2. Everything else in this document is mine to
resolve as the handoffs arrive.
