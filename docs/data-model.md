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
  verificationTier   Int      @default(0) // 0..4 — STAFF WRITE ONLY, ops_lead role
  verifiedAt         DateTime?
  visitedAt          DateTime?
  visitedByStaffId   String?
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

`verificationTier` drops to 2 automatically the day `licenceExpiry` passes — a scheduled job,
not a manual step. No grace period. Tier 3 additionally requires `visitedAt`.

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
  published     Boolean  @default(false)
}
```

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
  siteVisitIncluded Boolean
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
since 2019, and the work at the other end is a person reading it. It is modelled on
`SiteVisitRequest`, which is the same shape of promise. Every staff move on the row writes
an audit row with a written reason; the seller's own create and cancel do not, because the
subject acting on their own data is what the audit log exists to distinguish itself from.

### The score these tables do not change

`Business.profileStrength` keeps the five components in `lib/metrics/profile-strength.ts`
— identity 35, photos 20, catalogue 20, filterable specs 15, team 10. Board 8a's handoff
drew a seven-component table including locations, the verification tier and the site visit.
It is not adopted: a location is a **publish gate**, not a lever, and `goLive` refuses
without one; the verification tier is platform-owned and not a seller's to earn; and the
site visit is plan-gated, so putting it in the denominator makes a Free seller's meter
uncloseable. What the handoff actually requires — that the per-task percentage chips are
arithmetic on *this* seller's score rather than constants — is what `lib/setup/tasks.ts`
computes, from `strengthItems()`.
