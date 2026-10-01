import "server-only";
import { prisma } from "@/lib/db/client";
import { Prisma } from "@/lib/db/generated/client";
import { actorFor } from "@/lib/auth/actor";
import { assertCanAcceptQuote } from "@/lib/auth/guards";
import { acceptQuote, type AcceptQuoteResult } from "@/lib/enquiry/service";
import { acceptRequestedSplit, prepareSplit, type AcceptSplitError } from "@/lib/enquiry/accept";
import { formatList } from "@/lib/format";
import type { SplitPick } from "@/lib/quote/split";
import { onApprovalDecided, onApprovalRequested } from "@/lib/notify/events";
import { eligibleApprovers, type ApprovalReason } from "./authority";
import {
  closeOpenRequests,
  evaluateGate,
  GateRefused,
  readReference,
  requireReferences,
  valueJson,
  type GateRefusal,
} from "./gate";
import { lockCompany, activeMembership, writeCompanyEvent } from "./store";
import { readSplit, splitJson, type StoredPart } from "./split-request";

/**
 * Board `7b` — a quote held for a colleague's approval.
 *
 * `B1`: the gate is on accepting a quote. A request is what an acceptance
 * becomes when the rule says somebody else must agree, and approving it *is*
 * the acceptance — `acceptQuote` runs with the request attached, under the
 * same locks, and the request is marked approved in that transaction or not
 * at all.
 *
 * `B3`: the queue behaves as the rule card describes. Who may approve comes
 * from `authority.ts`, re-evaluated at the moment of approving, never from a
 * list stored when the request was made.
 */

export const NOTE_MAX = 1000;

// ── Requesting ───────────────────────────────────────────────────────────────

export type RequestError =
  | "not_found"
  | "already_accepted"
  | "enquiry_closed"
  | "quote_expired"
  | "not_open"
  | "revised"
  | "supplier_closed"
  /** Not a company enquiry: there is nobody to ask. */
  | "personal"
  /** The rule does not hold this one; accept it. */
  | "not_needed"
  /** The rule holds it and nobody on the team may approve it. */
  | "no_approver"
  | "note_too_long"
  | Exclude<GateRefusal, "approval_required" | "approval_closed" | "approval_changed" | "not_approver">;

export type RequestResult = { ok: true; approvalId: string } | { ok: false; error: RequestError };

class RequestRefused extends Error {
  constructor(readonly code: RequestError) {
    super(code);
  }
}

export async function requestApproval(
  buyerId: string,
  quoteId: string,
  input: { poNumber?: string | null; costCode?: string | null; note?: string | null },
  now: Date = new Date(),
): Promise<RequestResult> {
  // Build plan 9.4: a request is an acceptance the rule holds, so it asks what
  // `acceptQuote` asks — before a colleague is sent a question nobody could
  // answer yes to. Throws `PermissionError`.
  assertCanAcceptQuote(await actorFor(buyerId));

  const poNumber = readReference(input.poNumber);
  const costCode = readReference(input.costCode);
  if (poNumber === "too_long" || poNumber === "invalid" || costCode === "too_long" || costCode === "invalid") {
    return { ok: false, error: "reference_invalid" };
  }
  const note = (input.note ?? "").trim() || null;
  if (note && note.length > NOTE_MAX) return { ok: false, error: "note_too_long" };

  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    select: {
      id: true,
      ref: true,
      businessId: true,
      revision: true,
      status: true,
      expiresAt: true,
      business: { select: { closureRequestedAt: true } },
      enquiry: { select: { id: true, ref: true, buyerId: true, buyerCompanyId: true } },
    },
  });
  // The same answers `acceptQuote` gives, in the same order.
  if (!quote || quote.enquiry.buyerId !== buyerId || quote.status === "draft") return { ok: false, error: "not_found" };
  if (!quote.enquiry.buyerCompanyId) return { ok: false, error: "personal" };
  if (quote.expiresAt && quote.expiresAt.getTime() < now.getTime()) return { ok: false, error: "quote_expired" };
  if (quote.business.closureRequestedAt) return { ok: false, error: "supplier_closed" };
  const companyId = quote.enquiry.buyerCompanyId;

  try {
    const approvalId = await prisma.$transaction(async (tx) => {
      // The enquiry first, then the company: the order every acceptance takes.
      const [locked] = await tx.$queryRaw<{ closes_at: Date; contact_released_to_business_id: string | null }[]>`
        SELECT closes_at, contact_released_to_business_id FROM enquiry WHERE id = ${quote.enquiry.id} FOR UPDATE
      `;
      if (!locked) throw new RequestRefused("not_found");
      if (locked.contact_released_to_business_id) throw new RequestRefused("already_accepted");
      if (locked.closes_at.getTime() <= now.getTime()) throw new RequestRefused("enquiry_closed");

      const current = await tx.quote.findUniqueOrThrow({ where: { id: quote.id }, select: { status: true } });
      if (current.status !== "sent" && current.status !== "read") throw new RequestRefused("not_open");
      const later = await tx.quote.count({
        where: {
          enquiryId: quote.enquiry.id,
          businessId: quote.businessId,
          revision: { gt: quote.revision },
          status: { not: "draft" },
        },
      });
      if (later > 0) throw new RequestRefused("revised");

      const gate = await evaluateGate(tx, { companyId, raiserId: buyerId, quoteId: quote.id, now });
      requireReferences(gate.policy, { poNumber, costCode });
      if (!gate.need.required) throw new RequestRefused("not_needed");
      const approvers = eligibleApprovers(gate.need.route, gate.seats, buyerId, gate.ask.valueFils);
      if (approvers.length === 0) throw new RequestRefused("no_approver");

      // One open request per enquiry. Asking about another quote replaces the first question.
      const replaced = await closeOpenRequests(tx, {
        companyId,
        enquiryId: quote.enquiry.id,
        actorId: buyerId,
        why: "replaced",
        except: null,
        at: now,
      });

      const request = await tx.quoteApproval.create({
        data: {
          companyId,
          enquiryId: quote.enquiry.id,
          quoteId: quote.id,
          quoteRevision: quote.revision,
          valueFils: gate.ask.valueFils,
          raisedById: buyerId,
          reasons: gate.need.reasons,
          approverId: gate.need.route.kind === "named" ? gate.need.route.approverId : null,
          poNumber,
          costCode,
          note,
          createdAt: now,
          updatedAt: now,
        },
        select: { id: true },
      });
      await writeCompanyEvent(tx, {
        companyId,
        actorId: buyerId,
        kind: "approval_requested",
        subject: `approval:${request.id}`,
        after: {
          enquiryId: quote.enquiry.id,
          enquiryRef: quote.enquiry.ref,
          quoteId: quote.id,
          quoteRef: quote.ref,
          valueFils: valueJson(gate.ask.valueFils),
          reasons: gate.need.reasons,
          replaced,
        },
        note,
        at: now,
      });
      return request.id;
    });
    await onApprovalRequested({ approvalId });
    return { ok: true, approvalId };
  } catch (error) {
    if (error instanceof RequestRefused) return { ok: false, error: error.code };
    if (error instanceof GateRefused) return { ok: false, error: error.code as RequestError };
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Two requests on one enquiry in the same instant; the other one stands.
      return { ok: false, error: "not_open" };
    }
    throw error;
  }
}

export type SplitRequestError = RequestError | AcceptSplitError;

export type SplitRequestResult = { ok: true; approvalId: string } | { ok: false; error: SplitRequestError; lineId?: string; quoteId?: string };

/**
 * Board `1o` D5 — ask for a split, once.
 *
 * The rule is checked on the parts together: their combined value excl. VAT,
 * verified only if every supplier is. One request, one approver's decision,
 * and a PO number per supplier, each required where the company requires one.
 * The request stores the parts as asked (`QuoteApproval.split`), and approving
 * it accepts exactly those (`acceptRequestedSplit`).
 *
 * One supplier's whole quote is not a split (AC7): it is the ordinary request.
 */
export async function requestSplitApproval(
  buyerId: string,
  enquiryRefOrId: string,
  picks: readonly SplitPick[],
  input: { poNumbers?: Readonly<Record<string, string | null>>; costCode?: string | null; note?: string | null },
  now: Date = new Date(),
): Promise<SplitRequestResult> {
  // Build plan 9.4, as `requestApproval` asks it. Throws `PermissionError`.
  assertCanAcceptQuote(await actorFor(buyerId));

  const costCode = readReference(input.costCode);
  if (costCode === "too_long" || costCode === "invalid") return { ok: false, error: "reference_invalid" };
  const note = (input.note ?? "").trim() || null;
  if (note && note.length > NOTE_MAX) return { ok: false, error: "note_too_long" };

  const prepared = await prepareSplit(buyerId, enquiryRefOrId, picks, now);
  if (!prepared.ok) return prepared;
  const { enquiry, plan, parts } = prepared;
  if (!enquiry.buyerCompanyId) return { ok: false, error: "personal" };
  if (plan.single) {
    return requestApproval(buyerId, parts[0]!.quoteId, { poNumber: input.poNumbers?.[parts[0]!.quoteId] ?? null, costCode: input.costCode, note: input.note }, now);
  }
  const companyId = enquiry.buyerCompanyId;

  const asked: StoredPart[] = [];
  for (const part of parts) {
    const poNumber = readReference(input.poNumbers?.[part.quoteId]);
    if (poNumber === "too_long" || poNumber === "invalid") return { ok: false, error: "reference_invalid", quoteId: part.quoteId };
    asked.push({ quoteId: part.quoteId, quoteRevision: part.revision, enquiryLineIds: part.enquiryLineIds, poNumber });
  }
  const primary = parts.find((part) => part.businessId === plan.primaryBusinessId) ?? parts[0]!;
  const quoteRef = formatList(parts.map((part) => part.quoteRef));

  try {
    const approvalId = await prisma.$transaction(async (tx) => {
      // The enquiry first, then the company: the order every acceptance takes.
      const [locked] = await tx.$queryRaw<{ closes_at: Date; contact_released_to_business_id: string | null }[]>`
        SELECT closes_at, contact_released_to_business_id FROM enquiry WHERE id = ${enquiry.id} FOR UPDATE
      `;
      if (!locked) throw new RequestRefused("not_found");
      if (locked.contact_released_to_business_id) throw new RequestRefused("already_accepted");
      if (locked.closes_at.getTime() <= now.getTime()) throw new RequestRefused("enquiry_closed");

      for (const part of parts) {
        const current = await tx.quote.findUniqueOrThrow({
          where: { id: part.quoteId },
          select: { status: true, expiresAt: true, business: { select: { closureRequestedAt: true } } },
        });
        if (current.status !== "sent" && current.status !== "read") throw new RequestRefused("not_open");
        if (current.expiresAt && current.expiresAt.getTime() < now.getTime()) throw new RequestRefused("quote_expired");
        if (current.business.closureRequestedAt) throw new RequestRefused("supplier_closed");
        const later = await tx.quote.count({
          where: { enquiryId: enquiry.id, businessId: part.businessId, revision: { gt: part.revision }, status: { not: "draft" } },
        });
        if (later > 0) throw new RequestRefused("revised");
      }

      const gate = await evaluateGate(tx, { companyId, raiserId: buyerId, quoteId: primary.quoteId, now, parts: asked });
      requireReferences(gate.policy, { poNumber: null, costCode }, asked);
      if (!gate.need.required) throw new RequestRefused("not_needed");
      const approvers = eligibleApprovers(gate.need.route, gate.seats, buyerId, gate.ask.valueFils);
      if (approvers.length === 0) throw new RequestRefused("no_approver");

      // One open request per enquiry. Asking about a split replaces the first question.
      const replaced = await closeOpenRequests(tx, {
        companyId,
        enquiryId: enquiry.id,
        actorId: buyerId,
        why: "replaced",
        except: null,
        at: now,
      });

      const request = await tx.quoteApproval.create({
        data: {
          companyId,
          enquiryId: enquiry.id,
          // The main supplier's quote, which the request trigger fixes with the rest.
          quoteId: primary.quoteId,
          quoteRevision: primary.revision,
          valueFils: gate.ask.valueFils,
          split: splitJson(asked),
          raisedById: buyerId,
          reasons: gate.need.reasons,
          approverId: gate.need.route.kind === "named" ? gate.need.route.approverId : null,
          // A PO number is issued to one supplier: each is on its part.
          poNumber: null,
          costCode,
          note,
          createdAt: now,
          updatedAt: now,
        },
        select: { id: true },
      });
      await writeCompanyEvent(tx, {
        companyId,
        actorId: buyerId,
        kind: "approval_requested",
        subject: `approval:${request.id}`,
        after: {
          enquiryId: enquiry.id,
          enquiryRef: enquiry.ref,
          quoteId: primary.quoteId,
          quoteRef,
          quoteIds: parts.map((part) => part.quoteId),
          valueFils: valueJson(gate.ask.valueFils),
          reasons: gate.need.reasons,
          replaced,
        },
        note,
        at: now,
      });
      return request.id;
    });
    await onApprovalRequested({ approvalId });
    return { ok: true, approvalId };
  } catch (error) {
    if (error instanceof RequestRefused) return { ok: false, error: error.code };
    if (error instanceof GateRefused) return { ok: false, error: error.code as RequestError };
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, error: "not_open" };
    }
    throw error;
  }
}

// ── Deciding ─────────────────────────────────────────────────────────────────

export type DecideError =
  | "not_found"
  | "not_member"
  | "not_approver"
  | "approval_closed"
  | "approval_changed"
  | "note_required"
  | "note_too_long"
  | Extract<AcceptQuoteResult, { ok: false }>["error"]
  /** Board `1o`: a split's own refusals, found when its parts are planned again. */
  | AcceptSplitError;

export type DecideResult =
  | { ok: true; outcome: "approved"; enquiryId: string }
  | { ok: true; outcome: "queried" }
  | { ok: false; error: DecideError };

/** Refusals after which the request can never be approved. The request is closed with them. */
const TERMINAL: ReadonlySet<string> = new Set([
  "already_accepted",
  "quote_expired",
  "not_open",
  "revised",
  "supplier_closed",
  "enquiry_closed",
  "approval_changed",
  "not_member",
  // Board `1o`: a split's lines no longer plan as asked.
  "unknown_quote",
  "unknown_line",
  "not_quoted",
  "other_quantity",
  "all_or_nothing",
]);

/**
 * Approve: accept the quote on the raiser's behalf, on the approver's authority.
 */
export async function approveRequest(
  approverId: string,
  approvalId: string,
  now: Date = new Date(),
): Promise<DecideResult> {
  /*
     Build plan 9.4: approving *is* the acceptance, so the approver is asked
     `quote.accept` as well as the raiser, whose name it goes out in —
     `acceptQuote` asks that one. The company's rule says whether this colleague
     may approve this value; the matrix says whether they may accept at all.
  */
  assertCanAcceptQuote(await actorFor(approverId));

  const request = await prisma.quoteApproval.findUnique({
    where: { id: approvalId },
    select: {
      id: true,
      companyId: true,
      enquiryId: true,
      quoteId: true,
      raisedById: true,
      status: true,
      poNumber: true,
      costCode: true,
      split: true,
      quote: { select: { ref: true } },
    },
  });
  if (!request) return { ok: false, error: "not_found" };
  const seat = await activeMembership(prisma, approverId);
  if (!seat || seat.companyId !== request.companyId) return { ok: false, error: "not_found" };
  if (request.status !== "pending") return { ok: false, error: "approval_closed" };

  // Board `1o` D5: a split is approved as it was asked — every part, in one decision.
  const parts = readSplit(request.split);
  const result = parts
    ? await acceptRequestedSplit(request.raisedById, request.enquiryId, parts, now, {
        costCode: request.costCode,
        approval: { id: request.id, approverId },
        source: "approval",
      })
    : await acceptQuote(request.raisedById, request.quoteId, now, {
        poNumber: request.poNumber,
        costCode: request.costCode,
        approval: { id: request.id, approverId },
        source: "approval",
      });

  if (!result.ok) {
    if (TERMINAL.has(result.error)) {
      await closeLapsed(request.id, request.companyId, approverId, request.quote.ref, result.error, now);
    }
    return { ok: false, error: result.error };
  }
  await onApprovalDecided({ approvalId: request.id });
  return { ok: true, outcome: "approved", enquiryId: request.enquiryId };
}

/** A request that can no longer be approved leaves the queue, with the reason on its history line. */
async function closeLapsed(
  approvalId: string,
  companyId: string,
  actorId: string,
  quoteRef: string,
  reason: string,
  now: Date,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockCompany(tx, companyId);
    const closed = await tx.quoteApproval.updateMany({
      where: { id: approvalId, status: { in: ["pending", "queried"] } },
      data: { status: "superseded" },
    });
    if (closed.count === 0) return;
    await writeCompanyEvent(tx, {
      companyId,
      actorId,
      kind: "approval_withdrawn",
      subject: `approval:${approvalId}`,
      after: { quoteRef, why: `lapsed:${reason}` },
      at: now,
    });
  });
}

/**
 * Query: send it back with a question. Anybody who could approve it may ask,
 * and so may any admin. A question has words (`quote_approval_query_has_note`).
 */
export async function queryRequest(
  approverId: string,
  approvalId: string,
  noteText: string,
  now: Date = new Date(),
): Promise<DecideResult> {
  const note = noteText.trim();
  if (!note) return { ok: false, error: "note_required" };
  if (note.length > NOTE_MAX) return { ok: false, error: "note_too_long" };

  const request = await prisma.quoteApproval.findUnique({
    where: { id: approvalId },
    select: { id: true, companyId: true, raisedById: true, quoteId: true, split: true, quote: { select: { ref: true } } },
  });
  if (!request) return { ok: false, error: "not_found" };

  try {
    await prisma.$transaction(async (tx) => {
      await lockCompany(tx, request.companyId);
      const seat = await activeMembership(tx, approverId);
      if (!seat || seat.companyId !== request.companyId) throw new GateRefused("not_member");
      if (approverId === request.raisedById) throw new GateRefused("not_approver");
      const current = await tx.quoteApproval.findUniqueOrThrow({
        where: { id: approvalId },
        select: { status: true, enquiryId: true },
      });
      if (current.status !== "pending") throw new GateRefused("approval_closed");

      if (seat.role !== "company_admin") {
        // Board `1o` D5: a split is judged on its parts together, as it was asked.
        const parts = readSplit(request.split);
        const gate = await evaluateGate(tx, {
          companyId: request.companyId,
          raiserId: request.raisedById,
          quoteId: request.quoteId,
          now,
          ...(parts ? { parts } : {}),
        });
        const may = gate.need.required
          ? eligibleApprovers(gate.need.route, gate.seats, request.raisedById, gate.ask.valueFils).some(
              (s) => s.userId === approverId,
            )
          : false;
        if (!may) throw new GateRefused("not_approver");
      }

      await tx.quoteApproval.update({
        where: { id: approvalId },
        data: { status: "queried", decidedById: approverId, decidedAt: now, decisionNote: note },
      });
      await writeCompanyEvent(tx, {
        companyId: request.companyId,
        actorId: approverId,
        kind: "approval_queried",
        subject: `approval:${approvalId}`,
        after: { quoteRef: request.quote.ref },
        note,
        at: now,
      });
    });
  } catch (error) {
    if (error instanceof GateRefused) {
      return { ok: false, error: error.code === "not_member" ? "not_found" : (error.code as DecideError) };
    }
    throw error;
  }
  await onApprovalDecided({ approvalId });
  return { ok: true, outcome: "queried" };
}

// ── The raiser's half ────────────────────────────────────────────────────────

export type RaiserResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "not_queried" | "closed" | "answer_required" | "note_too_long" };

/** Answer a query. The request is pending again, before the same approvers. */
export async function answerQuery(
  raiserId: string,
  approvalId: string,
  answerText: string,
  now: Date = new Date(),
): Promise<RaiserResult> {
  const answer = answerText.trim();
  if (!answer) return { ok: false, error: "answer_required" };
  if (answer.length > NOTE_MAX) return { ok: false, error: "note_too_long" };
  const request = await prisma.quoteApproval.findFirst({
    where: { id: approvalId, raisedById: raiserId },
    select: { companyId: true, quote: { select: { ref: true } } },
  });
  if (!request) return { ok: false, error: "not_found" };

  const outcome = await prisma.$transaction(async (tx) => {
    await lockCompany(tx, request.companyId);
    const moved = await tx.quoteApproval.updateMany({
      where: { id: approvalId, raisedById: raiserId, status: "queried" },
      data: { status: "pending", answer, answeredAt: now },
    });
    if (moved.count === 0) return "not_queried" as const;
    await writeCompanyEvent(tx, {
      companyId: request.companyId,
      actorId: raiserId,
      kind: "approval_answered",
      subject: `approval:${approvalId}`,
      after: { quoteRef: request.quote.ref },
      note: answer,
      at: now,
    });
    return "ok" as const;
  });
  if (outcome !== "ok") return { ok: false, error: outcome };
  await onApprovalRequested({ approvalId, answered: true });
  return { ok: true };
}

/** Withdraw it. The raiser changed their mind, or accepted another quote another way. */
export async function withdrawRequest(
  raiserId: string,
  approvalId: string,
  now: Date = new Date(),
): Promise<RaiserResult> {
  const request = await prisma.quoteApproval.findFirst({
    where: { id: approvalId, raisedById: raiserId },
    select: { companyId: true, quote: { select: { ref: true } } },
  });
  if (!request) return { ok: false, error: "not_found" };
  const closed = await prisma.$transaction(async (tx) => {
    await lockCompany(tx, request.companyId);
    const moved = await tx.quoteApproval.updateMany({
      where: { id: approvalId, raisedById: raiserId, status: { in: ["pending", "queried"] } },
      data: { status: "withdrawn" },
    });
    if (moved.count === 0) return false;
    await writeCompanyEvent(tx, {
      companyId: request.companyId,
      actorId: raiserId,
      kind: "approval_withdrawn",
      subject: `approval:${approvalId}`,
      after: { quoteRef: request.quote.ref },
      at: now,
    });
    return true;
  });
  return closed ? { ok: true } : { ok: false, error: "closed" };
}

export type { ApprovalReason };
