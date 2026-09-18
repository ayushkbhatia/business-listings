import "server-only";
import type { Prisma } from "@/lib/db/generated/client";
import { monthStart } from "@/lib/enquiry/fanout";
import { isVerified } from "@/lib/verification";
import type { BuyerCompanyRole, Seat } from "./authority";
import { aedToFils } from "./authority";
import { commitmentFils } from "./value";

/**
 * Board `7b` — the few reads and writes every company path shares.
 *
 * ## The lock
 *
 * Every write to a company, and every acceptance on one of its enquiries,
 * holds `buyer_company:<id>` for its transaction. The rule, the team and the
 * month's spend are read under it, so two acceptances a second apart cannot
 * both fit under a limit that has room for one, and a threshold cannot move
 * between the gate reading it and the claim committing.
 *
 * **Lock order is enquiry, then company.** An acceptance claims the enquiry
 * row first (`acceptQuote`'s conditional update) and then takes this; a
 * settings write takes this alone. Nothing takes them the other way round, so
 * nothing waits in a cycle.
 */
export async function lockCompany(tx: Prisma.TransactionClient, companyId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`buyer_company:${companyId}`}))`;
}

export type EventKind = Prisma.BuyerCompanyEventCreateManyInput["kind"];

/**
 * One line of the company's history (`B8`), written in the caller's
 * transaction so a change and its record commit together or not at all.
 */
export async function writeCompanyEvent(
  tx: Prisma.TransactionClient,
  input: {
    companyId: string;
    actorId: string;
    kind: EventKind;
    subject?: string | null;
    before?: Prisma.InputJsonValue | null;
    after?: Prisma.InputJsonValue | null;
    note?: string | null;
    at?: Date;
  },
): Promise<void> {
  const actor = await tx.user.findUnique({
    where: { id: input.actorId },
    select: { fullName: true, email: true },
  });
  await tx.buyerCompanyEvent.create({
    data: {
      companyId: input.companyId,
      actorId: input.actorId,
      // A snapshot, so the line still says who after the account is gone.
      actorName: actor?.fullName?.trim() || actor?.email || "—",
      kind: input.kind,
      subject: input.subject ?? null,
      ...(input.before != null ? { before: input.before } : {}),
      ...(input.after != null ? { after: input.after } : {}),
      note: input.note ?? null,
      ...(input.at ? { createdAt: input.at } : {}),
    },
  });
}

export interface Membership {
  id: string;
  companyId: string;
  userId: string;
  role: BuyerCompanyRole;
  monthlyLimitAed: number | null;
}

/** This person's active seat, or null. The one read every company capability starts from. */
export async function activeMembership(db: Prisma.TransactionClient, userId: string): Promise<Membership | null> {
  const row = await db.buyerCompanyMember.findFirst({
    where: { userId, deactivatedAt: null },
    select: { id: true, companyId: true, userId: true, role: true, monthlyLimitAed: true },
  });
  return row;
}

export interface MonthSpend {
  /** Committed this month, by person: quotes they accepted, requests they approved. */
  byPerson: Map<string, bigint>;
  /** Everything the company committed this month, with a known value. */
  totalFils: bigint;
  /** Acceptances with no single total, which no figure above includes. */
  withoutTotal: number;
  /** How many quotes were accepted in all. */
  accepted: number;
}

/**
 * What the company has committed this Dubai calendar month — derived, never
 * stored (`B5`, and CLAUDE.md: a derived metric has no writable path).
 *
 * An acceptance counts against whoever's authority committed it: the approver
 * where a request was approved, the person who accepted it otherwise. The
 * month is the enquiry's `contactReleasedAt`, which is the acceptance.
 */
export async function monthSpend(db: Prisma.TransactionClient, companyId: string, now: Date): Promise<MonthSpend> {
  const since = monthStart(now);
  const rows = await db.enquiry.findMany({
    where: { buyerCompanyId: companyId, contactReleasedAt: { gte: since } },
    select: {
      buyerId: true,
      quotes: {
        where: { status: "accepted" },
        select: {
          lines: { select: { qty: true, unitPrice: true } },
          proposal: { select: { feeBasis: true, feeAed: true, mobilisationAed: true } },
        },
      },
      approvals: { where: { status: "approved" }, select: { decidedById: true } },
    },
  });

  const byPerson = new Map<string, bigint>();
  let totalFils = 0n;
  let withoutTotal = 0;
  let accepted = 0;
  for (const row of rows) {
    const quote = row.quotes[0];
    if (!quote) continue;
    accepted += 1;
    const value = commitmentFils({
      lines: quote.lines.map((line) => ({ qty: line.qty, unitPrice: line.unitPrice.toString() })),
      proposal: quote.proposal
        ? {
            feeBasis: quote.proposal.feeBasis,
            feeAed: quote.proposal.feeAed?.toString() ?? null,
            mobilisationAed: quote.proposal.mobilisationAed?.toString() ?? null,
          }
        : null,
    });
    if (value === null) {
      withoutTotal += 1;
      continue;
    }
    totalFils += value;
    const approval = row.approvals[0];
    const committer = approval ? approval.decidedById : row.buyerId;
    if (committer) byPerson.set(committer, (byPerson.get(committer) ?? 0n) + value);
  }
  return { byPerson, totalFils, withoutTotal, accepted };
}

/** Every active member as the gate reads them: role, limit, and this month so far. */
export async function companySeats(
  db: Prisma.TransactionClient,
  companyId: string,
  now: Date,
): Promise<{ seats: Seat[]; spend: MonthSpend }> {
  const [members, spend] = await Promise.all([
    db.buyerCompanyMember.findMany({
      where: { companyId, deactivatedAt: null },
      select: { userId: true, role: true, monthlyLimitAed: true },
      orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
    }),
    monthSpend(db, companyId, now),
  ]);
  return {
    seats: members.map((m) => ({
      userId: m.userId,
      role: m.role,
      monthlyLimitFils: m.monthlyLimitAed === null ? null : aedToFils(m.monthlyLimitAed),
      usedFils: spend.byPerson.get(m.userId) ?? 0n,
    })),
    spend,
  };
}

/** A quote as the gate needs it: its value and whether its supplier is verified. */
export async function quoteAsk(
  db: Prisma.TransactionClient,
  quoteId: string,
): Promise<{ valueFils: bigint | null; supplierVerified: boolean } | null> {
  const quote = await db.quote.findUnique({
    where: { id: quoteId },
    select: {
      lines: { select: { qty: true, unitPrice: true } },
      proposal: { select: { feeBasis: true, feeAed: true, mobilisationAed: true } },
      business: { select: { verificationTier: true } },
    },
  });
  if (!quote) return null;
  return {
    valueFils: commitmentFils({
      lines: quote.lines.map((line) => ({ qty: line.qty, unitPrice: line.unitPrice.toString() })),
      proposal: quote.proposal
        ? {
            feeBasis: quote.proposal.feeBasis,
            feeAed: quote.proposal.feeAed?.toString() ?? null,
            mobilisationAed: quote.proposal.mobilisationAed?.toString() ?? null,
          }
        : null,
    }),
    supplierVerified: isVerified(quote.business.verificationTier),
  };
}
