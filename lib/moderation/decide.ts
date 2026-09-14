import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import { assertReason } from "@/lib/audit/write-audit";
import { assertCan, can } from "@/lib/auth/can";
import type { Actor } from "@/lib/auth/roles";
import type { QueueSubject } from "@/lib/db/generated/client";
import { approveDocument, rejectDocument } from "@/lib/verification/review";
import { approveClaim, rejectClaim } from "./claims";
import { entriesFrom, loadPending, parseRef, queueItemStates, readRules, refFor, type QueueEntry } from "./queue";
import { approveChange, rejectChange } from "./service";

/**
 * Board 4b — every decision the queue can make, by reference.
 *
 * A row is `claim:cl123`, `change_request:cr456` and so on, and each subject is
 * decided by the service that already owned it: a change request by
 * `lib/moderation/service.ts`, a credential by `lib/verification/review.ts`, a
 * claim by `./claims.ts`. This file only routes, and adds the three things the
 * queue itself owns — a branch review, a request for documents, and who a
 * submission is assigned to. Every one is a `staffMutation` with a written
 * reason (B8).
 *
 * ## B1, enforced here
 *
 * `bulkApprove` does not trust the selection it is handed. It reads the queue
 * again, computes every selected row's checks against the rules as they stand
 * at submit time, and approves only rows where every check passed. A row that
 * failed a check, left the queue or never existed is skipped and named, never
 * approved. The button being disabled on the screen is a courtesy; this is the
 * rule.
 */

export type DecisionError =
  | "not_found"
  | "not_pending"
  | "not_eligible"
  | "conflict_screen"
  | "not_requestable"
  | "stale"
  | "slug_taken"
  | "not_a_credential"
  | "in_conflict"
  | "business_closing"
  | "listing_claimed"
  | "not_staff";

export type DecisionResult = { ok: true } | { ok: false; error: DecisionError };

export interface RefInput {
  actor: Actor;
  ref: string;
  reason: string;
}

/** Every pending row's reference, read once. */
export async function pendingRefs(): Promise<Set<string>> {
  return new Set((await loadPending()).map((raw) => refFor(raw.subject, raw.id)));
}

async function subjectBusinessId(subject: QueueSubject, id: string): Promise<string | null> {
  switch (subject) {
    case "change_request":
      return (await prisma.listingChangeRequest.findUnique({ where: { id }, select: { businessId: true } }))?.businessId ?? null;
    case "claim":
      return (await prisma.claimSubmission.findUnique({ where: { id }, select: { businessId: true } }))?.businessId ?? null;
    case "conflict":
      return (await prisma.claimConflict.findUnique({ where: { id }, select: { businessId: true } }))?.businessId ?? null;
    case "credential":
      return (await prisma.document.findUnique({ where: { id }, select: { businessId: true } }))?.businessId ?? null;
    case "location":
      return (await prisma.location.findUnique({ where: { id }, select: { businessId: true } }))?.businessId ?? null;
  }
}

const AUDIT_SUBJECT: Record<QueueSubject, string> = {
  change_request: "ListingChangeRequest",
  claim: "ClaimSubmission",
  conflict: "ClaimConflict",
  credential: "Document",
  location: "Location",
};

function auditSubject(subject: QueueSubject, id: string): `${string}:${string}` {
  return `${AUDIT_SUBJECT[subject]}:${id}`;
}

/* ── Approve and reject ────────────────────────────────────────────────────── */

export async function approveRef(input: RefInput, now = new Date(), pending?: ReadonlySet<string>): Promise<DecisionResult> {
  assertCan(input.actor, "queue.decide");
  const parsed = parseRef(input.ref);
  if (!parsed) return { ok: false, error: "not_found" };

  switch (parsed.subject) {
    case "change_request": {
      const result = await approveChange({ actor: input.actor, requestId: parsed.id, reason: input.reason });
      if (result.ok) return { ok: true };
      return { ok: false, error: result.error === "already_decided" ? "not_pending" : result.error };
    }
    case "credential": {
      const result = await approveDocument({ actor: input.actor, documentId: parsed.id, reason: input.reason });
      if (result.ok) return { ok: true };
      return { ok: false, error: result.error === "already_decided" ? "not_pending" : result.error };
    }
    case "claim": {
      const result = await approveClaim({ actor: input.actor, submissionId: parsed.id, reason: input.reason }, now);
      if (result.ok) return { ok: true };
      return { ok: false, error: result.error === "already_decided" ? "not_pending" : result.error };
    }
    case "location":
      return decideBranch(input.actor, parsed.id, "approved", input.reason, now, pending);
    case "conflict":
      // Who owns a company is settled four ways on its own screen, never by one button.
      return { ok: false, error: "conflict_screen" };
  }
}

export async function rejectRef(input: RefInput, now = new Date(), pending?: ReadonlySet<string>): Promise<DecisionResult> {
  assertCan(input.actor, "queue.decide");
  const parsed = parseRef(input.ref);
  if (!parsed) return { ok: false, error: "not_found" };

  switch (parsed.subject) {
    case "change_request": {
      const result = await rejectChange({ actor: input.actor, requestId: parsed.id, reason: input.reason });
      if (result.ok) return { ok: true };
      return { ok: false, error: result.error === "already_decided" ? "not_pending" : result.error };
    }
    case "credential": {
      const result = await rejectDocument({ actor: input.actor, documentId: parsed.id, reason: input.reason });
      if (result.ok) return { ok: true };
      return { ok: false, error: result.error === "already_decided" ? "not_pending" : result.error };
    }
    case "claim": {
      const result = await rejectClaim({ actor: input.actor, submissionId: parsed.id, reason: input.reason }, now);
      if (result.ok) return { ok: true };
      return { ok: false, error: result.error === "already_decided" ? "not_pending" : result.error };
    }
    case "location":
      return decideBranch(input.actor, parsed.id, "rejected", input.reason, now, pending);
    case "conflict":
      return { ok: false, error: "conflict_screen" };
  }
}

/**
 * A branch published outside the emirate its licence covers.
 *
 * Nothing waits for this — board 3c's rule is that a supplier is the authority
 * on their own address, so the branch went live when they published it. The
 * review is after the fact, like board 2c's activity flag: approving records
 * that a person looked at this emirate for this branch; rejecting takes the
 * branch off the directory with the reason the seller reads on their locations
 * page. Moving the branch again is a new question.
 */
async function decideBranch(
  actor: Actor,
  locationId: string,
  decision: "approved" | "rejected",
  reason: string,
  now: Date,
  pending?: ReadonlySet<string>,
): Promise<DecisionResult> {
  const branch = await prisma.location.findUnique({
    where: { id: locationId },
    select: { id: true, businessId: true, emirate: true, published: true },
  });
  if (!branch) return { ok: false, error: "not_found" };

  if (!(pending ?? (await pendingRefs())).has(refFor("location", locationId))) {
    return { ok: false, error: "not_pending" };
  }

  await prisma.$transaction(async (tx) =>
    staffMutation(
      { actor, capability: "queue.decide", subject: auditSubject("location", branch.id), reason, tx },
      async () => {
        await tx.queueItem.upsert({
          where: { subjectType_subjectId: { subjectType: "location", subjectId: branch.id } },
          create: {
            subjectType: "location",
            subjectId: branch.id,
            businessId: branch.businessId,
            decidedAt: now,
            decidedById: actor.id,
            decision,
            decisionReason: reason.trim(),
            subjectVersion: branch.emirate,
          },
          update: {
            decidedAt: now,
            decidedById: actor.id,
            decision,
            decisionReason: reason.trim(),
            subjectVersion: branch.emirate,
          },
        });
        if (decision === "rejected") {
          await tx.location.update({ where: { id: branch.id }, data: { published: false } });
        }
        return {
          result: null,
          before: { published: branch.published, emirate: branch.emirate },
          after: { published: decision === "approved", emirate: branch.emirate, decision },
        };
      },
    ),
  );
  return { ok: true };
}

/* ── Request documents ─────────────────────────────────────────────────────── */

const REQUESTABLE: ReadonlySet<QueueSubject> = new Set(["claim", "change_request", "credential"]);

/**
 * Ask the seller for a document. Additive: nothing is decided and nothing is
 * published, the submission stays in the queue, and its clock stops counting
 * against us until something comes back. The reason is the sentence the
 * seller reads beside their submission.
 */
export async function requestDocumentsRef(
  input: RefInput,
  now = new Date(),
  pending?: ReadonlySet<string>,
): Promise<DecisionResult> {
  assertCan(input.actor, "queue.decide");
  assertReason("queue_docs_requested", input.reason);
  const parsed = parseRef(input.ref);
  if (!parsed) return { ok: false, error: "not_found" };
  if (!REQUESTABLE.has(parsed.subject)) return { ok: false, error: "not_requestable" };

  if (!(pending ?? (await pendingRefs())).has(input.ref)) return { ok: false, error: "not_pending" };
  const businessId = await subjectBusinessId(parsed.subject, parsed.id);
  if (!businessId) return { ok: false, error: "not_found" };

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "queue.decide",
        action: "queue_docs_requested",
        subject: auditSubject(parsed.subject, parsed.id),
        reason: input.reason,
        tx,
      },
      async () => {
        const request = {
          docsRequestedAt: now,
          docsRequestedById: input.actor.id,
          docsRequestReason: input.reason.trim(),
          docsReceivedAt: null,
        };
        await tx.queueItem.upsert({
          where: { subjectType_subjectId: { subjectType: parsed.subject, subjectId: parsed.id } },
          create: { subjectType: parsed.subject, subjectId: parsed.id, businessId, ...request },
          update: request,
        });
        return { result: null, before: null, after: { docsRequestedAt: now.toISOString() } };
      },
    ),
  );
  return { ok: true };
}

/* ── Assignment ────────────────────────────────────────────────────────────── */

export interface AssignInput {
  actor: Actor;
  ref: string;
  /** Null unassigns. */
  assigneeId: string | null;
  reason: string;
}

/** Staff who can work the queue: the people a submission may be handed to. */
export async function queueStaff() {
  const rows = await prisma.user.findMany({
    where: { roles: { hasSome: ["staff_moderator", "staff_ops_lead"] } },
    orderBy: [{ fullName: "asc" }, { id: "asc" }],
    select: { id: true, fullName: true, roles: true },
  });
  return rows.map((row) => ({ id: row.id, name: row.fullName, roles: row.roles }));
}

export async function assignRef(
  input: AssignInput,
  now = new Date(),
  pending?: ReadonlySet<string>,
): Promise<DecisionResult> {
  assertCan(input.actor, "queue.decide");
  const parsed = parseRef(input.ref);
  if (!parsed) return { ok: false, error: "not_found" };

  if (input.assigneeId) {
    const assignee = await prisma.user.findUnique({ where: { id: input.assigneeId }, select: { id: true, roles: true } });
    if (!assignee || !can({ id: assignee.id, roles: assignee.roles }, "queue.decide")) return { ok: false, error: "not_staff" };
  }

  if (!(pending ?? (await pendingRefs())).has(input.ref)) return { ok: false, error: "not_pending" };
  const businessId = await subjectBusinessId(parsed.subject, parsed.id);
  if (!businessId) return { ok: false, error: "not_found" };

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "queue.decide",
        action: "queue_reassigned",
        subject: auditSubject(parsed.subject, parsed.id),
        reason: input.reason,
        tx,
      },
      async () => {
        const existing = await tx.queueItem.findUnique({
          where: { subjectType_subjectId: { subjectType: parsed.subject, subjectId: parsed.id } },
          select: { assigneeId: true },
        });
        const assignment = input.assigneeId
          ? { assigneeId: input.assigneeId, assignedAt: now, assignedById: input.actor.id }
          : { assigneeId: null, assignedAt: null, assignedById: input.actor.id };
        await tx.queueItem.upsert({
          where: { subjectType_subjectId: { subjectType: parsed.subject, subjectId: parsed.id } },
          create: { subjectType: parsed.subject, subjectId: parsed.id, businessId, ...assignment },
          update: assignment,
        });
        return {
          result: null,
          before: { assigneeId: existing?.assigneeId ?? null },
          after: { assigneeId: input.assigneeId },
        };
      },
    ),
  );
  return { ok: true };
}

/* ── Many at once ──────────────────────────────────────────────────────────── */

export const BULK_LIMIT = 200;

export interface BulkOutcome {
  done: string[];
  skipped: { ref: string; error: DecisionError }[];
}

async function currentEntries(refs: readonly string[], now: Date): Promise<Map<string, QueueEntry>> {
  const [raws, rules] = await Promise.all([loadPending(), readRules()]);
  const wanted = new Set(refs);
  const selected = raws.filter((raw) => wanted.has(refFor(raw.subject, raw.id)));
  const items = await queueItemStates(selected);
  return new Map(entriesFrom(selected, rules, items, now).map((entry) => [entry.ref, entry]));
}

function capped(refs: readonly string[]): string[] {
  return [...new Set(refs)].slice(0, BULK_LIMIT);
}

/**
 * B1. Each selected row is re-read and re-checked now, against the rules as
 * they stand now, and approved only where every check passed. One decision per
 * row, each with its own audit row carrying the same reason.
 */
export async function bulkApprove(input: { actor: Actor; refs: readonly string[]; reason: string }, now = new Date()): Promise<BulkOutcome> {
  assertCan(input.actor, "queue.decide");
  assertReason("queue_decided", input.reason);
  const refs = capped(input.refs);
  const entries = await currentEntries(refs, now);
  const outcome: BulkOutcome = { done: [], skipped: [] };
  for (const ref of refs) {
    const entry = entries.get(ref);
    if (!entry) {
      outcome.skipped.push({ ref, error: "not_pending" });
      continue;
    }
    if (!entry.allPassed) {
      outcome.skipped.push({ ref, error: entry.kind === "conflict" ? "conflict_screen" : "not_eligible" });
      continue;
    }
    const result = await approveRef({ actor: input.actor, ref, reason: input.reason }, now, new Set(entries.keys()));
    if (result.ok) outcome.done.push(ref);
    else outcome.skipped.push({ ref, error: result.error });
  }
  return outcome;
}

export async function bulkReject(input: { actor: Actor; refs: readonly string[]; reason: string }, now = new Date()): Promise<BulkOutcome> {
  assertCan(input.actor, "queue.decide");
  assertReason("queue_decided", input.reason);
  const outcome: BulkOutcome = { done: [], skipped: [] };
  const pending = await pendingRefs();
  for (const ref of capped(input.refs)) {
    const result = await rejectRef({ actor: input.actor, ref, reason: input.reason }, now, pending);
    if (result.ok) outcome.done.push(ref);
    else outcome.skipped.push({ ref, error: result.error });
  }
  return outcome;
}

export async function bulkRequestDocuments(
  input: { actor: Actor; refs: readonly string[]; reason: string },
  now = new Date(),
): Promise<BulkOutcome> {
  assertCan(input.actor, "queue.decide");
  assertReason("queue_docs_requested", input.reason);
  const outcome: BulkOutcome = { done: [], skipped: [] };
  const pending = await pendingRefs();
  for (const ref of capped(input.refs)) {
    const result = await requestDocumentsRef({ actor: input.actor, ref, reason: input.reason }, now, pending);
    if (result.ok) outcome.done.push(ref);
    else outcome.skipped.push({ ref, error: result.error });
  }
  return outcome;
}

export async function bulkAssign(
  input: { actor: Actor; refs: readonly string[]; assigneeId: string | null; reason: string },
  now = new Date(),
): Promise<BulkOutcome> {
  assertCan(input.actor, "queue.decide");
  assertReason("queue_reassigned", input.reason);
  const outcome: BulkOutcome = { done: [], skipped: [] };
  const pending = await pendingRefs();
  for (const ref of capped(input.refs)) {
    const result = await assignRef({ actor: input.actor, ref, assigneeId: input.assigneeId, reason: input.reason }, now, pending);
    if (result.ok) outcome.done.push(ref);
    else outcome.skipped.push({ ref, error: result.error });
  }
  return outcome;
}
