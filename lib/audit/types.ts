import type { Capability } from "@/lib/auth/capabilities";
import type { Actor } from "@/lib/auth/roles";

/**
 * Audit actions. The first seven are named in docs/data-model.md; the rest cover
 * the remaining audited capabilities. The column is a string in the schema so
 * this union can grow without a migration.
 */
export type AuditAction =
  | "tier_change"
  | "review_removed"
  | "review_held"
  | "review_released"
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
  | "review_reply_removed"
  | "review_dispute_resolved"
  | "incentive_logged"
  | "question_removed"
  | "credit_issued"
  | "suspend"
  | "merge"
  | "boost"
  | "view_as"
  | "report_resolved"
  | "queue_decided"
  | "taxonomy_changed"
  | "staff_changed"
  | "claim_resolved"
  | "entitlements_changed"
  | "ranking_changed"
  | "storefront_template_changed"
  | "cross_business_read"
  /*
     Board 6f's dual control over the publish rules. Four names rather than one
     "rule_changed", because the log has to say which of the four happened: a
     proposal nobody approved and an approval are different rows, and the whole
     point of the table is that they were made by different people.
  */
  | "rule_proposed"
  | "rule_approved"
  | "rule_rejected"
  | "rule_withdrawn";

/**
 * Every audited capability maps to exactly one action, so a staff mutation
 * cannot be logged under a label that hides what it was.
 */
export const ACTION_FOR_CAPABILITY = {
  "business.verification_tier.write": "tier_change",
  "business.suspend": "suspend",
  "business.merge": "merge",
  "review.remove": "review_removed",
  "review.hold": "review_held",
  "question.remove": "question_removed",
  "report.resolve": "report_resolved",
  "queue.decide": "queue_decided",
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
  "taxonomy.write": [
    "taxonomy_changed",
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

export interface WriteAuditInput {
  actor: Actor;
  action: AuditAction;
  subject: SubjectRef;
  /** REQUIRED. Not nullable in the schema, and not nullable here. */
  reason: string;
  before?: unknown;
  after?: unknown;
}

/** The row as it reaches persistence. */
export interface AuditRow {
  actorId: string;
  action: AuditAction;
  subject: SubjectRef;
  reason: string;
  before: unknown;
  after: unknown;
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
