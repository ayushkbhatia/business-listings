import "server-only";
import { prisma } from "@/lib/db/client";
import type { Prisma } from "@/lib/db/generated/client";
import { assertCan, can } from "@/lib/auth/can";
import type { Actor } from "@/lib/auth/roles";
import { formatPhone, toE164 } from "@/lib/format";
import { scriptIdFor } from "./scripts";
import { lastSyncRun, syncCrmTasks, type SyncResult } from "./sync";
import { CALL_OUTCOMES, transition, type CallOutcomeKey, type SignalFacts } from "./model";

/**
 * Board 12d — what a person does on the call list.
 *
 * Claim a task, reveal the number, log what happened, build a call list for a
 * held page, hand a task back, refresh the signals. Every entry point asserts
 * `crm.work`. None of them can put a business on the list: the list is
 * `./sync.ts`, and the only state these write is the work on a row that is
 * already there.
 *
 * ## The lock
 *
 * `assignedToId` on an open task (B10, States: *two ops leads, same business*).
 * Claiming is a conditional update — assigned to nobody, or to me — so two
 * people pressing Call at once cannot both get the row; the loser is told who
 * has it. Logging a call takes the row inside a transaction with `FOR UPDATE`,
 * so a call logged against a task another seat claimed a moment earlier is
 * refused rather than written over theirs.
 */

export type CrmError =
  | "not_found"
  | "closed"
  | "taken"
  | "no_phone"
  | "bad_outcome"
  | "call_back_needs_date"
  | "call_back_in_past"
  | "call_back_too_far"
  | "date_only_on_call_back"
  | "note_too_long"
  | "just_refreshed"
  | "not_yours";

export type CrmResult<T = object> = ({ ok: true } & T) | { ok: false; error: CrmError; holder?: string | null };

const NOTE_MAX = 2_000;
/** A manual refresh inside this window refuses; the daily run is the schedule. */
export const REFRESH_COOLDOWN_MS = 5 * 60_000;

async function holderName(taskId: string): Promise<string | null> {
  const task = await prisma.crmTask.findUnique({
    where: { id: taskId },
    select: { assignedTo: { select: { fullName: true, email: true } } },
  });
  return task?.assignedTo?.fullName ?? task?.assignedTo?.email ?? null;
}

/** Take the row. Idempotent for the holder. */
export async function claimTask(actor: Actor, taskId: string, now: Date = new Date()): Promise<CrmResult> {
  assertCan(actor, "crm.work");
  const claimed = await prisma.crmTask.updateMany({
    where: { id: taskId, closedAt: null, assignedToId: null },
    data: { assignedToId: actor.id, assignedAt: now },
  });
  if (claimed.count === 1) return { ok: true };

  const task = await prisma.crmTask.findUnique({ where: { id: taskId }, select: { closedAt: true, assignedToId: true } });
  if (!task) return { ok: false, error: "not_found" };
  if (task.closedAt) return { ok: false, error: "closed" };
  if (task.assignedToId === actor.id) return { ok: true };
  return { ok: false, error: "taken", holder: await holderName(taskId) };
}

/**
 * Give the row back. The holder may, and so may an ops lead, who is who
 * redistributes the work of somebody who is off.
 */
export async function releaseTask(actor: Actor, taskId: string): Promise<CrmResult> {
  assertCan(actor, "crm.work");
  const task = await prisma.crmTask.findUnique({ where: { id: taskId }, select: { closedAt: true, assignedToId: true } });
  if (!task) return { ok: false, error: "not_found" };
  if (task.closedAt) return { ok: false, error: "closed" };
  if (task.assignedToId === null) return { ok: true };
  if (task.assignedToId !== actor.id && !can(actor, "staff.manage")) return { ok: false, error: "not_yours" };
  await prisma.crmTask.updateMany({
    where: { id: taskId, closedAt: null, assignedToId: task.assignedToId },
    data: { assignedToId: null, assignedAt: null },
  });
  return { ok: true };
}

/**
 * The number, unmasked, for the person about to dial it (B9).
 *
 * Claims the row first — revealing a number you are not going to call is how a
 * lead list walks out — and writes a `crm_contact_reveal` row every time, so
 * "who has seen this number" is a query. The number is the first published
 * branch that has one.
 */
export async function revealContact(
  actor: Actor,
  taskId: string,
  now: Date = new Date(),
): Promise<CrmResult<{ display: string; tel: string }>> {
  const claim = await claimTask(actor, taskId, now);
  if (!claim.ok) return claim;

  const task = await prisma.crmTask.findUnique({
    where: { id: taskId },
    select: {
      businessId: true,
      business: {
        select: {
          locations: {
            where: { published: true, phone: { not: null } },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: 1,
            select: { id: true, phone: true },
          },
        },
      },
    },
  });
  const location = task?.business.locations[0];
  if (!task || !location?.phone) return { ok: false, error: "no_phone" };

  await prisma.crmContactReveal.create({
    data: { taskId, businessId: task.businessId, locationId: location.id, staffId: actor.id },
  });
  return { ok: true, display: formatPhone(location.phone), tel: toE164(location.phone) ?? location.phone };
}

export interface LogCallInput {
  taskId: string;
  outcome: string;
  note?: string | null;
  callBackAt?: Date | null;
}

/**
 * What happened on the call, and what it does to the row.
 *
 * One transaction: the task is locked, the outcome is written to `call_outcome`
 * with the signal and the script the caller had in front of them (Q3), and the
 * task moves as `transition` says. A closing outcome closes the task here — the
 * one closer besides the sync, because a seller saying no is not a signal the
 * platform could have derived.
 *
 * *Closed down* closes the task and does nothing to the listing. The CRM does
 * not delist anybody by itself; the outcome shows on board 4f's account page,
 * where closing a business is somebody's decision with a reason (States).
 */
export async function logCall(actor: Actor, input: LogCallInput, now: Date = new Date()): Promise<CrmResult<{ state: string }>> {
  assertCan(actor, "crm.work");
  if (!(CALL_OUTCOMES as readonly string[]).includes(input.outcome)) return { ok: false, error: "bad_outcome" };
  const outcome = input.outcome as CallOutcomeKey;
  const note = input.note?.trim() || null;
  if (note && note.length > NOTE_MAX) return { ok: false, error: "note_too_long" };

  const move = transition(outcome, now, input.callBackAt ?? null);
  if (!move.ok) return { ok: false, error: move.error };

  return prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<{ id: string; closed_at: Date | null; assigned_to_id: string | null }[]>`
      SELECT id, closed_at, assigned_to_id FROM crm_task WHERE id = ${input.taskId} FOR UPDATE
    `;
    if (!locked) return { ok: false as const, error: "not_found" as const };
    if (locked.closed_at) return { ok: false as const, error: "closed" as const };
    if (locked.assigned_to_id && locked.assigned_to_id !== actor.id) {
      return { ok: false as const, error: "taken" as const, holder: null };
    }

    const task = await tx.crmTask.findUniqueOrThrow({
      where: { id: input.taskId },
      select: { businessId: true, signal: true, signalFacts: true, business: { select: { claimStatus: true } } },
    });

    await tx.callOutcome.create({
      data: {
        businessId: task.businessId,
        staffId: actor.id,
        kind: outcome,
        signal: task.signal,
        note,
        callBackAt: move.state === "callback" ? move.callBackAt : null,
        taskId: input.taskId,
        scriptId: scriptIdFor(task.signalFacts as unknown as SignalFacts, task.business.claimStatus),
      },
    });

    const touch = {
      lastTouchAt: now,
      lastOutcome: outcome,
      assignedToId: actor.id,
      assignedAt: locked.assigned_to_id ? undefined : now,
    };
    const data: Prisma.CrmTaskUpdateInput =
      "closeReason" in move
        ? { ...touch, state: move.state, closedAt: now, closeReason: move.closeReason, callBackAt: null, coolingUntil: null }
        : { ...touch, state: move.state, callBackAt: move.callBackAt, coolingUntil: move.coolingUntil };
    await tx.crmTask.update({ where: { id: input.taskId }, data });

    return { ok: true as const, state: move.state };
  });
}

/**
 * Board 12d's banner action: take every unassigned open call behind one held
 * page. The rows were already on the list; this puts them on mine.
 */
export async function buildCallList(actor: Actor, signalRef: string, now: Date = new Date()): Promise<CrmResult<{ assigned: number }>> {
  assertCan(actor, "crm.work");
  const result = await prisma.crmTask.updateMany({
    where: { signal: "held_page", signalRef, closedAt: null, assignedToId: null },
    data: { assignedToId: actor.id, assignedAt: now },
  });
  return { ok: true, assigned: result.count };
}

/**
 * Derive the list now rather than at the nightly run. Still a derivation — it
 * adds nobody a person chose — and refused inside five minutes of the last run,
 * because the signals do not move that fast and the run walks the directory.
 */
export async function refreshSignals(actor: Actor, now: Date = new Date()): Promise<CrmResult<{ result: SyncResult }>> {
  assertCan(actor, "crm.work");
  const last = await lastSyncRun();
  if (last && now.getTime() - last.finishedAt.getTime() < REFRESH_COOLDOWN_MS) return { ok: false, error: "just_refreshed" };
  return { ok: true, result: await syncCrmTasks(now, actor.id) };
}
