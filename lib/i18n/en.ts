import type { Catalogue } from "./types";

/**
 * The English catalogue. Flat keys, dot-namespaced.
 *
 * Category names, area names, emirate names and free zone names are NOT here.
 * They are translatable records in the database — a taxonomy that a staff member
 * edits without a deploy, and that carries Arabic synonyms for query routing.
 *
 * Voice rules, from design-system §08: sentence case everywhere except mono
 * eyebrows and column heads; no exclamation marks; no emoji; no "just", "simply"
 * or "easily"; errors say what is wrong and what correct looks like, and never
 * blame the user.
 */
export const en = {
  // ── Vocabulary. These words are load-bearing; see the table in CLAUDE.md. ──
  "term.enquiry": "Enquiry",
  "term.enquiry.plural": { one: "{count} enquiry", other: "{count} enquiries" },
  "term.rfq": "RFQ",
  "term.quote": "Quote",
  "term.quote.accepted": "Accepted quote",
  "term.quoted_value": "Quoted value",
  "term.quoted_value.note": "Self-reported by the supplier",
  "term.supplier_report": "Supplier report",
  "term.subscription_credit": "Subscription credit",
  "term.trade_licence": "Trade licence",
  "term.trn": "TRN",
  "term.free_zone": "Free zone",
  "term.emirate": "Emirate",

  // ── Availability. Enum values, rendered. ──
  "availability.in_stock": "In stock",
  "availability.made_to_order": "Made to order",
  "availability.indent": "Indent order",
  "availability.out_of_stock": "Out of stock",

  // ── Actions ──
  "action.save": "Save",
  "action.cancel": "Cancel",
  "action.enquire": "Send enquiry",
  "action.notify_me": "Notify me",
  "action.reveal_phone": "Show number",
  "action.compare": "Compare",
  "action.in_compare": "In comparison",
  "compare.tray": { one: "{count} supplier selected", other: "{count} suppliers selected" },
  "compare.open": "Compare them",
  "compare.clear": "Clear",
  "compare.full": "Comparison is full",
  "action.retry": "Try again",

  // ── The four empty states. They are four different things. ──
  "empty.first_run.title": "Nothing here yet",
  "empty.filtered.title": "No results for these filters",
  "empty.filtered.action": "Clear filters",
  "empty.failed.title": "This did not load",
  "empty.failed.body": "The list could not be fetched. Reference {code}.",

  // ── Errors. What is wrong, and what correct looks like. ──
  "error.required": "{field} is required",
  "error.phone.format": "Enter a UAE number, for example 04 883 4120 or 050 641 2288",
  "error.trn.format": "A TRN is 15 digits",
  "error.reason.required": "Write a reason. It is recorded against your name in the audit log.",
  "error.permission": "Your role cannot do this. Reference {code}.",

  // ── Counts. Say the number. ──
  "count.suppliers_in_area": {
    one: "{count} supplier in {area}",
    other: "{count} suppliers in {area}",
  },
  "count.products": { one: "{count} product", other: "{count} products" },
  "count.reviews": { one: "{count} review", other: "{count} reviews" },

  // ── Form furniture ──
  "field.required": "required",
  "field.optional": "optional",
  "field.counter": "{used} / {limit}",
  "field.clear": "Clear",
  "field.remove": "Remove {item}",
  "field.more": "+{count}",
  "field.no_matches": "No matches",
  "field.filter_placeholder": "Filter",
  "field.choose": "Choose",
  "field.decrease": "Decrease {field}",
  "field.increase": "Increase {field}",
  "field.opens_at": "Opens at",
  "field.closes_at": "Closes at",
  "field.close_before_open": "Closing time must be later than opening time",
  "field.select_all": "Select all rows",

  // ── Search ──
  "search.label": "Search suppliers and products",
  "search.placeholder": "Gate valve, DN100, Al Quoz",
  "search.clear": "Clear search",
  "search.results_title": "Search results",
  "search.results_for": "Results for “{query}”",

  // ── Upload ──
  "upload.idle": "Drop a file here, or choose one",
  "upload.hint": "PDF, JPG or PNG up to 10 MB",
  "upload.uploading": "Uploading",
  "upload.remove": "Remove file",
  "upload.retry": "Try again",
  "upload.too_large": "That file is 24 MB. The limit is 10 MB.",

  // ── Trade fields, for the gallery and the forms that follow ──
  "trade.licence_number": "Trade licence number",
  "trade.licence_hint": "As printed on the licence, including the authority prefix",
  "trade.trn": "TRN",
  "trade.trn_hint": "15 digits",
  "trade.emirate": "Emirate",
  "trade.areas": "Areas served",
  "trade.lead_time": "Lead time",
  "trade.lead_time_range": "{from} to {to} days",
  "trade.min_order": "Minimum order quantity",
  "trade.certifications": "Certifications",
  "trade.requirement": "What do you need?",
  "trade.requirement_hint": "Sizes, quantities, delivery area and when you need it",
  "trade.whatsapp_updates": "Send quote updates over WhatsApp",
  "trade.whatsapp_updates_hint": "Applies as soon as you switch it. No save needed.",
  "trade.publish_listing": "Publish this listing",
  "trade.hide_phone": "Show my number only to buyers who send an enquiry",
  "trade.terms": "Payment terms",
  "trade.terms_advance": "Advance",
  "trade.terms_net30": "30 days",
  "trade.terms_lc": "Letter of credit",

  // ── Actions used by more than one surface ──
  "action.send_enquiry": "Send enquiry",
  "action.send_quote": "Send quote",
  "action.save_draft": "Save as draft",
  "action.duplicate": "Duplicate",
  "action.archive": "Archive",
  "action.delete": "Delete",
  // Not "Delete". Taking a row out of a draft list is not a destructive action
  // — nothing is written until Save — and §05's destructive grammar (a confirm
  // dialog, or an Undo toast) would be ceremony over a row somebody can add
  // back by typing it.
  "action.remove": "Remove",
  "action.more": "More actions",
  "action.row_menu": "More actions for this row",

  // ── Gallery. A dev surface, but its copy goes through t() like anything else,
  //    so the acceptance grep has nothing to find and the catalogue is exercised.
  "gallery.tab_businesses": "Businesses",
  "gallery.tab_products": "Products",
  "gallery.billing": "Billing · plan comparison",
  "gallery.billing_note": "Board 11f. Every cell states what the plan keeps out of what the seller has now — one denominator per row.",
  "gallery.billing.over": "Over the cap",
  "gallery.billing.within": "Inside every plan",
  "gallery.billing.empty": "Nothing yet",
  "gallery.cancel.over": "11h — what changes, over the Free cap on every meter",
  "gallery.cancel.within": "11h — a seller Free already holds everything of",
  "gallery.cancel.empty": "11h — cold start: nothing stored, nothing booked",
  "gallery.billing.plan_status": "Plan status",
  "gallery.billing.invoice": "Tax invoice · A4",
  "gallery.billing.invoice_partial": "Issued before 11g",
  "gallery.billing.cancel_entry": "Cancel entry · board 3m",
  "gallery.billing.cancel_scheduled": "Cancellation scheduled · the banner it becomes",
  "gallery.billing.failed": "Failed payment",
  "gallery.density": "Density",
  "gallery.roomy": "Roomy",
  "gallery.comfortable": "Comfortable",
  "gallery.compact": "Compact",
  "gallery.build_state": "Components built, by tier",
  "gallery.jump_to": "Jump to a component",
  "gallery.specimen": "{component} specimen, {state}",
  "gallery.tone_note": "Row tint carries meaning and nothing else: moss for selected, warn for attention, bad for blocked. Rows 4 and 5 above carry attention and blocked. There is no decorative tint and no zebra striping.",
  "gallery.pagination_note": "Both examples are above the 50-row threshold. Below it the control renders nothing at all — page numbers under nine rows read as a broken page.",
  "gallery.locked_note": "Sponsored placement is on the Pro plan.",
  "gallery.see_plans": "See plans",
  "gallery.tabs_label": "Storefront sections",
  "gallery.breadcrumb_label": "Breadcrumb",
  "gallery.open_modal": "Edit requirement",
  "gallery.list_your_business": "List your business",
  "gallery.panel_profile_body": "Trade name, description, languages and team size.",
  "gallery.panel_placement_body": "One slot per category and emirate, always labelled.",
  "gallery.panel_documents_body": "Trade licence, VAT certificate, tenancy contract.",
  "gallery.queue_body": "Submissions waiting on a moderator decision.",
  "gallery.sidebar_note": "Same component, same config, two actors. A sales seat cannot edit the listing or manage billing, so those items render locked rather than disappearing — a seller cannot ask for access to something they never knew existed.",
  "gallery.mixing_note": "A toggle applies immediately and a checkbox applies on save. Putting both in one section teaches a user two rules at once, and they will pick the wrong one. Choose per section, not per control.",

  // ── Navigation. The sidebar is a config; these are the strings it resolves. ──
  "nav.group.overview": "Overview",
  // The seller rail's first group. Board 8a's render heads it "Storefront" and
  // puts Overview in it — the listing and the thing buyers see are one subject.
  "nav.group.storefront": "Storefront",
  "nav.group.listing": "Listing",
  "nav.group.catalogue": "Catalogue",
  "nav.group.demand": "Demand",
  "nav.group.growth": "Growth",
  "nav.group.account": "Account",
  "nav.group.supply": "Supply",
  "nav.group.taxonomy": "Taxonomy",
  "nav.group.commercial": "Commercial",
  "nav.group.platform": "Platform",

  "nav.dashboard": "Overview",
  "nav.listing": "Listing profile",
  "nav.locations": "Locations",
  "nav.hours": "Hours & Ramadan",
  "nav.verification": "Verification",
  "nav.products": "Products",
  "nav.media": "Media",
  "nav.leads": "Leads & RFQ",
  "nav.quotes": "Quotes",
  "nav.reviews": "Reviews",
  "nav.questions": "Questions",
  "nav.analytics": "Analytics",
  "nav.promote": "Sponsored placement",
  "nav.billing": "Subscription",
  "nav.team": "Team",
  "nav.settings": "Settings",

  "nav.platform": "Platform overview",
  "nav.queue": "Approval queue",
  "nav.reports": "Supplier reports",
  "nav.businesses": "Businesses",
  "nav.ingest": "Licence importer",
  "nav.crm": "Recruitment",
  "nav.categories": "Taxonomy",
  "nav.spec_library": "Spec library",
  "nav.areas": "Emirates & areas",
  "nav.attributes": "Attribute dictionary",
  "nav.search_ranking": "Ranking & boosts",
  "nav.content": "SEO page matrix",
  "nav.subscriptions": "Subscriptions",
  "nav.revenue": "Revenue",
  "nav.dunning": "Failed payments",
  "nav.staff": "Staff & roles",
  "nav.audit": "Audit log",
  "nav.support": "Support desk",
  "nav.compliance": "PDPL requests",
  "nav.group.content_seo": "Content & SEO",
  "nav.content_lists": "Curated lists",
  "nav.content_guide_subjects": "Guide subjects",
  "nav.group.content": "Editorial",
  "nav.dedupe": "Dedupe & merge",
  "nav.users": "Users",
  "nav.plans": "Plans & entitlements",
  "nav.invoices": "Invoices & credits",
  "nav.tax": "VAT export",
  "nav.storefront_templates": "Storefront templates",
  "nav.notifications": "Notification templates",
  "nav.strings": "Localisation",
  "nav.content_guides": "Guides",
  "nav.content_attribution": "Attribution",
  "nav.content_home": "Homepage curation",
  "nav.content_testimonials": "Entry page quotes",
  "nav.content_redirects": "Redirects",
  "nav.api": "API keys & webhooks",

  "table.error.title": "This list could not be loaded",
  "table.error.action": "Reload the page. If it keeps failing, the queue is still there — nothing has been lost.",
  "table.band.verified": "Verified · {count}",
  "table.band.unverified": "Not yet verified · {count}",
  "table.total": "{count} businesses · {value} quoted",
  "table.page_size": "Rows per page",

  "admin.mark": "Staff",
  "admin.overview.title": "Platform overview",
  "admin.overview.eyebrow": "Console",
  "admin.overview.meta": "{late} of {waiting} in the queues are past their service level",
  "admin.overview.all_clear": "Nothing is past its service level.",
  "admin.overview.not_yours": "Somebody else's row. You do not have the capability to open these.",
  "admin.overview.not_yet": "Not measurable yet",
  "admin.overview.not_yet_hint": "The screen that fills this is not built.",
  "admin.overview.oldest": "oldest {days}d",
  "admin.overview.late": "{count} late",
  "admin.overview.soon": "soon",
  "admin.overview.sla": "Service level, in days: moderation {moderation}, claims {claim}, supplier reports {report}, failed payments {dunning}.",

  "console.job.supply": "Get listings in",
  "console.job.comparable": "Keep the data comparable",
  "console.job.storefronts": "Build what sellers fill",
  "console.job.accounts": "Grow and keep accounts",
  "console.job.money": "Take the money",
  "console.job.trust": "Protect the trust",

  "console.metric.queue": "Edits waiting for review",
  "console.metric.claims": "Claims undecided",
  "console.metric.staged": "Licence records staged",
  "console.metric.unclaimed": "Listings nobody has claimed",
  "console.metric.subcategories": "Subcategory pages governed",
  "console.metric.no_specs": "Live products with no specs",
  "console.metric.zero_results": "Searches that found nothing",
  "console.metric.templates": "Storefront templates",
  "console.metric.free_accounts": "Claimed accounts on Free",
  "console.metric.call_list": "Prospects on the call list",
  "console.metric.past_due": "Subscriptions past due",
  "console.metric.unpaid": "Invoices issued and unpaid",
  "console.metric.reports": "Supplier reports open",
  "console.metric.expiring": "Verified licences expiring in 30 days",

  "admin.queue.title": "Approval queue",
  "admin.queue.eyebrow": "Moderation",
  "admin.queue.meta": "{count} waiting, oldest {days} days",
  "admin.queue.empty_meta": "Nothing waiting",
  "admin.queue.caption": "Submissions waiting for a decision, oldest first",
  "admin.queue.col.what": "What changed",
  "admin.queue.col.business": "Business",
  "admin.queue.col.from": "From",
  "admin.queue.col.to": "To",
  "admin.queue.col.age": "Waiting",
  "admin.queue.review": "Review",
  "admin.queue.age_days": "{days}d",
  "admin.queue.late": "Late",
  "admin.queue.band.late": "Past the service level · {count}",
  "admin.queue.band.due": "Within the service level · {count}",
  "admin.queue.empty.title": "Nothing is waiting for a decision",
  "admin.queue.empty.body": "Trade name, category and licence changes queue here. Everything else a seller edits publishes on save.",
  "admin.queue.error.title": "The queue could not be loaded",
  "admin.queue.error.body": "Reload the page. Nothing has been lost — the submissions are still there.",
  "admin.queue.kind.change": "Listing edit",
  // Board 3e §4. A seller has asked to publish a certificate, and the queue
  // their screen names is this one.
  "admin.queue.kind.document": "Credential",
  "admin.queue.document.scope": "What you are deciding",
  // The narrow decision, stated where a moderator cannot miss it. Nothing here
  // checks an ISO number against a registrar, and the seller's own screen draws
  // the line between "Verified by us" and "Uploaded by you" precisely so this
  // cannot be read as a check.
  "admin.queue.document.scope_body": "Whether this file is the document it says it is and fit to name on a public page. Not whether the certificate is genuine — we do not check these with the issuing body, and approving one changes no verification tier and no badge. The listing shows the name and the expiry month; the file itself is never published.",
  "admin.queue.document.details": "What the seller uploaded",
  "admin.queue.document.file": "File",
  "admin.queue.document.asked": "Asked to publish",
  "admin.queue.document.note": "Approving names this on the seller's public listing. Rejecting returns it to their own files with your reason attached, and they can ask again.",
  "admin.queue.document.decided": "Already decided",
  "admin.queue.document.decided_body": "Somebody looked at this on {when}. It is no longer in the queue.",
  "admin.queue.kind.conflict": "Conflicting claim",
  "admin.queue.field.trade_name": "Trade name",
  "admin.queue.field.primary_category": "Primary category",
  // Board 3b. An addition rather than a replacement — the listing keeps the
  // categories it already has while this one is checked, so the queue row reads
  // "add X" and not "X → Y".
  "admin.queue.field.additional_category": "Additional category",
  "admin.queue.field.licence": "Licence number",
  "admin.queue.not_yours": "That decision is not one your role holds.",
  "admin.queue.needs_reason": "Write a reason. A sentence, not a keystroke — it goes on the record and the seller reads it.",
  "admin.queue.approved": "Approved and applied.",
  "admin.queue.rejected": "Rejected. The seller can see the reason.",
  "admin.queue.resolved": "Settled. Both parties have been told.",
  "admin.queue.pick_a_resolution": "Choose one of the four outcomes.",

  "admin.review.title": "Review a submission",
  "admin.review.eyebrow": "Submission",
  "admin.review.back": "Back to the queue",
  "admin.review.submitted_by": "Submitted by {name}, {days} days ago",
  "admin.review.buyers_waiting": "{count} buyers are waiting on this listing",
  "admin.review.no_buyers_waiting": "No buyers are waiting on this listing",
  "admin.review.change_heading": "The change",
  "admin.review.decision_heading": "Your decision",
  "admin.review.reason_label": "Reason",
  "admin.review.reason_hint": "The seller reads this. Say what is wrong and what correct looks like.",
  "admin.review.approve": "Approve and apply",
  "admin.review.reject": "Reject",
  "admin.review.decided": "Decided {days} days ago by {name}",
  "admin.review.slug_note": "Approving moves the public address to /b/{slug} and leaves a redirect behind.",
  "admin.review.licence_warning": "A licence change moves the evidence behind this listing's verification tier.",
  "admin.review.licence_fix": "Check the number against the authority's register before approving. Tier 2 and above rest on it.",

  "admin.conflict.title": "Conflicting claim",
  "admin.conflict.heading_a": "Claimant A",
  "admin.conflict.heading_b": "Claimant B",
  "admin.conflict.route.licence_upload": "Licence upload",
  "admin.conflict.route.phone_callback": "Phone callback",
  "admin.conflict.preserved": "{reviews} reviews and {enquiries} enquiries belong to this listing. None of the four outcomes touches them.",
  "admin.conflict.resolution_heading": "How this is settled",
  "admin.conflict.award_to_a": "Award to A",
  "admin.conflict.award_to_a_hint": "A is the licence holder. B is told, and gets nothing.",
  "admin.conflict.award_to_b": "Award to B",
  "admin.conflict.award_to_b_hint": "B is the licence holder. A is told, and gets nothing.",
  "admin.conflict.split_into_two": "Split into two listings",
  "admin.conflict.split_into_two_hint": "Two companies at one address. The original keeps its address and its history; the second starts empty.",
  "admin.conflict.merge_as_branches": "Merge as branches",
  "admin.conflict.merge_as_branches_hint": "One company, two licences. One listing, two locations.",
  "admin.conflict.second_name_label": "Second company trade name",
  "admin.conflict.second_name_hint": "Only for a split. It becomes the second listing's name and address.",
  "admin.conflict.settle": "Settle this",

  "admin.ingest.title": "Licence importer",
  "admin.ingest.eyebrow": "Supply",
  "admin.ingest.meta": "{staged} staged across {runs} runs",
  "admin.ingest.caption": "Import runs, newest first",
  "admin.ingest.col.source": "Source",
  "admin.ingest.col.rows": "Rows",
  "admin.ingest.col.staged": "Staged",
  "admin.ingest.col.rejected": "Rejected",
  "admin.ingest.col.status": "Status",
  "admin.ingest.col.when": "Uploaded",
  "admin.ingest.open": "Open",
  "admin.ingest.empty.title": "No import runs yet",
  "admin.ingest.empty.body": "An authority export is a CSV with a trade name, a licence number and an activity. Nothing it contains publishes itself.",
  "admin.ingest.error.title": "The importer could not be loaded",
  "admin.ingest.error.body": "Reload the page. No run has been changed.",
  "admin.ingest.note": "A run parses, categorises what it can and queues what it cannot. Listings are created only when somebody approves the run, and they arrive unpublished at tier 0.",

  "dashboard.viewing_as": "You are looking at {business} for ticket {ticket}. Read-only, and it ends in {minutes} minutes.",

  "admin.businesses.title": "Businesses",
  "admin.businesses.eyebrow": "Accounts",
  "admin.businesses.meta": "{count} listings, {claimed} claimed",
  // Said only when the table is holding fewer rows than the count above it, so
  // the two numbers cannot be read as disagreeing. Search and pagination are
  // board 4f's own work (step 4.5); this stops the header lying until they land.
  "admin.businesses.showing": "showing the first {count}",
  "admin.businesses.caption": "Businesses and their account health",
  "admin.businesses.col.business": "Business",
  "admin.businesses.col.plan": "Plan",
  "admin.businesses.col.tier": "Tier",
  "admin.businesses.col.reply": "Median reply",
  "admin.businesses.col.strength": "Profile",
  "admin.businesses.col.state": "State",
  "admin.businesses.state.suspended": "Suspended",
  "admin.businesses.state.merged": "Merged away",
  "admin.businesses.state.unclaimed": "Unclaimed",
  "admin.businesses.state.live": "Live",
  "admin.businesses.empty.title": "No businesses",
  "admin.businesses.empty.body": "The directory is seeded from the licence import. Something is wrong if this is empty.",
  "admin.ingest.stage_title": "Stage a licence export",
  "admin.ingest.stage_help": "Parsed and classified, nothing published. Listings appear when somebody approves the run.",
  "admin.ingest.stage_source": "Authority",
  "admin.ingest.stage_filename": "File name",
  "admin.ingest.stage_drop": "Drop a CSV export",
  "admin.ingest.stage_drop_hint": "Needs a trade name column. Up to 8,000 rows.",
  "admin.ingest.stage_action": "Stage the run",
  "admin.ingest.staged": "{count} rows staged. Nothing is live until the run is approved.",
  "admin.ingest.staged_capped": "{count} rows staged, {dropped} past the ceiling and dropped. Split the file and stage the rest.",
  "admin.invoices.credit_title": "Issue a subscription credit",
  "admin.invoices.credit_help": "A credit lands as its own issued invoice rather than editing a past one. An invoice a seller has already downloaded is a record.",
  "admin.invoices.credit_business": "Business",
  "admin.invoices.credit_pick": "Pick a business",
  "admin.invoices.credit_amount": "Amount in dirhams",
  "admin.invoices.credit_description": "What it is for",
  "admin.invoices.credit_description_hint": "This prints on the invoice. The seller reads it.",
  "admin.invoices.credit_reason_hint": "This goes on the audit row and the seller never sees it.",
  "admin.invoices.credit_issue": "Issue credit",
  "admin.invoices.credit_issued": "Credit of {amount} issued.",
  "admin.invoices.credit_invalid": "Enter an amount in dirhams, like 250 or 250.50.",
  "admin.dedupe.unmerge": "Put it back",
  "admin.dedupe.unmerged": "Put back. {count} records returned to the original listing.",
  "admin.dedupe.col.merged": "The merge",
  "admin.dedupe.col.days_left": "Left to reverse",
  "admin.dedupe.days_left": "{count} days",
  "admin.dedupe.reversible_title": "Merges you can still reverse",
  "admin.dedupe.reversible_caption": "Merges inside the thirty-day window",
  "admin.dedupe.reversible_empty.title": "Nothing to put back",
  "admin.dedupe.reversible_empty.body": "A merge can be reversed for thirty days. None made in that time is still open.",
  "admin.reviews.title": "Reviews",
  "admin.reviews.eyebrow": "Trust",
  "admin.reviews.meta": "{count} published, {removed} removed · showing the {shown} most recent",
  "admin.reviews.kind": "Review",
  "admin.reviews.remove": "Remove",
  "admin.reviews.removed": "Removed. The rating average is recalculated without it.",
  "admin.reviews.removed_on": "Removed {date}",
  "admin.reviews.has_reply": "The supplier has replied",
  "admin.reviews.no_reply": "No reply from the supplier",
  "admin.reviews.buyer_unnamed": "A buyer",
  "admin.reviews.ground_legend": "Ground for removal",
  "admin.reviews.ground_hint": "The ground goes on the record beside your reason. Pick the one that is true, not the one that is easiest to write.",
  "admin.reviews.ground.no_traceable_enquiry": "No traceable enquiry",
  "admin.reviews.ground.abuse": "Abuse",
  "admin.reviews.ground.private_information": "Private information",
  "admin.reviews.ground.provably_false": "Provably false",
  /*
     Board 11c `B6`. Not one of the four a seller may cite — no supplier files a
     dispute reporting themselves — so it lives here beside the removal grounds
     and not on the rail. The request panel has promised since board 1m that an
     incentivised review is removed; this is the ground that removes it.
  */
  "admin.reviews.ground.incentivised": "Incentivised by the supplier",
  // ── Board 11c B4 and B6, on the same screen as the removal control ──
  "admin.reviews.remove_reply": "Remove the reply",
  "admin.reviews.reply_removed": "The supplier's reply is off the page. The review stands.",
  "admin.reviews.reply_removed_on": "Reply removed {date}",
  "admin.reviews.reply_already_removed": "That reply has already been removed.",
  "admin.reviews.no_reply_to_remove": "There is no reply on that review.",
  "admin.reviews.log_incentive": "Log an incentive finding",
  "admin.reviews.incentive_note": "This records a finding against the supplier's account and puts it in the reports queue. It does not remove the review — remove it separately, on the incentivised ground, if that is the decision.",
  "admin.reviews.incentive_permanent": "The finding stays on the account. It is what makes the prohibition on the request panel enforceable rather than a warning.",
  "admin.reviews.incentive_logged": "Logged against the account and queued in reports.",
  "admin.reviews.incentive_already_logged": "A finding is already recorded against this review.",

  // ── Board 11c B5 — the review-dispute queue, on 4h ──
  "admin.disputes.heading": "Review disputes",
  "admin.disputes.description": "A supplier says a review should not stand. Four grounds, two outcomes, decided in about two working days.",
  "admin.disputes.kind": "Review dispute",
  "admin.disputes.empty": "No open disputes.",
  "admin.disputes.decide": "Decide",
  "admin.disputes.uphold": "Uphold and remove",
  "admin.disputes.refuse": "Refuse",
  "admin.disputes.upheld": "Upheld. The review is removed and the supplier has been told.",
  "admin.disputes.refused": "Refused. The review stands and the supplier has been told.",
  "admin.disputes.pick_an_outcome": "Uphold it or refuse it. There is no third outcome — a review cannot be corrected.",
  "admin.disputes.age": "{date} · {days} days open",
  "admin.disputes.raised_by": "Raised by {name}",
  "admin.disputes.from_accepted_quote": "This review came from a quote this supplier accepted. The buyer is traceable.",
  "admin.disputes.from_confirmed_enquiry": "This review came from an enquiry this supplier answered. No quote was accepted.",
  "admin.disputes.refuse_only": "Upholding a dispute removes the review, which is an ops lead's decision. Refusing leaves it standing and the supplier can still reply if their window is open. Either way the reason goes to them.",
  "admin.disputes.note": "Upholding removes the review, which is an ops lead decision. Refusing leaves it standing and the supplier can still reply if their window is open. Either way the reason goes to them.",
  "admin.reviews.pick_ground": "Pick a ground for the removal.",
  "admin.reviews.not_found": "That review is not here.",
  "admin.reviews.already_removed": "Somebody already removed that review.",
  "admin.reviews.permanent_note": "A removal is not reversible from this screen. The review stays in the audit log with your reason.",
  "admin.reviews.note": "A review is a buyer\u2019s own words about a deal they had. Removing one is held to a higher bar than moderating a queue, which is why only an ops lead can do it.",
  "admin.reviews.empty.title": "No reviews yet",
  "admin.reviews.empty.body": "A review can only follow an accepted quote, so this fills up behind the enquiry flow.",
  "admin.businesses.col.decide": "Decide",
  "admin.businesses.action.tier": "Set tier",
  "admin.businesses.action.suspend": "Suspend",
  "admin.businesses.action.lift": "Lift suspension",
  "admin.businesses.tier_legend": "Verification tier",
  "admin.businesses.tier_option": "Tier {tier}",
  "admin.businesses.tier_set": "Tier set to {tier}.",
  // Two, not four, and this string has been wrong twice. It said 4 from the
  // four-rung ladder, then 3 while trade references sat reserved on rung 3.
  // Both were tiers `setVerificationTier` would refuse. The top of the range is
  // `MAX_TIER`, which is `TOP_ACHIEVABLE_TIER`, which the
  // `business_verification_tier_range` CHECK holds at 2 underneath.
  "admin.businesses.tier_invalid": "Pick a tier between 0 and 2.",
  "admin.businesses.suspended": "Suspended. The listing is off the directory.",
  "admin.businesses.lifted": "Suspension lifted. The listing is back.",
  "admin.businesses.suspend_note": "A suspension hides the listing and stops new enquiries. It does not delete anything.",

  "admin.crm.title": "Recruitment",
  "admin.crm.eyebrow": "Accounts",
  "admin.crm.meta": "{count} prospects, from demand we measured",
  "admin.crm.caption": "The call list, built from demand signals",
  "admin.crm.col.business": "Business",
  "admin.crm.col.signal": "Why they are on the list",
  "admin.crm.col.value": "How much",
  "admin.crm.col.plan": "Plan",
  "admin.crm.empty.title": "Nobody to call",
  "admin.crm.empty.body": "The list builds itself from missed enquiries, searches that found nobody, and unclaimed listings receiving demand. An empty list means none of those are happening.",
  "admin.crm.note": "Nobody types this list. It is a query over demand we already measured, and there is no way to add somebody to it. Lead with their missed demand, not with our product.",
  "admin.crm.signal.missed_at_cap": "Enquiries their plan capped them out of",
  "admin.crm.signal.zero_result_in_their_trade": "Searches in their trade that found nobody",
  "admin.crm.signal.unclaimed_with_demand": "Enquiries to a listing nobody has claimed",
  "admin.crm.signal.reply_rate_falling": "Reply rate falling",

  "admin.support.title": "Support desk",
  "admin.support.eyebrow": "Platform",
  "admin.support.meta": "{count} sessions in the last while",
  "admin.support.start": "Start looking",
  "admin.support.ticket_label": "Ticket",
  "admin.support.ticket_hint": "It goes on the audit row. Looking through a seller's eyes without a reason is a privacy event.",
  "admin.support.business_label": "Business slug",
  "admin.support.started": "Started. The dashboard now shows their account, read-only, for {minutes} minutes.",
  "admin.support.live": "You are looking at {business} for {ticket}. {minutes} minutes left.",
  "admin.support.end": "Stop looking",
  "admin.support.ended": "Stopped.",
  "admin.support.note": "A session is read-only, capped at {minutes} minutes and written to the audit log with the ticket. Read-only is enforced where the seller's own mutations are, not by hiding buttons.",
  "admin.support.recent": "Recent sessions",
  "admin.support.recent_empty": "Nobody has looked at an account yet.",
  "admin.support.not_found": "No listing has that address. Check the slug from the storefront URL.",

  "admin.reports.title": "Supplier reports",
  "admin.reports.eyebrow": "Trust",
  "admin.reports.meta": "{open} open, oldest {days} days",
  "admin.reports.caption": "Supplier reports waiting for an outcome, oldest first",
  "admin.reports.col.what": "Reported",
  "admin.reports.col.business": "Business",
  "admin.reports.col.detail": "What was said",
  "admin.reports.col.priors": "Before",
  "admin.reports.col.age": "Waiting",
  "admin.reports.automatic": "we found it",
  "admin.reports.priors": "{count} on this field",
  "admin.reports.no_priors": "first",
  "admin.reports.empty.title": "No reports waiting",
  "admin.reports.empty.body": "A report is about a supplier's conduct — wrong details, a closed unit, a listing in the wrong trade. It is never about a payment.",
  "admin.reports.note": "Outcomes are corrected, upheld or no action, each with a reason. Off-platform payment reports skip this queue: the platform detected them, and what is decided is about the account.",
  "admin.reports.kind.closed": "Closed down",
  "admin.reports.kind.wrong_details": "Wrong details",
  "admin.reports.kind.wrong_trade": "Wrong trade",
  "admin.reports.kind.claim_conflict": "Claim conflict",
  "admin.reports.kind.off_platform_payment": "Off-platform payment",
  "admin.reports.kind.content": "Content",
  "admin.reports.kind.review_integrity": "Review integrity",
  "admin.reports.outcome.seller_corrected": "Seller corrected it",
  "admin.reports.outcome.upheld": "Upheld",
  "admin.reports.outcome.no_action": "No action",
  "admin.record.not_found": "That business is not in the directory.",
  "admin.reports.resolved": "Resolved.",
  "admin.reports.skipped_heading": "Off-platform payment, outside the queue",
  "admin.reports.skipped_empty": "Nothing detected.",

  "admin.audit.title": "Audit log",
  "admin.audit.eyebrow": "Platform",
  // "{count} entries" over a `limit: 200` said 200 entries on a log holding
  // any number above that, and would have kept saying it. Named as a window
  // rather than a total: true at every size, and true without a second query
  // that would have to re-derive `auditScopeFor`'s narrowing to stay honest.
  // The count and the pagination it needs are board 4i's own work (step 7.1).
  "admin.audit.meta_all": "The {count} most recent entries, every actor",
  "admin.audit.meta_own": "The {count} most recent of your own entries",
  "admin.audit.scope_own": "You see your own actions. Reading the whole log is an ops lead row.",
  "admin.audit.caption": "Staff actions, newest first",
  "admin.audit.col.when": "When",
  "admin.audit.col.who": "Who",
  "admin.audit.col.action": "Action",
  "admin.audit.col.subject": "Subject",
  "admin.audit.col.reason": "Reason",
  "admin.audit.empty.title": "Nothing logged yet",
  "admin.audit.empty.body": "Every staff state change writes a row here with a written reason. An empty log means nothing has been changed.",


  "admin.dedupe.title": "Dedupe & merge",
  "admin.dedupe.eyebrow": "Supply",
  "admin.dedupe.meta": "{certain} safe to merge, {probable} need a decision",
  "admin.dedupe.caption": "Possible duplicates, most likely first",
  "admin.dedupe.col.pair": "The pair",
  "admin.dedupe.col.why": "Why",
  "admin.dedupe.col.history": "History at risk",
  "admin.dedupe.col.score": "Match",
  "admin.dedupe.band.certain": "Safe to merge · {count}",
  "admin.dedupe.band.probable": "Needs a decision · {count}",
  "admin.dedupe.history": "{reviews} reviews, {enquiries} enquiries",
  "admin.dedupe.keeps": "keeps its address",
  "admin.dedupe.absorbed": "absorbed",
  "admin.dedupe.empty.title": "No possible duplicates",
  "admin.dedupe.empty.body": "Run the matcher after an import. It compares listings that share a licence number, a name or a phone.",
  "admin.dedupe.error.title": "The list could not be loaded",
  "admin.dedupe.error.body": "Reload the page. No listing has been merged.",
  "admin.dedupe.note": "A merge moves everything the absorbed listing has onto the one that survives, and never deletes it. Reversible for {days} days, and the old address 301s.",
  "admin.dedupe.rescan": "Find duplicates",
  "admin.dedupe.rescan_done": "{count} new pairs found.",
  "admin.dedupe.rescan_capped": "{count} new pairs. Another {dropped} scored high enough and were not written — clear some of the list and run it again.",
  "admin.dedupe.merge": "Merge",
  "admin.dedupe.dismiss": "Not a duplicate",
  "admin.dedupe.merged": "Merged. Reversible for {days} days.",
  "admin.dedupe.dismissed": "Dismissed. That pair will not be offered again.",
  "admin.dedupe.signal.licence_number": "Licence number",
  "admin.dedupe.signal.trade_name": "Trade name",
  "admin.dedupe.signal.phone": "Phone",
  "admin.dedupe.signal.address": "Address",
  "admin.dedupe.signal.same_area": "Same area",

  "admin.run.title": "Import run",
  "admin.run.back": "Back to the importer",
  "admin.run.rows": "{count} rows",
  "admin.run.categorised": "Categorised",
  "admin.run.queued": "Waiting for a category",
  "admin.run.rejected": "Rejected",
  "admin.run.published": "Became listings",
  "admin.run.grounds": "Rejections, by reason",
  "admin.run.no_rejections": "Nothing was rejected in this run.",
  "admin.run.ground.licence_expired_24_months": "Licence expired more than 24 months ago",
  "admin.run.ground.no_readable_trade_name": "No readable trade name",
  "admin.run.ground.activity_out_of_scope": "Activity out of scope",
  "admin.run.ground.address_outside_uae": "Address outside the UAE",
  "admin.run.approve": "Approve and create listings",
  "admin.run.approved": "Approved. The categorised rows are now listings.",
  "admin.run.decided": "{status} by {name}",
  "admin.run.nothing_publishes": "Approving creates a listing for every categorised row. Each arrives unpublished, at tier 0, unclaimed — a licence number and an address, and nothing checked.",
  "admin.run.truncated": "{count} rows past the ceiling were not read.",

  "import.truncated": "{count} rows past the first 5,000 were not read.",
  "import.truncated_fix": "Split the file and import it in parts. Every row in the first 5,000 is mapped as shown.",

  "admin.taxonomy.title": "Taxonomy",
  "admin.taxonomy.eyebrow": "Data",
  "admin.taxonomy.meta": "{blocked} of {total} categories are below their own floor",
  "admin.taxonomy.caption": "Categories, with the listing counts their publish floor is judged against",
  "admin.taxonomy.col.category": "Category",
  "admin.taxonomy.col.listings": "Listings",
  "admin.taxonomy.col.verified": "Verified",
  "admin.taxonomy.col.floor": "Floor",
  "admin.taxonomy.col.state": "Landing pages",
  "admin.taxonomy.col.synonyms": "Synonyms",
  "admin.taxonomy.publishable": "Publishable",
  "admin.taxonomy.blocked": "Held back",
  "admin.taxonomy.blocked_on": "{have} of {need}",
  "admin.taxonomy.floor_value": "{listings} · {share}% verified",
  "admin.taxonomy.empty.title": "No categories",
  "admin.taxonomy.empty.body": "The taxonomy is seeded from the category list. Something is wrong if this is empty.",
  "admin.taxonomy.error.title": "The taxonomy could not be loaded",
  "admin.taxonomy.error.body": "Reload the page. Nothing has been changed.",
  "admin.taxonomy.default_template": "Template offered first",
  "admin.taxonomy.default_template_help": "A subcategory may hold several spec templates. This picks the one a seller is offered first — it is a default, not the only one available, and the rest stay on their Clone from library rail.",
  "admin.taxonomy.default_template_subcategory": "Subcategory",
  "admin.taxonomy.default_template_first": "Offered first",
  "admin.taxonomy.default_template_option": { one: "{name} — {n} template", other: "{name} — {n} templates" },
  "admin.taxonomy.default_template_save": "Save the default",
  "admin.taxonomy.no_templates": "No subcategory has a spec template yet. Create one in the spec library first.",
  "admin.taxonomy.reason": "Reason",
  "admin.taxonomy.note": "A landing page publishes only above its category's floor, and unpublishes if supply drops below it. Enforced in code — this is where the numbers live.",
  "admin.taxonomy.intro_note": "Intro word count is not measurable here. The copy belongs to the page, which is handoff 5.",

  "admin.spec.title": "Spec library",
  "admin.spec.eyebrow": "Data",
  "admin.spec.meta": "{templates} templates · {covered} of {total} subcategories covered · {products} products on a template",
  "admin.spec.caption": "Platform spec templates, the subcategories they serve, and how filled they are",
  "admin.spec.col.template": "Template",
  "admin.spec.col.subcategories": "Subcategories",
  "admin.spec.col.fields": "Fields",
  "admin.spec.col.products": "Products",
  "admin.spec.col.filled": "Filled",
  "admin.spec.col.version": "Version",
  "admin.spec.fields_facets": "{facets} facet · {varies} vary",
  "admin.spec.copies": { one: "{n} copy", other: "{n} copies" },
  "admin.spec.no_clones": "No seller has cloned this template, so there is nothing to measure a fill rate over.",
  "admin.spec.live": "Live",
  "admin.spec.version_of": "v{version}",
  "admin.spec.draft_version": "v{version} draft",
  "admin.spec.more_subcategories": "and {n} more",
  "admin.spec.open": "Open {name}",
  "admin.spec.empty.title": "No templates yet",
  "admin.spec.empty.body": "A subcategory with no template accepts any specs, which means buyers cannot filter its products.",
  "admin.spec.error.title": "The library could not be loaded",
  "admin.spec.error.body": "Reload the page. Nothing has been changed.",
  "admin.spec.note": "A subcategory may hold several templates and a template may serve several subcategories. Which one a seller is offered first is the default set per subcategory on the taxonomy screen. Filled is measured over mapped platform fields only, across all seller copies.",

  "admin.spec.tab.templates": "Templates",
  "admin.spec.tab.coverage": "Coverage gaps",
  "admin.spec.tab.drafts": "Drafts",
  "admin.spec.tab.proposed": "Proposed fields",
  "admin.spec.tabs_label": "Spec library views",
  "admin.spec.search": "Template, attribute or field id",

  "admin.spec.coverage.eyebrow": { one: "Coverage · {n} subcategory, no template", other: "Coverage · {n} subcategories, no template" },
  "admin.spec.coverage.body": "Products already listed there carry no comparable fields, so no facet on a category page can reach them.",
  "admin.spec.coverage.counts": { one: "{products} products · {n} listing", other: "{products} products · {n} listings" },
  "admin.spec.coverage.create": "Create",
  "admin.spec.coverage.held": "On hold",
  "admin.spec.coverage.held_why": "{name} is below its own publishing floor on the taxonomy screen. Two screens should not both be authoring for a subcategory one of them is holding back.",
  "admin.spec.coverage.caption": "Subcategories with no spec template, ranked by products already listed",
  "admin.spec.coverage.none": "Every subcategory holding products has a template.",
  "admin.spec.coverage.col.subcategory": "Subcategory",
  "admin.spec.coverage.col.products": "Products",
  "admin.spec.coverage.col.listings": "Listings",
  "admin.spec.coverage.col.state": "State",

  "admin.spec.draft.eyebrow": "v{version} draft · {name}",
  "admin.spec.draft.count": { one: "{n} draft", other: "{n} drafts · largest blast radius first" },
  "admin.spec.draft.lands": { one: "Lands on {n} seller copy, unfilled, not required, facet state inherited. No product changes state, none is delisted, no seller's save is blocked.", other: "Lands on {n} seller copies, unfilled, not required, facet state inherited. No product changes state, none is delisted, no seller's save is blocked." },
  "admin.spec.draft.requiring": "Requiring a field is a separate action with its own review — not part of publishing a version.",
  "admin.spec.draft.review": { one: "Review blast radius · {n} copy", other: "Review blast radius · {n} copies" },
  "admin.spec.draft.none": "Nothing is staged on any template.",
  "admin.spec.drafts.caption": "Templates with staged changes",

  "admin.spec.proposed.eyebrow": "Seller-proposed fields",
  "admin.spec.proposed.body": "Fields sellers created themselves, often enough to be worth one shared definition.",
  "admin.spec.proposed.spread": { one: "{n} seller · {labels} labels · {types} types", other: "{n} sellers · {labels} labels · {types} types" },
  "admin.spec.proposed.no_merge": "Promoting one is a merge into an attribute definition, not a write: these sellers hold several labels and types for the same field, so there is no single value to promote. The attribute dictionary that a merge writes into has no board yet, so the merge is held with it.",
  "admin.spec.proposed.empty": "No fields have been proposed yet.",
  "admin.spec.proposed.caption": "Fields sellers created on their own copies, ranked by how many of them did",
  "admin.spec.proposed.col.field": "Field",
  "admin.spec.proposed.col.category": "Subcategory",
  "admin.spec.proposed.col.spread": "Spread",

  "admin.spec.detail.back": "Spec library",
  "admin.spec.detail.meta": "v{version} · {fields} fields · serves {subcategories} · {clones} seller copies",
  "admin.spec.detail.caption": "Fields in this platform template",
  "admin.spec.detail.col.field": "Field",
  "admin.spec.detail.col.type": "Type",
  "admin.spec.detail.col.facet": "Facet",
  "admin.spec.detail.col.varies": "Varies",
  "admin.spec.detail.col.required": "Required",
  "admin.spec.detail.col.gaps": "Gaps",
  "admin.spec.detail.facet_yes": "Filter",
  "admin.spec.detail.varies_yes": "Varies",
  "admin.spec.detail.required_yes": "Required",
  "admin.spec.detail.required_no": "Optional",
  "admin.spec.detail.detached": { one: "{n} copy detached", other: "{n} copies detached" },
  "admin.spec.detail.missing": { one: "{n} product unfilled", other: "{n} products unfilled" },
  "admin.spec.detail.empty": "This template has no fields yet. Add one, then publish the version.",
  "admin.spec.detail.no_facet_demand": "We cannot yet tell you how many buyers filtered on it — the search log records what was typed, not which filters were used.",

  "admin.spec.publish.title": "Publish v{version}",
  "admin.spec.publish.additive": { one: "Adds fields, changes platform display labels, facet flags and how a field varies between variants. Every field lands on {n} seller copy unfilled and not required. No product is delisted and no seller's save is blocked.", other: "Adds fields, changes platform display labels, facet flags and how a field varies between variants. Every field lands on {n} seller copies unfilled and not required. No product is delisted and no seller's save is blocked." },
  "admin.spec.publish.removal": "A removed field and its values stay on every seller copy as a field of their own, and lose only their facet status. Nothing is deleted.",
  "admin.spec.publish.confirm": "Publish v{version}",
  "admin.spec.publish.discard": "Discard draft",
  "admin.spec.publish.change.field_added": "Adds {label}",
  "admin.spec.publish.change.field_removed": "Removes {label} from the platform set",
  "admin.spec.publish.change.relabelled": "Renames {from} to {label} on the platform template only",
  "admin.spec.publish.change.reordered": "Moves {label}",
  "admin.spec.publish.change.facet_on": "Makes {label} a category filter",
  "admin.spec.publish.change.facet_off": "Stops {label} being a category filter",
  "admin.spec.publish.change.varies_on": "Marks {label} as varying between variants",
  "admin.spec.publish.change.varies_off": "Stops {label} varying between variants",
  "admin.spec.publish.change.options_changed": "Changes the options on {label}",
  "admin.spec.publish.change.unit_changed": "Changes the unit on {label}",
  "admin.spec.blast.display_only": "Display only",
  "admin.spec.blast.republish": "Republish",
  "admin.spec.blast.flag": "Flags products",

  "admin.spec.require.title": "Require {label}",
  "admin.spec.require.pick": "Requiring a field",
  "admin.spec.detail.nothing_staged": "Nothing is staged on this template.",
  "admin.spec.require.what": { one: "New products are held at first save. {n} product already listed is flagged and blocked on its next save until the field is filled. Nothing is delisted and there is no deadline.", other: "New products are held at first save. {n} products already listed are flagged and blocked on their next save until the field is filled. Nothing is delisted and there is no deadline." },
  "admin.spec.require.sellers": { one: "{n} seller holds at least one of them.", other: "{n} sellers hold at least one of them." },
  "admin.spec.require.detached": { one: "{n} seller copy has detached this field and cannot be held to a mapping it no longer has.", other: "{n} seller copies have detached this field and cannot be held to a mapping they no longer have." },
  "admin.spec.require.confirm": "Require this field",
  "admin.spec.require.drop": "Stop requiring this field",
  "admin.spec.require.floor": "A seller may add a requirement of their own and may not remove this one.",

  "admin.spec.reason": "Reason",
  "admin.spec.reason_hint": "Recorded on the audit row. Say what changed and why.",
  "admin.spec.add.title": "Add a field",
  "admin.spec.add.key": "Field id",
  "admin.spec.add.label": "Label",
  "admin.spec.add.type": "Type",
  "admin.spec.add.unit": "Unit",
  "admin.spec.add.options": "Options, one per line",
  "admin.spec.add.facet": "Buyers can filter on this",
  "admin.spec.add.varies": "This differs between variants of the same product",
  "admin.spec.add.stage": "Stage this field",
  "admin.spec.add.not_required": "A field added by a version publish always arrives not required. Requiring it is a separate action once it is live.",
  "admin.spec.new.title": "New template",
  "admin.spec.new.name": "Template name",
  "admin.spec.new.subcategory": "Subcategory",
  "admin.spec.new.create": "Create template",
  "admin.spec.remove.stage": "Remove from the platform set",
  "admin.spec.remove.undo": "Keep this field",
  "admin.conflict.claimant": "Claimant",
  "admin.conflict.route": "Route",
  "admin.conflict.submitted": "Submitted",
  "admin.conflict.evidence": "Evidence",
  "admin.conflict.number": "Number called",

  "nav.catalogue_imports": "Catalogue loads",
  "nav.label.dashboard": "Seller navigation",
  "nav.label.admin": "Staff navigation",
  "nav.label.public": "Directory navigation",
  "staff.role.staff_moderator": "Moderator",
  "staff.role.staff_field": "Field verifier",
  "staff.role.staff_finance": "Finance",
  "staff.role.staff_ops_lead": "Ops lead",
  "nav.locked": "locked",
  "nav.later": "soon",

  // ── Table furniture ──
  "table.caption.businesses": "Businesses, with verification tier, emirate and enquiry count",
  "table.select_all": "Select all rows",
  "table.select_row": "Select {name}",
  "table.row_menu": "More actions for {name}",
  "table.actions_header": "Row actions",
  "table.sort_by": "Sort by {column}, {direction}",
  "table.sort_asc": "ascending",
  "table.sort_desc": "descending",
  "table.range": "{from}–{to} of {total}",
  "table.previous": "Previous page",
  "table.next": "Next page",
  "table.page": "Page {page}",
  "table.selected": { one: "{count} selected", other: "{count} selected" },
  "table.clear_selection": "Clear selection",
  "table.export": "Export",
  "table.assign": "Assign",
  "table.suspend": "Suspend",
  "table.view": "View",
  "table.not_provided": "Not provided",
  "table.filters_applied": { one: "{count} filter applied", other: "{count} filters applied" },
  "table.clear_filters": "Clear all",

  // ── Overlays ──
  "overlay.close": "Close",
  "overlay.remove_review_title": "Remove this review",
  "overlay.remove_review_body": "The buyer keeps a copy and is told it was removed. This is recorded against your name in the audit log.",
  "overlay.remove_review_confirm": "Remove review",
  "overlay.filters_title": "Filters",
  "overlay.branch_title": "Al Quoz Industrial 1",

  // ── Shell furniture ──
  "shell.saved": "Saved {when}",
  "shell.step_progress": "Step {current} of {total}",
  "shell.onboarding": "Claim your listing",
  "shell.exit": "Leave builder",
  "shell.publish": "Publish",
  "shell.viewing_as": "Viewing as {name}. Every action is recorded.",
  "shell.results_count": { one: "{count} supplier", other: "{count} suppliers" },

  // ── Display tier ──
  "display.verified": "Verified",
  "display.expiring": "Licence expiring",
  "display.suspended": "Suspended",
  "display.unclaimed": "Unclaimed",
  "display.in_review": "In review",
  "display.no_image": "No photo yet",
  // Two, because the gallery renders both specimens at once and a map's canvas
  // is a landmark: the same name twice is `landmark-unique`.
  "display.branch_map_label": "A pinned branch, on a map",
  "display.branch_map_label_unpinned": "An unpinned branch, on a map",
  "display.map_empty": "No pinned locations to show",
  "display.map_excluded": { one: "{count} branch has no map pin", other: "{count} branches have no map pin" },
  "display.map_label": "Supplier locations",

  /* Board 1c — the results map. Its controls, and the legend that names all
     three pin states in words rather than relying on colour alone. */
  /* Board 1c — the search page's own chrome. */
  "search.scope_uae": "UAE",
  /* `count` selects the plural form and must stay numeric; `formatted` is what
     is printed, so 1,046 keeps its separator. Passing only a formatted string
     would fall back to the plural form for every value, including one. */
  "search.result_count": { one: "{formatted} result", other: "{formatted} results" },
  "search.sorted_by_distance": "Sorted by distance from {origin}",
  "search.sorted_by_relevance": "Sorted by relevance",
  "search.draw_area": "Draw area on map",
  "search.show_list": "List",
  "search.show_map": "Map",
  "search.show_more": { one: "Show {count} more", other: "Show {count} more" },
  "search.bounds_empty_title": "No suppliers here",
  "search.bounds_empty_body": { one: "{formatted} supplier matches elsewhere in {place}.", other: "{formatted} suppliers match elsewhere in {place}." },
  "search.bounds_empty_action": "Zoom out to {place}",
  "search.area_page_prompt": "Browsing {category} in {area}?",
  "search.area_page_link": "See the full page",

  "map.search_area": "Search this area",
  "map.free_zones": "Free zones overlay",
  // Moss marks a head office — see the `head_office` case in the pin layer of
  // components/display/ResultsMap.tsx. This line read "Verified by site visit",
  // which was wrong before site visits were withdrawn and is now wrong twice.
  "map.legend_head_office": "Head office",
  "map.legend": "Legend",
  "map.legend_verified": "Licence verified",
  "map.legend_unverified": "Unverified / unclaimed",
  "map.results_label": "Suppliers matching this search",
  "map.empty": "No pinned suppliers in this view",
  "map.capped": { one: "Showing the first {count} pin", other: "Showing the first {count} pins" },
  "map.excluded": { one: "{count} supplier here has no map pin", other: "{count} suppliers here have no map pin" },
  "display.remove_filter": "Remove the {facet} filter",
  "display.conversion": "{pct}% of the step before",
  "display.profile_strength": "Profile strength",
  "display.spec_completeness": "Spec completeness",
  "display.fields_filled": "{filled} / {total} fields",
  "display.setup_progress": "{done} of {total} done",
  "display.setup": "Setup",
  "display.self_reported": "Self-reported by the supplier",
  "display.material_ductile_iron": "Ductile iron",

  // ── Verification. §06 is canvas-only; these rungs are inferred from the data
  //    model and recorded in docs/inferred.md.
  "verify.t0": "Not verified",
  "verify.t0.checked": "Nothing on this page has been checked by us",
  // Board 3e, and the change log of 5 Sep: the ladder reads
  // `1 claimed -> 2 licence verified (top) -> 3 trade references (reserved)`.
  //
  // Rung 1 was "Licence on file", which is a sentence about a document and
  // reads as reassurance on a listing where nothing has been checked — and it
  // is the rung an expired licence drops to, so it was reassuring hardest at
  // the moment it was least true. "Claimed" is what actually happened: a
  // person proved the listing is theirs, by licence upload or by a call to the
  // number on the public register.
  "verify.t1": "Claimed",
  "verify.t1.checked": "Claimed by the supplier, contact confirmed by us",
  "verify.t2": "Licence verified",
  "verify.t2.checked": "Trade licence checked against the issuing authority",
  // Rung 3 is gone, and with it `verify.t3`, `verify.t3.checked` and
  // `verify.requirement.t3`. It held three different claims in three months —
  // site visited, trading history audited, trade references — and the last of
  // those was drawn `reserved` so the ladder had somewhere to go. Trade
  // references will not be built, so the rung is not somewhere to go; it is a
  // promise, on the seller's own screen, in a string that told them we would
  // say so here when it existed.
  "verify.tier": "tier {tier}",
  "verify.ladder": "Verification ladder",
  "verify.reached": "Reached",
  "verify.requirement.t1": "The supplier proves the listing is theirs, and we confirm the contact details on the public licence record.",
  "verify.requirement.t2": "We check the licence against the issuing authority and confirm it is current.",
  // It drops to tier 1, not to 2. Tier 2 *is* licence verification, so a
  // listing held there keeps the badge the expiry exists to withdraw — the
  // self-contradiction change-log decision 3 fixed. See lib/verification.ts.
  "verify.expired": "Licence expired — tier drops to 1 until a renewal is checked",

  // ── Listing card ──
  "listing.products": { one: "{count} product", other: "{count} products" },
  "listing.reviews": { one: "{count} review", other: "{count} reviews" },
  "listing.no_reviews": "No reviews yet",
  "listing.trn_on_file": "TRN on file",
  "listing.view_storefront": "View storefront",
  /* Board 1c's map row. Shorter than the search row's labels because the
     column is 664px and carries three actions rather than one. */
  "listing.storefront": "Storefront",
  "listing.enquire": "Enquire",
  "listing.view_listing": "View listing",
  "listing.branches": { one: "{count} branch", other: "{count} branches" },
  "listing.years": "Trading since {year}",
  "listing.unclaimed_title": "This listing has not been claimed",
  "listing.unclaimed_body": "Everything here comes from the public trade licence record. Nobody at the business has claimed this listing, so none of it has been confirmed by them. Any badge on it says what we checked ourselves, and when.",
  "listing.claim_cta": "Claim this listing",
  "listing.report": "Report this listing",
  "listing.view": "View supplier",
  "listing.similar.category": "Verified suppliers in the same trade",
  "listing.similar.parent": "Verified suppliers in a related trade",
  "listing.similar.emirate": "Verified suppliers in the same emirate",
  "listing.licence_expiry": "Licence expires",

  // ── Product card ──
  "product.enquire": "Send enquiry",
  "product.notify": "Notify me",
  "product.lead_time": "Lead time {days} days",
  "product.min_order": "Min order {qty}",
  "product.in_stock_qty": "{qty} in stock",
  "product.no_price": "Price on enquiry",
  "product.spec": "Specification",
  "product.spec_filterable": "filterable",
  "product.datasheet": "Datasheet",

  // ── The enquiry engine is the next handoff ──
  "enquiry.disabled": "Enquiries open in the next release",
  "gallery.theme_proof": "The same badge inside all six seller themes. A storefront theme recolours the header, headings, buttons, links and form focus. It never touches a verification badge — a trust signal a seller controls is not a trust signal.",
  "gallery.sponsored": "Sponsored",

  // ── Public chrome ──
  "chrome.categories": "Categories",
  "chrome.products": "Products",
  "chrome.suppliers": "Suppliers",
  "chrome.sign_in": "Sign in",
  "chrome.guides": "Guides",
  "chrome.pricing": "Pricing",
  "chrome.terms": "Terms",
  "chrome.privacy": "Privacy",
  "chrome.verification_policy": "How we verify",
  "chrome.review_policy": "Review policy",
  "chrome.cookies": "Cookies",
  "chrome.footer_nav": "Policies",
  "chrome.footer_count": "{count} listed businesses across seven emirates.",
  "chrome.directory": "Directory",
  "chrome.later": "Not in this release yet",

  // ── Emirates. Translatable records live in the database; these are the enum
  //    values rendered, which the schema owns rather than the taxonomy.
  "emirate.dubai": "Dubai",
  "emirate.abu_dhabi": "Abu Dhabi",
  "emirate.sharjah": "Sharjah",
  "emirate.ajman": "Ajman",
  "emirate.umm_al_quwain": "Umm Al Quwain",
  "emirate.ras_al_khaimah": "Ras Al Khaimah",
  "emirate.fujairah": "Fujairah",

  // ── Location types ──
  "location.head_office": "Head office",
  "location.warehouse": "Warehouse",
  "location.trade_counter": "Trade counter",
  "location.depot": "Depot",
  "location.sales_office": "Sales office",
  "location.workshop": "Workshop",

  // ── SEO copy ──
  "seo.product_description": "{product} from {supplier} in {area}. Availability, full specification and a direct enquiry — no account needed.",
  "seo.spec_caption": "Specification for {product}",
  "seo.business_description": "{name} — {category} supplier in {area}, {emirate}. {verification} Contact details, branches and catalogue.",
  "seo.catalogue_description": "{count} products from {name}, a {category} supplier. Availability and full specifications, with no account needed.",
  "seo.branches_description": "All {count} branches of {name}, with addresses, trading hours and Ramadan hours.",
  "seo.reviews_description": "Reviews of {name}, written only by buyers who sent an enquiry through us and had it answered.",
  "seo.unclaimed_description": "{name} holds a {authority} trade licence in {area}, {emirate}. This listing is unclaimed and nothing on it has been verified.",

  // ── Product page ──
  "product.supplied_by": "Supplied by",
  "product.no_template": "This category has no specification template yet.",

  /* Board 1g — product detail. Where a price would sit, and everything around it. */
  /*
     The sentence that turns an apparent omission into a reason. It is true in
     this market: volume, delivery point and terms all move the number. Never
     "log in to see prices", "contact for pricing" or a masked figure — all
     three read as a paywall, which is the one thing this page must not be.
  */
  "pdp.visit_storefront": "Visit storefront →",
  "pdp.price_reason": "This seller quotes per job — volume, delivery point and payment terms all move the number.",
  "pdp.price_reason_reply": "This seller quotes per job — volume, delivery point and payment terms all move the number. Typical reply in about {duration}.",
  "pdp.quantity": "QUANTITY",
  "pdp.availability_col": "AVAILABILITY",
  "pdp.lead_time_col": "LEAD TIME",
  "pdp.qty_caption": "How fast you can have this many, by quantity",
  "pdp.out_of_stock_note": "The seller quotes on indent orders.",
  "pdp.enquire_lead_time": "Enquire about lead time",
  "pdp.request_lead_time_seed": "What is the lead time on {product}, and what quantity would you need?",
  "pdp.whatsapp_seller": "WhatsApp the seller",
  "pdp.add_to_rfq": "Add to a multi-item RFQ",
  "pdp.added_to_rfq": "Added to your RFQ",
  "pdp.send_to_several": "Send to several suppliers →",
  "pdp.qty_label": "Quantity",
  /* This page is the Stepper's first caller, so its labels start here. */
  "stepper.decrement": "One fewer",
  "stepper.increment": "One more",
  "pdp.delivery": "Delivery",
  "pdp.collection": "Collection",
  "pdp.payment_terms": "Payment terms",
  "pdp.min_order": "Min order",
  "pdp.min_order_value": "{qty} pcs",
  "pdp.documents": "Documents",
  "pdp.doc_meta": "{kind} · {size}",
  "pdp.in_stock_at": "In stock — {qty} units at {location}",
  "pdp.in_stock_at_unknown": "In stock at {location}",
  "pdp.stock_stale": "In stock",
  /* The header count and the table must agree. See the spec-section comment. */
  "pdp.spec_meta": "TEMPLATE: {template} v{version} · {filled} OF {total} FIELDS FILLED",
  "pdp.spec_footnote": "Grey fields are template attributes the seller has not filled. Buyers can request them in one click.",
  "pdp.request_specs": "Request the missing fields",
  "pdp.request_specs_seed": "Please confirm these specifications for {product}: {fields}.",
  "pdp.comparison_title": "Same spec, other sellers — enquire with all",
  "pdp.col_seller": "Seller",
  "pdp.col_distinguishing": "Material / seat",
  "pdp.col_lead": "Lead time",
  "pdp.col_replies": "Replies in",
  "pdp.this_page": "· this page",
  "pdp.lead_days": "{days} days",
  "pdp.lead_unstated": "On enquiry",
  "pdp.other_sellers": "OTHER SELLERS",
  "pdp.other_sellers_count": { one: "{count} other verified seller stocks this size", other: "{count} other verified sellers stock this size" },
  "pdp.enquire_with_all": "Enquire with all {count} →",
  /* A genuine selling point, not an empty state. */
  "pdp.only_listing": "This is the only verified listing for this spec.",
  "pdp.ask_seller": "ASK THE SELLER",
  "pdp.questions_answered": { one: "{count} question answered", other: "{count} questions answered" },
  "pdp.no_questions": "No questions answered yet. Ask the first one in an enquiry.",
  "pdp.sticky_enquire": "Send enquiry",

  /* Availability bands. Never a figure in any of them. */
  "bands.collect_today": "Collect today",
  "bands.same_day": "Same-day Dubai",
  "bands.two_days": "48 h",
  "bands.two_days_better": "48 h · better rate",
  "bands.contract": "Contract pricing",
  "bands.weeks": { one: "{count} week", other: "{count} weeks" },
  "bands.by_arrangement": "By arrangement",
  "bands.on_enquiry": "On enquiry",

  /* Board 1g — the seller's questions screen and the staff removal. */
  "questions.title": "Questions",
  "questions.eyebrow": "Buyers asked",
  "questions.intro": "Questions buyers asked about your products. An answer appears on the product page, in your words, beside the question.",
  "questions.unanswered": { one: "{count} waiting for an answer", other: "{count} waiting for an answer" },
  "questions.none": "No questions yet. They arrive from your product pages.",
  "questions.asked_about": "About {product}",
  "questions.asked_when": "Asked {when}",
  "questions.answered_when": "Answered {when}",
  "questions.answer_label": "Your answer",
  "questions.answer_hint": "Buyers see this exactly as you write it, next to the question. You can answer once.",
  "questions.answer_submit": "Post answer",
  "questions.answer_once": "That question already has an answer. A correction is a new question, publicly.",
  "questions.answer_empty": "Write an answer first. Buyers see it beside the question.",
  "questions.answer_too_long": "That answer is over 1,000 characters. Shorten it, or send the detail in a quote.",
  "questions.removed": "Staff removed that question, so it can no longer be answered.",
  "questions.view_product": "View product →",
  /* Staff. */
  "admin.questions.title": "Product questions",
  "admin.questions.none": "No questions to review.",
  "admin.questions.remove": "Remove",
  "admin.questions.reason_label": "Why it is being removed",
  "admin.questions.removed": "Question removed.",
  "admin.questions.already_removed": "That question was already removed.",
  "admin.questions.on": "{business} · {product}",

  // ── Storefront ──
  /* Board 1d — the cover and identity block. */
  "storefront.view_photos": { one: "View {formatted} photo", other: "View all {formatted} photos" },
  /* Pro only. A "Free storefront" badge is an insult to a paying competitor. */
  "storefront.plan_chip": "Pro storefront",
  /* The identity block's primary. It opens a composer the buyer has not filled
     in yet, so it names what they get back — a priced quote. "Send enquiry" is
     the submit inside the composer; "Enquire" is the compact form on cards. */
  "storefront.request_quote": "Request a quote",
  "storefront.call": "Call",
  "storefront.photos_heading": "Photos",
  "storefront.overview": "Overview",
  "storefront.products": "Products",
  "storefront.branches": "Branches",
  "storefront.reviews": "Reviews",
  "storefront.about": "About this supplier",
  "storefront.at_a_glance": "At a glance",
  "storefront.details_title": "Business details",
  "storefront.last_updated": "LAST UPDATED {date}",
  /* The legal name, and the fact that the seller cannot edit it. */
  "storefront.trade_name": "Trade name",
  "storefront.licence_locked": "licence-locked",
  /* The display name — what every card linking here shows. */
  "storefront.trading_as": "Trading as",
  "storefront.payment_terms": "Payment terms",
  "storefront.delivery": "Delivery",
  "storefront.verified_tick": "checked",
  "storefront.licence": "Trade licence",
  "storefront.authority": "Licensing authority",
  "storefront.established": "Established",
  "storefront.team": "Team size",
  "storefront.languages": "Languages",
  "storefront.categories": "Also supplies",
  "storefront.phone": "Phone",
  "storefront.whatsapp": "WhatsApp",
  "storefront.reveal": "Show number",
  "storefront.catalogue": "Catalogue",
  "storefront.catalogue_empty": "This supplier has not listed any products yet.",
  "storefront.view_all_products": "See all {count} products",
  "storefront.hours": "Hours",
  /* Board 1d — the right rail. */
  "storefront.open_until": "Open until {time}",
  "storefront.closed_opens": "Closed · opens {time}",
  /* Said as something that happened, not something the reader must do. */
  "storefront.ramadan_applied": "Ramadan hours are in effect and applied automatically.",
  "storefront.locations": "Locations",
  "storefront.all_branches": "All {count} →",
  "storefront.directions": "Directions",
  "storefront.copy_address": "Copy address",
  "storefront.address_copied": "Address copied",
  "storefront.send_enquiry_title": "Send an enquiry",
  "storefront.answered_within": "Typically answered within {duration}",
  "storefront.answered_unmeasured": "New to the directory — no reply time measured yet",
  /* Both halves of this have to be true, and both are. */
  "storefront.composer_privacy": "No account needed · your number stays hidden until they reply",

  /* Board 1f — branches & hours. */
  "branches.title": "{name} branches — {emirates}",
  "branches.count_eyebrow": { one: "{count} LOCATION", other: "{count} LOCATIONS" },
  "branches.subline": { one: "{count} branch · {emirates}", other: "{count} branches · {emirates}" },
  "branches.emirates_more": "{list} +{count} more",
  "branches.nearest": "Nearest to me",
  /* The strip label changes with the order, so the list never sorts silently. */
  "branches.sorted_emirate": "SORTED BY EMIRATE",
  "branches.sorted_distance": "NEAREST FIRST",
  "branches.locating": "Finding your location",
  /* Says what happened and what the page did instead. Never blames the reader. */
  "branches.location_declined": "Location unavailable, so branches are sorted by emirate.",
  "branches.distance_km": "{km} km away",
  "branches.open_now": "Open now",
  "branches.closed": "Closed",
  "branches.hours_unknown": "Hours not listed",
  "branches.sales_only": "Sales only",
  "branches.call_branch": "Call branch",
  "branches.collection_point": "Collection point",
  "branches.open_map": "Map",
  "branches.list_view": "List",
  "branches.map_view": "Map",
  "branches.mon_thu": "MON–THU",
  "branches.fri_sat": "FRI / SAT",
  "branches.closed_short": "Closed",
  "branches.radius_overlay": "Service radius overlay",
  "branches.delivers_within": "Delivers within {km} km",
  "branches.free_zone": "Free zone address",
  /* Explains the absence rather than showing a grey rectangle. */
  "branches.no_pins": "Map pins are being added for this supplier",
  "branches.unpinned_note": "No map pin yet",
  /* Ramadan: the platform owns the dates, the seller owns the hours. */
  "branches.ramadan_live": "Ramadan hours are live.",
  "branches.ramadan_detail": "Branches that set Ramadan hours switch to them automatically until {until}.",
  "branches.closure_title": "Closed until {until}",
  "branches.closure_dates": "{from} – {until}",
  "verify.panel_title": "What we checked",
  "verify.row_licence": "Trade licence checked",
  "verify.row_trn": "TRN matched",
  "verify.row_not_yet": "{check} — not yet",
  "verify.licence_renewal_pending": "Licence renewal pending",
  /* Board 1d: "the most valuable copy on the page. Do not soften it." */
  "verify.not_self_declared": "Verification is carried out by Business Listings, not self-declared.",
  "verify.report_issue": "Report an issue",
  "storefront.ramadan_hours": "Ramadan hours",
  "storefront.closed": "Closed",
  "storefront.service_radius": "Delivers within {km} km",
  "storefront.unpinned": "This branch has no map pin yet",
  "storefront.no_reviews_title": "No reviews yet",
  "storefront.no_reviews_body": "A review can only be written by a buyer who sent an enquiry through us and had it answered. That is why there are fewer of them here than on other directories, and why the ones there are mean something.",
  "storefront.review_of": "Review of {name}",
  "storefront.review_anonymous": "Buyer, name withheld",
  "storefront.seller_reply": "Reply from the supplier",
  "storefront.rating_overall": "Overall",
  "storefront.rating_quoted": "Quote was accurate",
  "storefront.rating_on_time": "Delivered on time",
  "storefront.rating_described": "As described",
  "storefront.rating_responsive": "Responsiveness",

  // ── Public: reviews & ratings [1m] ──
  //
  // The provenance ladder inverted at the pivot. The board treated a completed
  // transaction as the strongest signal and an accepted quote as the weaker
  // one; nothing is transacted here, so an accepted quote is the strongest
  // thing the platform can prove and the tones swap — ok for the accepted rung,
  // neutral for the enquiry rung it displaced.
  //
  // The four labels a competitor would reach for on the vacated top rung name
  // things that do not exist on this platform and appear nowhere in this file.
  // `check:vocabulary` fails the build on them.
  "reviewpage.title": "Reviews",
  "reviewpage.subline": {
    one: "{formatted} review · {accepted} from accepted quotes",
    other: "{formatted} reviews · {accepted} from accepted quotes",
  },
  "reviewpage.subline_none_accepted": {
    one: "{formatted} review, every one from a confirmed enquiry",
    other: "{formatted} reviews, every one from a confirmed enquiry",
  },
  "reviewpage.write": "Write a review",
  "reviewpage.provenance.accepted_quote": "Accepted quote",
  "reviewpage.provenance.verified_enquiry": "Verified enquiry",
  "reviewpage.rating_label": "Rated {rating} out of 5",
  "reviewpage.overall_heading": "Rating",
  "reviewpage.count": { one: "{formatted} review", other: "{formatted} reviews" },
  "reviewpage.from_count": { one: "FROM {formatted} REVIEW", other: "FROM {formatted} REVIEWS" },
  "reviewpage.distribution_heading": "Rating breakdown",
  "reviewpage.distribution_row": "{rating} out of 5",
  "reviewpage.distribution_count": "{formatted} of {total} reviews rated {rating} out of 5",
  "reviewpage.see_breakdown": "See breakdown",
  "reviewpage.rated_on": "Rated on",
  "reviewpage.provenance_title": "Who can review",
  "reviewpage.provenance_body": "Only buyers can review. Reviews require a confirmed enquiry or an accepted quote on the platform. Sellers can reply once, publicly.",
  "reviewpage.provenance_removal": "A review comes down only when staff remove it, with a written reason recorded in the audit log. A supplier cannot remove one.",
  "reviewpage.filter_label": "Show",
  "reviewpage.filter.all": "All",
  "reviewpage.filter.accepted": "Accepted quote",
  "reviewpage.filter.photos": "With photos",
  "reviewpage.filter.critical": "Critical",
  "reviewpage.sort_label": "Sort",
  "reviewpage.sort.recent": "Most recent",
  "reviewpage.sort.highest": "Highest rated",
  "reviewpage.sort.lowest": "Lowest rated",
  "reviewpage.sort.detailed": "Most detailed",
  "reviewpage.sort_apply": "Apply",
  "reviewpage.load_more": { one: "Load {count} more review", other: "Load {count} more reviews" },
  "reviewpage.seller_reply": "Reply from {name}",
  "reviewpage.photo_alt": "Photo from a review of {name}",
  "reviewpage.held": {
    one: "One review is being reviewed by our team.",
    other: "{formatted} reviews are being reviewed by our team.",
  },
  "reviewpage.filtered_zero_title": "No reviews match that filter",
  "reviewpage.filtered_zero_body": "Nothing has been hidden. The other {formatted} are one click away.",
  "reviewpage.filtered_zero_cta": "Show all reviews",
  "seo.reviews_title": "{name} reviews — {rating} from {formatted} reviews",
  "storefront.team_band.b1_10": "1–10",
  "storefront.team_band.b11_50": "11–50",
  "storefront.team_band.b51_200": "51–200",
  "storefront.team_band.b201_500": "201–500",
  "storefront.team_band.b500_plus": "Over 500",
  "storefront.day.sun": "Sunday",
  "storefront.day.mon": "Monday",
  "storefront.day.tue": "Tuesday",
  "storefront.day.wed": "Wednesday",
  "storefront.day.thu": "Thursday",
  "storefront.day.fri": "Friday",
  "storefront.day.sat": "Saturday",
  // Three letters, for a day range: "Mon – Thu". Separate keys rather than a
  // slice of the full name, because a locale that abbreviates differently — or
  // does not abbreviate at all — needs to say so rather than be truncated.
  "storefront.day_short.sun": "Sun",
  "storefront.day_short.mon": "Mon",
  "storefront.day_short.tue": "Tue",
  "storefront.day_short.wed": "Wed",
  "storefront.day_short.thu": "Thu",
  "storefront.day_short.fri": "Fri",
  "storefront.day_short.sat": "Sat",

  // ── Search and results ──
  "results.businesses_tab": "Suppliers",
  "results.products_tab": "Products",
  "results.count": { one: "{count} supplier", other: "{count} suppliers" },
  "results.product_count": { one: "{count} product", other: "{count} products" },
  "results.in_area": "{count} in {area}",
  "results.sponsored": "Sponsored",
  "results.sponsored_note": "A supplier pays for this slot. It never outranks a verified supplier on a filter you set.",
  "results.filters": "Filters",
  "results.filters_count": "Filters ({count})",
  "results.show_results": "Show results",
  "results.applied": { one: "{count} filter applied", other: "{count} filters applied" },
  "results.clear_all": "Clear all",
  "results.remove_filter": "Remove the {facet} filter",
  "results.facet_selected": "selected, activate to remove",

  "facet.tier": "Verification",
  "facet.tier_option": "Tier {tier} and up",
  "facet.emirate": "Emirate",
  "facet.availability": "Availability",
  "facet.free_zone": "Free zone",
  "facet.free_zone_option": "Free zone only",
  "facet.reply": "Replies within",
  "facet.reply_option": "{hours} hours",
  "facet.years": "Years trading",
  "facet.years_option": "{years} years or more",
  "facet.area": "Area",
  /* The map viewport is a filter like any other, and removable like one. A
     buyer who cannot see why they have eleven results cannot undo it. */
  "facet.map_area": "Map area",
  "facet.map_area_option": "This part of the map",

  // ── Zero results, board 10c. A designed state, not a fallback. ──
  "zero.title": "Nothing matches all of that",
  "zero.query_title": "No supplier matches “{query}”",
  "zero.drop": "Drop the {facet} filter",
  "zero.drop_yields": { one: "{count} result", other: "{count} results" },
  "zero.nothing_helps": "Removing any single filter still returns nothing. The words themselves may be the problem — try a broader term, or the category browse.",
  "zero.rfq_title": "Ask the whole trade instead",
  "zero.rfq_body": "Send one requirement to up to eight suppliers and let them come to you. This is how buyers find the things nobody has listed yet.",
  "zero.rfq_cta": "Post a requirement",
  "zero.browse": "Browse {category}",
  "zero.recorded": "We record searches that find nothing, and use them to decide which trades to go and recruit.",

  // ── Category pages ──
  "category.subcategories": "Browse by type",
  // ── Board 1b, the category browse header ──
  //
  // "RFQ" is internal vocabulary and appears on no control here; the route is
  // /rfq/new and the button says what the buyer is doing.
  // Board 10e, the half of it board 1b's save button needs.
  "saved.title": "Saved searches",
  "saved.lede": "Open one to see today's results for the same filters.",
  "saved.empty": "Nothing saved yet. Use “Save this search” on any results page.",
  "saved.forget": "Remove",
  "browse.search_in": "Search in {category}",
  "browse.heading_uae": "{category} in the UAE",
  "browse.heading_emirate": "{category} in {emirate}",
  "browse.heading_area": "{category} in {area}, {emirate}",
  "browse.stat_suppliers": { one: "{count} licensed supplier", other: "{count} licensed suppliers" },
  "browse.stat_catalogues": "{count} with online catalogues",
  "browse.stat_products": "{count} products listed",
  "browse.save_search": "Save this search",
  "browse.saved": "Saved",
  "browse.save_needs_account": "Sign in to keep this search.",
  "browse.enquire_all": "Send one enquiry to {count}",
  "browse.subcategories": "Browse by type",
  "browse.all": "All",
  "browse.more_subcategories": "+ {count} more",
  "browse.sort": "Sort",
  "browse.sort_best": "Best match",
  "browse.sort_rating": "Rating",
  "browse.sort_reply": "Fastest reply",
  "browse.sort_newest": "Newest",
  "browse.view_list": "List",
  "browse.view_grid": "Grid",
  "browse.range": "{from}–{to} of {total}",
  "browse.sponsored_note": "Pro subscribers appear in the top slot for their subcategory and emirate.",
  "browse.sponsored_rates": "See placement rates →",
  "category.suppliers_in": "{category} suppliers in the UAE",
  "category.intro_count": "{count} listed suppliers, {verified} of them verified.",
  "seo.category_description": "{count} {category} suppliers across the UAE. Filter by verification, emirate and specification, then send one enquiry.",

  // ── Home ──
  //
  // Board 1a was drawn before the e-commerce pivot and two strings survived it.
  // The spec corrects both, and they are corrected here: "then talk to them",
  // not "then buy from them"; "published specs", not "live prices". Nothing on
  // this page may imply buying, a cart, a checkout or a price.
  "home.hero_title": "Find a verified UAE supplier, then talk to them.",
  "home.hero_body":
    "{listings} licensed businesses across {sectors} sectors — with real catalogues, published specs and trade licences we've checked ourselves.",
  "home.search_cta": "Search",
  "home.search_landmark": "Search the directory",
  "home.search_what": "What",
  "home.search_what_placeholder": "What do you need?",
  "home.search_where": "Where",
  "home.search_where_all": "All UAE",
  "home.search_where_area": "{emirate} · All areas",
  "home.popular": "Popular:",

  // The open-RFQ panel. Its own rules are in lib/db/queries/home.ts.
  "home.rfq_title": "Open requests for quotes",
  "home.rfq_live": "LIVE",
  "home.rfq_meta": "{category} · {place} · {quotes} · {age}",
  "home.rfq_quotes": { one: "{count} QUOTE", other: "{count} QUOTES" },
  "home.rfq_uae": "UAE",
  "home.rfq_footer": "Post a request, get quotes free",
  "home.rfq_footer_signed_in": "Post a request",
  "home.rfq_cta": "Post RFQ →",

  // The panel that replaces it when no open request can be shown safely.
  "home.trust_title": "Why suppliers here are different",
  "home.trust_1": "Every listing starts from a trade licence we read ourselves.",
  "home.trust_2": "Tier 2 means we called the number on the licence and someone answered.",
  "home.trust_3": "Tier 3 means one of our team stood in the warehouse.",
  "home.trust_4": "Response time is measured from real replies, never claimed by the seller.",
  "home.trust_cta": "How verification works →",

  "home.browse_title": "Browse by category",
  "home.browse_all": "All {sectors} sectors · {subcategories} subcategories →",
  "home.suppliers_in": { one: "{count} supplier", other: "{count} suppliers" },
  "home.listings_count": { one: "{count} listing", other: "{count} listings" },

  "home.emirate_eyebrow": "By emirate",
  "home.free_zones": "Free zones only",

  "home.verified_title": "Verified this week",
  // "the audited tier" was rung 3 when it moved down from 4 and carried wording
  // about a trading history nobody measures. Board 3e renamed the rung to trade
  // references and marked it unbuilt — `verify.t3.checked` says "Not built yet"
  // — and this sentence, on the busiest public surface on the site, went on
  // describing the check it had just retired. It now says the two things this
  // platform actually does.
  "home.verified_body":
    "The trade licence checked against the issuing authority, and the contact details confirmed on the public licence record.",
  "home.verified_all": "See all verified →",

  "home.catalogue_title": "New in supplier catalogues",
  "home.catalogue_all": "Browse all products →",

  "home.seller_title": "Your storefront, live this afternoon.",
  "home.seller_body":
    "Claim your listing free. Add locations, upload your catalogue, pick a spec template for your category, and start taking enquiries — no developer, no agency retainer.",
  "home.seller_cta": "Claim your listing",
  // Shown instead of the claim band to somebody who has already claimed one.
  "home.seller_signed_in": "You have a listing here. Everything above is what a buyer sees.",
  "home.seller_dashboard": "Go to your dashboard →",
  "home.plan_free": "1 location · contact · 3 photos",
  "home.plan_month": "/mo",

  "home.footer_blurb":
    "The UAE's self-serve business directory and storefront platform. Licensed businesses only.",
  "home.footer_buyers": "Buyers",
  "home.footer_businesses": "Businesses",
  "home.footer_company": "Company",
  "home.footer_legal": "© {year} BUSINESSLISTINGS.ME · DUBAI, UAE",
  "home.footer_locale": "EN",
  "home.link_browse_categories": "Browse categories",
  "home.link_post_rfq": "Post an RFQ",
  "home.link_browse_products": "Browse products",
  "home.link_my_enquiries": "My enquiries",
  "home.link_list_business": "List your business",
  "home.link_claim": "Claim a listing",
  "home.link_pricing": "Pricing & plans",
  "home.link_verification": "Verification guide",
  "home.link_about": "About",
  "home.link_contact": "Contact",
  "home.link_terms": "Terms & privacy",
  "home.link_report": "Report a listing",

  "seo.home_title": "UAE business directory — {listings} verified suppliers",
  "seo.home_description": "{listings} licensed UAE suppliers across {categories} trades. Search by product, size or specification, then send one enquiry.",

  // ── Compare ──
  "compare.title": "Compare suppliers",
  "compare.empty_title": "Nothing to compare yet",
  "compare.empty_body": "Add suppliers from a search or a category page and they appear here side by side.",
  "compare.browse": "Browse the directory",
  "compare.enquire_all": { one: "Send one enquiry to {count} supplier", other: "Send one enquiry to all {count}" },
  "compare.remove": "Remove {name} from the comparison",
  "compare.attribute": "Attribute",
  "compare.verification": "Verification",
  "compare.response": "Typical reply",
  "compare.products": "Products listed",
  "compare.reviews": "Reviews",
  "compare.branches": "Branches",
  "compare.emirates": "Emirates covered",
  "compare.established": "Trading since",
  "compare.team": "Team size",
  "compare.languages": "Languages",
  "compare.licence": "Trade licence",
  "compare.caption": "Suppliers compared side by side",
  "compare.limit": "Up to {limit} suppliers at a time.",
  "compare.no_price": "No prices here. A supplier quotes you privately once you send an enquiry.",

  // ── Trust ──
  "verification.tier": "Verification tier {tier}",
  "verification.unverified": "Not yet verified",
  "response.median": "Typically replies in {duration}",
  "response.unmeasured": "Not enough enquiries to measure",

  // ── Payment terms. Keyed to the PaymentTerms enum so t(`terms.${value}`)
  //    is total: adding a value to the enum breaks the build here first.
  //    The trade.terms_* keys above are specimen labels for the gallery. ──
  "terms.advance": "Payment in advance",
  "terms.cod": "Cash on delivery",
  "terms.net_15": "15 days from invoice",
  "terms.net_30": "30 days from invoice",
  "terms.net_60": "60 days from invoice",
  "terms.lc": "Letter of credit",

  // ── Seller: leads and RFQ inbox [3j] ──
  "leads.title": "Leads & RFQ",
  "leads.subtitle": { one: "{count} open enquiry", other: "{count} open enquiries" },
  "leads.caption": "Enquiries sent to this business",
  "leads.col.ref": "Ref",
  "leads.col.requirement": "Requirement",
  "leads.col.buyer": "Buyer",
  "leads.col.lines": "Lines",
  "leads.col.received": "Received",
  "leads.col.closes": "Closes",
  "leads.col.state": "State",
  "leads.col.quote": "Your quote",
  "leads.lines_and_qty": { one: "{count} line, {qty} off", other: "{count} lines, {qty} off" },
  "leads.open": "Open",
  "leads.open_named": "Open enquiry {ref}",
  "leads.empty_title": "No open enquiries",
  "leads.empty_body": "Enquiries matched to your categories, emirate and stock arrive here. Listing more products with full specifications is what gets you matched.",

  /* ── Board 3j: the tabs ──

     Defined by what has happened rather than by a column, because two of them
     are things the BUYER decided. Open means unquoted, not untouched: a lead in
     conversation is still open, since a message is not a quote.
  */
  "leads.tabs_label": "Which leads to show",
  "leads.tab.open": "Open",
  "leads.tab.quoted": "Quoted",
  "leads.tab.won": "Won",
  "leads.tab.lost": "Lost",

  /* ── The scope filter ──

     An owner defaulted to their own assignments cannot see the queue they are
     answerable for, so the default is everything and the narrowing is a choice.
  */
  "leads.scope_label": "Whose leads",
  "leads.scope.all": "All enquiries",
  "leads.scope.mine": "Assigned to me",
  "leads.scope.unassigned": "Unassigned",

  /* ── The two header figures ──

     Both read the same numbers as the dashboard overview. A pill quoting a
     different median from the card one screen away is the disagreement that
     makes a seller stop believing either.
  */
  "leads.overdue_pill": { one: "{count} overdue", other: "{count} overdue" },
  "leads.none_overdue": "Nothing overdue",
  "leads.median_reply": "Median reply {duration}",
  "leads.median_unmeasured": "Not enough replies to measure yet",

  /* ── The rail ──

     The footer states what is shown against what exists, because a list that
     silently stops at twenty-five is a list a seller believes is complete.
  */
  "leads.rail_label": "Leads, oldest waiting first",
  "leads.rail_footer": "{shown} of {total} shown · oldest first within each overdue band",
  "leads.rail_all_shown": { one: "{count} lead", other: "{count} leads" },
  "leads.rail_more": "Show more",

  /* ── The waiting bands ──

     Measured against this supplier's own escalation setting, which is the only
     definition of late the product already publishes to them — the hourly sweep
     emails the owner on exactly this predicate. A second threshold on the rail
     would put a red row beside an email saying the lead is fine.

     Each band carries a word. Colour alone is not a status.
  */
  "leads.band.breached": "Overdue",
  "leads.band.approaching": "Due soon",
  "leads.band.waiting": "Waiting",
  "leads.band.answered": "Answered",
  "leads.waiting_for": "Waiting {duration}",
  "leads.answered_in": "Answered in {duration}",
  "leads.band_explained": "Overdue means past the {duration} you set for escalation.",

  /* ── What a rail row carries ──

     `leads.budget` is the buyer's own figure, summed from the lines that carry
     one, and it says so. It is not an estimate of the deal: `targetUnitPriceAed`
     is what the buyer hopes to pay, and calling it a value would turn a budget
     into a deal size. A row where no line carries one shows nothing.
  */
  "leads.budget": "Buyer's budget {amount}",
  "leads.competing": { one: "{count} supplier competing", other: "{count} suppliers competing" },
  "leads.unread": { one: "{count} new message", other: "{count} new messages" },
  "leads.assigned_to": "Assigned to {name}",
  "leads.unassigned": "Unassigned",

  /* ── Empty states, one per tab ──

     Four different things, per the design system: this is filtered-to-zero, not
     first-run. Each says what would put a row here.
  */
  "leads.empty.open": "Nothing waiting on you",
  "leads.empty.open_body": "Every enquiry that has reached you has a quote against it. New ones arrive here.",
  "leads.empty.quoted": "No quotes waiting on a decision",
  "leads.empty.quoted_body": "Quotes you have sent that the buyer has not decided on appear here.",
  "leads.empty.won": "Nothing marked won yet",
  "leads.empty.won_body": "A lead lands here when a buyer accepts your quote, or when you mark it won yourself.",
  "leads.empty.lost": "Nothing marked lost",
  "leads.empty.lost_body": "A lead lands here when a buyer accepts another supplier, or when you mark it lost yourself.",
  "leads.empty.scope": "No leads assigned to you",
  "leads.empty.scope_body": "Switch to all enquiries to see the rest of the queue.",

  "leads.suspended_title": "This listing is suspended",
  "leads.suspended_body": "New enquiries have stopped arriving and quotes cannot be sent. The thread stays readable. Your verification page says what is needed.",
  "leads.select_prompt": "Pick a lead",
  "leads.select_body": "Choose an enquiry from the list to read what the buyer asked for and price it.",
  "leads.state.delivered": "New",
  "leads.state.opened": "Opened",
  "leads.state.quoted": "Quoted",
  "leads.state.declined": "Declined",
  "leads.state.no_response": "No response",
  "leads.closes_in": "Closes in {duration}",
  "leads.closes_on": "Closes {when}",
  "leads.closed": "Closed",
  "leads.no_quote_yet": "Not quoted",
  "leads.quote_summary": "r{revision} · {total}",

  // ── Seller: one lead, and the quote composer on it [11b] ──
  "lead.eyebrow": "Enquiry {ref}",
  "lead.requirement": "Requirement",
  "lead.deliver_to": "Deliver to",
  "lead.needed_by": "Needed by",
  "lead.terms_wanted": "Terms wanted",
  "lead.received": "Received",
  "lead.closes": "Closes",
  "lead.buyer": "Buyer",
  "lead.compose_title": "Your quote",
  "lead.compose_description": "Prices here are private to this buyer. Nothing on this quote appears on your public listing.",
  "lead.revision_title": "Revision {revision}",
  "lead.previous_quotes": "Sent already",
  "lead.quote_sent_at": "Sent {when}",
  /* ── Board 3j: the request header ──

     Everything the buyer supplied, above the composer, so the seller never
     scrolls to reach the price field.
  */
  "lead.buyer_words": "What the buyer asked for",
  "lead.buyer_words_note": "The buyer's own words, as submitted. Sellers price off details a summary would lose.",
  "lead.attachment": "Attachment",
  "lead.closes_label": "Closes",
  "lead.type.rfq": "RFQ · line-item composer",
  "lead.type.enq": "Enquiry · message",
  "lead.no_lines_title": "Nothing to price on this one",
  "lead.no_lines_body": "The buyer asked a question rather than for quantities. Answer it in the thread.",

  /* ── The three header actions, and the one that bridges to 11b ──

     "Message the buyer", not "chat with the seller": the person reading this
     screen IS the seller, and buyer/seller is load-bearing vocabulary here.
  */
  "lead.assign": "Assign",
  "lead.assign_label": "Assign this lead to a seat",
  "lead.assign_nobody": "Nobody",
  "lead.assign_self": "{name} (you)",
  "lead.assign_unnamed": "A seat with no name yet",
  "lead.assign_saved": "Assigned to {name}",
  "lead.assign_cleared": "Assignment cleared",
  "lead.message_buyer": "Message the buyer",
  "lead.message_buyer_unread": "Message the buyer · {count} new",
  "lead.mark_won": "Mark won",
  "lead.mark_lost": "Mark lost",
  "lead.reopen": "Clear the outcome",
  "lead.outcome.won": "You marked this won",
  "lead.outcome.lost": "You marked this lost",
  "lead.outcome.observed_won": "The buyer accepted your quote",
  "lead.outcome.observed_lost": "The buyer accepted another supplier",
  "lead.outcome_marked_by": "Marked by {name}, {when}",
  "lead.lost_reason_label": "Why, in a few words",
  "lead.lost_reason_placeholder": "Price, lead time, no answer — whatever it was.",
  "lead.lost_reason_optional": "Optional. Nobody outside your team reads it.",
  "lead.lost_confirm": "Mark it lost",
  "lead.cancel": "Cancel",
  /* The dialog's own dismiss, distinct from the Cancel button beside Confirm.
     Two controls reading "Cancel" is two controls a screen reader cannot tell
     apart, and they do different things. */
  "lead.close": "Close",
  "lead.outcome_no_value": "No amount is recorded. Quoted value is the sum of accepted quotes, so it stays a measurement rather than a figure anyone types.",

  /* Refusals, said in full rather than as a code. */
  "lead.error.not_yours": "This enquiry is not one of yours.",
  "lead.error.not_yours_to_mark": "Only the seat this lead is assigned to, or a manager, can mark an outcome.",
  "lead.error.buyer_decided": "The buyer has accepted your quote on this one, so it cannot be marked lost.",
  "lead.error.not_quoted": "Send a quote first. There is nothing to win or lose yet.",
  "lead.error.decided": "This lead has an outcome. Clear it first to change anything.",
  "lead.error.not_your_seat": "That person is not on your team.",

  /* Why the composer is read-only, said rather than left to be worked out. */
  "lead.readonly_outcome": "This lead has an outcome. Clear it to quote again.",
  "lead.readonly_closed": "The enquiry has closed, so no further quote can be sent. The thread stays open.",
  "lead.readonly_suspended": "Quotes cannot be sent while the listing is suspended.",

  /* ── The composer's autosave ── */
  "lead.draft_saved": "Saved {when}",
  "lead.draft_saving": "Saving",
  "lead.draft_restored": "Picked up where you left off. Nothing is sent until you send it.",
  "lead.draft_discard": "Start again",

  "lead.not_found_title": "This enquiry is not one of yours",
  "lead.not_found_body": "It was either sent to another supplier or the reference is wrong. Your open enquiries are on the leads page.",
  "lead.back_to_leads": "Back to leads",

  // ── Contact release. Rule 1 of the enquiry engine, said out loud. ──
  "contact.withheld_title": "Contact details are released when a quote is accepted",
  "contact.withheld_body": "You see {name} and the requirement. The phone number, email and company name are released to you alone if {name} accepts your quote.",
  "contact.released_title": "Contact released",
  "contact.released_body": "{name} accepted your quote on {when}.",
  /* No date rather than today's, where the row never recorded one. */
  "contact.released_undated": "{name} accepted your quote.",

  // ── Quote line editor [3k] ──
  "quote.editor.form": "Quote lines and terms",
  "quote.editor.caption": "Quote lines, with a unit price and lead time for each",
  "quote.col.line": "Line",
  "quote.col.product": "From your catalogue",
  "quote.col.qty": "Qty",
  "quote.col.unit_price": "Unit price",
  "quote.col.lead_time": "Lead time",
  "quote.col.total": "Line total",
  "quote.manual_flag": "Price by hand",
  "quote.manual_help": "Nothing in your catalogue matches this line.",
  "quote.matched_by.sku": "Matched on your SKU",
  "quote.matched_by.size": "Matched on size",
  "quote.matched_by.wording": "Matched on wording",
  "quote.matched_by.size_and_wording": "Matched on size and wording",
  "quote.price_by_hand": "None of these — price by hand",
  "quote.choose_product": "No catalogue match",
  "quote.target_price": "Buyer's target {amount}",
  "quote.lead_time_suffix": "days",
  "quote.unit_price_for": "Unit price for {line}",
  "quote.lead_time_for": "Lead time in days for {line}",
  "quote.product_for": "Catalogue product for {line}",
  "quote.excluded": "Not quoted",
  "quote.exclude": "Remove",
  "quote.include": "Add back",
  "quote.total": "Total",
  "quote.currency_note": "All amounts in AED, excluding VAT.",
  "quote.note_label": "Note to the buyer",
  "quote.note_placeholder": "Stock position, what is on the shelf, what needs ordering.",
  "quote.validity_label": "Hold this price for",
  "quote.validity_help": "The buyer sees the date this quote expires.",
  "quote.validity_days": { one: "{count} day", other: "{count} days" },
  "quote.send": "Send quote",
  "quote.sending": "Sending",
  "quote.send_revision": "Send revision {revision}",
  "quote.error.unpriced": { one: "One line has no unit price: {lines}. Every line you send needs a price, or remove it from the quote.", other: "These lines have no unit price: {lines}. Every line you send needs a price, or remove them from the quote." },
  "quote.error.bad_price": "The unit price for {line} is not an amount in dirhams. Use digits and at most two decimal places, for example 398.00.",
  "quote.error.bad_qty": "The quantity for {line} is not a whole number of units. Use a whole number of one or more.",
  "quote.error.nothing_included": "Every line has been removed. A quote needs at least one line.",
  "quote.error.not_your_enquiry": "This enquiry was not sent to your business.",
  "quote.error.closed": "This enquiry closed on {when}. A quote can no longer be sent.",
  "quote.error.line_not_on_enquiry": "A line on this quote is not on the enquiry. Reload the page and price it again.",
  "quote.error.product_not_yours": "A product on this quote does not belong to your catalogue.",

  // ── Seller: quotes pipeline [3k] ──
  "quotes.title": "Quotes sent",
  "quotes.subtitle": { one: "{count} quote", other: "{count} quotes" },
  "quotes.caption": "Quotes this business has sent, newest first",
  "quotes.col.ref": "Ref",
  "quotes.col.enquiry": "Enquiry",
  "quotes.col.buyer": "Buyer",
  "quotes.col.lines": "Lines",
  "quotes.col.value": "Value",
  "quotes.col.sent": "Sent",
  "quotes.col.state": "State",
  "quotes.state.draft": "Draft",
  "quotes.state.sent": "Sent",
  "quotes.state.read": "Read",
  "quotes.state.accepted": "Accepted",
  "quotes.state.lost": "Lost",
  "quotes.state.expired": "Expired",
  // lostReason holds a code, not a sentence. English in a database column is a
  // translation that can never happen.
  "quotes.lost.buyer_accepted_another": "The buyer accepted another supplier",
  "quotes.lost.no_response": "No reply before the enquiry closed",
  "quotes.superseded": "Superseded by r{revision}",
  "quotes.manual_lines": { one: "{count} priced by hand", other: "{count} priced by hand" },
  "quotes.expires_in": "Expires in {duration}",
  "quotes.expires_on": "Expires {when}",
  "quotes.expired_on": "Expired {when}",
  "quotes.empty_title": "No quotes sent yet",
  "quotes.empty_body": "A quote you send from a lead appears here with what the buyer did with it.",
  "quotes.open_named": "Open quote {ref}",
  "quotes.value_note": "Quoted value, self-reported.",

  /* ── Board 3k: the pipeline ──

     One row per lead, showing its latest revision. A revision is a version of
     one quote rather than a second row, so the tabs count leads that carry a
     quote — which is the same 41 board 3j's inbox reconciles against.
  */
  "quotes.pipeline_subtitle": { one: "{count} awaiting a decision", other: "{count} awaiting a decision" },
  "quotes.tabs_label": "Which quotes to show",
  "quotes.tab.all": "All",
  "quotes.tab.awaiting": "Awaiting decision",
  "quotes.tab.expiring": "Expiring soon",
  "quotes.tab.won": "Won",
  "quotes.tab.lost": "Lost",
  "quotes.tab.expired": "Expired",

  /* The strip names its denominator. A percentage without one is a number
     nobody can check — §8.2, and the board's own `34% won` had none. */
  "quotes.strip": "{total} quoted across {count} sent",
  "quotes.strip_won": "{won} of {count} marked won",
  "quotes.strip_caveat": "Outcomes as you marked them",

  "quotes.col.requirement": "Buyer and requirement",
  "quotes.col.quoted": "Quoted (AED)",
  "quotes.col.valid_until": "Valid until",
  "quotes.col.status": "Status",
  "quotes.col.actions": "What you can do",

  "quotes.state.awaiting": "Awaiting decision",
  "quotes.state.won": "Won",
  /* Prefixed wherever the text is the seller's own record, per §4. */
  "quotes.marked_won": "You marked this won",
  "quotes.marked_lost": "You marked this lost",
  "quotes.observed_won": "The buyer accepted your quote",
  "quotes.observed_lost": "The buyer accepted another supplier",
  "quotes.you_marked": "You marked: {reason}",

  "quotes.valid_days": { one: "{when} · {count} day", other: "{when} · {count} days" },
  "quotes.valid_none": "—",
  /* A quote sent before validity was a field. `sendQuoteForBusiness` has always
     set one since, so this is history rather than a state anything can reach —
     and history with no date is better said than guessed at. */
  "quotes.valid_unknown": "No window recorded",
  "quotes.extended_once": "Extended once",
  "quotes.extended_times": { one: "Extended {count} time", other: "Extended {count} times" },

  "quotes.action.extend": "Extend",
  "quotes.action.nudge": "Nudge",
  "quotes.action.revise": "Revise",
  "quotes.action.view": "View",
  "quotes.action.requote": "Re-quote",
  "quotes.action_for": "{action} {ref}",

  /* ── Extend ──

     The two facts a seller needs before touching it, said before they do:
     it moves the date the buyer already holds, and it sends them nothing.
  */
  "quotes.extend.title": "Extend {ref}",
  "quotes.extend.body": "This moves the date on the quote the buyer already holds. It does not message them — if you want them to know, send the follow-up instead.",
  "quotes.extend.current": "Valid until {when}",
  "quotes.extend.preset": "Add {count} days",
  "quotes.extend.pick": "Or pick a date",
  "quotes.extend.pick_label": "New expiry date",
  "quotes.extend.ceiling": "The furthest you can push this is {when}, sixty days from when you sent it. Past that, send a fresh quote rather than holding an old price.",
  "quotes.extend.confirm": "Extend it",
  "quotes.extend.cancel": "Cancel",
  "quotes.extend.close": "Close",
  "quotes.extend.done": "Now valid until {when}",
  "quotes.extend.count_note": { one: "Extended {count} time already", other: "Extended {count} times already" },

  "quotes.error.not_your_quote": "That quote is not one of yours.",
  "quotes.error.not_yours_to_extend": "Only the seat this lead is assigned to, or a manager, can move its date.",
  "quotes.error.expired": "The window has already closed. Send a fresh quote instead — the old price is a different commitment now.",
  "quotes.error.decided": "This one has an outcome, so the date no longer matters.",
  "quotes.error.too_far": "That is more than sixty days from when you sent it. Send a fresh quote instead.",
  "quotes.error.backwards": "Pick a date after the one the buyer already has. This screen extends a window; it does not shorten one.",
  "quotes.error.suspended": "Quotes cannot be changed while the listing is suspended.",

  /* The follow-up, reached from the pipeline. Same act, same cap, same words as
     the thread's — only the surface differs. */
  "quotes.nudge.title": "Follow up on {ref}",
  "quotes.nudge.body": "This goes to the buyer as a message on the thread, tagged as automatic.",
  "quotes.nudge.label": "What the follow-up will say",
  "quotes.nudge.placeholder": "Following up on the quote — happy to talk through the dates.",
  "quotes.nudge.confirm": "Send it",
  "quotes.nudge.cap": "One follow-up per lead. A second loses more deals than it wins, so we do not offer one.",

  /* ── The two cards ── */
  "quotes.speed.heading": "Your reply speed and your outcomes",
  "quotes.speed.fast": "Quoted within {count} hours",
  "quotes.speed.slow": "Quoted after {count} hours",
  "quotes.speed.won_of": "{won} of {count} won",
  /* An empty bucket has no record to read back. Saying "0 of 0 won" would be a
     measurement nobody took. */
  "quotes.speed.unmeasured": "Nothing resolved in this band yet",
  "quotes.speed.counts_note": "Counts, not rates — too few resolved quotes to state as a percentage. Win and loss are as you marked them, so this reads your own record back to you: we never see the order.",
  "quotes.speed.expired_read": { one: "{late} of your {count} expired quote was sent more than a day after the enquiry landed.", other: "{late} of your {count} expired quotes were sent more than a day after the enquiry landed." },
  "quotes.speed.empty": "Nothing resolved yet. Once buyers start deciding, this reads your own record back to you.",

  "quotes.expiring.heading": { one: "{count} quote expires this week", other: "{count} quotes expire this week" },
  "quotes.expiring.none": "Nothing expires in the next seven days.",
  "quotes.expiring.days": { one: "{count} day", other: "{count} days" },
  "quotes.expiring.note": "Extending changes the date the buyer sees. It does not message them — and each lead gets one follow-up, so spend it deliberately.",

  /* ── Export ── */
  "quotes.export.action": "Export pipeline",
  "quotes.export.caveat": "Won and lost are as the supplier marked them. This platform takes no payment and never sees the order.",
  /* The table's head combines the two into one cell; the file keeps them apart,
     so it needs its own word rather than borrowing the column's. */
  "quotes.export.requirement_head": "Requirement",
  "quotes.export.total_head": "Quoted (AED)",
  "quotes.export.extended_head": "Times extended",
  "quotes.export.reason_head": "Reason you gave",

  /* ── States ── */
  "quotes.footer": "{shown} of {total} shown · newest sent first",
  "quotes.footer_all": { one: "{count} quote", other: "{count} quotes" },
  "quotes.more": "Show more",
  "quotes.empty.awaiting": "Nothing waiting on a buyer",
  "quotes.empty.awaiting_body": "Quotes you have sent that nobody has decided on appear here, with the date each one runs out.",
  "quotes.empty.expiring": "Nothing expires this week",
  "quotes.empty.expiring_body": "A quote whose window closes in the next seven days appears here so you can extend it or follow it up.",
  "quotes.empty.won": "Nothing marked won yet",
  "quotes.empty.won_body": "A quote lands here when a buyer accepts it, or when you mark it won yourself.",
  "quotes.empty.lost": "Nothing marked lost",
  "quotes.empty.lost_body": "A quote lands here when a buyer accepts another supplier, or when you mark it lost yourself.",
  "quotes.empty.expired": "No windows have closed unanswered",
  "quotes.empty.expired_body": "A quote whose validity ran out with no decision appears here, ready to re-quote.",
  "quotes.empty.inbox_link": "Go to your leads",
  "quotes.suspended_title": "This listing is suspended",
  "quotes.suspended_body": "Quotes cannot be extended or followed up while it is. The pipeline stays readable.",

  /* The thread's system line for an extension. Not a message — §5 is explicit
     that extending is silent, and a line in the record is not a notification. */
  "quotes.extended_note": "Validity extended to {when} by {name}.",
  "quotes.extended_note_unnamed": "Validity extended to {when}.",

  // ── Buyer: the enquiry composer [1d] [1e] [1h] ──
  /* Board 1h — /rfq/new, the fan-out. Header copy the spec sets word for word. */
  "rfq.h1": "Request a quote",
  /* The sentence the page converts on. It is a promise the query layer keeps. */
  "rfq.sub": "One request, up to 8 sellers. They see your requirement; they don't see your number until you accept a quote.",
  "rfq.step.items": "Items",
  "rfq.step.requirement": "Requirement",
  "rfq.step.send": "Send",
  "rfq.step_compact": "{current} / {total}",
  "rfq.items_title": "Items you need",
  "rfq.add_another": "+ Add another line",
  "rfq.col_product": "PRODUCT",
  "rfq.col_qty": "QTY",
  "rfq.col_target": "TARGET PRICE",
  "rfq.col_remove": "Remove",
  "rfq.items_caption": "The items you are asking about",
  /* Never "PRICE" and never "BUDGET" — the spec is explicit. */
  "rfq.target_hint": "Optional. Only the sellers you pick see it.",
  "rfq.unmatched": "NOT MATCHED TO A LISTING",
  "rfq.matched_from": "{sku} · FROM {seller}",
  "rfq.matched_from_no_sku": "FROM {seller}",
  "rfq.line_placeholder": "Grooved gasket, EPDM, 4 inch",
  "rfq.requirement_title": "Your requirement",
  "rfq.notes_label": "Notes for the seller",
  "rfq.notes_placeholder": "Chilled water riser replacement at a hotel in Dubai Marina. Need UL/FM listed valves, Civil Defence acceptable. Delivery to site in two drops.",
  "rfq.deliver_to": "Deliver to",
  "rfq.terms_wanted": "Payment terms wanted",
  "rfq.attachment": "Attachment",
  "rfq.attachment_hint": "A BOQ or a drawing, if you have one.",
  /* Said on the chip, because eight suppliers will see the letterhead. */
  "rfq.attachment_shared": "shared with all recipients",
  "rfq.attachment_remove": "Remove attachment",
  "rfq.recipients_title": { one: "Sending to {count} seller", other: "Sending to {count} sellers" },
  "rfq.recipients_matched_on": "Matched on subcategory, emirate and stock signals",
  "rfq.recipients_empty": "Add items to see matching sellers",
  "rfq.recipients_more": { one: "{count} more matches your spec", other: "{count} more match your spec" },
  "rfq.recipients_add_all": "Add all",
  "rfq.recipient_pick": "Send to {name}",
  // Board 1h's recipient row. It was the literal `VISITED` written straight
  // into RfqComposer.tsx, keyed off tier 3 — a rung that was site visits and no
  // longer exists at all, so the mark rendered for nobody. What the platform
  // has actually checked is the licence.
  "rfq.recipient_verified": "Licence",
  "rfq.from_page": "· from the page you were on",
  "rfq.cap_note": "8 sellers is the most one request can reach.",
  "rfq.none_picked": "Pick at least one seller to send to.",
  "rfq.blocked_no_lines": "Add what you need, and sellers will match.",
  "rfq.blocked_no_area": "Say where it is going, so sellers can price delivery.",
  "rfq.how_title": "How this works",
  "rfq.how_1": "Sellers reply with a priced quote inside the platform. Quotes expire after 7 days.",
  "rfq.how_2": "You compare line by line, then accept one.",
  /* Deliberate transparency about the cap the buyer just experienced invisibly. */
  "rfq.how_3": "Free for buyers. Sellers on the free plan get 3 RFQs a month; Basic and Pro are unlimited.",
  "rfq.send": { one: "Send to {count} seller", other: "Send to {count} sellers" },
  "rfq.send_idle": "Send",
  "rfq.send_note": "You'll get an email and SMS as each quote lands.",
  /* Query-seeded arrival, from 1c's zero results. */
  "rfq.seeded_notice": "We couldn't find this listed — describe it and 5 suppliers will come back to you.",
  /* Fewer than two matches: the fan-out framing collapses rather than pads. */
  "rfq.single_h1": "Send an enquiry",
  "rfq.only_one_match": "Only {count} verified supplier matches this spec in {emirate} — widen the area or send to them directly.",
  "rfq.zero_matches": "No verified supplier matches this spec yet. Widen the emirate, drop a spec constraint, or send it to us and we'll route it.",
  "rfq.route_for_me": "Send it to us and we'll route it",
  "rfq.routed": "Sent. We'll find suppliers for this and come back to you.",

  "rfq.title": "Send one enquiry, get quotes back",
  "rfq.lede": "Describe what you need once. We deliver it to suppliers who stock it, and their prices come back to you privately.",
  "rfq.step.need": "What you need",
  "rfq.step.where": "Where and when",
  "rfq.step.who": "Who gets it",
  "rfq.step_of": "Step {current} of {total}",
  "rfq.sequence": "Send an enquiry",

  "rfq.requirement": "Describe the job",
  "rfq.requirement_hint": "What it is for, and anything a supplier would ask. A riser, a fire main, a plant room — the context is what gets you a useful price.",
  "rfq.requirement_placeholder": "Resilient seated gate valves for a chilled water riser. Flanged PN16, ductile iron, WRAS preferred.",
  "rfq.requirement_required": "Describe the job in a sentence or two. A supplier cannot price what they cannot picture.",

  "rfq.lines": "What to quote",
  "rfq.lines_hint": "One line per item. Sizes in DN or inches, either is fine.",
  "rfq.line_description": "Item",
  "rfq.line_description_for": "Item on line {number}",
  "rfq.line_qty": "Qty",
  "rfq.line_qty_for": "Quantity on line {number}",
  "rfq.line_unit": "Unit",
  "rfq.line_unit_for": "Unit on line {number}",
  "rfq.line_size": "Size",
  "rfq.line_size_for": "Size on line {number}",
  "rfq.line_target": "Target price",
  "rfq.line_target_for": "Target unit price on line {number}",
  "rfq.line_target_hint": "Optional. Per unit, and only the suppliers on this enquiry ever see it.",
  "rfq.add_line": "Add a line",
  "rfq.remove_line": "Remove line {number}",
  "rfq.lines_required": "Add at least one line with a description and a quantity.",

  "rfq.area": "Deliver to",
  "rfq.area_hint": "The area, not the full address. You share the address with the supplier you choose.",
  "rfq.emirate": "Emirate",
  "rfq.needed_by": "Needed by",
  "rfq.needed_by_hint": "Optional. A date changes who bothers to quote.",
  "rfq.terms": "Payment terms you want",
  "rfq.terms_hint": "Optional, and not binding. It tells a supplier whether to bother.",
  "rfq.terms_any": "No preference",
  "rfq.closes": "Close this enquiry after",
  "rfq.closes_hint": "Quotes stop arriving after this. You can accept one at any point before it.",
  "rfq.closes_days": { one: "{count} day", other: "{count} days" },
  "rfq.attachments": "Drawings or a spec",
  "rfq.attachments_hint": "PDF, image or spreadsheet. Every supplier on the enquiry sees these.",

  "rfq.recipients": "Suppliers",
  "rfq.recipients_hint": "We pick them on what they stock, where they are and how fast they reply. Never on what they pay us.",
  "rfq.fanout": "Also send to {count} similar suppliers",
  "rfq.fanout_label": "How many suppliers to send this to",
  "rfq.fanout_note": "More suppliers means more quotes and more replies to read. Five is usually enough.",
  "rfq.pinned": "Always included",
  "rfq.recipients_preview": { one: "Going to {count} supplier", other: "Going to {count} suppliers" },
  "rfq.recipients_none": "No supplier in this category can take an enquiry right now. Widen the category or try another emirate.",
  // ── The catalogue's multi-select tray [1e] ──
  "tray.select": "Add {name} to an enquiry",
  "tray.selected": { one: "{count} product selected", other: "{count} products selected" },
  "tray.clear": "Clear the selection",
  "tray.enquire": { one: "Enquire about {count} product", other: "Enquire about {count} products" },

  "enquiry.about_product": "Enquiring about {product}. ",
  "enquiry.to_supplier": "Enquiry to {supplier}",
  "enquiry.widen": "Send this to similar suppliers as well",
  "storefront.enquiry_note": "Your number stays with us until you accept a quote.",
  "rfq.privacy": "Suppliers see your first name and what you need. Your number, email and company stay with us until you accept a quote.",

  "rfq.back": "Back",
  "rfq.next": "Continue",
  "rfq.submit": "Send the enquiry",
  "rfq.sending": "Sending",

  "rfq.contact": "Your mobile",
  "rfq.contact_hint": "Where the quotes land. No account needed — you can claim one later.",
  "rfq.contact_name": "Your name",
  "rfq.contact_name_hint": "Suppliers see your first name only.",
  "rfq.contact_required": "Add a UAE mobile so the quotes can reach you. It looks like 050 641 2288.",

  // ── The thread [10h] buyer · [11b] seller ──
  "thread.heading": "Messages",
  "thread.log": "Messages with {supplier}",
  "thread.log_buyer": "Messages with {buyer}",
  "thread.empty": "Nothing yet. A question here is faster than a phone call, and it stays on the record.",
  "thread.composer": "Write a message",
  // Names the form landmark. Distinct from the field inside it, or the two
  // collide and a screen reader offers the same name for both.
  "thread.composer_form": "Reply on this thread",
  "thread.placeholder": "Ask a question, or answer one.",
  "thread.send": "Send",
  "thread.sending": "Sending",
  "thread.quick_replies": "Or start from one of these",
  "thread.flagged": "Flagged",
  "thread.flagged_explain": "This message looks like it moves payment off the platform. It has been passed to our review team.",
  "thread.revision_of": "Revision {revision}",
  "thread.was": "was",
  "thread.delta_down": "{amount} lower, {percent}%",
  "thread.delta_up": "{amount} higher, {percent}%",
  "thread.delta_same": "Same total",
  "thread.closed": "This enquiry has closed. The thread stays here as the record.",
  "thread.not_yours": "This thread is not yours to write on. Open it from your enquiry.",
  "thread.back_to_enquiry": "Back to the enquiry",
  "thread.back_to_lead": "Back to the lead",
  "thread.with_supplier": "Messages with {supplier}",

  // Board 11b states this to the seller in plain words, and it is not decorative.
  "thread.seller_warning_title": "Everything here is the record",
  "thread.seller_warning_body": "If this deal goes wrong, this thread is the evidence — for you as much as for the buyer. Asking for payment to a bank account before a quote is accepted is flagged automatically and reviewed by a person.",

  /* ── Board 11b: the one follow-up, and the schedule behind it ──

     The rail states the cap in plain words and keeps stating it. A seller who
     is told "one only" once, at the moment they use it, reads it as a limit
     they have hit; a seller who is told before they arm it reads it as a
     decision the product has made on their behalf, which is what it is.
  */
  "thread.followup_heading": "Follow-up",
  "thread.nudge": "Send one follow-up",
  "thread.nudge_sending": "Sending",
  "thread.nudge_sent": "Follow-up sent {when}",
  "thread.nudge_help": "One only. A second follow-up loses more deals than it wins, so we do not offer one.",
  "thread.nudge_not_yet": "Send a quote first. There is nothing to follow up on yet.",
  "thread.nudge_empty": "Write the message first. We do not send a follow-up we wrote for you.",
  "thread.nudge_replied": "The buyer has replied since, so the follow-up was cancelled.",
  "thread.nudge_toggle": "Send it automatically",
  "thread.nudge_scheduled": "Sends {when} unless the buyer replies first",
  "thread.nudge_schedule_hint": "Cancelled on its own if the buyer replies, if the enquiry closes, or once you mark an outcome.",
  "thread.nudge_body_label": "What the follow-up will say",
  "thread.nudge_body_placeholder": "Following up on the quote — happy to talk through the delivery dates.",
  "thread.nudge_send_now": "Send it now",
  "thread.nudge_cancel": "Cancel the follow-up",
  /* The tag on the message itself. A buyer replying to a person deserves to
     know when they did not get one. */
  "thread.automatic": "Automatic",
  "thread.automatic_explain": "Sent by a schedule the supplier set, not typed at this moment.",

  /* ── Read receipts, both directions or neither ──

     Board 11b §6: a one-way receipt is surveillance, and the buyer finds out the
     first time a seller mentions it. The buyer has always seen when a supplier
     opened their enquiry; this is the other half, and the sentence says so.
  */
  "thread.receipt_read": "Buyer opened your quote {when}. They see when you open theirs.",
  "thread.receipt_unread": "The buyer has not opened this quote yet. They see when you open theirs.",

  /* ── The buyer panel ──

     What this seller has seen for themselves, and what the buyer told us.
     Nothing aggregated across suppliers, and nothing inferred about payment —
     we take none, so we cannot know. The footer is load-bearing copy.
  */
  "thread.buyer_heading": "This buyer",
  "thread.buyer_won": "Quotes you marked won",
  "thread.buyer_last_won": "Last one",
  "thread.buyer_enquiries": "Enquiries sent you",
  "thread.buyer_terms": "Terms they asked for",
  "thread.buyer_first_seen": "First enquiry to you",
  "thread.buyer_new": "First time this buyer has sent you anything.",
  "thread.buyer_footer": "Your own history with this buyer, nothing more. We never take payment, so we cannot tell you whether they pay on time — and we do not aggregate their behaviour with other suppliers.",

  "thread.competing": { one: "Competing with {count} other supplier", other: "Competing with {count} other suppliers" },
  /* Already on screen before anybody tries it, and not a bluff: the detector in
     lib/messaging/off-platform.ts raises a report on an IBAN or a "transfer to". */
  "thread.offplatform_title": "Do not ask for payment here",
  "thread.offplatform_body": "Sharing bank details, or asking to settle away from the platform, is detected and reviewed by a person. Quotes and payment terms are what this thread is for.",
  "thread.state.quoted": "Quoted · awaiting decision",
  "thread.state.open": "Not quoted yet",
  "thread.state.won": "You marked this won",
  "thread.state.lost": "You marked this lost",
  "thread.outcome_by": "Marked {outcome} by {name}, {when}",
  "thread.revise_quote": "Revise the quote",
  "thread.send_quote": "Send a quote",
  "thread.back_to_inbox": "Back to the inbox",

  /* ── Board 10h, buyer side ──

     Same shape as the seller's since board 11b: the chip names the act and the
     text is what lands in the box, editable before it sends. A buyer's chips ask
     rather than promise, so nothing here commits anybody to anything.
  */
  "thread.chip.validity": "Ask about the price hold",
  "thread.chip.validity_text": "Can you hold this price a little longer?",
  "thread.chip.datasheets": "Ask for datasheets",
  "thread.chip.datasheets_text": "Could you send datasheets for these?",
  "thread.chip.credit": "Ask about credit terms",
  "thread.chip.credit_text": "What credit terms can you offer?",
  /* ── Board 11b, seller side: suggest the act, never the number ──

     These were three sentences that committed the supplier to terms nobody had
     typed — one of them to a 21-day price hold, on a screen whose own validity
     field said fourteen and whose picker offers seven values. The label names
     the act; the text it drops into the box is a question the seller finishes.
     Anything with a number in it is theirs to write.
  */
  "thread.chip.hold_price": "Extend the price hold",
  "thread.chip.hold_price_text": "We can look at holding this price longer if that helps — how long do you need?",
  "thread.chip.site_survey": "Offer a site survey",
  "thread.chip.site_survey_text": "We can come and look at the site before you decide, at no charge.",
  "thread.chip.certificate": "Attach a certificate",
  "thread.chip.certificate_text": "I can attach the Civil Defence certificate for these — say the word.",

  // ── Buyer: tracking an enquiry [1i] [1n] [7c] [10e] ──
  /* Board 1i — the buyer's home for one enquiry. */
  /*
     The badge and the h1 track the most useful fact, not the original one:
     what was sent until something comes back, what came back after that. Both
     are derived from the rows, so they cannot lag them.
  */
  "track.badge_sent": { one: "Sent to {count} supplier", other: "Sent to {count} suppliers" },
  "track.badge_quoted": { one: "{count} quote received", other: "{count} quotes received" },
  "track.badge_accepted": "Quote accepted",
  /* Spelled as a word in the h1, digits everywhere else. */
  "track.h1_sent": "Your enquiry is with {word} suppliers.",
  "track.h1_sent_one": "Your enquiry is with one supplier.",
  "track.h1_quoted": "{Word} suppliers have quoted.",
  "track.h1_quoted_one": "One supplier has quoted.",
  "track.h1_accepted": "You accepted a quote.",
  "track.h1_all_declined": "No supplier took this one on.",
  /* Removes the fear that sending an RFQ is a commitment. */
  "track.sub": "We'll text and email you as each one replies. Nothing is committed — you compare what comes back and take it forward with whoever suits.",

  "track.asked_for": "What you asked for",
  "track.happens_next": "What happens next",
  "track.next_1": "Suppliers reply with a priced quote inside the platform",
  "track.next_2": "You compare line by line and pick one",
  /* The promise, repeated from 1h because this is where trust is decided. */
  "track.next_3": "Your number is released only to the supplier you choose",

  "track.live_status": "Live status",
  "track.closes_in": "CLOSES IN {duration}",
  "track.closed_on": "CLOSED {when}",
  "track.recipients_label": "Suppliers this went to",

  /* The five row states. Mono, and each says the one thing that matters. */
  "track.state.delivered": "DELIVERED · NOT YET OPENED",
  "track.state.opened": "OPENED · PREPARING A QUOTE",
  "track.state.opened_seen": "Seen {when}",
  "track.state.quoted": "QUOTED · {quoted} OF {total} LINES · {latency}",
  "track.state.declined": "DECLINED · {reason}",
  "track.state.declined_bare": "DECLINED",
  "track.state.no_response": "NO RESPONSE · CLOSED",
  "track.state.superseded": "QUOTED R{revision} · REQUIREMENT CHANGED SINCE",
  "track.state.chose_another": "DECLINED · YOU CHOSE ANOTHER SUPPLIER",

  "track.view_quote": "View quote",
  "track.nudge": "Nudge",
  "track.nudged": "NUDGED · {when}",
  "track.nudge_wait": "You can nudge a supplier after a day without a reply.",

  "track.compare": "Compare the quotes",
  "track.compare_none": "Quotes will appear here as they arrive",
  "track.compare_one": "One more quote and you can compare side by side",
  "track.add_suppliers": "Add two more suppliers",
  "track.edit_requirement": "Edit the requirement",
  "track.view_accepted": "View the accepted quote",
  "track.more_actions": "More",

  "track.reference": "REFERENCE",
  "track.sent_at": "Sent {when}. Quotes appear here and in your email — no login needed to read them.",
  "track.privacy_title": "Your number stays private",
  /* A specification, not reassurance: enforced at the query layer. */
  "track.privacy_body": "Suppliers see the requirement and your first name. Nobody gets your mobile until you accept a quote, so one enquiry doesn't become five cold calls.",
  "track.template_title": "Save as template",
  "track.template_body": "Buying the same lines each quarter? Save the requirement and re-send it in two clicks.",
  "track.save_template": "Save the requirement",

  "track.revised": "REVISED {when} · R{revision}",
  /* All declined: a problem to solve, not a wait to sit through. */
  "track.all_declined": { one: "The supplier declined. Widening the area or relaxing a spec usually finds a match.", other: "All {count} suppliers declined. Widening the area or relaxing a spec usually finds a match." },
  "track.all_declined_reason": "The most common reason given was \u201c{reason}\u201d.",
  "track.send_more": { one: "Send to {count} more supplier", other: "Send to {count} more suppliers" },
  "track.closed_no_quotes": "This enquiry closed without a quote. Nobody we could reach stocks it at the moment — sending it wider usually finds somebody.",
  "track.new_quote_announced": { one: "{count} new quote has arrived.", other: "{count} new quotes have arrived." },
  "track.meta_title": "Your enquiry",

  "enquiry.ref": "Enquiry {ref}",
  "enquiry.sent_title": "Enquiry sent",
  "enquiry.sent_body": { one: "Delivered to {count} supplier. Quotes arrive here and on WhatsApp.", other: "Delivered to {count} suppliers. Quotes arrive here and on WhatsApp." },
  "enquiry.track": "Track this enquiry",
  "enquiry.status": "Status",
  "enquiry.closes_in": "Open for another {duration}",
  "enquiry.closes_on": "Open until {when}",
  "enquiry.closed_on": "Closed {when}",
  "enquiry.recipients_heading": "Who has it",
  "enquiry.recipient_state.delivered": "Delivered",
  "enquiry.recipient_state.opened": "Opened",
  "enquiry.recipient_state.quoted": "Quoted",
  "enquiry.recipient_state.declined": "Not taken further",
  "enquiry.recipient_state.no_response": "No reply",
  "enquiry.no_quotes_title": "No quotes yet",
  "enquiry.no_quotes_body": "Suppliers usually reply within a working day. You get a message the moment one does, and nothing here needs watching.",
  "enquiry.quotes_heading": { one: "{count} quote", other: "{count} quotes" },
  "enquiry.compare": "Compare the quotes",
  "enquiry.view_quote": "View {ref}",
  "enquiry.requirement": "What you asked for",
  "enquiry.your_lines": "Your lines",

  "compare.quotes_title": "Compare quotes",
  "compare.quotes_caption": "Quotes side by side, line by line",
  "compare.line": "Line",
  "compare.no_quote_for_line": "Not quoted",
  "compare.total": "Total",
  "compare.lead_time": "Lead time",
  "compare.validity": "Held until",
  "compare.supplier": "Supplier",
  "compare.accept": "Accept {ref} — {total}",
  "compare.accepting": "Accepting",
  "compare.only_one": "Only one quote so far. It is still worth reading before you accept.",
  "compare.what_accepting_means": "Accepting releases your number, email and company name to this supplier alone. The others are told the enquiry is closed. You pay the supplier directly, on terms the two of you agree.",
  "compare.error_already_accepted": "This enquiry already has an accepted quote. Only one supplier can be accepted, and the choice does not move.",
  "compare.error_expired": "That quote has passed the date the supplier held it to. Ask them for a fresh one in the thread.",
  "compare.error_not_found": "That quote is not on this enquiry.",
  "compare.lowest": "Lowest total",
  "compare.fastest": "Soonest",

  "accepted.title": "Quote accepted",
  "accepted.lede": "{supplier} has your contact details and can reach you directly.",
  "accepted.what_next": "What happens now",
  "accepted.what_next_body": "The supplier contacts you to arrange delivery and payment. We are not part of that — no invoice from us, no payment through us, and nothing more to do here.",
  "accepted.record": "The record",
  "accepted.record_body": "This page is the record of what was agreed. It stays here, and so does the thread.",
  "accepted.supplier": "Supplier",
  "accepted.accepted_on": "Accepted",
  "accepted.value": "Quoted value",
  "accepted.value_note": "As quoted by the supplier. We do not handle the money.",
  "accepted.contact": "Their contact",
  "accepted.review": "Write a review",
  "accepted.thread": "Open the thread",

  "account.enquiries.title": "Your enquiries",
  "account.enquiries.caption": "Enquiries you have sent, newest first",
  "account.enquiries.col.ref": "Ref",
  "account.enquiries.col.requirement": "What you asked for",
  "account.enquiries.col.sent": "Sent",
  "account.enquiries.col.quotes": "Quotes",
  "account.enquiries.col.status": "Status",
  "account.enquiries.empty_title": "No enquiries yet",
  "account.enquiries.empty_body": "Find a supplier and send one. You can send the same enquiry to up to eight at once.",
  "account.enquiries.browse": "Browse the directory",
  "account.enquiries.status.open": "Open",
  "account.enquiries.status.accepted": "Accepted",
  "account.enquiries.status.closed": "Closed",
  "account.enquiries.quotes_count": { one: "{count} quote", other: "{count} quotes" },

  // ── Auth [7a]. Four states and three failures. ──
  "auth.signin.title": "Sign in",
  "auth.signin.lede": "A code arrives on WhatsApp. No password to remember.",
  "auth.signin.identifier": "Mobile number or email",
  "auth.signin.identifier_hint": "UAE mobile, or the email you signed up with.",
  "auth.signin.submit": "Send me a code",
  "auth.signin.no_account": "No account yet?",
  "auth.signin.create": "Create one",
  "auth.signin.password_instead": "Use a password instead",

  "auth.signup.title": "Create an account",
  "auth.signup.lede": "One account. Buy, list, or both — you can add the other later.",
  "auth.signup.name": "Your name",
  "auth.signup.name_hint": "How suppliers will see you on an enquiry. First name only until you accept a quote.",
  "auth.signup.identifier": "Mobile number or email",
  "auth.signup.identifier_hint": "A UAE mobile gets your code on WhatsApp and your enquiry alerts where you already are. An email works too.",
  "auth.signup.intent": "What brings you here",
  "auth.signup.intent_hint": "Pick both if you do both. Neither locks you out of the other.",
  "auth.signup.buying": "Buying — find suppliers and send enquiries",
  "auth.signup.listing": "Listing — put my business in the directory",
  "auth.signup.intent_required": "Pick at least one. You can add the other whenever you like.",
  "auth.signup.submit": "Send me a code",
  "auth.signup.have_account": "Already have an account?",
  "auth.signup.signin": "Sign in",
  "auth.signup.no_account_needed": "You do not need an account to send your first enquiry. Sign up when you want to track it.",

  "auth.verify.title": "Enter your code",
  "auth.verify.sent_to": "Sent to {masked}. It expires in {minutes} minutes.",
  "auth.verify.code": "Verification code",
  "auth.verify.code_hint": "{length} digits.",
  "auth.verify.submit": "Verify",
  "auth.verify.verifying": "Verifying",
  "auth.verify.resend": "Send another code",
  "auth.verify.resend_in": "Send another code in {seconds} s",
  "auth.verify.wrong_number": "Wrong number?",
  "auth.verify.start_again": "Start again",
  "auth.verify.no_identifier": "There is no number or address to verify. Start from the sign-in page.",

  "auth.reset.title": "Reset your password",
  "auth.reset.lede": "We email a link. Signing in with a code needs no password at all.",
  "auth.reset.email": "Email address",
  "auth.reset.submit": "Email me a link",
  "auth.reset.sent_title": "Check your email",
  "auth.reset.sent_body": "If {masked} has an account, a reset link is on its way. The link works once and lasts an hour.",
  "auth.reset.new_password": "New password",
  "auth.reset.new_password_hint": "At least 12 characters. Length beats punctuation.",
  "auth.reset.save": "Save the new password",
  "auth.reset.too_short": "That password is {count} characters. It needs at least 12.",
  "auth.reset.done_title": "Password saved",
  "auth.reset.done_body": "You are signed in.",
  "auth.reset.back": "Back to sign in",

  // Failure states. Each says what happened and what to do, and none of them
  // says the person did something wrong.
  "auth.error.invalid_identifier": "That does not look like a UAE mobile number or an email address. A mobile looks like 050 641 2288.",
  "auth.error.code_incorrect": "That code did not match. Check the digits, or send another one.",
  "auth.error.delivery_failed": "The code could not be sent. Try again in a moment, or use the other of your mobile and your email.",
  "auth.error.unavailable": "Sign-in is unavailable right now. Nothing was sent and nothing changed.",
  "auth.error.identifier_taken": "That mobile or email is already on an account that cannot be signed into this way. Ask us to link it.",
  "auth.error.name_required": "Add a name so suppliers know who is asking.",

  "auth.expired.title": "That link has expired",
  "auth.expired.body": "Links last {minutes} minutes, and this one is past it. Nothing is wrong with your account — ask for a new one and it arrives straight away.",
  "auth.expired.action": "Send a new link",

  "auth.locked.title": "Too many tries",
  "auth.locked.body": "Five wrong codes in a row, so this number is paused for a moment. Try again in {duration}.",
  "auth.locked.body_requests": "That is {limit} codes in an hour, which is as many as we send. Try again in {duration}.",
  "auth.locked.body_upstream": "Codes to this address are paused for the moment. Try again in {duration}, or use your mobile number instead.",
  "auth.locked.help": "If the codes are not arriving, sign in with your email address instead.",

  // ── Entry surfaces — /for-buyers and /list-your-business ───────────────────
  "site.name": "Business Listings",

  "entry.escape": "Looking for a supplier rather than an account?",
  "entry.escape_link": "Browse the directory",
  "entry.facts_title": "Counted this hour",
  "entry.quotes_title": "In their words",
  "entry.form_lede": "A code arrives on WhatsApp. No password to remember.",

  "entry.buyer.title": "Find a supplier who can actually do it",
  "entry.buyer.lede": "Send one enquiry, and the suppliers who can meet it reply with a quote. Every trade licence on this directory has been checked by us, so a licensed supplier and a convincing website are not the same thing here.",
  "entry.buyer.form_title": "Sign in to track your enquiries",
  "entry.buyer.form_hint": "You do not need an account to send your first enquiry. Sign up when you want to track it.",
  "entry.buyer.fact_listings": "Suppliers listed",
  "entry.buyer.fact_verified": "Trade licences checked by us",
  "entry.buyer.fact_trades": "Trades covered",
  "entry.buyer.fact_emirates": "Emirates with a supplier",

  "entry.supplier.title": "Answer the buyers who are already asking",
  "entry.supplier.lede": "Buyers send enquiries here every week and the supplier who replies first is usually the one who quotes. Your listing carries a verification badge we award and you cannot, which is what a buyer comparing four suppliers is looking at.",
  "entry.supplier.form_title": "Sign in to your listing",
  "entry.supplier.form_hint": "Already listed but never claimed it? Sign in and the claim flow will find your licence.",
  "entry.supplier.fact_enquiries": "Enquiries sent in {days} days",
  "entry.supplier.fact_buyers": "Buyers who sent them",
  "entry.supplier.fact_verified": "Suppliers carrying a checked badge",
  "entry.buyers_meta_title": "For buyers",
  "entry.suppliers_meta_title": "List your business",

  // ── Entry page quotes — /admin/content/testimonials ───────────────────────────────
  "testimonial.title": "Entry page quotes",
  "testimonial.lede": "What the two entry pages quote, and who said it. The numbers beside them are counted from the database and are not edited here.",
  "testimonial.audience": "Page",
  "testimonial.audience_buyer": "For buyers",
  "testimonial.audience_supplier": "List your business",
  "testimonial.body": "The quote",
  "testimonial.body_hint": "At least {count} words. Their words, not ours — a quote that reads like our copy is worth less than no quote.",
  "testimonial.attribution": "Who said it",
  "testimonial.attribution_hint": "A person. Rashid Al Hameli, not Harbour Contracting.",
  "testimonial.context": "Role and company",
  "testimonial.context_hint": "Optional. Procurement Manager, Harbour Contracting LLC.",
  "testimonial.order": "Order",
  "testimonial.order_hint": "Ascending. Ties fall back to the order they were written.",
  "testimonial.reason": "Reason",
  "testimonial.reason_hint": "Recorded in the audit log against your name.",
  "testimonial.add": "Add a quote",
  "testimonial.save": "Save",
  "testimonial.publish": "Publish",
  "testimonial.unpublish": "Unpublish",
  "testimonial.delete": "Delete",
  "testimonial.status": "Status",
  "testimonial.published": "Published",
  "testimonial.draft": "Draft",
  "testimonial.words": "{count} words",
  "testimonial.saved": "Saved.",
  "testimonial.published_count": "Published. {count} quotes now show on that page.",
  "testimonial.unpublished_count": "Unpublished. {count} quotes still show on that page.",
  "testimonial.deleted": "Deleted.",
  "testimonial.empty_title": "No quotes yet",
  "testimonial.empty_body": "Both entry pages render their counted numbers and no quote section at all until there is something here.",
  "testimonial.needs_reason": "Say why. The audit log stores it against your name.",

  "auth.staff.title": "Staff sign in",
  "auth.staff.lede": "A code arrives on WhatsApp or by email, the same as every other account.",
  "auth.staff.identifier_hint": "The mobile or email your staff seat was created with.",

  "auth.suspended.title": "This account is suspended",
  "auth.suspended.body": "It was suspended on {date} and cannot be used to sign in. Suspensions are reviewed by a person, and a person can lift one.",
  "auth.suspended.action": "Email the review team",
  "auth.suspended.reference": "Quote this reference: {reference}",

  "auth.cooldown.title": "A code is already on its way",
  "auth.cooldown.body": "Give it {duration}. Sending a second one cancels the first, which is usually the reason a code stops working.",

  "auth.legal": "By continuing you agree to the terms of use and the privacy notice.",

  // ── Buyer: writing a review [10f] ──
  "review.title": "How did it go?",
  "review.lede": "You dealt with {supplier} on {ref}. A few minutes here is what makes the next buyer's search worth anything.",
  "review.gated": "Reviews come from buyers who sent an enquiry here and heard back, or who accepted a quote. That is the whole reason anybody trusts them.",
  "review.overall": "Overall",
  "review.dimension.quotedAccurate": "The price was what they quoted",
  "review.dimension.onTime": "It arrived when they said",
  "review.dimension.asDescribed": "It was what they described",
  "review.dimension.responsiveness": "They answered when I asked",
  "review.rating_label": "{dimension}, {count} out of 5",
  "review.body": "What happened",
  "review.body_hint": "What a buyer in your position would want to know. Twenty characters at least — a number with no words tells nobody anything.",
  "review.body_placeholder": "Quoted the same day, delivered on the date they gave, and the paperwork was right first time.",
  "review.show_company": "Show my company name on the review",
  "review.show_company_hint": "Off, and it appears from a buyer with no name shown. The provenance badge is unaffected.",
  "review.submit": "Post the review",
  "review.submitting": "Posting",
  "review.editable": "You can change this for {days} days.",
  "review.posted_title": "Review posted",
  "review.posted_body": "It is on {supplier}'s listing now. You can change it for {days} days, and the supplier gets one reply.",
  "review.back_to_enquiry": "Back to the enquiry",

  "review.error.not_your_enquiry": "This enquiry is not yours to review.",
  "review.error.no_confirmed_enquiry": "A review needs a supplier who answered this enquiry, or a quote you accepted. Neither has happened on this one yet.",
  "review.error.ambiguous_subject": "Several suppliers answered this enquiry. Open the one you want to review from the enquiry and start from there.",
  "review.error.already_reviewed": "You have already reviewed this enquiry. You can change that review instead.",
  "review.error.invalid_ratings": "Rate every line from one to five. A blank line is not a low score.",
  "review.error.empty_body": "Add a sentence or two. Twenty characters at least — a number with no words tells nobody anything.",
  "review.error.window_closed": "The fourteen days for changing this review have passed. It stays as the record now.",
  "review.meta_title": "Write a review",

  // ── Seller: reviews [11c] ──
  "reviews.title": "Reviews",
  "reviews.subtitle": { one: "{count} review", other: "{count} reviews" },
  "reviews.average": "{score} out of 5",
  "reviews.rated": "Rated {score} out of 5",
  /*
     The header, reconciled. Criterion 5.

     The board read "4.8 average of 126 reviews · 94 from a verified enquiry, 32
     unverified", and there is no such thing as the second number — every review
     on this platform has an enquiry, because `Review.enquiryId` is NOT NULL.
     The split that is real is the provenance ladder board 1m already shows the
     buyer, and these two numbers add up to the first one.
  */
  "reviews.header_split": "{accepted} from an accepted quote, {enquiry} from a confirmed enquiry",
  "reviews.header_count": { one: "{count} on your page", other: "{count} on your page" },
  "reviews.header_off_page": { one: "{count} off it", other: "{count} off it" },
  "reviews.overall_is_answered": "Buyers rate each line separately and give an overall score of their own. The number above is that score, not the average of the four.",

  "reviews.tab.on_page": "On your page",
  "reviews.tab.accepted_quote": "Accepted quote",
  "reviews.tab.verified_enquiry": "Confirmed enquiry",
  "reviews.tab.needs_reply": "Needs a reply",
  "reviews.tab.off_page": "Off your page",
  "reviews.list_heading": "Recent reviews",
  "reviews.needs_reply_count": { one: "{count} needs a reply", other: "{count} need a reply" },
  "reviews.none_in_filter": "No reviews in this view. Every review you have is under On your page.",
  /*
     The seller-side names for the four dimensions.

     Short, because they sit in a 344px rail beside a score. Board 10f asks the
     buyer the same four as sentences — "The price was what they quoted" — and
     that is the right shape for somebody answering a question and the wrong one
     for somebody reading a column of averages.
  */
  "reviews.dimension.quotedAccurate": "Quoted accurately",
  "reviews.dimension.onTime": "Delivered on time",
  "reviews.dimension.asDescribed": "As described",
  "reviews.dimension.responsiveness": "Answered quickly",

  "reviews.empty_title": "No reviews yet",
  "reviews.empty_body": "A review can only come from a buyer who enquired and heard back from you, or who accepted one of your quotes. Nobody can leave one any other way, which is why the ones you do get are worth reading.",
  "reviews.empty_next": { one: "Ask the {count} buyer in the panel above. That is the only lever on this page — the rest is won on the enquiry.", other: "Ask the {count} buyers in the panel above. That is the only lever on this page — the rest is won on the enquiry." },

  "reviews.reply": "Post reply",
  "reviews.replying": "Posting",
  "reviews.reply_label": "Your reply to this review",
  /*
     Landmark names. A `<form>` is a landmark and this page renders one per
     unanswered review, so without a name the list reads "form, form, form".

     Buyer **and** date, because a buyer can review the same supplier several
     times — `Review.enquiryId` is unique per review, not per buyer — so the
     name has to be distinct per instance the way `QuoteLineEditor` and
     `Thread` already make theirs.
  */
  "reviews.reply_form": "Reply to the review from {buyer} on {date}",
  "reviews.reply_heading": "Your public reply — one only, and it cannot be edited once posted",
  "reviews.reply_placeholder": "Answer the point they made. This is public and it cannot be edited afterwards.",
  "reviews.reply_once": "One reply, and it cannot be changed once posted. Never deleted.",
  "reviews.replied": "Your reply · {when}",
  "reviews.reply_by": "Reply by {date}",
  "reviews.reply_consequence": "After {date} the reply box closes and the review stands on its own.",
  "reviews.reply_closed": "Reply window closed {date}",
  "reviews.reply_closed_body": "The review stays. Nothing was deleted — the twenty-eight days for answering it have passed.",
  "reviews.reply_removed": "Your reply was removed by the review team",
  "reviews.reply_removed_body": "A reply is public and permanent, so it is held to the same rules as the review. There is no second reply.",
  "reviews.reply_error.window_closed": "The reply window closed on this review. It stays as it is.",
  "reviews.reply_error.already_replied": "You have already replied to this review. One reply, ever.",
  "reviews.reply_error.removed": "This review is not on your page at the moment, so there is nothing to reply to.",
  "reviews.reply_error.not_yours": "That review is not on your listing.",
  "reviews.reply_error.empty": "Write the reply before posting it.",

  "reviews.removed": "Removed by the review team",
  "reviews.held": "Being checked by our team",
  "reviews.held_body": "It is off your public page and out of your average while somebody reads it. Nothing is decided yet.",
  "reviews.not_deletable": "A review cannot be removed by the supplier it is about. Dispute one you believe breaks the rules and a person reads it.",
  "reviews.dimension_scores": "Scores by dimension",

  // ── The request panel ──
  "reviews.request_heading": "Ask for a review",
  "reviews.request_body": { one: "{count} buyer is eligible: they accepted a quote in the last {days} days and have not been asked before. One request each, ever.", other: "{count} buyers are eligible: they accepted a quote in the last {days} days and have not been asked before. One request each, ever." },
  "reviews.request_send": { one: "Send {count} request", other: "Send {count} requests" },
  "reviews.request_send_none": "Send requests",
  "reviews.request_sending": "Sending",
  "reviews.request_select": "Buyers to ask",
  "reviews.request_channel_note": "Sent to the contact on the enquiry — WhatsApp where we have a number, email otherwise.",
  "reviews.request_channel.whatsapp": "WhatsApp",
  "reviews.request_channel.email": "Email",
  "reviews.request_unreachable": "No contact we can send to",
  "reviews.request_unreachable_note": { one: "{count} eligible buyer has no phone or email we can send to, so they cannot be asked.", other: "{count} eligible buyers have no phone or email we can send to, so they cannot be asked." },
  "reviews.request_incentive": "We never offer an incentive for a review and neither can you: an incentivised review is removed and logged against your account.",
  "reviews.request_result": { one: "{count} request sent.", other: "{count} requests sent." },
  "reviews.request_partial": "{sent} sent, {failed} could not be sent.",
  "reviews.request_none_selected": "Tick the buyers you want to ask.",
  /*
     The two empty states §States separates, and they are not the same page.

     A seller with accepted quotes and nobody left to ask has done the work; a
     seller with none has a dead button and is owed the reason rather than the
     button. The second links to `3k`, which is where the quotes they have sent
     are waiting to be accepted.
  */
  "reviews.request_exhausted": "Nobody to ask right now. Every buyer who accepted a quote in the last {days} days has either been asked or has written one.",
  "reviews.request_no_quotes": "No buyer has accepted a quote from you yet, so there is nobody to ask. A buyer becomes eligible the day they accept, and leaves the window {days} days later.",
  "reviews.request_no_quotes_link": "Open quotes sent",
  "reviews.request_error.already_asked": "You have already asked this buyer. One per buyer, ever.",
  "reviews.request_error.too_old": "That deal is more than {days} days old. The window for asking has closed.",
  "reviews.request_error.already_reviewed": "They have already written one.",
  "reviews.request_error.no_accepted_quote": "That enquiry has no accepted quote.",
  "reviews.request_error.unreachable": "We hold no phone number or email for that buyer, so nothing would have been sent. Your one request to them is unused.",

  // ── The dispute rail, and the flow it does not start ──
  "reviews.dispute.rail_title": "Disputing a review",
  "reviews.dispute.rail_body": "We remove a review on four grounds. Start a dispute from the review itself.",
  "reviews.dispute.ground.no_traceable_enquiry": "No traceable enquiry — a competitor, or someone who was never a buyer",
  "reviews.dispute.ground.abuse": "Abusive language",
  "reviews.dispute.ground.private_information": "Private information about a person",
  "reviews.dispute.ground.provably_false": "A factual claim you can prove is false",
  "reviews.dispute.not_a_ground": "“It is unfair” is not a ground. A reply is public and permanent; a refused dispute changes nothing and costs you two days.",
  "reviews.dispute.sla": "Decided by our team in about 2 working days. We email you the outcome, and the reason is recorded on the review.",
  "reviews.dispute.start": "Dispute this review",
  "reviews.dispute.heading": "Dispute this review",
  "reviews.dispute.form": "Dispute the review from {buyer} on {date}",
  "reviews.dispute.ground_legend": "Which ground",
  "reviews.dispute.ground_hint": "Pick the one that is true. A dispute refused on the wrong ground cannot be re-filed on the right one while it is open.",
  "reviews.dispute.detail_label": "What happened",
  "reviews.dispute.detail_hint": "Give the moderator the case, not the label. Twenty characters at least.",
  "reviews.dispute.submit": "Send the dispute",
  "reviews.dispute.sending": "Sending",
  "reviews.dispute.cancel": "Cancel",
  "reviews.dispute.owner_only": "Disputing a review is the owner's to do. A dispute is a formal claim your business makes about a customer.",
  // Lowercase: they are read inside a sentence — "Dispute refused · 8 Sep" on
  // the card, "Outcome: refused" in the mail. Sentence case, design system §08.
  "reviews.dispute.outcome.upheld": "upheld",
  "reviews.dispute.outcome.refused": "refused",
  "reviews.dispute.open": "Under review",
  "reviews.dispute.open_body": "Disputed on {ground}. Buyers still see this review unchanged while we decide — hiding it would make disputing a way to take reviews down.",
  "reviews.dispute.decided": "Dispute {outcome} · {date}",
  "reviews.dispute.refused_body": "The review stands. You can still reply if the window is open, and you can dispute it again on a different ground if the facts change.",
  "reviews.dispute.error.detail_too_short": "Say what happened. Twenty characters at least.",
  "reviews.dispute.error.invalid_ground": "Pick one of the four grounds.",
  "reviews.dispute.error.already_disputed": "There is already an open dispute on this review.",
  "reviews.dispute.error.already_removed": "That review has already been removed.",
  "reviews.dispute.error.already_held": "That review is already with our team.",
  "reviews.dispute.error.not_yours": "That review is not on your listing.",
  "reviews.dispute.error.not_found": "That review no longer exists.",

  // ── Rated on ──
  "reviews.rated_on": "Rated on",
  "reviews.weakest": "weakest",
  "reviews.no_scores": "Dimension scores appear once a buyer has written a review.",
  /*
     Board 11c `B3`, built rather than softened.

     The board asserted "Two reviews mention brand substitution" over a product
     that did no text analysis at all. It does now — a fixed vocabulary of
     operational complaints in lib/reviews/themes.ts — and the sentence names
     the count so the seller can go and read the two.
  */
  "reviews.theme": { one: "{count} review mentions {theme}.", other: "{count} reviews mention {theme}." },
  "reviews.theme_note": "That is a process fix, not a review problem.",
  "reviews.theme.brand_substitution": "brand substitution",
  "reviews.theme.stock_accuracy": "stock that was not there",
  "reviews.theme.late_delivery": "late delivery",
  "reviews.theme.short_delivery": "short delivery",
  "reviews.theme.wrong_item": "the wrong item arriving",
  "reviews.theme.paperwork_missing": "missing paperwork",
  "reviews.theme.damaged_on_arrival": "damage on arrival",
  "reviews.theme.slow_to_reply": "slow replies",
  "reviews.theme.price_changed": "the price changing after the quote",

  "reviews.more_title": "How you get more",
  "reviews.more_body": "A buyer becomes eligible when they accept your quote, and leaves the window {days} days later. Asking is the only lever here — the rest is won on the enquiry.",

  // ── Moderation and audit, tier 4 ──
  "moderation.kind.review": "Review",
  "moderation.kind.supplier_report": "Supplier report",
  "moderation.raised_by_platform": "Raised automatically",
  "moderation.raised_by": "Reported by {name}",
  "moderation.ground.no_traceable_enquiry": "No traceable enquiry",
  "moderation.ground.abuse": "Abuse",
  "moderation.ground.private_information": "Private information",
  "moderation.ground.provably_false": "Provably false factual claim",
  "moderation.ground.off_platform_payment": "Off-platform payment",
  "moderation.ground.incentivised": "Incentivised by the supplier",
  // Keyed to the ReportOutcome enum, so t(`report.outcome.${value}`) is total.
  "report.outcome.seller_corrected": "Supplier corrected it",
  "report.outcome.upheld": "Upheld",
  "report.outcome.no_action": "No action",
  "audit.action.review_removed": "Review removed",
  "audit.action.review_reply_removed": "Supplier reply removed",
  "audit.action.review_dispute_resolved": "Review dispute decided",
  "audit.action.incentive_logged": "Incentivised review logged",
  "audit.action.tier_change": "Verification tier changed",
  "audit.action.suspend": "Business suspended",
  "audit.action.credit_issued": "Subscription credit issued",
  "audit.action.report_resolved": "Supplier report resolved",

  // ── Board 7f, the template specimen surface at /dev/notifications ──
  "specimens.title": "Notification templates",
  "specimens.lede": "Every template in the database, rendered with plausible values. Each one states what happened, what it is worth, and one action. None carries a buyer's phone number, email address or company name — asserted in tests/integration/notifications.test.ts, not left to a reading.",
  "specimens.no_action": "No action",

  // ── Seller: notification settings [7e] ──
  "alerts.title": "Settings",
  "alerts.eyebrow": "Account",
  "alerts.lede": "How a lead reaches a person. Team settings decides which seat; this decides how that seat is told, and whether they can be told at all.",
  "alerts.tab.notifications": "Notifications",
  "alerts.tab.channels": "Contact channels",
  "alerts.tabs_label": "Settings sections",

  "alerts.matrix_heading": "What reaches you where",
  "alerts.matrix_caption": "Notification channels by event",
  "alerts.col.event": "When this happens",
  "alerts.col.goes_to": "Goes to",
  "alerts.channel.whatsapp": "WhatsApp",
  "alerts.channel.sms": "SMS",
  "alerts.channel.email": "Email",
  "alerts.channel.in_app": "In app",
  "alerts.toggle": "{channel} for {event}",

  "alerts.goes_to.assigned": "The assigned seat",
  "alerts.goes_to.assigned_and_owner": "The assigned seat and the owner",
  "alerts.goes_to.owner": "The owner",
  "alerts.goes_to.owner_and_finance": "The owner and finance",
  "alerts.goes_to.you": "You",
  "alerts.nothing_dropped": "If nobody is assigned, or the assigned seat has no verified channel, it goes to the owner instead. Nothing is dropped.",
  "alerts.in_app_locked": "In app stays on for anything with a deadline. Turn every other channel off and the work still appears in a list.",
  "alerts.in_app_locked_cell": "In app is always on for {event}",
  "alerts.channel_unavailable": "{channel} has no carrier yet, so nothing is sent on it. The setting is kept for when one is configured.",
  "alerts.escalation_precedence": "Escalation ignores quiet hours in the app, and never sends a WhatsApp at three in the morning.",
  "alerts.outbound_note": "This is what reaches your team. Replies to a buyer go back on the channel the buyer used, which is a different thing and is not set here.",

  "alerts.event.enquiry_received": "A new enquiry arrives",
  "alerts.event.enquiry_unanswered": "An enquiry is still unanswered",
  "alerts.event.enquiry_escalated": "An unanswered enquiry escalates to the owner",
  "alerts.event.quote_accepted": "A buyer marks your quote won",
  "alerts.event.quote_expiring": "A quote you sent is about to expire",
  "alerts.event.review_posted": "Someone leaves a review",
  "alerts.event.document_expiring": "A licence or certificate is about to expire",
  "alerts.event.setup_nudge": "Your listing is still unfinished",
  "alerts.event.weekly_digest": "The weekly summary",

  "alerts.quiet_heading": "Quiet hours",
  "alerts.quiet_body": "WhatsApp and SMS are held until your counter opens again. In app is never held — nothing buzzes, and the list is the same list in the morning.",
  "alerts.quiet_enabled": "Hold WhatsApp and SMS outside your working hours",
  "alerts.quiet_source": "Your working hours come from the Hours page, Ramadan included. There is no second copy of the week on this screen.",
  "alerts.quiet_hours_link": "See your hours",
  "alerts.quiet_open_now": "Your counter is open now, so nothing is being held.",
  "alerts.quiet_shut_now": "Your counter is shut now. WhatsApp and SMS are held until it opens again.",
  "alerts.quiet_no_hours": "You have not published any hours, so the window below applies until you do.",
  "alerts.quiet_from": "From",
  "alerts.quiet_to": "Until",
  "alerts.quiet_sunday": "Hold them on Sundays too",
  "alerts.quiet_hour": "{hour}:00",

  "alerts.override_heading": "Wake me for a big one",
  "alerts.override_body": "An enquiry worth at least this much comes through even inside quiet hours. Leave it empty and nothing does.",
  "alerts.override_label": "Enquiry value, in AED",
  "alerts.override_none": "Leave empty for never. The figure is what the buyer said they hoped to pay, which we cannot check.",

  "alerts.escalation_heading": "Escalation",
  "alerts.escalation_body": "An enquiry nobody has answered after this long is sent to the owner as well.",
  "alerts.escalation_minutes": "Escalate after",

  "alerts.nudge_heading": "Follow-up",
  "alerts.nudge_body": "A single reminder to the buyer after a quote goes unanswered. One only — a second loses more deals than it wins.",
  "alerts.nudge_enabled": "Offer me one follow-up per enquiry",
  "alerts.nudge_after": "Offer it after",
  "alerts.nudge_option": { one: "{count} hour", other: "{count} hours" },

  "alerts.save": "Save alert settings",
  "alerts.saving": "Saving",
  "alerts.saved": "Saved {when}",
  "alerts.whatsapp_pending": "WhatsApp alerts are built and waiting on Meta to approve the message templates. Until then these events fall back to the other channels you have on.",

  // ── Can this seat be reached, board 7e §3 ─────────────────────────────────
  "reach.heading": "Can this seat be reached",
  "reach.caption": "Verified channels by seat",
  "reach.col.seat": "Seat",
  "reach.col.channels": "Verified channels",
  "reach.col.state": "Routing",
  "reach.state.ok": "Reachable",
  "reach.state.slow": "Email only, which is slower",
  "reach.state.none": "Skipped by routing",
  "reach.state.not_lead_seat": "Not a lead seat",
  "reach.state.suspended": "Suspended",
  "reach.none": "Nothing verified",
  "reach.rule": "A seat with no verified channel is skipped by routing entirely. Assigned seat means nothing if that seat cannot be told.",
  "reach.privacy": "Which channels each seat has proven, never the number. A colleague's mobile is theirs.",
  "reach.own_only": "Your own channels are below. Only the owner and a manager see the whole team.",
  "settings.team_link": "Who a lead goes to, and who holds a seat, are set on the Team screen.",

  // ── Your own channels, board 7e §8.1 ──────────────────────────────────────
  "channels.heading": "Your channels",
  "channels.body": "Where this seat is reached. An address that has not been proven receives nothing and is hidden from buyers, which is the same rule routing reads.",
  "channels.privacy": "Yours alone. Your colleagues see which channels you have proven; they never see the address.",
  "channels.kind.whatsapp": "WhatsApp",
  "channels.kind.sms": "SMS",
  "channels.kind.email": "Email",
  "channels.verified": "Verified",
  "channels.unverified": "Not proven, so it receives nothing",
  "channels.add_heading": "Add a mobile or an address",
  "channels.address": "Mobile or email",
  "channels.address_hint": "A UAE mobile goes on WhatsApp. Anything with an @ goes by email.",
  "channels.send_code": "Send me a code",
  "channels.resend": "Send another code",
  "channels.code": "The six digits",
  "channels.confirm": "Confirm it",
  "channels.remove": "Remove",
  "channels.remove_aria": "Remove your {channel} channel",
  "channels.confirm_aria": "Confirm the code for {channel}",
  "channels.code_sent": "Code sent to {address}. It works for ten minutes.",
  "channels.code_not_sent": "The code could not be sent to {address}. Ask for another in a minute, or use a different channel.",
  "channels.verified_now": "{channel} is verified. Routing can reach this seat on it now.",
  "channels.removed": "{channel} removed from this seat.",
  "channels.sms_unavailable": "SMS has no carrier yet, so a number cannot be proven for it. WhatsApp reaches the same handset and costs less.",
  "channels.code_subject": "Your Business Listings verification code",
  "channels.code_body": "{code} is your Business Listings verification code. It works for {minutes} minutes. If you did not ask for it, ignore this message.",

  "channels.no_seat": "You need a seat on a listing to add a channel.",
  "channels.kind_unavailable": "That channel cannot be proven yet.",
  "channels.unreadable": "Enter a UAE mobile number or an email address.",
  "channels.expected_email": "That is not an email address.",
  "channels.expected_mobile": "That is not a UAE mobile number.",
  "channels.too_soon": "A code went out within the last minute. Give it a moment before asking for another.",
  "channels.not_found": "There is no channel of that kind on your seat.",
  "channels.no_code": "Ask for a code first.",
  "channels.too_many": "Too many wrong codes. Ask for a new one in a few minutes.",
  "channels.expired": "That code has expired. Ask for another.",
  "channels.wrong_code": "That code is not right. Check the six digits and try again.",

  // ── The out-of-hours acknowledgement, board 7e §4 ─────────────────────────
  "autoreply.heading": "Out-of-hours acknowledgement",
  "autoreply.body": "Sent to the buyer within a minute when an enquiry arrives while your counter is shut.",
  "autoreply.enabled": "Send an acknowledgement when a lead arrives out of hours",
  "autoreply.not_a_reply": "It is an acknowledgement, not a reply. Your reply time keeps running until a person answers — if a template stopped the clock, the median a buyer reads on your listing would be measuring a robot.",
  "autoreply.template": "What it says",
  "autoreply.tokens": "You can use {buyerToken}, {openToken} and {phoneToken}. Each is filled in when the message is sent.",
  // The two placeholders travel as parameters rather than sitting in the
  // string. `t()` reads `{…}` as its own, so a token written literally here
  // throws in development and prints a raw key in front of a buyer in
  // production — which is exactly what it did the first time this shipped.
  "autoreply.default_body": "Thank you for your enquiry. Our counter is closed at the moment and we will come back to you when we open at {openToken}. If it is urgent, WhatsApp us on {phoneToken}.",
  "autoreply.hours_source": "Out of hours means your Hours page, Ramadan included — the same week quiet hours and lead routing read.",
  "autoreply.save": "Save the acknowledgement",
  "autoreply.saved": "Saved.",
  "autoreply.too_long": "Keep it under {max} characters. A buyer reads this on a phone.",
  "autoreply.unknown_token": "This message uses {token}, which is not one of the three that get filled in.",
  "autoreply.opens_on": "{time} on {day}",
  "autoreply.opens_unknown": "we open next",

  // ── The seat you are acting as, before sign-in exists. ──
  "dev.acting_as": "Acting as {business}, from DEV_SELLER_SLUG. Take a real seat at /dev/seat.",
  "dev.no_seat_title": "No seller seat selected",
  "dev.no_seat_body": "Set DEV_SELLER_SLUG in .env.local to a seeded business slug, or take a seat at /dev/seat.",

  // ── The developer surfaces. Gated to a loopback database; see lib/dev/guard.ts. ──
  "dev.index.eyebrow": "Development",
  "dev.index.title": "Every surface",
  "dev.index.intro":
    "Every route in the product, and which seat opens it. A route in grey is named in docs/routes.md and does not exist yet.",
  "dev.index.signed_in": "Signed in as {roles}",
  "dev.index.signed_out": "Not signed in",
  "dev.index.no_seat_needed": "No session needed",
  "dev.index.needs_seat": "Needs the {seat} seat",
  "dev.index.planned": "not built",
  "dev.seat.eyebrow": "Development",
  "dev.seat.title": "Take a seat",
  "dev.seat.intro":
    "Signs you in for real: it provisions the account, generates a one-time code and posts it to the same verify service the public form uses. Nothing here mints a session or grants a role directly.",
  "dev.seat.target": "Database {target}",
  "dev.seat.holding": "Signed in as {roles}, for business {business}.",
  "dev.seat.holding_none": "Not signed in.",
  "dev.seat.no_business": "none",
  "dev.seat.landing": "Sign-in lands on {href}",
  "dev.seat.sign_out": "Sign out",
  "dev.seat.signed_out": "Signed out. Take another seat below.",
  "dev.seat.error_fix":
    "Check that Supabase is running and that SUPABASE_SECRET_KEY is set in .env.local.",
  "dev.seat.platform_title": "Platform seats",
  "dev.seat.platform_body": "Staff and buyer seats belong to the platform rather than to a business.",
  "dev.seat.seller_title": "Seller seats",
  "dev.seat.seller_body":
    "Pick the row whose state you want to look at, then the role. Plan, tier and the three counts are what change which panels a screen renders.",
  "dev.seat.table_caption": "Claimed businesses, with the state that changes what a dashboard screen renders",
  "dev.seat.col.business": "Business",
  "dev.seat.col.plan": "Plan",
  "dev.seat.col.strength": "Strength",
  "dev.seat.col.products": "Products",
  "dev.seat.col.photos": "Photos",
  "dev.seat.col.seats": "Seats",
  "dev.seat.col.state": "State",
  "dev.seat.col.sign_in": "Sign in as",
  "dev.seat.tier": "tier {tier}",
  "dev.seat.state.live": "Live",
  "dev.seat.state.draft": "Not live",
  "dev.seat.state.suspended": "Suspended",
  "dev.seat.kind.owner": "Owner",
  "dev.seat.kind.manager": "Manager",
  "dev.seat.kind.sales": "Sales",
  "dev.seat.kind.finance": "Finance",
  "dev.seat.kind.ops_lead": "Ops lead",
  "dev.seat.kind.ops_lead_2": "Ops lead (second approver)",
  "dev.seat.kind.moderator": "Moderator",
  "dev.seat.kind.field": "Field verifier",
  "dev.seat.kind.staff_finance": "Platform finance",
  "dev.seat.kind.buyer": "Buyer",
  "dev.seat.kind.none": "none",
  "dev.seat.script_note":
    "The same seats are available from the command line with pnpm dev:seat. Back to",

  // ── Overview, boards 3a and 11a ───────────────────────────────────────────
  // The banner and the sidebar figure are how the setup hub is reached. It has
  // no nav row of its own: a permanent row would still be there a year later
  // reading "nothing left", so both of these disappear at a hundred per cent.
  "overview.setup_banner_title": "Finish setting up",
  "overview.setup_banner": {
    one: "One thing left, worth {points} points on your profile strength.",
    other: "{formatted} things left, worth {points} points between them.",
  },
  "overview.setup_banner_action": "Pick one up",
  "shell.strength_label": "Profile strength",
  "shell.strength_value": {
    one: "{strength}% · {formatted} item left",
    other: "{strength}% · {formatted} items left",
  },
  "shell.strength_done": "{strength}% · nothing left",

  "overview.title": "Overview",
  "overview.eyebrow": "Your business",
  // ── Board 3a §2's licence row ──
  // The consequence, not the date. "Expires 12 Oct" reads as administrative and
  // the loss does not: the badge comes off every public card and the listing
  // stops matching the licence-verified filter the same morning.
  "overview.licence_expiring": {
    one: "Your trade licence expires in {formatted} day. On the day it lapses your listing loses the licence-verified badge and stops matching the licence-verified filter.",
    other: "Your trade licence expires in {formatted} days. On the day it lapses your listing loses the licence-verified badge and stops matching the licence-verified filter.",
  },
  "overview.licence_lapsed": "Your trade licence expired on {when}. Your listing has dropped to tier 1, lost the licence-verified badge and no longer matches the licence-verified filter. Your listing, products and enquiries are untouched.",
  "overview.licence_renew": "Renew",
  "overview.needs_reply": "Needs a reply",
  "overview.needs_reply_body": "Enquiries waiting on you, oldest first. Response time is measured from the first reply, not from when you open one.",
  "overview.awaiting": "Enquiries awaiting a reply",
  "overview.threads": "Threads where the buyer spoke last",
  "overview.quotes_out": "Quotes sent, no decision yet",
  "overview.reviews_unanswered": "Reviews without a reply",
  "overview.all_clear": "Nothing is waiting on you",
  "overview.all_clear_body": "Every enquiry has a quote and every thread ended with yours. New enquiries appear here as they arrive.",
  "overview.open_leads": "Open the leads inbox",
  "overview.this_month": "This month",
  "overview.enquiries_received": "Enquiries this month",
  "overview.of_cap": "{used} of {cap}",
  "overview.unlimited": "No limit on {plan}",
  "overview.remaining_one": "1 enquiry left this month",
  "overview.remaining": "{n} enquiries left this month",
  "overview.at_cap": "You have used all {cap} enquiries this month",
  "overview.resets": "The count resets on the 1st",
  "overview.standing": "How you are standing",
  "overview.profile_strength": "Profile strength",
  "overview.strength_unmeasured": "Not measured yet",
  "overview.response_unmeasured": "Not enough replies to measure yet",
  "overview.products": "Products",
  "overview.locations": "Locations",
  "overview.photos": "Photos",
  "overview.seats": "Team seats",

  // The free board's argument. Board 11a.
  "overview.missed_title": "Enquiries you did not receive",
  "overview.missed_body_one": "One enquiry matched your catalogue this month after you reached the {cap}-enquiry limit on {plan}. It went to other suppliers.",
  "overview.missed_body": "{n} enquiries matched your catalogue this month after you reached the {cap}-enquiry limit on {plan}. They went to other suppliers.",
  "overview.missed_caption": "Enquiries missed this month, most recent first",
  "overview.missed_col_requirement": "What they asked for",
  "overview.missed_col_items": "Items",
  "overview.missed_col_area": "Deliver to",
  "overview.missed_col_needed": "Needed by",
  "overview.missed_col_missed": "Missed",
  "overview.missed_still_open": "Still open",
  "overview.missed_closed": "Closed",
  "overview.missed_none": "You have not missed an enquiry this month",
  "overview.missed_none_body": "You are inside your {cap}-enquiry limit. If an enquiry arrives after you reach it, it is listed here with what the buyer asked for.",
  "overview.missed_more": "Showing the most recent 20 of {n}",
  "overview.reason.at_monthly_cap": "You had used all {cap} enquiries for the month",

  // Locked panels. Every one names the plan and the price.
  "overview.locked_upgrade": "{feature} is on {plan}, AED {price} a month",
  "overview.locked_best": "{feature} is not on any plan we sell yet",
  "overview.see_plans": "See plans",
  "overview.move_to": "Move to {plan}, AED {price} a month",
  "overview.replies_in": "You typically reply in {duration}",
  "overview.locked_domain": "Your own web address",
  "overview.locked_domain_body": "Your storefront answers on a domain you own, instead of a page inside the directory.",
  "overview.free_is_free": "Free is a plan, not a trial. Nothing here expires.",


  // ── Catalogue, board 3f ───────────────────────────────────────────────────
  "catalogue.title": "Products",
  "catalogue.eyebrow": "Catalogue",
  "catalogue.caption": "Your products, and the work outstanding on them",
  "catalogue.empty_title": "No products yet",
  "catalogue.empty_body": "Add one by hand, or import a spreadsheet you already have. A product with its filterable specs filled in is the difference between being listed and being found.",
  "catalogue.add": "Add a product",
  "catalogue.import": "Import a spreadsheet",
  "catalogue.col.product": "Product",
  "catalogue.col.specs": "Specs",
  "catalogue.col.availability": "Availability",
  "catalogue.col.photos": "Photos",
  "catalogue.col.status": "Status",
  "catalogue.col.updated": "Changed",
  "catalogue.status.draft": "Draft",
  "catalogue.status.live": "Live",
  "catalogue.status.out_of_stock": "Out of stock",
  "catalogue.availability.in_stock": "In stock",
  "catalogue.availability.made_to_order": "Made to order",
  "catalogue.availability.indent": "Indent order",
  "catalogue.availability.out_of_stock": "Out of stock",
  "catalogue.of_specs": "{filled} of {total}",
  "catalogue.no_template": "No template",
  "catalogue.from_import": "Imported",

  // ── Catalogue, board 3f ───────────────────────────────────────────────────

  /*
     The header. One total, with a breakdown that sums to it.

     The board read `1,204 live · 38 drafts · 14 out of stock` — 1,256 — over a
     pagination reading `1–10 of 1,242`. 1,204 was the seller's *total*, so the
     header labelled the total as the live count and then added two more states
     on top of it. Every figure here is a query over one read, so they cannot
     disagree with each other or with the rows beneath.
  */
  "catalogue.header_counts": { one: "{formatted} product", other: "{formatted} products" },
  "catalogue.header_breakdown": "{live} live · {draft} drafts · {outOfStock} out of stock",
  "catalogue.approximate": "Counted over your {scanned} most recently edited products.",

  /*
     The two chips, and the correction the screen turns on.

     The board had one: `62 with missing specs`. An empty required field blocks
     that product's next save and changes nothing a buyer sees; an empty
     filterable field makes the product absent from a buyer's filter and blocks
     nothing. One is a wall in front of the seller's next edit, the other is
     reach they will never notice losing. Different work, different order, so
     they cannot share a count — and an empty optional field is not counted at
     all, because counting it teaches the seller the figure is noise.
  */
  "catalogue.chip.blocked": { one: "{count} blocked on save", other: "{count} blocked on save" },
  "catalogue.chip.filter": { one: "{count} missing a filter value", other: "{count} missing a filter value" },
  "catalogue.chip.untemplated": { one: "{count} with no template", other: "{count} with no template" },
  "catalogue.chip.clear": "Show everything",

  /*
     NB the `catalogue.` prefix is shared with board 1e, the buyer's view of a
     seller's shelf. Three keys here carry a suffix rather than the obvious
     name — `sort_by`, `sort.product`, `search_hint` — because the obvious ones
     are already 1e's and mean something else there.
  */
  "catalogue.search_label": "Search",
  "catalogue.search_hint": "SKU, name or spec value",
  "catalogue.filter.category": "Category",
  "catalogue.filter.status": "Status",
  "catalogue.filter.template": "Template",
  "catalogue.filter.any": "Any",
  "catalogue.filter.option": "{name} · {count}",
  "catalogue.filter.clear": "Clear filters",
  "catalogue.sort_by": "Sort",
  "catalogue.sort.gaps": "Gaps first",
  "catalogue.sort.product": "Name",
  "catalogue.sort.sku": "SKU",
  "catalogue.sort.template": "Template",
  "catalogue.sort.stock": "Stock",
  "catalogue.sort.specs": "Specs filled",
  "catalogue.sort.status": "Status",
  "catalogue.sort.updated": "Last edited",
  "catalogue.rows_label": "Rows",
  "catalogue.range": "{from}–{to} of {total}",
  "catalogue.previous": "Previous page",
  "catalogue.next": "Next page",
  "catalogue.page": "Page {page}",

  "catalogue.empty_filtered_title": "Nothing matches those filters.",
  "catalogue.empty_filtered_body": "{count} products are filtered out. Clearing the filters brings them back.",

  /*
     Selection scope, stated.

     The board said `3 selected` above a 125-page list, which does not say
     whether the action applies to three products or to the whole set. Page by
     default, with an explicit route to the filtered set — and the label carries
     the filter's count, because a bulk action whose blast radius changes when a
     chip is clicked is the trap the whole section exists to close.
  */
  "catalogue.selected_here": { one: "{count} selected on this page", other: "{count} selected on this page" },
  "catalogue.selected_all": { one: "{count} selected, the whole filtered set", other: "{count} selected, the whole filtered set" },
  "catalogue.select_filtered": { one: "Select the 1 product these filters match", other: "Select all {count} products these filters match" },
  "catalogue.clear_selection": "Clear",
  "catalogue.bulk.hint": "An action ending in … opens a preview naming what changes and what is lost.",
  "catalogue.bulk.unpublish": "Unpublish…",
  "catalogue.bulk.move": "Move category…",
  "catalogue.bulk.availability": "Change availability",
  "catalogue.cap.refused": "Publishing {adding} would pass your plan's limit of {cap}. There is room for {room} more.",

  /*
     Unpublish, and what a buyer at that URL actually gets.

     Board 6f settled that we 301 rather than 404: an unpublished product's URL
     has inbound links and accumulated ranking, and answering it with a 404
     throws both away. The page already redirects; this is the sentence that
     tells the seller before they do it, which the board's two-click bulk
     unpublish never did.
  */
  "catalogue.unpublish.title": { one: "Unpublish {count} product", other: "Unpublish {count} products" },
  "catalogue.unpublish.body": { one: "It stays in your catalogue and comes off your storefront. Anyone following its link is redirected to your storefront rather than shown a dead page, and you can publish it again at any time.", other: "They stay in your catalogue and come off your storefront. Anyone following one of their links is redirected to your storefront rather than shown a dead page, and you can publish them again at any time." },
  "catalogue.unpublish.live_note": { one: "{count} of them is live now.", other: "{count} of them are live now." },
  "catalogue.unpublish.confirm": { one: "Unpublish {count} product", other: "Unpublish {count} products" },

  /*
     Move category — which is also what changes the template.

     A product has no template pointer; the template is resolved through the
     category. Two buttons for one write would be the dangerous kind of lie, so
     there is one action and its preview names both consequences.
  */
  "catalogue.move.title": "Move to another category",
  "catalogue.move.body": "A product's spec template comes from its category, so moving it changes which fields it has and which filters buyers can find it through.",
  "catalogue.move.target": "Move to",
  "catalogue.move.choose": "Choose a category",
  "catalogue.move.no_target": "Choose a category to move them to.",
  "catalogue.move.summary": { one: "{count} product moves to {category}.", other: "{count} products move to {category}." },
  "catalogue.move.already": { one: "{count} is already there and will not change.", other: "{count} are already there and will not change." },
  "catalogue.move.same_template": "Same spec template, so no value is lost and no filter changes.",
  "catalogue.move.dropped_heading": { one: "{count} value stops being readable", other: "{count} values stop being readable" },
  "catalogue.move.dropped_body": "The new template does not have these fields. Nothing is deleted — the values stay on the record and come back if you move the products back — but until then they show nowhere.",
  "catalogue.move.dropped_row": { one: "{label} — {count} product, for example {sample}", other: "{label} — {count} products, for example {sample}" },
  "catalogue.move.facets_gained": "Buyers gain these filters: {list}.",
  "catalogue.move.facets_lost": "Buyers lose these filters: {list}. Products drop out of them until the new template's fields are filled.",
  "catalogue.move.untemplated": "That category has no spec template, so nothing can be published there until one exists.",
  "catalogue.move.confirm": { one: "Move {count} product", other: "Move {count} products" },
  "catalogue.cancel": "Cancel",

  /*
     The SPECS column, which names the consequence rather than the ratio.

     `18 / 22` describes how much of a form is filled and nothing about what the
     gap costs. The ratio stays as context; underneath it, what it means.
  */
  "catalogue.specs.ratio": "{filled} / {total}",
  "catalogue.specs.missing_filters": { one: "Missing {count} filter", other: "Missing {count} filters" },
  "catalogue.specs.required": { one: "{count} required · save blocked", other: "{count} required · save blocked" },
  "catalogue.specs.complete": "Complete",
  "catalogue.specs.no_gaps": "Nothing missing that costs anything",
  "catalogue.specs.cannot_publish": "Cannot publish · set one",
  "catalogue.specs.legend": "REQUIRED blocks that product's next save in the editor and never unpublishes it — a product can be live and unsaveable at once. MISSING N FILTERS means it is absent from that many buyer filters on the category pages; it is not ranked lower. Both are worked out when this page loads, never stored.",

  "catalogue.col.sku": "SKU",
  "catalogue.col.template": "Template",
  "catalogue.col.stock": "Stock",
  "catalogue.stored_not_listed": "Stored · not listed",
  "catalogue.stored_reason": "Above your plan's product limit. The record is kept; publishing it needs room.",
  "catalogue.no_photo": "No photo",

  /*
     The plan's limit, in the header, on every plan.

     A Pro seller with 1,242 products who downgrades has to be told what happens
     to 1,232 of them, and the answer is that nothing is deleted. Stated before
     it bites rather than discovered at the moment of being blocked.
  */
  "catalogue.cap.unlimited": "{plan} · no product limit",
  "catalogue.cap.listed": "{plan} · {listed} of {cap} listed",
  "catalogue.cap.at": "You are at your plan's limit. Unpublish something to list another, or move to a larger plan.",
  "catalogue.cap.over": { one: "{count} product is stored above your plan's limit and is not listed. Nothing has been deleted — publish it in place of one that is live, or move to a larger plan.", other: "{count} products are stored above your plan's limit and are not listed. Nothing has been deleted — publish them in place of ones that are live, or move to a larger plan." },
  "catalogue.new_product": "New product",
  "catalogue.new_product_named": "Give it a name",
  "catalogue.new_product_hint": "You can change everything about it afterwards. It starts as a draft, so no buyer sees it until you publish.",
  "catalogue.new_product_create": "Create and edit",
  "catalogue.new_product_at_cap": "Your plan lists {cap} products and {listed} are live. You can still add one — it starts as a draft, and publishing it needs room.",
  "catalogue.missing_specs": "{count} products have no filterable specs. Buyers filter on those fields, so those products are listed but not found.",
  "catalogue.drafts": "{count} drafts are not visible to buyers yet.",
  "catalogue.select_all": "Select every product",
  "catalogue.select_one": "Select {name}",
  "catalogue.selected": "{count} selected",
  "catalogue.bulk.publish": "Publish",
  "catalogue.bulk.draft": "Move to draft",
  "catalogue.bulk.out_of_stock": "Mark out of stock",
  "catalogue.bulk.delete": "Delete",
  "catalogue.bulk.confirm_delete": "Delete {count} products? This cannot be undone.",
  "catalogue.bulk.done": "{count} products updated.",
  "catalogue.bulk.unknown": "That action is not one this screen offers. Reload the page and try again.",
  "catalogue.template_link": "Edit your spec template",

  // ── CSV import, board 11d ─────────────────────────────────────────────────
  "import.title": "Import a spreadsheet",
  "import.eyebrow": "Catalogue",
  "import.step_upload": "Choose a file",
  "import.step_map": "Check the columns",
  "import.step_done": "Imported",
  "import.upload_label": "Spreadsheet",
  "import.upload_hint": "A CSV exported from whatever you already use. The first row must name the columns.",
  "import.upload_action": "Read the file",
  "import.ragged": "{count} rows had a different number of columns and were padded. They are listed below.",
  "import.map_caption": "Every column in the file, and where it will go",
  "import.col_header": "Column in your file",
  "import.col_sample": "First value",
  "import.col_target": "Imported as",
  "import.col_why": "Why",
  "import.target.name": "Product name",
  "import.target.sku": "Your reference",
  "import.target.description": "Description",
  "import.target.availability": "Availability",
  "import.target.stock_qty": "Stock quantity",
  "import.target.lead_time_days": "Lead time in days",
  "import.target.min_order_qty": "Minimum order quantity",
  "import.target.spec": "Spec field",
  "import.target.ignore": "Do not import",
  "import.target.blocked": "Do not import",
  "import.blocked_badge": "Blocked",
  "import.filter_badge": "FILTER",
  "import.split_offer": "This column holds two values separated by \"{on}\". Split it into two fields?",
  "import.split_yes": "Split it",
  "import.needs_name": "Choose which column holds the product name. Everything else is optional.",
  "import.apply": "Import {rows} products",
  "import.save_as_label": "Save this mapping as",
  "import.save_as_hint": "So next month's export maps itself.",
  "import.saved_mappings": "Saved mappings",
  "import.use_mapping": "Use {name}",
  "import.done_title": "{count} products imported",
  "import.done_body": "They are drafts, so buyers cannot see them yet. Check a few, then publish.",
  "import.done_skipped": "{count} rows were skipped.",
  "import.undo": "Undo this import",
  "import.undo_window": "You can undo this for 24 hours.",
  "import.undo_done": "{count} products removed. Nothing else changed.",
  "import.review": "Review the imported products",
  "import.over_cap": "That file would add {adding} products to the {have} you have, and {plan} allows {cap}. Nothing has been imported — remove rows from the file, delete products you no longer sell, or move to a plan with room.",
  "import.room": { one: "Room for {formatted} more product on {plan}.", other: "Room for {formatted} more products on {plan}." },
  "import.room_none": "You are at the {cap}-product limit on {plan}. Delete something, or move to a plan with room, before importing.",
  "import.room_unlimited": "{plan} does not cap how many products you list.",
  "import.may_exceed": "This file has {rows} rows and there is room for {room} more products. Rows that duplicate a product you already have are skipped, so it may still fit — if it does not, nothing will be imported and you can trim the file.",

  /* ── Board 11d · the mapper proper ──────────────────────────────────────
     The board counted nine columns and listed seven. The two it hid were the
     two that decide what the import does, so both have a target of their own
     and a status the tally counts. */
  "import.step_preview": "Preview and confirm",
  "import.back": "Back",
  "import.preview_rows": { one: "Preview {n} row", other: "Preview {n} rows" },
  "import.col_status": "Status",
  "import.target.subcategory": "Subcategory",
  "import.target.photo": "Image, matched by filename",
  "import.status.matched": "Matched",
  "import.status.needs_you": "Needs you",
  "import.status.blocked": "Blocked",
  "import.status.ignored": "Ignored",
  "import.tally": "{matched} matched · {needs} need you · {blocked} blocked · {ignored} ignored",
  "import.note.sku": { one: "Existing references update instead of duplicating — {n} row matches", other: "Existing references update instead of duplicating — {n} rows match" },
  "import.note.subcategory": { one: "Sets the spec template per row. {n} subcategory in this file", other: "Sets the spec template per row. {n} subcategories in this file" },
  "import.note.subcategory_unknown": { one: "{n} row names a subcategory that does not exist. Those rows will not import.", other: "{n} rows name subcategories that do not exist. Those rows will not import." },
  "import.note.photo": "{matched} of {total} filenames are in your media library. {missing} are not — those rows import without a photo.",
  "import.note.photo_none": "No filenames matched your media library, so this column is ignored rather than silently attaching nothing.",
  "import.note.photo_ambiguous": { one: "{n} filename matches more than one file in your library, so it is left unattached — renaming one of them resolves it.", other: "{n} filenames match more than one file each, so they are left unattached — renaming resolves it." },
  "import.note.filter": "Values must match this field's allowed list, or the row is an error.",

  /* ── The file card, §2 ── */
  "import.file.summary": "{rows} rows · {columns} columns",
  "import.file.header_row": "First row names the columns",
  "import.file.header_row_hint": "Switch off if row 1 is a title rather than headings. Changing this re-reads the file.",
  "import.file.templates": { one: "{n} subcategory · {templates} applies", other: "{n} subcategories · {templates} apply" },
  "import.file.templates_count": { one: "{n} template", other: "{n} templates" },
  "import.file.replace": "Replace file",

  /* ── What will happen, §4 ── */
  "import.rail.title": "What will happen",
  "import.rail.new": "New products",
  "import.rail.updated": "Updated by reference match",
  "import.rail.errors": "Rows with errors",
  "import.rail.photos": "Photos matched",
  "import.rail.photos_value": "{matched} of {total}",
  "import.rail.listed": "Listed immediately",
  "import.rail.cap_unlimited": { one: "The {n} new product lists — {plan} sets no product limit.", other: "All {n} new products list — {plan} sets no product limit." },
  /* The same fact when something *else* is holding products back. Saying "all 2
     new products list" directly under `Listed immediately 0` puts two numbers on
     one card that disagree, which is the defect this board exists to correct. */
  "import.rail.cap_unlimited_held": "{plan} sets no product limit, so nothing here is held back by your plan.",
  /* A file that only rewrites existing products creates nothing for a cap to
     apply to, and "All 0 new products list" is a sentence about nothing. */
  "import.rail.cap_updates_only": "Nothing new is being created, so your plan's product limit does not come into it. The products this file matches keep the listing they already have.",
  "import.rail.cap_limited": "{listed} of {created} list — {plan} allows {cap}. The rest are stored unlisted for you to choose from. Nothing is dropped and no row is refused.",
  "import.rail.incomplete": { one: "{n} product is held back because a required spec field is empty. It imports and stays a draft until you fill it.", other: "{n} products are held back because a required spec field is empty. They import and stay drafts until you fill them." },
  "import.rail.rollback": "Nothing imports until you confirm. For 24 hours you can roll the import back: the new products are unlisted and the updated ones return to their previous values.",
  /* The same scope, said after the import rather than before it. The rail's
     sentence opens with "Nothing imports until you confirm", which read as a
     promise about an import that had already run when it was reused on the
     catalogue's banner. */
  "import.rollback_done": "For 24 hours you can roll this import back: the new products are unlisted and the updated ones return to their previous values.",
  /* A run that only rewrote existing products imported nothing, and saying "40
     products imported" over `0 new · 40 updated` is the kind of number a
     directory cannot afford to get wrong about its own screen. */
  "import.done_title_updated": { one: "{n} product updated", other: "{n} products updated" },
  "import.done_title_mixed": "{created} imported, {updated} updated",
  "import.rail.rollback_replaces": "Confirming closes the rollback window on your previous import. There is one rollback point.",

  /* ── Error rows, §States ── */
  "import.errors_heading": "Rows that will not import",
  "import.errors_intro": { one: "{n} row cannot be imported. Every other row still will be.", other: "{n} rows cannot be imported. Every other row still will be." },
  "import.errors_row": "Row {row}",
  "import.error.no_name": "No product name in that row.",
  "import.error.unknown_category": "That subcategory does not exist. Map it to one that does, or fix the file.",
  "import.error.duplicate_name": "You already have a product with this name, and this row has no reference to match it by. Add a reference column and it will update instead.",
  "import.nothing_importable": "Nothing in this file can be imported.",
  "import.nothing_importable_hint": "Every column is blocked or ignored, so there is no product to create. Map a column to the product name to begin.",
  "import.unreadable": "That file could not be read.",
  "import.not_yours": "You can only import into your own catalogue.",

  /* ── Mappings you can reuse, §5 ── */
  "import.round_trip.badge": "MAPS 1:1",
  "import.round_trip.applied": "This file came from Export, so every column is already mapped.",
  "import.round_trip.unknown": { one: "{n} column is not one of ours and is left for you to place.", other: "{n} columns are not ours and are left for you to place." },
  "import.mapping_used": "Used {date}",
  "import.mapping_never": "Not used yet",

  /* ── Undo, §4 ── */
  "import.undo_not_found": "That import cannot be found.",
  "import.undo_already": "That import has already been undone.",
  "import.undo_expired": "An import can be rolled back for 24 hours. This one is older than that, so its products are part of your catalogue — unlist them from the catalogue screen instead.",
  "import.undo_result": "{unlisted} unlisted, {restored} returned to their previous values.",
  "import.done_counts": "{created} new · {updated} updated · {listed} listed",

  /* ── Concierge, §6. A real queue, not a promise: /admin/catalogue-imports. ── */
  "import.concierge.title": "Rather not do this yourself?",
  "import.concierge.body": "Send us the file and our team maps and loads it for you.",
  "import.concierge.action": "Ask us to do it",

  /* ── Export, board 3f §1's other button — the round trip's outward leg ── */
  "catalogue.export": "Export",
  "catalogue.export.all": "Whole catalogue",
  "catalogue.export.hint": "A spreadsheet you can edit and import again. References match, so edited rows update rather than duplicate.",
  "catalogue.export.never": "Prices are not in the file. There are none on a product here.",


  // ── Product editor, board 3g ──────────────────────────────────────────────
  "product.title": "{name}",
  "product.eyebrow": "Product",
  "product.basics": "The product",
  "product.name_label": "Product name",
  "product.sku_label": "Your reference",
  "product.sku_hint": "Your own part number. Buyers see it, and quote against it.",
  "product.description_label": "Description",
  "product.availability_label": "Availability",
  "product.stock_label": "Stock quantity",
  "product.lead_label": "Lead time in days",
  "product.moq_label": "Minimum order quantity",
  "product.moq_hint": "Your own minimum. This describes how you sell, not anything we impose.",
  "product.no_price_here": "There is no price field. Prices belong on a quote, where only the buyer you send it to can see them.",
  "product.specs": "Specifications",
  "product.specs_hint": "Fields marked FILTER are what buyers narrow a search by. Filling them is the difference between being listed and being found.",
  "product.spec_filled": "{filled} of {total} filterable fields filled",
  "product.status_label": "Status",
  "product.save": "Save",
  "product.saved": "Saved.",
  "product.back": "Back to the catalogue",
  "product.template_link": "Rename these fields",
  "product.not_found": "That product cannot be found.",
  "product.name_required": "Give the product a name before saving.",

  // The template banner. Every count is a projection of the resolved template,
  // so a number here cannot disagree with the grid beneath it.
  "product.template_eyebrow": "Template",
  "product.template_counts": "{fields} fields · {filterable} filterable",
  "product.template_revision": "Your rev {revision} · tracks platform v{version}",
  "product.template_platform": "The platform's own template — you have not made a copy of it yet",

  // Scope chips. Counts ride in the label because a chip whose count sits
  // elsewhere is a chip the seller has to look away from to read.
  "product.scope_label": "Which fields to show",
  "product.scope_all": "All {count}",
  "product.scope_gaps": "Gaps {count}",
  "product.scope_filterable": "Filterable {count}",
  "product.scope_hint": "Order follows the template — it is the order buyers read",
  "product.scope_empty": "No field is in this group.",

  "product.pill_empty": "Empty",
  "product.pill_yours_only": "Yours only",
  "product.pill_required": "Required",
  "product.own_marker": "your own field",

  /*
     Gap reasons. Three of them, because the honest sentence depends on what the
     field is: a facet, a field of the seller's own, or a platform field nobody
     filters on. None of them claims a ranking effect — an empty filterable
     field is not a product ranked lower, it is a product absent from that
     filter, which is a fact about the index rather than a correlation.

     And none of them carries a search-volume figure. Board 3h reached that
     first: the search log records what was typed, not which filters were used.
  */
  "product.gap_reason_filter": "Buyers filter on this. A product with it empty is not in that filter — not ranked lower in it, absent from it.",
  "product.gap_reason_filter_scoped": "Buyers filter on this. A product with it empty is not in that filter. {filled} of your {total} products in this category have a value.",
  "product.gap_reason_not_a_facet": "Not a filter. It shows on your product page and in your spec table.",
  "product.gap_reason_yours_only": "Your own field. It shows in your spec table and is not a site-wide filter.",

  "product.completeness_title": "Completeness",
  "product.completeness": "How much of the template this product fills",
  "product.multi_summary": { one: "{count} selected", other: "{count} selected" },
  "product.multi_placeholder": "Nothing selected",
  /*
     The empty option a select needs to be able to be empty.

     Not an information-carrying placeholder — the gap's reason lives beneath
     the field, per criterion 13. This is the difference between a control that
     has no value and one that silently has the first one.
  */
  "product.select_empty": "Not selected",
  "product.multi_remove": "Remove {option}",
  "product.completeness_value": "{filled} of {total} fields in your template",
  "product.completeness_filterable": "{count} of the gaps are fields buyers filter on.",
  "product.completeness_filterable_none": "None of the gaps is a field buyers filter on.",
  "product.save_ok": "No required field is missing, so saving is not blocked.",
  "product.save_blocked": "Fill {fields} before this product can be saved.",
  /*
     The card's half of the same fact.

     A count rather than the list, because the alert above Save already names
     the fields and one screen saying the same sentence twice reads as a bug in
     the screen rather than as emphasis.
  */
  "product.save_blocked_count": { one: "{count} required field is still empty, so this product cannot be saved. It stays live in the meantime — nothing has been taken down.", other: "{count} required fields are still empty, so this product cannot be saved. It stays live in the meantime — nothing has been taken down." },
  "product.go_to_first_missing": "Go to the first one",
  "product.save_blocked_where": "Your template decides what is required. You can change that on your spec template.",
  "product.go_to_gaps": "Go to the gaps",

  "product.preview_eyebrow": "Spec table as buyers see it",
  "product.preview_caption": "The specification a buyer reads on this product's page",
  "product.preview_rows": "{filled} of {total} filled",
  "product.preview_own_note": { one: "{count} field you added is not on your product page.", other: "{count} fields you added are not on your product page." },
  "product.preview_draft_note": "This product is a draft, so the page is not published yet. This is what it would show.",

  "product.add_field_body": "Need a field the template does not have? Add it to your template — it shows on your page and in your spec table, but it is not a site-wide filter until the platform makes it one for the whole category.",
  "product.add_field_link": "Edit your template",
  "product.field_detached_note": "Detached from the platform field. It keeps its value and its place in your spec table.",

  "product.preview_action": "Preview",
  "product.preview_draft_disabled": "A draft has no public page to preview yet.",

  // ── Spec template, board 3h ───────────────────────────────────────────────
  "product.missing_required": "Fill {fields} before saving. Your template requires it — the products already saved without it stay live, and this one needs it now.",

  "template.title": "Spec templates",
  "template.eyebrow": "Catalogue",
  "template.intro": "The fields your products are described by. What they are called and the order buyers read them in are yours; which fields buyers can filter on is set once for everyone in the category.",
  "template.caption": "The fields on your products",
  "template.none": "This category has no spec template yet, so there is nothing to edit.",
  "template.clone": "Set up your template",
  "template.not_found": "That template is not one of yours.",

  "template.varies": "Varies",
  "template.varies_help": "This field differs between variants of the same product, so a value is never copied across the set.",
  "template.header_revision": "Your rev {revision} · tracks {template} v{version}",
  "template.header_applied": { one: "Applied to {count} product", other: "Applied to {count} products" },
  "template.compare": "Compare to platform v{version}",
  "template.history": "Revision history",
  "template.review": { one: "Review {count} change", other: "Review {count} changes" },

  "template.rail_yours": "Your templates",
  "template.rail_library_count": { one: "{n} template you have not copied", other: "{n} templates you have not copied" },
  "template.rail_library": "Clone from library",
  "template.rail_browse": { one: "Browse {count} more", other: "Browse all {count}" },
  "template.rail_none": "Nothing to clone yet — the platform has no other template for your categories.",

  "template.fields_heading": "Fields",
  "template.fields_hint": "Drag to reorder — this is the order buyers read them in",
  "template.add_field": "Add a field",
  "template.col_label": "Field label",
  "template.col_type": "Type & unit",
  "template.col_required": "Required",
  "template.col_filter": "Filter",
  "template.col_filled": "Filled",
  "template.reorder_up": "Move {field} up",
  "template.reorder_down": "Move {field} down",
  "template.select_field": "Settings for {field}",
  "template.own_marker": "your own field",
  "template.new_marker": "New",

  "template.facet.platform": "Platform",
  "template.facet.not_a_facet": "Not a facet",
  "template.facet.yours_only": "Yours only",

  "template.type_options": { one: "{type} · {count} option", other: "{type} · {count} options" },
  "template.type_plain": "{type}",
  "template.type_unit": "{type} · {unit}",
  "template.filled_of": "{filled} / {total}",
  "template.to_fix": { one: "{count} to fix", other: "{count} to fix" },
  "template.required_label": "Require {field} on every product",

  "template.gaps_heading": { one: "{count} product is missing a required field.", other: "{count} products are missing a required field." },
  "template.gaps_body": "They stay live and stay in search. The gaps are flagged on each product and block its next save.",
  "template.gaps_fix": { one: "Fix {count}", other: "Fix {count}" },
  "template.gaps_none": "Every product has the fields you require.",

  "template.platform_added": { one: "Platform v{version} added one field.", other: "Platform v{version} added {count} fields." },
  "template.platform_body": "{field} is engineering data per SKU — nothing on the platform can work it out from what you have already given us. Export your rows, fill the column, and keep the file for the importer. Or leave it: nothing breaks, and no product comes down.",
  "template.platform_no_usage": "We cannot yet tell you how many buyers filtered on it — the search log records what was typed, not which filters were used.",
  "template.platform_export": { one: "Export {count} row", other: "Export {count} rows" },
  "template.platform_no_return": "The import that reads this file back is not built yet, so the export is one-way for now.",

  "template.pending_heading": "Pending changes",
  "template.pending_eyebrow": { one: "Not yet applied to {count} product", other: "Not yet applied to {count} products" },
  "template.pending_none": "Nothing is waiting to be applied.",
  "template.blast.display_only": "Display order only",
  "template.blast.republish": { one: "{count} product · no republish needed", other: "{count} products · no republish needed" },
  "template.blast.flag": { one: "{count} flagged · none delisted", other: "{count} flagged · none delisted" },
  "template.change.renamed": "Renamed {from} to {to}",
  "template.change.reordered": "Moved {field}",
  "template.change.required_on": "Required on {field}",
  "template.change.options_narrowed": "Changed the options on {field}",
  "template.change.unit_display": "Changed how {field} shows its unit",
  "template.change.detached": "Detached {field} from the platform field",
  "template.change.field_added": "Added {field}",
  "template.change.field_removed": "Removed {field}",
  "template.apply": "Apply these changes",
  "template.applied": "Applied. This is revision {revision}.",
  "template.discard": "Discard them",
  "template.discarded": "Discarded. Nothing was applied.",

  "template.settings_eyebrow": "Field settings",
  "template.settings_none": "Pick a field to change what it is called and what it holds.",
  "template.label_field": "Label buyers see",
  "template.label_for": "Your name for {field}",
  "template.label_hint": "Rename freely. Comparison follows the mapping below, not the label.",
  "template.mapped_to": "Mapped to",
  "template.locked": "Locked",
  "template.type_field": "Type",
  "template.type_locked": "The field's shape is the platform's, so every seller's values compare. Your own fields are yours to shape.",
  "template.options_heading": { one: "{count} option", other: "{count} options" },
  "template.options_hint": "Untick a size you do not stock. You cannot add one the platform does not carry — a value outside its list is a product no filter reaches.",
  "template.unit_heading": "Show unit as",
  "template.unit_both": "Both",
  "template.unit_primary": "{unit} only",
  "template.required_switch": "Required to publish",
  "template.required_floor": "The platform requires this field. You can add requirements, not remove them.",
  "template.required_new_note": "New products are held to it at first save. Products you already have are flagged, never delisted.",
  "template.comparison_switch": "Show in comparison table",
  "template.filter_switch": "Search filter",
  "template.detach": "Detach from the platform field",
  "template.detach_confirm": "Detach {field}?",
  "template.detach_body": "It stops being the same field as every other seller's. It leaves the comparison table and any buyer filter, and its values stay exactly as they are. Renaming does not do this — only this does.",
  "template.detach_go": "Detach it",
  "template.detached_note": "Detached. This field is yours alone now: out of comparison, out of every filter.",

  "template.ownership_heading": "What is yours, and what is not",
  "template.ownership_body": "Labels, order, options and your own extra fields are yours. Which fields buyers can filter on is set once for everyone in the category — otherwise the same filter would return different sellers.",

  "template.new_field_heading": "Add a field of your own",
  "template.new_field_label": "What it is called",
  "template.new_field_type": "What it holds",
  "template.new_field_go": "Add it",
  "template.new_field_note": "Your own field is yours alone. Buyers see it on your products and cannot filter or compare on it, because nobody else has it.",
  "template.remove_field": "Remove {field}",

  "template.history_heading": "Revision history",
  "template.history_row": "Revision {revision}",
  "template.history_by": "by {name}",
  "template.history_anon": "by a seat that has since left",
  "template.history_restore": "Restore this",
  "template.history_restored": "Restored. This is revision {revision}.",
  "template.history_none": "No changes have been applied yet.",

  "template.save": "Save the template",
  "template.saved": "Saved. {count} fields renamed.",
  "template.saved_none": "Saved.",
  "template.rename_warning": "\"{from}\" will be called \"{to}\" on your products. The {count} products already using it keep their values, and buyers filtering on this field still find you — it stays matched to our field \"{from}\".",
  "template.rename_warning_none": "\"{from}\" will be called \"{to}\" on your products. Nothing already entered is lost, and buyers filtering on this field still find you — it stays matched to our field \"{from}\".",
  "template.confirm": "Save these names",
  "template.cancel": "Keep the old names",


  // ── Media library, board 3i ───────────────────────────────────────────────
  "media.title": "Media",
  "media.eyebrow": "Catalogue",
  "media.intro": "Photographs of your premises, your team and your products. Photographs are the single biggest reason a buyer opens a listing, and they are {points} of your profile strength.",
  "media.empty_title": "No photographs yet",
  "media.empty_body": "A listing with no photographs reads as a listing nobody maintains. Start with the outside of your premises and your trade counter.",
  "media.upload_label": "Photographs",
  "media.upload_hint": "JPEG, PNG, WebP or AVIF, up to 8 MB each. You can select several at once.",
  "media.uploading": "Uploading {done} of {total}",
  "media.kind_label": "What this shows",
  "media.kind.logo": "Logo",
  "media.kind.cover": "Cover photograph",
  "media.kind.gallery": "Premises and team",
  "media.kind.product": "A product",
  "media.kind.storefront": "Storefront",
  "media.alt_label": "Describe this photograph",
  "media.alt_hint": "For a buyer using a screen reader, and for search. Say what is in it, not \"photo\".",
  "media.alt_missing": "No description",
  "media.save_alt": "Save",
  "media.delete": "Delete",
  "media.confirm_delete": "Delete this photograph? This cannot be undone.",
  "media.count": "{count} photographs",
  "media.of_limit": "{used} of {cap} on {plan}",
  "media.at_cap": "You have used all {cap} photographs on {plan}. Delete one, or move to {next} for {cap_next}.",
  "media.attached_to": "On {name}",
  "media.unattached": "Not on a product",
  "media.header": { one: "{n} file · {used} of {cap} used", other: "{n} files · {used} of {cap} used" },
  "media.header_uncapped": { one: "{n} file · {used} stored", other: "{n} files · {used} stored" },
  "media.cap_behaviour": "{plan} · {cap} · uploads stop at the cap",
  "media.cap_reached": "You have used all {cap} on {plan}. Nothing is deleted and nothing comes off your listing — only new uploads stop until you free some space or move up a plan.",
  "media.new_folder": "New folder",
  "media.upload": "Upload",
  "media.folders": "Folders",
  "media.all_files": "your whole library",
  "media.unfiled": "Unfiled",
  "media.folder_note": { one: "{n} folder, {files} files. Every file is in exactly one.", other: "{n} folders, {files} files. Every file is in exactly one." },
  "media.folder_count": { one: "{n} file", other: "{n} files" },
  "media.folder_name": "Folder name",
  "media.folder_create": "Create folder",

  "media.filter_apply": "Apply",
  "media.filter_clear": "Clear the search",
  "media.filter_search": "Filename or alt text",
  "media.filter_type": "Type",
  "media.filter_type.all": "All types",
  "media.filter_type.image": "Images",
  "media.filter_type.document": "Documents",
  "media.filter_used": "Used in",
  "media.filter_used.all": "Anywhere",
  "media.filter_used.products": "A product",
  "media.filter_used.storefront": "Your listing",
  "media.filter_used.nothing": "Nothing",
  "media.filter_alt": { one: "{n} missing alt on live pages", other: "{n} missing alt on live pages" },
  "media.sort": "Sort",
  "media.sort.newest": "Newest first",
  "media.sort.oldest": "Oldest first",
  "media.sort.largest": "Largest first",
  "media.sort.name": "By name",

  "media.badge.no_alt": "No alt · live on {where}",
  "media.badge.no_alt_plain": "No alt",
  "media.badge.quote_held": "In a sent quote",
  "media.badge.unreferenced": "Unreferenced",
  "media.badge.primary": "Primary",
  "media.tile_products": { one: "{n} product", other: "{n} products" },
  "media.tile_unattached": "Not attached",
  "media.grid_label": "Your files",
  "media.select_file": "Select {name}",

  "media.rail.held_only": { one: "{n} file is held by a sent quote", other: "{n} files are held by a sent quote" },
  "media.rail.unreferenced": { one: "{n} unreferenced · {size}", other: "{n} unreferenced · {size}" },
  "media.rail.unreferenced_body": "Not on a product, your listing, an enquiry or a sent quote. Safe to delete.",
  "media.rail.held": { one: "{n} more is unattached but held — a buyer has a quote linking to it. That one cannot be deleted.", other: "{n} more are unattached but held — a buyer has a quote linking to them. Those cannot be deleted." },
  "media.rail.review": "Review the unreferenced",

  "media.panel.title": "Selected file",
  "media.panel.of": "{index} of {total}",
  "media.panel.none": "Nothing selected",
  "media.panel.none_body": { one: "{n} file in this folder, {size} in total. Select one to see where it is used.", other: "{n} files in this folder, {size} in total. Select one to see where it is used." },
  "media.panel.dimensions": "Dimensions",
  "media.panel.size": "Size",
  "media.panel.uploaded": "Uploaded",
  "media.panel.alt": "Alt text",
  "media.panel.alt_hint": "Read out on your product page and used by search. Required once the file is on a live page.",
  "media.panel.alt_document": "A document is described by its name rather than by alt text.",
  // Where a file is read, as the seller would name it. Board 3i's `USED IN`
  // badges, moved out of a lookup table in lib/media/references.ts that
  // check:tokens cannot see — it reads JSX under app and components, and never
  // looks in lib.
  "media.surface.certificates": "Certificates on your listing",
  "media.surface.cover": "Storefront cover",
  "media.surface.logo": "Logo",
  "media.surface.gallery": "Listing profile",
  "media.surface.storefront": "Storefront page",
  "media.surface.library": "In your library, on no page",
  // The vestigial `visit` kind. Nothing has written it since 5 September; the
  // enum keeps the value only because dropping one rewrites the table.
  "media.surface.withdrawn": "No longer published",
  "media.panel.used_in": "Used in",
  "media.panel.used_nowhere": "Nothing references this file.",
  "media.panel.replace": "Replace…",
  "media.panel.detach": "Detach from a product…",
  "media.panel.detach_which": "Which product?",
  "media.panel.delete": "Delete…",
  "media.panel.make_primary": "Make primary on {product}",
  "media.panel.shared_note": { one: "One file, {n} product. Replacing or deleting it changes that product, and the preview names it.", other: "One file, {n} products. Replacing or deleting it changes all of them, and the preview names them." },
  "media.panel.replace_note": "Replacing keeps the same address, so every page and quote linking to this file shows the new picture straight away.",

  "media.bulk.scope": { one: "{n} selected in {folder}", other: "{n} selected in {folder}" },
  "media.bulk.attach": "Attach to product",
  "media.bulk.move": "Move to folder",
  "media.bulk.alt": "Add alt text",
  "media.bulk.delete": "Delete…",
  "media.bulk.clear": "Clear",

  "media.delete.title": "Delete {name}?",
  "media.delete.refused": "This file cannot be deleted",
  "media.delete.refused_fix": "Detach it from your products instead. The file stays until the quote is no longer live, and nothing a buyer already has breaks.",
  "media.delete.primary_fix": "Set another picture as the main one first, from the file you want to lead with.",
  "media.delete.refused_body": { one: "A buyer holds quote {quotes}, which links to this file. Deleting it would break a document already sent.", other: "Buyers hold quotes {quotes}, which link to this file. Deleting it would break documents already sent." },
  "media.delete.products": { one: "{n} product loses this file: {names}.", other: "{n} products lose this file: {names}." },
  "media.delete.primary": { one: "{names} loses its main picture and falls back to the next one. Its row in your catalogue will read no photo if it has none.", other: "{names} lose their main picture and fall back to the next one. Their rows in your catalogue will read no photo if they have none." },
  "media.delete.elsewhere": { one: "It also comes off {names}.", other: "It also comes off {names}." },
  "media.delete.nothing": "Nothing references this file, so nothing changes but the file going.",
  "media.delete.confirm": "Delete this file",
  "media.delete.cancel": "Keep it",

  "media.storage_off": "Uploading is not set up in this environment. Run pnpm storage:setup against a Supabase project with a service key.",


  // ── Listing profile, board 3b ─────────────────────────────────────────────
  "listing.title": "Listing profile",
  "listing.eyebrow": "Listing",
  "listing.instant_heading": "Publishes as soon as you save",
  "listing.instant_body": "You are the authority on all of this. Nobody reviews it and there is nothing to wait for.",
  "listing.moderated_heading": "A person checks these first",
  "listing.moderated_body": "The name over your door, what you sell and the licence that says you may. A buyer would be misled if any of the three were wrong, so they wait — usually within four working hours. Your listing keeps saying what it says now until then.",
  "listing.display_name": "Display name",
  "listing.display_name_hint": "What buyers see. Your trade name is on the licence and is changed below.",
  "listing.description": "Description",
  "listing.description_hint": "What you stock and who you supply. {limit} characters.",
  "listing.established": "Established",
  "listing.team_size": "Team size",
  "listing.languages": "Languages spoken",
  "listing.save": "Save",
  "listing.saved": "Saved and live.",
  "listing.trade_name": "Trade name",
  "listing.trade_name_hint": "Exactly as it reads on the trade licence.",
  "listing.primary_category": "Primary category",
  "listing.licence_number": "Licence number",
  "listing.submit_change": "Submit for review",
  "listing.pending": "Waiting for review",
  "listing.pending_since": "Submitted {when}.",
  "listing.pending_change": "You asked to change this to \"{value}\".",
  "listing.withdraw": "Withdraw",
  "listing.withdrawn": "Withdrawn. Nothing changed.",
  "listing.submitted": "Submitted. Your listing is unchanged until it is reviewed.",
  "listing.team.b1_10": "1 to 10",
  "listing.team.b11_50": "11 to 50",
  "listing.team.b51_200": "51 to 200",
  "listing.team.b201_500": "201 to 500",
  "listing.team.b500_plus": "More than 500",

  // ── Board 3b, the editor ──────────────────────────────────────────────────
  // The pill counts held edits only. Saving a description on its own produces
  // no pill: it answers "what is somebody looking at", and the answer is often
  // none. The screen this replaced put "2 edits pending review" over a save
  // where one of the two was already live.
  "listing.in_review_count": {
    one: "{formatted} edit in review",
    other: "{formatted} edits in review",
  },
  "listing.in_review": "In review",
  // A chip the seller has picked and not yet saved. Nobody is looking at it,
  // so it does not claim they are.
  "listing.not_saved": "Not saved",
  // Board 3b Q3. The fourth chip state, and the only one that reports a
  // decision rather than a queue position.
  //
  // "Not added", not "Rejected". The refused thing is the request, and the
  // seller is not: a directory whose only asset is that its numbers are true
  // still has to tell somebody their category was turned down without making
  // it sound like a judgement on them. What it names is the outcome the seller
  // can see for themselves — the category is not on the listing.
  "listing.category_refused": "Not added",
  // The way out of a refusal, on the chip itself. Adding it back is not a
  // second appeal path — it makes an ordinary new request, which is what a
  // seller whose licence has since been amended actually needs.
  "listing.ask_again": "Ask again",
  // "Save changes", not "Save & submit". It saves; some of what it saves is
  // queued, and the chip beside that field says which — the button does not
  // have to carry both behaviours in its name.
  "listing.save_changes": "Save changes",
  "listing.discard": "Discard changes",
  // Criterion 9: it names how many tabs it throws away, because the edits it
  // discards are not all on the tab in front of the seller.
  "listing.discard_confirm": "Discard your unsaved changes across all {formatted} tabs? This cannot be undone.",
  "listing.saved_with_review": {
    one: "Saved. {formatted} change is with our team; everything else is live now.",
    other: "Saved. {formatted} changes are with our team; everything else is live now.",
  },
  "listing.read_only": "You can see this listing but not change it. Ask an owner or a manager to edit it.",
  "listing.tabs": "Listing sections",
  "listing.tab.basics": "Basics",
  "listing.tab.services": "Services",
  "listing.tab.media": "Media",
  "listing.tab.seo": "SEO & slug",
  "listing.tab_empty": "Not built yet. This tab has its own board and nothing here is lost by it being empty — everything on Basics saves as normal.",

  "listing.licence_locked": "· licence-locked",
  "listing.public_url": "Public URL",
  // Slugs are immutable once published (docs/routes.md) and changing one has to
  // write a 301, which is the SEO tab's work. A writable field with no redirect
  // behind it turns every bookmarked address into a 404.
  "listing.public_url_hint": "Changed on the SEO & slug tab, where the redirect from your old address is set up with it.",
  "listing.counter": "{used} / {limit}",
  "listing.over_limit": "That is over the {limit}-character limit. Shorten it and the save will go through.",
  "listing.primary_reviewed": "Reviewed before it changes — it sets which area pages and filters you appear on.",
  "listing.payment_terms": "Payment terms offered",
  "listing.payment_terms_hint": "What you accept, in your own words. Buyers read it on your listing.",

  "listing.also_list_under": "Also list under",
  // What is true, rather than what a tier would buy. The board read
  // "· unlimited on Pro", which sold a plan inside an editor.
  "listing.also_list_meta": {
    one: "· {formatted} added · reviewed before they go live",
    other: "· {formatted} added · reviewed before they go live",
  },
  "listing.add_category": "Add a category",
  "listing.remove_category": "Remove {name}",
  "listing.category_cap": "{cap} additional categories on {plan}. Remove one to add another.",

  "listing.photos": "Storefront photos",
  // Both numbers are queries. The picked count and the library count are
  // different facts, and the sentence only means something with both in it.
  "listing.photos_meta": "· {picked} of the {total} in your media library, shown in this order",
  "listing.photo": "photograph",
  "listing.cover": "Cover",
  "listing.make_cover": "Make cover",
  "listing.remove": "Remove",
  // Criterion 7. The word is "remove", and what it does is take it off the
  // listing — the file stays in the library, and deleting it is the library's
  // action with the blast radius in view.
  "listing.remove_photo": "Remove {name} from your listing",
  "listing.add_photo": "Add {name} to your listing",
  "listing.choose_from_library": "Choose from library",
  "listing.library_empty": "Every photograph you hold is already on your listing.",
  "listing.open_library": "Open the media library",
  "listing.picker_note": "Adding one here puts it on your listing. Removing takes it off and leaves the file in your library.",
  "listing.team_size_none": "Not saying",

  // ── The rail ──
  "listing.preview": "How it will look",
  "listing.preview_device": "Preview width",
  "listing.desktop": "Desktop",
  "listing.mobile": "Mobile",
  "listing.preview_no_description": "No description yet. Buyers see this space empty.",
  "listing.moderation": "Moderation",
  "listing.held_category": "New category: {name} · in review",
  "listing.submitted_sla": "Submitted {when} · two working days",
  // The sentence a seller assumes the opposite of. Without it the reasonable
  // reading is that the whole listing is held while one chip is checked.
  // Two keys rather than a `zero` plural form: `Intl.PluralRules` has no zero
  // category in English, so a `zero:` entry is never selected and the sentence
  // read "its 0 current categories" — which is the commonest case of all, a
  // seller adding their first extra category.
  "listing.stays_live_none": "Your listing stays live on its primary category while this one is checked.",
  "listing.stays_live": {
    one: "Your listing stays live on its primary category and its {formatted} current one while this is checked.",
    other: "Your listing stays live on its primary category and its {formatted} current ones while this is checked.",
  },
  // Board 3b Q3, the rail's half of it. The chip carries the mark because that
  // is where the field is edited; the card carries the words, because a
  // moderator's sentence does not fit in a pill.
  //
  // The canned line goes first and the free text second, and that order is the
  // point. "Not added: we could not match this to your trade licence" reads as
  // a rule with a reason; the sentence on its own reads as one person's
  // opinion on a Tuesday, which is what the seller assumes when a refusal
  // arrives with no frame around it.
  "listing.refused_category": "Not added: {name}",
  "listing.refused_lede": "A moderator looked at this and did not add it. Their reason:",
  // A row decided before the reason became mandatory on decided rows. Saying
  // so beats rendering an empty quote and beats inventing a reason.
  "listing.refused_no_reason": "This was decided before we recorded reasons, so we do not have one to show.",
  "listing.refused_when": "Decided {when}",
  // What to do next, because a refusal with no move left is a dead end. Asking
  // again is a real route — the licence may have been renewed since — and it
  // is the same control the seller already has.
  "listing.refused_next": "Ask again on the chip once the reason no longer applies. It goes back to our team as a new request.",
  "listing.live_now": "Everything else · live now",
  "listing.saved_when": "Saved {when}",
  "listing.never_saved": "Nothing changed yet",
  "listing.moderation_note": "Trade name, licence details and categories are reviewed by our team — they set your badge and where you rank. Everything else publishes the moment you save. If your description breaks a content rule the audit flags it to us afterwards; it does not take your text down.",
  "listing.documents": "Documents",
  "listing.documents_body": "Your trade licence, TRN and uploaded certificates live on the verification page, with the badge they earn.",
  "listing.documents_link": "Verification & documents →",
  "listing.history": "Version history",
  "listing.history_empty": "No changes recorded yet.",
  "listing.history_note": "The three most recent changes. Reviewed edits keep their full record with our team.",
  "listing.revision": "{field} · {author}",
  "listing.revision_counted": "{field} ×{formatted} · {author}",
  "listing.field.description": "Description",
  "listing.field.payment_terms": "Payment terms",
  "listing.field.established_year": "Established",
  "listing.field.team_size": "Team size",
  "listing.field.languages": "Languages",
  "listing.field.photos": "Photos",
  "listing.field.categories_removed": "Categories",
  /* Board 3c writes these two into the same rail. A seller looking at "what
     changed on my listing" means their branches as much as their description. */
  "listing.field.locations": "Locations",
  "listing.field.coverage": "Delivery coverage",
  /* Board 3d writes this one. `ListingRail` resolves the key from the row's
     own `field`, and `t()` throws on a missing key in development — so a
     revision written with no label here takes board 3b's rail down rather than
     rendering a blank. */
  "listing.field.hours": "Opening hours",

  // ── Locations, board 3c ───────────────────────────────────────────────────
  "locations.title": "Locations",
  "locations.eyebrow": "Listing",
  "locations.intro": "Where buyers can reach you. Each branch carries its own address, phone and trading hours.",
  "locations.none": "No branches yet",
  "locations.none_body": "Add the address buyers should come to. A listing with no address is a listing a buyer cannot visit.",
  "locations.add": "Add a branch",
  "locations.edit": "Edit",
  "locations.done": "Done",
  "locations.type": "What this branch is",
  "locations.type.head_office": "Head office",
  "locations.type.warehouse": "Warehouse",
  "locations.type.trade_counter": "Trade counter",
  "locations.type.depot": "Depot",
  "locations.type.sales_office": "Sales office",
  "locations.type.workshop": "Workshop",
  "locations.where": "Where it is",
  "locations.emirate": "Emirate",
  "locations.area": "Area",
  "locations.emirate_placeholder": "Choose an emirate",
  "locations.area_placeholder": "Choose an area",
  "locations.no_areas": "No areas match",
  "locations.search_areas": "Search areas",
  "locations.free_zone_filter": "Only show free zones",
  "locations.free_zone_tag": "Free zone",
  "locations.free_zone_note": "{area} is a free zone inside {emirate}. Buyers looking in {emirate} find you, and buyers looking for free-zone suppliers find you too.",
  "locations.address": "Address",
  "locations.address_hint": "Building, street and the landmark you give drivers.",
  "locations.phone": "Phone",
  "locations.whatsapp": "WhatsApp",
  "locations.radius": "Delivery radius in km",
  "locations.radius_hint": "How far you deliver from this branch. Leave blank if you do not deliver.",
  "locations.published": "Show this branch to buyers",
  "locations.pin_hint": "Drag the pin to your gate, not the street. A driver following the street pin arrives at the wrong side of the compound.",
  "locations.save": "Save this branch",
  "locations.saved": "Saved and live.",
  "locations.delete": "Delete this branch",
  "locations.confirm_delete": "Delete this branch? Buyers will stop seeing it. This cannot be undone.",
  "locations.at_cap": "{plan} includes {cap} location. Move to {next} to add more.",
  "locations.at_cap_plural": "{plan} includes {cap} locations. Move to {next} to add more.",
  "locations.at_cap_fix": "Move to {next}, or delete a branch you no longer trade from.",

  /* ── Board 3c · the locations manager ───────────────────────────────────── */

  /*
     One count, two facts, and they reconcile with the table and the map.

     The board read `4 branches` over five rows while its map counted
     `4 PINS · 1 MISSING` — four pins *of* five branches. Both numbers were
     defensible and neither said which arithmetic it was doing.
  */
  "locations.count": {
    one: "{total} branch · {shown} shown to buyers",
    other: "{total} branches · {shown} shown to buyers",
  },
  "locations.add_branch": "Add branch",

  "locations.col.branch": "Branch",
  "locations.col.type": "Type",
  "locations.col.area": "Area",
  "locations.col.pin": "Pin",
  "locations.col.status": "Status",
  "locations.table_caption": "Your branches, their pins and who can see them",
  "locations.select_all": "Select every branch",
  "locations.select_row": "Select {branch}",

  "locations.status.published": "Published",
  "locations.status.hidden": "Hidden",
  "locations.status.draft": "Draft",

  "locations.pin.exact": "Exact",
  "locations.pin.approximate": "Approx",
  "locations.pin.missing": "Missing",

  /* The two sentences the board never wrote, and the reason it needed them. */
  "locations.consequence_status": "Published branches appear on your storefront and in map search. Hidden ones stay on your account, but buyers never see them and RFQs never route to them.",
  "locations.consequence_pin": "Only an exact pin enters distance sort. An approximate one still appears on its area page, so a buyer browsing that area finds you — a buyer sorting by distance does not.",
  /* Two sentences rather than one with a link inside it. A sentence stitched
     together around an interpolated element is a sentence a translator cannot
     reorder, and Arabic is a later translation project rather than a rebuild. */
  "locations.hours_pointer": "Opening hours are set per branch, not here.",
  "locations.hours_link": "Set opening hours",

  "locations.coverage.title": "Delivery and service coverage",
  "locations.coverage.note": "Coverage decides which RFQs reach you, and which buyers see your delivery promise. Areas come from the same list buyers filter on — a typed area would never match one.",
  "locations.coverage.add": "Add area",
  "locations.coverage.none": "You have not said where you deliver. Suppliers with no coverage are matched on their branch emirate alone.",
  "locations.coverage.remove": "Remove {scope}",
  "locations.coverage.chip": "{scope} · {promise}",
  "locations.coverage.whole_emirate": "{emirate}, everywhere",
  "locations.coverage.in_emirate": "{area}, {emirate}",
  "locations.coverage.scope_label": "Where you deliver",
  "locations.coverage.promise_label": "How soon",
  "locations.coverage.emirate_option": "{emirate} — everywhere",
  /* Split in two because `Alert` refuses a "bad" notice with no way out —
     design-system §05.1. The statement is the notice; the sentence after it is
     the `fix`, and the component renders them as separate lines. */
  "locations.coverage.already": "You already have a promise for that area.",
  "locations.coverage.already_fix": "Remove the chip to change its delivery time.",
  "locations.coverage.unknown_area": "That area is not one buyers can filter on.",
  "locations.coverage.unknown_area_fix": "Pick an area from the list.",
  "locations.coverage.bad_lead_time": "That is not a delivery time this screen offers.",
  "locations.coverage.bad_lead_time_fix": "Choose one of the times in the list.",
  "locations.coverage.redundant": "Your {emirate} promise already covers this at the same speed.",

  "locations.lead.0": "Same day",
  "locations.lead.24": "24 hours",
  "locations.lead.48": "48 hours",
  "locations.lead.72": "72 hours",
  "locations.lead.168": "Within a week",
  "locations.lead.other": "{hours} hours",

  "locations.issues.title": "Pins to fix",
  "locations.issues.missing": "{branch} has no pin. Unpinned branches do not appear in map search at all.",
  "locations.issues.approximate": "{branch} sits on the area, not the address. Buyers browsing {area} still find it. Distance sort skips it until you drop an exact pin.",
  "locations.issues.fix": "Fix",

  "locations.map.label": "Map of your branches",
  "locations.map.overlay": "{pinned} pinned · {missing} missing",
  "locations.map.all_pinned": "{pinned} pinned",
  "locations.map.empty": "No branch carries a pin yet. Drop one and it appears here.",

  "locations.publish": "Publish",
  "locations.hide": "Hide",
  "locations.hide_confirm_title": {
    one: "Hide {count} branch?",
    other: "Hide {count} branches?",
  },
  /* Board 3c Q4: say it at the moment of hiding, not afterwards. */
  "locations.hide_areas": {
    one: "This is your only published branch in {areas}. Hiding it takes your listing off that area page.",
    other: "These are your only published branches in {areas}. Hiding them takes your listing off those area pages.",
  },
  "locations.hide_last": "This is your last published branch. Hiding it leaves your listing with no address buyers can reach.",
  "locations.hide_nothing_else": "Buyers stop seeing it and RFQs stop routing to it. Nothing else changes, and you can publish it again.",
  "locations.hide_do_it": "Hide",
  "locations.cancel": "Cancel",
  "locations.selected": {
    one: "{count} branch selected",
    other: "{count} branches selected",
  },
  "locations.clear_selection": "Clear",

  "locations.delete_last_published": "This is your last published branch, and a published listing with no address is one a buyer cannot reach.",
  "locations.delete_last_published_fix": "Hide it instead, or publish another branch first.",
  "locations.pin_outside_uae": "That pin is outside the UAE.",
  "locations.pin_outside_uae_fix": "Drag it back onto the map.",
  "locations.not_found": "That branch is no longer on your account.",
  "locations.not_found_fix": "Reload the page to see what is there now.",
  "locations.needs_area": "This branch has no area.",
  "locations.needs_area_fix": "Choose the emirate and then the area buyers would filter on.",
  "locations.needs_address": "This branch has no address.",
  "locations.needs_address_fix": "Give the building, street and the landmark you tell drivers.",
  "locations.staff_read_only": "You are viewing this account. Locations are edited by the supplier.",
  /* The row action, when the seat cannot write. A button labelled `Edit` that
     opens a form with every field disabled is a small lie, and this screen is
     read-only for three seats: staff viewing-as, sales and finance. */
  "locations.view": "View",

  // ── Hours, board 3d ───────────────────────────────────────────────────────
  "hours.title": "Hours & Ramadan",
  "hours.eyebrow": "Listing",
  "hours.intro": "When each branch is open. Split shifts are normal — most trade counters shut for the afternoon and open again.",
  "hours.branch": "Branch",
  "hours.week": "Trading hours",
  "hours.open": "Opens",
  "hours.close": "Closes",
  "hours.closed": "Closed",
  "hours.add_shift": "Add a second shift",
  "hours.remove_shift": "Remove this shift",
  "hours.copy_all": "Use these hours at every branch",
  "hours.copied": "Applied to {count} branches.",
  "hours.public_holidays": "On public holidays",
  "hours.public.closed": "Closed",
  "hours.public.reduced": "Reduced hours",
  "hours.public.normal": "Open as usual",
  "hours.ramadan": "Ramadan hours",
  "hours.ramadan_hint": "Applied automatically for the month and reverted afterwards, so there is nothing to remember.",
  "hours.ramadan_window": "This year, about {from} to {to} — the exact dates follow the moon sighting.",
  "hours.ramadan_active": "In effect now",
  "hours.ramadan_toggle": "Keep different hours during Ramadan",
  "hours.save": "Save hours",
  "hours.saved": "Saved and live.",
  "hours.no_branches": "Add a branch before setting hours.",
  "hours.problem.bad_time": "\"{value}\" is not a time. Use 24-hour times like 08:00 and 17:30.",
  "hours.problem.backwards": "{open} to {close} closes before it opens. If you trade past midnight, enter two shifts.",
  "hours.problem.overlap": "{first} and {second} overlap. Shifts cannot run over each other.",

  /* ── Board 3d · hours, holidays and Ramadan ─────────────────────────────── */

  /*
     Correction 5: a branch picker, a copy button and a Save in one 58px header
     with nothing saying which branch was being written.
  */
  "hours.scope": "Hours below apply to this branch",
  "hours.branch_picker": "Which branch",
  "hours.hidden_branch": "{branch} — hidden",
  "hours.standard_week": "Standard week",
  "hours.timezone": "Gulf Standard Time · UTC+4",
  "hours.jumuah_note": "Jumu'ah break {from} – {to}",

  "hours.copy_to": {
    one: "Copy to {count} other branch…",
    other: "Copy to {count} other branches…",
  },
  "hours.copy_title": {
    one: "Copy these hours to {count} branch?",
    other: "Copy these hours to {count} branches?",
  },
  "hours.copy_body": {
    one: "{count} branch keeps different hours today. Copying replaces them.",
    other: "{count} branches keep different hours today. Copying replaces them.",
  },
  "hours.copy_none": "Every other branch already keeps these hours. Nothing would change.",
  "hours.copy_unchanged": "Already the same",
  "hours.copy_confirm": "Copy",
  "hours.copy_ramadan_note": "Ramadan hours travel too, but the confirmation does not — each branch is confirmed on its own.",
  "hours.copied_to": {
    one: "Copied to {count} branch.",
    other: "Copied to {count} branches.",
  },

  /*
     Correction 1. The dates are ours and the hours are theirs, and the board
     collapsed both into one `AUTO-APPLIED` label — while board 3a's card told
     the same seller their 2027 hours were unconfirmed and linked here.
  */
  "hours.ramadan_estimated": "Estimated · {from} – {to}",
  "hours.ramadan_confirmed": "Confirmed · {from} – {to}",
  "hours.ramadan_group_weekdays": "Mon – Thu",
  "hours.ramadan_group_weekend": "Fri – Sat",
  "hours.ramadan_carried": "These times carried over from {year}.",
  "hours.ramadan_carried_fix": "Confirm them and buyers stop seeing last year's Ramadan hours.",
  "hours.ramadan_confirm": "Confirm",
  "hours.ramadan_confirmed_note": "Confirmed for {year}. Nothing else to do.",
  "hours.ramadan_dates_promise": "The dates are ours to get right: they follow the official UAE announcement, usually confirmed a day or two before. We shift them and email you when they move.",
  "hours.ramadan_off": "The standard week runs through Ramadan.",

  "hours.holidays_title": "Public holidays {years}",
  "hours.holidays_add": "Add date",
  "hours.holiday_closed": "Closed",
  "hours.holiday_half": "Half day",
  "hours.holiday_half_hours": "{from} – {to}",
  "hours.holiday_also_ramadan": "{date} also Ramadan · closed wins",
  /* Correction 2, stated once in the footer and again on the row where the
     collision actually is. */
  "hours.precedence": "A holiday closure beats Ramadan hours, which beat the standard week. A closure you schedule beats all three.",
  "hours.holiday_ownership": "Official UAE dates are kept current for you. Dates you add are yours to maintain.",
  "hours.holiday_yours": "Yours",
  "hours.holiday_remove": "Remove {name}",
  "hours.holiday_estimated": "Estimated",

  "hours.add_date_title": "Add a date",
  "hours.add_date_name": "What is it",
  "hours.add_date_name_hint": "Annual stock-take, warehouse move",
  "hours.add_date_from": "First day",
  "hours.add_date_to": "Last day",
  "hours.add_date_half": "Open for part of the day",
  "hours.add_date_save": "Add date",

  "hours.closure_eyebrow": "Temporary closure",
  "hours.closure_body": "Shutting for stock-take, or shifting to a new warehouse? Set a date range and buyers see a notice instead of a wrong \"open now\".",
  "hours.closure_schedule": "Schedule a closure",
  "hours.closure_reason": "Why",
  "hours.closure_reason_hint": "Buyers read this, so say when you are back.",
  "hours.closure_active": "Closed {from} – {until}. Buyers see this instead of your hours.",
  "hours.closure_clear": "End this closure",
  "hours.closure_note": "A closure shows a notice. It does not stop RFQs — hide the branch on Locations to do that.",

  "hours.why_title": "Why this matters more than it looks",
  "hours.why_body": "\"Open now\" is the third most-used filter on the site. Listings with wrong hours get complaints, and complaints affect your response score.",

  "hours.cancel": "Cancel",
  "hours.not_found": "That branch is no longer on your account.",
  "hours.not_found_fix": "Reload the page to see what is there now.",
  "hours.no_reason": "This date needs a reason.",
  "hours.no_reason_fix": "Say what it is — buyers read it on your branches page.",
  "hours.backwards": "That range ends before it starts.",
  "hours.backwards_fix": "Set the last day on or after the first.",
  "hours.half_day_needs_hours": "A half day needs both times.",
  "hours.half_day_needs_hours_fix": "Give the opening and closing time, or leave it as a full closure.",
  "hours.read_only": "You are viewing this account. Hours are set by the supplier.",

  /*
     Service-layer refusals, which were raw English literals until board 3d.

     `check:tokens` reads JSX and metadata titles, so a string returned from a
     module under `lib/` reaches a seller's screen without passing any scan —
     six of them had. Non-negotiable 5 is that every user-visible string goes
     through `t()` even while English is the only locale, and a refusal a seller
     reads is as user-visible as a label.
  */
  "listing.not_your_listing": "You can only edit your own listing.",
  "listing.branch_not_found": "That branch cannot be found.",
  "listing.request_not_found": "That request cannot be found.",
  "listing.needs_display_name": "Give your listing a display name buyers will recognise.",
  "listing.bad_established_year": "Enter the year the business was established, as four digits.",
  "listing.bad_team_size": "Choose a team size from the list.",
  "listing.needs_a_value": "Enter the new value before submitting it.",
  "listing.unchanged": "That is what it says now. Nothing has been submitted.",
  "listing.already_in_category": "Your listing is already under that category.",
  "listing.category_already_queued": "That category is already waiting for review.",
  "listing.description_too_long": "That description is {length} characters. The limit is {limit}.",

  // ── Verification, board 3e ────────────────────────────────────────────────
  "verify_listing.title": "Verification",
  "verify_listing.eyebrow": "Listing",
  "verify_listing.staff_only": "Your tier is set by our team after checking. Nothing on this page changes it.",

  // ── Header ──
  // "Next licence check due" described a check nobody performs. Nothing is
  // re-checked on a schedule; the licence expires and the expiry job acts. One
  // implies the platform is watching, the other says what actually happens.
  "verify_listing.checked_on": "Checked against {authority} on {when}",
  "verify_listing.never_checked": "Nothing checked yet",
  "verify_listing.expires_label": "Licence expires",
  "verify_listing.expires_days": { one: "{when} · {formatted} day", other: "{when} · {formatted} days" },
  "verify_listing.expired_on": "Expired {when}",

  // ── The ladder ──
  "verify_listing.ladder": "Your verification",
  "verify_listing.ladder_lede": {
    one: "{formatted} tier is achievable today",
    other: "{formatted} tiers are achievable today",
  },
  "verify_listing.current": "You are at tier {tier}",
  "verify_listing.reached": "Reached",
  "verify_listing.top_tier": "Top tier",
  "verify_listing.rung": "Tier {tier} · {label}",
  // The sentence the board never said. Written out because "expires with your
  // licence" on its own leaves a seller to guess what expiring costs.
  "verify_listing.ladder_note": "Tier 2 is the top tier, and it expires with your licence. On {when} you drop to tier 1 — claimed — until a renewal is uploaded and checked. Nothing is deleted and your listing stays live.",
  "verify_listing.ladder_note_below": "Tier 2 is the top tier. It needs your trade licence checked against the issuing authority — upload it below and we will do that, usually within four working hours. Once you are there, the tier expires with the licence and returns when a renewal is checked.",
  "verify_listing.ladder_note_lapsed": "Your licence expired on {when}, so you are at tier 1 — claimed. Upload a renewal and the tier returns as soon as we have checked it. Nothing was deleted and your listing is still live.",

  // ── Verified by us ──
  "verify_listing.checked_title": "Verified by us",
  "verify_listing.checked_hint": "These two set your tier. Checked against the issuing authority.",
  "verify_listing.checked_caption": "The documents we have checked against the issuing authority",
  "verify_listing.col_document": "Document",
  "verify_listing.col_number": "Number",
  "verify_listing.col_expires": "Expires",
  "verify_listing.col_state": "State",
  "verify_listing.col_who": "Who sees it",
  "verify_listing.row_licence": "Trade licence · {authority}",
  "verify_listing.row_trn": "VAT / TRN certificate",
  "verify_listing.no_expiry": "No expiry",
  "verify_listing.state_checked": "Checked {when}",
  "verify_listing.state_unchecked": "Not checked yet",
  // The badge is platform output, not a seller preference — which is why this
  // column states that it cannot be changed rather than offering a control
  // that would be refused.
  "verify_listing.who_badge_only": "Badge only · you cannot change this",
  "verify_listing.who_badge_masked": "Badge only · number never shown",

  // ── Uploaded by you ──
  "verify_listing.uploaded_title": "Uploaded by you",
  "verify_listing.uploaded_hint": "We hold these and show the name and expiry month. We do not check them, so they carry no badge.",
  "verify_listing.uploaded_caption": "Certificates and approvals you have uploaded",
  "verify_listing.uploaded_empty": "Nothing uploaded yet. Certificates and approvals put you in the filters buyers use — they never change your tier.",
  "verify_listing.state_on_file": "On file",
  "verify_listing.state_expiring": { one: "Expiring · {formatted} day", other: "Expiring · {formatted} days" },
  "verify_listing.state_in_review": "In review · {days} working days",
  "verify_listing.state_lapsed": "Lapsed",
  "verify_listing.who_public": "Public · name and month",
  "verify_listing.who_hidden": "Hidden",
  "verify_listing.who_in_review": "Hidden while in review",
  // The consequence, stated where the table ends. A credential is a filter, and
  // nothing else — the board's version implied a lapse cost you standing
  // generally, and it costs you one filter.
  "verify_listing.uploaded_footer": "A credential here puts you in the filters buyers use — it never changes your tier or your badge. Reviewed by our moderation queue, {days} working days.",
  "verify_listing.review_reason": "We could not publish this: {reason}",

  // ── Visibility, the seller's own choice ──
  "verify_listing.visibility": "Who sees {name}",
  "verify_listing.make_public": "Show on my listing",
  "verify_listing.make_hidden": "Hide from my listing",
  "verify_listing.withdraw": "Withdraw the request",
  "verify_listing.public_hint": "We show the name and the expiry month. The file itself is never published or linked.",

  // ── The rail: when your licence expires ──
  "verify_listing.expiry_title": "When your licence expires",
  "verify_listing.expiry_now": { one: "{formatted} day", other: "{formatted} days" },
  "verify_listing.expiry_60": "{days} days",
  "verify_listing.expiry_60_body": "Email, and a banner on your dashboard.",
  "verify_listing.expiry_14": "{days} days",
  "verify_listing.expiry_14_body": "The banner stays and the licence row turns amber.",
  "verify_listing.expiry_0": "The day it lapses",
  "verify_listing.expiry_0_body": "Your tier drops to 1 · claimed. The licence-verified badge comes off your listing and you stop matching the licence-verified filter.",
  // Load-bearing rather than decorative. A lapse withdraws a claim; it does not
  // destroy a record — the same position as 3f's cap and 3i's refused delete.
  "verify_listing.expiry_0_body_unverified": "Nothing changes on your listing, because the licence-verified badge is not on it yet. A current licence is what tier 2 needs, so an expired one closes that route until a renewal is checked.",
  "verify_listing.expiry_reassurance": "Upload a renewal and the tier returns as soon as it is checked. Your listing, products and enquiries are never touched by an expiry.",

  // ── The rail: action needed ──
  "verify_listing.action_title": "Action needed",
  "verify_listing.action_licence": "Your trade licence expires in {days} days. On the day it lapses your listing loses the licence-verified badge and stops matching the licence-verified filter.",
  "verify_listing.action_licence_lapsed": "Your trade licence expired on {when}. Your listing has dropped to tier 1 and lost the licence-verified badge.",
  "verify_listing.action_credential": "Your {name} expires in {days} days. Buyers filtering for it stop seeing you the day it lapses. Your tier and badge are unaffected.",
  "verify_listing.action_credential_lapsed": "Your {name} expired on {when}. Buyers filtering for it no longer see you. Your tier and badge are unaffected.",
  "verify_listing.upload_renewal": "Upload renewal",
  "verify_listing.action_none": "Nothing needs your attention. Your licence has {days} days to run and no certificate is inside its notice window.",

  // ── The rail: what buyers see ──
  "verify_listing.buyers_title": "What buyers see",
  "verify_listing.buyers_badge": "The licence-verified badge, and the date we checked it",
  "verify_listing.buyers_certs": "Certificate names and expiry months",
  "verify_listing.buyers_no_files": "Never the document files themselves",
  "verify_listing.buyers_no_trn": "Never your full TRN or licence scan",
  "verify_listing.buyers_shown": "Shown",
  "verify_listing.buyers_never": "Never shown",

  // ── Upload ──
  "verify_listing.documents": "Documents",
  "verify_listing.documents_hint": "Your trade licence and VAT certificate are only ever seen by our team. They are never on your public listing and never linked from it. Certificates, catalogues and datasheets can be shown on your storefront if you choose.",
  "verify_listing.upload": "Upload a document",
  "verify_listing.upload_hint": "PDF, JPEG or PNG, up to 16 MB.",
  "verify_listing.kind": "What this is",
  // The three fields the `Uploaded by you` table has columns for. Asked at
  // upload, because the name is also what `document_public_has_a_name`
  // requires before a row can be published — discovering that at the moment a
  // seller tries to publish would be a refusal with nothing to do about it.
  "verify_listing.field_name": "What buyers should call it",
  "verify_listing.field_name_hint": "ISO 9001:2015",
  "verify_listing.field_reference": "Certificate number",
  "verify_listing.field_valid_until": "Valid until",
  "verify_listing.name_required": "Give the certificate the name a buyer would recognise — \u201cISO 9001:2015\u201d, not the file name. It is what your listing shows.",
  "verify_listing.kind.trade_licence": "Trade licence",
  "verify_listing.kind.vat_certificate": "VAT certificate",
  "verify_listing.kind.certificate": "Certificate or approval",
  "verify_listing.kind.catalogue": "Catalogue",
  "verify_listing.kind.datasheet": "Datasheet",
  "verify_listing.no_documents": "No documents uploaded yet",
  "verify_listing.uploaded": "Uploaded {when}",
  "verify_listing.delete_document": "Delete",
  "verify_listing.confirm_delete": "Delete this document? This cannot be undone.",
  // A document we have checked backs the tier, so the seller cannot remove it
  // from under their own badge. Board 3e open question 5, one class over: a
  // lapsed document is kept because the tier history has to stay auditable.
  "verify_listing.cannot_delete": "A trade licence or VAT certificate we have checked stays on file — it is the evidence behind your tier. Upload a renewal to replace it.",
  "verify_listing.licence_expired": "Your trade licence expired on {when}, so your listing is at tier 1 and no longer carries the licence-verified badge.",
  "verify_listing.licence_expired_fix": "Upload the renewed licence below and we will check it, usually within four working hours.",


  // ── Plans, shared by 1l, 2e and 11f ───────────────────────────────────────
  "plan.free": "Free",
  "plan.recommended": "Recommended",
  "plan.current": "Your plan",
  "plan.period": "a month",
  "plan.enquiries": "{n} enquiries a month to answer",
  "plan.enquiries_unlimited": "Unlimited enquiries",
  "plan.products": "{n} products",
  "plan.products_unlimited": "Unlimited products",
  "plan.locations": "{n} locations",
  "plan.locations_unlimited": "Unlimited locations",
  "plan.location_one": "1 location",
  "plan.photos": "{n} photographs",
  "plan.seats": "{n} team seats",
  "plan.seat_one": "1 seat",
  "plan.ranking": "Ranked {multiplier}× in search",
  "plan.ranking_none": "A lift in search ranking",
  "plan.custom_domain": "Your own web address",
  // Three is the ratified Free allowance as of D1, so this sentence is true
  // rather than a leftover — and it is checked by the seed and the migration
  // that write `enquiries_per_month = 3`.
  "plan.summary.free": "Be listed, and answer three enquiries a month.",
  "plan.summary.basic": "For a supplier answering enquiries most weeks.",
  "plan.summary.pro": "For a supplier whose catalogue is how they get found.",

  // ── Pricing, board 1l. The public page; the plan words above are shared. ──
  "pricing.seo_title": "Pricing — list free, or from AED {from} a month",
  "pricing.seo_description":
    "A free listing that does not expire, and paid plans from AED {from} a month. No setup fee, no commission, no pay-per-lead.",
  // What the title says when nothing paid is on sale. Not a state anybody plans
  // for, and "from AED 0 a month" is what the other one would have said.
  "pricing.seo_title_free": "Pricing — list your UAE business free",
  "pricing.seo_description_free":
    "A free listing that does not expire. No setup fee, no commission, no pay-per-lead.",
  "pricing.eyebrow": "Plans",
  "pricing.title": "Listing is free. Being found first is the paid part.",
  "pricing.lede":
    "No setup fee, no commission, no pay-per-lead. A flat monthly fee, and every enquiry that comes in is yours.",
  "pricing.breadcrumb": "Pricing",

  "pricing.period_label": "How you pay",
  "pricing.period_monthly": "Monthly",
  "pricing.period_annual": "Annual",
  "pricing.period_saving": "−{months} months",
  "pricing.per_month": "a month",
  "pricing.per_year": "a year",
  // No discount figure here. It is a column now, and two tiers can carry
  // different ones — so each card states its own saving and this line says only
  // what is true of every plan.
  "pricing.annual_explained": "{months} months, charged once a year.",

  "pricing.plans_heading": "The three plans",
  "pricing.free_is_permanent":
    "Free is a plan, not a trial. It does not expire, there is nothing to renew, and nothing on it stops working.",

  "pricing.cta.claim": "Claim your listing",
  "pricing.cta.start": "Start on {plan}",
  "pricing.cta.current": "Your plan",
  "pricing.cta.upgrade": "Upgrade to {plan}",
  "pricing.cta.downgrade": "Downgrade to {plan}",

  "pricing.table.heading": "What else is different",
  "pricing.table.caption":
    "What each plan changes beyond its limits, with the plans as columns",
  "pricing.table.feature": "What a plan changes",
  "pricing.row.ranking": "Search ranking weight",
  "pricing.row.ranking_note":
    "On the plan-tier component of the ranking only, which is {points} of {total} points. The other {others} are relevance, verification tier, response time, spec completeness and distance, and no plan changes any of them.",
  "pricing.row.custom_domain": "Your own web address",
  /*
     Was "an address you own". It is an address we give, and the difference is
     the whole of what changed on 9 Sep 2026: no domain to buy, no records to
     add, nothing to wait for. Naming the shape — a label under our own domain —
     is what stops a Pro seller expecting to point yourcompany.ae at us.
  */
  "pricing.row.custom_domain_note":
    "yourcompany.businesslistings.me, live the moment you take it. Nothing to buy and nothing to set up. Your directory address keeps working and keeps its search ranking.",
  "pricing.cell.multiplier": "{multiplier}×",
  "pricing.cell.included": "Included",
  "pricing.cell.absent": "Not included",
  "pricing.cell.absent_label": "Not included on {plan}",

  "pricing.same_heading": "The same on every plan",
  "pricing.same.response_time":
    "How fast you reply is measured from your own enquiry timestamps. There is no field to fill in and no plan that changes it.",
  "pricing.same.import": "Bulk product import reads up to {rows} rows from a CSV or an Excel file.",
  "pricing.same.placement":
    "A sponsored slot is one per subcategory and emirate, taken at its own monthly price. No plan includes one, and it never goes above a verified supplier on a filter the buyer set.",
  "pricing.same.commission":
    "Nothing is taken from what a buyer pays you. There is no commission, no per-lead charge and no take rate, because there is no mechanism for one — buyers pay suppliers directly and the platform is never party to it.",

  // ── Billing, boards 3m and 11f ────────────────────────────────────────────
  "billing.title": "Subscription",
  "billing.eyebrow": "Account",
  "billing.on_plan": "You are on {plan}",
  "billing.renews": "Renews {when}",
  // The term beside the date. An annual seller reading only a date a year out
  // has to work out from the distance how they are paying.
  "billing.renews_monthly": "Billed monthly. Next payment {when}.",
  "billing.renews_annual": "Billed yearly. Next payment {when}.",
  "billing.ending": "Ending on {when}. Your listing stays live on Free after that.",
  "billing.free_forever": "Free is a plan, not a trial. Nothing expires.",
  "billing.change": "Change plan",
  "billing.cancel": "Cancel subscription",
  "billing.invoices": "Invoices",
  "billing.no_invoices": "No invoices yet",
  "billing.invoice_caption": "Your invoices, most recent first",
  "billing.col.ref": "Reference",
  "billing.col.issued": "Issued",
  "billing.col.amount": "Amount",
  "billing.col.status": "Status",
  "billing.status.draft": "Draft",
  "billing.status.issued": "Issued",
  "billing.status.paid": "Paid",
  "billing.status.overdue": "Overdue",
  "billing.status.void": "Void",
  "billing.status.active": "Active",
  // The plan card still reads Active while a cancellation is scheduled, because
  // it is. This is the badge for the period after the seller has said so.
  "billing.status.ending_badge": "Ending",
  "billing.vat": "VAT at {rate}",
  // The issuing entity, not its TRN. Bearing Deployment Company is incorporated
  // in Delaware and is not registered in the UAE, so it has none — and printing
  // one it does not hold on a screen that lists tax invoices is the worst place
  // to be wrong. Board 11g restated the entity; this line followed it.
  "billing.issued_by": "Invoices are issued by {name}.",
  "billing.your_trn": "Your TRN {trn}",
  "billing.no_trn": "Add your TRN on the listing profile and it will appear on future invoices.",
  "billing.not_live": "No card has been charged. Payment is not connected in this environment.",

  "change.title": "Change plan",
  // "your month" was true while every subscription was monthly. A seller
  // halfway through a paid year is prorated over the days left in that year.
  "change.intro": "Pick a plan. What it costs today is worked out from the days left in the period you have paid for, and shown before anything is charged.",
  "change.choose": "Move to {plan}",
  "change.staying": "You are on this plan",
  "change.quote_heading": "What changes today",
  "change.credit_line": "{plan}, {days} unused days",
  "change.charge_line": "{plan}, {days} days",
  "change.net_charge": "To pay today",
  "change.net_credit": "Credited to your next invoice",
  "change.renews_unchanged": "Your renewal date does not move. It stays {when}.",
  "change.term_heading": "How you pay",
  // No discount figure. It is a column per plan now, and this control sits
  // above all three — naming one plan's saving here is the drift the pricing
  // page just took out of its own copy.
  /*
     Board 11f's follow-up audit. The columns compare, the rail charges, and
     until this string they could show two different prices for one plan with
     nothing between them saying which was which.

     `change.term_note` sat here orphaned — written for the toggle in general and
     wired to nothing. It is gone rather than pressed into service to look busy:
     it says the plan is the same either way, which is true and is not the thing
     a seller reading two prices needs to be told.
  */
  "change.term_mismatch.monthly": "Quoted monthly, because that is how your subscription is paid. The annual prices above are a comparison.",
  "change.term_mismatch.annual": "Quoted annually, because that is how your subscription is paid. The monthly prices above are a comparison.",
  "change.term_mismatch_link.monthly": "Switch to monthly instead",
  "change.term_mismatch_link.annual": "Switch to annual instead",
  "change.renews_moved": "A new period starts today. Your next payment is {when}.",
  "change.confirm": "Confirm the change",
  "change.back": "Back to subscription",
  "change.done": "You are on {plan}.",

  // ── Boards 11h + 11j · cancel subscription ────────────────────────────────
  //
  // Two routes, one flow, and one rule underneath both: **nothing is taken away
  // on the day the seller cancels.** The period that was paid for runs to its
  // end and is neither shortened nor paid back; Free starts the morning after.
  // So every consequence here is dated, and every date on both screens derives
  // from one value — the renewal moment. There is no literal date in this file.
  //
  // The `ON FREE` column is the same: no cap is written down. Every figure
  // comes through `capFor` from the plan-limit config, which is what makes
  // `2e`, `1l`, `3m`, `11f` and this screen able to disagree about nothing.
  // This is the only one of the five where a seller acts on the numbers
  // irreversibly, which is why the placeholders had to be resolved first.
  //
  // The old single-step form's strings are gone, and two of them are why: the
  // free-tier caps were spelled out in a sentence — "3 enquiries a month, 10
  // products, 1 location and 2 seats" — and the seat figure was wrong as well
  // as hardcoded. `11f`'s Free column says one seat.

  "cancel.title": "Cancel subscription",
  "cancel.steps_label": "Cancelling your subscription",
  "cancel.step.changes": "What changes",
  "cancel.step.reason": "Reason & confirm",
  "cancel.back.billing": "Billing",
  "cancel.back.changes": "What changes",

  // The table. A real one — `<table>`, `<thead>`, `<th scope>`.
  "cancel.table_caption": "What changes if you cancel, area by area",
  "cancel.table_scroll": "What changes — scroll sideways for the whole table",
  "cancel.col.mark": "Change",
  "cancel.col.area": "Area",
  "cancel.col.now": "On {plan} now",
  "cancel.col.free": "On Free from {when}",

  // The legend is part of the table. Three colours with no key made colour the
  // only carrier of the table's meaning; these are the shapes' names, and they
  // are also each row's accessible text.
  "cancel.legend_label": "What the marks mean",
  "cancel.mark.unchanged": "Unchanged",
  "cancel.mark.reduced": "Reduced — the rest is stored, not deleted",
  "cancel.mark.ends": "Ends",

  "cancel.row.listing": "Listing & badge",
  "cancel.row.products": "Products",
  "cancel.row.branches": "Branches",
  "cancel.row.seats": "Team seats",
  "cancel.row.storage": "Storage",
  "cancel.row.enquiries": "Enquiries",
  "cancel.row.csv_import": "CSV import",
  "cancel.row.custom_domain": "Custom domain",
  "cancel.row.sponsored": "Sponsored placement",
  "cancel.row.analytics": "Analytics",
  "cancel.row.reviews": "Reviews & replies",
  "cancel.row.invoices": "Invoices & documents",

  "cancel.now.listing": "Live",
  "cancel.now.listing_verified": "Live · Licence verified",
  "cancel.now.products": "{used} live",
  "cancel.now.branches": "{used} published",
  "cancel.now.seats": "{used} with access",
  "cancel.now.storage": "{used} used",
  "cancel.now.storage_none": "Nothing stored",
  "cancel.now.enquiries_unlimited": "Unlimited · {last} last month",
  "cancel.now.enquiries": "{cap} a month · {last} last month",
  "cancel.now.csv_import": "Available",
  "cancel.now.csv_import_used": "Available · last used {when}",
  "cancel.now.custom_domain_none": "Not in use",
  "cancel.now.sponsored": "Top slot · {what}",
  "cancel.now.sponsored_none": "None booked",
  "cancel.now.analytics": "Full history",
  "cancel.now.reviews": "{count} reviews, full history",
  "cancel.now.reviews_none": "None yet",
  "cancel.now.invoices": "All available",

  // The badge follows the licence, not the plan. First row, because it is the
  // question sellers actually ask.
  "cancel.free.listing": "Unchanged — your listing stays in the directory",
  "cancel.free.listing_verified": "Unchanged — the badge follows your licence, not your plan",
  "cancel.free.holds_all": "Unchanged",
  // The verb agrees with Free, which is always one thing, rather than with the
  // number — which is the seller's and changes. The board drew `1 stays
  // published` and `2 keeps access` against its own figures, and both are wrong
  // at any other cap: this screen renders whatever the config holds.
  "cancel.free.products_lead": "Keeps {keeps} live",
  "cancel.free.products": "{rest} stored, not deleted",
  "cancel.free.branches_lead": "Keeps {keeps} published",
  "cancel.free.branches": "{rest} stored",
  "cancel.free.seats_lead": "Keeps {keeps} with access",
  "cancel.free.seats": "{rest} revoked",
  "cancel.free.storage": "{over} over, nothing deleted",
  "cancel.free.enquiries_lead": "{cap} a month",
  "cancel.free.enquiries": "the enquiry form then closes until the next month",
  "cancel.free.csv_import": "No access · products edited one at a time",
  "cancel.free.custom_domain": "Stops resolving · storefront stays at {url}",
  /*
     Rewritten for D2, 9 Sep 2026. Both strings said the placement runs to the
     end of "its own term" — while the row beside them was marked `ends`, in red,
     with the word "Ends" in its accessible text. One row, two answers, and the
     reassuring one was the larger.

     The slot belongs to the subscription now, so it ends when the subscription
     does, and the unused days come back on a credit note rather than silently.
  */
  "cancel.free.sponsored": "Ends with the subscription",
  "cancel.free.sponsored_term": "Ends {when}, with the subscription. Unused days come back as a credit.",
  "cancel.free.analytics": "No access — your data is kept",

  // The choice is scheduled, not made now: the picker opens on confirming and
  // closes on the last paid day. It is `11f`'s mechanism, unchanged.
  "cancel.picker_note": "Which products, which branch and which seat stay live are yours to choose. The picker opens when you confirm and closes {when}.",
  "cancel.picker_default": "If you choose nothing, the oldest stay live and the rest are stored.",
  "cancel.today_note": "Nothing changes today, and nothing is charged today. {plan} is paid to {paidTo} and runs to {paidTo}: that period is not shortened and the unused part is not paid back. Once you confirm, you can resume {plan} any time before {paidTo}.",
  "cancel.nothing_reduced": "Free holds everything you have live today, so nothing is unlisted and nothing is stored away.",

  // Evidence, dated, from the seller's own account. Not a retention offer: wave
  // 4 ruled out discounts, pauses and counter-offers, and it did not rule out
  // telling somebody what the plan they are leaving actually did.
  "cancel.evidence": "Last month {plan} brought you {last} enquiries. On Free you would have received {free} of them.",
  "cancel.keep_eyebrow": "What you keep",
  "cancel.keep.listing": "A live listing at the same address, with the badge your licence earned.",
  "cancel.keep.stored": "Every product, branch and photo — stored, not deleted.",
  "cancel.keep.history": "Reviews, replies, enquiry history and invoices.",
  "cancel.keep_plan": "Keep {plan}",
  "cancel.continue": "Continue to cancel",

  // The fork. `11i` is not drawn and is blocked, so the difference is stated
  // and nothing links anywhere — a live link to a route that does not exist is
  // the defect corrected on `11d` and `11g`.
  "cancel.closing_eyebrow": "Closing the business instead?",
  "cancel.closing_body": "Cancelling leaves your listing in the directory on Free. Closing the account removes it altogether.",
  "cancel.closing_blocked": "Closing an account is not something you can do here yet. Ask us and we will do it for you.",

  "cancel.if_confirm_eyebrow": "If you confirm",
  "cancel.if_confirm.email": "A confirmation email to {email}, with the date Free starts.",
  "cancel.if_confirm.email_none": "A confirmation email, once a billing address is set in Settings.",
  "cancel.if_confirm.banner": "A Cancellation scheduled banner on Billing until {when}, with Resume {plan} on it.",

  // Step 2. The reason is required and the box never is, except under
  // `Something else` — where the box is the only place the reason can exist.
  "cancel.reason.legend": "Why are you cancelling?",
  "cancel.reason.required": "Required",
  "cancel.reason.hint": "One answer. It does not change or delay the cancellation.",
  "cancel.reason.too_expensive": "Too expensive for what we use",
  "cancel.reason.not_enough_enquiries": "Not enough enquiries to justify it",
  "cancel.reason.poor_quality_enquiries": "The enquiries we got were poor quality",
  "cancel.reason.another_platform": "We use another platform instead",
  "cancel.reason.business_closing": "The business is closing, or our licence has lapsed",
  "cancel.reason.business_closing_note": "Cancelling leaves your listing in the directory on Free. Closing removes it. Choose this and the button below becomes Continue to close account — nothing is cancelled from this screen.",
  "cancel.reason.something_else": "Something else",
  "cancel.reason.something_else_note": "Choose this and the box below becomes required — it is the only place the reason can be recorded.",

  "cancel.note.label": "What would have kept you on {plan}?",
  "cancel.note.optional": "Optional",
  "cancel.note.required": "Required",
  "cancel.note.placeholder": "Answering does not change the cancellation or delay it, and confirming is never blocked on this box.",
  "cancel.note.required_hint": "You picked Something else, so this is where the reason goes.",
  "cancel.note.counter": "{used} of {limit}",

  "cancel.happens_eyebrow": "What happens on {when}",
  "cancel.dates_eyebrow": "Dates",
  "cancel.dates.period": "{plan} is paid to {paidTo} and runs to {paidTo}. That period is not shortened and the unused part is not paid back. Free starts {freeFrom}.",
  "cancel.dates.invoice": "Your next invoice would have been {amount} on {when}. It will not be raised.",
  "cancel.confirm": "Cancel from {when}",
  "cancel.confirm_closing": "Continue to close account",
  "cancel.resume_note": "You can resume {plan} any time before {when}.",
  "cancel.get_eyebrow": "What you get",
  "cancel.get.email": "A confirmation email to {email}.",
  "cancel.get.banner": "A Cancellation scheduled banner on Billing, with Resume {plan} and the picker on it. This route stops being reachable.",

  "cancel.error.no_reason": "Pick a reason first. It is the one thing we ask for, and it does not change or delay the cancellation.",
  "cancel.error.note_required": "You picked Something else, so the box below is where the reason goes.",
  "cancel.error.already": "That subscription is already ending. Billing shows the date and how to resume.",
  "cancel.error.none": "There is no subscription to cancel.",
  /*
     Board 11c's follow-up audit. A trial is not a subscription to cancel: it
     ends by itself into `expired` and drops to Free, and cancelling it used to
     write `status: "active"` over the top — which took it out of the trial
     sweep and put money on the revenue board that nobody had paid.
  */
  "cancel.trial.title": "There is nothing to cancel yet",
  "cancel.trial.body": "You are on a {plan} trial. It ends on {when}, nothing is charged, and your listing moves to Free on that day.",
  "cancel.trial.note": "If you would rather stay on the plan, add a payment method before that date. Nothing happens if you do not.",
  "cancel.error.on_trial": "You are on a trial, which ends on its own and charges nothing. There is nothing to cancel.",
  "cancel.error.closing": "Closing an account is a different thing, and it is not built yet. Nothing was cancelled.",

  "cancel.email.subject": "Your subscription is scheduled to end",
  "cancel.email.body": "Your plan is paid to {paidTo} and runs to {paidTo}. Free starts {freeFrom}. Nothing is deleted, and you can resume any time before then.",
  "cancel.email.action": "Open billing",

  // ── Board 3m · subscription and billing ───────────────────────────────────
  //
  // The VAT convention, in copy: prices ex-VAT, VAT always its own line, every
  // total labelled `incl. VAT`, nothing rounded. The pair's second correction is
  // a `THIS PERIOD` total of `AED 1,784` over two lines summing to 1,699 — a
  // seller could not reproduce the number they owed.
  "billing.page_title": "Subscription & billing",
  "billing.trn_on_invoices": "TRN on invoices: {trn}",
  "billing.trn_missing": "Add your TRN on the listing profile and it appears on every invoice from then on.",
  "billing.plan_price": "{price} / month + VAT",
  "billing.plan_price_annual": "{price} / year + VAT",
  "billing.renews_on": "Renews {when}",
  "billing.annual_offer": "Renews {when} · a year is {price} + VAT, saving {saving}",
  "billing.switch_annual": "Switch to annual",
  "billing.usage.products": "Products",
  "billing.usage.branches": "Branches",
  "billing.usage.seats": "Team seats",
  "billing.usage.storage": "Storage",
  "billing.usage.of": "of {cap}",
  // Not "/ unlimited" as the board draws it: a slash is read aloud as "slash",
  // and this sits beside "of 10" in the next cell. The house pattern for an
  // uncapped meter is `team.seats_uncapped`, which states the number and says
  // there is no ceiling rather than inventing a denominator.
  "billing.usage.unlimited": "with no limit",

  "billing.period.eyebrow": "This period",
  "billing.period.subscription": "{plan} subscription",
  "billing.period.placement": "Sponsored placement · {what}",
  "billing.period.placement_dates": "{from} to {to}",
  "billing.period.subtotal": "Subtotal",
  "billing.period.vat": "VAT {rate}",
  "billing.period.due": "Due {when}",
  "billing.period.incl_vat": "incl. VAT",
  // The thing sellers assume a directory does, said before they ask.
  "billing.period.no_commission": "No commission on enquiries or on business you win. Subscription and placement only.",
  "billing.period.first_invoice": "Your first invoice arrives on {when}, at the end of this period.",

  "billing.method.eyebrow": "Payment method",
  "billing.method.card": "•••• {last4}",
  "billing.method.detail": "{brand} · expires {expiry}",
  "billing.method.change": "Change",
  "billing.method.add": "Add a card",
  "billing.method.none": "No card on file. One is needed before the next renewal.",
  "billing.method.direct": "Buyers pay you directly on your own terms. We never hold or route your money.",

  "billing.invoices.col.invoice": "Invoice",
  "billing.invoices.col.description": "Description",
  "billing.invoices.none_yet": "No invoices yet. The first arrives on {when}.",
  "billing.invoices.credit_note": "Credit note against {ref}",
  // What a multi-line invoice is, in words. The raw `InvoiceLineKind` values
  // were reaching the screen: `subscription + subscription_credit`.
  "billing.invoices.plan_change": "Plan change, pro-rated",
  "billing.invoices.kind.subscription": "Subscription",
  "billing.invoices.kind.placement": "Sponsored placement",
  "billing.invoices.kind.subscription_credit": "Subscription credit",
  "billing.invoices.kind_join": " + ",
  "billing.invoices.view": "Open invoice {ref}",

  "billing.cancel.eyebrow": "Cancelling?",
  // Matches board 11f's Free column and the rule 3f §6 owns. The old boards said
  // all 1,204 products "stay saved but hidden", which is a different decision to
  // put in front of somebody.
  "billing.cancel.consequence": "You drop to Free at the end of the period. On Free, {keeps} of your {used} products stay live and you pick which — the rest are stored, not deleted. Enquiries drop to {enquiries} a month.",
  "billing.cancel.consequence_within": "You drop to Free at the end of the period. Free holds everything you have live today, so nothing is unlisted. Enquiries drop to {enquiries} a month.",

  "billing.scheduled.eyebrow": "Scheduled",
  "billing.scheduled.downgrade": "You move to {plan} on {when}. Nothing changes before then.",
  "billing.scheduled.review": "Review or withdraw",
  "billing.cancelling.banner": "Your subscription ends on {when}. Until then nothing changes.",
  "billing.cancelling.resume": "Resume {plan}",
  // The amendment board 11h needed. The banner said when the subscription ended
  // and offered `Resume Pro`, and that was all — so "you pick which stay live",
  // which `3m` and `11h` both promise, was a sentence with nowhere to act on it.
  "billing.cancelling.choose_intro": "Choose what stays live on Free. Open until {when}; after that the oldest stay.",
  "billing.cancelling.choose": "Choose",
  // No verb, so the line reads the same at one as at ten. `1 of 6 branches stay
  // published` was the first render of this panel, and a plural verb over a
  // singular subject is the kind of wrongness a seller reads as carelessness on
  // the screen where they are deciding what to lose.
  "billing.cancelling.keeps.products": "Products live on Free: {keeps} of {used}",
  "billing.cancelling.keeps.locations": "Branches published on Free: {keeps} of {used}",
  "billing.cancelling.keeps.seats": "Seats with access on Free: {keeps} of {used}",
  "billing.cancelling.chosen": "{count} chosen",
  "billing.cancelling.not_chosen": "Not chosen yet — the oldest stay",
  "billing.resumed": "Back on {plan}. Your next payment is {when}.",

  // The state neither board had, and the most consequential one on a billing
  // surface. A seller whose card expired has not decided to leave: nothing
  // downgrades and nothing on the listing moves during the grace period.
  "billing.failed.title": "We could not take {amount} on {when}",
  "billing.failed.reason": "The bank said: {reason}",
  // Two sentences, because only one of them is conditional. Criterion 12 is a
  // promise about what does *not* happen during the grace period, and it holds
  // whether or not a retry is the next step — so the deadline is always stated
  // and the retry is mentioned when there is one.
  "billing.failed.retry": "We try the card again on {when}.",
  "billing.failed.grace": "Your plan and your listing do not change before {deadline}.",
  "billing.failed.no_reason": "The payment did not go through.",
  /*
     Not a button. The `Update payment method` control linked to a panel that
     says card capture does not exist yet — honest where it landed and a dead
     end where it was pressed.
  */
  "billing.failed.fix": "Card details are handled by our payment provider, and that hand-off is not switched on yet. Reply to the email we sent about this payment and we will take it manually.",

  "billing.free.title": "You are on Free",
  "billing.free.body": "Free is a plan, not a trial. Nothing expires, and there is nothing to pay. Compare what each plan holds against what you have now.",
  "billing.free.compare": "Compare plans",

  // ── Board 11f · change plan ───────────────────────────────────────────────
  "change.back_short": "Billing",
  "change.term.monthly": "Monthly",
  // The term as a noun, for the change summary. The toggle labels above are
  // controls and read as options; these read as a state the account is in.
  "change.term_name.monthly": "Monthly",
  "change.term_name.annual": "Annual",
  "change.switch_term": "Pay {amount} and switch to {term}",
  // A term change charges the *whole* new period, so the day count that belongs
  // on a pro-rated line would read "365 of 365 days" here. The period is the
  // thing being bought; naming it is what the line is for.
  "change.summary.line_year": "{plan}, one year",
  "change.summary.line_month": "{plan}, one month",
  "change.term.annual": "Annual · {months} months free",
  "change.select": "Select {plan}",
  "change.selected": "Selected",
  "change.current": "Current plan",
  "change.price_free": "{price}",
  "change.price": "{price}",
  "change.price_vat": "+ VAT",
  "change.grid_caption": "What each plan holds, against what you have now",
  "change.col.feature": "What you get",

  "change.row.products": "Products live",
  "change.row.photos": "Photographs on the listing",
  "change.row.categories": "Extra categories",
  "change.row.branches": "Branches published",
  "change.row.seats": "Team seats",
  "change.row.storage": "Storage",
  "change.row.enquiries": "Enquiries",
  "change.row.analytics": "Analytics",
  "change.row.csv_import": "CSV import",
  "change.row.custom_domain": "Custom domain",
  "change.row.sponsored": "Sponsored eligibility",

  // One denominator per row: the seller's own usage, in all three columns. The
  // board's first correction is a seats row reading `1 of 3`, `2 of 3` and
  // `3 of 5 used` — the third against the plan's cap rather than the seller's.
  "change.cell.keeps": "{keeps} of {used}",
  "change.cell.keeps_all": "All {used}",
  "change.cell.keeps_none": "None yet",
  "change.cell.keeps_storage": "{keeps} of {used}",
  "change.cell.keeps_all_storage": "All {used}",
  "change.cell.per_month": { one: "{formatted} a month", other: "{formatted} a month" },
  "change.cell.unlimited": "Unlimited",
  "change.cell.included": "Included",
  "change.cell.absent": "Not on this plan",
  "change.storage_gb": "{value} GB",
  "change.storage_mb": "{value} MB",

  "change.summary.eyebrow": "Change summary",
  "change.summary.from_to": "{from} to {to}",
  "change.summary.downgrade": "A downgrade takes effect at the end of the period. Your {plan} features run to {when}.",
  "change.summary.upgrade": "{plan} starts as soon as this is paid. Your renewal date does not move.",
  "change.summary.term": "A new period starts today, and your renewal moves to {when}.",
  "change.summary.due_today": "Due today",
  "change.summary.from_date": "From {when}",
  "change.summary.line_charge": "{plan}, {days} of {total} days",
  "change.summary.line_credit": "{plan} credit, {days} unused days",
  "change.summary.line_vat": "VAT {rate}",
  "change.summary.then": "Then {price} incl. VAT on {when}, and monthly on the {day} after that.",
  "change.summary.then_annual": "Then {price} incl. VAT on {when}, and yearly after that.",

  "change.keep.eyebrow": "You choose what stays live",
  "change.keep.intro": "{plan} holds less than you have. Nothing is deleted — the rest is stored, and you pick what stays.",
  "change.keep.products": "{keeps} of {used} products",
  "change.keep.locations": "{keeps} of {used} branches",
  "change.keep.seats": "{keeps} of {used} team seats",
  "change.keep.choose": "Choose",
  "change.keep.chosen": "{count} chosen",
  "change.keep.auto": "Not chosen yet — the oldest stay",
  "change.keep.auto_seats": "Not chosen yet — everyone stays, and the next invitation is refused",
  // Q4. Storage has no chooser because a downgrade removes no files: the media
  // library refuses the next upload until the seller is back under the cap,
  // which is what already happens today.
  "change.keep.storage": "{used} stored, {cap} on {plan}",
  "change.keep.storage_note": "Files are not removed. Uploads are refused until you are back under {cap}, on the media library.",
  "change.keep.storage_link": "Open the media library",

  "change.ends.eyebrow": "Ends with {plan}",
  "change.ends.domain": "{domain} stops resolving on {when}",
  "change.ends.placement": "Sponsored placement · {what} runs to {when}, then ends",

  "change.schedule": "Schedule downgrade to {plan}",
  "change.upgrade_now": "Pay {amount} and move to {plan}",
  "change.upgrade_free": "Move to {plan}",
  "change.keep_current": "Keep {plan}",
  "change.withdraw_note": "Withdraw any time before {when}.",
  "change.scheduled_already": "You are already moving to {plan} on {when}. Withdraw that first to choose something else.",
  "change.cancelling_first": "Your subscription is already ending. Resume it on Billing first, then change the plan.",
  "change.cancelling": "You have a cancellation scheduled. Your plan runs to {when}, and Billing is where you resume it or choose what stays live on Free.",
  "change.withdraw": "Withdraw the change",
  "change.withdrawn": "Withdrawn. You stay on {plan}.",
  "change.scheduled": "Scheduled. You move to {plan} on {when}, and nothing changes before then.",
  "change.no_subscription": "There is no subscription to change.",
  "change.scheduled_already_short": "A change is already scheduled. Withdraw it first.",
  "change.charge_failed": "That payment did not go through. Nothing has changed on your account.",
  "change.same_plan": "That is the plan you are on.",
  // A number shown on a button is a promise. The preview is computed once for
  // the screen and again at the charge, and a difference refuses rather than
  // adjusts — criterion 7.
  "change.quote_moved": "The price changed while this was open. Nothing has been charged. Check the figures and try again.",
  "change.provider_not_live": "No card has been charged. Payment is not connected in this environment.",

  "keep.title": "Choose what stays live",
  "keep.eyebrow": "Change plan",
  "keep.intro_products": "{plan} holds {cap} live products. Pick the ones that stay — the rest are stored, not deleted, and come back if you move up again.",
  "keep.intro_locations": "{plan} publishes {cap} branches. Pick the ones that stay published.",
  "keep.intro_seats": "{plan} holds {cap} team seats. Pick who keeps theirs. Anyone you do not pick loses access on {when}, and their open leads go to the unassigned queue.",
  "keep.counter": "{chosen} of {cap} chosen",
  "keep.over": "{over} too many. Deselect {over} to continue.",
  "keep.save": "Save the choice",
  "keep.saved": "Saved. {count} stay live on {when}.",
  "keep.too_many": "That is more than {plan} holds. Deselect a few and save again.",
  "keep.owner_kept": "The owner keeps their seat and cannot be deselected.",
  // The head office is the address the listing resolves to. Unpublishing it
  // would take the address off a live storefront, which is not what "choose what
  // stays live" is offering.
  "keep.head_office_kept": "Your head office stays published and cannot be deselected.",
  "keep.col.name": "Name",
  "keep.col.branch": "Address",
  "keep.col.role": "Role",
  "keep.col.keeps": "Stays live",

  // ── Board 11g · the tax invoice ───────────────────────────────────────────
  //
  // The only screen on the platform that is a legal document. Its rule: the
  // render is not a preview of the document, it *is* the document — so anything
  // that is a fact about the invoice belongs inside the sheet, and every panel
  // beside it that will not reach the PDF says so on its face.
  "invoice.title": "Tax invoice",
  "invoice.title_credit": "Credit note",
  "invoice.eyebrow": "Billing",
  "invoice.back": "Billing",
  "invoice.heading": "TAX INVOICE",
  "invoice.heading_credit": "CREDIT NOTE",
  "invoice.paid_badge": "Paid in full",
  "invoice.issued_badge": "Issued",
  "invoice.overdue_badge": "Overdue",

  "invoice.billed_to": "Billed to",
  // Labelled, always. The issuing entity holds no TRN, and with one tax number
  // on a page an unlabelled one reads as the issuer's.
  "invoice.recipient_trn": "Recipient TRN {trn}",
  "invoice.dates_heading": "Dates & supply",
  "invoice.date_of_issue": "Date of issue",
  "invoice.date_of_supply": "Date of supply",
  "invoice.supply_period": "Supply period",
  "invoice.place_of_supply": "Place of supply",
  "invoice.currency": "Currency",

  "invoice.col.description": "Description",
  "invoice.col.qty": "Qty",
  "invoice.col.unit": "Unit {currency}",
  "invoice.col.rate": "Rate",
  "invoice.col.vat": "VAT {currency}",
  "invoice.col.amount": "Amount {currency}",
  "invoice.booking": "Booking {ref}",
  "invoice.not_stored": "Not stored",

  "invoice.subtotal": "Subtotal, excluding VAT",
  "invoice.vat_total": "Total VAT payable",
  "invoice.total": "Total payable, including VAT · {currency}",
  "invoice.corrects": "Credit note against {ref}",
  // The slot Q5 asked to be reserved, so a document sellers have downloaded does
  // not have to be re-laid-out when 12e ships the correction.
  "invoice.corrected_by": "Corrected by credit note {ref}",

  "invoice.payment_heading": "Payment received",
  "invoice.paid_on": "Paid in full on {when}",
  "invoice.paid_card": "{brand} •••• {last4}",
  "invoice.references_heading": "References",

  "invoice.footnote": "All amounts are in {currency}. This document is a fixed record: a correction is issued as a credit note referencing {ref}, never as a change to this invoice.",
  // A visibly marked placeholder, not invented wording. A US-registered supplier
  // charging 5% to a UAE recipient is spec Q3, and the answer changes the
  // heading, this footnote and possibly the VAT lines. A silently absent
  // footnote would look like a finished document.
  "invoice.statutory_pending": "Statutory VAT wording sits here, once the US-supplier / UAE-recipient treatment is settled.",
  "invoice.page_foot": "Page {page} of {pages}",

  // The three panels that are screen-only, and say so.
  "invoice.not_in_pdf": "Not in the PDF",
  "invoice.document_heading": "The document",
  "invoice.document_note": "The PDF was written when this invoice was issued and stored. This screen renders that stored document at its printed size — A4 portrait, 210 × 297 mm.",
  "invoice.document_file": "{ref}.pdf",
  "invoice.document_meta": "Issued {when} · A4 · {size}",
  "invoice.document_missing": "No PDF was stored for this invoice. The figures above are the record; the download is not available.",
  "invoice.download": "Download PDF",

  "invoice.delivery_heading": "Delivery",
  "invoice.delivery.emailed": "Emailed to {who}",
  "invoice.delivery.downloaded": "Downloaded by {who}",
  "invoice.delivery.none": "Not sent or downloaded yet.",
  "invoice.delivery.address_note": "The billing address comes from Settings. Sending a copy elsewhere does not change it.",
  "invoice.email_to": "Email to {address}",
  "invoice.email_none": "No billing address on file. Add one in Settings and this invoice can be sent.",
  "invoice.emailed_ok": "Sent to {address}.",
  "invoice.email_failed": "That did not send. Nothing has changed, and the invoice is unaffected.",
  "invoice.email_no_sender": "Email is not connected in this environment, so nothing was sent.",
  "invoice.email_bad_address": "That does not look like an email address.",
  "invoice.email_other": "Send to another address",
  "invoice.email_other_label": "Email address",
  "invoice.email_send": "Send",
  "invoice.email_cancel": "Cancel",
  // The mail itself. A link rather than an attachment: the route behind it checks
  // the capability on every read, where an attachment checks it once and then
  // lives in a mailbox we do not control.
  "invoice.email.subject": "Your invoice {ref}",
  "invoice.email.body": "Your tax invoice {ref} is ready. It opens on your billing screen, where it can also be downloaded as a PDF.",
  "invoice.email.action": "Open the invoice",

  "invoice.covers_heading": "What this covers",
  "invoice.covers_plan": "Plan",
  // 11e owns the booking detail page and is blocked on 12c. Text with a stated
  // reason, never a link to a route that does not exist.
  "invoice.covers_no_page": "No page yet",
  "invoice.covers_placement_note": "Placement booking detail is board 11e, blocked on 12c. Until it ships this line is text, not a link.",

  "invoice.fixed_heading": "This document cannot be edited",
  "invoice.fixed_body": "An issued invoice is a fixed record. A correction is a credit note raised against it, never a change to this document.",
  "invoice.fixed_access": "Visible to the owner and finance seats only.",

  // Board 7e's field, which 11g reads.
  "alerts.billing_email_label": "Where invoices go",
  "alerts.billing_email_hint": "Leave this empty and invoices go to your finance seat, or to you if there is not one.",

  // ── Team and lead routing, board 7d ───────────────────────────────────────
  "team.title": "Team",
  "team.eyebrow": "Account",
  "team.intro": "Who can see and answer what. A sales seat replies and quotes; it cannot see invoices, change the plan or touch licence details.",
  "team.seats": "{used} of {cap} seats used",
  "team.seats_uncapped": "{used} seats used",
  "team.invites_pending": { one: "{count} invite pending", other: "{count} invites pending" },
  "team.caption": "Your team",
  "team.col.person": "Person",
  "team.col.role": "Role",
  "team.col.branch": "Branch scope",
  "team.col.open": "Open",
  "team.col.reachable": "Reachable on",
  "team.col.status": "Status",
  "team.you": "you",
  "team.role.seller_owner": "Owner",
  "team.role.seller_manager": "Manager",
  "team.role.seller_sales": "Sales",
  "team.role.seller_finance": "Finance",

  "team.scope_all": { one: "The one branch", other: "All {count} branches" },
  "team.scope_branch": "{branch} only",
  "team.scope_none": "No branch",

  "team.channel.whatsapp": "WhatsApp",
  "team.channel.sms": "SMS",
  "team.channel.email": "Email",
  "team.reach.email_only": "Email only",
  "team.reach.none": "Nothing verified",
  "team.reach.not_lead_seat": "Not a lead seat",
  "team.reach.unverified": "{channels} entered, not yet verified",
  "team.reach.rule": "A seat with no verified channel is not a routing target. Verify a number on the Settings screen and it becomes one.",
  "team.reach.settings_link": "Verify a channel",

  "team.status.active": "Active",
  "team.status.suspended": "Suspended",
  "team.status.invited": "Invited",
  "team.status.expired": "Expired",
  "team.invite_expires": { one: "Expires tomorrow", other: "Expires in {count} days" },
  "team.invite_expired": "The link has expired. Sending it again gives them another seven days.",
  "team.invite_sent_when": "Sent {when}",
  "team.resend": "Send it again",
  "team.resend_aria": "Send the invitation to {contact} again",
  "team.revoke_aria": "Withdraw the invitation to {contact}",
  "team.remove_aria": "Remove {name} from the team",
  "team.resent": "Sent again to {contact}. The new link works for seven days.",
  "team.resend_too_soon": "That invitation went out within the hour. Give it a little longer before sending another.",

  "team.open_total": { one: "{count} open lead here, the same one your inbox shows.", other: "{count} open leads here, the same {count} your inbox shows." },
  "team.open_unassigned": { one: "{count} of them is not assigned to anybody.", other: "{count} of them are not assigned to anybody." },
  "team.open_none": "No open leads right now.",
  "team.open_link": "Open the inbox",

  "team.matrix_heading": "What each role can do",
  "team.matrix_caption": "Capabilities by role",
  "team.matrix_note": "Finance never sees the inbox. It cannot reply to an enquiry or send a quote, so a finance seat is never a routing target.",
  "team.matrix_source": "Read from the permission table the product enforces, not written out beside it.",
  "team.col.capability": "Capability",
  "team.can.respond": "Reply to enquiries",
  "team.can.revise": "Send a quote and a revision",
  "team.can.extend": "Extend a quote's validity",
  "team.can.products": "Edit products and specs",
  "team.can.listing": "Edit listing profile, locations, hours",
  "team.can.analytics": "See analytics",
  "team.can.team": "Invite or remove team members",
  "team.can.routing": "Set lead routing rules",
  "team.can.billing": "See invoices and billing",
  "team.can.plan": "Change plan or cancel",
  "team.holds": "Yes",
  "team.holds_not": "No",
  "team.scoped_marker": "branch",
  "team.scoped_note": "Rows marked branch are limited to that seat's own branch where the seat is branch-scoped.",

  "team.invite": "Invite someone",
  "team.invite_email": "Their email",
  "team.invite_role": "What they can do",
  "team.invite_branch": "Which branch",
  "team.invite_branch_all": "Every branch",
  "team.branch_disambiguated": "{area} — {address}",
  "team.invite_send": "Send the invite",
  "team.invited": "Invited. They have seven days to accept.",
  "team.pending": "Invited, not yet accepted",
  "team.revoke": "Revoke",
  "team.at_cap": "{plan} includes {cap} seats. Move to {next} to invite more.",
  "team.at_cap_short": "Every seat on {plan} is taken. An invitation holds one until it is accepted or revoked.",
  "team.at_cap_billing": "See what the other plans include",
  "team.unmeasured": "Not enough replies yet",
  "team.owner_slowest": "Your own replies are the slowest on the team. It is worth knowing, and worth routing fewer leads to yourself.",

  "team.remove_heading": "Where do their open leads go?",
  "team.remove_open": { one: "{name} is holding {count} open lead.", other: "{name} is holding {count} open leads." },
  "team.remove_none": "{name} is holding no open leads.",
  "team.remove_to_seat": "Give them to {name}",
  "team.remove_to_queue": "Send them to the unassigned queue",
  "team.remove_moved": { one: "{name} no longer has a seat. Their one lead has moved.", other: "{name} no longer has a seat. All {count} of their leads have moved, the decided ones included." },
  "team.reassign_to_leaver": "Choose somebody other than the person you are removing.",
  "team.reassign_unknown": "That person is not on your team.",
  "team.reassign_cannot_reply": "A finance seat cannot open an enquiry, so it cannot take these leads. Choose a sales seat, a manager, or the unassigned queue.",

  "team.performance_heading": "Last {days} days by seat",
  "team.performance_caption": "Leads handled and median first reply, by seat",
  "team.performance_total": { one: "{count} lead in the last {days} days, the same one your inbox counts.", other: "{count} leads in the last {days} days, the same {count} your inbox counts." },
  "team.performance_legend": "The bar is that seat's share of the leads. The figure beside it is that seat's own median first reply.",
  "team.performance_compose": "These medians do not average to the business median on your listing. The middle value of a group is not the middle value of its parts.",
  "team.performance_unanswered": "Nobody has answered yet",
  "team.performance_none": "No leads have reached this team in the last {days} days.",
  "team.performance_leads": { one: "{count} lead", other: "{count} leads" },

  "routing.heading": "Where an enquiry goes",
  "routing.lede": "An unassigned lead is a lost lead. Reply time is {points} of the {total} points a search result is scored on, and it is the band buyers read on your listing.",
  "routing.everyone": "Everyone sees everything",
  "routing.everyone_hint": "Every seat sees every enquiry and anybody can answer. There is no Claim button yet — Assign is how a lead gets an owner.",
  "routing.round_robin": "Round-robin between sales seats",
  "routing.round_robin_hint": "Each new enquiry goes to the next sales seat in turn, skipping anyone outside working hours or with no verified channel.",
  "routing.by_branch": "By branch, from the buyer's location",
  "routing.by_branch_hint": "The seat at the branch nearest the buyer takes it, and it falls back to you when that branch has nobody.",
  "routing.single_seat": "Every enquiry comes to you. There is nobody else to alternate with yet.",
  "routing.unroutable": "If no seat can be reached the lead comes to you and is marked unrouted in the inbox. Nothing waits silently.",
  "routing.hours_source": "Working hours come from your Hours page, Ramadan included. There is no second copy of the week here.",
  "routing.unreachable_seats": { one: "{count} seat has no verified channel and is skipped.", other: "{count} seats have no verified channel and are skipped." },
  "routing.escalation": "Escalate to the owner after",
  "routing.escalation_hint": "An enquiry nobody has answered by then also appears on the owner's list. It fires whatever the routing mode is, and it ignores quiet hours in the app.",
  "routing.minutes": { one: "{count} minute", other: "{count} minutes" },
  "routing.hours": { one: "{count} hour", other: "{count} hours" },
  "routing.save": "Save routing",
  "routing.saved": "Saved.",

  // ── Sponsored placement, board 11e ────────────────────────────────────────
  "promote.title": "Sponsored placement",
  "promote.eyebrow": "Growth",
  "promote.intro": "One slot per subcategory and emirate. Not auctioned — if it is taken, you join a queue in the order people joined it.",
  "promote.rules_heading": "What a sponsored slot does, and does not",
  "promote.rule.labelled": "Always labelled as sponsored, on every surface.",
  "promote.rule.never_outranks": "Never above a verified supplier on a filter the buyer set. A buyer who asked for tier 3 gets tier 3 first, whoever is paying.",
  "promote.rule.one_slot": "One slot per subcategory and emirate. Nobody can buy the whole category.",
  "promote.fix_first_heading": "Fix the free things first",
  "promote.fix_first": "{count} of your products have no filterable specs. Buyers narrow by those fields, so those products are listed and not found — and a sponsored slot puts a product nobody can filter to at the top of a page.",
  "promote.fix_first_link": "Go to the catalogue",
  "promote.fix_first_clear": "Your catalogue has its filterable specs filled in. A sponsored slot will land on products buyers can actually narrow to.",
  "promote.category": "Subcategory",
  "promote.emirate": "Emirate",
  "promote.emirate_all": "Every emirate",
  "promote.available": "Available, AED {price} a month",
  "promote.taken": "Taken until {when}",
  "promote.join": "Join the queue",
  "promote.joined": "You are in the queue. We will write when it comes free.",
  "promote.leave": "Leave the queue",
  "promote.buy": "Take this slot",
  "promote.yours": "Yours until {when}",
  "promote.queue_position": "{n} ahead of you",
  // The queue's whole point, and until D2 nothing said it: `notifiedAt` was
  // written by nothing and read by nothing, so a seller sat in a queue for a
  // slot that had been free for a month.
  "promote.freed": "The slot you queued for is free. It is first come, so it may not stay that way.",
  "promote.freed_badge": "Free now",
  // The line on the credit note a seller keeps when their slot ends before its
  // thirty days are up. Names the days rather than the reason: a credit note is
  // an accounting document and "cancelled" belongs in the account history, not
  // on the invoice.
  "placement.invoice_line": "Sponsored placement, {category}",
  "placement.credit_line": "Sponsored placement, {days} unused days",
  "promote.refuse.not_yours": "You can only buy placement for your own business.",
  "promote.refuse.already_yours": "You already hold that slot.",
  "promote.refuse.no_plan": "This business is not on a plan, so it cannot take a slot.",
  "promote.refuse.plan": "Sponsored placement is not included on {plan}. Change plan to take a slot.",

  // ── Analytics, board 3l ───────────────────────────────────────────────────
  // ── Board 3l · analytics ──────────────────────────────────────────────────
  //
  // The rule the page runs on: **every number is a comparison or it is
  // decoration**. A count with nothing beside it cannot answer the only
  // question a seller opens analytics to ask — did what I did last month work.
  // So every stage, product row and region carries its change, and the two
  // comparisons that are not self-referential are labelled as what they are.
  //
  // Nothing here is estimated, and where a source started after the window
  // opened the page says `tracking since` rather than showing a rise from zero
  // that is really the pipeline switching on.

  "analytics.title": "Analytics",
  "analytics.eyebrow": "Growth",
  "analytics.window": "{from} vs {previous}",
  "analytics.export": "Export CSV — the four tables on this page",

  // Week one is a normal page with its comparisons suppressed, not an error.
  "analytics.no_comparison": "no comparison yet",
  "analytics.tracking_since": "tracking since {when}",
  "analytics.week_one": "This is your first period, so there is nothing to compare against yet. Every figure below is counted; the changes appear once a second period closes.",

  // The setup-gap state. Every cause of an empty analytics page is a setup gap,
  // which is why it sends the seller to 8a rather than explaining a chart.
  "analytics.no_data": "Nothing measured yet",
  "analytics.no_data_body": "Figures appear here once buyers start finding you. Impressions and views are counted from the day tracking starts and cannot be filled in backwards, so this page begins the day your listing does.",
  "analytics.no_data_action": "Finish your setup",

  // 1 · Where buyers drop off
  "analytics.funnel.title": "Where buyers drop off",
  "analytics.funnel.bars": "Bars are the share carried from the stage above",
  // A share above 100% is real: these are stages, not one path, so more buyers
  // can do a later thing than the earlier one. The bar cannot draw past full,
  // so the word carries what the width cannot.
  "analytics.funnel.over": "— more than the stage above",
  "analytics.funnel.note": "Stages, not one path — a buyer can send an enquiry without revealing a number.",
  "analytics.funnel.caption": "Buyer stages, with the share carried from the stage above",
  "analytics.stage.impressions": "Appeared in search",
  "analytics.stage.clicks": "Clicked through to your listing",
  "analytics.stage.product_views": "Viewed a product",
  "analytics.stage.reveals": "Revealed a phone number",
  "analytics.stage.enquiries": "Sent an enquiry",
  "analytics.median": "Your search-to-click rate is {yours} against a {median} median for {category} in {emirate}.",
  /*
     The same sentence for a seller with no published location.

     The cohort is then the category countrywide, and naming an emirate that is
     not in the comparison would be worse than naming none.
  */
  "analytics.median_countrywide": "Your search-to-click rate is {yours} against a {median} median for {category} across the UAE.",
  "analytics.median_cohort": "Across {count} suppliers.",
  "analytics.no_cover": "Two of your most-viewed products have no cover photo: {products}.",

  // 2 · What buyers searched to reach you
  "analytics.queries.title": "What buyers searched to reach you",
  "analytics.queries.note": "Your position for the query, and how it moved in {days} days.",
  "analytics.queries.caption": "Search queries you appeared for, with position and movement",
  "analytics.queries.col.query": "Query",
  "analytics.queries.col.volume": "Vol",
  "analytics.queries.col.position": "Position",
  "analytics.queries.not_ranked": "Not ranked",
  "analytics.queries.held": "held",
  "analytics.queries.none": "No searches have brought a buyer to you in this window yet.",

  /*
     The 3a/3l amendment — position, and why it moved.

     The spec wrote these as ICU: `{count, plural, one {…} other {…}}` and
     `{direction, select, up {Rose} other {Fell}}`. This catalogue is not ICU.
     Plurals are a `PluralForms` object, which is the shape Arabic's six
     categories need, and there is no `select` at all — so a sentence that
     branches on direction is two keys rather than one string with a switch in
     it. Typed keys are the point: a missing branch is a build error here and a
     silently wrong sentence in ICU.
  */
  "position.rank": "#{rank} of {total}",
  "position.not_ranked": "Not ranked",
  "position.not_measured": "Not measured",
  "position.not_measured_why": "We have not ranked this category since {date}.",
  "position.not_measured_ever": "We have not ranked this category yet.",
  "position.not_ranked_why": "You are not in this category listing today.",
  "position.updated_nightly": "Updated nightly.",
  "position.title": "Where you rank",
  "position.caption": "Your position in each category listing you appear in",
  "position.col.category": "Category",
  "position.col.position": "Position",
  "position.link": "Analytics",
  "position.count": {
    one: "One category, because you rank in one. Updated nightly.",
    other: "{count} categories, because you rank in {count}. Updated nightly.",
  },
  "position.and_more": { one: "and one more", other: "and {count} more" },
  "position.none": "You are not in a category listing yet.",
  "position.locked": "See where you rank in each category listing, and what moved you.",

  /*
     Attribution. Three of these six say, in their first clause, that it was not
     the seller — which is the rule the amendment exists to hold. None of them
     carries an instruction: state 11 is the commonest fall on the board and
     ending it with something to fix would fire an improvement prompt on a
     decline the seller did not cause.
  */
  "attribution.seller.up":
    "Rose {places} after your {factor} {trend} from {before} to {after}.",
  "attribution.seller.down":
    "Fell {places} after your {factor} {trend} from {before} to {after}.",
  "attribution.places": { one: "1 place", other: "{count} places" },
  "attribution.trend.up": "rose",
  "attribution.trend.down": "fell",
  /*
     The same direction, as an adverb rather than a verb.

     State 12 reads "...your measured reply time, up from 4 h to 1 d 7 h", where
     state 08 reads "...after your measured reply time rose from...". Reusing
     the verb produced "your measured reply time, rose from" — grammatical
     nonsense that no test would have caught and the gallery showed at once.
  */
  "attribution.direction.up": "up",
  "attribution.direction.down": "down",
  "attribution.platform":
    "We changed how search results are ordered on {date}. This affected every listing in the category.",
  "attribution.commercial":
    "Your paid boost for {category} ended on {date}. Before the boost this category was #{rank}.",
  "attribution.commercial_unknown":
    "Your paid boost for {category} ended on {date}. This position is the one you rank at without it.",
  "attribution.competitor": {
    one: "Your factors did not change. One supplier above you improved their {factor}.",
    other: "Your factors did not change. {count} suppliers above you improved their {factor}.",
  },
  "attribution.multiple.up":
    "{count} factors moved. Most of the rise was your {factor}, {trend} from {before} to {after}.",
  "attribution.multiple.down":
    "{count} factors moved. Most of the fall was your {factor}, {trend} from {before} to {after}.",
  /*
     Q2's other half, which the spec's string list did not carry a form for.
     Where no single factor accounts for most of the movement the count stands
     alone — naming an arbitrary one of three is worse than naming none, because
     the seller acts on whichever one we printed.
  */
  "attribution.multiple.up_no_leader": "{count} factors moved, and no one of them carried the rise.",
  "attribution.multiple.down_no_leader":
    "{count} factors moved, and no one of them carried the fall.",
  "attribution.unexplained": "We cannot explain this move. Factor history starts {date}.",

  /* Lowercase: every one of them appears mid-sentence. */
  "factors.relevance": "relevance to the query",
  "factors.verificationTier": "verification tier",
  "factors.responseTime": "measured reply time",
  "factors.specCompleteness": "spec completeness",
  "factors.distance": "distance from the buyer",
  "factors.planTier": "plan tier",
  "factors.value.tier": "tier {tier}",
  "factors.value.ratio": "{percent}%",
  "factors.value.multiplier": "×{multiplier}",
  "factors.value.unmeasured": "not measured",
  "analytics.gap": "{count} buyers searched “{query}” and you have no product listed for it.",
  "analytics.gap_action": "Add one",
  "analytics.gap_if": "if you carry it.",

  // 3 · Top products by enquiry
  "analytics.products.title": "Top products by enquiry",
  "analytics.products.note": "Change is against the previous {days} days",
  "analytics.products.caption": "Your most-enquired products, with views and conversion",
  "analytics.products.col.product": "Product",
  "analytics.products.col.views": "Views",
  "analytics.products.col.enquiries": "Enq",
  "analytics.products.col.conversion": "Conversion",
  "analytics.products.no_cover": "no cover photo",
  "analytics.products.out_of_stock": "out of stock {days} days",
  "analytics.products.none": "No product has been viewed in this window yet.",

  // 4 · Where enquiries come from
  "analytics.regions.title": "Where enquiries come from",
  "analytics.regions.label": "Share of enquiries by emirate",
  // The honest bucket. The composer asks for a delivery emirate and a buyer may
  // leave it, and a guessed country would be a claim rather than a measurement.
  "analytics.regions.not_stated": "Not stated",
  "analytics.regions.none": "No enquiries in this window yet.",
  "analytics.device": "Device",
  "analytics.device.mobile": "mobile",
  "analytics.device.desktop": "desktop",
  "analytics.device.tablet": "tablet",
  "analytics.device.none": "No listing views to split yet.",

  // The plan gate. Board 11f's tier table is the source and it says Basic.
  "analytics.locked_reason": "Analytics",


  // ── Onboarding, boards 2a to 2e ───────────────────────────────────────────
  "onboarding.sequence": "Set up your listing",
  /*
     One word each, and the same five words on all four renders of this funnel.
     A step chain is read at a glance between fields; "Prove it is yours" is a
     sentence, and five sentences across a 60px bar is a paragraph nobody reads.
     Past tense on the ones behind you, because that is what the tick means.
  */
  "onboarding.step.claim": "Claimed",
  "onboarding.step.verify": "Verified",
  "onboarding.step.profile": "Profile",
  "onboarding.step.locations": "Locations",
  "onboarding.step.plan": "Plan",
  "onboarding.next": "Continue",
  "onboarding.back": "Back",
  // The chain collapses to this below 768px, beside the current step's name.
  "onboarding.step_of": "{current} / {total}",
  "onboarding.saved_now": "Saved",
  "onboarding.saved_at": "Saved {when}",
  "onboarding.have_account": "Already have an account?",
  "onboarding.sign_in": "Sign in",
  "onboarding.locations_meta_title": "Where buyers find you",

  // ── 2a · Find or add your business ────────────────────────────────────────
  "claim.title": "Is your business already listed?",
  // The count is a query, never a constant, and the second sentence is the
  // whole pitch. It has to be literally true: reviews, enquiry history and the
  // slug all survive a claim, which is asserted by a test rather than promised.
  "claim.intro": "We hold {count} UAE businesses from public licence records. Search yours and claim it — you keep the reviews and search history already attached to it.",
  // Three entry points, because the PRO holds the licence number, the owner
  // remembers the trade name, and the office manager knows the landline. This
  // is the field's accessible name as well as the line under it.
  "claim.search_label": "Search by trade name, trade licence number or phone",
  "claim.search_placeholder": "Trade name, licence number or phone",
  "claim.search_action": "Search",
  "claim.searching": "Searching",

  "claim.matches_head": { one: "{count} possible match", other: "{count} possible matches" },
  "claim.exact_licence": "Exact licence match",
  "claim.more_matches": { one: "{count} more match", other: "{count} more matches" },
  "claim.unclaimed": "Unclaimed",
  "claim.already_claimed": "Claimed",
  "claim.this_is_us": "This is us",
  "claim.dispute": "Report a dispute",

  // No matches. Never an empty results card, never "0 matches" as a heading.
  "claim.no_results": "Nothing matched. That is normal for a newer licence — add your business and we will verify it the same way.",

  // The add-new card. Say the time and name the document: a supplier who starts
  // without their licence abandons at the next step, and an abandoned claim is
  // harder to recover than one that never started.
  "claim.add_heading": "Not in the list?",
  "claim.add_body": "Add your business from scratch. Takes about six minutes with your trade licence to hand.",
  "claim.add_action": "Add a new business",

  // The dispute route. Never a closed door, and never the incumbent's name.
  "claim.dispute_note": "Submit your licence anyway. Where two claims conflict, our team asks both parties for the licence and decides in 48 hours.",

  // What claiming carries over, and what it does not.
  "claim.preserves_heading": "Claiming keeps everything already here",
  "claim.preserves": "{reviews} reviews and {enquiries} enquiries stay exactly as they are. Claiming attaches you to the listing buyers already see; it does not start a new one.",
  "claim.preserves_none": "Nothing is lost by claiming. It attaches you to the listing buyers already see rather than starting a new one.",
  "claim.not_trust": "Claiming carries your history over, not your badge. The green mark is earned at the next step, when we check the licence.",
  "claim.tier": "Tier {tier}",

  // Rate limit. It says the limit and when it clears, because the search reads
  // public records — refusing without a reason would read as a fault.
  "claim.too_many": "That is more searches than we take from one place in a few minutes.",
  "claim.too_many_fix": {
    one: "Try again in {count} second. Nothing you have typed is lost.",
    other: "Try again in {count} seconds. Nothing you have typed is lost.",
  },

  // A seller already holding a claimed listing. Stated, not silent.
  "claim.already_yours": "You are already set up with a listing. Claiming a second business is not something this flow can do yet — write to us and we will attach it to your account.",
  "claim.meta_title": "Find your business",

  // ── 2b · Prove ownership ──────────────────────────────────────────────────
  // The h1 names the licensed entity, which is why it takes the legal name.
  "verify.title": "Claiming {name}",
  "verify.intro": "Pick one route. Both are checked by a person, usually within {hours} working hours.",
  "verify.legend": "How you want to prove this is yours",

  "verify.route.licence": "Upload your trade licence",
  "verify.route.licence_hint": "PDF or JPG, up to {limit}. We read the licence number and expiry from it.",
  "verify.route.fastest": "Fastest",
  "verify.route.phone": "Verify by phone instead",
  // The masked number is the whole security argument of this route, stated.
  "verify.route.phone_hint": "We call the number on the public licence record — {phone} — and read you a 6-digit code. Use this if the licence is with your PRO.",
  "verify.no_phone": "We hold no phone number for this licence, so there is no call to answer.",

  "verify.file.idle": "Take a photo or choose a file",
  "verify.file.uploading": "Uploading the licence",
  "verify.file.replace": "Replace this file",
  "verify.file.reading": "Reading the licence number and expiry",

  "verify.field.number": "Licence number",
  "verify.field.number_hint": "As printed, with or without the {authority} prefix.",
  "verify.field.expiry": "Expiry",
  "verify.field.name": "Your name (as on the licence or POA)",
  "verify.field.role": "Your role",
  "verify.role.choose": "Choose one",
  "verify.role.owner": "Owner",
  "verify.role.partner": "Partner",
  "verify.role.manager": "Manager",
  "verify.role.pro": "PRO",
  "verify.role.authorised_signatory": "Authorised signatory",

  // OCR read nothing, or read it badly. Never a wrong value shown confidently.
  "verify.ocr_failed": "We could not read this automatically — please type the number and expiry from the licence.",
  "verify.ocr_filled": "We read these from your licence. Check them and correct anything wrong.",

  // Wrong document. Named, because "invalid document" sends nobody anywhere.
  "verify.wrong_document": "That looks like a {document} rather than a trade licence.",
  "verify.wrong_document_fix": "Upload the trade licence issued by the licensing authority. You can submit anyway if you think this is right.",
  "verify.document.health_authority": "health authority licence",
  "verify.document.municipality_permit": "municipality permit",
  "verify.document.vat_certificate": "tax registration certificate",
  "verify.document.establishment_card": "establishment card",
  "verify.document.chamber_certificate": "chamber of commerce certificate",
  "verify.document.passport_or_id": "passport or Emirates ID",

  // An expired licence is accepted. It usually means a business under pressure.
  "verify.expired_heading": "This licence expired on {date}",
  "verify.expired_body": "We will still take the claim, and you can carry on setting up while we look at it.",
  "verify.expired_fix": "Upload a current licence when you have it, and the verified badge follows.",

  "verify.submit": "Submit for verification",
  "verify.submitting": "Submitting",
  "verify.back": "Back",
  "verify.save_exit": "Save & exit",
  "verify.saved": "Saved. We have emailed {masked} a link back to this step.",
  "verify.saved_no_email": "Saved. Sign in again and you will come back to this step.",

  "verify.error.licence_number": "That is not a licence number. Type it as it is printed, for example {authority}-618402.",
  "verify.error.wrong_authority": "That number starts with {found}, and this licence was issued by {expected}. Check you are claiming the right listing.",
  "verify.gone": "That listing cannot be found.",

  // The submitted state. The page becomes a status card and never a dead end.
  "verify.submitted": "Submitted for verification",
  "verify.submitted_body": "Sent {when}. A person checks it, usually within {hours} working hours. Nothing waits for us — carry on setting up.",
  "verify.submitted_route.licence_upload": "Trade licence uploaded",
  "verify.submitted_route.phone_callback": "Call to the number on the licence record",
  "verify.continue": "Continue to your profile",

  "verify.contested_heading": "Somebody else has claimed this listing",
  "verify.contested_body": "We are taking your submission anyway. If a former employee or an agency claimed it, this is how it gets put right — a person will look at both.",
  "verify.contested_fix": "Submit below and carry on setting up. Nothing you fill in is lost if the claim takes a day to resolve.",
  "verify.contested_after": "Both parties have been asked for their licence. We decide within 48 hours.",
  "verify.contested_after_fix": "Carry on setting up. Nothing you fill in is lost while we decide.",

  // ── The sidebar ───────────────────────────────────────────────────────────
  "verify.unlock_heading": "What you unlock now",
  "verify.unlock.edit": "Edit everything on the listing",
  "verify.unlock.reply": "Reply to reviews and enquiries",
  "verify.unlock.badge": "The green Licence verified badge",
  // The commercial one: a claimed-but-unverified listing is left out of fan-outs.
  "verify.unlock.fanout": "Appear in RFQ fan-outs",

  "verify.reviews_heading": { one: "Already {count} review on this listing", other: "Already {count} reviews on this listing" },
  "verify.reviews_body": "They stay where they are. Claiming does not reset your rating — and you can reply to all of them once verified.",
  // Replaced, never zeroed: "0 reviews" is a worse thing to say than nothing.
  "verify.ladder_heading": "Verification is ours, not yours to declare",
  "verify.ladder_body": "Submitting queues a check. We confirm the licence with the issuing authority, and only then does the badge appear.",

  "verify.conflict_heading": "Someone else claimed it?",
  "verify.conflict_body": "Submit your licence anyway. Where two claims conflict, our team asks both parties for the licence and decides in 48 hours.",
  "verify.meta_title": "Prove ownership",

  // ── 2c · Profile basics, with live preview ────────────────────────────────
  "profile_step.title": "Tell buyers what you do",
  // The second sentence is the one that matters: category membership is the
  // join the enquiry fan-out runs on.
  "profile_step.intro": "Everything here is searchable. The categories you pick decide which RFQs reach you.",

  "profile_step.trade_name": "Trade name",
  "profile_step.trade_name_locked": "· locked to your licence",
  "profile_step.display_name": "Display name",
  "profile_step.display_name_hint": "What buyers see. Leave the legal suffix to the registry.",

  "profile_step.primary_category": "Primary category",
  "profile_step.extras": "Also list under",
  // The extras allowance — the plan cap minus the primary. Not the total.
  "profile_step.extras_used": "· {used} of {allowed} extra used on {plan}",
  "profile_step.extras_unlimited": "· unlimited on {plan}",
  "profile_step.extras_add": "Add category",
  "profile_step.extras_remove": "Remove {category}",
  // The upgrade line replaces the add control once the plan is spent. A control
  // that would be refused on click is a lie.
  "profile_step.extras_upgrade": "{plan} adds {more} more →",
  "profile_step.extras_upgrade_unlimited": "{plan} adds unlimited →",
  "profile_step.extras_none_yet": "No extra categories yet.",
  // Accepted and flagged, never refused inline.
  "profile_step.unverified_activity": "Waiting on a check against your licence",
  "profile_step.unverified_activity_note": "We take the category and check it against the activity on your licence. Until that clears, RFQs in it go to other suppliers.",

  "profile_step.description": "What you do",
  "profile_step.description_hint": "Write it the way you'd say it on the phone. Avoid keyword lists — they rank worse, not better.",
  "profile_step.counter": "{used} / {max}",

  "profile_step.established": "Established",
  "profile_step.team_size": "Team size",
  "profile_step.logo_cover": "Logo & cover",
  "profile_step.logo": "Logo",
  "profile_step.logo_hint": "400×400 minimum, square.",
  "profile_step.cover": "Cover image",
  "profile_step.cover_hint": "1440×400 recommended.",

  // ── The live preview ──────────────────────────────────────────────────────
  "profile_step.preview": "Live preview",
  "profile_step.preview_search": "Search result",
  "profile_step.preview_full": "Full page",
  "profile_step.preview_mode": "What the preview shows",
  "profile_step.preview_pending": "Verification pending",

  // ── The strength meter ────────────────────────────────────────────────────
  "profile_step.strength": "Profile strength",
  "profile_step.threshold": "{threshold}% is where a listing stops looking thin",
  "profile_step.lever": "+{points}%",
  "profile_step.item.identity": "Fill in your business details",
  "profile_step.item.identity_done": "Business details filled in",
  "profile_step.item.photos": "Add a logo and photos",
  "profile_step.item.photos_done": "Logo and photos added",
  "profile_step.item.catalogue": "Add your first products",
  "profile_step.item.catalogue_done": "Products listed",
  "profile_step.item.filterableSpecs": "Fill in product specifications",
  "profile_step.item.filterableSpecs_done": "Specifications filled in",
  "profile_step.item.team": "Add somebody who can reply",
  "profile_step.item.team_done": "A second person can reply",

  // Measured, and only once both cohorts clear the floor.
  "profile_step.lift_measured": "Listings above {threshold}% get {multiple}× more enquiries. This is the single biggest lever you control.",
  // Until then: the mechanism, which is true on day one because it describes
  // how the filters on the results page behave rather than a measured outcome.
  "profile_step.lift_mechanism": "Buyers filter on photos and specs. A listing with neither is invisible to those filters.",

  // ── Autosave and the one button ───────────────────────────────────────────
  "profile_step.saving": "Saving",
  "profile_step.save_failed": "That did not save. Your text is still here — try again.",
  "profile_step.continue": "Continue to locations",

  "profile_step.error.too_short": "A display name needs at least two characters.",
  "profile_step.error.too_long": "That is {length} characters. The limit is 60.",
  "profile_step.error.legal_suffix": "Leave \"{found}\" off. The registry keeps the legal name; buyers see this one.",
  "profile_step.error.repeats_category": "Your categories already say \"{word}\". Saying it twice on one card reads as padding.",
  "profile_step.error.description_too_long": "That is {length} characters. The limit is 600.",
  "profile_step.error.established_out_of_range": "Enter the year the business started, from 1960 onwards.",
  "profile_step.error.unknown_team_size": "Pick one of the bands.",
  "profile_step.error.required": "Add a display name, a primary category and a description before you carry on.",
  "profile_step.meta_title": "Your profile",

  // ── Board 2d, locations and hours ─────────────────────────────────────────
  "locations_step.title": "Where can buyers find you?",
  // The stake, not encouragement. Area is the second-most-used facet after
  // category, and an unpinned branch is filtered out of the results map by a
  // where clause rather than ranked below a pinned one.
  "locations_step.intro": "Drop a pin per branch. Buyers filter by area constantly — an unpinned listing loses most local searches.",

  "locations_step.branch": "Branch {n} — {type}",
  "locations_step.emirate": "Emirate",
  "locations_step.area": "Area",
  "locations_step.street": "Street address",
  "locations_step.street_hint": "Building, street and the landmark you give drivers.",
  "locations_step.landline": "Landline",
  "locations_step.whatsapp": "WhatsApp",
  "locations_step.branch_type": "Branch type",
  "locations_step.pinned": "Pinned",
  "locations_step.not_pinned": "Not pinned",
  "locations_step.not_pinned_help": "Drag the pin on the map to your gate. Without it this branch appears on no area page.",
  "locations_step.select_branch": "Edit this branch",
  "locations_step.showing_on_map": "Showing on the map",

  "locations_step.counter": "{used} of {cap} locations used on {plan}",
  "locations_step.counter_one": "{used} of {cap} location used on {plan}",
  "locations_step.counter_unlimited": "{used} locations. {plan} does not cap them.",
  "locations_step.add": "Add another branch",
  "locations_step.add_area": "Area for the new branch",
  "locations_step.upgrade": "{plan} allows {cap} →",
  "locations_step.upgrade_unlimited": "{plan} allows as many as you like →",
  "locations_step.remove": "Remove this branch",
  "locations_step.confirm_remove": "Remove this branch? Buyers will stop seeing this address.",
  "locations_step.keep_branch": "Keep it",
  "locations_step.last_branch": "This is your only branch. Add another before removing it.",

  "locations_step.map_label": "Map of this branch",
  "locations_step.drag_hint": "Drag the pin to your gate, not the street",
  "locations_step.unpinned_hint": "Drag the pin to your gate to pin this branch",
  "locations_step.map_unavailable": "The map did not load. Everything else on this page still saves.",
  "locations_step.radius": "Service radius",
  "locations_step.radius_km": "{km} km",
  "locations_step.radius_note": "Used to match you to nearby RFQs and \"near me\" searches.",
  "locations_step.radius_edit": "EDIT",
  "locations_step.radius_done": "Done",
  "locations_step.radius_none": "No delivery radius set",
  "locations_step.radius_slider": "Service radius in kilometres",

  "locations_step.hours": "Opening hours",
  "locations_step.day_range": "{from} – {to}",
  "locations_step.to": "to",
  "locations_step.split_shift": "Split shift",
  "locations_step.ramadan_on": "Ramadan hours on",
  "locations_step.ramadan_note": "on every open day · applies automatically on the announced dates",
  "locations_step.hours_optional": "Not needed to carry on. A branch with none reads \"Hours not provided\".",
  "locations_step.copy_all": "Copy to all branches",
  "locations_step.copy_all_confirm": "{count} other branches already have hours. Copying replaces them.",
  "locations_step.copy_all_confirm_one": "One other branch already has hours. Copying replaces them.",
  "locations_step.copy_all_go": "Replace them",
  "locations_step.copy_all_cancel": "Keep them",
  "locations_step.copied": "Applied to {count} branches.",

  "locations_step.continue": "Continue to plans",
  "locations_step.back": "Back",
  "locations_step.go_live": "Put my listing live",
  "locations_step.live_note": "Your listing goes live on Free as soon as you save this. The plan step is next and it is a choice, not a gate.",
  "locations_step.blocked": "Branch {n} still needs {what}.",
  "locations_step.blocked_none": "Add the address buyers should come to before you carry on.",
  "locations_step.gap.area": "an area",
  "locations_step.gap.address": "a street address",
  "locations_step.gap.contact": "a phone number",
  "locations_step.gap.pin": "a pin on the map",
  "locations_step.gap_join": " and ",

  "locations_step.error.landline": "That is a mobile. A landline with its area code — 04 for Dubai, 06 for Sharjah — tells buyers where you are.",
  "locations_step.error.whatsapp": "WhatsApp needs a mobile, like 055 704 1120. A landline makes the button a dead link.",
  "locations_step.error.number": "That is not a UAE number. Write it as 04 340 6688 or 055 704 1120.",
  "locations_step.error.address": "Add the building, street and the landmark you give drivers.",
  "locations_step.error.area": "Pick an area from the list. Every area page is built from it.",
  "locations_step.error.type": "Pick what this branch is.",
  "locations_step.error.pin_bounds": "That pin is outside the UAE. Drag it back to the branch.",
  "locations_step.error.at_cap": "{plan} includes {cap}. Move up a plan to add another branch.",
  "locations_step.error.save_failed": "That did not save. What you typed is still here — try again.",

  // ── Board 2e, the plan step and the first-run checklist ───────────────────
  //
  // The listing is live before this page loads, so nothing here can lean on a
  // withheld listing. Every line argues on merit or states a measured fact, and
  // criterion 2 forbids a countdown, an expiry or a nag against Free.
  "plan_step.title": "You\u2019re live. Now decide how far the storefront goes.",
  "plan_step.live_header": "Your listing is already live on the free plan",
  "plan_step.live_already": "Your listing is already live at {url}. Free is a real plan — you can stay on it.",

  // The sub-line, from the seller's own rows. Criterion 9.
  "plan_step.recommend_lead": "Based on what you told us — {facts}.",
  "plan_step.clause.locations_one": "one location with a {type}",
  "plan_step.clause.locations": "{count} locations, one of them a {type}",
  "plan_step.clause.categories": "listed under {names}",
  "plan_step.clause.catalogue": "a product list to load",
  "plan_step.clause_join": ", ",
  "plan_step.clause_and": " and ",
  // Measured, or absent. Criterion 10 forbids softening it to "many".
  "plan_step.cohort": "{count} of the {total} claimed suppliers in {category} are on {plan}.",

  "plan_step.choose": "Choose {plan}",
  "plan_step.current_plan": "Current plan",
  "plan_step.start_trial": "Start {plan} trial",
  // Criterion 11: this is what the button says once a trial has been used.
  "plan_step.start_on": "Start on {plan}",
  "plan_step.trial_pill": "{days} days free",
  "plan_step.trial_note": "No card. At {days} days it drops back to Free — your products stay saved.",
  "plan_step.trial_active": "Your {plan} trial runs until {date}. Nothing is charged, and it drops back to Free on its own.",
  "plan_step.already_paid": "You are on {plan}. Nothing else to choose here — the checklist below is what is left.",
  "plan_step.stay_free": "Stay on Free",
  "plan_step.done": "Go to my dashboard",

  "plan_step.trial_error.already_used": "That trial has already been used on this listing.",
  "plan_step.trial_error.already_paid": "You are already on a paid plan.",
  "plan_step.trial_error.wrong_plan": "That plan is not on sale.",
  "plan_step.trial_error.not_found": "That listing cannot be found.",

  // The checklist. Same rows as board 8a, worded for the payoff rather than the
  // action — these four are the difference between a live listing and a listing
  // that wins work, and the seller has no reason to believe that yet.
  "plan_step.checklist": "Finish setting up — {n} things left",
  "plan_step.checklist_one": "Finish setting up — one thing left",
  "plan_step.checklist_est": "EST. {n} MIN",
  "plan_step.checklist_done": "Everything is done",
  "plan_step.checklist_done_body": "Nothing is waiting. Your dashboard opens on whatever needs a reply.",
  "plan_step.task_profile": "Profile and description",
  "plan_step.task.photos": "Upload {n} photos of your premises and team",
  "plan_step.task.products": "Pick a spec template and add {n} products",
  "plan_step.task.team": "Invite your sales lead so enquiries don\u2019t sit unanswered",
  "plan_step.cta.photos": "Upload",
  "plan_step.cta.products": "Start",
  "plan_step.cta.team": "Invite",

  // The rail.
  "plan_step.live_at": "YOUR LISTING IS LIVE AT",
  "plan_step.view_it": "View it",
  "plan_step.copy_link": "Copy link",
  "plan_step.copied": "Copied",
  "plan_step.pro_title": "WHAT {plan} CHANGES FOR YOU",
  // Criterion 4: the multiplier and eligibility, never a guaranteed slot.
  "plan_step.pro_ranking": "Your ranking weight for {category} in {emirate} is multiplied {multiplier}×, and you become eligible to buy the sponsored slot.",
  "plan_step.pro_ranking_no_area": "Your ranking weight for {category} is multiplied {multiplier}×, and you become eligible to buy the sponsored slot.",
  // Criterion 5, said out loud rather than left to be inferred.
  "plan_step.pro_weight_note": "Plan is {points} of the {total} points a search score is built from, and the smallest of the six.",
  "plan_step.pro_specs": "Buyers see your stock and specs before they enquire, so your quote goes out quicker.",
  "plan_step.pro_searches": "You see what buyers searched before they called.",
  "plan_step.no_lockin": "No lock-in",
  "plan_step.no_lockin_body": "Cancel any month and drop to Free. Your products stay saved — hidden, not deleted.",
  "plan_step.meta_title": "Pick a plan",

  // ── Setup hub, boards 8a to 8e ────────────────────────────────────────────
  "setup.title": "Finish setting up",
  "setup.eyebrow": "Overview",
  "setup.intro": "Four things, in any order, and you can stop and come back. Each one says what it is worth, because \"complete your profile\" tells nobody anything.",
  "setup.strength": "Profile strength",
  "setup.threshold_note": "80% is where a listing stops looking thin to a buyer.",
  "setup.worth": "Worth {points} points",
  "setup.worth_none": "Does not change your profile strength",
  "setup.minutes": "About {n} minutes",
  "setup.progress": "{got} of {target}",
  "setup.done": "Done",
  "setup.start": "Start",
  "setup.resume": "Carry on",
  "setup.task.photos": "Add photographs",
  "setup.task.photos_body": "The outside of your premises, your trade counter, your team. Photographs are the single biggest reason a buyer opens a listing.",
  "setup.task.products": "Add your first products",
  "setup.task.products_body": "Ten is enough to be found. Fill in the fields marked FILTER and buyers can narrow to you.",
  "setup.task.team": "Invite somebody",
  "setup.task.team_body": "A second person who can answer an enquiry when you are on site.",
  "setup.all_done": "All four are done",
  "setup.all_done_body": "Nothing else is waiting. Your dashboard opens on whatever needs a reply.",
  "setup.to_dashboard": "Go to my dashboard",
  "setup.complete_flash": "Setup complete. Your listing is at {strength}%.",

  // ── The task chrome, shared by boards 8b to 8e ───────────────────────────
  //
  // The rail shows COMPLETION, not position. 8a's premise is that the four
  // tasks are independent and order-free, and a rail that counted steps would
  // re-impose the sequence the hub removed — which is the correction the 8b
  // render carries. So the label says what is still open, not which one this is.
  "task.back": "Setup",
  "task.open_count": {
    one: "{name} · {formatted} of {total} tasks still open",
    other: "{name} · {formatted} of {total} tasks still open",
  },
  "task.all_done": "{name} · nothing left to do",
  "task.skip": "Skip for now",
  "task.save": "Save & back to setup",
  "task.done": "Done — back to setup",
  "task.rail_label": "Setup progress",

  // ── Board 8b — photographs ───────────────────────────────────────────────
  "photos.eyebrow": "Photos",
  "photos.title": "Show buyers the actual place",
  "photos.intro":
    "Five photos is enough. A phone camera is fine — buyers are checking you exist and have stock, not judging photography.",
  "photos.progress": {
    one: "{formatted} of {target} uploaded",
    other: "{formatted} of {target} uploaded",
  },
  "photos.points_so_far": "+{points}% SO FAR",
  "photos.complete": "5 of 5 — that is the set",
  "photos.add": "Add photos",
  "photos.adding": "Adding {formatted}…",
  "photos.cover": "COVER",
  "photos.make_cover": "Make this the cover",
  "photos.remove": "Remove",
  "photos.retry": "Try again",
  "photos.reorder_hint": "Drag a photo to change the order buyers scroll through.",
  "photos.move_up": "Move earlier",
  "photos.move_down": "Move later",
  "photos.logo_tag": "LOGO",
  "photos.suggested": "Suggested",
  "photos.empty_hint": "Nothing here yet. Five photos, and a phone camera is fine.",

  // The gate, explained where it blocks rather than before it.
  "photos.non_logo_short": {
    one: "{formatted} more photo that is not your logo",
    other: "{formatted} more photos that are not your logo",
  },
  "photos.non_logo_why":
    "Five copies of a logo tell a buyer nothing about whether the company is there.",

  // The cap. A ceiling that is stated, never an upgrade wall.
  "photos.at_cap": {
    one: "{formatted} photo is the limit on {plan}.",
    other: "{formatted} photos are the limit on {plan}.",
  },
  "photos.cap_left": {
    one: "{formatted} more will fit on {plan}.",
    other: "{formatted} more will fit on {plan}.",
  },

  "photos.slot.warehouse": "Warehouse floor",
  "photos.slot.warehouse_hint": "Good — shows racking and stock",
  "photos.slot.shopfront": "Shopfront & signage",
  "photos.slot.shopfront_hint": "Good — helps buyers find you",
  "photos.slot.team": "Your team at work",
  "photos.slot.team_hint": "Good — a face makes a listing answerable",
  "photos.slot.vehicle": "Delivery vehicle",
  "photos.slot.vehicle_hint": "Good — shows you deliver yourselves",
  "photos.slot.other": "Anything else",

  "photos.error.unreadable":
    "That file could not be opened as a photo. JPEG, PNG or WebP work everywhere.",
  "photos.error.too_small": "That image is {edge}px on its long edge. Photos need at least {min}px.",
  "photos.error.too_large": "That photo could not be brought under {mb} MB. Try a different one.",
  "photos.error.upload_failed": "That photo did not upload. It is still on your phone — try again.",
  "photos.error.at_cap": "You have reached the photo limit on {plan}.",

  // ── Board 8c — the spec sheet, then the first ten rows ───────────────────
  "products.eyebrow": "First products",
  "products.step1": "Step 1 — which spec sheet fits what you sell?",
  "products.step1_body":
    "We maintain these per category so buyers can compare you against other suppliers on the same rows. Clone one and edit it later if you need to.",
  "products.sheet_meta": "{fields} fields · {required} required · {filterable} filterable",
  "products.sheet_adoption": {
    one: "used by {formatted} supplier",
    other: "used by {formatted} suppliers",
  },
  "products.sheet_matches": "MATCHES YOUR CATEGORY",
  "products.browse_all": {
    one: "Browse all {formatted}",
    other: "Browse all {formatted}",
  },
  "products.browse_body": "Or start from a blank sheet",
  "products.browse_title": "Every spec sheet",
  "products.browse_search": "Search sheets",
  "products.browse_close": "Close",
  "products.choose": "Use this sheet",
  "products.chosen": "In use",

  "products.step2": "Step 2 — add your first ten",
  "products.step2_body":
    "Start with your best sellers. Name, size and availability is enough to go live — specs can follow.",
  "products.no_sheet": "Pick a sheet first.",
  "products.paste": "Paste from Excel",
  "products.paste_hint":
    "Copy the rows out of your spreadsheet and paste them here. Name, size, availability — in that order.",
  "products.paste_apply": "Add these rows",
  "products.paste_landed": {
    one: "{formatted} row added.",
    other: "{formatted} rows added.",
  },
  "products.paste_none": "Nothing in that paste had a product name in the first column.",

  "products.col.img": "IMG",
  "products.col.name": "PRODUCT NAME",
  "products.col.size": "SIZE",
  "products.col.availability": "AVAILABILITY",
  "products.col.specs": "REQ. SPECS",
  "products.col.actions": "Row actions",
  "products.name_placeholder": "Start typing a product name…",
  "products.add_line": "+ Add another line",
  "products.remove_row": "Remove",
  "products.caption": "The products on this listing, with how complete each one's required specs are",
  "products.specs_of": "{filled} / {required}",
  "products.no_specs": "—",
  "products.not_live": "Not live yet — add a size and availability",

  "products.footer": {
    one: "{formatted} live · {more} more to finish this task",
    other: "{formatted} live · {more} more to finish this task",
  },
  "products.footer_done": {
    one: "{formatted} live",
    other: "{formatted} live",
  },
  "products.points_so_far": "+{points}% SO FAR",
  "products.at_cap": {
    one: "{formatted} product is the limit on {plan}.",
    other: "{formatted} products are the limit on {plan}.",
  },
  // The case the Free cap creates: at the limit and still short of the ten,
  // the way forward is filling specs on rows that exist, not adding more.
  "products.at_cap_improve":
    "You are at the limit on {plan}. Fill in the specs on the rows you have to finish this task.",

  "products.no_prices_title": "No prices needed.",
  "products.no_prices_body":
    "Buyers enquire and you quote — that is how most suppliers here prefer it. You can add indicative pricing later if you want to.",

  "products.preview_eyebrow": "LIVE PREVIEW",
  "products.preview_price": "Price on enquiry",
  "products.preview_enquire": "Enquire",
  "products.preview_empty": "Type a product name and this is what a buyer sees.",
  "products.why_title": "Why ten, not one",
  "products.why_body":
    "Each product is its own searchable page. Ten products is roughly ten times the chance of being found — and buyers searching a part number are the ones who convert.",

  "products.availability.in_stock": "In stock",
  "products.availability.made_to_order": "Made to order",
  "products.availability.indent": "Indent order",
  "products.availability.out_of_stock": "Out of stock",

  "products.error.too_short": "A product name needs at least three characters.",
  "products.error.at_cap": "You have reached the product limit on {plan}.",
  "products.error.save_failed": "That row did not save. Try again.",

  "products.change_sheet_title": "Change the spec sheet?",
  "products.change_sheet_body":
    "These attributes are not on the new sheet. The values stay on your products and stop being shown.",
  "products.change_sheet_row": "{label} — on {formatted} products",
  "products.change_sheet_confirm": "Change the sheet",
  "products.change_sheet_cancel": "Keep the one I have",
  "products.meta_title": "First products",

  "photos.works_eyebrow": "WHAT WORKS",
  "photos.works.stock": "Stock on shelves — proves you hold inventory",
  "photos.works.signage": "Your signage — buyers use it to find the unit",
  "photos.works.people": "People working, faces optional",
  "photos.works.no_stock_photos": "Stock photos or renders — we remove these",
  "photos.works.no_screenshots": "Screenshots of your old website",
  "photos.where_title": "Where these appear",
  "photos.where_body":
    "Your cover sits behind the logo on the storefront, and the first image shows in every search result. Both are replaceable later.",
  "photos.meta_title": "Photos",

  // The hero counts what is actually left, so it cannot say "four" over three
  // cards. `formatted` is the count already run through formatCount.
  "setup.hero": {
    one: "One thing left, about {minutes} minutes",
    other: "{formatted} things left, about {minutes} minutes",
  },
  "setup.hero_body":
    "Your listing is live and already being seen. These are what turn a view into an enquiry, and you can do them in any order.",
  "setup.live_pill": "Listing already live",
  "setup.leave_note": "You can leave and come back. Nothing is lost.",

  // ── Board 8e — setup complete ────────────────────────────────────────────
  //
  // The terminal state of the first run. Every figure here is asserted to a
  // seller who has just finished the work and is entitled to believe it, so
  // each clause is separately droppable — see lib/setup/complete.ts.
  "setup_done.eyebrow": "Finish setting up",
  "setup_done.progress": { one: "{formatted} of {total} done", other: "{formatted} of {total} done" },
  "setup_done.pill": "Setup complete",
  "setup_done.title": "Your storefront is working properly now.",
  "setup_done.intro":
    "Nothing else is waiting on you. From here the listing changes because buyers use it, not because you fill anything in.",

  "setup_done.strength": "Profile strength",
  // Only where a baseline was stored and the score is a full hundred. A missing
  // snapshot drops the clause rather than guessing where the seller started.
  "setup_done.strength_rose": "Up from {from}% this morning — every setup task complete",
  "setup_done.strength_rose_partial": "Up from {from}% this morning",
  "setup_done.strength_complete": "Every setup task complete",

  "setup_done.tick.photos": {
    one: "{formatted} photo live, cover set",
    other: "{formatted} photos live, cover set",
  },
  "setup_done.tick.photos_no_cover": {
    one: "{formatted} photo live",
    other: "{formatted} photos live",
  },
  "setup_done.tick.products": {
    one: "{formatted} product indexed on its own page",
    other: "{formatted} products indexed on their own pages",
  },
  "setup_done.tick.team": {
    one: "{formatted} colleague on the enquiry inbox",
    other: "{formatted} colleagues on the enquiry inbox",
  },

  // Hidden entirely when the delta is unavailable. §6: a total must not stand
  // in for a comparison.
  "setup_done.filters": {
    one: "You now appear in {formatted} spec filter you were invisible to this morning.",
    other: "You now appear in {formatted} spec filters you were invisible to this morning.",
  },

  "setup_done.to_dashboard": "Go to my dashboard",
  "setup_done.to_storefront": "View my public storefront",

  "setup_done.changes_eyebrow": "WHAT CHANGES NOW",
  "setup_done.changes_products":
    "Each product has its own page and can be found on its specs, not only your company name.",
  "setup_done.changes_routing":
    "New enquiries follow the routing you set, escalating to you if nobody replies.",
  "setup_done.changes_reply":
    "Your reply time starts being measured from the first enquiry, and buyers see it as a band on every card.",

  // §4. The card that stops a full green meter reading as "you now rank first".
  "setup_done.rank_title": "100% is complete, not first",
  "setup_done.rank_body":
    "Profile strength measures your listing, not your position. {count} things decide where you appear:",
  "setup_done.rank_note":
    "The two you moved this session are marked. Response time is the one you can still change, and it is the one you change by replying.",
  "setup_done.rank.relevance": "Relevance",
  "setup_done.rank.verificationTier": "Verification",
  "setup_done.rank.responseTime": "Response time",
  "setup_done.rank.specCompleteness": "Spec completeness",
  "setup_done.rank.distance": "Distance",
  "setup_done.rank.planTier": "Plan",
  "setup_done.rank_moved": "moved by this session",
  "setup_done.rank_open": "still yours to change",

  "setup_done.once_eyebrow": "YOU WON'T SEE THIS AGAIN",
  "setup_done.once_body":
    "Setup is a first-run flow. Coming back to it sends you to the dashboard instead — everything here stays editable from Listing and Team.",
  "setup_done.meta_title": "Setup complete",

  "setup.now": "Now",
  // Measured where the cohort is big enough, and the mechanism where it is not.
  // Never one standing in for the other — the same rule board 2c set.
  "setup.lift_measured": "{threshold}% — where listings get {multiple}× more enquiries",
  "setup.lift_mechanism": "{threshold}% — where a listing stops looking thin to a buyer",
  "setup.chip_points": "+{points}%",
  "setup.chip_none": "no points",
  "setup.chip_title": "Finishing this adds {points} points to your profile strength.",
  "setup.estimate": "~{n} min",

  // The tasks, as board 8a words them. Sharper than the list wording that came
  // before, and the estimates are from the work rather than from optimism.
  "setup.card.photos": "Upload photographs of your premises and team",
  "setup.card.photos_body":
    "The outside, the trade counter, the racking, whoever answers the phone. A phone camera is fine — buyers are checking you exist, not judging the photography.",
  "setup.card.products": "Pick your spec template, then add products",
  "setup.card.products_body":
    "This is the big one. Products are what buyers search for, and a listing without them only turns up in searches for your company name.",
  "setup.card.team": "Invite whoever answers the phone",
  "setup.card.team_body":
    "An enquiry that sits unanswered for a day is usually gone. A second person on the inbox halves how long a buyer waits.",
  "setup.cta.start": "Start",
  "setup.cta.resume": "Carry on",
  "setup.cta.invite": "Invite",
  "setup.cta.book": "Book",
  "setup.cta.pricing": "See pricing",
  "setup.cta.review": "Review",
  "setup.tag.speed": "SPEED",
  "setup.tag.trust": "TRUST",

  // Done work stays on the page. Sellers look for evidence that what they did
  // was recorded, and a card that vanishes reads as work that was not.
  "setup.done_summary": {
    one: "{formatted} thing done",
    other: "{formatted} things done",
  },
  "setup.done_list": "Done: {list}",

  // The other half of the meter. Board 8a names four tasks worth fifty points
  // between them out of a hundred, so without this a seller can finish
  // everything on offer and still be short with nothing named to do about it.
  "setup.levers_title": "What else the meter counts",
  "setup.levers_body":
    "Profile strength is the whole listing, not only these four. These are the parts you have already started.",
  "setup.lever.identity": "Who you are — description, year founded, size, languages, categories",
  "setup.lever.photos": "Photographs, including your logo and cover",
  "setup.lever.catalogue": "Products on the listing",
  "setup.lever.filterableSpecs": "Products with their filterable fields filled in",
  "setup.lever.team": "Somebody other than you who can reply",
  "setup.lever.earned": "{earned} of {total} points",

  // The right rail. Three counts, and each one says so plainly when it is zero
  // rather than being hidden — the panel's job is to make the tasks feel worth
  // doing, and a hidden zero makes the whole panel unbelievable.
  "setup.rail.eyebrow": "ALREADY HAPPENING",
  // The label beside the numeral, not a sentence containing it. The figure is
  // rendered once, above; a label that repeated it read "48 / 48 views since
  // you went live" on the first listing that had any.
  "setup.rail.views": {
    one: "view since you went live",
    other: "views since you went live",
  },
  "setup.rail.views_none": "No views yet. A new listing usually sees its first within 48 hours.",
  "setup.rail.shortlists": {
    one: "buyer saved you to a shortlist",
    other: "buyers saved you to a shortlist",
  },
  "setup.rail.shortlists_none": "Nobody has saved you to a shortlist yet.",
  "setup.rail.enquiries": {
    one: "enquiry waiting for a reply",
    other: "enquiries waiting for a reply",
  },
  "setup.rail.enquiries_none": "No enquiry is waiting on you.",
  "setup.rail.open_enquiry": "Open the enquiry",
  "setup.rail.open_enquiries": "Open the enquiries",
  "setup.rail.measuring_from": "Counting from {date}, when your listing went up.",

  // The one nudge, and the promise the panel makes on the job's behalf.
  "setup.reminder.title": "We will remind you once",
  "setup.reminder.body":
    "One WhatsApp three days after you went live if anything is still open, then nothing. We do not chase.",
  "setup.reminder.opted_out":
    "You have WhatsApp turned off for alerts, so there will be no reminder. Nothing here expires.",
  "setup.reminder.sent": "Sent on {date}. That was the only one.",

  // Suspension. The hub does not help a seller improve a listing nobody can see.
  "setup.suspended_title": "This listing is suspended",
  "setup.suspended_body":
    "It is off the directory while we look at it, so these tasks would not reach a buyer. The notice on your verification page says what happens next.",
  "setup.suspended_link": "Read the notice",

  // ── Concierge catalogue load. Board 8a's right rail, boards 8c and 12i. ───
  "concierge.eyebrow": "NEED A HAND?",
  "concierge.title": "Send us your catalogue",
  "concierge.body":
    "Send the catalogue or price list you already have as a PDF or a spreadsheet, and our team keys the first {limit} products in for you.",
  "concierge.free_on": "Free on {plan}.",
  "concierge.priced": "AED {fee} on {plan}.",
  "concierge.sla": "Two working days from when it arrives.",
  "concierge.send": "Send us a file",
  "concierge.file_label": "Catalogue or price list",
  "concierge.file_hint": "PDF, XLS, XLSX or CSV, up to {mb} MB.",
  "concierge.note_label": "Anything we should know",
  "concierge.note_hint": "Which pages to use, what to leave out, which brand names are yours.",
  "concierge.submit": "Send it",
  "concierge.sent": "Sent. We will come back within two working days.",
  "concierge.pending": "Sent {when}. Due back by {due}.",
  "concierge.in_progress": "Our team is keying it in now. Due back by {due}.",
  "concierge.loaded": {
    one: "{formatted} product loaded on {date}.",
    other: "{formatted} products loaded on {date}.",
  },
  "concierge.cancel": "Cancel the request",
  "concierge.cancelled": "Cancelled. Send another whenever you like.",
  "concierge.error.no_file": "Attach the catalogue you want us to work from.",
  "concierge.error.too_big": "That file is {size}. The limit is {limit}.",
  "concierge.error.wrong_type": "We can read PDF, XLS, XLSX and CSV. That file is {type}.",
  "concierge.error.already_open": "You already have a catalogue with us. Cancel that one first.",
  "concierge.error.not_offered": "A catalogue load is not part of the Free plan.",
  "concierge.error.upload_failed": "That file did not upload. Try again, or send a smaller one.",


  // ── Shortlist. A buyer keeping a supplier for later. ─────────────────────
  "shortlist.save": "Save for later",
  "shortlist.saved": "Saved",
  "shortlist.save_hint": "Keeps this supplier on your shortlist, on this account.",
  "shortlist.remove": "Remove from shortlist",
  "shortlist.sign_in": "Sign in to save",
  "shortlist.sign_in_hint": "A shortlist follows your account, so it is there on your phone as well.",
  "shortlist.title": "Saved suppliers",
  "shortlist.intro": "Suppliers you kept for later. Removing one here does not tell them.",
  "shortlist.empty": "You have not saved a supplier yet.",
  "shortlist.empty_body": "The save control is on every supplier page and on every result.",
  "shortlist.count": {
    one: "{formatted} saved supplier",
    other: "{formatted} saved suppliers",
  },
  "shortlist.saved_on": "Saved {when}",
  "shortlist.error.signed_out": "Sign in first, and we will keep this one.",
  "shortlist.error.not_found": "That supplier cannot be found.",

  // ── Team invitations. Board 8d's backend, reached from board 7d. ──────────
  "invite.subject": "{inviter} has asked you to join {business} on Business Listings",
  "invite.email_body":
    "{inviter} has given you a seat on {business}. The seat lets you {roles}. Open the link below and sign in with this address.",
  "invite.email_cta": "Accept the invitation",
  "invite.email_expiry": "The link works until {date}.",
  "invite.title": "Join {business}",
  // `{contact}` rather than `{email}`: the same slot now carries a mobile half
  // the time, and a placeholder named for one of its two values is how the
  // wrong noun ends up in the sentence around it.
  "invite.intro": "{inviter} has given you a seat on this listing. Sign in with {contact} to take it.",
  "invite.roles": "The seat lets you {roles}.",
  "invite.accept": "Accept and sign in",
  "invite.accepted_title": "You are on the team",
  "invite.accepted_body": "You now have a seat on {business}. Your dashboard is where the enquiries are.",
  "invite.to_dashboard": "Open the dashboard",
  // Two titles, because the invitation now goes to one of two things. Calling a
  // mobile "a different address" is the screen not knowing what it sent.
  "invite.wrong_account_title": "This invitation is for a different address",
  "invite.wrong_account_title_phone": "This invitation is for a different mobile",
  "invite.wrong_account_body":
    "It was sent to {contact} and you are signed in as {current}. Sign out, then open the link again.",
  "invite.expired_title": "This invitation has expired",
  "invite.expired_body": "Ask {business} to send another. They expire after seven days.",
  "invite.revoked_title": "This invitation was withdrawn",
  "invite.revoked_body": "Ask {business} whether it was meant for you.",
  "invite.used_title": "This invitation has already been used",
  "invite.used_body": "If that was you, sign in and your seat is waiting.",
  "invite.not_found_title": "That invitation link is not one of ours",
  "invite.not_found_body": "Check you copied the whole link, or ask for another.",
  "invite.sign_in": "Sign in to accept",
  "invite.link_label": "Invitation link",
  "invite.link_hint":
    "Send this to them yourself if the email has not arrived. Anyone holding it can take the seat, so send it to them and nobody else.",
  "invite.link_copied": "Copied",
  "invite.copy": "Copy the link",
  "invite.email_sent": "Invitation emailed to {email}.",
  "invite.email_failed":
    "The invitation was created but the email did not send. Copy the link below and send it yourself.",
  "invite.whatsapp_body":
    "{inviter} has given you a seat on {business} on Business Listings. Open the link to set a password and start answering enquiries.",

  // ── Board 8d — the invite screen ─────────────────────────────────────────
  "team_setup.eyebrow": "Invite your team",
  "team_setup.title": "Who else should see enquiries?",
  "team_setup.intro":
    "Enquiries arrive at all hours. One person on the inbox means a slow reply the day they are on site — and reply time is what decides your ranking.",
  "team_setup.contact_label": "Mobile or email",
  "team_setup.contact_placeholder": "Mobile or email",
  "team_setup.role_label": "Role",
  "team_setup.branch_label": "Branch",
  "team_setup.all_branches": "All branches",
  "team_setup.remove_row": "Remove this row",
  "team_setup.add_person": "+ Add another person",
  "team_setup.seats_used": "{used} of {total} seats used on {plan}",
  "team_setup.at_cap": "{plan} has no seat left. Upgrade to invite more people.",
  "team_setup.see_pricing": "See pricing",
  "team_setup.skip": "I work alone — skip",
  "team_setup.send": {
    one: "Send {formatted} invite & back to setup",
    other: "Send {formatted} invites & back to setup",
  },
  "team_setup.send_none": "Back to setup",
  "team_setup.sent": {
    one: "{formatted} invite sent.",
    other: "{formatted} invites sent.",
  },
  "team_setup.some_failed": {
    one: "{formatted} invite sent. The row below still needs fixing.",
    other: "{formatted} invites sent. The rows below still need fixing.",
  },

  // Stated per row and resolved live, because the rail used to promise WhatsApp
  // while the field took an address — and the two channels cost different money.
  "team_setup.by_whatsapp": "Invite goes by WhatsApp",
  "team_setup.by_email": "Invite goes by email",
  "team_setup.ambiguous": "That is not a UAE mobile or an email address.",

  // The tick and the score disagree while an invitation sits unaccepted, and
  // §5 says to state it rather than let the seller discover it.
  "team_setup.tick_note":
    "The task ticks when the invite goes. The {points} points land when they accept and the seat is active.",

  "team_setup.routing_title": "How new enquiries get shared",
  "team_setup.routing.round_robin": "Round-robin",
  "team_setup.routing.by_branch": "Nearest branch",
  "team_setup.routing.everyone": "Everyone sees everything",
  "team_setup.routing_note": "Changeable any time in Team settings.",
  "team_setup.escalation_note": "Anything unanswered for {threshold} escalates to you.",
  // Two units for one number, chosen by whether it divides. The escalation
  // email says "2 hours" because its seeded template renders `{hours}`, and a
  // screen reading "120 minutes" next to a message reading "2 hours" is the
  // same fact told two ways.
  "team_setup.escalation_hours": { one: "{formatted} hour", other: "{formatted} hours" },
  "team_setup.escalation_minutes": { one: "{formatted} minute", other: "{formatted} minutes" },

  "team_setup.role.manager": "Manager",
  "team_setup.role.sales": "Sales",

  "team_setup.sent_rows": "Already invited",
  "team_setup.sent_ago": "Sent {when}",
  "team_setup.resend": "Resend",
  "team_setup.revoke": "Revoke",
  "team_setup.resent": "Sent again.",
  "team_setup.resend_too_soon": "That invitation went recently. You can send it again in an hour.",
  "team_setup.already_seated": "{name} is already on your team.",

  "team_setup.what_eyebrow": "WHAT THEY'LL GET",
  "team_setup.what_body":
    "A link they open on their phone. They set a password, and from then on new enquiries reach them directly — no forwarding, no shared inbox.",
  "team_setup.money_title": "Sales cannot touch the money",
  "team_setup.money_body":
    "A sales seat replies to enquiries and sends quotes. It cannot see invoices, change the plan or edit your licence details.",
  "team_setup.meta_title": "Invite your team",

  "invite.remove_seat": "Remove the seat",
  "invite.remove_confirm": "Remove {name} from the team?",
  "invite.remove_body":
    "They lose access to enquiries, quotes and everything else on this listing. Their replies stay on the threads they answered.",
  "invite.removed": "{name} no longer has a seat.",
  "invite.cannot_remove_owner": "The owner's seat cannot be removed here.",
  "invite.cannot_remove_self": "You cannot remove your own seat.",
  "invite.meta_title": "Team invitation",

  // ── The concierge catalogue queue, /admin/catalogue-imports ──────────────
  "admin.catalogue_imports.title": "Catalogue loads",
  "admin.catalogue_imports.eyebrow": "Supply",
  "admin.catalogue_imports.intro":
    "Catalogues suppliers have sent for our team to key in. Two working days from when one arrives, which is what the seller was told.",
  "admin.catalogue_imports.note":
    "Every move here writes an audit row with the reason you type. The seller sees the state, never the reason.",
  "admin.catalogue_imports.empty": "Nothing waiting.",
  "admin.catalogue_imports.empty_body": "A catalogue sent from a seller's setup hub arrives here.",
  "admin.catalogue_imports.caption": "Catalogues waiting to be keyed in, oldest first",
  "admin.catalogue_imports.col.business": "Supplier",
  "admin.catalogue_imports.col.file": "File",
  "admin.catalogue_imports.col.sent": "Sent",
  "admin.catalogue_imports.col.due": "Due",
  "admin.catalogue_imports.col.fee": "Fee",
  "admin.catalogue_imports.col.state": "State",
  "admin.catalogue_imports.col.action": "Decision",
  "admin.catalogue_imports.late": "{days} days over",
  "admin.catalogue_imports.start": "Start keying it in",
  "admin.catalogue_imports.complete": "Mark it loaded",
  "admin.catalogue_imports.reject": "Send it back",
  "admin.catalogue_imports.products_label": "Products loaded",
  "admin.catalogue_imports.reason_label": "Reason",
  "admin.catalogue_imports.reason_hint": "What you did and why. It goes on the audit row and cannot be edited afterwards.",
  "admin.catalogue_imports.started": "Marked as in progress.",
  "admin.catalogue_imports.completed": "Marked loaded. The seller can see it.",
  "admin.catalogue_imports.rejected": "Sent back to the seller.",
  "admin.catalogue_imports.no_file": "No file",

  // ── Team, board 7d ───────────────────────────────────────────────────────
  "team.revoked": "The invitation to {email} was withdrawn.",



  // ── Commercials ───────────────────────────────────────────────────────────
  "admin.revenue.title": "Revenue",
  "admin.revenue.eyebrow": "Commercials",
  "admin.revenue.meta": "{accounts} paying accounts",
  "admin.revenue.mrr": "Monthly recurring",
  "admin.revenue.annualised": "Annualised",
  "admin.revenue.annualised_caption": "MRR TIMES TWELVE, NOT BOOKED",
  "admin.revenue.accounts": "Paying accounts",
  "admin.revenue.arpa": "Average per account",
  "admin.revenue.by_plan": "By plan",
  "admin.revenue.col.plan": "Plan",
  "admin.revenue.col.accounts": "Accounts",
  "admin.revenue.col.mrr": "Monthly",
  "admin.revenue.col.share": "Share",
  "admin.revenue.waterfall": "Movement, last twelve months",
  "admin.revenue.waterfall_label": "Opening MRR, movement by kind, closing MRR",
  "admin.revenue.step.opening": "Opening",
  "admin.revenue.step.new_business": "New",
  "admin.revenue.step.expansion": "Upgrades",
  "admin.revenue.step.reactivation": "Came back",
  "admin.revenue.step.contraction": "Downgrades",
  "admin.revenue.step.churn": "Churn",
  "admin.revenue.step.closing": "Closing",
  "admin.revenue.churn_rate": "Gross churn, {rate} of opening across {count} accounts",
  "admin.revenue.nrr": "Net revenue retention {rate}",
  "admin.revenue.no_rate": "No opening balance to measure against",
  "admin.revenue.reconciled": "Ledger and subscriptions agree at {amount}",
  "admin.revenue.not_reconciled": "Ledger says {amount}, and does not agree",
  "admin.revenue.unreconciled": "Ledger says {ledger}, subscriptions say {live}. Difference {difference}.",
  "admin.revenue.unreconciled_body": "A plan moved without a movement row, or a plan price was edited after the fact. Both are findable: compare mrr_movement against subscription for the accounts that changed.",
  "admin.revenue.definition": "MRR counts subscriptions that are active or past due. Not trials, which have taken no money, and not cancellations, which show as churn on the day the money stops. Nothing on this page counts what buyers pay suppliers: those payments happen directly between the two of them, the platform is never party to them, and there is no take rate on them. Quoted value is self-reported and lives on marketplace health.",
  "admin.revenue.empty.title": "Nobody is paying yet",
  "admin.revenue.empty.body": "MRR appears when the first subscription starts. The ledger is written as plans change, so this fills in from that moment rather than being backfilled.",
  "admin.subscriptions.title": "Subscriptions",
  "admin.subscriptions.eyebrow": "Commercials",
  "admin.subscriptions.meta": "{count} subscriptions, {grandfathered} on old numbers",
  "admin.subscriptions.caption": "Every subscription, newest first",
  "admin.subscriptions.col.business": "Business",
  "admin.subscriptions.col.plan": "Plan",
  "admin.subscriptions.col.status": "Status",
  "admin.subscriptions.col.monthly": "Monthly",
  "admin.subscriptions.col.term": "Paid",
  "admin.subscriptions.col.renews": "Renews",
  "admin.subscriptions.col.grandfathered": "On old numbers",
  "admin.subscriptions.on_plan": "on the plan",
  "admin.subscriptions.cap.enquiriesPerMonth": "enquiries",
  "admin.subscriptions.cap.productLimit": "products",
  "admin.subscriptions.cap.locationLimit": "locations",
  "admin.subscriptions.cap.photoLimit": "photos",
  "admin.subscriptions.cap.teamSeats": "seats",
  "admin.subscriptions.note": "The last column names the caps this account keeps from the day it signed up, rather than the plan's current ones. It is what a plan edit leaves alone unless somebody ticks apply to existing.",
  "admin.subscriptions.empty.title": "No subscriptions",
  "admin.subscriptions.empty.body": "A subscription is written when a business moves off Free. Free is the default and has no subscription row.",
  "subscription.status.active": "Active",
  "subscription.status.trialing": "Trial",
  "subscription.term.monthly": "Monthly",
  "subscription.term.annual": "Annual",
  "subscription.status.past_due": "Past due",
  "subscription.status.cancelled": "Cancelled",
  "subscription.status.expired": "Expired",

  "admin.plans.title": "Plans & entitlements",
  "admin.plans.eyebrow": "Commercials",
  "admin.plans.meta": "{count} plans",
  "admin.plans.caption": "What each plan allows, and how many accounts an edit would move",
  "admin.plans.col.plan": "Plan",
  "admin.plans.col.price": "Monthly",
  "admin.plans.col.enquiries": "Enquiries",
  "admin.plans.col.products": "Products",
  "admin.plans.col.locations": "Locations",
  "admin.plans.col.photos": "Photos",
  // Megabytes, and the unit is in the header because the field is a bare
  // number. `50` in a column called `Storage` is ambiguous in a way the three
  // plans on this screen would resolve differently.
  /*
     The four columns board 11f compares plans on that had no editor. The
     wave-4 fix batch: a number or a switch a seller reads on the change screen
     and only the database could change.
  */
  "admin.plans.col.categories": "Categories",
  "admin.plans.col.analytics": "Analytics",
  "admin.plans.col.csv": "CSV import",
  "admin.plans.col.sponsored": "Sponsored placement",
  "admin.plans.withdraw_label": "Withdrawn from sale",
  "admin.plans.withdraw_hint": "Nobody new can choose it and no trial can start on it. Everybody already on it stays, at the terms they have.",
  "admin.plans.withdrawn_badge": "Withdrawn",
  "admin.plans.col.sale": "On sale",
  "admin.plans.col.storage": "Storage (MB)",
  "admin.plans.col.seats": "Seats",
  "admin.plans.col.accounts": "Accounts",
  "admin.plans.col.grandfathered": "On old numbers",
  "admin.plans.unlimited": "Unlimited",
  "admin.plans.unlimited_hint": "Empty means unlimited",
  "admin.plans.edit": "Change {plan}",
  "admin.plans.apply_label": "Apply to the {count} accounts already on this plan",
  "admin.plans.apply_hint": "Off by default. A seller who signed up on forty enquiries a month keeps forty until somebody decides otherwise and says why.",
  "admin.plans.reason_label": "Why",
  "admin.plans.reason_hint": "Goes on the audit row with the numbers that moved and how many accounts went with them.",
  "admin.plans.save": "Save the entitlements",
  "admin.plans.saved": "Saved. {count} existing accounts moved.",
  "admin.plans.saved_none": "Saved. Existing accounts keep the numbers they signed up on.",
  "admin.plans.price_note": "Price is not editable here. Changing what a plan costs has a proration and an invoice behind it, and it does not belong on the same form as a cap.",
  "admin.plans.note": "Entitlements are data. Every cap on this page is a column, read at the point of use, and grandfathered per subscription — which is what makes the tick box above a real decision rather than a label.",
  "admin.plans.not_yours": "Plan entitlements are an ops lead or finance decision.",
  "admin.plans.needs_reason": "Say why in a sentence. It goes on the audit row with the numbers that moved.",
  "admin.plans.empty.title": "No plans",
  "admin.plans.empty.body": "Plans are seeded. An empty table means the seed did not run.",

  "admin.dunning.title": "Failed payments",
  "admin.dunning.eyebrow": "Commercials",
  "admin.dunning.meta": "{count} in the sequence",
  "admin.dunning.caption": "Subscriptions past due, and where each is in the sequence",
  "admin.dunning.col.business": "Business",
  "admin.dunning.col.plan": "Plan",
  "admin.dunning.col.stage": "Stage",
  "admin.dunning.col.days": "Days past due",
  "admin.dunning.col.next": "Next",
  "admin.dunning.col.attempts": "Attempts",
  "admin.dunning.stage.none": "Not started",
  "admin.dunning.stage.retry": "Retried",
  "admin.dunning.stage.emailed": "Emailed",
  "admin.dunning.stage.messaged": "Messaged",
  "admin.dunning.stage.final": "Final notice",
  "admin.dunning.stage.dropped": "Dropped to Free",
  "admin.dunning.next.wait": "Nothing due",
  "admin.dunning.next.retry_silently": "Retry the card",
  "admin.dunning.next.send": "Send the {channel} notice",
  "admin.dunning.next.drop_to_free": "Drop to Free",
  "admin.dunning.attempts": "{count} tried",
  "admin.dunning.no_attempts": "none",
  "admin.dunning.sequence": "Day 0 retry, day 3 email, day 7 WhatsApp, day 14 final notice, then the plan drops to Free.",
  "admin.dunning.never": "A drop to Free is a plan change and nothing else. The listing stays live, the catalogue stays visible, the reviews stay, and the badge stays — it records what we checked, and a card expiring does not unverify a trade licence.",
  "admin.dunning.no_gateway": "No payment gateway is configured, so no card is being retried. The sequence still runs and the notices still go out; the attempts column stays empty because nothing was charged.",
  "admin.dunning.empty.title": "Nobody is past due",
  "admin.dunning.empty.body": "A failed card puts a subscription here for fourteen days. Most are an expired card and fix themselves on the first retry.",

  "admin.tax.title": "VAT export",
  "admin.tax.eyebrow": "Commercials",
  "admin.tax.meta": "{count} invoices, {period}",
  "admin.tax.caption": "Issued invoices in the period, with output VAT",
  "admin.tax.period": "Period",
  "admin.tax.download": "Download the CSV",
  "admin.tax.net": "Net",
  "admin.tax.vat": "Output VAT",
  "admin.tax.gross": "Gross",
  "admin.tax.by_emirate": "By emirate",
  "admin.tax.col.invoice": "Invoice",
  "admin.tax.col.issued": "Issued",
  "admin.tax.col.supplier": "Supplier",
  "admin.tax.col.trn": "TRN",
  "admin.tax.col.emirate": "Emirate",
  "admin.tax.col.net": "Net",
  "admin.tax.col.vat": "VAT",
  "admin.tax.col.gross": "Gross",
  "admin.tax.missing_trn": "{count} of these sellers have no TRN recorded. The invoice is still valid; the return will need it.",
  "admin.tax.no_trn": "not recorded",
  "admin.tax.no_emirate": "No head office",
  "admin.tax.total": "{count} invoices",
  "admin.tax.missing_trn_fix": "Ask them for it on the next call. The seller's own billing page is where they enter it.",
  "admin.tax.scope": "Our own subscription and placement invoices only. Nothing a buyer pays a supplier passes through the platform, so there is no VAT position on it here.",
  "admin.tax.empty.title": "No invoices in this period",
  "admin.tax.empty.body": "Drafts and void invoices are left out. Issued, paid and overdue are all included — VAT is due on the supply, not on the payment.",

  "admin.invoices.title": "Invoices & credits",
  "admin.invoices.eyebrow": "Commercials",
  "admin.invoices.meta": "{count} invoices, {outstanding} outstanding",
  "admin.invoices.caption": "Every invoice we have issued, newest first",
  "admin.invoices.col.ref": "Reference",
  "admin.invoices.col.business": "Business",
  "admin.invoices.col.issued": "Issued",
  "admin.invoices.col.status": "Status",
  "admin.invoices.col.lines": "Lines",
  "admin.invoices.col.total": "Total",
  "admin.invoices.lines": "{count} lines",
  "admin.invoices.credit": "credit",
  "admin.invoices.outstanding": "Outstanding",
  "admin.invoices.total_issued": "Issued",
  "admin.invoices.credit_note": "A correction is a subscription credit on the next invoice. Money never goes back out: the platform holds none of a buyer's, and what a seller paid us is settled against what they owe next.",
  "admin.invoices.empty.title": "No invoices",
  "admin.invoices.empty.body": "An invoice is written when a plan change has a net amount. A change with nothing to pay produces no invoice at all.",

  // ── Ranking and boosts, board 12c ─────────────────────────────────────────
  "ranking.title": "Ranking & boosts",
  "ranking.eyebrow": "Supply",
  "ranking.meta": "{live} live boosts, {expired} expired",
  "ranking.tab.weights": "Ranking weights",
  "ranking.tab.boosts": "Manual boosts",
  "ranking.tab.history": "Weight history",
  "ranking.weights": "What decides the order of results",
  // Board 6a §Ranking — the relevance weight on a page with no query.
  "ranking.browse_mode": "What relevance means on a page with no search box",
  "ranking.browse_hint": "Area and emirate landing pages carry no query, so relevance has nothing to score. Share the points out spreads them across the other five in proportion. Score category-match depth keeps them and scores how exactly a listing's own trade matches the page's.",
  "ranking.browse.redistribute": "Share the points out",
  "ranking.browse.category_depth": "Score category-match depth",
  "ranking.browse_preview": "Effective on browse pages, with this draft",
  // Replaces the ratio rule this screen shipped with. Board 12c criterion 2:
  // the total is what makes a boost point mean a fixed thing.
  "ranking.weights_hint": "The six always add to 100. Boost points are added to this scale, not multiplied into it, so five points has to mean the same thing in November as it did in June. Raising one factor lowers the others in proportion; pinned factors absorb nothing.",
  "ranking.weights_total": "Six factors · draft total {total}",
  "ranking.weights_total_live": "Six factors · live total {total}",
  "ranking.weight.relevance": "Relevance to the query",
  "ranking.weight.verificationTier": "Verification tier",
  "ranking.weight.responseTime": "Measured reply time",
  "ranking.weight.specCompleteness": "Spec completeness",
  "ranking.weight.distance": "Distance from the buyer",
  "ranking.weight.planTier": "Plan tier",
  "ranking.weight.pinned": "pinned",
  "ranking.weight.pinned_capped": "pinned, ceiling {ceiling}",
  "ranking.weight.response_note": "Named to sellers by 3a and 3l when they explain a position change.",
  "ranking.plan_cap": "Plan stops at 10, in the database as well as here. Above that the results start reading as bought — and the subscription only holds if being found is worth paying for.",
  "ranking.effective_note": "{leader} overtakes {runner_up}, and plan tier rises from {authored} to {effective} — without anyone having moved the plan slider.",
  "ranking.effective_leads": "{leader} still leads, and plan tier rises from {authored} to {effective} — without anyone having moved the plan slider.",
  "ranking.effective_flat": "Nothing moves: with the points kept where they are, a browse page ranks on the same six numbers a search does.",

  // The three steps. Save writes a draft, preview measures it, publish sends it.
  "ranking.step.draft": "Draft saved",
  "ranking.step.draft_none": "No draft",
  "ranking.step.draft_none_body": "Search is running on the live weights. Move a factor to start one.",
  "ranking.step.draft_body": "{moved}. {author}, {when}.",
  "ranking.step.draft_unchanged": "Search is unchanged.",
  "ranking.step.preview": "Impact preview",
  "ranking.step.preview_none": "Not run",
  "ranking.step.preview_none_body": "Run it to see which categories move and who falls.",
  "ranking.step.preview_running": "Running",
  "ranking.step.preview_running_body": "Ranking the directory against the draft.",
  "ranking.step.preview_stale": "Stale",
  "ranking.step.preview_stale_body": "The draft moved after this ran. Run it again before publishing.",
  "ranking.step.preview_fresh": "Fresh · {when}",
  "ranking.step.preview_body": "{categories} move, {listings}. Sampled nightly, exhaustive on demand.",
  "ranking.step.publish": "Publish",
  "ranking.step.publish_body": "Reorders results and tells up to {count}.",
  "ranking.step.publish_blocked": "Publish needs a fresh preview.",
  "ranking.count.categories": { one: "1 category", other: "{count} categories" },
  "ranking.count.listings": { one: "1 listing", other: "{count} listings" },
  "ranking.count.sellers": { one: "1 seller", other: "{count} sellers" },
  "ranking.run_preview": "Run the impact preview",
  "ranking.rerun_preview": "Run it again",
  "ranking.discard": "Discard draft",
  "ranking.discarded": "Draft discarded. The live weights never moved.",
  "ranking.publish": "Publish — up to {count} told",
  "ranking.save": "Save draft",
  "ranking.draft_saved": "Draft saved. Search results are unchanged until you publish.",
  "ranking.published": "Published. Search results reorder on the next request, and up to {count} will see a note on their dashboard.",
  "ranking.preview_ran": "Preview ran. {categories} move, {listings}.",
  "ranking.not_yours": "Ranking and boosts are an ops lead decision.",
  "ranking.read_only": "You can read these numbers and not change them. They are how anyone here answers a seller asking why they moved.",

  // What publishing would change.
  "ranking.impact": "What publishing would change",
  "ranking.impact_hint": "Against the live weights, on last night's sample.",
  "ranking.impact.scope": "{category} · {scope}",
  "ranking.impact.countrywide": "UAE",
  "ranking.impact.caption": "Categories that move if this draft is published",
  "ranking.impact.col.category": "Category",
  "ranking.impact.col.moving": "Listings moving",
  "ranking.impact.col.fall": "Biggest fall",
  "ranking.impact.col.gains": "Who gains",
  "ranking.impact.moving": "{moving} of {total}",
  "ranking.impact.fall": "{places} {name}",
  "ranking.impact.no_fall": "Nothing falls",
  "ranking.impact.gains.relevance": "Closer category matches",
  "ranking.impact.gains.verificationTier": "Verified suppliers",
  "ranking.impact.gains.responseTime": "Fast repliers under 6h",
  "ranking.impact.gains.specCompleteness": "Complete spec sheets",
  "ranking.impact.gains.distance": "Suppliers near the buyer",
  "ranking.impact.gains.planTier": "Paid plans",
  "ranking.impact.gains.none": "No material change",
  "ranking.impact.note": "Ordered by listings moved. A category where nothing moves is not listed. Browse pages are sampled under the mode above, not under the raw weights.",
  "ranking.impact.empty": "Nothing moves. The draft reorders no category on last night's sample.",
  "ranking.impact.unread": "{count} past the sampling cap were not ranked. The rows above cover the rest.",

  // What the sellers read.
  "ranking.disclosure": "What publishing tells sellers",
  "ranking.disclosure_body": "{scope} hold a listing in the categories that move. The note — “We changed how search results are ordered on {when}. This affected every listing in the category.” — reaches the {count} whose position actually changes, and nobody who held their place.",
  "ranking.disclosure_note": "They are not told which weight moved or by how much. Only a publish fires it — saving a draft tells nobody, and the count is derived from the preview, so it moves when the draft does.",

  // The zero-result count. Same label as the console metric that routes here.
  "ranking.zero_results": "Searches that found nothing",
  "ranking.zero_results_body": "Last 30 days. A search with no results is a supply gap with a category and an emirate already attached to it.",
  "ranking.zero_results_link": "Work the gaps as a call list in Ops CRM",

  "ranking.boosts": "Manual boosts",
  "ranking.boosts_hint": "A boost is us moving a listing for a reason of ours. It is never labelled sponsored, because nobody paid for it — a sold slot is a placement, appears once per results page, and carries a label.",
  "ranking.boosts_active": "{count} active",
  "ranking.col.business": "Target",
  "ranking.col.points": "Points",
  "ranking.col.reason": "Why",
  "ranking.col.author": "By",
  "ranking.col.expires": "Until",
  "ranking.col.state": "State",
  "ranking.live": "Live",
  "ranking.expired": "Expired",
  "ranking.points_value": "+{points} pts",
  "ranking.boost.category_all": "{category} · all",
  "ranking.boost.category_scope": "{category} · {emirate}",
  "ranking.boost.spends": "Spends {points} of every member business's {max}.",
  "ranking.boost.stacking": "{held} of {max} — stacks with {with}",
  "ranking.add_boost": "Add a boost",
  "ranking.boost_target": "What it lifts",
  "ranking.boost_target.business": "One listing",
  "ranking.boost_target.category": "A category",
  "ranking.business_id": "Listing id",
  "ranking.category_id": "Category id",
  "ranking.boost_emirate": "Emirate",
  "ranking.boost_emirate_hint": "Leave it on the whole country unless the gap is in one emirate.",
  "ranking.boost_emirate_all": "The whole country",
  "ranking.points": "Points",
  "ranking.points_hint": "1 to 25, added to the score. More than that replaces the ranking rather than nudging it.",
  "ranking.expires": "Expires",
  "ranking.expires_hint": "At most 90 days. Renew it if it is still the right call then.",
  "ranking.boost": "Boost it",
  "ranking.boosted": "Boosted. It applies on the next search.",
  "ranking.boosts_empty": "No boosts. That is the right number most of the time.",
  "ranking.boosts_footer": "Every boost needs a reason and an expiry, both required, and lasts at most 90 days. A business can hold {max} points at once, counting category boosts it falls under — the same ceiling as a single boost. Boosts only raise. Removing a business from results is a suspension, taken on Businesses.",
  "ranking.note": "Expired boosts stay on this list. They are the record of why the results looked the way they did, and a boost with no reason and no end date is the failure mode a manual override actually has.",

  // Weight history.
  "ranking.history": "Weight history",
  "ranking.history_hint": "Every published change, newest first. A draft that was never published is not here, because it never reordered anything.",
  "ranking.history.caption": "Published ranking changes, newest first",
  "ranking.history.col.when": "Published",
  "ranking.history.col.moved": "What moved",
  "ranking.history.col.reason": "Why",
  "ranking.history.col.author": "By",
  "ranking.history.col.told": "Sellers told",
  "ranking.history.first": "The first recorded vector",
  "ranking.history.mode": "Browse mode",
  "ranking.history.empty": "Nothing published yet. The weights are the ones the platform shipped with.",
  "ranking.history.vector": "Relevance {relevance} · Verification {verificationTier} · Reply {responseTime} · Spec {specCompleteness} · Distance {distance} · Plan {planTier}",

  // Refusals. Each says what is wrong and what correct looks like.
  "ranking.refuse.out_of_range": "Each weight is a whole number from 0 to 100.",
  "ranking.refuse.total_not_100": "The six add to {total}, and they have to add to {expected}. A boost is added to this scale rather than multiplied into it, so the scale has to be the same size every time.",
  "ranking.refuse.plan_tier_too_high": "Plan tier stops at {ceiling}. Above that the results start reading as bought, and a directory that sells its way to the top is one nobody comes back to.",
  "ranking.refuse.browse_plan_tier_too_high": "On a page with no search box the relevance points are shared out, which would take plan tier to {effective} even though you set it to {authored}. The ceiling is {ceiling}. Lower relevance, or switch the browse mode to score category-match depth.",
  "ranking.refuse.unknown_browse_mode": "A page with no query either shares the relevance points out or scores them as category-match depth. There is no third answer, and leaving the weight to multiply zero is not one of the two.",
  "ranking.refuse.nothing_changed": "Those are the numbers it already has.",
  "ranking.refuse.no_draft": "There is no draft to publish.",
  "ranking.refuse.preview_missing": "Run the impact preview first. Publishing without one is telling several hundred sellers something nobody has read.",
  "ranking.refuse.preview_running": "The preview is still running. Publishing on a half-finished ranking would state a count nobody has checked.",
  "ranking.refuse.preview_stale": "The draft moved after the preview ran, so the count on the button describes a draft that no longer exists. Run it again.",
  "ranking.boost.not_found": "That listing is not here.",
  "ranking.boost.category_not_found": "That category is not here.",
  "ranking.boost.no_target": "A boost lifts one listing or one category. Name which.",
  "ranking.boost.two_targets": "A boost lifts one listing or one category, not both. One points value cannot mean two things.",
  "ranking.boost.emirate_without_category": "An emirate narrows a category boost. A listing already knows where it trades.",
  "ranking.boost.points_out_of_range": "A boost is 1 to {max} points. More than that replaces the ranking rather than nudging it.",
  "ranking.boost.expiry_in_the_past": "An expiry in the past is a boost that never applies.",
  "ranking.boost.expiry_too_far": "A boost runs for at most {days} days. Renew it if it is still the right call then.",
  "ranking.boost.budget_exceeded": "{business} already holds {held} of {max} points, from {spent}. Boosts stack, so this one would push the total past the ceiling — and a listing carrying more than {max} is not being nudged, it is being placed.",

  // ── Redirects and the home page, board 12g ────────────────────────────────
  "redirects.title": "Redirects",
  "redirects.eyebrow": "Content",
  "redirects.meta": "{count} live redirects",
  "redirects.caption": "Every path that redirects, newest first",
  "redirects.col.from": "From",
  "redirects.col.to": "To",
  "redirects.col.code": "Code",
  "redirects.col.business": "Listing",
  "redirects.col.added": "Added",
  "redirects.add": "Add a redirect",
  "redirects.add_hint": "Most redirects are written for you — a merged listing, a renamed page, a moved slug. This is for the ones that are not: an address printed somewhere before it existed.",
  "redirects.from": "From",
  "redirects.to": "To",
  "redirects.from_hint": "A path, starting with a slash.",
  "redirects.create": "Add it",
  "redirects.added": "Added. It takes effect on the next request.",
  "redirects.remove": "Remove {path}",
  "redirects.removed": "Removed. The audit row is the only record it existed.",
  "redirects.remove_hint": "A redirect that has been out in the world is a link somebody may still follow.",
  "redirects.empty": "No redirects yet.",
  "redirects.note": "One hop, never two. A redirect pointing at another redirect is refused: a visitor would take two hops and a crawler would discount the second.",

  "home.title": "Home page",
  "home.eyebrow": "Content",
  "home.meta": "{count} trades on the home page",
  "home.caption": "Which trades the directory home leads with",
  "home.popular_title": "Popular searches on the home page",
  "home.popular_note":
    "The five chips under the hero are the most-searched terms of the last 30 days that returned something. Read from the search log, never chosen — a staff pick would make the row a marketing slot.",
  "home.popular_caption": "Search terms over the last 30 days",
  "home.popular_col_query": "Term",
  "home.popular_col_searches": "Searches",
  "home.popular_col_state": "On the home page",
  "home.popular_on_home": "Showing",
  "home.popular_ranked": "Ranked below",
  "home.popular_unanswered": "No results",
  "home.popular_empty": "No searches recorded yet. The home page is showing its fallback five.",
  "home.col.trade": "Trade",
  "home.col.listings": "Listings",
  "home.col.page": "Its own page",
  "home.col.shown": "On the home page",
  "home.publishes": "Publishes",
  "home.thin": "Does not publish",
  "home.toggle": "Show {trade} on the home page",
  "home.saved": "Saved. {count} trades on the home page.",
  "home.note": "A trade whose own landing page does not publish cannot be featured. The home page is the most-linked page on the site, and a link from it to a thin page is the worst one to have.",
  "home.empty": "No trades. The taxonomy is seeded, so something is wrong if this is empty.",

  // ── Localisation, board 12g ───────────────────────────────────────────────
  "strings.title": "Localisation",
  "strings.eyebrow": "Content",
  "strings.meta": "{keys} strings, {words} words, {locales} locale",
  "strings.caption": "Every string in the catalogue",
  "strings.col.key": "Key",
  "strings.col.text": "English",
  "strings.search": "Search the catalogue",
  "strings.search_placeholder": "A key or a phrase",
  "strings.clear": "Clear the search",
  "strings.plural": "plural",
  "strings.interpolated": "has placeholders",
  "strings.no_match": "Nothing matches that.",
  "strings.sections": "By section",
  "strings.col.section": "Section",
  "strings.col.keys": "Keys",
  "strings.col.words": "Words",
  "strings.col.plural": "Plural",
  "strings.col.interpolated": "Placeholders",
  "strings.longest": "The longest single string is {key}, at {words} words. Arabic and German both run longer than English, so it is the one to check a layout against first.",
  "strings.read_only": "This is a report, not an editor.",
  "strings.read_only_body": "The catalogue is a TypeScript file and t() is typed against its keys, which is what makes a missing string a build failure rather than a blank space on a page. Editing strings at runtime would need an override table read by t(), and the trade is: a typo becomes fixable without a deploy, and in exchange every string becomes nullable, the key type stops being exhaustive, and a row nobody reviewed wins over a string somebody did.",
  "strings.arabic": "Adding Arabic is a data change and a stylesheet review rather than a rebuild: a second file beside this one, and a pass over anything that assumes text runs left to right. Nothing here assumes it — the layout uses logical properties throughout and the dir attribute is already a variable.",

  // ── Notification templates, board 12g ─────────────────────────────────────
  "notifications.title": "Notification templates",
  "notifications.eyebrow": "Content",
  "notifications.meta": "{live} live across {events} events, {dormant} events nothing sends yet",
  "notifications.caption": "Every notification template, newest version first",
  "notifications.col.event": "Event",
  "notifications.col.channel": "Channel",
  "notifications.col.version": "Version",
  "notifications.col.status": "Status",
  "notifications.col.body": "Body",
  "notifications.status.draft": "Draft",
  "notifications.status.pending_meta": "With Meta",
  "notifications.status.live": "Live",
  "notifications.status.retired": "Retired",
  "notifications.dormant": "nothing sends this yet",
  "notifications.dormant_hint": "The event is declared and templates exist for it, but nothing in the product emits it. The copy is worth writing when the emitter lands, and not before.",
  "notifications.broken": "uses {count} it does not get",
  "notifications.edit": "Edit {event} on {channel}",
  "notifications.subject": "Subject",
  "notifications.body": "Body",
  "notifications.action_label": "Action label",
  "notifications.action_path": "Action link",
  "notifications.meta_name": "Meta template name",
  "notifications.meta_name_hint": "The name Meta approved this wording under. WhatsApp will not send without it.",
  "notifications.available": "This event supplies: {params}",
  "notifications.available_none": "This event supplies nothing, because nothing emits it yet. A placeholder here would fail to send.",
  "notifications.unknown": "{names} — this event does not supply that, so it would fail to send rather than send with a gap.",
  "notifications.save": "Save as a new version",
  "notifications.saved": "Saved as version {version}, as a draft.",
  "notifications.submit_meta": "Send to Meta",
  "notifications.submitted": "Sent to Meta. It goes live once they approve the wording.",
  "notifications.publish": "Put it live",
  "notifications.live": "Live. The version it replaced is retired.",
  "notifications.not_yours": "Notification templates are an ops lead decision.",
  "notifications.empty": "No templates. They are seeded, so something is wrong if this is empty.",
  "notifications.note": "An edit writes a new version rather than changing this one, because a delivery record points at the template that produced it — editing in place would make what a seller was sent last week become what the template says today. WhatsApp goes to Meta before it goes live; nothing else does.",

  // ── The page matrix, board 6f ─────────────────────────────────────────────
  "matrix.title": "Page matrix",
  "matrix.eyebrow": "Content",
  "matrix.meta": "{publishable} of {total} pages publish, {copy} waiting only on copy",
  "matrix.caption": "Every landing page the directory generates, and what is holding each one back",
  "matrix.col.path": "Address",
  "matrix.col.name": "Page",
  "matrix.col.listings": "Listings",
  "matrix.col.verified": "Verified",
  "matrix.col.words": "Words",
  "matrix.col.state": "State",
  "matrix.col.edit": "Edit",
  "matrix.publishes": "Publishes",
  "lists_admin.title": "Curated lists",
  "lists_admin.eyebrow": "Editorial",
  "lists_admin.meta": "{count} lists, {overdue} past their re-audit date.",
  "lists_admin.caption": "Every curated list, with when it was last audited",
  "lists_admin.col.list": "List",
  "lists_admin.col.entries": "Entries",
  "lists_admin.col.audited": "Audited",
  "lists_admin.col.due": "Re-audit due",
  "lists_admin.col.drift": "Drift",
  "lists_admin.col.state": "State",
  "lists_admin.state.published": "Published",
  "lists_admin.state.overdue": "Re-audit due",
  "lists_admin.state.draft": "Not published",
  "lists_admin.empty": "No curated lists yet.",
  "lists_admin.note": "A list is a snapshot with a written method, so nothing here reorders one. Drift is a member whose reply time, review count or position has moved away from what the prose says about them — it is flagged for a person because the alternative is a machine rewriting an editor's sentence.",
  "matrix.tab.matrix": "Page matrix",
  "matrix.tab.lists": "Curated lists",
  "matrix.tab.guides": "Guides",
  "matrix.tab.redirects": "Redirects",
  "matrix.tab.home": "Homepage curation",
  "matrix.tabs_label": "Content and SEO sections",
  "matrix.generate_drafts": { one: "Generate {count} draft", other: "Generate {count} drafts" },
  "matrix.generate_none": "Nothing waiting on copy",
  "matrix.generate_confirm": "Create the drafts",
  "matrix.generate_hint": "Creates an empty page for every scope that is above its floors and unwritten. It never publishes one — a person writes the copy and publishes it from the row.",
  "matrix.drafts_made": {
    one: "{count} draft created. It is waiting on a writer.",
    other: "{count} drafts created. They are waiting on a writer.",
  },
  "matrix.sitemap_status": "Sitemap status",
  "matrix.sitemap_note": "Submission and crawl figures come from Search Console, which is not connected. The sitemap itself is at /sitemap.xml and contains only pages that are live now.",
  "matrix.metric.pages_live": "Pages live",
  "matrix.metric.organic_sessions": "Organic sessions",
  "matrix.metric.organic_enquiry": "Organic to enquiry",
  "matrix.metric.below_floor": "Below their need",
  "matrix.metric.awaiting_copy": "Awaiting copy",
  "matrix.metric.this_month": "+{count} this month",
  "matrix.metric.not_recorded": "Not recorded",
  "matrix.metric.no_analytics": "No analytics or Search Console import exists yet, so there is no figure to show. It is left blank rather than estimated.",
  "matrix.filter.category": "Trade",
  "matrix.filter.emirate": "Emirate",
  "matrix.filter.all": "All",
  "matrix.filter.apply": "Filter",
  "matrix.col.page": "Page",
  "matrix.col.have_need": "Have / need",
  "matrix.col.searches": "Searches a month",
  "matrix.col.sessions": "Sessions",
  "matrix.col.status": "Status",
  "matrix.need_demand": "{need} — the searches set this floor, not the {absolute} listing minimum",
  "matrix.need_absolute": "{need} — the listing minimum",
  "matrix.status.live": "Live",
  "matrix.status.live_thin_copy": "Live · thin copy",
  "matrix.status.queued_copy": "Queued · copy",
  "matrix.status.recruit": "Recruit · {count}",
  "matrix.status.held_supply": "Held · thin supply",
  "matrix.status.held_editorial": "Held · editorial",
  "matrix.owner.none": "No owner",
  "matrix.owner.content_ops": "Content ops",
  "matrix.owner.ops_crm": "Ops CRM",
  "matrix.owner.editorial": "Editorial",
  "matrix.rows_caption": "Every area in this emirate for this trade, with what it has and what it needs",
  "matrix.rows_empty": "No areas match that filter.",
  "matrix.page_of": { one: "Page {page} of {pages}, {total} row", other: "Page {page} of {pages}, {total} rows" },
  "matrix.prev": "Previous",
  "matrix.next": "Next",
  "matrix.opportunity_lead": "Largest opportunity: {path}, {searches} searches a month against {shortfall} listings still needed.",
  "matrix.opportunity_none": "Every area in this filter meets its need. There is no recruitment shortfall to rank.",
  "matrix.opportunity_metric": "Opportunity is monthly searches divided by listings still needed — demand unlocked per supplier recruited. It is not raw demand, which favours pages that are almost there, and not raw shortfall, which favours near-empty areas nobody searches.",
  "matrix.send_crm": "Send {count} to ops CRM",
  "matrix.send_crm_note": "The supply-gap campaign this creates belongs to board 12d, which is not built. The shortfall list is on this screen in the meantime.",
  "matrix.vintage": "Search volume from {sources}, oldest figure {date}.",
  "matrix.vintage_none": "No search volume has been recorded yet. Every row is measured against the listing minimum alone.",
  "matrix.demand_saved": "Search volume recorded.",
  "matrix.demand": "Searches a month",
  "matrix.demand_source": "Source",
  "matrix.demand_captured": "True as of",
  "matrix.demand_hint": "A third-party keyword figure. It raises this scope's floor, so it travels with where it came from and when it was true.",
  "matrix.held": "Held. The page is down and no job will put it back.",
  "matrix.released": "Hold lifted. The page returns only if it clears its floors.",
  "matrix.hold": "Hold this page",
  "matrix.release": "Lift the hold",
  "matrix.hold_hint": "A hold takes the page down now and is never cleared automatically. Lifting it restores the arithmetic rather than publishing the page.",
  "matrix.held_by": "Held on {date}: {reason}",
  "rules.title": "Publishing rules",
  "rules.subtitle": "Six numbers that decide which {trade} pages exist. Every one of them republishes the site, so a change is proposed here and applied by somebody else.",
  "rules.publishThreshold": "Absolute floor",
  "rules.demandPerThousand": "Per 1,000 searches",
  "rules.verifiedShareMin": "Verified share",
  "rules.minIntroWords": "Word floor",
  "rules.holdShare": "Stays live at",
  "rules.minLiveDays": "Minimum days live",
  "rules.humanReviewRequired": "Human review before publishing",
  "rules.preview": "Preview the change",
  "rules.propose": "Propose",
  "rules.approve": "Approve and apply",
  "rules.reject": "Reject",
  "rules.withdraw": "Withdraw",
  "rules.proposed": "Proposed. It applies when a second ops lead approves it.",
  "rules.approved": "Applied. {publishes} pages publish, {unpublishes} come down.",
  "rules.rejected": "Rejected.",
  "rules.withdrawn": "Withdrawn.",
  "rules.impact": "Publishes {publishes}, unpublishes {unpublishes}, queues {queued} for copy.",
  "rules.impact_none": "No page changes state.",
  "rules.unpublishing": "Coming down",
  "rules.publishing": "Going live",
  "rules.col.rule": "Rule",
  "rules.col.live": "Live",
  "rules.col.proposed": "Proposed",
  "rules.pending": "Waiting on a second approver",
  "rules.pending_by": "Proposed by {who} on {date}: {reason}",
  "rules.pending_counted": "Counted {date}, against the supply there was then. Supply moves nightly, so it is counted again at the moment of approval and that figure is what goes in the audit log.",
  "rules.pending_live": "The matrix keeps computing on the live values until this is approved.",
  "rules.last_edited": "Last changed {date} by {who}, approved by {approver}.",
  "rules.never_edited": "These are the values this trade has always had.",
  "rules.second_approver": "A rule change takes two ops leads. The person who proposes one cannot approve it.",
  "rules.reason": "Why",
  "rules.no_change": "Change a value to preview it.",
  "queues.title": "Editorial queues",
  "queues.awaiting_copy": "Area pages awaiting copy",
  "queues.thin_copy": "Live pages under the word floor",
  "queues.list_reaudit": "Curated lists due a re-audit",
  "queues.list_drift": "Lists where the ranking left the prose",
  "queues.guide_overdue": "Guides overdue a regulatory re-check",
  "queues.owner": "Owner: {owner}",
  "queues.count": "{count} waiting",
  "queues.clear": "Nothing waiting.",
  "queues.open": "Open",
  "matrix.gate.copy": "needs copy",
  "matrix.gate.listings": "too few listings",
  "matrix.gate.verified": "too few verified",
  "matrix.gate.faq": "needs questions",
  "matrix.write": "Write the intro for {page}",
  "matrix.intro": "Intro",
  "matrix.intro_hint": "What this trade is, who buys it, and what a buyer should look for. The word count under the box is measured against this trade's own floor, and it is a floor rather than a target — a paragraph that repeats the category name eight times clears it and helps nobody.",
  "matrix.word_count": "{count} words",
  "matrix.reason_hint": "Goes on the audit row beside the thresholds this copy is measured against.",
  "matrix.save": "Save the intro",
  "matrix.saved": "Saved.",
  "matrix.not_yours": "Taxonomy and landing-page copy are an ops lead decision.",
  "matrix.empty": "No categories. The taxonomy is seeded, so something is wrong if this is empty.",
  "matrix.note": "A category page publishes on three gates: enough listings, enough of them verified, and enough words of its own. The first two arrive on their own schedule. The third is the one somebody can fix this afternoon, which is why it sorts first. The floors are per trade and are edited in the rules panel above.",
  "matrix.copy_only": "{count} pages would publish today if somebody wrote a paragraph.",
  "matrix.blocked_by": "Held by: {gates}.",

  // ── Template pages, board 5d ──────────────────────────────────────────────
  "pages.title": "Pages",
  "pages.eyebrow": "Storefronts",
  "pages.meta": "{count} pages, on {stores} storefronts",
  "pages.add_title": "New page",
  "pages.add_hint": "About, Projects and Certifications are usually enough. Those are the ones that rank for company-name and credential searches.",
  "pages.slug": "Address",
  "pages.slug_hint": "Lowercase letters, numbers and hyphens. Fixed once the page is live.",
  "pages.page_title": "Title",
  "pages.add": "Create it",
  "pages.added": "Created as a draft. Nothing is live until you publish it.",
  "pages.published": "Live on {count} storefronts.",
  "pages.save": "Save the draft",
  "pages.publish": "Publish",
  "pages.renamed": "Renamed.",
  "pages.renamed_with_redirects": "Renamed. {count} storefronts now redirect from the old address.",
  "pages.rename": "Change the address",
  "pages.rename_locked": "This page is live, so its address is fixed. Changing it now sends every old link to the new one with a permanent redirect.",
  "pages.meta_description": "Meta description",
  "pages.meta_counter": "{count} of 160",
  "pages.meta_over": "{count} of 160 — search results will cut it off",
  "pages.show_in_nav": "Show in the storefront nav",
  "pages.allow_indexing": "Let search engines index it",
  "pages.allow_indexing_hint": "Off for a page that exists for buyers rather than for search. A thin page on 1,842 storefronts is what search engines call doorway content.",
  "pages.blocks": "Blocks",
  "pages.add_block": "Add a block",
  "pages.remove_block": "Remove {block}",
  "pages.no_blocks": "Nothing on this page yet. Add a block from the list.",
  "pages.check": "Content check",
  "pages.check_hint": "Advisory. This page appears on every storefront in the trade, so a thin one is not one thin page — it is all of them, which is the shape search engines treat as doorway content.",
  "pages.check_summary": "{passed} of 4",
  "pages.check.length": "Over 250 words",
  "pages.check.length_detail": "{count} words",
  "pages.check.local": "Mentions the trade and the area",
  "pages.check.local_trade": "no mention of the trade",
  "pages.check.local_place": "no mention of an emirate or area",
  "pages.check.image_alt": "Has an image, and it is described",
  "pages.check.image_alt_none": "no image",
  "pages.check.image_alt_some": "{detail} described",
  "pages.check.internal_link": "Sends the reader to the catalogue",
  "pages.status.draft": "Draft",
  "pages.status.live": "Live",
  "pages.status.retired": "Retired",
  "pages.empty": "No pages on this template yet.",
  "pages.back": "Back to the builder",

  "block.heading": "Page heading",
  "block.text": "Text",
  "block.image_text": "Image and text",
  "block.numbers": "Numbers row",
  "block.timeline": "Timeline",
  "block.gallery": "Image gallery",
  "block.certifications": "Certifications",
  "block.cta": "Call to action",

  // ── Custom domains, board 5e ──────────────────────────────────────────────
  "nav.domain": "Web address",
  "domain.title": "Your own web address",
  "domain.eyebrow": "Storefront",
  /*
     Board 5e's copy, rewritten for the second model.

     The first sold a subdomain of a domain the seller owns, pointed at us with
     a CNAME and a TXT record. Twenty-eight of the strings below described that
     flow — records to copy, propagation, a 24-hour clock, five named failure
     causes and a certificate we had no way to issue. A seller gets a label
     under our own zone now, so none of it has anything to describe.

     Nothing here says "custom domain". It is their address on our directory,
     and calling it a domain would invite the question this model exists to stop
     answering: which domain, and who verifies it.
  */
  "domain.explain": "Your storefront on an address you can read out over the phone. It sits under businesslistings.me, it works the moment you take it, and there is nothing to set up at a registrar.",
  "domain.hostname": "Your address",
  "domain.proposed": "The address you would get",
  "domain.proposed_hint": "Taken from your listing name, so it matches the storefront somebody lands on. Change your listing name and this stays as it is — an address that moves is an address nobody can print.",
  "domain.claim": "Take this address",
  "domain.added": "It is live. Try it.",
  "domain.live_note": "Your Business Listings address keeps working and keeps the search ranking it has built. This one is the one to print.",
  "domain.remove": "Give up this address",
  "domain.remove_hint": "It stops working straight away, and somebody else could take it. Your storefront and its search ranking are unaffected.",
  "domain.removed": "Given up. Your storefront is unaffected.",
  "domain.error.not_entitled": "Your own web address is on the Pro plan.",
  "domain.error.taken": "Another business already has that address. Ask us and we will sort it out.",
  "domain.error.already": "You already have one. Give that one up first.",
  "domain.error.unusable": "Your listing name cannot make a web address. Ask us and we will sort it out.",
  "domain.locked": "Your own web address is part of Pro.",
  "domain.meta_title": "Web address",

  // ── Themes, board 5b ──────────────────────────────────────────────────────
  "theme.title": "Theme",
  "theme.eyebrow": "Storefronts",
  "theme.meta": "Applies to {count} storefronts",
  "theme.offered": "Themes sellers may pick",
  "theme.offered_hint": "Tick the ones that suit this trade. A seller in this sector sees these and nothing else.",
  "theme.default": "The one they start on",
  "theme.default_hint": "Every storefront in the trade uses this until a seller changes it.",
  "theme.none_offered": "Offer at least one theme first.",
  "theme.preset.default": "Moss",
  "theme.preset.industrial": "Steel blue",
  "theme.preset.trade": "Clay",
  "theme.preset.mono": "Ink",
  "theme.preset.clinic": "Sage",
  "theme.preset.salon": "Plum",
  "theme.custom": "Custom colours",
  "theme.custom_hint": "Off for most trades. A seller with a brand book will ask; a seller without one will pick something illegible.",
  "theme.allow_custom": "Let sellers set their own brand colour",
  "theme.allow_custom_hint": "Checked against the page background on save. Anything below 4.5:1 is refused with the number.",
  "theme.try": "Try a colour",
  "theme.try_hint": "Six-digit hex. Nothing is saved from here — it is to see what would be accepted.",
  "theme.passes": "{ratio}:1 against the page background. That clears the floor.",
  "theme.below_floor": "{ratio}:1 against the page background, and it needs 4.5:1. Headings and links in this colour would be hard to read.",
  "theme.not_a_hex": "Six digits after a hash. The field shows the shape.",
  "theme.shape": "Type and shape",
  "theme.type_pairing": "Type pairing",
  "theme.type.editorial": "Editorial serif",
  "theme.type.clean": "Clean sans",
  "theme.type.technical": "Technical mono",
  "theme.density": "Density",
  "theme.density.compact": "Compact",
  "theme.density.comfortable": "Comfortable",
  "theme.density.roomy": "Roomy",
  "theme.radius": "Corner radius",
  "theme.radius_hint": "Whole pixels, 0 to 24.",
  "theme.dark_header": "Dark header",
  "theme.badge_removable": "Pro sellers may remove our badge",
  "theme.badge_removable_hint": "The storefront-by-Business-Listings line in the footer. Never the verification badge, which is not a seller's to remove.",
  "theme.reason_hint": "Goes on the audit row. This changes {count} storefronts.",
  "theme.save": "Save for {count} storefronts",
  "theme.back_to_builder": "Back to the builder",

  // ── The builder, board 5a ─────────────────────────────────────────────────
  "builder.back": "Back to templates",
  "builder.applies_to": "APPLIES TO {count} STORES",
  "builder.sections": "Sections",
  "builder.pages": "Pages",
  "builder.add_section": "Add a section",
  "builder.fixed": "FIXED",
  "builder.takes_away": "takes away",
  "builder.enabled": "On {section}",
  "builder.settings": "Settings",
  "builder.settings_empty": "Pick a section on the left to see what it offers.",
  "builder.seller_fields": "What the seller may fill",
  "builder.seller_fields_none": "Nothing. Everything on this section is derived, and a seller-editable trust signal is not a trust signal.",
  "builder.show_on_mobile": "Show on mobile",
  "builder.canvas": "Preview",
  "builder.canvas_note": "Rendered against a specimen supplier, not a real seller's account.",
  "builder.desktop": "Desktop",
  "builder.mobile": "Mobile",
  "builder.publish": "Publish",
  "builder.publish_review": "Review and publish",
  "builder.no_changes": "Nothing to publish",
  "builder.no_changes_body": "This template matches what is live. Change a section and the list fills in.",
  "builder.unpublished": "Unpublished changes",
  "builder.confirm_title": "Publish to {count} storefronts",
  "builder.confirm_body": "Every live storefront in {sector} takes these changes when you publish. There is a version history and a restore, but the sellers see it immediately.",
  "builder.confirm_destructive": "{count} of these take something away.",
  "builder.reason_label": "Why",
  "builder.reason_hint": "Every change writes an audit row. This is the reason on it.",
  "builder.publish_reason_label": "Why publish",
  "builder.publish_reason_hint": "Its own reason, not the one on the edits. It goes on the version row with the store count, and it is what somebody reads a year later asking why this template changed.",
  "builder.confirm": "Publish to {count} storefronts",
  "builder.cancel": "Not yet",
  "builder.published": "Published. {count} storefronts now render version {version}.",
  "builder.saved": "Saved. Not published yet.",
  "builder.not_yours": "The storefront builder is an ops lead tool.",
  "builder.needs_reason": "Say why in a sentence. It goes on the version row with the store count.",
  "builder.move_up": "Move {section} up",
  "builder.move_down": "Move {section} down",
  "builder.status.draft": "Draft",
  "builder.status.live": "Live",
  "builder.status.retired": "Retired",

  "diff.first_publish": "First publish: {count} sections go live.",
  "diff.section_added": "{section} added",
  "diff.section_removed": "{section} removed — anything sellers filled into it goes with it",
  "diff.section_enabled": "{section} turned on",
  "diff.section_disabled": "{section} turned off",
  "diff.mobile_shown": "{section} now shows on mobile",
  "diff.mobile_hidden": "{section} hidden on mobile",
  "diff.fields_changed": "{section}: {gained} fields opened to sellers, {lost} closed",
  "diff.order_changed": "Sections reordered",
  "diff.theme_changed": "Default theme changed to {theme}",
  "diff.offered_changed": "Sellers may now pick from {count} themes",
  "diff.type_pairing": "Type pairing changed to {value}",
  "diff.density": "Density changed to {value}",
  "diff.corner_radius": "Corner radius changed to {value}px",
  "diff.dark_header_on": "Header set to dark",
  "diff.dark_header_off": "Header set to light",
  "diff.custom_hex_on": "Sellers may set a custom brand colour",
  "diff.custom_hex_off": "Custom brand colours turned off",
  "diff.badge_removable_on": "Pro sellers may remove our badge",
  "diff.badge_removable_off": "Our badge is no longer removable",
  "diff.renamed": "Template renamed to {name}",

  "admin.templates.title": "Storefront templates",
  "admin.templates.eyebrow": "Storefronts",
  "admin.templates.meta": "{live} of {sectors} trades have a live template",
  "admin.templates.caption": "Storefront templates, and how many live storefronts each one governs",
  "admin.templates.col.sector": "Trade",
  "admin.templates.col.name": "Template",
  "admin.templates.col.status": "Status",
  "admin.templates.col.version": "Version",
  "admin.templates.col.sections": "Sections",
  "admin.templates.col.stores": "Storefronts",
  "admin.templates.section_count": "{enabled} of {total} on",
  "admin.templates.status.draft": "Draft",
  "admin.templates.status.live": "Live",
  "admin.templates.status.retired": "Retired",
  "admin.templates.specimens": "Section specimens",
  "admin.templates.uncovered": "Trades with no template",
  "admin.templates.uncovered_body": "These render the default storefront. Named rather than left out: a list showing only what exists would hide the work.",
  "admin.templates.library": "Section library",
  "admin.templates.library_body": "What a template can be built from. Every one reads from data the seller already has, which is why enabling a section is a click for staff and no content work for them.",
  "admin.templates.library_count": "{buildable} buildable, {total} in the catalogue.",
  "admin.templates.empty.title": "No templates yet",
  "admin.templates.empty.body": "Every storefront renders the default until a trade gets a template. Building one is a staff action — sellers fill templates, they do not build them.",

  "admin.specimens.title": "Section specimens",
  "admin.specimens.eyebrow": "Storefronts",
  "admin.specimens.meta": "{count} section types",
  "admin.specimens.note": "Every section type at real scale, against the same specimen supplier. This is the reference for what enabling a section actually gives a seller — the equivalent of the component gallery, for sections. The data is written by hand rather than read from a listing, so it does not change under you.",

  // ── Storefront sections ───────────────────────────────────────────────────
  "section.header": "Header & contact bar",
  "section.hero": "Hero banner",
  "section.trust_strip": "Trust strip",
  "section.featured_products": "Featured products",
  "section.catalogue_grid": "Catalogue grid",
  "section.brands": "Brands we stock",
  "section.certifications": "Certifications",
  "section.branches": "Branches & map",
  "section.reviews": "Reviews",
  "section.enquiry_form": "Enquiry form",
  "section.team": "Meet the team",
  "section.offer_banner": "Offer banner",
  "section.spec_comparison": "Spec comparison",
  "section.downloads": "Downloads",
  "section.services": "Services & packages",

  "section.source.header": "Business details and locations",
  "section.source.hero": "Media library",
  "section.source.trust_strip": "Verification, locations and measured reply time",
  "section.source.featured_products": "Products",
  "section.source.catalogue_grid": "Products and the spec template",
  "section.source.brands": "Media library",
  "section.source.certifications": "Documents",
  "section.source.branches": "Locations",
  "section.source.reviews": "Reviews",
  "section.source.enquiry_form": "Nothing — it writes an enquiry",
  "section.source.team": "Team members who agreed to appear",
  "section.source.offer_banner": "Nothing — the seller writes it",
  "section.source.spec_comparison": "Products and the spec template",
  "section.source.downloads": "Documents",
  "section.source.services": "The services model, which is not built",

  "section.field.eyebrow": "Eyebrow",
  "section.field.headline": "Headline",
  "section.field.buttonLabel": "Button label",
  "section.field.image": "Background image",
  "section.field.products": "Which products",
  "section.field.categories": "Which categories",
  "section.field.logos": "Which brand logos",
  "section.field.documents": "Which documents",
  "section.field.members": "Which people",
  "section.field.intro": "Intro line",
  "section.field.body": "Body",
  "section.field.reference": "Reference to quote",
  "section.field.endsOn": "Ends on",
  "section.field.attributes": "Which attributes",

  "section.group.sell": "Sell",
  "section.group.prove": "Prove",
  "section.group.contact": "Contact",
  "section.group.all": "All",

  "section.hero.enquire": "Send an enquiry",
  "section.trust.branches": "{count} branches",
  "section.trust.reviews": "{count} reviews",
  "section.featured.title": "Featured",
  "section.featured.empty": "No products picked yet. The seller chooses four to eight.",
  "section.catalogue.title": "Catalogue",
  "section.catalogue.view_all": "All {count} products",
  "section.catalogue.empty": "Nothing in the catalogue yet.",
  "section.brands.title": "Brands we stock",
  "section.certifications.title": "Certifications",
  "section.certifications.open": "Open",
  /* Month, not a date — see formatMonth. */
  "section.certifications.valid_until": "Valid until {month}",
  "document.kind.certificate": "Certificate",
  "document.kind.catalogue": "Catalogue",
  "document.kind.datasheet": "Datasheet",
  "section.certifications.note": "Certificates, catalogues and datasheets only. A trade licence is never shown here.",
  "section.branches.title": "Branches",
  "section.branches.head_office": "Head office",
  "section.branches.excluded": "{count} branches are not on the map yet",
  "section.reviews.title": "What buyers said",
  "section.reviews.empty": "No reviews yet. A review needs a confirmed enquiry, so they arrive slowly and mean something.",
  "section.reviews.average": "{average} from {count} reviews",
  "section.enquiry.title": "Send an enquiry",
  "section.enquiry.default_intro": "Tell them what you need and they will come back with a quote.",
  "section.team.title": "Meet the team",
  "section.team.consent": "Everybody here agreed to appear, and the number is the branch line.",
  "section.offer.ends": "Ends {date}",
  "section.offer.reference": "Quote {reference} in your enquiry",
  "section.spec.title": "Compare",
  "section.spec.attribute": "Attribute",
  "section.spec.empty": "Pick an attribute set to compare on.",
  "section.downloads.title": "Downloads",
  "section.services.title": "Services & packages",
  "section.services.coming": "Not built yet. Services are their own model and this card is here so the gap is legible rather than hidden.",
  "section.no_seller_fields": "Nothing — everything on it is derived",
  "section.seller_fills": "Seller fills",
  "section.pulls_from": "Pulls from",
  "section.singleton": "once per template",
  "section.repeatable": "can repeat",

  // ── Landing-page FAQ, criterion 3 ─────────────────────────────────────────
  //
  // Every answer is assembled from platform counts in `lib/seo/faq.ts`, and one
  // whose number is missing is not asked. Say the number; never spin.
  "faq.title": "Questions buyers ask",
  "faq.how_many.q": "How many {subject} suppliers are listed?",
  "faq.how_many.a": "{listings} on Business Listings, {verified} of them with a trade licence we have checked against the issuing authority.",
  "faq.where.q": "Where are {subject} suppliers based?",
  "faq.where.item": "{emirate} ({count})",
  "faq.where.a": "Across {list}.",
  "faq.where.a_more": "Across {list}, and {rest} other emirates.",
  "faq.reply.q": "How quickly do {subject} suppliers reply?",
  "faq.reply.a": "The median first reply is {median}, measured across the {measurable} listings with enough enquiry history to measure. It is computed from real enquiries and their replies — no supplier can edit it.",
  "faq.availability.q": "Is {subject} held in stock or made to order?",
  "faq.availability.a": "Of {products} listed products, {stocked} are in stock and {madeToOrder} are made to order. The rest are indent orders or currently out of stock.",
  "faq.price.q": "Why are there no prices?",
  "faq.price.a": "Prices are between you and the supplier. Send an enquiry and they quote you directly — we never see the number, never take a cut and never hold your money.",

  // ── Category index, board 6c ──────────────────────────────────────────────
  // The emirate × sector landing page, /:emirate/:category.
  "emirate_page.title": "{category} suppliers in {emirate}",
  "emirate_page.subject": "{category} in {emirate}",
  "emirate_page.description":
    "{count} licensed {category} suppliers across {emirate}. Filter by verification and specification, then send one enquiry.",
  "emirate_page.lede":
    "{count} licensed businesses in {emirate}, {verified} of them verified by us.",
  "categories.matrix_eyebrow": "Browse any trade by emirate — {pages} pages",
  // Board 6c. The h1 the board draws, and a sub-line carrying four live counts.
  "categories.title": "Every trade we cover",
  "categories.lede":
    "{sectors} sectors, {subcategories} subcategories, {emirates} emirates. {listings} licensed businesses mapped to them.",
  "categories.seo_title": "All UAE business categories — {sectors} sectors, {subcategories} subcategories",
  "categories.seo_description":
    "{sectors} sectors and {subcategories} subcategories covering {listings} licensed UAE businesses, with a listing count for every trade in every emirate.",
  "categories.more_subcategories": {
    one: "+ {count} more subcategory",
    other: "+ {count} more subcategories",
  },
  "categories.no_subcategories": "Subcategory pages open as more suppliers list.",
  "categories.matrix_caption": "Listings by sector and emirate",
  "categories.col_sector": "Sector",
  "categories.threshold_note":
    "A greyed cell is a page we have not made. A trade needs enough suppliers in that emirate — and enough of them checked — before a page about it is worth arriving at, and how many that is depends on how many people are looking. Nothing is hidden: those pages were never created.",
  "categories.subcategories": { one: "{count} subcategory", other: "{count} subcategories" },
  "categories.listings": { one: "{count} supplier", other: "{count} suppliers" },
  "categories.empty": "No trades yet.",
  "categories.thin": "Not enough listed yet",
  "categories.thin_hint": "This page is not in the sitemap and search engines are asked not to index it, because a page with a heading and four results has nothing for anybody to rank or trust. It stays reachable, and it publishes when the trade fills up.",

  // ── Subcategory landing, board 10a ────────────────────────────────────────
  "landing.emirates_title": "By emirate",
  "landing.emirates_hint": "A supplier with premises in two emirates is counted in both.",
  "landing.specs_title": "Filter by specification",
  "landing.specs_hint": "From the specification template for this trade. Adding a field adds a chip.",
  "landing.related_title": "Other trades in {parent}",
  "landing.verified_share": "{verified} of {listings} verified",
  "landing.no_facts": "Nothing is listed here yet, so there is nothing to summarise.",

  // ── Area and emirate landing pages, board 6a ──────────────────────────────
  //
  // One template, two page classes. The H1 pattern is `{Category} companies in
  // {Area}, {Emirate}` — "companies" rather than "suppliers", which is the word
  // the board draws and the word a buyer types into Google.
  //
  // Every count in here arrives as a formatted string from a query. Criterion 1
  // is "no count is a constant, in the body, the title or the meta description",
  // and a catalogue entry with a number written into it is exactly that.
  "landing.h1_area": "{category} companies in {area}, {emirate}",
  "landing.h1_emirate": "{category} companies in {emirate}",
  // No "| Business Listings" suffix. The root layout's title template already
  // appends " — Business Listings" to every page, and the board's title written
  // out in full includes it — writing it here as well produced
  // "… — 62 listed | Business Listings — Business Listings".
  "landing.title": "{subject} — {listings} listed",
  // The fallback only. §SEO asks for one written sentence per scope, which
  // lives on the page row; this is what a page that clears all four conditions
  // reads like before somebody has written one.
  "landing.meta_fallback": "{listings} {category} companies in {place}, {verified} with a trade licence checked against the issuing authority. Compare reply times and send one enquiry.",
  "landing.search_placeholder": "Search {category} suppliers in {place}",

  // The stat line. "Open now" is absent, never nought, where nobody in the
  // scope has hours on file — absent data is not evidence of a shut door.
  // Pluralised on `count`, rendered from `display`. `t()` selects the form from
  // a raw number and interpolates with `String(value)`, which would print 1204
  // where the rest of the site prints 1,204 — so the number arrives twice, once
  // to choose the words and once already formatted.
  "landing.stat_listings": { one: "{display} company", other: "{display} companies" },
  "landing.stat_verified": {
    one: "{display} with a verified trade licence",
    other: "{display} with verified trade licences",
  },
  "landing.stat_open": "{count} open now",
  "landing.updated": "Updated {date}",

  "landing.subcategories_label": "Narrow this page",
  "landing.chip_all": "All {count}",

  "landing.map_label": "Where these companies are in {place}",
  "landing.nearby_areas": "Nearby areas",

  "landing.results_heading": "Verified {category} companies in {place}",
  // The board's fifth correction. "Ranked by verification, then response time"
  // described a two-key sort we do not run: it is one weighted config, shared
  // with boards 1b and 1c and edited on 12c, and on this page the relevance
  // weight has no query to score against.
  "landing.ranking_caption": "Ranked on the same config as search — verification, response time, completeness",
  "landing.rfq_prompt": "Not sure which to call? Send one requirement and let them come to you.",
  "landing.rfq_action": "Post an RFQ to {place} {category}",
  "landing.show_all": "Show all {count} companies",
  "landing.next": "Next",
  "landing.previous": "Previous",
  "landing.pagination_label": "More companies",

  "landing.faq_heading": "Questions buyers ask about {place} {category}",
  // The resolved live token. The sample and the window are in the sentence
  // rather than behind it: a range drawn from 34 quotes and one drawn from 900
  // are different facts, and a reader deciding whether to trust us is entitled
  // to know which this is.
  "landing.faq.quote_range": "AED {low} to AED {high}, across {sample} quotes sent through this platform in the last {months} months",

  "landing.related_searches": "Related searches",
  "landing.read_next": "Read next",
  "landing.kicker_list": "Curated list",
  "landing.kicker_guide": "Guide · {minutes} min",
  "landing.claim_subject": "{category} company in {place}?",
  // Claiming enters the ranking; it does not buy a position in it. The board's
  // fourth correction: "claim it free and you'll appear above them" implied
  // that claiming outranks the verified, which is not what the config does.
  "landing.claim_body": "{listings} businesses are listed on this page and {unclaimed} of them are unclaimed. Unclaimed listings rank last here — claiming yours is free and puts it in the ranking, and verifying the licence is what lifts it.",
  "landing.claim_action": "Claim your listing",

  "landing.siblings_areas": "{category} in other {emirate} areas",
  "landing.siblings_emirates": "{category} in other emirates",
  "landing.siblings_trades": "Other trades in {place}",

  "area.title": "{category} suppliers in {area}",
  "area.meta_description": "{listings} {category} suppliers with premises in {area}, {verified} with a trade licence we have checked. Send one enquiry to up to eight of them.",
  "area.in_emirate": "{area}, {emirate}",
  "area.held_back": "Not enough listed here yet",
  "area.held_back_body": "This page is not in the sitemap and search engines are asked not to index it. {reason} It publishes when the area fills up — and the suppliers below are real either way.",
  "area.map_title": "Where they are",
  "area.map_excluded": { one: "{count} supplier has no map pin yet", other: "{count} suppliers have no map pin yet" },
  "area.same_trade_title": "{category} elsewhere",
  "area.other_trades_title": "Other trades in {area}",
  "area.link": "{name} ({count})",
  "area.subcategories": "Within {category}",
  "area.empty": "Nothing is listed in this trade in {area} yet.",
  "area.empty_body": "The directory covers the whole of the UAE, and the trade page will have suppliers on it.",
  "area.browse_trade": "Browse {category}",

  // ── Board 6a's content records, on the matrix ─────────────────────────────
  "matrix.not_here": "That page is not here.",
  "matrix.meta_description": "Meta description",
  "matrix.meta_hint": "{characters} of {max} characters. One written sentence about this scope — Google shows about 155. Leave it empty and the page falls back to a derived one.",
  "matrix.faq": "Questions buyers ask",
  // The gate, said while the writer is working rather than at the moment they
  // press publish.
  "matrix.faq_progress": "{rows} questions, {specific} of them specific to this scope. It publishes at 4 and 2.",
  "matrix.faq_question": "Question {position}",
  "matrix.faq_answer": "Answer",
  "matrix.faq_scope_specific": "Only answerable about this scope",
  "matrix.faq_quote_range": "Carries the quote range",
  "matrix.faq_add": "Add a question",
  "matrix.related": "Related searches",
  "matrix.related_label": "Label",
  "matrix.related_href": "Path",
  "matrix.related_add": "Add a related search",
  "matrix.related_hint": "Five at most, and every one a path of ours starting with a slash. This card is five anchors on the highest-authority template we own.",

  // ── Area pages on the admin matrix, board 6f ──────────────────────────────
  "matrix.area_tab": "Area pages",
  "matrix.col.emirate": "Emirate",
  "matrix.emirate_tab": "Emirate pages",
  "matrix.emirate_caption": "One trade across one emirate — board 6c's matrix",
  "matrix.emirate_note":
    "Each of these has its own paragraph. Seven emirates sharing one would be the same page seven times, which is the thin content the floors exist to stop.",
  "matrix.col.area": "Area",
  "matrix.col.live": "Live",
  "matrix.live_yes": "Live",
  "matrix.live_held": "Held",
  "matrix.area_published": "Published. It is live and in the sitemap on the next build.",
  "matrix.area_unpublished": "Unpublished. It stops being served as an indexable page immediately.",
  "matrix.area_note": "An area page publishes when it meets its need — the higher of this trade's listing floor and 25 listings per 1,000 monthly searches — with enough verified suppliers, enough words of its own, and four questions of which two are answerable only about this scope. A scope that has never published has no URL at all: it is a 404, absent from the sitemap and from every link block on every sibling page. A page that has published stays live down to four fifths of its need, and for its first 30 days it stays live below that too; when it does come down it redirects to the emirate page for the trade rather than 404ing, because the address has earned something a 404 throws away.",

  // ── Curated lists, board 6b ───────────────────────────────────────────────
  //
  // The criteria are published on the page because every other "best of" list
  // in this market is sold and does not say so. Stating them is the product.
  // The method panel. Short labels, because the panel is a table of verdicts
  // rather than a paragraph — §2 draws label left, verdict right.
  "best.eyebrow": "Curated list · Audited {date}",
  "best.how_we_chose": "How we chose",
  "best.criterion.verified": "Licence verified",
  "best.criterion.reply": "Median reply under {hours}h",
  // "from enquiries" is the operative phrase and it is worth the extra three
  // words: it is what makes 15 a meaningful number rather than a count of
  // whatever anybody chose to submit.
  "best.criterion.reviews": "{count}+ reviews from enquiries",
  "best.criterion.placement": "Paid placement",
  "best.kind.required": "Required",
  "best.kind.never": "Never",
  // §2: the panel states when the figures were measured. Every number on this
  // page is from that day — nothing here is live.
  "best.measured_on": "Every figure on this page was measured on {date}, the day the list was last audited.",
  // §3, consequence 3. Deliberately ugly: it should push editorial to re-audit
  // rather than sit.
  "best.entry_removed": "One entry removed {date}",

  "best.considered": "Chosen from {considered} listed companies on verified licence, quote-response time and review substance. No one paid to be here.",
  "best.best_for": "Best for: {what}",
  "best.metric.rating": "Rating",
  "best.metric.replies": "Replies in",
  "best.metric.established": "Established",
  "best.rating_value": "{rating} from {count}",
  "best.reviews": { one: "{count} review", other: "{count} reviews" },

  // The 04–12 band. All twelve are in the DOM; this opens the rest in place.
  "best.remaining": "{from} – {to}",
  "best.remaining_body": "{count} more, each with what they are best for.",
  "best.continue": "Continue the list",

  // The RFQ card. The board said "all 12"; the engine caps at 8 and says so on
  // screen, so the card says the number the engine will actually accept.
  "best.rfq_title": "Shortcut the reading",
  "best.rfq_body": "Describe the job once. The composer caps at {cap} recipients, so it goes to the {cap} on this list who reply fastest and can take an enquiry this month.",
  "best.rfq_action": "Send one RFQ to {cap} of these {members}",
  "best.in_this_list": "In this list",
  "best.more": "+ {count} more",
  "best.why_title": "Why we publish the criteria",

  "best.list_heading": "The list",
  "best.area_link": "All {count} {category} companies in {area}",
  "best.category_link": "All {category} companies",

  "best.empty": "Nobody meets all three rules in this trade yet.",
  "best.empty_body": "That is the list working rather than failing. The directory has suppliers in this trade — they are on the trade page, with what we have checked shown on each.",
  "best.browse": "Browse {category}",

  // ── Campaign landings, board 10i ──────────────────────────────────────────
  //
  // No site nav beyond the wordmark and one escape link — but the directory is
  // always offered. A page that traps the visitor converts worse and ranks
  // worse, and we would rather lose the click than earn it that way.
  "campaign.escape": "Business Listings",
  "campaign.escape_label": "Go to the directory",
  "campaign.cta_category": "Find {category} suppliers",
  "campaign.cta_search": "Search the directory",
  "campaign.cta_rfq": "Describe what you need instead",
  "campaign.alternative": "Not what you came for? {listings} licensed UAE businesses are in the directory, and the search is free and needs no account.",
  "campaign.trust": "{listings} listed businesses · {verified} with a trade licence we have checked · no price until a supplier quotes you directly",

  // ── Legal pages, board 10j ────────────────────────────────────────────────
  "legal.effective": "In effect since {date}",
  "legal.updated": "Last changed {date}",
  "legal.kind.terms": "Terms of use",
  "legal.kind.privacy": "Privacy policy",
  "legal.kind.verification_policy": "Verification policy",
  "legal.kind.review_policy": "Review policy",
  "legal.others": "The other policies",
  "legal.missing": "This policy has not been written yet.",
  "legal.missing_body": "That is a gap rather than a position. Nothing here is being withheld — ask us and we will answer while it is written.",

  // ── Legal pages, boards 13f/13g/13h ───────────────────────────────────────
  //
  // Three documents — sixteen clauses, twelve sections, five sections and a
  // register of nine cookies — and one `LegalPage` template that renders all
  // three. The prose is here rather than in `legal_page` rows because these are
  // the pages CLAUDE.md's localisation rule is actually about: 13g open
  // question 1 says they are the ones most likely to be legally required in
  // Arabic, and a translator quotes on a catalogue, not on a database.
  //
  // Anchors are an API. `docs/routes.md` and 13f §2 both say so: support
  // replies, the claim flow and the acceptance checkboxes deep-link to a
  // clause, so a renumbering keeps the old id as an alias rather than breaking
  // the link. The numbers below are part of the id and not decoration.
  "legal.on_this_page": "On this page",
  "legal.siblings": "The other four",
  "legal.glance": "At a glance",
  "legal.versions": "Previous versions",
  "legal.version_current": "Current",
  "legal.version_view": "View",
  "legal.versions_first": "This is the first published version.",
  "legal.contents_summary": "Contents",
  "legal.print_source": "{url} — {version}",
  "legal.kind.cookies": "Cookie policy",

  // ── 13f · Terms of use ────────────────────────────────────────────────────
  "legal.terms.title": "Terms of use",
  "legal.terms.meta": "Updated 4 Sep 2026 · 16 clauses · UAE law · DIFC Courts",
  "legal.terms.glance.1": "We publish licence data and let businesses correct it.",
  "legal.terms.glance.2": "We never sell goods, take payment for goods or hold funds.",
  "legal.terms.glance.3": "Verified means a document was checked, with a date on it.",
  "legal.terms.glance.4": "Placement is not for sale, and sponsored is labelled.",
  "legal.terms.glance.5": "Plans renew until cancelled; part-used terms are not refunded.",
  "legal.terms.glance.6": "Liability capped at fees paid, or AED 1,000, whichever is greater.",

  "legal.terms.01.heading": "Who we are",
  "legal.terms.01.p1": "Business Listings operates businesslistings.me, a directory of businesses licensed in the United Arab Emirates. We publish business information from public licence records and from businesses themselves, and we put buyers in touch with suppliers. In these terms, **we** means Business Listings and **you** means anyone using the site, as a buyer, as a business, or as a visitor who never signs in.",
  "legal.terms.01.p2": "We are not a party to any transaction between a buyer and a supplier, and we do not guarantee price, quality, timing or delivery. We do not sell goods, take payment for goods, hold funds, or ship, install or service anything. Where a supplier invoices you, they invoice you directly and on their own terms. The only money we take is a subscription fee from businesses on a paid plan, and a fee for placements labelled as sponsored.",

  "legal.terms.02.heading": "Accepting these terms",
  "legal.terms.02.p1": "Using the site means accepting these terms. Creating an account, claiming a listing, sending an enquiry or subscribing to a plan each means accepting them again as they stand on that day.",
  "legal.terms.02.p2": "If you accept on behalf of a company, you confirm you are authorised to bind it. Where a signed agreement exists between us and your company, that agreement prevails over these terms to the extent the two conflict.",

  "legal.terms.03.heading": "Your account",
  "legal.terms.03.p1": "You must be 18 or older to hold an account. You are responsible for what happens under your login, including what your colleagues do with the roles you grant them. Tell us at once if you think someone else has access.",
  "legal.terms.03.p2": "We identify accounts by mobile number and one-time code, so keeping your number current matters: losing the number can mean losing access to the listing attached to it. Recovery then needs the same ownership evidence as a fresh claim.",
  "legal.terms.03.p3": "One person holds one account. One business has one live listing per trade licence. Duplicate listings for the same licence are merged, and the earlier verified claim wins.",

  "legal.terms.04.heading": "What we publish",
  "legal.terms.04.p1": "Listings come from two places: licence records published by UAE authorities, and information a business gives us after claiming its listing. A business can correct its own record at any time, and anyone can report a listing that is wrong.",
  "legal.terms.04.p2": "Until a listing is claimed we publish only what the licence record and other public sources show, and we say on the page that nobody has claimed it. An unclaimed listing carries no badge, no catalogue and no performance figures.",
  "legal.terms.04.p3": "Where we mark a business as verified, we state what we checked and when. That is a statement about a document, not a recommendation. A badge is removed when the document behind it expires, and verification does not transfer when a listing changes hands.",
  "legal.terms.04.p4": "Placement in search results is not for sale. Sponsored slots are labelled as sponsored wherever they appear, and no plan buys a position in an unlabelled result. Ranking uses relevance, listing completeness, verification, responsiveness and distance; plan level is capped as a minor factor and never overrides relevance.",

  "legal.terms.05.heading": "Using the directory as a buyer",
  "legal.terms.05.p1": "The site is free for buyers. You can search, view listings, compare suppliers and send enquiries without paying us anything.",
  "legal.terms.05.p2": "Prices are not published here. What you get back is a quote from a supplier, valid for the period that supplier states and on that supplier's terms. A quote is an offer from the supplier to you, never from us.",
  "legal.terms.05.p3": "Send enquiries you mean. Sending one requirement to several suppliers is expected and supported. Fabricating requirements, harvesting contact details, or enquiring in order to sell something to the supplier is not, and we suspend accounts that do it.",
  "legal.terms.05.p4": "When you accept a quote we release your contact details to that supplier and tell the others the enquiry is closed. What happens after that is between you and the supplier.",

  "legal.terms.06.heading": "Listing a business",
  "legal.terms.06.p1": "To claim a listing you must hold, or be authorised by the holder of, the trade licence for that business. We ask for licence evidence and check it against the authority's record. Claiming a business you do not own is grounds for permanent removal, and we report attempts where the law requires it.",
  "legal.terms.06.p2": "You are responsible for everything on your listing: trade name, categories, contact details, locations, hours, photographs, specifications and documents. It must be accurate, it must be yours to publish, and it must describe what you actually supply. Do not list goods or services your licence does not cover.",
  "legal.terms.06.p3": "By publishing content you grant us a non-exclusive, royalty-free licence to host, resize, cache and display it on the site and in the search results and feeds that point to it, for as long as your listing is live and for a reasonable period afterwards in cached and archived copies.",
  "legal.terms.06.p4": "Answer enquiries or turn the category off. Response rate and response time are published on your listing because buyers ask for them, and a listing that never replies is downgraded in ranking before it is delisted.",

  "legal.terms.07.heading": "Reviews",
  "legal.terms.07.p1": "Reviews are written by buyers, not by us. We publish a review when we can tie it to an account, and we keep it up whether it flatters the business or not. A business may reply once to each review, publicly.",
  "legal.terms.07.p2": "We remove reviews that are abusive, that identify individuals, that are written by the business or a competitor, or that concern a transaction we can establish never happened. We do not remove a review because it is negative, and we do not sell removals. The review policy sets out the detail.",

  "legal.terms.08.heading": "Plans, fees and VAT",
  "legal.terms.08.p1": "A listing is free. Paid plans add catalogue capacity, enquiry volume, team seats, analytics and sponsored placement, priced on the pricing page in dirhams.",
  "legal.terms.08.p2": "Plans renew automatically for the same term until cancelled. Cancel before the renewal date and the plan runs to the end of the term you paid for; we do not refund part-used terms. Cancelling does not delete your listing, it returns it to the free plan, and anything above the free limits is hidden rather than deleted.",
  "legal.terms.08.p3": "Prices exclude VAT. UAE VAT at 5% is added where it applies, and we issue a tax invoice showing our TRN and yours where you have given it to us. Give us the correct TRN: we cannot reissue an invoice to correct one after the tax period it falls in has closed.",
  "legal.terms.08.p4": "If a payment fails we retry, tell you, and keep the plan live for a grace period before it reverts to free. Sponsored placement stops immediately on non-payment.",

  "legal.terms.09.heading": "Acceptable use",
  "legal.terms.09.p1": "Do not scrape or crawl beyond what our robots file allows, bulk-extract listings or contact details, or build a competing directory from ours. Do not use automated means to send enquiries, register accounts or post reviews.",
  "legal.terms.09.p2": "Do not impersonate a business or a member of our staff, upload malware, attempt to reach data or systems that are not yours, or use the site to send anything UAE law prohibits.",
  "legal.terms.09.p3": "Contact details are published so that buyers can reach suppliers. Using them for marketing lists, unsolicited bulk contact or resale is a misuse of the site and ends access to it.",

  "legal.terms.10.heading": "Intellectual property",
  "legal.terms.10.p1": "The site, its design, our name and marks, the category taxonomy and the specification templates are ours. Business names, logos and listing content belong to the businesses they describe. You may link to any page and quote a short extract with attribution; you may not copy the directory or any substantial part of it.",

  "legal.terms.11.heading": "Suspension, removal and appeals",
  "legal.terms.11.p1": "We can hide, downgrade or remove a product, a listing, a review or an account where it breaks these terms, where the document behind a verification has lapsed, where a licence appears cancelled, or where we are required to. We act on the narrowest thing that fixes it: a product before a listing, a listing before an account.",
  "legal.terms.11.p2": "We tell you what we did and why, on the listing and by message. You may appeal once, to a person, and we answer within five working days. Where something was removed because a document expired, supplying a current document restores it without an appeal.",
  "legal.terms.11.p3": "You can close your account and remove your listing's claimed content at any time. The underlying licence record stays published, unclaimed, because it is public information.",

  "legal.terms.12.heading": "Our liability",
  "legal.terms.12.p1": "We provide the directory as it is. We do not warrant that a listing is accurate, that a supplier is solvent, competent or available, that a quote will be honoured, or that the site will be uninterrupted.",
  "legal.terms.12.p2": "To the extent the law allows, we are not liable for loss of profit, loss of business, loss of data, or any indirect or consequential loss. Our total liability to you in any twelve-month period is limited to the greater of the fees you paid us in that period and AED 1,000.",
  "legal.terms.12.p3": "Nothing here excludes liability that cannot be excluded under UAE law, including liability for fraud.",

  "legal.terms.13.heading": "Indemnity",
  "legal.terms.13.p1": "If you publish a listing, you cover us against third-party claims arising from what you published or supplied: infringement, misdescription, defective goods, or a dispute with a buyer. That includes reasonable legal costs.",

  "legal.terms.14.heading": "Changes to these terms",
  "legal.terms.14.p1": "We change these terms when the product or the law changes. Material changes are announced on the site and messaged to account holders at least fourteen days before they take effect, and every previous version stays on this page with the date it applied from.",
  "legal.terms.14.p2": "Using the site after a change takes effect means accepting it. If you do not accept it, cancel your plan and close your account before that date.",

  "legal.terms.15.heading": "Governing law and disputes",
  "legal.terms.15.p1": "These terms are governed by the laws of the United Arab Emirates, and disputes are subject to the DIFC Courts.",
  "legal.terms.15.p2": "Before filing anything, write to legal@businesslistings.me. We answer substantive complaints within ten working days, and most matters end there.",

  "legal.terms.16.heading": "Contact",
  "legal.terms.16.p1": "Write to legal@businesslistings.me, or use the report link on any listing if the problem is with a specific business. For data questions write to privacy@businesslistings.me. Our registered name, licence number and address appear on every tax invoice we issue.",

  // ── 13g · Privacy policy ──────────────────────────────────────────────────
  //
  // §04 is not boilerplate. It states in policy language exactly what the
  // enquiry fan-out already does, which is why `lib/enquiry/payload.test.ts`
  // names this section: adding `buyer.phone` to the payload has to fail a test
  // that points here, or the policy drifts from the code and that is a
  // compliance problem rather than a copy one.
  "legal.privacy.title": "Privacy policy",
  "legal.privacy.meta": "Updated 4 Sep 2026 · UAE PDPL · Federal Decree-Law 45 of 2021",
  "legal.privacy.glance.1": "An enquiry goes only to the suppliers you picked.",
  "legal.privacy.glance.2": "Your phone and email are withheld until you accept a quote.",
  "legal.privacy.glance.3": "We do not sell personal data and run no ad networks.",
  "legal.privacy.glance.4": "Enquiry threads five years, invoices five years, analytics 26 months.",
  "legal.privacy.glance.5": "Primary storage is in the UAE; four processors sit outside it.",
  "legal.privacy.glance.6": "Copies, corrections and deletions: privacy@businesslistings.me.",

  "legal.privacy.01.heading": "What this covers",
  "legal.privacy.01.p1": "This policy covers businesslistings.me and the accounts behind it, for buyers, for businesses, and for visitors who never sign in. It is written to the UAE Personal Data Protection Law, Federal Decree-Law 45 of 2021. Business Listings is the controller of the data described here.",
  "legal.privacy.01.p2": "Business information published from a trade licence is public record. Where a licence record contains an individual's name, we publish the trade name and withhold the rest unless the business chooses to publish it.",

  "legal.privacy.02.heading": "What we collect",
  "legal.privacy.02.e1": "From you",
  "legal.privacy.02.p1": "Mobile number, name, email, company name, and the text and attachments of the enquiries and reviews you write. From businesses: trade licence, TRN, the identity document of the person signing the claim, and everything you publish on your listing. Card details are entered with our payment processor and never reach us.",
  "legal.privacy.02.e2": "From your use of the site",
  "legal.privacy.02.p2": "IP address, the approximate location derived from it, device and browser, pages viewed, searches run, listings opened, contact reveals, and the cookies listed in the cookie policy.",
  "legal.privacy.02.e3": "From public and third-party sources",
  "legal.privacy.02.p3": "UAE licensing authorities, sanctions screening for paid accounts, map and geocoding providers, and our payment processor's confirmation that a charge succeeded.",

  "legal.privacy.03.heading": "Why we use it",
  "legal.privacy.03.p1": "Every use below is either necessary to run the service you asked for, required of us by law, or consented to. Where we rely on consent you can withdraw it.",
  "legal.privacy.03.caption": "Eight purposes, and the data each one uses",
  "legal.privacy.03.col.purpose": "Purpose",
  "legal.privacy.03.col.data": "What it uses",
  "legal.privacy.03.r1.purpose": "Run your account and keep it secure",
  "legal.privacy.03.r1.data": "Mobile number, one-time codes, session cookies",
  "legal.privacy.03.r2.purpose": "Deliver an enquiry to the suppliers you chose",
  "legal.privacy.03.r2.data": "Requirement, quantity, location, first name, company, attachments",
  "legal.privacy.03.r3.purpose": "Withhold your contact details until you accept",
  "legal.privacy.03.r3.data": "Phone and email, held back from the enquiry payload",
  "legal.privacy.03.r4.purpose": "Publish and rank listings",
  "legal.privacy.03.r4.data": "Licence records, listing content, response times",
  "legal.privacy.03.r5.purpose": "Verify a business",
  "legal.privacy.03.r5.data": "Trade licence, TRN, signatory identity",
  "legal.privacy.03.r6.purpose": "Bill a plan and meet tax rules",
  "legal.privacy.03.r6.data": "Company details, TRN, payment records",
  "legal.privacy.03.r7.purpose": "Measure and improve the site",
  "legal.privacy.03.r7.data": "Pageviews, searches, contact reveals, in aggregate",
  "legal.privacy.03.r8.purpose": "Detect fraud, scraping and fake reviews",
  "legal.privacy.03.r8.data": "Device signals, enquiry patterns, IP",

  "legal.privacy.04.heading": "Who sees your enquiry",
  "legal.privacy.04.p1": "Only the suppliers you selected. An enquiry sent to four suppliers reaches those four and nobody else. Suppliers do not see one another and do not see how many others you asked.",
  "legal.privacy.04.p2": "They receive your requirement, quantity, location, timeframe, first name, company name and any attachment. They do not receive your phone number or your email. Those are released when you accept a quote, or when you reply to one supplier and choose to reveal them.",
  "legal.privacy.04.p3": "We keep the thread so that a dispute has a record, and we count the enquiry so that response rate and response time can be published. We do not sell enquiries, and we never pass one to a supplier you did not choose.",

  "legal.privacy.05.heading": "Who else we share with",
  "legal.privacy.05.p1": "Processors who run parts of the service under contract: hosting, SMS delivery, email delivery, payment processing, error monitoring and maps. They act on our instructions and may not use your data for anything else.",
  "legal.privacy.05.p2": "Authorities where the law requires it, and our advisers where a claim requires it. Reviews and published listing content are, by design, visible to the world and indexed by search engines.",
  "legal.privacy.05.p3": "We do not sell personal data. We run no third-party advertising networks on the site, so there is no audience-sharing with ad platforms.",

  "legal.privacy.06.heading": "Where your data goes",
  "legal.privacy.06.p1": "Primary storage is in the United Arab Emirates. Some processors operate outside it, specifically SMS routing, email delivery, error monitoring and payment processing. Where data leaves the UAE we rely on the adequacy findings or contractual safeguards the PDPL requires, and we will give you the current list of processors and their locations on request.",

  "legal.privacy.07.heading": "How long we keep it",
  "legal.privacy.07.caption": "Eight kinds of record, how long each is kept, and why",
  "legal.privacy.07.col.what": "What",
  "legal.privacy.07.col.how_long": "How long",
  "legal.privacy.07.col.why": "Why",
  "legal.privacy.07.r1.what": "Account and login records",
  "legal.privacy.07.r1.how_long": "While open, then 12 months",
  "legal.privacy.07.r1.why": "Recovery and dispute",
  "legal.privacy.07.r2.what": "Enquiries and quote threads",
  "legal.privacy.07.r2.how_long": "5 years from the last message",
  "legal.privacy.07.r2.why": "Dispute record",
  "legal.privacy.07.r3.what": "Response-time and reveal counts",
  "legal.privacy.07.r3.how_long": "Aggregated; unlinked after 24 months",
  "legal.privacy.07.r3.why": "Published performance figures",
  "legal.privacy.07.r4.what": "Verification documents",
  "legal.privacy.07.r4.how_long": "12 months after expiry or removal",
  "legal.privacy.07.r4.why": "Proof of what we checked",
  "legal.privacy.07.r5.what": "Invoices and tax records",
  "legal.privacy.07.r5.how_long": "5 years",
  "legal.privacy.07.r5.why": "UAE tax law",
  "legal.privacy.07.r6.what": "Reviews",
  "legal.privacy.07.r6.how_long": "While published",
  "legal.privacy.07.r6.why": "A review must not vanish on request",
  "legal.privacy.07.r7.what": "Analytics events",
  "legal.privacy.07.r7.how_long": "26 months",
  "legal.privacy.07.r7.why": "Trend reporting",
  "legal.privacy.07.r8.what": "Support messages",
  "legal.privacy.07.r8.how_long": "3 years",
  "legal.privacy.07.r8.why": "The history of a complaint",
  "legal.privacy.07.p1": "When an account closes we delete what nothing above requires us to keep, and reduce the reviewer's name on published reviews to an initial.",

  "legal.privacy.08.heading": "Your rights",
  "legal.privacy.08.p1": "You can ask for a copy of what we hold, correct it, delete it, restrict or object to a use, withdraw a consent, or ask about any automated decision that affects you. Write to privacy@businesslistings.me from the email or number on the account and we answer within 30 days.",
  "legal.privacy.08.p2": "Four limits worth knowing. We keep invoices and tax records for the statutory period whatever you ask. We keep an enquiry thread the other party also relies on. A published review is not deleted on request. And the licence record behind a listing is public information that we cannot unpublish.",
  "legal.privacy.08.p3": "If we get it wrong you can complain to the UAE Data Office. Tell us first, because we would rather fix it.",

  "legal.privacy.09.heading": "Security",
  "legal.privacy.09.p1": "Traffic is encrypted in transit. Documents are stored encrypted, and access is limited to the staff whose role requires it. Every staff action on a business record is logged with the reason for it. Verification documents are visible to moderators, never to other businesses and never on a public page.",
  "legal.privacy.09.p2": "If data is exposed we tell the people affected and the Data Office within the period the PDPL sets, and we say what happened rather than that an incident occurred.",

  "legal.privacy.10.heading": "Cookies",
  "legal.privacy.10.p1": "What we set, why, and how to turn the optional ones off is in the cookie policy. Essential cookies keep you signed in and are set on load; nothing else is set until you choose.",

  "legal.privacy.11.heading": "Children",
  "legal.privacy.11.p1": "The site is for business use and is not directed at anyone under 18. We do not knowingly collect data from children, and we delete it if we find it.",

  "legal.privacy.12.heading": "Changes and contact",
  "legal.privacy.12.p1": "We post changes here with the date they take effect and keep every previous version. Material changes are messaged to account holders.",
  "legal.privacy.12.p2": "Rights requests and privacy questions: privacy@businesslistings.me. Everything else: legal@businesslistings.me. Our data protection contact is named in the reply you get.",

  // ── 13h · Cookie policy ───────────────────────────────────────────────────
  //
  // The register in §02 is a contract, not a description: it names every cookie
  // the application is permitted to set. `lib/legal/cookie-register.ts` holds
  // the same nine names as data so a crawl can assert against them, and 13h §3
  // asks for the CI job that makes the two agree.
  "legal.cookies.title": "Cookie policy",
  "legal.cookies.meta": "Updated 4 Sep 2026 · 9 cookies · 4 categories",
  "legal.cookies.glance.1": "Essential cookies only, until you choose otherwise.",
  "legal.cookies.glance.2": "Nine cookies in four categories, every one of them listed.",
  "legal.cookies.glance.3": "Analytics declined means no identifier is set at all.",
  "legal.cookies.glance.4": "No third-party advertising, retargeting or social trackers.",
  "legal.cookies.glance.5": "Global Privacy Control is honoured without asking again.",
  "legal.cookies.glance.6": "Change your answer from the footer, any time.",

  "legal.cookies.01.heading": "What a cookie does here",
  "legal.cookies.01.p1": "A cookie is a small file the site asks your browser to keep. We use them to keep you signed in, to remember choices such as language and emirate, and to count what gets used. We use browser storage for the same purposes, and this policy covers both.",
  "legal.cookies.01.p2": "Essential cookies are set when the site loads, because it cannot work without them. Everything else waits for your answer on the banner, and declining leaves the site fully usable.",

  "legal.cookies.02.heading": "What we set",
  "legal.cookies.02.caption": "The nine cookies this site may set, in four categories",
  "legal.cookies.02.col.name": "Name",
  "legal.cookies.02.col.purpose": "Purpose",
  "legal.cookies.02.col.life": "Life",
  "legal.cookies.02.band.essential": "Essential — set on load",
  "legal.cookies.02.band.preferences": "Preferences — set on use",
  "legal.cookies.02.band.analytics": "Analytics — optional",
  "legal.cookies.02.band.advertising": "Advertising — optional",
  "legal.cookies.02.bl_session.purpose": "Keeps you signed in",
  "legal.cookies.02.bl_session.life": "30 days",
  "legal.cookies.02.bl_csrf.purpose": "Blocks forged form submissions",
  "legal.cookies.02.bl_csrf.life": "Session",
  "legal.cookies.02.bl_consent.purpose": "Remembers your cookie choice",
  "legal.cookies.02.bl_consent.life": "12 months",
  "legal.cookies.02.bl_lang.purpose": "Language, English or Arabic",
  "legal.cookies.02.bl_lang.life": "12 months",
  "legal.cookies.02.bl_emirate.purpose": "Emirate and area you last browsed",
  "legal.cookies.02.bl_emirate.life": "90 days",
  "legal.cookies.02.bl_recent.purpose": "Listings you opened, for the compare tray",
  "legal.cookies.02.bl_recent.life": "30 days",
  "legal.cookies.02.bl_a_id.purpose": "Anonymous visit identifier for counting",
  "legal.cookies.02.bl_a_id.life": "13 months",
  "legal.cookies.02.bl_a_ses.purpose": "Groups pageviews into a single visit",
  "legal.cookies.02.bl_a_ses.life": "30 minutes",
  "legal.cookies.02.bl_sp.purpose": "Sponsored slots already shown, so they are not repeated",
  "legal.cookies.02.bl_sp.life": "7 days",
  "legal.cookies.02.p1": "Nine cookies, four categories, and the register above is the whole of it. A cookie not on this list is a defect; report it to privacy@businesslistings.me.",

  "legal.cookies.03.heading": "Your choices",
  "legal.cookies.03.p1": "The banner appears on the first visit and your answer is remembered for twelve months. Change it any time from Cookie settings in the footer. Withdrawing analytics consent stops collection and clears the identifiers on your next page load.",
  "legal.cookies.03.p2": "Your browser can block or delete cookies too. Blocking essential cookies signs you out and stops enquiries from sending, so the site says so rather than failing quietly.",
  "legal.cookies.03.p3": "We honour Global Privacy Control. Where your browser sends the signal, optional categories stay off and the banner records that rather than asking again.",

  "legal.cookies.04.heading": "What we do not do",
  "legal.cookies.04.p1": "No third-party advertising or retargeting tags. No social-network trackers. No fingerprinting to identify a device where you declined cookies. No selling of what analytics collects, and no passing of enquiry content to any advertising platform.",
  "legal.cookies.04.p2": "Sponsored placement is sold by position and category, not by following you around. A sponsored result is chosen by what you searched for, not by what you did last week.",

  "legal.cookies.05.heading": "Changes and contact",
  "legal.cookies.05.p1": "Changes are listed here with the date they take effect. Adding a cookie to an optional category asks for your consent again; renaming or shortening an existing one does not. Questions: privacy@businesslistings.me.",

  // ── Campaign attribution in the console, criterion 9 ──────────────────────
  "attribution.title": "Where enquiries come from",
  "attribution.eyebrow": "Demand",
  "attribution.meta": "{attributed} of {total} enquiries carry a source",
  "attribution.caption": "Enquiries by campaign and source, newest first",
  "attribution.col.campaign": "Campaign",
  "attribution.col.source": "Source",
  "attribution.col.medium": "Medium",
  "attribution.col.enquiries": "Enquiries",
  "attribution.col.first": "First",
  "attribution.col.last": "Last",
  "attribution.direct": "Direct or untagged",
  "attribution.empty": "No enquiry carries a source yet.",
  "attribution.note": "A source is recorded when a buyer arrives on a tagged link and kept for {days} days, so an enquiry sent a fortnight after the click is still attributed to it. First touch wins: a buyer won by a campaign who returns through a search is still the campaign's. Nothing here identifies a person — it is the three UTM values their own inbound link declared, and nothing else.",

  // ── Zero-result alerts, criterion 8 ───────────────────────────────────────
  //
  // The end of the flywheel. The gap is already recorded and already feeds the
  // recruitment call list; this is what turns it back into an enquiry.
  "alert.title": "Tell me when somebody lists it",
  "alert.body": "We record every search that finds nothing and use it to go and recruit the supplier who stocks it. Leave a number and we will tell you once — when a match is listed, not before.",
  "alert.watching": "Watching for",
  /* Board 1e — a watch on one out-of-stock line, not a search. */
  "product.notify_about": "Notify me when {product} is back in stock",
  "product.notify_confirm": "Tell me when it is back",
  "product.notify_set": "We will tell you once, when it is back in stock.",
  "seo.catalogue_title": "{name} product catalogue — {count} products",
  "catalogue.close_filters": "Close filters",
  "catalogue.sub": "Catalogue · {formatted} products · prices on enquiry",
  "catalogue.price_list": "Request a price list",
  "catalogue.price_list_requirement": "Please send your current price list for the products I have listed below.",
  "catalogue.rail_label": "Filter this catalogue",
  "catalogue.all_products": "All products",
  "catalogue.block_catalogue": "Catalogue",
  "catalogue.block_availability": "Availability",
  "catalogue.block_specs": "Spec filters",
  "catalogue.specs_from": "From this seller's spec template",
  "catalogue.sort_label": "Sort",
  "catalogue.sort.availability": "Availability first",
  "catalogue.sort.recent": "Recently added",
  "catalogue.sort.name": "Name A–Z",
  "catalogue.sort.enquired": "Most enquired",
  "catalogue.showing": { one: "{formatted} product", other: "{formatted} products" },
  "catalogue.show_more": { one: "Show {count} more", other: "Show {count} more" },
  /* Seen by the seller, on their own catalogue row. */
  "catalogue.watchers": { one: "{count} waiting", other: "{count} waiting" },
  "catalogue.specs_toggle": "Specs",
  "catalogue.specs_caption": "Specification for {product}",
  "catalogue.compare_prompt": "Comparing specs across sellers? Add up to 4 products to the comparison tray.",
  "catalogue.compare_cta": "Open the comparison tray",
  "catalogue.zero_title": "Nothing in this catalogue matches all of that",
  "catalogue.zero_drop": "Dropping {facet} gives you {count} of them.",
  "catalogue.zero_drop_cta": "Drop {facet}",
  "catalogue.zero_describe": "Or send one enquiry describing what you need — the supplier may have it even where the catalogue does not say so.",
  "catalogue.all_out_title": "Everything here is currently out of stock",
  "catalogue.all_out_body": "The supplier still quotes on indent orders.",
  "catalogue.search_scope": "THIS STORE",
  "catalogue.search_placeholder": "Search {formatted} products from {seller}",
  "catalogue.filters_button": { one: "Filters ({count})", other: "Filters ({count})" },
  "alert.contact": "Mobile number",
  "alert.contact_hint": "One message, once, when something matches. Nothing else, ever.",
  "alert.name": "Your name",
  "alert.submit": "Tell me when it is listed",
  "alert.set": "Set. We will message you once, when a match is listed.",
  "alert.already": "You already have an alert for that search.",

  // ── Renaming and removing a trade, criterion 7 ────────────────────────────
  "taxonomy.rename_title": "Move a trade's address",
  "taxonomy.rename_body": "Renaming a trade moves its page, every subcategory page under it — the address carries the parent's slug — and every area page for it. Each one gets a 301 in the same transaction, so a link printed last year still lands.",
  "taxonomy.pick": "Trade",
  "taxonomy.new_slug": "New address",
  "taxonomy.new_slug_hint": "Lowercase letters, digits and hyphens.",
  "taxonomy.affected": { one: "{count} address moves", other: "{count} addresses move" },
  "taxonomy.rename": "Rename and write the redirects",
  "taxonomy.renamed": "Renamed. {count} redirects written.",
  "taxonomy.remove": "Remove the trade",
  "taxonomy.removed": "Removed, and its address redirects.",
  "taxonomy.remove_hint": "Only where nothing is left pointing at it — no subcategories, no listings, no published area page. Its address redirects to the parent.",

  // Board 4d-s — how a trade is sold. Decision D5.
  "taxonomy.kind_title": "How a trade is sold",
  "taxonomy.kind_body": "By the item or by the job. Set a sector once and every trade under it follows, then change only the ones that disagree — Logistics holds customs clearance beside material handling equipment, so almost every sector has both.",
  "taxonomy.kind_hint": "Leave a trade blank to follow its sector. Nothing set anywhere is read as sold by the item, which is what every screen assumed before this existed.",
  "taxonomy.kind": "Sold",
  "taxonomy.kind_goods": "By the item",
  "taxonomy.kind_services": "By the job",
  "taxonomy.kind_inherit": "Follow the sector",
  "taxonomy.kind_set": "Set how it is sold",
  "taxonomy.kind_saved": "Saved. {count} trades change.",
  "taxonomy.kind_moves": { one: "{count} trade changes", other: "{count} trades change" },
  "taxonomy.kind_keeps": { one: "{count} keeps its own answer", other: "{count} keep their own answer" },
  "taxonomy.kind_unset": "Not set",
  "taxonomy.kind_from": "From {name}",
  "taxonomy.kind_own": "Set here",
  "taxonomy.kind_tally": "{services} of {total} trades are sold by the job. {set} have been decided; the rest follow a sector or the default.",
  // Board 4d-s — the trade kind board.
  "taxonomy.tab.taxonomy": "Taxonomy",
  "taxonomy.tab.kind": "Trade kind",
  "taxonomy.kind_board_title": "Trade kind",
  "taxonomy.kind_board_meta": "{decided} of {total} decided",
  "taxonomy.kind_board_caption": "Every trade, how it is sold, and who decided",
  "taxonomy.col.subcategory": "Trade",
  "taxonomy.col.sector": "Sector",
  "taxonomy.col.listings": "Listings",
  "taxonomy.col.set_by": "Set by",
  "taxonomy.kind_sector": "Sector",
  "taxonomy.kind_unset_first": "Unset first",
  "taxonomy.kind_unset_note": "{count} still resolve to sold by the item because nothing above them has been set. That is not a backlog for its own sake — it is {count} trades where a supplier may be shown the wrong screens.",
  "taxonomy.kind_none_unset": "Every trade resolves from a decision somebody made. Nothing is falling back.",
  "taxonomy.kind_selected": { one: "{count} selected", other: "{count} selected" },
  "taxonomy.kind_clear_selection": "Clear the selection",
  "taxonomy.kind_set_goods": "Set to sold by the item",
  "taxonomy.kind_set_services": "Set to sold by the job",
  "taxonomy.kind_clear_inherit": "Clear — inherit from the sector",
  "taxonomy.kind_confirm_title": "Change how these trades are sold",
  "taxonomy.kind_confirm_rows": { one: "{count} trade changes", other: "{count} trades change" },
  "taxonomy.kind_confirm_inheriting": { one: "{count} more follows it", other: "{count} more follow it" },
  "taxonomy.kind_confirm_listings": { one: "{count} published listing renders differently", other: "{count} published listings render differently" },
  "taxonomy.kind_confirm_nothing": "No published listing renders differently yet.",
  "taxonomy.kind_confirm_body": "Those businesses get a different onboarding, a different dashboard and a different storefront the next time each renders. Nothing they have already entered is converted or deleted — a product keeps its stock level and a service keeps its scope, and any field the other kind does not have stays empty for the seller to fill.",
  "taxonomy.kind_confirm_go": "Change them",
  "taxonomy.kind_cancel": "Cancel",
  "taxonomy.kind_saved_bulk": { one: "Saved. {count} trade changed.", other: "Saved. {count} trades changed." },
  "taxonomy.kind_read_only": "You can read how each trade is sold. Changing it is an ops lead decision.",
  "taxonomy.kind_inherit_card": "How inheritance works",
  "taxonomy.kind_inherit_body": "The column is nullable and blank inherits from the parent, so a sector is set once and a trade under it overridden only where it differs. The walk stops after eight levels. Not one of the 13 sectors is purely one or the other — logistics holds customs clearance beside material handling equipment — which is why the unit is the trade and not the sector.",
  "taxonomy.kind_provenance_card": "Why it sits on the trade",
  "taxonomy.kind_provenance_body": "The alternative was guessing from a licence activity code onto the business. Activity codes are a tax classification rather than a commercial one, and a business with three of them has no single answer. On the trade there is nothing to guess — and a company that sells servers and also sells cybersecurity needs no third state, because it holds one trade of each.",
  "taxonomy.kind_range": "{from}–{to} of {total}",
  "taxonomy.kind_prev": "Previous page",
  "taxonomy.kind_next": "Next page",
  "taxonomy.kind_page": "Page {page}",
  "taxonomy.kind_select_all": "Select every trade on this page",
  "taxonomy.kind_select_row": "Select {name}",
  "taxonomy.kind_empty": "No trades match.",
  // ── Guides, boards 10b and 6d ─────────────────────────────────────────────
  //
  // The public half. Read by strangers deciding whether to trust us, so §08
  // applies harder here than anywhere: say the number, never spin.
  // ── Board 10b · the guide index ──
  "subjects.title": "Guide subjects",
  "subjects.meta": "{count} subjects. {unfiled} published guides are not filed under one.",
  "subjects.caption": "The shelves the guide index browses by",
  "subjects.col.name": "Subject",
  "subjects.col.url": "Address",
  "subjects.col.published": "Published guides",
  "subjects.col.order": "Order",
  "subjects.new": "Add a subject",
  "subjects.edit": "Edit {name}",
  "subjects.empty": "No subjects yet. Every published guide is still linked from the index, under a shelf that says it is not filed.",
  "subjects.blurb": "One line",
  "subjects.blurb_hint": "Printed under the subject heading on the index and used as the subject page's own description.",
  "subjects.slug_hint": "The chip's address. It shares one namespace with every guide, because both live directly under /guides/ — a subject cannot take a slug an article already holds, and the save is refused rather than one of the two pages disappearing.",
  "subjects.note": "A subject is content, not a code constant: adding or renaming one costs a revalidation rather than a deploy. Board 10b leaves the taxonomy itself an open question — \"For suppliers\" is written for the other side of the marketplace and is deliberately not seeded here.",
  "guide_admin.check_recorded": "Recorded. The index shows the new date.",
  "guide_admin.check_title": "Regulatory check",
  "guide_admin.check_hint": "Records that a person has re-read this article's external facts against the source today. It is the date every reader sees beside the guide on the index, and the thing that clears an overdue row.",
  "guide_admin.check_last": "Last checked {date}",
  "guide_admin.check_never": "No check recorded. The index says so rather than showing the publication date as if it were one.",
  "guide_admin.check_cta": "Record a check today",
  "guide_admin.featured_note": "Why this one is first",
  "guide_admin.featured_note_hint": "One line under the standfirst. It travels with the slot and is cleared when the slot moves, because a sentence explaining why an article is first is false the moment a different article is.",
  "guide_admin.featured_set": "Start-here slot moved.",
  "guide_admin.featured_is": "This guide holds the start-here slot on the index.",
  "guide_admin.featured_not": "This guide does not hold the start-here slot.",
  "guide_admin.featured_hint": "One guide at a time, and it is an editorial choice rather than a ranking — the pill on the index says Start here, not Most read. The slot should hold the article a first-time reader needs first.",
  "guide_admin.featured_set_cta": "Give it the start-here slot",
  "guide_admin.featured_clear": "Clear the start-here slot",
  "guide_admin.subject_saved": "Subject saved.",
  "guide_admin.field.standfirst": "Standfirst",
  "guide_admin.field.standfirst_hint": "The sentence that states the problem, not a summary of the article. It is what the index prints under the title and what Google shows.",
  "guide_admin.field.topic": "Kicker topic",
  "guide_admin.field.topic_hint": "The middle term of GUIDE · VERIFICATION · 6 MIN on the article itself. Not the index's subject.",
  "guide_admin.field.byline_role": "Byline role",
  "guide_admin.field.subject": "Subject",
  "guide_admin.field.subject_hint": "Which shelf the index files this under, and which subject page links to it. Unfiled guides are still listed, under a shelf that says so.",
  "guide_admin.field.sort_order": "Sequence",
  "guide_admin.field.sort_order_hint": "Order within the subject, lowest first. The index sorts on this rather than on the review date — a guide re-checked yesterday is not more useful than the one that explains the badge.",
  "guide_admin.field.cadence": "Review window, months",
  "guide_admin.field.cadence_hint": "How often the external facts need re-checking. Leave empty for an article that names no authority and no rate: an empty window is never overdue, and a window of nought would be overdue from the day it published.",
  "guide_admin.no_subject": "Not filed",
  "guides.index_h1": "How buying works in the UAE, in plain English.",
  /*
     No list of topics. The board's standfirst named four — verification,
     quoting, payment terms, getting a supplier to turn up — against a
     programme of twenty-two. At two published guides, both about verification,
     that sentence would be a queried number wrapped in a claim about content
     that does not exist. The count is the only part that can be true of every
     state the page launches through, so the count is the only part that is
     specific.
  */
  "guides.index_lede": {
    one: "{count} guide on buying from UAE suppliers, free to read. No gated PDFs, no sign-up.",
    other: "{count} guides on buying from UAE suppliers, free to read. No gated PDFs, no sign-up.",
  },
  "guides.index_lede_empty": "Nothing published yet. The directory is the place to start in the meantime.",
  /*
     The claim the strip makes, and it is deliberately about the checking rather
     than about the authorship.

     The board's headline read "written by people who check licences all day",
     which names the verification team as the authors while every article ships
     with "Business Listings editorial" and no name — board 6d Q1, still open.
     An index that claims specific authorship while the articles carry none is
     worse than one that claims nothing, because the index is the page that sets
     the expectation. What IS true and recorded is the check: every date beside
     every guide is an audited `recordRegulatoryCheck`.
  */
  "guides.strip_claim": "Checked against the source, not rewritten from other sites.",
  "guides.strip_meta": "Last review pass {date} · {guides} · {reviewed} reviewed this quarter",
  "guides.strip_meta_unchecked": "{guides} · no review recorded yet",
  "guides.strip_link": "How we check these",
  "guides.chip_all": { one: "All {count}", other: "All {count}" },
  "guides.chips_label": "Guide subjects",
  "guides.start_here": "Start here",
  "guides.featured_why": "Read this one first: it is where we set out what our verification badge covers, and what it does not.",
  "guides.read_the_guide": "Read the guide",
  "guides.browse_suppliers": "Browse verified suppliers",
  "guides.every_guide": "Every guide",
  "guides.every_guide_note": "Nothing here is behind a button.",
  "guides.unfiled": "Not yet filed",
  "guides.unfiled_blurb": "Published, and waiting for an editor to put it on a shelf. It is linked here so it is never reachable only by search.",
  "guides.entry_meta": "{minutes} min · checked {date}",
  "guides.entry_meta_unchecked": "{minutes} min · not yet checked",
  "guides.entry_overdue": "Review overdue",
  "guides.card_meta": "{subject} · {minutes} min · checked {date}",
  "guides.card_meta_unchecked": "{subject} · {minutes} min",
  "guides.card_meta_nosubject": "{minutes} min · checked {date}",
  "guides.dates_note": "Dates are when a person last checked the regulatory detail against the source, not when the page was last deployed. Overdue means we have not checked in the article's own review window — the guide is still accurate as far as we know, and we would rather say so than hide it.",
  "guides.browse_directory": "Browse suppliers",
  "guides.subject_title": "{subject} guides",
  "guides.subject_back": "All guides",
  "guides.subject_empty": "No guides on this subject yet.",
  "guides.one_guide_note": "One guide so far. The rest of the programme is being written.",
  // The author page the strip links to — board 10b, and 6d Q1's placeholder.
  "guides.how_h1": "How we check these guides",
  "guides.how_lede": "Every guide here makes claims about licensing authorities, VAT and renewal cadences. Those change. This is what we do about it.",
  "guides.how_process": "Process",
  "guides.how_step_source": "Each regulatory claim is read against the authority that publishes it, not against another directory.",
  "guides.how_step_date": "The date of that reading is recorded on the article and shown to you on the index, whether it is recent or not.",
  "guides.how_step_cadence": "An article naming an authority or a rate carries a review window. One about how to write a good enquiry does not, because it makes no claim about the world.",
  "guides.how_step_overdue": "When an article passes its window it says so, and it stays published. A stale fact is not a misrepresented supplier, and hiding the date would be the part we could not defend.",
  "guides.how_record": "The record",
  "guides.how_row_guides": "Guides published",
  "guides.how_row_last": "Last review pass",
  "guides.how_row_quarter": "Reviewed this quarter, of those carrying a review window",
  "guides.how_row_overdue": "Past their review window, and still published",
  "guides.how_author": "Who writes them",
  /*
     Board 6d Q1, answered 9 Sep 2026. This said guides carry no individual
     byline "because naming a person is an editorial decision that has not been
     taken" — which was true of the decision and false of the seed, where four
     guides were published under a person who did not exist.

     A real name settles both halves. What the sentence still has to do is say
     what a byline on this site means, because a name over an article about
     licensing and VAT is a claim: it names who stands behind it, not who typed
     it.
  */
  "guides.how_author_body": "Guides are written and checked in-house by the team that runs verification, and published under a named member of staff. The byline says who stands behind the article, not who typed it: if something here is wrong, that is the person it is wrong for. More names appear as the team writing them grows.",
  "guides.how_back": "Back to the guides",
  "guides.title": "Guides",
  "guides.eyebrow": "Guides",
  "guides.lede": "How verification works, what a quote should tell you, which payment terms are normal in the UAE, and how to get a supplier to actually turn up.",
  "guides.meta": { one: "{count} guide", other: "{count} guides" },
  "guides.empty": "No guides yet.",
  "guides.empty_body": "Nothing has been published here. The directory is the place to start in the meantime.",
  "guides.back": "All guides",
  "guides.published": "Published {date}",
  "guides.updated": "Updated {date}",
  "guides.byline": "By {name}",
  "guides.read_next": "More guides",

  // ── Board 6d, the article template ────────────────────────────────────────
  "guides.on_this_page": "On this page",
  // The kicker. `topic` is absent on a guide that belongs to no trade, and the
  // second form is what renders then — never an empty middle term.
  "guides.kicker": "Guide · {topic} · {minutes} min read",
  "guides.kicker_untopiced": "Guide · {minutes} min read",
  // Both dates, and the second is the point of the strip: the article names a
  // specific authority and a specific VAT rate, and both change.
  "guides.dates": "Published {published} · Regulatory detail last checked {checked}",
  "guides.dates_unchecked": "Published {published}",
  "guides.byline_role": "{name}, {role}",
  "guides.related": "Related guides",
  "guides.related_minutes": "{minutes} min",
  "guides.why_title": "Why we write these",
  "guides.why_body": "Guides bring in buyers who are not looking for a supplier yet, and they earn the links that make our area pages findable at all. Every one of them ends in the directory, because that is what they are for.",
  // Acceptance 9: the count states what it counts. The nav counts listings plus
  // catalogue products; this counts sellers whose licence is checked and
  // current. The two are not comparable and nothing should invite the comparison.
  "guides.cta_count": { one: "{count} supplier with a trade licence we have checked and found current", other: "{count} suppliers with a trade licence we have checked and found current" },
  "guides.cta_default": "Find a supplier",
  "guides.cta_category": "Browse {category}",
  "guides.cta_rfq": "Post a requirement",
  "guides.cta_fallback": "This is a directory of licensed UAE suppliers. Search it, or send one requirement to up to eight of them.",

  // The block vocabulary, named for the editor.
  "guide.block.heading": "Heading",
  "guide.block.quote": "Pull quote",
  "guide.block.text": "Paragraph",
  "guide.block.list": "Bullets",
  "guide.block.steps": "Numbered steps",
  "guide.block.callout": "Callout",
  "guide.block.cta": "Directory call to action",

  // ── Guides admin, boards 10b and 6d ───────────────────────────────────────
  "guide_admin.title": "Guides",
  "guide_admin.eyebrow": "Content",
  "guide_admin.meta": "{published} published, {drafts} in draft",
  "guide_admin.caption": "Every guide, drafts first",
  "guide_admin.col.title": "Title",
  "guide_admin.col.slug": "Address",
  "guide_admin.col.words": "Words",
  "guide_admin.col.status": "Status",
  "guide_admin.col.updated": "Updated",
  "guide_admin.status.published": "Published",
  "guide_admin.status.draft": "Draft",
  "guide_admin.new": "New guide",
  "guide_admin.edit": "Edit {title}",
  "guide_admin.empty": "No guides yet. The first one is the one that earns the links.",
  "guide_admin.panel.details": "The article",
  "guide_admin.panel.body": "Body",
  "guide_admin.panel.commit": "Save and publish",
  "guide_admin.field.title": "Title",
  "guide_admin.field.slug": "Address",
  "guide_admin.field.slug_hint": "businesslistings.me/guides/…  Fixed once published.",
  "guide_admin.field.summary": "Summary",
  "guide_admin.field.summary_hint": "One sentence. It is the card on the index and the meta description.",
  "guide_admin.field.byline": "Byline",
  "guide_admin.field.cta": "Send readers to",
  "guide_admin.field.cta_none": "The directory",
  "guide_admin.field.body": "Body",
  "guide_admin.field.reason": "Reason",
  "guide_admin.field.reason_hint": "Recorded in the audit log against your name.",
  "guide_admin.words": "{words} of {need} words",
  "guide_admin.words_short": "{short} more to publish",
  "guide_admin.save": "Save",
  "guide_admin.saved": "Saved.",
  "guide_admin.publish": "Publish",
  "guide_admin.published": "Published. It is live now, and in the sitemap on the next build.",
  "guide_admin.published_at": "Published {date}.",
  "guide_admin.unpublish": "Unpublish",
  "guide_admin.unpublished": "Unpublished. It is out of the index on the next build.",
  "guide_admin.delete": "Delete",
  "guide_admin.deleted": "Deleted.",
  "guide_admin.add_block": "Add",
  "guide_admin.remove_block": "Remove this {kind}",
  "guide_admin.move_up": "Move this {kind} up",
  "guide_admin.move_down": "Move this {kind} down",
  "guide_admin.block_items": "One per line",
  "guide_admin.note": "A guide publishes at {need} words. It is the same floor a landing page intro answers to, for the same reason: below it there is nothing for a search engine to rank and nothing for a reader to trust.",

  // ── Not found ─────────────────────────────────────────────────────────────
  "notfound.title": "That page is not here",
  "notfound.body": "The address may be mistyped, the page may have moved, or you may not be signed in to the account it belongs to.",
  "notfound.signin": "Sign in",
  "notfound.home": "Go to the directory",

} as const satisfies Catalogue;

export type MessageKey = keyof typeof en;
