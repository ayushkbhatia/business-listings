# Data model

Prisma-shaped. The rules in comments are not suggestions — several of them are the
non-negotiables from `CLAUDE.md` and a schema that omits them will need a migration.

## Business & listing

```prisma
model Business {
  id                 String   @id @default(cuid())
  tradeName          String   // locked to the licence; not seller-editable
  displayName        String
  slug               String   @unique   // immutable once published
  licenceNumber      String              // e.g. DED-618402
  licenceAuthority   Authority           // DED, ADDED, SHJ, DMCC, JAFZA, SAIF, +30 free zones
  licenceExpiry      DateTime
  trn                String?             // 15 digits, masked on display
  establishedYear    Int?
  teamSize           TeamSizeBand?
  languages          String[]
  description        String?
  verificationTier   Int      @default(0) // 0..3 — STAFF WRITE ONLY, ops_lead role
  verifiedAt         DateTime?
  claimStatus        ClaimStatus         // unclaimed | claimed | disputed
  planId             String?
  primaryCategoryId  String
  categories         BusinessCategory[]
  source             ListingSource       // licence_import | self_added
  importRunId        String?
  publishedAt        DateTime?
}

enum ClaimStatus { unclaimed claimed disputed }
enum ListingSource { licence_import self_added }
```

`verificationTier` drops to 1 automatically the day `licenceExpiry` passes — a scheduled job,
not a manual step. No grace period.

The ladder ran to 4 and stops at 3:

```
0 unclaimed → 1 claimed → 2 licence verified (top) → 3 trade references (reserved)
```

**Tier 2 is the top achievable rung.** Tiers 3 and 4 were "site visited" and "premises
visited and trading history audited", and both rested on somebody standing in the warehouse.
Site visits were withdrawn, so `visitedAt` and `visitedByStaffId` are gone, as are
`SiteVisitRequest`, `SiteVisitReport` and `SiteVisitPhoto`. A
`business_verification_tier_range` CHECK holds the ceiling at 3.

The first pass at that cut moved `audited` down to rung 3 and re-based it on trading
history. That was the same mistake one step quieter: nothing measures a trading-history
audit, no screen sets it, and no listing ever held it — so rung 3 was again a requirement
nobody performs. Board 3e put **trade references** there, `reserved`, drawn so the ladder has
somewhere to go and carrying no affordance because it is not built. `20260916090000_document_review`
moved the eight rows still stored at 3 down to 2, which is what their licence check actually
supports.

```prisma
model Location {
  id            String   @id @default(cuid())
  businessId    String
  type          LocationType  // head_office | warehouse | trade_counter | depot | sales_office | workshop
  emirate       Emirate
  areaId        String
  addressLine   String
  lat           Float?
  lng           Float?        // null = unpinned; excluded from map search
  phone         String?
  whatsapp      String?
  phoneVerified Boolean  @default(false)  // unverified numbers are hidden from buyers
  hours         Json          // per-day open/close, split shifts
  ramadanHours  Json?         // applied automatically on announced dates
  serviceRadiusKm Int?
  geocodePrecision GeocodePrecision?  // exact | approximate; null exactly when unpinned
  published     Boolean  @default(false)
  publishedAt   DateTime?     // first time it went live; never cleared
}

enum GeocodePrecision { exact approximate }

model BusinessCoverage {          // board 3c — where a supplier delivers
  id            String  @id @default(cuid())
  businessId    String
  emirate       Emirate
  areaId        String?           // null covers the emirate entire
  leadTimeHours Int               // 0 is same day
}
```

**A pin's precision is a record of who placed it**, not a judgement about the
coordinates. Dragged by the seller or resolved to a rooftop is `exact`; derived
from the area is `approximate`. Only `exact` may be measured — an area centroid
ranked by distance is the distance to the area presented as the distance to the
address, and on 2026-09-07 that described 116 of the 118 pinned branches in
production. `missing` is not a third value: it is `lat IS NULL`, and a CHECK
ties the pair together.

**Three statuses out of a boolean and a date.** `published` is the one answer to
"can buyers see this". `publishedAt` separates a branch taken down (**hidden**)
from one never finished (**draft**), which is the only difference anything reads:
board 3d offers a hidden branch in its hours picker and skips a draft.

**Coverage is rows, not strings.** They drive `1h`'s RFQ routing and sit beside
the facets `1b` filters on, so a typed area would match nothing. Both scales come
from the taxonomy: an emirate, or an area inside one. Distinct from
`Location.serviceRadiusKm`, which is geometry around one branch rather than a
named place and a promise.

## Taxonomy & specs

```prisma
model Category {
  id                String   @id @default(cuid())
  parentId          String?           // self-referencing tree, two levels used
  name              String
  slug              String   @unique
  code              String            // two-letter mono mark, e.g. "IN"
  synonyms          String[]          // includes Arabic terms for query routing
  defaultTemplateId String?
  showOnHome        Boolean  @default(false)
  acceptsRfq        Boolean  @default(true)
  requiresExtraCheck Boolean @default(false)
  publishThreshold  Int      @default(60)   // listings needed before landing pages publish
  verifiedShareMin  Float    @default(0.30)
}

model SpecTemplate {          // platform-owned
  id         String  @id @default(cuid())
  categoryId String
  version    Int
  status      TemplateStatus  // draft | live | retired
  fields     SpecField[]
}

model SpecField {
  id           String  @id @default(cuid())
  templateId   String
  label        String
  type         FieldType   // select | multiselect | number | number_range | text | boolean
  unit         String?
  options      String[]
  required     Boolean @default(false)
  isFilterable Boolean @default(false)  // drives site-wide filters; marked in the editor
  sortOrder    Int
}

model SellerTemplate {        // a seller's clone
  id                 String @id @default(cuid())
  businessId         String
  platformTemplateId String
  fieldMappings      Json    // seller field -> platform field, so comparison survives renames
}
```

A seller renaming a cloned field breaks cross-seller comparison. Warn before saving, keep the
mapping, and never silently drop it.

## Products — no price

```prisma
model Product {
  id           String   @id @default(cuid())
  businessId   String
  name         String
  sku          String?
  categoryId   String
  availability Availability
  stockQty     Int?
  leadTimeDays Int?
  specValues   Json         // keyed by SpecField id
  media        Media[]
  documents    Document[]
  status       ProductStatus  // draft | live | out_of_stock
  // NO price, NO currency, NO tier pricing. Prices live on QuoteLine only.
}

enum Availability { in_stock made_to_order indent out_of_stock }
```

`out_of_stock` changes the public action from "Enquire" to "Notify me".

## The enquiry spine

```prisma
model Enquiry {
  id             String   @id @default(cuid())
  ref            String   @unique      // ENQ-8841
  buyerId        String
  buyerCompanyId String?
  requirement    String
  lines          EnquiryLine[]
  deliverToArea  String?
  neededBy       DateTime?
  termsWanted    PaymentTerms?
  attachments    Document[]
  recipients     EnquiryRecipient[]    // 1..8 businesses
  closesAt       DateTime
  contactReleasedToBusinessId String?  // set only on acceptance
}

model EnquiryRecipient {
  enquiryId  String
  businessId String
  state      RecipientState  // delivered | opened | quoted | declined | no_response
  openedAt   DateTime?
}

model Quote {
  id           String   @id @default(cuid())
  ref          String   @unique       // QT-8841-R2
  enquiryId    String
  businessId   String
  revision     Int      @default(1)
  validityDays Int      @default(14)
  note         String?
  status       QuoteStatus  // draft | sent | read | accepted | lost | expired
  lostReason   String?
  lines        QuoteLine[]
}

model QuoteLine {
  id           String  @id @default(cuid())
  quoteId      String
  productId    String?          // null = free-text line, flagged for manual pricing
  description  String
  qty          Int
  unitPrice    Decimal          // THE ONLY PRICE FIELD IN THE SCHEMA
  leadTimeDays Int?
}
```

Accepting a quote sets `Enquiry.contactReleasedToBusinessId`, marks the other recipients
`declined`, and creates nothing else. There is no order, no fulfilment record, no payment.

`Message` belongs to an Enquiry + Business pair and carries an optional `quoteRevisionId`, so
a revised quote appears inline in the thread. Off-platform payment detection runs on message
bodies (IBAN patterns, "transfer to") and raises a `SupplierReport` automatically.

## Reviews & trust

```prisma
model Review {
  id             String @id @default(cuid())
  businessId     String
  buyerId        String
  enquiryId      String @unique     // gating: one review per enquiry, and it must exist
  overall        Int
  quotedAccurate Int
  onTime         Int
  asDescribed    Int
  responsiveness Int
  body           String
  media          Media[]
  showCompanyName Boolean @default(true)
  editableUntil  DateTime           // created + 14 days
  sellerReply    String?            // one only, not editable after posting
  removedAt      DateTime?
  removalReason  String?            // required if removedAt set
}

model SupplierReport {
  id        String @id @default(cuid())
  subjectBusinessId String
  reporterId String?
  kind      ReportKind   // closed | wrong_details | wrong_trade | claim_conflict | off_platform_payment | content | review_integrity
  detail    String?
  outcome   ReportOutcome?  // seller_corrected | upheld | no_action
  outcomeReason String?
}
```

Three reports on the same field auto-flag the listing. `off_platform_payment` skips the queue.

## Commercials — subscription only

```prisma
model Plan {
  id                String @id
  name              String       // Free | Basic | Pro
  monthlyPriceAed   Int
  enquiriesPerMonth Int?         // null = unlimited
  productLimit      Int?
  locationLimit     Int?
  photoLimit        Int?
  teamSeats         Int
  rankingMultiplier Float
  customDomain      Boolean
  // NO commissionRate. NO transactionFee.
}

model Subscription { businessId String; planId String; renewsAt DateTime; status SubStatus }
model PlacementSlot { businessId String; categoryId String; emirate Emirate; monthlyPriceAed Int; startsOn DateTime; endsOn DateTime? }
model Invoice { businessId String; lines InvoiceLine[]; vatRate Decimal; status InvoiceStatus }
```

Invoice lines are subscription and placement only. Reducing a plan entitlement grandfathers
existing accounts unless "apply to existing" is explicitly set.

## Audit

```prisma
model AuditEvent {
  id        String   @id @default(cuid())
  actorId   String
  action    String            // tier_change | review_removed | credit_issued | suspend | merge | boost | view_as
  subject   String            // entity type + id
  reason    String            // REQUIRED — no nullable
  before    Json?
  after     Json?
  createdAt DateTime @default(now())
}
```

Write it in the service layer. A mutation that can reach the database without an audit row is
a bug, and the test suite should prove it cannot.

## Derived, never stored as editable

`responseTimeMedian` — from enquiry-to-first-reply timestamps. `profileStrength` — weighted
completeness. `specCompleteness` — filled required fields ÷ template fields. `quotedValue` —
sum of accepted quote lines, labelled self-reported everywhere it appears.

None of these are seller-editable. That is what makes them worth showing.

## Platform settings

```prisma
model PlatformSetting {
  key         String   @id
  value       Json
  updatedAt   DateTime @updatedAt
  updatedById String?           // who, when a person changed it
}
```

One row per platform-level fact that is not a fact about any seller. The first is
`ramadan_dates` — board 2d, criterion 15: *"The dates come from one platform-level setting,
not from each seller. Ramadan moves yearly and 41,000 sellers will not update it."*

Two rules, both load-bearing:

- **Read through a module that owns the key.** `lib/trade/ramadan-calendar.ts` validates the
  value per entry and merges it over a compiled fallback, so one malformed year costs that
  year rather than every storefront's opening hours.
- **A staff write is a staff state change and owes an audit row with a reason.** There is
  deliberately no writer in this codebase yet; board `12h` owns it, and it goes through the
  audit service rather than around it.

## The Pro trial, and what a plan drop does to a catalogue

```prisma
model Subscription {
  trialStartedAt DateTime?   // set once, never cleared
  trialEndsAt    DateTime?   // what the daily sweep reads
  hiddenByPlan   Json?       // product ids a drop hid, so an upgrade restores them
}
```

**The trial takes no card**, which is what makes it small. Board 2e criterion 12, and `1l`'s
own words: *"a trial that captures a card is a subscription with a delay."* There is nothing
to charge at the end of one, so `runRenewals` and `runDunning` are untouched — the account
drops to Free, which is criterion 13.

`trialStartedAt` is set once and nothing clears it. Criterion 11 asks that a seller who has
used the trial never sees trial language again, and that is a fact about the account rather
than about the plan it is on today. `expireTrials` runs first in the daily job, before
renewals, so a fortnight that ran out today is off Pro before anything reads the row looking
for something to charge.

**"Hidden, not deleted" is now a behaviour.** It had been a claim: `cancelSubscription`
returned `kept: ["products", ...]` and the cancel screen said *"Your products are hidden, not
deleted. They come back if you return"* while nothing anywhere hid one — so a Pro seller who
cancelled carried a hundred and fifty live products onto Free.

Hiding is `ProductStatus.draft`, which every public surface already excludes, so no read path
had to learn a new rule and none can forget one. `hiddenByPlan` records which ones the
platform hid, so an upgrade restores exactly those and leaves the seller's own drafts alone.
The oldest products are the ones kept — they are the catalogue the listing was built on.

Photographs are not hidden. The rail's sentence says products and photos stay *saved*, which
is true of both; it does not promise both are hidden, and neither does the code.

## After go-live — the setup hub, board 8a

Four tables, and the argument for each one is that the alternative was a number that
was not true.

```prisma
model Shortlist {
  id         String   @id @default(cuid())
  userId     String   @db.Uuid
  businessId String
  createdAt  DateTime @default(now())
  @@unique([userId, businessId])   // saving twice is saving once
}

model ListingViewDay {
  businessId String
  day        DateTime @db.Date     // Asia/Dubai, so a day is the day the supplier had
  views      Int      @default(0)
  @@id([businessId, day])
}

model ProductEvent {
  id         String   @id @default(cuid())
  name       String                // closed set — lib/telemetry/events.ts
  businessId String?
  actorId    String?  @db.Uuid     // null for anonymous traffic, and no fallback id
  sessionId  String?               // per tab, never persisted, only where actorId is
  props      Json     @default("{}")
  createdAt  DateTime @default(now())
}

model CatalogueImportRequest {
  id             String  @id @default(cuid())
  businessId     String
  requestedById  String  @db.Uuid  // Restrict: a record of somebody having asked
  documentId     String?           // a Document, kind: catalogue, private bucket
  status         CatalogueImportStatus  // requested | in_progress | loaded | cancelled
  feeAed         Int     @default(0)    // frozen at the moment of asking
  dueAt          DateTime?              // two working days, Friday and Saturday skipped
  productsLoaded Int?
}
```

**`Shortlist` exists because the rail needed a buyer count and there was none.** The
nearest thing on offer was a `DISTINCT` over `ContactReveal.actorId`, which is null for
roughly three quarters of its rows by design — most reveals happen before signup. Counting
that and labelling it "buyers who saved you" is exactly the padded number CLAUDE.md's
interface-honesty section forbids. There is no anonymous shortlist and no cookie behind
one: a list that lives in a browser is lost on the next device.

**`ListingViewDay` is a rollup and not a row per view.** This product is built to be
crawled; 41,000 listings and a search engine revisiting them is a table nobody reads and
everybody pays for. The day is the smallest grain any surface asks a question at. It is
written from the browser rather than from the render, for two reasons: the storefront is a
public page the framework may serve from a cache, so a render is not a visit; and a crawler
that does not run JavaScript is not a buyer.

**`ProductEvent` is the first event table in the product**, and deliberately not
`AuditEvent` — that log records staff decisions, its `actorId` and `reason` are both NOT
NULL for that reason, and a product event has no reason at all. `props` is loose because
the alternative is a column per question and a migration per screen, and nothing renders
from this table. The retention rule and the consent argument are in
[telemetry.md](telemetry.md).

**`CatalogueImportRequest` is a queue, not a parser.** `lib/import/service.ts` is the
parser and it needs a spreadsheet with columns; this is for the PDF a supplier has had
since 2019, and the work at the other end is a person reading it. It is a promise of a
shape this schema no longer has anywhere else — the seller asks, we do something by hand,
and the row is what either side points at. Every staff move on the row writes
an audit row with a written reason; the seller's own create and cancel do not, because the
subject acting on their own data is what the audit log exists to distinguish itself from.

### The score these tables do not change

`Business.profileStrength` keeps the five components in `lib/metrics/profile-strength.ts`
— identity 35, photos 20, catalogue 20, filterable specs 15, team 10. Board 8a's handoff
drew a seven-component table including locations, the verification tier and the site visit.
It is not adopted: a location is a **publish gate**, not a lever, and `goLive` refuses
without one; the verification tier is platform-owned and not a seller's to earn; and the
site visit no longer exists at all. What the handoff actually requires — that the per-task percentage chips are
arithmetic on *this* seller's score rather than constants — is what `lib/setup/tasks.ts`
computes, from `strengthItems()`.

### One file, many products — board 3i

```prisma
model Media    { folderId String?  /* null = Unfiled */  products ProductMedia[]    }
model Document { folderId String?  reference String?  reviewedAt DateTime?  reviewReason String?
                 products ProductDocument[] }

model ProductMedia    { productId; mediaId;    sortOrder }  // @@id([productId, mediaId])
model ProductDocument { productId; documentId; sortOrder }
model MediaFolder     { businessId; name; sortOrder }       // @@unique([businessId, name])
```

**`Media.productId` and `Document.productId` are gone.** They were single
nullable columns, so a photograph belonged to at most one product and the same
image had to be uploaded again for the next size in a range — while board 3i's
render already showed `ds-bf-valve.pdf · 4 products`. The join is also the
answer to board 3g's Q4: documents are shared and referenced, never copied per
product, because a UL certificate covers a whole range.

**Position zero is the primary image.** There is no `isPrimary` flag: a flag and
an order are two sources of truth for one fact and they drift, and board 3i's
criterion 8 asks that the primary be settable *and* that board 1g's gallery
order match it. One column satisfies both by construction.

**A seller's own edits have their own table.** `listing_revision` records what a seller changed
and when, for board 3b's recent-changes rail. It is deliberately **not** `audit_event`: that log
records *decisions* — a staff member changing something they do not own, with a written reason —
and filing "S. Menon edited their description" there would dilute the one table whose value is
that every row in it is a staff action somebody can be asked about. Non-negotiable 3 covers staff
state changes; a seller editing their own listing is the other kind.

**`media_kind` has a `library` value that names no surface.** Every other kind names a page, which
made "held in the library and placed on nothing" unrepresentable — `referencesFor` counts any
non-product file as a storefront reference. Board 3b's unpick needed a destination that is not a
deletion.

**A document reaches a storefront on two decisions, not one.** `isPublic` is the seller's —
they want this certificate named on their listing — and `reviewedAt` is a moderator's, that it
may be. `lib/storefront/loader.ts` requires both, which is what makes board 3e's
`In review · 2 working days` a description of where the file is rather than a courtesy.
Collapsed into one column, either a seller publishes unreviewed or a moderator publishes
something the seller asked to hide. `reference` is the credential's own number, and nothing
validates it against an issuing body — the `Uploaded by you` heading is what says so.

**Deleting a product no longer deletes its photographs.** `media.product_id`
carried `onDelete: Cascade`; the join carries it now, so only the reference
goes. The file is the library's, and it may well be on three other products.

**`Unfiled` is `folderId IS NULL`, not a row.** That is what keeps "every file
is in exactly one folder" true — there is no default folder to rename or delete
out from under it. Unreferenced is a *state*, computed by `lib/media/state.ts`
across products, the storefront, team members, enquiry threads and **sent
quotes**; it is never inferred from the absence of a product attachment, and a
quote-held file cannot be deleted at all.

**`Plan.storageMb`** is the allowance board 3i's header states. Uploads stop at
the cap; nothing is deleted and nothing is unpublished.

### Photographs after board 8b

```prisma
model Media {
  slotKey   String?  @map("slot_key")   // which suggested slot, or null
  width     Int?                        // measured in the browser, finally written
  height    Int?
  sortOrder Int      @default(0)        // ordered by since handoff 1, written since 8b
  @@index([businessId, kind, sortOrder])
}
```

**The cover is a `kind`, not a flag.** `MediaKind` already had `cover`, and
`lib/storefront/loader.ts` already picked the hero with
`media.find(e => e.kind === "storefront" || e.kind === "cover")` — so promoting a
photograph is a kind change, needs no column, and the storefront learns nothing. "Exactly
one" is enforced twice: a transaction that demotes before it promotes, and a partial
unique index (`WHERE kind = 'cover'`) behind it, because two tabs and a retry are enough
to leave a listing with two covers and a storefront picking whichever row sorted first.

**`slotKey` is a label, never a claim about the picture.** The green line under a tile —
"Good — shows racking and stock" — is the *slot's* static copy, shown because the seller
filed the photograph there. Nothing in this build looks at image content. Board 8b §4
spends half its length on that distinction because one visual treatment hides both, and
it instructs that `slotHint` and `qualityFlag` stay separate fields with separate
colours. There is no `qualityFlag` in this phase at all — see below.

**`width`/`height` had existed since handoff 0 and nothing ever wrote them**, so no
surface could reserve space for an image or refuse one too small to render. The canvas
that resizes a file has already decoded it, so the numbers were free and were being
thrown away.

**`sortOrder` was ordered by and never written.** Two production queries have sorted on
it since handoff 1 while only the seed set it, so every real seller's photographs tied at
zero and came back in insertion order by accident.

### One megabyte, and why that is not a refusal

`MAX_IMAGE_BYTES` dropped from 8 MB to 1 MB, and the bucket carries the same number. A
photograph off any current phone is two to eight megabytes, so a limit alone would refuse
exactly the files board 8b exists to accept — its premise is that a phone camera is fine.
`lib/images/downscale.ts` decodes, resizes to a 1600px long edge and re-encodes in the
browser until the file fits, before a byte is uploaded. Both the task screen and the media
library go through it; they write into the same bucket and cannot disagree about what a
photograph is.

Browser rather than server for two reasons: uploading eight megabytes over a UAE mobile
connection so the server can discard seven is the slowest version of this on the
connection least able to afford it, and `sharp` would be a native dependency and a
server-side processing step on a path that today never opens the bytes at all.

The one hard refusal is a long edge under 800px — a thumbnail or a logo dragged into the
wrong place, with nothing to recover.

### The Free photograph cap moved from 5 to 30

`photoLimit` on Free was 5 against a task that asks for 5 and a count that includes the
logo, so a Free seller with a logo had four slots, could never reach the target, and task
1 of the setup hub was uncompletable for them. That is the same defect board 8a found in
the team task. Thirty is board 8b §2's own figure; the migration guards on the old value
so it corrects the seeded default and never overwrites a number somebody has since chosen.
