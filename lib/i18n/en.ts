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

  // ── Trust ──
  "verification.tier": "Verification tier {tier}",
  "verification.unverified": "Not yet verified",
  "response.median": "Typically replies in {duration}",
  "response.unmeasured": "Not enough enquiries to measure",
} as const satisfies Catalogue;

export type MessageKey = keyof typeof en;
