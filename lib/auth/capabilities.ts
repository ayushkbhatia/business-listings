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
    roles: ["staff_ops_lead"],
    audited: true,
    source: "inferred",
    why: "§07 staff table gave this to the ops lead unconditionally and to a field verifier as the result of a visit they recorded — a subject check rather than a role check. Site visits were withdrawn, and with them the only thing that ever licensed the field verifier's half: `canSetVerificationTier` read `Business.visitedByStaffId`, which no longer exists. Rather than widen it to an unconditional grant, the narrower half is gone and the capability is ops-lead only. Board 4i then retired the field verifier role outright (`B1`, `B2`) — an idle role that could still write `verificationTier` is the privilege nobody watches. Board 4i Q2 keeps this row as an ops-lead override: tier 2 normally follows from licence verification, and a manual change carries a mandatory reason like every other row here. CLAUDE.md non-negotiable 2 is unchanged and this tightens it: no seller, no API path, no self-service, and no second staff role.",
  },
  "business.suspend": {
    roles: OPS_LEAD_ONLY,
    audited: true,
    source: "stated",
    why: "§07 cross-surface and staff tables agree: superadmin only. Taking a paying supplier off the directory is the most severe reversible act on the platform.",
  },
  "account.suspend": {
    roles: OPS_LEAD_ONLY,
    audited: true,
    source: "stated",
    why: "§07 staff table, \"Suspend an account\": ops lead only. Board 7a B7 is the other half — a suspended sign-in says the reason is in the account holder's email, so the one writer (`lib/account/suspension.ts`) ends every session and emails the reason staff wrote. Distinct from business.suspend, which takes a listing out of the directory and leaves its team signed in; this stops a person signing in on every role they hold.",
  },
  "business.close": {
    roles: OPS_LEAD_ONLY,
    audited: true,
    source: "inferred",
    why: "Board 11i build note B8 — the platform-initiated closure of a listing whose trade licence lapsed and was not renewed, and the two acts that undo one: withdrawing a notice or a closure inside its window, and reopening a closed business for the same licence holder (Q2). Held at ops lead with suspension, which it outranks: suspension is a pause with a reason, closure removes the business and revokes its team. Not a row in §07 — flag it if §07 gains one.",
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
  "queue.rules": {
    roles: OPS_LEAD_ONLY,
    audited: true,
    source: "inferred",
    why: "Board 4b's Tune auto-check rules. Switching a check off or moving a threshold changes which submissions bulk approve may act on across the whole queue, so it is held a rung above deciding one submission: a moderator works the queue, an ops lead sets what the machine is trusted with. Not a row in \u00a707 — flag it if \u00a707 gains one.",
  },
  "support.view_as": {
    roles: ["staff_moderator", "staff_ops_lead"],
    audited: true,
    source: "stated",
    why: "§07 staff table, \"View-as a business\". Looking through a seller's eyes is a privacy event and is audited even though it changes nothing.",
  },
  "contact_lead.platform.read": {
    roles: OPS_LEAD_ONLY,
    audited: false,
    source: "inferred",
    why: "Board `1d` amendment, `/admin/leads`: every phone lead on the platform, each a buyer's name, work email and mobile. The owner asked that a reveal be recorded in the superadmin's console, and superadmin in this matrix is the ops lead. Not a moderator: moderation acts on what was published, and a lead list is the asset most likely to walk out, which is 12d's reason for keeping finance off the call list. Not audited, because reading changes nothing — the same call `crm.work` makes about a lead's number. Not a row in \u00a707; flag it if \u00a707 gains one.",
  },
  "crm.work": {
    roles: ["staff_ops_lead", "staff_moderator"],
    audited: false,
    source: "stated",
    why: "Board 12d B11: ops lead and moderator only, and the retired field verifier does not come back for call work. Not audited: claiming a call, logging what a seller said and revealing a lead's number change nothing about the directory, and each is its own record — the task's lock, `call_outcome` and `crm_contact_reveal` — rather than a decision the audit log exists to hold. Finance has no row: the call list is a lead list, and the asset most likely to walk out is one more seat can read.",
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
    why: "§07 staff table, \"Edit plans & entitlements\". The only commercial row ops lead and finance share, and board 12e Q2's answer — \"who may edit plan config?\" — which is this row rather than an open question. Adding a plan is the same grant: a new tier is born withdrawn from sale and nobody can be moved onto one by creating it.",
  },
  "revenue.read": {
    roles: ["staff_finance"],
    audited: false,
    source: "stated",
    why: "§07 staff table, \"Export finance data\": finance only. Was inferred as finance + ops lead. Reading does not change state, so it is not audited — but it is not everybody's to read either. The row read \"Export VAT / finance data\" until board 12e cut the VAT return; what it still covers is the revenue export and every commercial screen.",
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
  /*
     Board 4d. Reading the tree is not editing it, and `/admin/categories` was
     gated on the write — so the one person who most often needs to answer "why
     is this seller filed there, and what does that category ask of them", the
     moderator deciding a category change in the queue, got a 404.
  */
  "taxonomy.read": {
    roles: ["staff_ops_lead", "staff_moderator"],
    audited: false,
    source: "inferred",
    why: "Not a row in §07. Board 4d-s's states table: a non-ops-lead admin sees the taxonomy read-only, because it is how other staff answer \"why does this seller see that screen\". The moderator decides category changes in the approval queue against this tree. Finance has no row: nothing on it is about money. Reading changes nothing, so it is not audited.",
  },
  /*
     Board 4d Q4, "who may merge", which permissions.md is silent on. Split from
     `taxonomy.write` so the answer is one line to change rather than a search
     through every caller of the editor's capability.
  */
  "taxonomy.merge": {
    roles: OPS_LEAD_ONLY,
    audited: true,
    source: "inferred",
    why: "Not a row in §07. Board 4d Q4: a merge moves every listing, product and service filed under one category into another, writes a redirect for every address the absorbed one owned, and changes what ranks — it cannot be undone by editing a field. Held at the rung that holds \"Edit taxonomy & spec templates\" and no lower, as its own capability so a decision to narrow or widen it touches one row.",
  },
  /*
     Board 12g. Split out of `taxonomy.write`, which gated this screen because it
     was the nearest ops-lead row — and whose reason, a renamed category breaking
     a 301, says nothing about what this does. A template is the words every
     seller or buyer receives on their phone, and a WhatsApp version is a
     submission to Meta in the platform's name.
  */
  "notification.template.write": {
    roles: OPS_LEAD_ONLY,
    audited: true,
    source: "inferred",
    why: "Not a row in §07. Board 12g: saving a template changes what every recipient of that event is sent, on email, SMS and in-app the moment it is saved, and on WhatsApp it submits wording to Meta in the platform's name. The nearest §07 row is \"Edit taxonomy & spec templates\" — ops lead only — and the grant follows it. Recording Meta's approval or rejection sits here too: approving puts a version live. `Send test to me` is held at the same rung because on WhatsApp it is a real, billed template send.",
  },
  /*
     Board 6h, and its Q5: permissions.md had no row for homepage curation, and
     the screen borrowed `taxonomy.write` — whose reason, a renamed category
     breaking a 301, has nothing to do with it.
  */
  "homepage.curate": {
    roles: OPS_LEAD_ONLY,
    audited: true,
    source: "inferred",
    why: "Not a row in §07. Board 6h Q5: four \"Verified this week\" cards against every business in the directory, and six search chips under the hero, are the highest-leverage placement on the platform and the most-cached surface on the site. Held at ops lead — the rung that owns the tier those cards assert — rather than at every content role. Every feature, removal, reorder and chip change writes an audit row with a reason (B3).",
  },
  /*
     Board 12g-s. `/admin/strings` borrowed `taxonomy.write` as the nearest
     ops-lead row, which was harmless while the screen was a report. The paired
     view writes the words a whole kind of business reads, so it has its own.
  */
  "strings.write": {
    roles: OPS_LEAD_ONLY,
    audited: true,
    source: "inferred",
    why: "Not a row in §07. Board 12g-s: writing a half of a paired string changes what every business of that kind reads on every screen that carries the key, the moment it is saved and without a deploy; suppressing one removes a control from all of them. The nearest §07 row is \"Edit taxonomy & spec templates\" — ops lead only — and the grant follows it. Reading the store sits here too, because the screen is where the writes are.",
  },
  "notification.read": {
    roles: ["staff_ops_lead", "staff_moderator"],
    audited: false,
    source: "inferred",
    why: "Not a row in §07. Board 12g's delivery log is how anybody answers a seller asking why they were not told about an enquiry, which is a moderator's support conversation as often as an ops lead's; it shows the event, channel, status and reason and never an address. Finance has no row: nothing on it is about money. Reading changes nothing, so it is not audited.",
  },
  "staff.manage": {
    roles: OPS_LEAD_ONLY,
    audited: true,
    source: "inferred",
    why: "Not a row in §07. /admin/staff — inviting, changing a role, revoking an invitation and deactivating are how somebody else gets or loses every capability in this table, so they are held at the top. Board 4i's states table agrees in the negative: a non-ops viewer \"cannot invite or change roles\". Two rules ride along in lib/staff/service.ts rather than here, because a role check cannot express them: the last ops lead cannot be removed or demoted (criterion 7), and nobody changes their own staff role. Still inferred.",
  },
  "staff.read": {
    roles: ["staff_ops_lead", "staff_moderator", "staff_finance"],
    audited: false,
    source: "inferred",
    why: "Board 4i's states table: a non-ops viewer \"sees the matrix read-only\". Every staff seat may read who holds which role and what each role may do — a moderator told a control is not theirs should be able to see whose it is. Reading changes nothing, so it is not audited. Not a row in §07.",
  },
  "audit.read": {
    roles: ["staff_ops_lead", "staff_moderator", "staff_finance"],
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
    why: "Board 7d, \"Edit listing profile, locations, hours\" and \"Upload verification documents\" — owner and manager. Board 7d's \"Pick a theme preset\" row went with the presets (board 5b, cut 15 Sep 2026). Sales and finance do not shape the public profile.",
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
  "review.dispute": {
    roles: ["seller_owner"],
    audited: false,
    source: "inferred",
    why: "Board 11c Q4, and not a row in \u00a707 or in board 7d's table \u2014 the matrix has \"Reply to a review\" and stops there. Owner alone, one rung above `review.reply`: a reply is the business answering in public and a dispute is a formal claim it makes about a named customer, sent to our moderators with a two-working-day decision attached. A manager who may answer a review may not accuse the person who wrote it. Flag it if \u00a707 gains a row.",
  },
  "contact_lead.read": {
    roles: ["seller_owner", "seller_manager"],
    audited: false,
    source: "inferred",
    why: "Board `1d` amendment, `/dashboard/leads/phone`: the buyers who gave a name, work email and mobile to see this seller's landline. Owner and manager — the two seats that see the whole enquiry queue, unassigned rows included (`routing.manage`). A phone lead is assigned to nobody, and a sales seat reads the leads assigned to them (board 3j §1), so the whole list is held at the rung that reads the whole queue. Finance has no row. Not a row in board 7d's table; flag it if 7d gains one.",
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
  "account.close": {
    roles: ["seller_owner"],
    audited: false,
    source: "stated",
    why: "Board 11i Q4, answered by the owner on 14 Sep 2026: owner only. Consistent with board 7d, where cancelling a plan is already owner-only, and closure is strictly more consequential — it takes the business out of the directory, revokes every seat and ends every session. Not an AuditEvent: a seller closing their own account is not a staff state change, so the record is the `business_closure` row, which names who asked and who reversed, the same call board 11h made for a cancellation.",
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
