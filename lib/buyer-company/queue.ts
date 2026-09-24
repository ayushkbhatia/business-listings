import "server-only";
import { prisma } from "@/lib/db/client";
import type { Prisma } from "@/lib/db/generated/client";
import { filsToAed, lineTotalFils } from "@/lib/quote/money";
import { toProposalFigure, PROPOSAL_FIGURE_SELECT, type ProposalFigure } from "@/lib/quote/proposal";
import { isVerified } from "@/lib/verification";
import {
  approvalNeed,
  approverHasNoCover,
  eligibleApprovers,
  mayApprove,
  remainingFils,
  type ApprovalNeed,
  type ApprovalReason,
  type BuyerCompanyRole,
  type Seat,
} from "./authority";
import { assessGate, readPolicy, type CompanyPolicy } from "./gate";
import { inviteState, type InviteState } from "./team";
import { activeMembership, companySeats, type MonthSpend } from "./store";
import { constraintPhrases, placeLine, type RuleFacts } from "./words";
import { t } from "@/lib/i18n";
import type { DeliveryChoice, LoadLimit } from "./address";

/**
 * Board `7b` — the reads. What each company screen renders, as values.
 *
 * Every figure here is a query (CLAUDE.md, *every number is a query*): the
 * month's spend is summed from accepted quotes, the approvers are the ones
 * `authority.ts` allows now, and a request that can no longer be approved says
 * so rather than sitting in a queue as though it could.
 */

// ── Request state ────────────────────────────────────────────────────────────

/** Why a request that is still open can never be approved. */
export type LapseReason = "accepted" | "enquiry_closed" | "quote_expired" | "not_open" | "revised" | "supplier_closed";

export type RequestState =
  | { kind: "pending" }
  | { kind: "queried" }
  | { kind: "lapsed"; reason: LapseReason }
  | { kind: "approved" }
  | { kind: "withdrawn" }
  | { kind: "superseded" };

const REQUEST_QUOTE_SELECT = {
  id: true,
  ref: true,
  revision: true,
  status: true,
  expiresAt: true,
  businessId: true,
  enquiryId: true,
  business: { select: { closureRequestedAt: true } },
  enquiry: { select: { closesAt: true, contactReleasedToBusinessId: true } },
} as const;

type RequestQuote = Prisma.QuoteGetPayload<{ select: typeof REQUEST_QUOTE_SELECT }>;

/** A later revision from the same supplier, for each quote. One query for a page of them. */
async function laterRevisions(db: Prisma.TransactionClient, quotes: readonly RequestQuote[]): Promise<Set<string>> {
  if (quotes.length === 0) return new Set();
  const newer = await db.quote.findMany({
    where: {
      OR: quotes.map((q) => ({ enquiryId: q.enquiryId, businessId: q.businessId, revision: { gt: q.revision } })),
      status: { not: "draft" },
    },
    select: { enquiryId: true, businessId: true, revision: true },
  });
  const out = new Set<string>();
  for (const q of quotes) {
    if (newer.some((n) => n.enquiryId === q.enquiryId && n.businessId === q.businessId && n.revision > q.revision)) {
      out.add(q.id);
    }
  }
  return out;
}

export function requestState(
  status: "pending" | "queried" | "approved" | "withdrawn" | "superseded",
  quote: RequestQuote,
  revised: boolean,
  now: Date,
): RequestState {
  if (status === "approved" || status === "withdrawn" || status === "superseded") return { kind: status };
  if (quote.enquiry.contactReleasedToBusinessId) return { kind: "lapsed", reason: "accepted" };
  if (quote.enquiry.closesAt.getTime() <= now.getTime()) return { kind: "lapsed", reason: "enquiry_closed" };
  if (quote.expiresAt && quote.expiresAt.getTime() < now.getTime()) return { kind: "lapsed", reason: "quote_expired" };
  if (quote.status !== "sent" && quote.status !== "read") return { kind: "lapsed", reason: "not_open" };
  if (revised) return { kind: "lapsed", reason: "revised" };
  if (quote.business.closureRequestedAt) return { kind: "lapsed", reason: "supplier_closed" };
  return { kind: status };
}

// ── Who may approve ──────────────────────────────────────────────────────────

/** The ids of everybody who may approve this request now. Empty for a request that is not pending. */
export async function approversFor(approvalId: string, now: Date = new Date()): Promise<string[]> {
  const request = await prisma.quoteApproval.findUnique({
    where: { id: approvalId },
    select: { companyId: true, raisedById: true, quoteId: true, status: true },
  });
  if (!request || request.status !== "pending") return [];
  const gate = await assessGate(prisma, {
    companyId: request.companyId,
    raiserId: request.raisedById,
    quoteId: request.quoteId,
    now,
  });
  if (!gate || !gate.need.required) {
    // The rule was relaxed while it waited: any admin may still approve it.
    const seats = gate?.seats ?? (await companySeats(prisma, request.companyId, now)).seats;
    return seats.filter((s) => s.role === "company_admin" && s.userId !== request.raisedById).map((s) => s.userId);
  }
  return eligibleApprovers(gate.need.route, gate.seats, request.raisedById, gate.ask.valueFils).map((s) => s.userId);
}

// ── The company page ─────────────────────────────────────────────────────────

export interface TeamMemberRow {
  kind: "member";
  memberId: string;
  userId: string;
  name: string;
  email: string | null;
  isYou: boolean;
  role: BuyerCompanyRole;
  monthlyLimitAed: number | null;
  /** Committed this month, as an AED string for `formatAED`. */
  usedAed: string;
  joinedAt: Date;
  isApprover: boolean;
}

export interface TeamInviteRow {
  kind: "invite";
  inviteId: string;
  name: string;
  email: string;
  role: BuyerCompanyRole;
  monthlyLimitAed: number | null;
  state: Extract<InviteState, "invited" | "expired">;
  expiresAt: Date;
  lastSentAt: Date;
}

export interface AddressRow {
  id: string;
  label: string;
  addressLine: string;
  emirate: string;
  areaId: string | null;
  areaName: string | null;
  attnName: string | null;
  attnPhone: string | null;
  accessPoint: string | null;
  accessFrom: number | null;
  accessUntil: number | null;
  loadLimit: LoadLimit | null;
  isDefault: boolean;
}

export interface RequestCard {
  id: string;
  state: RequestState;
  enquiryId: string;
  enquiryRef: string;
  quoteRef: string;
  quoteId: string;
  revision: number;
  supplierName: string;
  lineCount: number;
  /** Null for a quote with no single total. */
  valueAed: string | null;
  proposal: ProposalFigure | null;
  reasons: ApprovalReason[];
  raisedById: string;
  raiserName: string;
  raisedAt: Date;
  poNumber: string | null;
  costCode: string | null;
  note: string | null;
  decisionNote: string | null;
  decidedByName: string | null;
  decidedAt: Date | null;
  answer: string | null;
  /** Names of everybody who may approve it now. */
  approverNames: string[];
  viewerMayApprove: boolean;
  viewerIsRaiser: boolean;
}

export interface CompanyHistoryLine {
  id: string;
  kind: string;
  actorName: string;
  subject: string | null;
  before: unknown;
  after: unknown;
  note: string | null;
  at: Date;
}

export interface CompanyAccount {
  companyId: string;
  viewer: { userId: string; memberId: string; role: BuyerCompanyRole; isAdmin: boolean };
  details: { name: string; trn: string | null; licenceNumber: string | null; accountsEmail: string | null };
  detailsChanged: { by: string; at: Date } | null;
  policy: CompanyPolicy & { thresholdAed: number | null; tellAdminsOffPlatform: boolean };
  ruleFacts: RuleFacts;
  admins: { userId: string; name: string }[];
  addresses: AddressRow[];
  team: (TeamMemberRow | TeamInviteRow)[];
  spend: { totalAed: string; withoutTotal: number; accepted: number };
  awaitingYou: RequestCard[];
  awaitingYouCount: number;
  yourRequests: RequestCard[];
  flagged: { enquiryRef: string; supplierName: string; at: Date }[];
  history: CompanyHistoryLine[];
}

function nameOf(user: { fullName: string | null; email: string | null } | null): string {
  return user?.fullName?.trim() || user?.email || "—";
}

const REQUEST_SELECT = {
  id: true,
  status: true,
  enquiryId: true,
  quoteId: true,
  quoteRevision: true,
  valueFils: true,
  reasons: true,
  raisedById: true,
  poNumber: true,
  costCode: true,
  note: true,
  decisionNote: true,
  decidedById: true,
  decidedAt: true,
  answer: true,
  createdAt: true,
  raisedBy: { select: { fullName: true, email: true } },
  decidedBy: { select: { fullName: true, email: true } },
  enquiry: { select: { ref: true } },
  quote: {
    select: {
      ...REQUEST_QUOTE_SELECT,
      business: { select: { closureRequestedAt: true, displayName: true, verificationTier: true } },
      _count: { select: { lines: true } },
      proposal: { select: PROPOSAL_FIGURE_SELECT },
    },
  },
} as const;

type RequestRow = Prisma.QuoteApprovalGetPayload<{ select: typeof REQUEST_SELECT }>;

/** Turn request rows into cards, with who may approve each one now. */
async function toCards(
  db: Prisma.TransactionClient,
  rows: readonly RequestRow[],
  viewerId: string,
  seats: readonly Seat[],
  policy: CompanyPolicy,
  names: Map<string, string>,
  now: Date,
): Promise<RequestCard[]> {
  const revised = await laterRevisions(
    db,
    rows.map((r) => r.quote),
  );
  return rows.map((row) => {
    const state = requestState(row.status, row.quote, revised.has(row.quote.id), now);
    const raiser = seats.find((s) => s.userId === row.raisedById);
    const need: ApprovalNeed = raiser
      ? approvalNeed(policy, raiser, {
          valueFils: row.valueFils,
          supplierVerified: isVerified(row.quote.business.verificationTier),
        })
      : { required: false };
    const open = state.kind === "pending";
    const approvers = open
      ? need.required
        ? eligibleApprovers(need.route, seats, row.raisedById, row.valueFils)
        : seats.filter((s) => s.role === "company_admin" && s.userId !== row.raisedById)
      : [];
    const viewerSeat = seats.find((s) => s.userId === viewerId);
    const viewerMayApprove =
      open &&
      !!viewerSeat &&
      (need.required
        ? mayApprove(need.route, viewerSeat, row.raisedById, row.valueFils)
        : viewerSeat.role === "company_admin" && viewerSeat.userId !== row.raisedById);
    return {
      id: row.id,
      state,
      enquiryId: row.enquiryId,
      enquiryRef: row.enquiry.ref,
      quoteRef: row.quote.ref,
      quoteId: row.quoteId,
      revision: row.quoteRevision,
      supplierName: row.quote.business.displayName,
      lineCount: row.quote._count.lines,
      valueAed: row.valueFils === null ? null : filsToAed(row.valueFils),
      proposal: toProposalFigure(row.quote.proposal),
      reasons: row.reasons,
      raisedById: row.raisedById,
      raiserName: nameOf(row.raisedBy),
      raisedAt: row.createdAt,
      poNumber: row.poNumber,
      costCode: row.costCode,
      note: row.note,
      decisionNote: row.decisionNote,
      decidedByName: row.decidedBy ? nameOf(row.decidedBy) : null,
      decidedAt: row.decidedAt,
      answer: row.answer,
      approverNames: approvers.map((s) => names.get(s.userId) ?? "—"),
      viewerMayApprove,
      viewerIsRaiser: row.raisedById === viewerId,
    };
  });
}

/** Everybody in the company by id, active or not, for naming them on a card. */
async function memberNames(db: Prisma.TransactionClient, companyId: string): Promise<Map<string, string>> {
  const rows = await db.buyerCompanyMember.findMany({
    where: { companyId },
    select: { userId: true, user: { select: { fullName: true, email: true } } },
    orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
  });
  return new Map(rows.map((r) => [r.userId, nameOf(r.user)]));
}

export const AWAITING_ON_CARD = 3;
export const HISTORY_ON_CARD = 5;
/** How far back the flagged-messages card looks. */
export const FLAGGED_DAYS = 90;

/**
 * Everything `/account/company` renders for this person, or null when they
 * buy for nobody — the page then offers to set a company up.
 */
export async function companyAccount(userId: string, now: Date = new Date()): Promise<CompanyAccount | null> {
  const seat = await activeMembership(prisma, userId);
  if (!seat) return null;
  const companyId = seat.companyId;

  const [company, policy, team, members, invites, addresses, names, lastDetails, history] = await Promise.all([
    prisma.buyerCompany.findUniqueOrThrow({
      where: { id: companyId },
      select: {
        name: true,
        trn: true,
        licenceNumber: true,
        accountsEmail: true,
        approvalThresholdAed: true,
        tellAdminsOffPlatform: true,
      },
    }),
    readPolicy(prisma, companyId),
    companySeats(prisma, companyId, now),
    prisma.buyerCompanyMember.findMany({
      where: { companyId, deactivatedAt: null },
      select: {
        id: true,
        userId: true,
        role: true,
        monthlyLimitAed: true,
        joinedAt: true,
        user: { select: { fullName: true, email: true } },
      },
      orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
    }),
    prisma.buyerCompanyInvite.findMany({
      where: { companyId, acceptedAt: null, revokedAt: null },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        monthlyLimitAed: true,
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true,
        lastSentAt: true,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.buyerDeliveryAddress.findMany({
      where: { companyId, archivedAt: null },
      select: {
        id: true,
        label: true,
        addressLine: true,
        emirate: true,
        areaId: true,
        area: { select: { name: true } },
        attnName: true,
        attnPhone: true,
        accessPoint: true,
        accessFrom: true,
        accessUntil: true,
        loadLimit: true,
        isDefault: true,
      },
      // The default first, then the order they were added — the board's order.
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }, { id: "asc" }],
    }),
    memberNames(prisma, companyId),
    prisma.buyerCompanyEvent.findFirst({
      where: { companyId, kind: { in: ["details_changed", "company_created"] } },
      select: { actorName: true, createdAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
    prisma.buyerCompanyEvent.findMany({
      where: { companyId },
      select: { id: true, kind: true, actorName: true, subject: true, before: true, after: true, note: true, createdAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: HISTORY_ON_CARD,
    }),
  ]);

  const isAdmin = seat.role === "company_admin";
  const approver = members.find((m) => m.userId === policy.approverId) ?? null;

  const teamRows: (TeamMemberRow | TeamInviteRow)[] = [
    ...members.map<TeamMemberRow>((m) => ({
      kind: "member",
      memberId: m.id,
      userId: m.userId,
      name: nameOf(m.user),
      email: m.user.email,
      isYou: m.userId === userId,
      role: m.role,
      monthlyLimitAed: m.monthlyLimitAed,
      usedAed: filsToAed(team.spend.byPerson.get(m.userId) ?? 0n),
      joinedAt: m.joinedAt,
      isApprover: m.userId === policy.approverId,
    })),
    ...invites.map<TeamInviteRow>((i) => ({
      kind: "invite",
      inviteId: i.id,
      name: i.fullName,
      email: i.email,
      role: i.role,
      monthlyLimitAed: i.monthlyLimitAed,
      state: inviteState(i, now) === "expired" ? "expired" : "invited",
      expiresAt: i.expiresAt,
      lastSentAt: i.lastSentAt,
    })),
  ];

  const roles = new Set<BuyerCompanyRole>([...members.map((m) => m.role), ...invites.map((i) => i.role)]);
  const ruleFacts: RuleFacts = {
    thresholdAed: company.approvalThresholdAed,
    approverName: approver ? nameOf(approver.user) : null,
    unverifiedNeedsApproval: policy.unverifiedNeedsApproval,
    requirePoNumber: policy.requirePoNumber,
    requireCostCode: policy.requireCostCode,
    hasProcurement: roles.has("procurement"),
    hasRequesters: roles.has("requester"),
    approverHasNoCover: approverHasNoCover(policy, team.seats),
  };

  // Open requests: the ones this person may decide, and their own.
  const open = await prisma.quoteApproval.findMany({
    where: { companyId, status: { in: ["pending", "queried"] } },
    select: REQUEST_SELECT,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const cards = await toCards(prisma, open, userId, team.seats, policy, names, now);
  const awaiting = cards.filter((c) => c.viewerMayApprove && c.state.kind === "pending");
  const yours = cards.filter((c) => c.viewerIsRaiser);

  const flagged =
    isAdmin
      ? await prisma.message.findMany({
          where: {
            enquiry: { buyerCompanyId: companyId },
            authorSide: "seller",
            flaggedAt: { not: null, gte: new Date(now.getTime() - FLAGGED_DAYS * 86_400_000) },
          },
          select: { flaggedAt: true, enquiry: { select: { ref: true } }, business: { select: { displayName: true } } },
          orderBy: [{ flaggedAt: "desc" }, { id: "desc" }],
          take: 5,
        })
      : [];

  return {
    companyId,
    viewer: { userId, memberId: seat.id, role: seat.role, isAdmin },
    details: { name: company.name, trn: company.trn, licenceNumber: company.licenceNumber, accountsEmail: company.accountsEmail },
    detailsChanged: lastDetails ? { by: lastDetails.actorName, at: lastDetails.createdAt } : null,
    policy: { ...policy, thresholdAed: company.approvalThresholdAed, tellAdminsOffPlatform: company.tellAdminsOffPlatform },
    ruleFacts,
    admins: members.filter((m) => m.role === "company_admin").map((m) => ({ userId: m.userId, name: nameOf(m.user) })),
    addresses: addresses.map((a) => ({
      id: a.id,
      label: a.label,
      addressLine: a.addressLine,
      emirate: a.emirate,
      areaId: a.areaId,
      areaName: a.area?.name ?? null,
      attnName: a.attnName,
      attnPhone: a.attnPhone,
      accessPoint: a.accessPoint,
      accessFrom: a.accessFrom,
      accessUntil: a.accessUntil,
      loadLimit: a.loadLimit,
      isDefault: a.isDefault,
    })),
    team: teamRows,
    spend: spendSummary(team.spend),
    awaitingYou: awaiting.slice(0, AWAITING_ON_CARD),
    awaitingYouCount: awaiting.length,
    yourRequests: yours,
    flagged: flagged.map((m) => ({ enquiryRef: m.enquiry.ref, supplierName: m.business.displayName, at: m.flaggedAt! })),
    history: history.map((h) => ({ ...h, at: h.createdAt })),
  };
}

function spendSummary(spend: MonthSpend): CompanyAccount["spend"] {
  return { totalAed: filsToAed(spend.totalFils), withoutTotal: spend.withoutTotal, accepted: spend.accepted };
}

/** How many requests wait on this person — the tab's badge. Zero for somebody with no company. */
export async function awaitingCount(userId: string, now: Date = new Date()): Promise<number> {
  const seat = await activeMembership(prisma, userId);
  if (!seat) return 0;
  const pending = await prisma.quoteApproval.findMany({
    where: { companyId: seat.companyId, status: "pending", raisedById: { not: userId } },
    select: REQUEST_SELECT,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (pending.length === 0) return 0;
  const [policy, team] = await Promise.all([readPolicy(prisma, seat.companyId), companySeats(prisma, seat.companyId, now)]);
  const cards = await toCards(prisma, pending, userId, team.seats, policy, new Map(), now);
  return cards.filter((c) => c.viewerMayApprove && c.state.kind === "pending").length;
}

// ── The approvals page ───────────────────────────────────────────────────────

export const DECIDED_PAGE = 20;

export interface ApprovalQueue {
  companyName: string;
  isAdmin: boolean;
  awaitingYou: RequestCard[];
  yours: RequestCard[];
  /** Admins see everything open; others see what they raised or may decide. */
  others: RequestCard[];
  decided: RequestCard[];
  spend: CompanyAccount["spend"];
  people: { name: string; role: BuyerCompanyRole; usedAed: string; limitAed: number | null; remainingAed: string | null }[];
}

export async function approvalQueue(userId: string, now: Date = new Date()): Promise<ApprovalQueue | null> {
  const seat = await activeMembership(prisma, userId);
  if (!seat) return null;
  const companyId = seat.companyId;
  const isAdmin = seat.role === "company_admin";
  const since = new Date(now.getTime() - 90 * 86_400_000);

  const [company, policy, team, names, open, decided] = await Promise.all([
    prisma.buyerCompany.findUniqueOrThrow({ where: { id: companyId }, select: { name: true } }),
    readPolicy(prisma, companyId),
    companySeats(prisma, companyId, now),
    memberNames(prisma, companyId),
    prisma.quoteApproval.findMany({
      where: { companyId, status: { in: ["pending", "queried"] } },
      select: REQUEST_SELECT,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.quoteApproval.findMany({
      where: {
        companyId,
        status: { in: ["approved", "withdrawn", "superseded"] },
        updatedAt: { gte: since },
        ...(isAdmin ? {} : { OR: [{ raisedById: userId }, { decidedById: userId }] }),
      },
      select: REQUEST_SELECT,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: DECIDED_PAGE,
    }),
  ]);

  const openCards = await toCards(prisma, open, userId, team.seats, policy, names, now);
  const decidedCards = await toCards(prisma, decided, userId, team.seats, policy, names, now);
  const awaitingYou = openCards.filter((c) => c.viewerMayApprove && c.state.kind === "pending");
  const yours = openCards.filter((c) => c.viewerIsRaiser);
  const others = openCards.filter(
    (c) => !c.viewerIsRaiser && !awaitingYou.includes(c) && (isAdmin || c.approverNames.length > 0),
  );

  const members = await prisma.buyerCompanyMember.findMany({
    where: { companyId, deactivatedAt: null },
    select: { userId: true, role: true, monthlyLimitAed: true },
    orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
  });

  return {
    companyName: company.name,
    isAdmin,
    awaitingYou,
    yours,
    others: isAdmin ? others : others.filter((c) => c.viewerMayApprove),
    decided: decidedCards,
    spend: spendSummary(team.spend),
    people: members.map((m) => {
      const s = team.seats.find((x) => x.userId === m.userId)!;
      const left = remainingFils(s);
      return {
        name: names.get(m.userId) ?? "—",
        role: m.role,
        usedAed: filsToAed(s.usedFils),
        limitAed: m.monthlyLimitAed,
        remainingAed: left === null ? null : filsToAed(left),
      };
    }),
  };
}

// ── One request ──────────────────────────────────────────────────────────────

export interface ApprovalDetail {
  card: RequestCard;
  companyName: string;
  requirement: string;
  lines: { id: string; description: string; qty: number | null; unitPrice: string; lineTotal: string }[];
  proposalScope: string | null;
  quote: { validityDays: number; expiresAt: Date | null; paymentTerms: string | null; delivery: string | null; supplierSlug: string; supplierVerified: boolean };
  thresholdAed: number | null;
  /** Procurement's month before this request, for the over-limit reason. */
  raiserLimit: { usedAed: string; limitAed: number } | null;
  timeline: CompanyHistoryLine[];
  viewerIsAdmin: boolean;
}

/**
 * One request, for someone entitled to see it: the raiser, whoever may
 * approve it, and the company's admins. Anybody else gets null — the same
 * answer as a request that does not exist.
 */
export async function approvalDetail(userId: string, approvalId: string, now: Date = new Date()): Promise<ApprovalDetail | null> {
  const seat = await activeMembership(prisma, userId);
  if (!seat) return null;
  const row = await prisma.quoteApproval.findFirst({
    where: { id: approvalId, companyId: seat.companyId },
    select: {
      ...REQUEST_SELECT,
      enquiry: { select: { ref: true, requirement: true } },
      quote: {
        select: {
          ...REQUEST_SELECT.quote.select,
          validityDays: true,
          paymentTerms: true,
          delivery: true,
          business: { select: { closureRequestedAt: true, displayName: true, verificationTier: true, slug: true } },
          lines: {
            select: { id: true, description: true, qty: true, unitPrice: true },
            orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          },
          proposal: { select: { ...PROPOSAL_FIGURE_SELECT, scope: true } },
        },
      },
    },
  });
  if (!row) return null;

  const [company, policy, team, names, timeline] = await Promise.all([
    prisma.buyerCompany.findUniqueOrThrow({
      where: { id: seat.companyId },
      select: { name: true, approvalThresholdAed: true },
    }),
    readPolicy(prisma, seat.companyId),
    companySeats(prisma, seat.companyId, now),
    memberNames(prisma, seat.companyId),
    prisma.buyerCompanyEvent.findMany({
      where: { companyId: seat.companyId, subject: `approval:${approvalId}` },
      select: { id: true, kind: true, actorName: true, subject: true, before: true, after: true, note: true, createdAt: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
  ]);
  const [card] = await toCards(prisma, [row as unknown as RequestRow], userId, team.seats, policy, names, now);
  if (!card) return null;
  const isAdmin = seat.role === "company_admin";
  if (!card.viewerIsRaiser && !card.viewerMayApprove && !isAdmin && row.decidedById !== userId) return null;

  const raiserSeat = team.seats.find((s) => s.userId === row.raisedById);
  const raiserLimit =
    raiserSeat && raiserSeat.role === "procurement" && raiserSeat.monthlyLimitFils !== null
      ? {
          usedAed: filsToAed(raiserSeat.usedFils),
          limitAed: Number(raiserSeat.monthlyLimitFils / 100n),
        }
      : null;

  return {
    card,
    companyName: company.name,
    requirement: row.enquiry.requirement,
    lines: row.quote.lines.map((line) => ({
      id: line.id,
      description: line.description,
      qty: line.qty,
      unitPrice: line.unitPrice.toString(),
      lineTotal: filsToAed(lineTotalFils({ qty: line.qty, unitPrice: line.unitPrice.toString() })),
    })),
    proposalScope: row.quote.proposal?.scope ?? null,
    quote: {
      validityDays: row.quote.validityDays,
      expiresAt: row.quote.expiresAt,
      paymentTerms: row.quote.paymentTerms,
      delivery: row.quote.delivery,
      supplierSlug: row.quote.business.slug,
      supplierVerified: isVerified(row.quote.business.verificationTier),
    },
    thresholdAed: company.approvalThresholdAed,
    raiserLimit,
    timeline: timeline.map((h) => ({ ...h, at: h.createdAt })),
    viewerIsAdmin: isAdmin,
  };
}

// ── History ──────────────────────────────────────────────────────────────────

export const HISTORY_PAGE = 30;

/** Newest first, a page at a time, keyed on (createdAt, id) so a page never repeats a row. */
export async function companyHistory(
  userId: string,
  cursor: { at: Date; id: string } | null,
): Promise<{ companyName: string; lines: CompanyHistoryLine[]; next: { at: Date; id: string } | null } | null> {
  const seat = await activeMembership(prisma, userId);
  if (!seat) return null;
  const [company, rows] = await Promise.all([
    prisma.buyerCompany.findUniqueOrThrow({ where: { id: seat.companyId }, select: { name: true } }),
    prisma.buyerCompanyEvent.findMany({
      where: {
        companyId: seat.companyId,
        ...(cursor
          ? { OR: [{ createdAt: { lt: cursor.at } }, { createdAt: cursor.at, id: { lt: cursor.id } }] }
          : {}),
      },
      select: { id: true, kind: true, actorName: true, subject: true, before: true, after: true, note: true, createdAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: HISTORY_PAGE + 1,
    }),
  ]);
  const page = rows.slice(0, HISTORY_PAGE);
  const last = page[page.length - 1];
  return {
    companyName: company.name,
    lines: page.map((h) => ({ ...h, at: h.createdAt })),
    next: rows.length > HISTORY_PAGE && last ? { at: last.createdAt, id: last.id } : null,
  };
}

// ── Accepting, for a company enquiry ─────────────────────────────────────────

export type AcceptanceOutlook =
  | { kind: "personal" }
  | { kind: "not_member"; companyName: string }
  | {
      kind: "company";
      companyName: string;
      policy: CompanyPolicy;
      thresholdAed: number | null;
      need: ApprovalNeed;
      /** What is left of the viewer's own authority this month. Null is unlimited. */
      remainingAed: string | null;
      usedAed: string;
      limitAed: number | null;
      role: BuyerCompanyRole;
      approverNames: string[];
      valueAed: string | null;
      /** An open request on this enquiry, whatever quote it is about. */
      openRequest: RequestCard | null;
      gap: boolean;
    };

/**
 * What accepting this quote will do for this buyer, said before they press
 * anything. A company enquiry is decided again under the lock on the click;
 * this is the promise the screen makes about that decision, from the same
 * function.
 */
export async function acceptanceOutlook(
  buyerId: string,
  enquiry: { id: string; buyerCompanyId: string | null },
  quoteId: string,
  now: Date = new Date(),
): Promise<AcceptanceOutlook> {
  if (!enquiry.buyerCompanyId) return { kind: "personal" };
  const companyId = enquiry.buyerCompanyId;
  const [company, gate, names] = await Promise.all([
    prisma.buyerCompany.findUniqueOrThrow({ where: { id: companyId }, select: { name: true, approvalThresholdAed: true } }),
    assessGate(prisma, { companyId, raiserId: buyerId, quoteId, now }),
    memberNames(prisma, companyId),
  ]);
  if (!gate) return { kind: "not_member", companyName: company.name };

  const approvers = gate.need.required
    ? eligibleApprovers(gate.need.route, gate.seats, buyerId, gate.ask.valueFils)
    : [];
  const openRow = await prisma.quoteApproval.findFirst({
    where: { enquiryId: enquiry.id, status: { in: ["pending", "queried"] } },
    select: REQUEST_SELECT,
  });
  const [openRequest] = openRow
    ? await toCards(prisma, [openRow], buyerId, gate.seats, gate.policy, names, now)
    : [];
  const left = remainingFils(gate.raiser);

  return {
    kind: "company",
    companyName: company.name,
    policy: gate.policy,
    thresholdAed: company.approvalThresholdAed,
    need: gate.need,
    remainingAed: left === null ? null : filsToAed(left),
    usedAed: filsToAed(gate.raiser.usedFils),
    limitAed: gate.raiser.monthlyLimitFils === null ? null : Number(gate.raiser.monthlyLimitFils / 100n),
    role: gate.raiser.role,
    approverNames: approvers.map((s) => names.get(s.userId) ?? "—"),
    valueAed: gate.ask.valueFils === null ? null : filsToAed(gate.ask.valueFils),
    openRequest: openRequest ?? null,
    gap: approverHasNoCover(gate.policy, gate.seats),
  };
}

/** What accepting one quote on the comparison will do, said on its row (`1n` B7). */
export interface QuoteOutlook {
  /** Accepting sends it to a colleague instead of accepting it. */
  required: boolean;
  approverNames: string[];
}

export type ComparisonOutlook =
  | { kind: "personal" }
  | { kind: "not_member"; companyName: string }
  | {
      kind: "company";
      companyName: string;
      requirePoNumber: boolean;
      requireCostCode: boolean;
      /** Per quote id. */
      quotes: Map<string, QuoteOutlook>;
    };

/**
 * Board `1n` `B7` — the company's rule, read once for every quote on the page.
 *
 * `acceptanceOutlook` answers the same question for one quote, and the accept
 * screen still asks it there before anything is pressed. A comparison of five
 * quotes asking it five times would read the policy, the team and its month five
 * times over; this reads them once and asks `approvalNeed` per quote — the same
 * pure rule the gate applies under the lock. It is a forecast for the label on
 * each row, never a decision: the click is evaluated again.
 */
export async function comparisonOutlook(
  buyerId: string,
  enquiry: { buyerCompanyId: string | null },
  quotes: readonly { id: string; valueFils: bigint | null; supplierVerified: boolean }[],
  now: Date = new Date(),
): Promise<ComparisonOutlook> {
  if (!enquiry.buyerCompanyId) return { kind: "personal" };
  const companyId = enquiry.buyerCompanyId;
  const [policy, team, names] = await Promise.all([
    readPolicy(prisma, companyId),
    companySeats(prisma, companyId, now),
    memberNames(prisma, companyId),
  ]);
  const raiser = team.seats.find((seat) => seat.userId === buyerId);
  if (!raiser) return { kind: "not_member", companyName: policy.name };

  const outlook = new Map<string, QuoteOutlook>();
  for (const quote of quotes) {
    const need = approvalNeed(policy, raiser, { valueFils: quote.valueFils, supplierVerified: quote.supplierVerified });
    outlook.set(quote.id, {
      required: need.required,
      approverNames: need.required
        ? eligibleApprovers(need.route, team.seats, buyerId, quote.valueFils).map((seat) => names.get(seat.userId) ?? "—")
        : [],
    });
  }
  return {
    kind: "company",
    companyName: policy.name,
    requirePoNumber: policy.requirePoNumber,
    requireCostCode: policy.requireCostCode,
    quotes: outlook,
  };
}

/** The open request on an enquiry, for the notice on the compare page and the thread. */
export async function openRequestOn(
  buyerId: string,
  enquiry: { id: string; buyerCompanyId: string | null },
  now: Date = new Date(),
): Promise<RequestCard | null> {
  if (!enquiry.buyerCompanyId) return null;
  const row = await prisma.quoteApproval.findFirst({
    where: { enquiryId: enquiry.id, status: { in: ["pending", "queried"] } },
    select: REQUEST_SELECT,
  });
  if (!row) return null;
  const [policy, team, names] = await Promise.all([
    readPolicy(prisma, enquiry.buyerCompanyId),
    companySeats(prisma, enquiry.buyerCompanyId, now),
    memberNames(prisma, enquiry.buyerCompanyId),
  ]);
  const [card] = await toCards(prisma, [row], buyerId, team.seats, policy, names, now);
  return card ?? null;
}

// ── Setting up ───────────────────────────────────────────────────────────────

/**
 * Invitations waiting for this person's email, for the page they see before
 * they belong to a company. Names and dates only: joining still needs the
 * link, because the link is what proves the inbox.
 */
export async function invitationsFor(userId: string, now: Date = new Date()): Promise<{ companyName: string; expiresAt: Date }[]> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const email = user?.email?.trim().toLowerCase();
  if (!email) return [];
  const rows = await prisma.buyerCompanyInvite.findMany({
    where: { email, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
    select: { expiresAt: true, company: { select: { name: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 5,
  });
  return rows.map((row) => ({ companyName: row.company.name, expiresAt: row.expiresAt }));
}

/** Every area, for the address form's area picker, filtered by emirate in the browser. */
export async function areaChoices(): Promise<{ id: string; name: string; emirate: string }[]> {
  return prisma.area.findMany({
    select: { id: true, name: true, emirate: true },
    orderBy: [{ emirate: "asc" }, { name: "asc" }, { id: "asc" }],
  });
}

/**
 * The company's saved addresses, as the enquiry composer offers them — board
 * `7b` `B6`. Empty for somebody with no company, which leaves the composer's
 * emirate and area fields exactly as they were.
 */
export async function deliveryChoicesFor(userId: string): Promise<DeliveryChoice[]> {
  const seat = await activeMembership(prisma, userId);
  if (!seat) return [];
  const rows = await prisma.buyerDeliveryAddress.findMany({
    where: { companyId: seat.companyId, archivedAt: null },
    select: {
      id: true,
      label: true,
      emirate: true,
      area: { select: { name: true } },
      accessPoint: true,
      accessFrom: true,
      accessUntil: true,
      loadLimit: true,
      isDefault: true,
    },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map((row) => {
    const constraints = {
      emirate: row.emirate,
      areaName: row.area?.name ?? null,
      accessPoint: row.accessPoint,
      accessFrom: row.accessFrom,
      accessUntil: row.accessUntil,
      loadLimit: row.loadLimit,
    };
    return {
      id: row.id,
      title: t("company.address.row_title", { label: row.label, place: placeLine(constraints) }),
      detail: constraintPhrases(constraints).slice(1).join(" · ") || placeLine(constraints),
      emirate: row.emirate,
      areaName: row.area?.name ?? null,
      isDefault: row.isDefault,
    };
  });
}
