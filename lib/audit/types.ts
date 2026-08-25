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
  | "credit_issued"
  | "suspend"
  | "merge"
  | "boost"
  | "view_as"
  | "report_resolved"
  | "queue_decided"
  | "visit_recorded"
  | "taxonomy_changed"
  | "staff_changed"
  | "claim_resolved"
  | "entitlements_changed"
  | "ranking_changed"
  | "storefront_template_changed"
  | "cross_business_read";

/**
 * Every audited capability maps to exactly one action, so a staff mutation
 * cannot be logged under a label that hides what it was.
 */
export const ACTION_FOR_CAPABILITY = {
  "business.verification_tier.write": "tier_change",
  "business.suspend": "suspend",
  "business.merge": "merge",
  "review.remove": "review_removed",
  "report.resolve": "report_resolved",
  "queue.decide": "queue_decided",
  "visit.record": "visit_recorded",
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
