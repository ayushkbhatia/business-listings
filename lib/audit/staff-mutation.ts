import { assertCan } from "@/lib/auth/can";
import type { Actor } from "@/lib/auth/roles";
import { ACTION_FOR_CAPABILITY, type AuditedCapability, type SubjectRef } from "./types";
import { assertReason, writeAudit } from "./write-audit";

export interface StaffMutationInput {
  actor: Actor;
  capability: AuditedCapability;
  subject: SubjectRef;
  reason: string;
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
 * fails. Closing it needs both inside one transaction, which arrives with the
 * Prisma writer at checkpoint 3 — the AuditWriter port takes the transaction
 * handle then, and this function does not change.
 */
export async function staffMutation<T>(
  input: StaffMutationInput,
  run: () => Promise<StaffMutationResult<T>>,
): Promise<T> {
  const action = ACTION_FOR_CAPABILITY[input.capability];

  assertReason(action, input.reason);
  assertCan(input.actor, input.capability);

  const { result, before, after } = await run();

  await writeAudit({
    actor: input.actor,
    action,
    subject: input.subject,
    reason: input.reason,
    before,
    after,
  });

  return result;
}
