# Handoff 4, step 6 — Storefront templates (boards 5a–5e, 5g, 5h)

The specification the handoff-4 README compressed into four sentences. Read this before
step 6. Boards `5a` `5b` `5c` `5d` `5e` `5g` `5h` in `Business Listings Design System` and
the main canvas.

---

## The idea, and why it is superadmin-only

Sellers do not build storefronts. **We** build storefront templates; sellers fill them.

A free-form page builder in seller hands produces a few thousand broken storefronts and a
support queue. So the seller's entire design surface is: pick one of six themes, and fill in
the fields of the sections we enabled for their sector. Ordering, adding, removing and
composing sections is a staff action, applied per sector template.

That means a template edit is a **fan-out operation**: changing the Industrial template
changes 1,842 live storefronts. Every screen below has to make that blast radius visible
before the save.

---

## The four objects

**`StorefrontTemplate`** — belongs to a sector (a top-level category). Has a name, a status
(`draft | live | retired`), a version, an ordered list of enabled sections, a default theme,
and a set of pages. `businessCount` is derived, shown on every screen that can change it.

**`TemplateSection`** — an instance of a section *type* inside a template. Carries: type,
sort order, enabled flag, `sellerEditableFields` (which fields the seller may fill), and
`showOnMobile`. Two sections of the same type in one template are allowed (two content bands,
say) but not two of a singleton type like the header.

**`SectionType`** — the platform-owned catalogue of what can exist at all. 14 types, listed
below. Each declares its data source, its seller-fillable fields, and whether it is a
singleton. Adding a new type is a code change, not a config change.

**`TemplatePage`** — a page within a template: home (implicit), plus staff-authored pages like
About, Projects, Certifications. Each has a slug, a block list, and SEO fields. Pages are
composed of *blocks* (heading, text, image+text, numbers row, timeline, gallery,
certifications, CTA) — a smaller vocabulary than sections, because a page is prose and a
storefront home is data.

---

## Board 5a — builder shell

Three panes under the ink `BuilderChrome` bar: section list left, live canvas centre,
settings right.

**Header.** Back to admin · template name · status pill · **`APPLIES TO 1,842 STORES`** ·
desktop/mobile toggle · Preview link · Publish.

**Left pane — sections.** Drag to reorder. Each row: drag handle, type name, enabled
checkbox. The header and footer rows are marked `FIXED` and cannot be moved or disabled.
Below the section list, the page list with per-page status (live/draft) and `+ New page`.

**Centre — live canvas.** The template rendered at 50% against a real seller's data, so staff
see a true result rather than lorem. Selected section outlined 2px moss with a small label
tab. Scale indicator and Fit control at the bottom.

**Right pane — settings for the selected section.** Whatever that section type declares.
For the hero: layout (three options), eyebrow, headline, button label and target, background
source, darken-for-legibility toggle, show-on-mobile toggle. Plus, on every section, the
seller-editable field checklist — which of these fields the seller may change, and which are
locked to the template.

**Publish** is a two-step: a diff of what changed, then a confirm naming the store count.

---

## Board 5b — theme presets

Six presets, each a brand colour plus a derived ramp: `industrial` steel blue, `default`
moss, `trade` clay, `mono` ink, `clinic` sage, `salon` plum. Values are in
`docs/tokens.css` as `[data-theme]` blocks.

Per template, staff set: which presets are offered to sellers in that sector, which is the
default, and whether a custom hex is allowed at all. A custom hex is contrast-checked on save
(≥ 4.5:1 against white) and rejected with the reason shown.

Also per template: type pairing (editorial serif / clean sans / technical mono), corner radius
on a slider, density (compact/comfortable/roomy), dark-header toggle, and whether the
"storefront by Business Listings" badge can be removed (Pro entitlement).

The right pane shows the theme applied across **every surface it touches** — header, hero,
product card, enquiry form, badges — so a reviewer sees the blast radius in one screen.

**The rule, stated on the board:** a theme recolours header, headings, buttons, links and
form focus. It never recolours verification badges, status tones or platform chrome. That is
non-negotiable and belongs in a test.

---

## Board 5c — section library

The catalogue of 14 section types, shown as cards with a wireframe thumbnail, the name, what
it pulls from, and the state: in use / available / coming soon. Filter chips: All / Sell /
Prove / Contact.

| Type | Pulls from | Seller fills | Singleton |
|---|---|---|---|
| Header & contact bar | business, locations | — | yes |
| Hero banner | media | eyebrow, headline, button label, image | yes |
| Trust strip | verification, locations, response time | nothing — all derived | yes |
| Featured products | products | pick 4–8, or auto-pick most-enquired | no |
| Catalogue grid | products + spec template | which categories to show | yes |
| Brands we stock | media library | logo picks | no |
| Certifications | documents | which to show | no |
| Branches & map | locations | — | yes |
| Reviews | reviews | — | yes |
| Enquiry form | — | intro line | yes |
| Meet the team | media | names, roles, numbers | no |
| Offer banner | — | headline, body, code, end date | no |
| Spec comparison | products + spec template | which attribute set | no |
| Downloads | documents | which files | no |
| Services & packages | — | — | **coming soon** |

Services & packages is deliberately absent — it belongs to the services model, which is not
built. Leave it visible and disabled so the gap is legible.

Every section reads from data the seller already has. That is the point: enabling one is a
click for staff and zero content work for the seller.

---

## Board 5d — page template editor

Left: block palette (page heading, text, image+text, numbers row, timeline, image gallery,
certifications, call to action). Centre: the page at 660px on a desk background. Right: page
settings — title, URL (slug locked once published), meta description with a 160-char counter,
show-in-nav toggle, allow-search-engines toggle.

Below settings, a **content check** panel: over 250 words, mentions the area and trade, has
one image with alt text, has an internal link to the catalogue. Advisory, not blocking, but
it is what stops thin pages shipping at scale.

The board's note matters: this template applies to every store in the sector. Sellers fill
the fields; they cannot change the structure. Three pages (About, Projects, Certifications) is
usually enough — those are the ones that rank for company-name and credential searches.

---

## Board 5e — domains, publishing, embed

**Two addresses, both live.** The platform URL keeps its ranking; the custom domain is the
one on the business card. Neither replaces the other.

**Custom domain verification — the flow to build:**

1. Seller enters `shop.alwaha.ae` in their dashboard (handoff 3 surfaced this as a Pro
   entitlement; the verification machinery is here).
2. We generate two records: `CNAME shop → stores.businesslistings.me` and
   `TXT _bl-verify → bl-verify=<token>`.
3. A poller checks every 60 seconds, per record, showing `Found` / `Waiting` independently —
   partial propagation is the normal case and must not read as failure.
4. Both resolving → certificate issued automatically → status `live`.
5. States to handle: pending, partial, verified, failed-after-24h (with the likely cause
   named), and revoked (domain stopped resolving after going live — the platform URL keeps
   serving, and the seller is told).
6. "Email these records to my IT person" is a real button. Most SME owners do not run their
   own DNS.

**Publishing.** An unpublished-changes list in words ("theme changed to Industrial", "hero
headline rewritten", "certifications section added"), a version history with restore, and a
shareable preview link. Publish applies to both addresses at once.

**Embed.** A script snippet for sellers who already have a website: catalogue view, single
product, or enquiry form only. `data-theme="inherit"` picks up the host page. Stock and
availability stay in sync because it reads from us. This is a retention feature — a seller
with our embed on their own site does not churn quietly.

---

## Boards 5g and 5h — section specimens

Every section type rendered full-width at real scale, in sequence, each with a mono label
above it stating the type number, its data source and its seller-fillable fields.

This is not decoration. It is the reference a reviewer uses to answer "what does enabling
this actually give the seller", and it is the acceptance surface for step 6 — the equivalent
of `/dev/gallery` for sections. Build it at `/admin/storefront-templates/specimens`.

5g covers types 1–5 (hero, trust strip, featured products, catalogue grid, enquiry form).
5h covers 6–14 (brands, certifications, branches & map, reviews, downloads, meet the team,
offer banner, spec comparison) plus the disabled services card.

---

## Acceptance criteria for step 6

1. A template edit shows the affected store count before saving, and publishing requires a
   confirm naming that count.
2. Reordering, enabling or disabling a section changes every live storefront on that template
   and nothing else — asserted with two sectors in the test data.
3. A seller cannot reorder, add or remove a section by any path, including the API.
4. A theme applied to a storefront leaves verification badges, status tones and platform
   chrome unchanged — visual test.
5. A custom brand hex below 4.5:1 against white is rejected with the reason shown.
6. Header and footer sections cannot be disabled or moved.
7. A singleton section type cannot be added twice; a non-singleton can.
8. Domain verification shows per-record status, handles partial propagation without reading
   as failure, issues a certificate on both records resolving, and handles the revoked case by
   continuing to serve the platform URL.
9. Slugs are immutable once a page is published; renaming produces a 301.
10. The specimens page renders all 14 section types with their data source and seller-fillable
    fields labelled, and the services card visibly disabled.
11. Every template mutation writes an `AuditEvent` with a reason and the affected store count
    in `after`.
12. Publish is reversible from version history.

---

## What to cut if step 6 needs to be smaller

Cut in this order: embed snippet (5e, retention feature — valuable, not blocking), page
template editor (5d, staff can author three pages by hand initially), theme editor (5b — ship
the six presets as fixed config, no per-sector selection).

Do not cut: the section library and builder shell (5a, 5c), domain verification (5e), or the
specimens page (5g/5h). Those four are what make the template model real rather than
theoretical.
