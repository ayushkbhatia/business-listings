import { assertCan } from "@/lib/auth/can";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import type { Actor } from "@/lib/auth/roles";
import {
  ACTION_FOR_CAPABILITY,
  type AuditTransaction,
  type AuditedCapability,
  type SubjectRef,
} from "./types";
import { assertReason, writeAudit } from "./write-audit";

/**
 * Raised when a subject-dependent capability is routed through here without the
 * caller saying it ran the narrower check.
 *
 * This exists because the failure it prevents is silent. `assertCan` is a role
 * membership test, and for `business.verification_tier.write` a role test
 * passes for every field verifier — including one setting a tier on a business
 * they have never visited, which is the single thing CLAUDE.md's second
 * non-negotiable exists to stop. The old contract let that call compile, run,
 * and write a tidy audit row saying it was fine.
 */
export class SubjectCheckRequiredError extends Error {
  constructor(capability: string) {
    super(
      `${capability} is subject-dependent: a role check alone grants more than the matrix does. ` +
        "Call the matching assert in lib/auth/subject.ts first, then pass subjectChecked: true.",
    );
    this.name = "SubjectCheckRequiredError";
  }
}

export interface StaffMutationInput {
  actor: Actor;
  capability: AuditedCapability;
  subject: SubjectRef;
  reason: string;
  /**
   * The transaction the mutation runs in. The audit row joins it, so the change
   * and its record commit together or not at all.
   */
  tx?: AuditTransaction;
  /**
   * Required for the capabilities `docs/permissions.md` marks subject-dependent,
   * and refused for the ones it does not.
   *
   * Set it only after calling the matching assert in `lib/auth/subject.ts`.
   * Passing it where it is not needed is also an error: a flag that can be set
   * anywhere is a flag that means nothing, and the point is that a reader of
   * one call site can tell which kind of capability it is.
   */
  subjectChecked?: true;
}

export interface StaffMutationResult<T> {
  result: T;
  before?: unknown;
  after?: unknown;
}

/**
 * The only sanctioned way to perform an audited staff mutation.
 *
 * Order matters. The reason is validated and the permission is checked *before*
 * anything is written, so a denied actor and a blank reason both fail without
 * touching a row. The audit write follows the mutation because before/after are
 * not known until it has run.
 *
 * That leaves one window: a mutation that succeeds and an audit write that
 * fails. Closed by passing `tx`: the caller opens one transaction, runs the
 * mutation in it, and the audit row joins the same handle. Without `tx` the two
 * writes are separate, which is right only where the mutation is a single
 * statement that cannot half-succeed.
 */
export async function staffMutation<T>(
  input: StaffMutationInput,
  run: () => Promise<StaffMutationResult<T>>,
): Promise<T> {
  const action = ACTION_FOR_CAPABILITY[input.capability];
  const isSubjectDependent = "subject" in CAPABILITIES[input.capability];

  if (isSubjectDependent && !input.subjectChecked) {
    throw new SubjectCheckRequiredError(input.capability);
  }
  if (!isSubjectDependent && input.subjectChecked) {
    throw new Error(
      `${input.capability} is not subject-dependent; do not pass subjectChecked. ` +
        "See docs/permissions.md §3.",
    );
  }

  assertReason(action, input.reason);
  assertCan(input.actor, input.capability);

  const { result, before, after } = await run();

  await writeAudit(
    {
      actor: input.actor,
      action,
      subject: input.subject,
      reason: input.reason,
      before,
      after,
    },
    input.tx,
  );

  return result;
}
