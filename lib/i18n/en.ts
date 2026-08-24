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
  "action.more": "More actions",
  "action.row_menu": "More actions for this row",

  // ── Gallery. A dev surface, but its copy goes through t() like anything else,
  //    so the acceptance grep has nothing to find and the catalogue is exercised.
  "gallery.tab_businesses": "Businesses",
  "gallery.tab_products": "Products",
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
  "nav.setup": "Setup",
  "nav.listing": "Listing profile",
  "nav.locations": "Locations",
  "nav.hours": "Hours & Ramadan",
  "nav.verification": "Verification",
  "nav.products": "Products",
  "nav.media": "Media",
  "nav.leads": "Leads & RFQ",
  "nav.quotes": "Quotes",
  "nav.reviews": "Reviews",
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
  "nav.visits": "Field visits",
  "nav.crm": "Recruitment",
  "nav.categories": "Taxonomy",
  "nav.spec_library": "Spec templates",
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

  "nav.label.dashboard": "Seller navigation",
  "nav.label.admin": "Staff navigation",
  "nav.label.public": "Directory navigation",
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
  "display.map_empty": "No pinned locations to show",
  "display.map_excluded": { one: "{count} branch has no map pin", other: "{count} branches have no map pin" },
  "display.map_label": "Supplier locations",
  "display.remove_filter": "Remove the {facet} filter",
  "display.conversion": "{pct}% of the step before",
  "display.profile_strength": "Profile strength",
  "display.spec_completeness": "Spec completeness",
  "display.fields_filled": "{filled} / {total} fields",
  "display.setup_progress": "{done} of {total} done",
  "display.setup": "Setup",
  "display.self_reported": "Self-reported by the supplier",
  "display.material_ductile_iron": "Ductile iron",

  // ── Trust ──
  "verification.tier": "Verification tier {tier}",
  "verification.unverified": "Not yet verified",
  "response.median": "Typically replies in {duration}",
  "response.unmeasured": "Not enough enquiries to measure",
} as const satisfies Catalogue;

export type MessageKey = keyof typeof en;
