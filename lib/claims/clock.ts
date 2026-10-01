/**
 * Board 4c `B8` — one clock for a claim conflict, read by everything that
 * states it.
 *
 * `2a` and `2b` promise both claimants a decision within 48 hours, and the
 * queue's service level for a conflict is the same 48 hours: the copy and the
 * chip read this one constant, so the promise and the measure cannot drift.
 * Before board 4c the queue measured conflicts against the three days a plain
 * claim gets while the screens promised two.
 *
 * The clock starts when the conflict opens — the arrival of the claim that
 * made it one — because that is the moment both claimants were promised 48
 * hours. The chip's age and the log's overdue figure count from the same
 * event, so `overdue = age − SLA` always (criterion 10).
 *
 * Escalated pauses it (Q5): the item has a named holder and is not late on the
 * queue while it waits on them. Asking both sides for documents does **not**
 * (`4c-s` B6): a request is still our item, and the claimants were promised a
 * decision, not a correspondence.
 */

export const CONFLICT_SLA_HOURS = 48;

const HOUR_MS = 3_600_000;
export const CONFLICT_SLA_MS = CONFLICT_SLA_HOURS * HOUR_MS;

export interface ConflictClock {
  openedAt: Date;
  dueAt: Date;
  /** Open for this long, to now — or to the escalation, while it is paused. */
  ageMs: number;
  /** Past the service level by this long. Zero when not late. */
  overdueMs: number;
  /** Until the service level runs out. Zero once it has. */
  remainingMs: number;
  late: boolean;
  paused: boolean;
}

export function conflictClock(input: {
  openedAt: Date;
  now: Date;
  escalatedAt?: Date | null;
  slaMs?: number;
}): ConflictClock {
  const slaMs = input.slaMs ?? CONFLICT_SLA_MS;
  const paused = input.escalatedAt != null;
  const until = paused ? input.escalatedAt! : input.now;
  const ageMs = Math.max(0, until.getTime() - input.openedAt.getTime());
  const overdueMs = Math.max(0, ageMs - slaMs);
  return {
    openedAt: input.openedAt,
    dueAt: new Date(input.openedAt.getTime() + slaMs),
    ageMs,
    overdueMs,
    remainingMs: Math.max(0, slaMs - ageMs),
    // Escalated is "not overdue" on the queue (§States), whatever the figure.
    late: !paused && overdueMs > 0,
    paused,
  };
}

