import type { Capability } from "@/lib/auth/capabilities";
import type { Actor } from "@/lib/auth/roles";

/**
 * Audit actions. The first seven are named in docs/data-model.md; the rest cover
 * the remaining audited capabilities. The column is a string in the schema so
 * this list can grow without a migration.
 *
 * A runtime list rather than a bare union since board 4i, so the log can prove
 * every action it may meet has a sentence to be read back in — see
 * `tests/unit/audit-describe.test.ts`.
 */
export const AUDIT_ACTIONS = [
  "tier_change",
  "review_removed",
  "review_held",
  "review_released",
  /*
     Board 11c `B4` and `B5`.

     `review_reply_removed` is not `review_removed`: the review stands and the
     supplier's answer to it came down, which is the opposite fact about the
     same row. Filing both under one name would make the log unable to answer
     the only question anybody asks it — what happened to that review.

     `review_dispute_resolved` sits under `report.resolve` because deciding a
     dispute is deciding a queue item. An upheld one also writes
     `review_removed` under `Review:…`, so the log answers "how do we decide
     abuse disputes" and "what happened to that review" separately.
  */
  "review_reply_removed",
  "review_dispute_resolved",
  "incentive_logged",
  "question_removed",
  "credit_issued",
  "suspend",
  /*
     Board 7a `B7`. A person's account, not a business — the subject is
     `User:…`, and the log has to say which way it went, so two names under one
     capability rather than `suspend` twice.
  */
  "account_suspended",
  "account_reinstated",
  "merge",
  "boost",
  "view_as",
  "report_resolved",
  "queue_decided",
  /*
     Board 4b. Asking a seller for a document and handing a submission to a
     colleague are queue decisions too, and the log has to say which happened —
     neither approves or rejects anything, so filing them under `queue_decided`
     would read as a decision nobody made.
  */
  "queue_docs_requested",
  "queue_reassigned",
  "queue_rules_tuned",
  "taxonomy_changed",
  "staff_changed",
  "claim_resolved",
  "entitlements_changed",
  "ranking_changed",
  "storefront_template_changed",
  "cross_business_read",
  /*
     Board 6f's dual control over the publish rules. Four names rather than one
     "rule_changed", because the log has to say which of the four happened: a
     proposal nobody approved and an approval are different rows, and the whole
     point of the table is that they were made by different people.
  */
  "rule_proposed",
  "rule_approved",
  "rule_rejected",
  "rule_withdrawn",
  /*
     Board 11i build note B8 and Q2. Three rows under one capability, because
     the log has to say which happened: a notice given is a business told it
     will close, a withdrawal undoes a notice or a closure inside its window,
     and a reopening restores a business whose closure was already final.
  */
  "closure_noticed",
  "closure_withdrawn",
  "closure_reopened",
  /*
     Board 12b. The pair screen's three outcomes, a bulk merge, the reversals
     and a re-tune — each its own name, because the screen's "today" rail reads
     them back (B6) and "merged 64, kept separate 41, discarded 13" is three
     questions a single `merge` label cannot answer.
  */
  "pair_merged",
  "pair_separated",
  "pair_discarded",
  "pairs_bulk_merged",
  "pair_reversed",
  "batch_reversed",
  "matching_tuned",
  /*
     Board 4i. Five outcomes under `staff.manage`, each its own name, because the
     question the log exists to answer about a person is "when did they get this,
     and who decided" — and `staff_changed`, which nothing ever wrote, answers
     neither. It stays the capability's default so an unnamed call still logs.
     A resend is its own row because it reopens an offer of a role with a new
     link and a new window: a state change, so it carries a reason.
  */
  "staff_invited",
  "staff_invite_resent",
  "staff_invite_revoked",
  "staff_role_changed",
  "staff_deactivated",
  /*
     Board 12g. Five outcomes of one capability, because the log is asked "what
     happened to that template" and the answers are different acts: a save that
     went live, a save that went to Meta, Meta's approval and its refusal
     recorded by a person, and a draft put live.
  */
  "notification_template_saved",
  "notification_template_submitted",
  "notification_meta_approved",
  "notification_meta_rejected",
  "notification_template_published",
  /*
     Board 6h. Five acts under `homepage.curate`: a business into a slot, out of
     one, the four reordered, and a chip added or taken off. Separate names,
     because "who took Dana off the home page, and why" is the question the log
     is asked, and a reorder that looked like a removal would answer it wrongly.
  */
  "homepage_slot_featured",
  "homepage_slot_removed",
  "homepage_slots_reordered",
  "homepage_query_added",
  "homepage_query_removed",
  /*
     Board 4d. A category brought into the tree and two folded into one. Their
     own names rather than `taxonomy_changed`, because the log is asked "where
     did this category come from" and "where did that one go", and an edit to a
     display name answers neither.
  */
  "category_created",
  "category_merged",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * Actions production rows carry that no code writes any more.
 *
 * The log is append-only, so a retired action is not a mistake to clean up — it
 * is history, and it still has to read as a sentence. `visit_recorded` is the
 * site-visit feature the 5 Sep 2026 cut withdrew.
 */
export const RETIRED_AUDIT_ACTIONS = ["visit_recorded"] as const;

export function isAuditAction(value: string): value is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(value);
}

/**
 * Every audited capability maps to exactly one action, so a staff mutation
 * cannot be logged under a label that hides what it was.
 */
export const ACTION_FOR_CAPABILITY = {
  "business.verification_tier.write": "tier_change",
  "business.suspend": "suspend",
  "account.suspend": "account_suspended",
  "business.merge": "merge",
  "review.remove": "review_removed",
  "review.hold": "review_held",
  "question.remove": "question_removed",
  "report.resolve": "report_resolved",
  "queue.decide": "queue_decided",
  "queue.rules": "queue_rules_tuned",
  "subscription.credit": "credit_issued",
  "placement.boost": "boost",
  "taxonomy.write": "taxonomy_changed",
  "staff.manage": "staff_changed",
  "support.view_as": "view_as",

  /*
   * Arrived with docs/permissions.md. §07 is explicit that **every ✓ in the
   * staff table that changes state writes an AuditEvent with a reason, and ops
   * lead has no exemption** — so each of these needs a name of its own rather
   * than being folded into a neighbour.
   *
   * `cross_business_read` is the odd one: it does not change state. It is
   * audited because §07 calls it "the one row that matters most: support needs
   * it, and it must be impossible to do silently", and an action name is how
   * it becomes greppable in /admin/audit.
   */
  "claim.resolve": "claim_resolved",
  "plan.entitlements.write": "entitlements_changed",
  "search.ranking.write": "ranking_changed",
  "storefront.template.write": "storefront_template_changed",
  "enquiry.read_other_business": "cross_business_read",
  "business.close": "closure_noticed",
  "notification.template.write": "notification_template_saved",
  "homepage.curate": "homepage_slot_featured",
  "taxonomy.merge": "category_merged",
} as const satisfies Partial<Record<Capability, AuditAction>>;

export type AuditedCapability = keyof typeof ACTION_FOR_CAPABILITY;

/**
 * The capabilities whose control has more than one outcome, and the actions
 * each may log. Everything absent from here logs exactly the action
 * `ACTION_FOR_CAPABILITY` names for it and nothing else.
 *
 * Two entries. Board 1m's held state is a pause a moderator can undo, and the
 * log has to distinguish the pause from the release. Board 6f's publish rules
 * are the second: a change is proposed by one ops lead and approved, rejected
 * or withdrawn by another, and four rows under one `taxonomy_changed` label
 * would hide the one fact the table exists to record — that two different
 * people were involved.
 *
 * The default is unchanged in both cases. A caller that names no action still
 * logs `ACTION_FOR_CAPABILITY`'s, so every existing `taxonomy.write` mutation
 * files under `taxonomy_changed` exactly as before.
 */
export const PAIRED_ACTIONS = {
  "review.hold": ["review_held", "review_released"],
  /*
     Board 11c `B4`. Taking down a seller's reply is held at the same rung as
     removing the review — erring higher is the safe direction for removing
     something a person wrote in public, which is the call `question.remove`
     already makes for the same reason — and the two are told apart by the
     action rather than by a second capability nobody would be able to describe
     the difference between.
  */
  "review.remove": ["review_removed", "review_reply_removed"],
  /*
     Board 11c `B5` and `B6`. A supplier report, a review dispute and an
     incentive finding are three row shapes on one screen and one rung, and the
     log has to say which happened: `SupplierReport:…` and `ReviewDispute:…` are
     different subjects, and `incentive_logged` *creates* a queue item where the
     other two close one. Filing a finding under `report_resolved` would say the
     opposite of what occurred.
  */
  "report.resolve": ["report_resolved", "review_dispute_resolved", "incentive_logged"],
  "business.close": ["closure_noticed", "closure_withdrawn", "closure_reopened"],
  "account.suspend": ["account_suspended", "account_reinstated"],
  "queue.decide": ["queue_decided", "queue_docs_requested", "queue_reassigned"],
  "business.merge": [
    "merge",
    "pair_merged",
    "pair_separated",
    "pair_discarded",
    "pairs_bulk_merged",
    "pair_reversed",
    "batch_reversed",
    "matching_tuned",
  ],
  "staff.manage": [
    "staff_changed",
    "staff_invited",
    "staff_invite_resent",
    "staff_invite_revoked",
    "staff_role_changed",
    "staff_deactivated",
  ],
  "notification.template.write": [
    "notification_template_saved",
    "notification_template_submitted",
    "notification_meta_approved",
    "notification_meta_rejected",
    "notification_template_published",
  ],
  "homepage.curate": [
    "homepage_slot_featured",
    "homepage_slot_removed",
    "homepage_slots_reordered",
    "homepage_query_added",
    "homepage_query_removed",
  ],
  "taxonomy.write": [
    "taxonomy_changed",
    "category_created",
    "rule_proposed",
    "rule_approved",
    "rule_rejected",
    "rule_withdrawn",
  ],
} as const satisfies Partial<Record<AuditedCapability, readonly AuditAction[]>>;

export type PairedAction<C extends AuditedCapability> = C extends keyof typeof PAIRED_ACTIONS
  ? (typeof PAIRED_ACTIONS)[C][number]
  : never;

/** `Business:clx123`. Entity type and id, so the log is greppable. */
export type SubjectRef = `${string}:${string}`;

/**
 * What a bulk decision touched, beyond its subject. Board 4i `B4`.
 *
 * The unit is a closed list so the log can put a noun on the number in every
 * locale — "affected 8,412 products" — rather than printing whatever string a
 * service happened to choose.
 */
export const BLAST_UNITS = [
  "products",
  "listings",
  "businesses",
  "pairs",
  "records",
  "pages",
  "subscriptions",
  "redirects",
] as const;

export type BlastUnit = (typeof BLAST_UNITS)[number];

export interface BlastRadius {
  count: number;
  unit: BlastUnit;
}

export interface WriteAuditInput {
  actor: Actor;
  action: AuditAction;
  subject: SubjectRef;
  /** REQUIRED. Not nullable in the schema, and not nullable here. */
  reason: string;
  before?: unknown;
  after?: unknown;
  /** Set where one decision touched many things. Omit for a decision about one. */
  blastRadius?: BlastRadius | null;
}

/** The row as it reaches persistence. */
export interface AuditRow {
  actorId: string;
  action: AuditAction;
  subject: SubjectRef;
  reason: string;
  before: unknown;
  after: unknown;
  blastRadius: number | null;
  blastUnit: BlastUnit | null;
}

/**
 * The transaction an audit row joins.
 *
 * Structural rather than Prisma's own type, so lib/audit stays free of a
 * Prisma import and keeps being testable against a fake. Any client with an
 * `auditEvent.create` satisfies it, which both `prisma` and a `$transaction`
 * handle do.
 */
export interface AuditTransaction {
  auditEvent: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
}

/**
 * Persistence port.
 *
 * The write shares a transaction with the mutation it records. A mutation that
 * can reach the database without its audit row is a bug — so the caller opens
 * one transaction, does its work in it, and hands the same handle here.
 * Without a handle the write stands alone, which is right for the few audited
 * actions that are a single statement.
 */
export interface AuditWriter {
  write(row: AuditRow, tx?: AuditTransaction): Promise<void>;
}
