import type { Role } from "./roles";

/**
 * The permission matrix.
 *
 * Transcribed from `docs/permissions.md` — design-system §07 and boards 7d and
 * 4i — which is the source of truth. Every row below is `stated`: the file that
 * shipped before it carried an inferred matrix with a note to diff it against
 * §07, and this is that diff, applied.
 *
 * Nine rows were wrong, and they were not all wrong in the safe direction:
 *
 *   - `plan.change` and `visit.request` had been given to seats that do not
 *     hold them, which is a real over-grant.
 *   - `team.manage`, `routing.manage` and `analytics.read` had been withheld
 *     from a manager who does hold them, which is a product that does not work
 *     for the seat it was designed around.
 *   - `review.remove`, `placement.boost`, `subscription.credit` and
 *     `revenue.read` all had an extra staff role attached, and the extra role
 *     was `ops_lead` three times out of four. "The most senior role can do
 *     everything" is a plausible assumption and this matrix does not make it.
 *
 * `audited: true` means a state change that must write an AuditEvent with a
 * written reason. Per §07: **every ✓ in the staff table that changes state
 * writes one, and ops lead has no exemption.**
 *
 * Three rows are subject-dependent and cannot be answered by a role alone —
 * `can()` is deliberately not the whole check for them. See `subject.ts`, and
 * the `subject` field below, which names what else has to be true.
 */
export interface CapabilitySpec {
  roles: readonly Role[];
  audited: boolean;
  source: "stated" | "inferred";
  why: string;
  /**
   * Set where a role grant is necessary but not sufficient.
   *
   * The presence of this field is a promise that `can()` alone is the wrong
   * check, and `lib/auth/subject.ts` exports the function that completes it.
   */
  subject?: "own_visit" | "own_branch" | "other_business";
}

const OPS_LEAD_ONLY = ["staff_ops_lead"] as const satisfies readonly Role[];

export const CAPABILITIES = {
  // ── Trust. The one row nothing may soften. ────────────────────────────────
  "business.verification_tier.write": {
    roles: ["staff_ops_lead", "staff_field"],
    audited: true,
    source: "stated",
    why: "§07 staff table. Ops lead unconditionally; a field verifier only as the result of a visit they recorded — permissions.md: \"it is not a general grant. Enforce with a subject check, not just a role check.\" CLAUDE.md non-negotiable 2 still holds: no seller, no API path, no self-service.",
    subject: "own_visit",
  },
  "visit.record": {
    roles: ["staff_ops_lead", "staff_field"],
    audited: true,
    source: "stated",
    why: "§07 staff table. Recording a visit is what later licenses the tier change above, so the same two roles hold it and the tier check reads the visit this one wrote.",
  },
  "business.suspend": {
    roles: OPS_LEAD_ONLY,
    audited: true,
    source: "stated",
    why: "§07 cross-surface and staff tables agree: superadmin only. Taking a paying supplier off the directory is the most severe reversible act on the platform.",
  },
  "business.merge": {
    roles: OPS_LEAD_ONLY,
    audited: true,
    source: "inferred",
    why: "Not a row in §07. Audited action `merge`, /admin/ingest/dedupe. Held at ops lead because a merge rewrites slugs and creates 301s, so it is not reversible the way a review removal is. Still inferred — flag it if §07 gains a row.",
  },
  "claim.resolve": {
    roles: OPS_LEAD_ONLY,
    audited: true,
    source: "stated",
    why: "§07 staff table, \"Resolve claim conflicts\". Deciding who owns a listing is the most consequential thing staff do to a business that is not suspending it, and a moderator does not hold it.",
  },

  // ── Moderation ────────────────────────────────────────────────────────────
  "review.remove": {
    roles: OPS_LEAD_ONLY,
    audited: true,
    source: "stated",
    why: "§07, both tables. A moderator may reject a submission and resolve a report but may not remove a review — this was inferred as moderator + ops lead and the matrix says ops lead alone. Removing a buyer's published words is held one rung higher than moderating a queue.",
  },
  "review.hold": {
    roles: ["staff_moderator", "staff_ops_lead"],
    audited: true,
    source: "inferred",
    why: "Board 1m states the held state — \"one review is being reviewed by our team\", excluded from every average while it stands — without saying who may set it. Not a row in \u00a707. Held one rung below `review.remove` deliberately: a hold is reversible and a removal is not, and putting a reversible pause at ops lead alone would push a moderator towards the irreversible control. Flag it if \u00a707 gains a row.",
  },
  "question.remove": {
    roles: OPS_LEAD_ONLY,
    audited: true,
    source: "inferred",
    why: "Board 1g. A product question carries a buyer's published words and a seller's answer, and taking it down is the same decision as removing a review — so it sits at the same rung rather than with the moderation queue. Held at ops lead deliberately: erring higher is the safe direction for removing something a person wrote in public.",
  },
  "report.resolve": {
    roles: ["staff_moderator", "staff_ops_lead"],
    audited: true,
    source: "stated",
    why: "§07 staff table, \"Resolve a supplier report\". Outcomes are seller_corrected | upheld | no_action and outcomeReason travels with them.",
  },
  "queue.decide": {
    roles: ["staff_moderator", "staff_ops_lead"],
    audited: true,
    source: "stated",
    why: "§07 staff table, \"Approve listings & edits\" and \"Reject with reason\". This is the queue handoff 3's ListingChangeRequest fills.",
  },
  "support.view_as": {
    roles: ["staff_moderator", "staff_ops_lead"],
    audited: true,
    source: "stated",
    why: "§07 staff table, \"View-as a business\". Looking through a seller's eyes is a privacy event and is audited even though it changes nothing.",
  },
  "enquiry.read_other_business": {
    roles: ["staff_moderator", "staff_ops_lead"],
    audited: true,
    source: "stated",
    why: "§07 cross-surface, and the row permissions.md calls the one that matters most: \"support needs it, and it must be impossible to do silently.\" Audit-only for both roles that have it — the grant is not the permission, the audit row is the condition.",
    subject: "other_business",
  },

  // ── Commercial ────────────────────────────────────────────────────────────
  "subscription.credit": {
    roles: ["staff_finance"],
    audited: true,
    source: "stated",
    why: "§07 staff table: finance only, and ops lead is a dash. Was inferred as finance + ops lead. A subscription credit moves money we did charge; it is never a refund of buyer money, which does not exist.",
  },
  "plan.entitlements.write": {
    roles: ["staff_ops_lead", "staff_finance"],
    audited: true,
    source: "stated",
    why: "§07 staff table, \"Edit plans & entitlements\". The only commercial row ops lead and finance share.",
  },
  "revenue.read": {
    roles: ["staff_finance"],
    audited: false,
    source: "stated",
    why: "§07 staff table, \"Export VAT / finance data\": finance only. Was inferred as finance + ops lead. Reading does not change state, so it is not audited — but it is not everybody's to read either.",
  },
  "placement.boost": {
    roles: OPS_LEAD_ONLY,
    audited: true,
    source: "stated",
    why: "§07 staff table, \"Manual boost / demote a listing\": ops lead only. Was inferred as finance + ops lead on the theory that a sold slot belongs to finance. It does not — moving a listing up a results page is a ranking decision, and ranking sits with ops.",
  },
  "search.ranking.write": {
    roles: OPS_LEAD_ONLY,
    audited: true,
    source: "stated",
    why: "§07 staff table, \"Adjust search ranking weights\". Changes what every buyer sees, so it is the narrowest grant in the table.",
  },

  // ── Platform ──────────────────────────────────────────────────────────────
  "taxonomy.write": {
    roles: OPS_LEAD_ONLY,
    audited: true,
    source: "stated",
    why: "§07 staff table, \"Edit taxonomy & spec templates\". Renaming a category creates a 301 and breaks cross-seller comparison.",
  },
  "storefront.template.write": {
    roles: OPS_LEAD_ONLY,
    audited: true,
    source: "stated",
    why: "§07, both tables. A storefront builder is a superadmin tool and is explicitly out of scope for sellers — handoff 3's README says so too.",
  },
  "staff.manage": {
    roles: OPS_LEAD_ONLY,
    audited: true,
    source: "inferred",
    why: "Not a row in §07. /admin/staff — granting a role is how somebody else gets these capabilities, so it is held at the top. Still inferred.",
  },
  "audit.read": {
    roles: ["staff_ops_lead", "staff_moderator", "staff_field", "staff_finance"],
    audited: false,
    source: "stated",
    why: "§07 staff table: ops lead reads all of it, every other staff role reads their own actions. Was inferred as ops-lead-only, which is the wrong shape — a moderator being able to see what they themselves did is not a loosening of the check on staff, it is how somebody answers a question about their own work.",
    subject: "other_business",
  },

  // ── Seller (board 7d) ─────────────────────────────────────────────────────
  "listing.edit": {
    roles: ["seller_owner", "seller_manager"],
    audited: false,
    source: "stated",
    why: "Board 7d, \"Edit listing profile, locations, hours\" and \"Upload verification documents\" and \"Pick a theme preset\" — owner and manager. Sales and finance do not shape the public profile.",
  },
  "product.edit": {
    roles: ["seller_owner", "seller_manager"],
    audited: false,
    source: "stated",
    why: "Board 7d, \"Edit products & specs\" and \"Bulk import / export catalogue\".",
  },
  "enquiry.respond": {
    roles: ["seller_owner", "seller_manager", "seller_sales"],
    audited: false,
    source: "stated",
    why: "Board 7d, \"Reply to enquiries & send quotes\". A branch-scoped sales seat is further limited to that branch's enquiries — board 7d shows Fatima scoped to Al Quoz — which a role check alone cannot express.",
    subject: "own_branch",
  },
  "quote.send": {
    roles: ["seller_owner", "seller_manager", "seller_sales"],
    audited: false,
    source: "stated",
    why: "Board 7d, \"Reply to enquiries & send quotes\" and \"Send a quote revision\". Branch-scoped the same way.",
    subject: "own_branch",
  },
  "review.reply": {
    roles: ["seller_owner", "seller_manager"],
    audited: false,
    source: "stated",
    why: "Board 7d, \"Reply to a review\". Not the sales seat: a reply is the business speaking on its public page, not a message to one buyer.",
  },
  "review.request": {
    roles: ["seller_owner", "seller_manager", "seller_sales"],
    audited: false,
    source: "stated",
    why: "Board 7d, \"Request reviews from buyers\". The sales seat has it, because the person who handled the enquiry is the person who knows it went well.",
  },
  "visit.request": {
    roles: ["seller_owner"],
    audited: false,
    source: "stated",
    why: "Board 7d, \"Request a site visit\": owner only. Was inferred as listing.edit, which handed it to a manager. Somebody from this platform coming to the premises is the owner's decision.",
  },
  "analytics.read": {
    roles: ["seller_owner", "seller_manager", "seller_sales"],
    audited: false,
    source: "stated",
    why: "Board 7d, \"See analytics\": owner and manager in full, a sales seat for their own leads only, finance not at all. Was inferred as owner + manager + finance, which is wrong at both ends.",
    subject: "own_branch",
  },
  "billing.manage": {
    roles: ["seller_owner", "seller_finance"],
    audited: false,
    source: "stated",
    why: "Board 7d, \"See invoices & billing\". The finance seat exists so the owner does not have to hold the card.",
  },
  "placement.purchase": {
    roles: ["seller_owner", "seller_finance"],
    audited: false,
    source: "stated",
    why: "Board 7d, \"Buy sponsored placement\". A purchase, so it sits with the seat that holds the card. Distinct from placement.boost, which is the staff side of the same object and is ops-lead-only.",
  },
  "plan.change": {
    roles: ["seller_owner"],
    audited: false,
    source: "stated",
    why: "Board 7d, \"Change plan or cancel\": owner only. Was inferred as owner + finance by analogy with billing.manage, and the matrix separates them — a finance seat reads the invoices and does not decide what the business buys.",
  },
  "team.manage": {
    roles: ["seller_owner", "seller_manager"],
    audited: false,
    source: "stated",
    why: "Board 7d, \"Invite or remove team members\": owner and manager. Was inferred as owner-only on the theory that seats cost money. A manager who cannot add the person who answers enquiries is a manager who has to ask the owner every time.",
  },
  "routing.manage": {
    roles: ["seller_owner", "seller_manager"],
    audited: false,
    source: "stated",
    why: "Board 7d, \"Set lead routing rules\": owner and manager. Split out of team.manage, which was owner-only and therefore withheld this from the seat that runs the day.",
  },

  // ── Buyer ─────────────────────────────────────────────────────────────────
  "enquiry.create": {
    roles: ["buyer", "seller_owner", "seller_manager", "seller_sales", "seller_finance"],
    audited: false,
    source: "stated",
    why: "§07 cross-surface, \"Send an enquiry / RFQ\": buyer ✓ and seller ✓. A supplier buying from another supplier is ordinary trade, and this row was inferred as buyer-only.",
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

/**
 * Capabilities a role grant does not finish answering.
 *
 * `grep` this list before adding a call site: every one of them needs the
 * matching function from `lib/auth/subject.ts` as well as `can`.
 */
export const SUBJECT_DEPENDENT = CAPABILITY_LIST.filter((c) => "subject" in CAPABILITIES[c]);

export function isCapability(value: string): value is Capability {
  return Object.hasOwn(CAPABILITIES, value);
}
