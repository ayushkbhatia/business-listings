import { AuditReasonError } from "@/lib/auth/errors";
import {
  BLAST_UNITS,
  type AuditRow,
  type AuditTransaction,
  type AuditWriter,
  type BlastRadius,
  type WriteAuditInput,
} from "./types";

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
 * A blast radius is a whole, non-negative count with a known noun, or it is
 * absent. Board 4i `B4`.
 *
 * Refused rather than coerced. A count of `NaN` or `12.5` is a service that
 * counted the wrong thing, and writing it would put a number in an append-only
 * log that nobody can correct afterwards. The CHECK constraint in the 4i
 * migration refuses the same shapes; this says so before the transaction does.
 */
export function assertBlastRadius(action: string, radius: BlastRadius | null | undefined): BlastRadius | null {
  if (radius === null || radius === undefined) return null;
  if (!Number.isSafeInteger(radius.count) || radius.count < 0) {
    throw new Error(`${action}: a blast radius must be a whole, non-negative count; got ${radius.count}`);
  }
  if (!(BLAST_UNITS as readonly string[]).includes(radius.unit)) {
    throw new Error(`${action}: "${radius.unit}" is not a blast-radius unit`);
  }
  return radius;
}

/**
 * `writeAudit({ actor, action, subject, reason, before, after, blastRadius })`.
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
  const radius = assertBlastRadius(input.action, input.blastRadius);

  const row: AuditRow = {
    actorId: input.actor.id,
    action: input.action,
    subject: input.subject,
    reason,
    before: input.before ?? null,
    after: input.after ?? null,
    blastRadius: radius?.count ?? null,
    blastUnit: radius?.unit ?? null,
  };

  if (!writer) throw new AuditNotConfiguredError();
  await writer.write(row, tx);
  return row;
}
