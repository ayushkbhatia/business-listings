import { can } from "./can";
import { CAPABILITIES, type Capability } from "./capabilities";
import { PermissionError } from "./errors";
import type { Actor } from "./roles";

/**
 * The three rows a role cannot answer on its own.
 *
 * `docs/permissions.md`, implementation notes: *"Role is an input, never the
 * check itself — three of the rows above are subject-dependent and a role-only
 * check gets them wrong."*
 *
 * Getting them wrong is not symmetrical. Each fails open:
 *
 *   - A field verifier who may set a tier **for a visit they recorded** becomes,
 *     under a role-only check, a field verifier who may set any tier on any
 *     business. That is the one row CLAUDE.md calls a non-negotiable.
 *   - A sales seat scoped to Al Quoz becomes a sales seat reading every
 *     enquiry the business has, which is the scoping doing nothing at all.
 *   - "See another business's enquiries" is granted to two staff roles **as an
 *     audit-only action**. Under a role-only check the grant survives and the
 *     audit row does not, which is precisely the silent version §07 says must
 *     be impossible.
 *
 * So each function here takes the subject, and each is written so that missing
 * information denies rather than allows.
 */

export class SubjectRequiredError extends Error {
  constructor(capability: Capability) {
    super(
      `${capability} is subject-dependent. Call the matching check in lib/auth/subject.ts, ` +
        "not can() alone.",
    );
    this.name = "SubjectRequiredError";
  }
}

/** Guards a call site that reached for `can()` on a row that needs more. */
export function assertNotSubjectDependent(capability: Capability): void {
  if ("subject" in CAPABILITIES[capability]) throw new SubjectRequiredError(capability);
}

/* ── 2. A branch-scoped sales seat ───────────────────────────────────────── */

export interface BranchScoped {
  /** The business the enquiry, quote or figure belongs to. */
  businessId: string;
  /**
   * The branch it belongs to, where it has one. An enquiry with no branch is
   * visible to every seat — it was not routed anywhere in particular.
   */
  branchId?: string | null;
}

/**
 * May this actor act on this enquiry, quote or analytics row?
 *
 * Scoping narrows what a seat already holds; it never widens it. An unscoped
 * actor — an owner, a manager, most sales seats — is limited only by the
 * business check, which is the same check every seller query already applies.
 */
export function withinScope(actor: Actor, subject: BranchScoped): boolean {
  if (actor.businessId !== subject.businessId) return false;
  if (!actor.branchId) return true;

  // Scoped. An item belonging to no branch stays visible: it was not routed
  // away from them, and hiding it would lose the enquiry rather than scope it.
  if (subject.branchId == null) return true;
  return subject.branchId === actor.branchId;
}

export function canRespondToEnquiry(actor: Actor, subject: BranchScoped): boolean {
  return can(actor, "enquiry.respond") && withinScope(actor, subject);
}

export function assertCanRespondToEnquiry(actor: Actor, subject: BranchScoped): void {
  if (!canRespondToEnquiry(actor, subject)) {
    throw new PermissionError("enquiry.respond", actor.id);
  }
}

export function canSendQuote(actor: Actor, subject: BranchScoped): boolean {
  return can(actor, "quote.send") && withinScope(actor, subject);
}

export function assertCanSendQuote(actor: Actor, subject: BranchScoped): void {
  if (!canSendQuote(actor, subject)) throw new PermissionError("quote.send", actor.id);
}

/**
 * What a seat may see on the analytics screen.
 *
 * Board 7d gives a sales seat "own leads only" rather than the full picture,
 * so this returns a filter rather than a boolean — a caller that got a yes/no
 * would have to invent the narrowing itself, and would eventually invent it
 * differently on the second screen.
 */
export type AnalyticsScope =
  | { kind: "all"; businessId: string }
  | { kind: "own_leads"; businessId: string; actorId: string; branchId?: string };

export function analyticsScopeFor(actor: Actor): AnalyticsScope | null {
  if (!can(actor, "analytics.read") || !actor.businessId) return null;

  if (actor.roles.includes("seller_owner") || actor.roles.includes("seller_manager")) {
    return { kind: "all", businessId: actor.businessId };
  }
  return {
    kind: "own_leads",
    businessId: actor.businessId,
    actorId: actor.id,
    ...(actor.branchId ? { branchId: actor.branchId } : {}),
  };
}

/* ── 3. Another business's enquiries, audit-only ─────────────────────────── */

export interface CrossBusinessRead {
  /** The business whose enquiries are being read. */
  businessId: string;
  /** Why. Non-empty, because the audit row's reason column is NOT NULL. */
  reason: string;
}

/**
 * May this actor read a business's enquiries that is not their own?
 *
 * The grant is not the permission here. §07 calls this "the one row that
 * matters most: support needs it, and it must be impossible to do silently" —
 * so a reason is required by the *signature*, not checked inside. A caller
 * with nothing to write cannot form the argument.
 *
 * Returning a boolean and leaving the audit row to the caller would be the
 * failure mode: the check would pass, somebody would forget the write, and the
 * read would be exactly as silent as if there were no check at all.
 */
export function canReadOtherBusinessEnquiries(actor: Actor, read: CrossBusinessRead): boolean {
  if (!can(actor, "enquiry.read_other_business")) return false;
  // Their own business is not a cross-business read and needs no reason.
  if (actor.businessId === read.businessId) return true;
  return read.reason.trim().length > 0;
}

export function assertCanReadOtherBusinessEnquiries(
  actor: Actor,
  read: CrossBusinessRead,
): void {
  if (!canReadOtherBusinessEnquiries(actor, read)) {
    throw new PermissionError("enquiry.read_other_business", actor.id);
  }
}

/**
 * How much of the audit log this actor reads.
 *
 * §07: ops lead reads all of it, every other staff role reads their own
 * actions. Not a boolean for the same reason as the analytics scope — a caller
 * given a yes would show the whole log to a moderator.
 */
export type AuditScope = { kind: "all" } | { kind: "own"; actorId: string };

export function auditScopeFor(actor: Actor): AuditScope | null {
  if (!can(actor, "audit.read")) return null;
  if (actor.roles.includes("staff_ops_lead")) return { kind: "all" };
  return { kind: "own", actorId: actor.id };
}
