import type { Role } from "./roles";

/**
 * The permission matrix.
 *
 * ⚠ design-system §07 carries the authoritative matrix and lives in the canvas
 * file, which has not been supplied. Every row below is marked `stated` where a
 * shipped document says it outright, or `inferred` where it was derived from the
 * role name, the route table in docs/routes.md and the audit action list in
 * docs/data-model.md. Diff the inferred rows against §07 before handoff 1.
 *
 * `audited: true` means a state change that must write an AuditEvent with a
 * written reason. The service layer enforces the pairing — see lib/audit.
 */
export interface CapabilitySpec {
  roles: readonly Role[];
  audited: boolean;
  source: "stated" | "inferred";
  why: string;
}

const OPS_LEAD_ONLY = ["staff_ops_lead"] as const satisfies readonly Role[];

export const CAPABILITIES = {
  // ── Trust. The one row nothing may soften. ────────────────────────────────
  "business.verification_tier.write": {
    roles: OPS_LEAD_ONLY,
    audited: true,
    source: "stated",
    why: "CLAUDE.md non-negotiable 2: verification_tier is writable only by ops_lead. No API path, no self-service, no seller-editable field.",
  },
  "business.suspend": {
    roles: OPS_LEAD_ONLY,
    audited: true,
    source: "inferred",
    why: "Listed as an audited staff action in data-model.md. Taking a paying supplier off the directory is the most severe reversible act on the platform; held at ops_lead until §07 says otherwise.",
  },
  "business.merge": {
    roles: OPS_LEAD_ONLY,
    audited: true,
    source: "inferred",
    why: "Audited action `merge`. /admin/ingest/dedupe. A merge rewrites slugs and creates 301s, so it is not reversible in the way a review removal is.",
  },

  // ── Moderation ────────────────────────────────────────────────────────────
  "review.remove": {
    roles: ["staff_moderator", "staff_ops_lead"],
    audited: true,
    source: "inferred",
    why: "Audited action `review_removed`. The moderator role exists for exactly this queue; removalReason is already NOT NULL when removedAt is set.",
  },
  "report.resolve": {
    roles: ["staff_moderator", "staff_ops_lead"],
    audited: true,
    source: "inferred",
    why: "SupplierReport outcomes are seller_corrected | upheld | no_action, and outcomeReason travels with them. /admin/reports.",
  },
  "queue.decide": {
    roles: ["staff_moderator", "staff_ops_lead"],
    audited: true,
    source: "inferred",
    why: "/admin/queue and /admin/queue/:id — approving or rejecting a submission changes what the public sees.",
  },

  // ── Field ─────────────────────────────────────────────────────────────────
  "visit.record": {
    roles: ["staff_field", "staff_ops_lead"],
    audited: true,
    source: "inferred",
    why: "Business.visitedAt and visitedByStaffId, /admin/visits. Tier 3 additionally requires visitedAt, so a visit record feeds a trust signal and has to be attributable.",
  },

  // ── Commercial ────────────────────────────────────────────────────────────
  "subscription.credit": {
    roles: ["staff_finance", "staff_ops_lead"],
    audited: true,
    source: "inferred",
    why: "Audited action `credit_issued`. A subscription credit moves money we did charge; it is never a refund of buyer money, which does not exist.",
  },
  "placement.boost": {
    roles: ["staff_finance", "staff_ops_lead"],
    audited: true,
    source: "inferred",
    why: "Audited action `boost`. PlacementSlot is sold, so the finance role owns it. /admin/search carries ranking and boosts.",
  },
  "revenue.read": {
    roles: ["staff_finance", "staff_ops_lead"],
    audited: false,
    source: "inferred",
    why: "/admin/revenue, /admin/subscriptions, /admin/tax. Reading does not change state.",
  },

  // ── Platform ──────────────────────────────────────────────────────────────
  "taxonomy.write": {
    roles: OPS_LEAD_ONLY,
    audited: true,
    source: "inferred",
    why: "/admin/categories and /admin/spec-library. Renaming a category creates a 301 and a rename breaks cross-seller comparison, so it is not a routine edit.",
  },
  "staff.manage": {
    roles: OPS_LEAD_ONLY,
    audited: true,
    source: "inferred",
    why: "/admin/staff — granting a role is how someone else gets these capabilities.",
  },
  "audit.read": {
    roles: OPS_LEAD_ONLY,
    audited: false,
    source: "inferred",
    why: "/admin/audit. The log is the check on staff, so the people being checked cannot all read it.",
  },
  "support.view_as": {
    roles: ["staff_moderator", "staff_ops_lead"],
    audited: true,
    source: "inferred",
    why: "Audited action `view_as`. Looking through a seller's eyes is a privacy event and is audited even though it changes nothing.",
  },

  // ── Seller ────────────────────────────────────────────────────────────────
  "listing.edit": {
    roles: ["seller_owner", "seller_manager"],
    audited: false,
    source: "inferred",
    why: "/dashboard/listing, locations, hours, media. Sales and finance seats do not shape the public profile.",
  },
  "product.edit": {
    roles: ["seller_owner", "seller_manager"],
    audited: false,
    source: "inferred",
    why: "/dashboard/products and the CSV import mapper.",
  },
  "enquiry.respond": {
    roles: ["seller_owner", "seller_manager", "seller_sales"],
    audited: false,
    source: "inferred",
    why: "/dashboard/leads. The sales seat exists to answer enquiries, and response time is the number the seller is judged on.",
  },
  "quote.send": {
    roles: ["seller_owner", "seller_manager", "seller_sales"],
    audited: false,
    source: "inferred",
    why: "/dashboard/quotes. A quote carries the only prices in the system, so the seat that talks to buyers owns it.",
  },
  "billing.manage": {
    roles: ["seller_owner", "seller_finance"],
    audited: false,
    source: "inferred",
    why: "/dashboard/billing and plan change. The finance seat exists so the owner does not have to hold the card.",
  },
  "team.manage": {
    roles: ["seller_owner"],
    audited: false,
    source: "inferred",
    why: "/dashboard/team. Only the owner adds seats, because seats cost money and grant the capabilities above.",
  },

  // ── Buyer ─────────────────────────────────────────────────────────────────
  "enquiry.create": {
    roles: ["buyer"],
    audited: false,
    source: "stated",
    why: "The conversion event. README: buyers find licensed suppliers and send enquiries.",
  },
  "quote.accept": {
    roles: ["buyer"],
    audited: false,
    source: "stated",
    why: "The terminal state. Accepting releases contact to one business and declines the rest; nothing else is created.",
  },
  "review.create": {
    roles: ["buyer"],
    audited: false,
    source: "stated",
    why: "Review requires a confirmed enquiry or an accepted quote, one per enquiry.",
  },
} as const satisfies Record<string, CapabilitySpec>;

export type Capability = keyof typeof CAPABILITIES;

export const CAPABILITY_LIST = Object.keys(CAPABILITIES) as Capability[];

/** Capabilities whose use must write an AuditEvent carrying a written reason. */
export const AUDITED_CAPABILITIES = CAPABILITY_LIST.filter((c) => CAPABILITIES[c].audited);

export function isCapability(value: string): value is Capability {
  return Object.hasOwn(CAPABILITIES, value);
}
