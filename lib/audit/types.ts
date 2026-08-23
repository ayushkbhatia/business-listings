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
  | "staff_changed";

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
 * Persistence port.
 *
 * The AuditEvent table arrives with the schema at checkpoint 3. Until then the
 * service layer is complete and tested against a fake, and the Prisma writer
 * plugs in behind this interface without touching a call site.
 *
 * When it is wired, the write must share a transaction with the mutation it
 * records. A mutation that can reach the database without its audit row is a
 * bug, and the suite should prove it cannot.
 */
export interface AuditWriter {
  write(row: AuditRow): Promise<void>;
}
