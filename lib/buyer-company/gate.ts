import "server-only";
import type { Prisma } from "@/lib/db/generated/client";
import {
  aedToFils,
  approvalNeed,
  mayApprove,
  type ApprovalNeed,
  type ApprovalPolicy,
  type Ask,
  type Seat,
} from "./authority";
import { companySeats, lockCompany, quoteAsk, writeCompanyEvent, type MonthSpend } from "./store";

/**
 * Board `7b` — the gate, evaluated where it binds.
 *
 * Called inside a transaction that already holds the enquiry row (the
 * acceptance's claim, or the request's `FOR UPDATE`), it takes the company
 * lock and reads the rule, the team and the month under it. `authority.ts`
 * decides; this reads what it decides from and writes what it decided.
 */

export interface CompanyPolicy extends ApprovalPolicy {
  name: string;
  requirePoNumber: boolean;
  requireCostCode: boolean;
}

export interface GateEvaluation {
  policy: CompanyPolicy;
  seats: Seat[];
  spend: MonthSpend;
  raiser: Seat;
  ask: Ask;
  need: ApprovalNeed;
}

/** Why a company acceptance or request was refused, in the gate's own words. */
export type GateRefusal =
  /** The enquiry was raised for a company this person no longer buys for. */
  | "not_member"
  | "approval_required"
  | "po_required"
  | "cost_code_required"
  /** A PO number or cost code over 40 characters, or pasted with a control character. */
  | "reference_invalid"
  /** The request was decided, withdrawn or superseded before this. */
  | "approval_closed"
  /** The quote's value is not what was asked about. */
  | "approval_changed"
  /** This person may not approve this request under the rule as it stands. */
  | "not_approver";

export class GateRefused extends Error {
  constructor(readonly code: GateRefusal) {
    super(code);
  }
}

export async function readPolicy(tx: Prisma.TransactionClient, companyId: string): Promise<CompanyPolicy> {
  const company = await tx.buyerCompany.findUniqueOrThrow({
    where: { id: companyId },
    select: {
      name: true,
      approvalThresholdAed: true,
      approverId: true,
      unverifiedNeedsApproval: true,
      requirePoNumber: true,
      requireCostCode: true,
    },
  });
  return {
    name: company.name,
    thresholdFils: company.approvalThresholdAed === null ? null : aedToFils(company.approvalThresholdAed),
    approverId: company.approverId,
    unverifiedNeedsApproval: company.unverifiedNeedsApproval,
    requirePoNumber: company.requirePoNumber,
    requireCostCode: company.requireCostCode,
  };
}

/**
 * Lock the company and evaluate the gate for this person and this quote.
 * Throws `not_member` for somebody who no longer buys for the company.
 */
export async function evaluateGate(
  tx: Prisma.TransactionClient,
  input: { companyId: string; raiserId: string; quoteId: string; now: Date },
): Promise<GateEvaluation> {
  await lockCompany(tx, input.companyId);
  const gate = await assessGate(tx, input);
  if (!gate) throw new GateRefused("not_member");
  return gate;
}

/**
 * The same evaluation without the lock, for a screen saying what will happen.
 * A promise about the next click, never a decision: the click evaluates again
 * under the lock. Null for somebody who does not buy for the company.
 */
export async function assessGate(
  db: Prisma.TransactionClient,
  input: { companyId: string; raiserId: string; quoteId: string; now: Date },
): Promise<GateEvaluation | null> {
  const [policy, team, ask] = await Promise.all([
    readPolicy(db, input.companyId),
    companySeats(db, input.companyId, input.now),
    quoteAsk(db, input.quoteId),
  ]);
  const raiser = team.seats.find((seat) => seat.userId === input.raiserId);
  if (!raiser || !ask) return null;
  return { ...team, policy, raiser, ask, need: approvalNeed(policy, raiser, ask) };
}

/** A PO number or cost code, trimmed and length-checked; blank is absent. */
export function readReference(value: string | null | undefined): string | null | "too_long" | "invalid" {
  if (value == null) return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return "invalid";
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > 40 ? "too_long" : text;
}

export function requireReferences(
  policy: Pick<CompanyPolicy, "requirePoNumber" | "requireCostCode">,
  refs: { poNumber: string | null; costCode: string | null },
): void {
  if (policy.requirePoNumber && !refs.poNumber) throw new GateRefused("po_required");
  if (policy.requireCostCode && !refs.costCode) throw new GateRefused("cost_code_required");
}

export interface AcceptanceGateInput {
  companyId: string;
  enquiryId: string;
  quoteId: string;
  /** For the history line, which people read. */
  quoteRef: string;
  raiserId: string;
  now: Date;
  poNumber: string | null;
  costCode: string | null;
  approval: { id: string; approverId: string } | null;
}

export interface AcceptanceGateOutcome {
  poNumber: string | null;
  costCode: string | null;
  /** Whose authority committed it. */
  committedById: string;
}

/**
 * Run inside `acceptQuote`'s transaction, after the claim, for an enquiry
 * raised for a company. Throws `GateRefused`, which rolls the claim back.
 *
 * With `approval`, this acceptance is that request being approved: the
 * request must still be pending, for this quote and this raiser, at the value
 * it was asked at, and the approver must be allowed to approve it under the
 * rule **as it stands now** — a rule tightened while a request waited binds
 * the approver too.
 */
export async function gateCompanyAcceptance(
  tx: Prisma.TransactionClient,
  input: AcceptanceGateInput,
): Promise<AcceptanceGateOutcome> {
  const gate = await evaluateGate(tx, input);

  let refs = { poNumber: input.poNumber, costCode: input.costCode };
  let committedById = input.raiserId;

  if (input.approval) {
    const request = await tx.quoteApproval.findUnique({
      where: { id: input.approval.id },
      select: {
        companyId: true,
        quoteId: true,
        raisedById: true,
        status: true,
        valueFils: true,
        poNumber: true,
        costCode: true,
      },
    });
    if (
      !request ||
      request.companyId !== input.companyId ||
      request.quoteId !== input.quoteId ||
      request.raisedById !== input.raiserId ||
      request.status !== "pending"
    ) {
      throw new GateRefused("approval_closed");
    }
    if (request.valueFils !== gate.ask.valueFils) throw new GateRefused("approval_changed");

    const approver = gate.seats.find((seat) => seat.userId === input.approval!.approverId);
    if (!approver) throw new GateRefused("not_approver");
    if (gate.need.required && !mayApprove(gate.need.route, approver, input.raiserId, gate.ask.valueFils)) {
      throw new GateRefused("not_approver");
    }
    // The raiser can never approve their own, whatever the rule says now.
    if (approver.userId === input.raiserId) throw new GateRefused("not_approver");

    refs = { poNumber: request.poNumber, costCode: request.costCode };
    requireReferences(gate.policy, refs);

    const decided = await tx.quoteApproval.updateMany({
      where: { id: input.approval.id, status: "pending" },
      data: { status: "approved", decidedById: approver.userId, decidedAt: input.now },
    });
    if (decided.count === 0) throw new GateRefused("approval_closed");
    committedById = approver.userId;

    await writeCompanyEvent(tx, {
      companyId: input.companyId,
      actorId: approver.userId,
      kind: "approval_approved",
      subject: `approval:${input.approval.id}`,
      after: {
        enquiryId: input.enquiryId,
        quoteId: input.quoteId,
        quoteRef: input.quoteRef,
        valueFils: valueJson(gate.ask.valueFils),
      },
      at: input.now,
    });
  } else {
    requireReferences(gate.policy, refs);
    if (gate.need.required) throw new GateRefused("approval_required");
    await writeCompanyEvent(tx, {
      companyId: input.companyId,
      actorId: input.raiserId,
      kind: "quote_accepted",
      subject: `enquiry:${input.enquiryId}`,
      after: { quoteId: input.quoteId, quoteRef: input.quoteRef, valueFils: valueJson(gate.ask.valueFils) },
      at: input.now,
    });
  }

  // Anything else still open on this enquiry is moot: it has been accepted.
  await closeOpenRequests(tx, {
    companyId: input.companyId,
    enquiryId: input.enquiryId,
    actorId: committedById,
    why: "accepted_another",
    except: input.approval?.id ?? null,
    at: input.now,
  });

  return { ...refs, committedById };
}

/**
 * Close whatever is still open on an enquiry, each with its own history line
 * saying why — a request that quietly stopped being pending is a question
 * somebody will ask the approver about.
 */
export async function closeOpenRequests(
  tx: Prisma.TransactionClient,
  input: {
    companyId: string;
    enquiryId: string;
    actorId: string;
    why: "accepted_another" | "replaced";
    except: string | null;
    at: Date;
  },
): Promise<number> {
  const open = await tx.quoteApproval.findMany({
    where: {
      enquiryId: input.enquiryId,
      status: { in: ["pending", "queried"] },
      ...(input.except ? { id: { not: input.except } } : {}),
    },
    select: { id: true, quote: { select: { ref: true } } },
    orderBy: { id: "asc" },
  });
  if (open.length === 0) return 0;
  await tx.quoteApproval.updateMany({
    where: { id: { in: open.map((row) => row.id) }, status: { in: ["pending", "queried"] } },
    data: { status: "superseded" },
  });
  for (const row of open) {
    await writeCompanyEvent(tx, {
      companyId: input.companyId,
      actorId: input.actorId,
      kind: "approval_withdrawn",
      subject: `approval:${row.id}`,
      after: { quoteRef: row.quote.ref, why: input.why },
      at: input.at,
    });
  }
  return open.length;
}

/** JSON has no bigint. Fils as a string, as the ledger in 11g stores money. */
export function valueJson(value: bigint | null): string | null {
  return value === null ? null : value.toString();
}
