# Handoff 4 — Superadmin console

**Goal:** the machinery that keeps a 41,000-listing marketplace honest and growing. Six jobs:
get listings in, keep the data comparable, build what sellers fill, grow and keep accounts,
take the money, protect the trust.

**Depends on:** handoffs 0–3. The directory browses, enquiries flow, sellers self-serve. Every
queue this handoff drains is already being filled — moderation submissions from `[3b]`,
supplier reports from the enquiry engine, zero-result queries from search.

**Reference:** boards `4a`–`4i` · `12a`–`12h` · `5a`–`5e` `5g` `5h` · `6f` · flow map `9c` ·
design-system §07 (superadmin column) · `docs/routes.md` admin block.

---

## The organising idea

Board `4a` is the whole console in one screen: every number on it is a link into the queue
that fixes it, and it answers one question each morning — **which of the six jobs is behind**.

Compact density throughout. More rows beats more whitespace. No serif anywhere — this is not
a place for editorial voice. Every screen answers "what is behind and who is it blocking",
and queues show age and SLA breach before they show volume.

---

## Scope — six jobs

### 1. Get listings in

```
/admin/ingest              Licence-record importer          [12a]
/admin/ingest/dedupe       Dedupe & merge                   [12b]
/admin/queue               Approval queue                    [4b]
/admin/queue/:id           Review a submission               [4c]
```

Nothing publishes automatically. An import run parses, validates, categorises and stages —
then a person approves it. Rejection reasons are fixed and countable: licence expired 24+
months, no readable trade name, activity out of scope, address outside the UAE.

Dedupe bands by confidence: above 90% bulk-merge is safe, 60–90% needs a human, below 60% is
not a match. The 74% band on `[12b]` is the one that matters — merging two genuinely separate
companies destroys reviews. Every merge is reversible for 30 days, writes an audit row, and
creates a 301 automatically.

`[4c]` handles the conflicting-claim case: two licences, same premises, similar names. Four
resolutions — award to A, award to B, split into two listings, merge as branches. Plus the
count of buyers currently waiting on that listing, because that is the real cost of the delay.

### 2. Keep the data comparable

```
/admin/categories          Taxonomy                          [4d]
/admin/spec-library        Global spec templates             [4e]
/admin/search              Ranking, boosts, query routing   [12c]
/admin/areas               Emirates, areas, free zones      [12h]
```

Taxonomy carries the publish thresholds (60 listings, 30% verified) that gate landing pages
in handoff 5, plus search synonyms including Arabic terms.

Spec library is versioned. Publishing a new version with a new required field leaves N
products incomplete — `[4e]` shows the count and offers a grace period rather than breaking
them. Seller-proposed custom fields that appear often enough get promoted into the shared
template; that promotion path is what stops 40,000 businesses inventing 40,000 attribute names.

Ranking `[12c]` exposes the weights config from handoff 1 as a UI, with plan tier capped low
and a preview against a real query. Manual boosts require a reason and an expiry — the expiry
field is required, so a permanent boost is not possible. Query routing sends phrases we know
("amc", "صمامات", "pro services") to the right category.

### 3. Build what sellers fill

```
/admin/storefront-templates/*    Builder shell, themes, sections,
                                 page templates, domains, specimens
                                 [5a] [5b] [5c] [5d] [5e] [5g] [5h]
```

This is a **superadmin tool, not a client one**. Our team defines six themes, three type
pairings, one validated brand colour and the section library; sellers pick from those and
fill them in. A free-form page builder in seller hands produces 2,000 broken storefronts and
a support queue.

Theme colours are contrast-checked on save and rejected with the reason shown. A theme never
recolours verification badges, status tones or platform chrome.

### 4. Grow and keep accounts

```
/admin/businesses          Businesses & account health       [4f]
/admin/crm                 Recruitment & accounts           [12d]
/admin/users               Users                             (list + impersonate entry)
/admin/support             Support desk & view-as           [12f]
```

The CRM call list **builds itself** from demand signals — a held area page, a zero-result
query, a Free account hitting its cap, a paying account whose reply rate is falling. Nobody
types a prospect list by hand. Board `12d` carries the script that works: lead with their
missed demand, not with our product.

View-as is read-only, capped at 30 minutes, tied to a ticket, and writes an audit row. It
cannot send an enquiry or change a price as the seller.

### 5. Take the money

```
/admin/subscriptions · /admin/revenue     Plan mix, MRR movement   [4g]
/admin/plans                              Entitlements            [12e]
/admin/dunning                            Failed payments         [12e]
/admin/tax                                VAT export              [12e]
/admin/invoices                           Invoices & credits      [12e]
```

Subscription and sponsored placement only. No commission, no payouts, no GMV.

Entitlements are data, not code — changing a number affects every account on that plan, and
existing accounts are grandfathered unless "apply to existing" is explicitly ticked.

Dunning sequence is the retention-critical part: silent retry at D0, email at D3, WhatsApp at
D7, final notice at D14 then drop to Free — **never delete, never remove the verified badge**.
A failed card is usually an expired card, not a decision to leave.

### 6. Protect the trust

```
/admin/reports             Supplier reports & flags          [4h]
/admin/staff               Staff, roles & audit log          [4i]
/admin/visits              Field visit scheduling           [12h]
/admin/compliance          PDPL data requests               [12h]
/admin/api                 API keys & webhooks              [12h]
```

`[4h]` is a supplier-conduct queue, not a payment-dispute queue. Outcomes are
`seller_corrected` | `upheld` | `no_action`, each with a reason. Off-platform payment reports
skip the queue entirely.

Verification tier is set here and nowhere else. Field visits `[12h]` schedule by route, and
the visit report requires two geotagged photos plus the premises/signage/stock checks.

Review removal has four grounds only: no traceable enquiry, abuse, private information,
provably false claim. Every removal is logged with a written reason and is visible in the
audit trail.

### Content operations

```
/admin/content/matrix      SEO page matrix                    [6f]
/admin/content/home        Homepage curation                 [12g]
/admin/content/redirects   Redirects                         [12g]
/admin/notifications       Notification templates            [12g]
/admin/strings             Localisation                      [12g]
```

`[6f]` is the load-bearing one: pages publish only above 60 listings and 30% verified, and
auto-unpublish if supply drops. Enforced in code. This is what separates a directory from a
doorway-page farm, and it is why the CRM has a call list at all.

Notification templates are versioned database records. Editing a WhatsApp template creates a
version in review — Meta approval is required — and the old version keeps sending until the
new one is approved.

Only tier 2+ businesses can be featured on the homepage, and nobody can pay to appear there.

---

## Components

**ModerationRow** and **AuditRow** were built in handoff 2 and are consumed here.
No new tier 4 components — all 64 exist. If a screen seems to need a new one, it is probably
a DataTable configuration.

---

## The three rules that make this console trustworthy

1. **Every state change writes an audit row with a written reason.** Tier changes, review
   removals, credits, suspensions, merges, boosts, view-as. The reason field is required at
   the service layer, so a screen physically cannot skip it.
2. **Nothing publishes itself.** Imports stage, thresholds gate, boosts expire. Automation
   prepares work; a person approves it.
3. **The console cannot move buyer money**, because there is none to move. No refunds of
   buyer funds, no payouts, no escrow. Subscription credits only.

---

## Acceptance criteria

1. An import run of 8,000 records stages without publishing, categorises what it can, queues
   what it cannot, and lists rejections by countable reason.
2. Dedupe above 90% bulk-merges; the 60–90% band requires a decision; every merge is
   reversible for 30 days, writes an audit row and creates a 301.
3. A conflicting claim can be resolved four ways, and the resolution notifies both parties.
4. Publishing a spec-template version with a new required field does not invalidate existing
   products — the grace period works and the affected count is accurate.
5. Changing ranking weights in the UI measurably reorders live results; a manual boost cannot
   be saved without a reason and an expiry.
6. A landing page below 60 listings or 30% verified cannot be published, and an existing page
   auto-unpublishes when supply drops below the floor.
7. The CRM call list is generated from demand signals with no manual entry, and logging a call
   outcome updates the account state.
8. View-as is read-only, expires at 30 minutes, and writes an audit row naming the ticket.
9. A moderator cannot change a verification tier, issue a credit or suspend an account —
   rejected server-side, covered by tests.
10. Dunning runs the D0/D3/D7/D14 sequence and never deletes a listing or removes a badge.
11. Every mutation in the console writes an audit row; a mutation without a reason throws.
12. Axe clean at compact density on all admin routes; `pnpm build` clean.

---

## Out of scope

No SEO landing pages themselves — the matrix that governs them is here, the pages are
handoff 5. No mobile. No service/booking model.

---

## Sequencing

Moderation and taxonomy first — `[4b]` `[4c]` `[4d]` `[4e]` — because handoff 3 is already
filling that queue and it is the only genuinely blocking backlog. Then ingestion `[12a]`
`[12b]`, which is what makes launch-day supply real. Then trust `[4h]` `[4i]` `[12h]`. Then
accounts and CRM `[4f]` `[12d]` `[12f]`. Then commercials `[4g]` `[12e]`. Then the storefront
builder and content ops last — they are the least blocking and the most self-contained.
