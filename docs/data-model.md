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

The ladder ran to 4 and stops at 2:

```
0 unclaimed → 1 claimed → 2 licence verified (top)
```

**Tier 2 is the top rung.** Tiers 3 and 4 were "site visited" and "premises visited and
trading history audited", and both rested on somebody standing in the warehouse. Site visits
were withdrawn, so `visitedAt` and `visitedByStaffId` are gone, as are `SiteVisitRequest`,
`SiteVisitReport` and `SiteVisitPhoto`. A `business_verification_tier_range` CHECK holds the
ceiling, and `MAX_TIER` in `lib/verification/service.ts` is `TOP_ACHIEVABLE_TIER` so the
service and the column cannot name different ceilings.

The first pass at that cut moved `audited` down to rung 3 and re-based it on trading
history. That was the same mistake one step quieter: nothing measures a trading-history
audit, no screen sets it, and no listing ever held it — so rung 3 was again a requirement
nobody performs. Board 3e put **trade references** there, `reserved`, drawn so the ladder had
somewhere to go and carrying no affordance because it was not built.
`20260916090000_document_review` moved the eight rows still stored at 3 down to 2, which is
what their licence check actually supports.

**Rung 3 is now gone too.** Trade references will never be built, and that changes what
drawing it says: a reserved rung nobody intends to ship is a promise on a live screen, and
the seller reading "we will say so here when it exists" is reading a roadmap the roadmap does
not contain. `20260919090000_cut_trade_references` tightens the CHECK to `BETWEEN 0 AND 2`.
Drawing somewhere to go is only honest while somebody means to go there.

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
  showOnHome        Boolean  @default(false)  // /rfq/new's default trade; not the home grid since 6h
  acceptsRfq        Boolean  @default(true)
  requiresExtraCheck Boolean @default(false)
  publishThreshold  Int      @default(60)   // listings needed before landing pages publish
  verifiedShareMin  Float    @default(0.30)
}
```

**The verified share counts `verificationTier >= 2`** — `VERIFIED_TIER`, the same rung the
badge, the `/verified` filter, the home counters and the sitemap read. Four surfaces compute
it: `lib/seo/landing/stats.ts`, `lib/seo/landing/scope.ts` (`supply`, which feeds the
publish and hold decision), `lib/content/matrix.ts` and `lib/taxonomy/service.ts`.
`tests/integration/page-matrix.test.ts` pins all four to that rung, because a share computed
at tier 1 in one place and tier 2 in another is how the admin matrix and the sitemap once
disagreed — criterion 12's failure mode, live before handoff 5.

The consequence is worth stating rather than discovering. `sweepExpiredLicences` drops a
lapsed listing to `EXPIRED_LICENCE_TIER`, which is **1**, and 1 is below the share. So a
wave of licence expiries lowers a trade's verified share with nobody editing anything, and
can take a live area page under `verifiedShareMin` and unpublish it. That is correct
behaviour — a page whose suppliers are no longer verified should not go on claiming they are
— but it means landing pages move on the licence calendar as well as on supply.

```prisma
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
  buyerReference String?               // board 7c — the buyer's PO or job code, ≤ 40, set after acceptance
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
  paymentTerms PaymentTerms?  // board 7c — what the supplier quoted; null is "not stated", never the buyer's ask
  delivery     DeliveryTerms? // board 7c — included | charged_separately | collection
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
  unitPrice    Decimal          // a price — private to one buyer and one seller
  leadTimeDays Int?
}

model QuoteProposal {           // board 3j-s — a quote for work, in place of lines
  quoteId         String  @id  // one per quote; its presence makes the quote a proposal
  serviceId       String?      // SET NULL — the copies below are what the record keeps
  serviceName     String       // copied at send
  feeBasis        String?      // copied from the service's family at send, never chosen
  feeBasisLabel   String?
  feeAed          Decimal?     // the one amount, excl. VAT; private like every price
  mobilisationAed Decimal?     // null = not stated, 0 = a stated nil
  termMonths      Int?         // 1..120
  scope           String       // seeded from the scope sheet, edited per buyer, never written back
  turnaround      String?      // board 1n-s — the sheet's turnaround, copied at send
  deliverable     String?
  deliveredWhere  String?
  exclusions      String?
}
```

**A proposal is a quote** (board `3j-s`). The same `Quote` row — reference, revision, window,
status, fence, acceptance, expiry, extension, thread and first-reply stamp — with one
`QuoteProposal` beside it and **no `QuoteLine`**. Two database triggers hold the board's rules
rather than the form: `quote_line_not_on_proposal` refuses a line on a quote that has a proposal,
and `quote_proposal_immutable` refuses an edit to a proposal whose quote has left `draft` — a
revision is a new quote. An enquiry for work (a brief, or a line naming a service) is answered only
by `sendProposal`; `sendQuoteForBusiness` and the goods autosave refuse it. Nothing adds a fee up
across bases: every reader that printed a quote's total prints the fee on its basis instead, and
the pipeline's quoted total leaves proposals out and says how many.

`EnquiryRecipient` gains `declinedAt`, `declinedById` and `declineReason` — a supplier's own
decline, which the buyer's tracking page reads as *DECLINED · {reason}*. `state = declined` with
`declinedAt` null is still the buyer accepting somebody else; a CHECK keeps the timestamp and the
state agreeing.

**Proposals are compared, never ranked** (board `1n-s`). `lib/quote/proposal-footing.ts` is the only
code that multiplies a fee: an ongoing contract gets a twelve-month figure with its working (× 12
months, × visits at the brief's cadence, × an area the buyer states on the page, a fixed fee over a
12-month term as proposed — mobilisation added and named in every case), and every other case
returns a reason instead of a number. The brief's scale line is never parsed.

**An accepted proposal is the record of what was agreed, and it is fixed** (board `7c-s`). It
adds no table and stores no total: the page and its PDF read the accepted `Quote`, its
`QuoteProposal` and the `ServiceBrief` the proposal answered. The term's dates are computed — the
brief's `startsOn` to the day before the anniversary `termMonths` later — and when a review opens
is computed too (`lib/enquiry/accepted-proposal.ts`: at acceptance for goods, one delivery cycle
into an engagement). Two triggers keep the inputs still: `quote_accepted_terms_fixed` refuses a
change to an accepted quote's payment terms, window, revision or parties, and
`service_brief_fixed_once_accepted` refuses any change to the brief of an accepted enquiry.
`PaymentTerms` gains `in_arrears` and `on_completion`, offered only on a proposal
(`PROPOSAL_PAYMENT_TERMS`) — the proposal composer now states payment terms, on the same
`Quote.paymentTerms` column the goods composer writes.

Accepting a quote sets `Enquiry.contactReleasedToBusinessId`, marks the other recipients
`declined`, and creates nothing else. There is no order, no fulfilment record, no payment.

**Nothing is written to a quote after acceptance** (board `7c`). `lib/quote/fence.ts` is the one
rule every writer of a quote reads — send, autosave, extend and the lead screen — and a send
checks it again under a row lock on the enquiry, the same lock `acceptQuote`'s conditional claim
takes, so a send and an accept racing cannot both land. The accepted record is a read of this
one `Enquiry`; its totals are computed from `QuoteLine` at render and never stored.

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
  sellerRepliedAt DateTime?
  replyRemovedAt DateTime?          // board 11c B4 — staff took the reply down
  replyRemovalReason String?        // required if replyRemovedAt set; the text stays
  heldAt         DateTime?
  heldReason     String?            // required if heldAt set
  removedAt      DateTime?
  removalReason  String?            // required if removedAt set
}

model ReviewDispute {
  id         String @id @default(cuid())
  reviewId   String
  businessId String                 // the business the review is about, and the one disputing it
  raisedById String                 // owner only — a dispute is a claim about a named customer
  ground     ReviewDisputeGround    // no_traceable_enquiry | abuse | private_information | provably_false
  detail     String                 // the case, not the label
  outcome    ReviewDisputeOutcome?  // upheld | refused. Two, because a review cannot be corrected
  outcomeReason String?             // required if outcome set
  resolvedAt DateTime?
  decidedById String?
}

model SupplierReport {
  id        String @id @default(cuid())
  subjectBusinessId String
  reporterId String?
  reviewId  String?     // board 11c B6 — the incentivised-review log had nothing to point at
  enquiryId String?  @unique  // board 7c B8 — one report per accepted enquiry; its thread is the evidence
  kind      ReportKind   // closed | wrong_details | wrong_trade | claim_conflict | off_platform_payment | content | review_integrity | accepted_quote
  detail    String?
  outcome   ReportOutcome?  // seller_corrected | upheld | no_action
  outcomeReason String?
}
```

Three reports on the same field auto-flag the listing. `off_platform_payment` skips the queue.

**A review cannot exist without an enquiry.** `enquiryId` is `NOT NULL` and `UNIQUE` with a
foreign key, and `canReview` admits a buyer only on an accepted quote or an enquiry this
supplier actually replied to — there is no import, admin form or API path that produces one
without. So the two provenance rungs (`accepted_quote`, `verified_enquiry`) are the whole
ladder, and a third "no enquiry on record" state is unreachable rather than merely unbuilt.
Board 11c `Q1` asked this as a blocking question; the schema had already answered it.

**A dispute is not a `SupplierReport`.** A report is filed *against* a business, by a buyer or
by the platform, carries a free-text `subjectField` for the three-strikes auto-flag, and
resolves to one of three outcomes. A dispute is filed *by* the business, about a review, on one
of four fixed grounds, and resolves to one of two. They render on one screen and stay two
tables — sharing one would make `subjectBusinessId` mean the complainant on some rows and the
accused on others.

Upholding a dispute removes the review through `removeReview`, in the dispute's own
transaction. `review.remove` is ops lead alone, so a moderator can refuse a dispute and cannot
grant one; the console offers them the refusal control only.

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
  id          String   @id @default(cuid())
  actorId     String            // Restrict: a person with log entries cannot be deleted
  action      String            // AUDIT_ACTIONS in lib/audit/types.ts — each has a sentence
  subject     String            // entity type + id
  reason      String            // REQUIRED — no nullable
  before      Json?
  after       Json?
  blastRadius Int?              // board 4i B4 — how many things a bulk decision touched
  blastUnit   String?           // products | listings | pairs | … — set exactly when blastRadius is
  createdAt   DateTime @default(now())
}
```

Write it in the service layer. A mutation that can reach the database without an audit row is
a bug, and the test suite should prove it cannot.

**Append-only, by trigger** (board 4i `B6`). `audit_event_append_only` refuses every UPDATE,
and every DELETE unless the session has set `app.audit_maintenance` — which only integration
test cleanup does, through `tests/integration/audit-cleanup.ts`. No screen offers an edit, and
no path could make one.

**Blast radius is a count the write returned**, never an estimate: an `updateMany().count`, a
`createMany().count`, or the length of the list the same transaction wrote. A publish that
changes what products *read* without writing them (a spec template version) has no radius.

## Account health — board 4f

```prisma
model Business {
  responseTimeMedianMs Int?     // measured, existing
  replyRate            Float?   // 4f — answered / counted, 0..1, same recipients and window
  replySample          Int?     // 4f — how many enquiries replyRate counted; set with it, by CHECK
}

model AccountSegment {          // 4f B8 — a saved query, never a saved list
  name        String @unique
  query       String            // canonical query string from lib/accounts/filter.ts
  createdById String
}
```

**Health is never stored** (B1). `lib/accounts/health.ts` holds the thresholds and a classifier;
`lib/accounts/health-where.ts` writes the same rules as a `where` for counting and filtering; an
integration test holds the two to the same answer for every seeded business, and the states
partition the directory.

**Reply rate shares the median's definition** (B5): `EnquiryRecipient` rows in the last
`WINDOW_DAYS`, measured by `measureReplies` in the daily metrics job. A reply is anything that
stamps `firstReplyAt`. An unanswered enquiry counts against the rate only once its window has
closed — the rule `effectiveState` uses before it says `no_response`. Null below `MIN_SAMPLE`.

**Paying** is a subscription in `active` or `past_due` on a plan with a price (B2) — the same
pair revenue counts as MRR. A trial, a Free account and an unclaimed listing are not paying.

**Upgrade candidacy is a dated event** (B6): a `product_cap_refused` or `service_cap_refused`
`ProductEvent`, written where a plan cap refuses a seller, or a `MissedEnquiry` at the monthly
cap, inside 30 days, on Basic.

## Revenue — board 4g

```prisma
model MrrMovement {
  kind                 MrrMovementKind    // which way: new, expansion, reactivation, contraction, churn
  cause                MrrMovementCause?  // 4g — why: plan_change, term_change, cancellation, dunning_drop
  subscriptionChangeId String?            // 4g — the scheduled change it carried out
}
```

**Nothing on the board is stored as a metric.** `lib/billing/revenue-board.ts` reads one Dubai
calendar month from `mrr_movement`, `subscription_change`, `payment_attempt` and
`placement_slot`; `lib/billing/revenue-period.ts` does the arithmetic, and every ratio has one
formula there:

```
ending        = starting + new + came back + upgrades + downgrades + term + cancellations + lapsed   (lines signed)
nrr           = (starting + upgrades + downgrades + term + cancellations + lapsed) / starting   // B3: no new, no came back
revenue churn = |cancellations + lapsed| / starting
customer churn= accounts cancelled or lapsed / accounts paying at the start
arpa          = ending / accounts paying at the end                                           // B7: 4f's paying count
placement     = Σ slot monthly list price × time live in the month / month length             // B4: never in MRR or ARPA
```

**An account's state at an instant** is every movement before it, summed, with the plan of the
latest. Starting and ending MRR, both paying counts, revenue by licence emirate (B9, through
`AUTHORITY_EMIRATE`) and the plan mix are that one read grouped different ways, so they sum to
each other by construction.

**Cause is why, kind is which way.** A churn row is a cancellation or a D14 dunning drop — two
lines, because a lapse gives no reason (B8). An expansion or contraction is a plan change or a
billing-term switch — a term switch is neither an upgrade nor a downgrade. Every
`recordMovement` caller passes a cause; the migration backfilled earlier rows from structure and
the two churn writers' notes, and `causeOf` reads a null the same way.

**Reasons count through the pointer** (B5, criterion 5): a cancellation's reason is on the
`subscription_change` row the churn movement points at, so the reasons sum to the cancellations
line. A cancellation from before board 11h has no row and reads as *not recorded*.

**The reply-rate cross-reference** (B6) measures each *not enough enquiries* account with
`measureReplies` over the 90 days before it asked to cancel, against 4f's 50% threshold. Too few
enquiries to measure is its own count, never a zero.

**Failed payments at an instant**: the last payment attempt before it failed, or the
subscription is past due since before it with no attempt to say otherwise — and the account
still has MRR. At risk, not lost; churn happens when the D14 drop writes its movement.

**Closures** (11i) are counted apart from churn (Q2). A closure cannot happen while a subscription
charges, so its money has already left through a cancellation.

## Ops CRM — board 12d

```prisma
model CrmTask {
  businessId   String        // one open task per business, by partial unique index
  signal       CrmSignal     // held_page | zero_result | unclaimed_demand | cap_reached | churn_risk
  signalRef    String        // the scope, category, cap or renewal the signal is about
  signalValue  Int           // the number the call opens with
  signalFacts  Json          // what the row and the banner render from, snapshotted by the run
  demandScore  Int           // sort key, recomputed every run — never a typed priority
  state        CrmTaskState  // queued | called | callback | unreachable | won | lost | parked | cleared
  assignedToId String?       // the lock
  callBackAt   DateTime?     // set with callback, by CHECK
  coolingUntil DateTime?     // a no-answer or a follow-up waits this long
  closedAt     DateTime?     // with closeReason, by CHECK
}

model CallOutcome { taskId String?  scriptId String? }   // 12d adds the task and the script
model CrmContactReveal { taskId  staffId  locationId }   // a number shown to staff (B9)
model CrmSyncRun { startedAt  finishedAt  derived  created  won  cleared  triggeredById }
```

**Nobody types a task** (B1). `lib/crm/sync.ts` is the only code that creates one, and it and
the call logger are the only code that closes one; `tests/unit/crm-writers.test.ts` scans the
tree for it. The signals are derived in `lib/crm/derive.ts` from writers earlier boards
shipped: 6f's area matrix (`recruit` status), `ZeroResultQuery`, `EnquiryRecipient`,
`MissedEnquiry` and 4f's cap-refusal events, and 4f's `stateWhere("churn_risk")` with the
renewal still ahead (B6). One signal per business, strongest first: churn risk, cap,
unclaimed demand, held page, zero result.

**A task leaves when its signal clears, whoever cleared it** (B7): `won` when the thing the
call was for happened — claimed, verified, upgraded, reply rate recovered — and `cleared`
with the reason otherwise (`signal_gone`, `renewal_passed`, `stopped_paying`,
`business_gone`). A task opened for a business with call history starts where the last call
left it; a no, a wrong number or a closure keeps it off the list for ninety days.

**The run** is the daily job's last step, after reply rates, tiers and area pages have moved,
or *Refresh signals* (refused inside five minutes of the last run).

**6f's `recruit` status now includes a scope short only on verified share.** Before 12d, a
scope past its listings need with too few verified listings read `queued_copy` and went to
content ops, who cannot verify a licence. `supplyGap` in `lib/publish-threshold.ts` feeds
`pageState` the verifications needed, and opportunity divides searches by every recruit —
listings to add plus listings to verify — the same count the CRM banner states.

## Staff — board 4i

```prisma
enum Role { buyer, seller_owner, seller_manager, seller_sales, seller_finance,
            staff_moderator, staff_finance, staff_ops_lead }   // staff_field RETIRED and removed

model User {
  roles              Role[]      // the decision; the JWT claim mirrors it
  staffLastActiveAt  DateTime?   // measured by requireStaff(), at most every 5 min
  staffDeactivatedAt DateTime?   // cleared when an invitation is accepted again
}

model StaffInvite {
  email        String          // lowercased, on STAFF_EMAIL_DOMAINS
  role         Role            // one staff role; CHECK refuses anything else
  tokenHash    String @unique  // SHA-256 of a 256-bit token that exists only in the link
  invitedById  String
  expiresAt    DateTime        // 72 hours; an expired invitation is resendable, not revoked
  lastSentAt   DateTime        // resend refused within 15 minutes
  sendCount    Int
  acceptedAt   DateTime?
  acceptedById String?
  revokedAt    DateTime?
}
```

There is no staff table beside `User.roles`. Membership is the column `can()` decides from,
so a person holding a staff role cannot be missing from the roster. One invitation is
outstanding per address, by partial unique index.

**Roles are decided by the record, not the claim.** `getActor` read roles from the JWT claim
first, and compared a stale claim by length — so a revoke whose claim write failed never took
effect, and a moderator moved to finance stayed a moderator. The profile row decides now, and
the claim is repaired to match.

## Accounts and sign-in — board 7a

One `User`, both roles (`B1`). Mobile is the primary identity; a password is optional.

```prisma
model User {
  // …
  suspendedAt   DateTime?   // written only by lib/account/suspension.ts; reason on the audit row
  passwordSetAt DateTime?   // null for most accounts — nothing may assume a password exists (B3)
}

enum AuthAttemptKind { otp_request otp_verify reset_request password_verify }
//                                                            ^ its own kind: a password lockout
//                                                              must leave the code path open (B5)

model PasswordReset {        // B6 — ours, because Supabase ties link expiry to code expiry
  userId    String
  channel   PasswordResetChannel   // email (a link) | sms (a verified code)
  tokenHash String  @unique        // SHA-256; the token lives only in the email or a cookie
  expiresAt DateTime               // CHECK: at most one hour after created_at
  usedAt    DateTime?              // claimed by conditional update — single-use
}

model TermsAcceptance {      // B10 — a version and a timestamp, never a boolean
  userId         String
  termsVersion   String      // the document's effectiveFrom, YYYY-MM-DD (CHECK)
  privacyVersion String
  acceptedAt     DateTime    // when the box was ticked, not when the code was typed
  source         String      // "signup"
  @@unique([userId, termsVersion, privacyVersion])
}
```

A suspension is `account.suspend` (ops lead), writes `account_suspended` / `account_reinstated`
with the reason, ends every session and emails the reason. The sign-in screen says a reason was
emailed and never shows it (`B7`). `getActor` returns no actor for a suspended profile on every
request.

## The buyer's inbox and saved searches — board 10e

Nothing on the inbox is stored as a status. Bucket, verb, tone and the close cell are derived
from the rows (`lib/enquiry/inbox-status.ts`), so a chip cannot drift from the table (`B2`).

```prisma
model Enquiry {
  // …
  resentFromId String?   // B3 — the expired enquiry this one re-sends. SET NULL on delete;
                         // CHECK resent_from_id <> id. The old row is never edited.
}

model EnquiryRecipient {
  buyerNudgedAt DateTime? // "nudged_at" — B5, one per seller per enquiry, ever. Written by
                          // nudge() and nudgeUnanswered() with a conditional update.
}

enum SavedSearchCadence { daily weekly when_listed }

model SavedSearch {
  query        String              // the results page's query string, verbatim
  categoryId   String?             // the /c/:category page it was saved on; SET NULL on delete
  tab          String              // businesses | products (CHECK)
  cadence      SavedSearchCadence  // when_listed by default for a search that found nothing
  zeroResult   Boolean             // B6 — decided by counting at save, never taken from the page
  lastSeenAt   DateTime?           // B7 — opening sets it; the new-match count counts from here
  lastRunAt    DateTime?           // the sweep's own clock, per cadence
  lastMatchAt  DateTime?           // newest listing that matched; null keeps a zero-result search demand
  newCount     Int                 // matches listed since lastSeenAt, as of lastRunAt
  alertedCount Int                 // what the last email said; the next email waits for newCount to pass it
}
```

A new match is a business whose `publishedAt`, or a product whose `createdAt`, is after
`lastSeenAt` (or the save), counted with the results page's own `businessWhere` / `productWhere`.
The legacy `alerts` boolean is unread and can be dropped in a later migration.

Board 12d's `zero_result` signal (`lib/crm/derive.ts`) carries saved searches with `zeroResult` and
no `lastMatchAt` as `alertsWaiting` per trade: counted into the demand score, said in the WHY cell,
and enough on its own to put a trade on the list in a month with no fresh empty searches. The inbox's history card is the buyer's alone (`B9`,
`B10`): nothing on a seller surface reads it.

## Closing a business — board 11i

Closure is a **status transition, not a delete**. Nothing about the business is removed at
the moment it closes, which is what lets it be reversed exactly.

```prisma
model Business {
  closureRequestedAt DateTime?   // set when the listing comes down; null again on reversal
  closedAt           DateTime?   // set when the cooling-off window ends; cleared only by a staff reopen
}

model BusinessClosure {
  initiator     ClosureInitiator  // owner | platform (B8, lapsed licence)
  requestedById String            // owner, or the ops lead who gave notice
  ownerId       String?           // who the email goes to and who may reverse
  effectiveAt   DateTime          // = requestedAt for an owner; +14 days notice for platform
  appliedAt     DateTime?         // when it actually came down
  finalAt       DateTime          // last moment to reverse, fixed at request
  reversedAt / reversedById / reversedVia   // email | dashboard | licence_renewed | staff
  finalisedAt   DateTime?
  tokenHash     String @unique    // SHA-256 of the emailed token; the token is never stored
  snapshot      Json              // publishedAt, seats and roles, subdomain — what a reversal restores
  emailDeliveredAt  DateTime?
  documentsPurgedAt DateTime?     // trade licence and VAT certificate, 12 months after finalisedAt
}
```

- **Coming down nulls `publishedAt`.** Every public read already honours it, so closure needed
  no new filter on 118 queries. The original value lives in the snapshot, and a reversal puts
  that value back rather than `now()`, so the listing's age and its sitemap `lastmod` survive.
- **Seats are revoked the way `removeSeat` revokes them** — business and branch nulled, seller
  roles stripped, claims repaired — and every revoked user's `auth.sessions` rows are deleted.
  The owner signs in again to a user with no seat, which is what routes them to the reversal
  screen. A reversal restores only seats whose user has not joined another business since.
- **One open closure per business**, held by a partial unique index on
  `reversed_at IS NULL AND finalised_at IS NULL`. Four checks pin the rest: a closure ends one
  way, a reversal says how, the window runs forward, and an owner closure applies immediately.
  On `business`, a closed business must have been requested, and a requested one is
  unpublished.
- **Retained, not deleted:** enquiry threads and quotes (the buyer's record as much as the
  seller's), reviews (reachable by direct link from the noindex notice), tax invoices for five
  years, and the licence documents for twelve months — Privacy §07's periods, not new ones.
- **The slug is reserved forever.** A final closure does not free `/b/:slug`; the same trade
  licence reclaims it through `reopenClosedBusiness`, which staff run under `business.close`
  and which leaves `publishedAt` null so the owner goes live through the usual gate.
- The nightly job applies platform notices whose 14 days have passed, withdraws any whose
  licence was renewed (`licence_renewed`), holds any with a paid subscription still running,
  finalises windows that have ended — deleting the revoked seats' notification channels then,
  not at request, so a reversal does not make every seat re-verify — and purges retained
  documents that are due.

## Derived, never stored as editable

`responseTimeMedian` — from enquiry-to-first-reply timestamps. `profileStrength` — weighted
completeness. `specCompleteness` — filled required fields ÷ template fields. `quotedValue` —
sum of accepted quote lines, labelled self-reported everywhere it appears.

None of these are seller-editable. That is what makes them worth showing.

### What they were yesterday — the `3a`/`3l` amendment

Every one of the four above is a **current-value column** that the nightly jobs overwrite. The
platform could say what a factor *is* and never what it *was*, and board `3l` had shipped a rule
requiring the second: every attribution sentence must trace to *"a factor changed, by how much,
in the window."*

`ListingFactorDay` is the history that rule needed. One row per published listing per night,
holding three vectors: the six normalised `scores` the ranker consumed, the `raw` measurements
behind them, and the `weights` in force that night. Vectors rather than named columns, so a
seventh factor is a key and not a migration.

Storing the **weights per day** is the part that matters most and is easiest to miss. A staff
slider move on board `12c` shifts every listing in a category and none of them did anything —
and without a record of what the weights were, that fall is indistinguishable from the seller's
own decline and gets billed to them. `lib/analytics/attribution.ts` splits the two apart
exactly, using `w'·s' − w·s ≡ w(s' − s) + s'(w' − w)`.

`CategoryRankDay` is the other half: where each listing sat in each category listing, computed
nightly whether anybody browsed or not. It sits **beside** `CategoryPositionDay` rather than
replacing it, because the two answer different questions — that table counts impressions, which
only a real buyer can generate, and this one holds the position, which is true on a quiet day.
An arrow computed across a hole in an impression-driven series is not absent, it is wrong.

`total` is stored rather than derived at read time, for the same reason a count is a query and
never a constant: a category that grew from five listings to forty would otherwise restate every
historical rank against a set that did not exist then.

Both join the 90-day prune in `lib/analytics/retention.ts`, which now covers six tables. They
are the only two here that grow on a directory with no visitors at all.

## The ranking, and how a change to it reaches a buyer

```prisma
model RankingWeights { id "current"; six Int; browseRelevanceMode String }   // live
model RankingDraft   { id "current"; six Int; browseRelevanceMode String;    // unpublished
                       savedById; savedAt;
                       previewStartedAt; previewRanAt; previewFor Json; preview Json }
model RankingPublish { id; day Date; publishedAt; six Int;                   // history
                       browseRelevanceMode; reason;
                       categoriesMoved; listingsMoved; sellersTold; publishedById }
```

Board `12c`. Three rows for one number set, and the split is the point.

**`RankingWeights` is what every buyer is ranked by.** One row, read by `searchBusinesses`,
the landing templates, `/pricing`'s plan-share claim and the nightly snapshot. Nothing writes
it but a publish.

**`RankingDraft` is what an ops lead is working on.** Saving it moves nothing a buyer sees,
which is what makes *"publishing fires the seller disclosure and saving does not"* structural
rather than a flag: the disclosure is derived by `lib/analytics/attribution.ts` from the
weights each night's `ListingFactorDay` was scored under, so it can only fire once the live
row has actually moved.

`previewFor` holds the exact vector the stored preview describes. Staleness is that
comparison and not a timestamp — the draft moving past it is the only thing that can
invalidate a preview, and a count from a superseded draft is worse than no count.

**`RankingPublish` is one row per publish, not one per day.** The spec asked for a day grain
so the position amendment could diff consecutive rows; that reader shipped first and reads
`ListingFactorDay.weights` instead. Two publishes in one afternoon are two decisions with two
written reasons, and a row keyed by day keeps only the second. `day` survives as a column for
the 90-day prune and the history tab's grouping.

`sellersTold` is the number that was on the button when it was pressed, kept as the claim that
was made rather than recomputed later against a directory that has moved.

### Boosts name a listing or a category, never both

```prisma
model ListingBoost {
  businessId  String?      // exactly one of these two, by check constraint
  categoryId  String?
  emirate     Emirate?     // narrows a category boost only
  points      Int          // 1..25, added to the weighted sum
  reason      String       // NOT NULL
  expiresAt   DateTime     // NOT NULL, at most 90 days
}
```

`listing_boost_one_target` is a check constraint because Prisma has no syntax for it: two
optional relations permit a row with both set — one points value meaning two things — and a
row with neither.

**The cap is 25 points per business, summing every live boost that reaches it**, its own and
the category boosts it falls under. Counting the category ones is what stops the cap being
walked around by aiming one category higher instead of one listing. A boost only ever raises;
removing a business from results is `business.suspend` on `/admin/businesses`.

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

## Homepage curation — board 6h

```prisma
model HomepageSlot {
  id         String   @id @default(cuid())
  position   Int                // 1–4, unique, CHECK in SQL — the order is the decision
  businessId String   @unique   // one slot per business
  addedById  String   @db.Uuid  // staff actor; every change is also an audit row
  addedAt    DateTime @default(now())
}

model CuratedQuery {
  id        String  @id @default(cuid())
  label     String            // "HVAC maintenance AMC", 2–40 chars
  query     String            // the /search query string it runs, normalised
  position  Int               // 1–6, unique — six is the hero row's cap
  addedById String? @db.Uuid  // null only for the six the migration carried over
}
```

The home page has nine rails and these are the two a person chooses.

- **No `eligible` column and no `featuredUntil`.** Eligibility is `featureBlock` in
  `lib/content/homepage-rules.ts`, read live on every render: Tier 2, published, not suspended,
  merged or closed. A lapsed licence empties the card on the next sweep without anything writing
  to the slot, and the slot stays held — rendered empty, never backfilled — until a person
  removes it. Scheduling, if it comes, is a second model.
- **No plan or payment input.** Paid visibility is `PlacementSlot`, in search results, labelled.
- **A chip's query goes through `parseSearchQuery` and `toSearchParams`** on the way in, so it can
  carry only keys the results page understands.

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
