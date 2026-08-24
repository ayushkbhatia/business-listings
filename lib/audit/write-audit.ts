import { AuditReasonError } from "@/lib/auth/errors";
import type { AuditRow, AuditTransaction, AuditWriter, WriteAuditInput } from "./types";

/**
 * A reason has to be a sentence somebody wrote, not a keystroke to get past a
 * required field. Four characters is the floor; the queue screens should ask for
 * more, but the service layer will not accept less.
 */
const MIN_REASON_LENGTH = 4;

let writer: AuditWriter | null = null;

export function setAuditWriter(next: AuditWriter | null): void {
  writer = next;
}

export class AuditNotConfiguredError extends Error {
  constructor() {
    super("No AuditWriter is configured. Staff mutations cannot run without an audit trail.");
    this.name = "AuditNotConfiguredError";
  }
}

export function assertReason(action: string, reason: unknown): string {
  if (typeof reason !== "string") {
    throw new AuditReasonError(action, "a reason is required");
  }
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    throw new AuditReasonError(action, "a reason is required");
  }
  if (trimmed.length < MIN_REASON_LENGTH) {
    throw new AuditReasonError(action, `a reason must be at least ${MIN_REASON_LENGTH} characters`);
  }
  // A row of punctuation passes a length check and tells a future reader nothing.
  if (!/[\p{Letter}\p{Number}]/u.test(trimmed)) {
    throw new AuditReasonError(action, "a reason must contain words");
  }
  return trimmed;
}

/**
 * `writeAudit({ actor, action, subject, reason, before, after })`.
 *
 * Every staff state change goes through here. Build it into the service layer,
 * never into a screen — a second screen doing the same mutation would otherwise
 * be one forgotten call away from an unlogged change.
 */
export async function writeAudit(
  input: WriteAuditInput,
  tx?: AuditTransaction,
): Promise<AuditRow> {
  const reason = assertReason(input.action, input.reason);

  const row: AuditRow = {
    actorId: input.actor.id,
    action: input.action,
    subject: input.subject,
    reason,
    before: input.before ?? null,
    after: input.after ?? null,
  };

  if (!writer) throw new AuditNotConfiguredError();
  await writer.write(row, tx);
  return row;
}
