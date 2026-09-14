import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import type { Actor } from "@/lib/auth/roles";
import { getProposalComparison } from "@/lib/db/queries/proposal-comparison";
import { acceptQuote } from "@/lib/enquiry/service";
import { declineLead } from "@/lib/leads/decline";
import type { ProposalInput } from "@/lib/quote/proposal";
import { sendProposal } from "@/lib/quote/proposal-server";

/**
 * Board `1n-s` against a real database: what the comparison reads.
 *
 * The columns come back in the order the proposals arrived, never by fee (B7);
 * the header counts the suppliers who have not replied and the ones who declined
 * (B8); the response time a proposal was sent with is the sheet's at send, not
 * whatever the sheet says now; and nobody but the buyer gets the comparison.
 *
 * The file's own services and owner seats on three seeded facilities firms, and
 * a seeded buyer. Everything carries `PREFIX` and is removed at the end.
 */

const PREFIX = "1NS-COMPARISON-FIXTURE";

type Firm = { id: string; actor: Actor; serviceId: string };
let tradeId: string;
let buyerId: string;
let otherBuyerId: string;
const firms: Record<string, Firm> = {};
const seats: string[] = [];
const services: string[] = [];

async function firm(slug: string, basis: string, turnaround: string): Promise<Firm> {
  const business = await prisma.business.findUniqueOrThrow({ where: { slug }, select: { id: true } });
  const seat = await prisma.user.create({
    data: { id: randomUUID(), fullName: `${PREFIX} owner`, roles: ["seller_owner"], businessId: business.id },
    select: { id: true, roles: true },
  });
  seats.push(seat.id);
  const service = await prisma.service.create({
    data: {
      businessId: business.id,
      categoryId: tradeId,
      name: `${PREFIX} ${slug}`,
      slug: `${PREFIX.toLowerCase()}-${slug}-${Date.now().toString(36)}`,
      engagementType: "ongoing_contract",
      feeBasis: basis,
      turnaround,
      deliveredWhere: "on_site",
      scope: `${PREFIX} scope`,
      status: "live",
      position: 99,
    },
    select: { id: true },
  });
  services.push(service.id);
  return { id: business.id, actor: { id: seat.id, roles: seat.roles, businessId: business.id } as Actor, serviceId: service.id };
}

beforeAll(async () => {
  tradeId = (await prisma.category.findFirstOrThrow({ where: { slug: "hard-fm" }, select: { id: true } })).id;
  firms.month = await firm("emirates-facilities-group", "per_month", "4-hour attendance");
  firms.visit = await firm("al-shirawi-facilities", "per_visit", "Same day");
  firms.area = await firm("khansaheb-facilities", "per_sqft_yr", "6-hour attendance");
  const buyers = await prisma.user.findMany({ where: { roles: { has: "buyer" } }, orderBy: { id: "asc" }, take: 2, select: { id: true } });
  buyerId = buyers[0]!.id;
  otherBuyerId = buyers[1]!.id;
});

afterAll(async () => {
  await prisma.enquiry.deleteMany({ where: { requirement: { contains: PREFIX } } });
  await prisma.service.deleteMany({ where: { id: { in: services } } });
  await prisma.user.deleteMany({ where: { id: { in: seats } } });
  await prisma.$disconnect();
});

async function brief(label: string, recipients: Firm[], extra: string[] = []) {
  return prisma.enquiry.create({
    data: {
      ref: `ENQ-${PREFIX}-${label}-${Date.now().toString(36)}`,
      buyerId,
      requirement: `${PREFIX} ${label}`,
      emirate: "dubai",
      scale: "about 40,000 sq ft",
      closesAt: new Date(Date.now() + 5 * 86_400_000),
      lines: { create: [{ description: "Hard FM", qty: null, sortOrder: 0 }] },
      serviceBrief: { create: { categoryId: tradeId, engagementType: "ongoing_contract", cadence: "quarterly", startMode: "asap" } },
      recipients: { create: [...recipients.map((f) => ({ businessId: f.id })), ...extra.map((businessId) => ({ businessId }))] },
    },
    select: { id: true, ref: true },
  });
}

function proposal(f: Firm, fee: string): ProposalInput {
  return {
    serviceId: f.serviceId,
    fee,
    mobilisation: "",
    termMonths: "12",
    validityDays: 30,
    paymentTerms: "",
    scope: `${PREFIX} scope for this buyer`,
    deliverable: "",
    deliveredWhere: "",
    exclusions: "",
  };
}

describe("getProposalComparison", () => {
  it("returns the columns in arrival order, not fee order (B7)", async () => {
    const e = await brief("order", [firms.month!, firms.visit!, firms.area!]);
    // Most expensive first, cheapest last: an ordering by fee would reverse them.
    await sendProposal(firms.month!.actor, firms.month!.id, { enquiryId: e.id, ...proposal(firms.month!, "18,400") });
    await sendProposal(firms.visit!.actor, firms.visit!.id, { enquiryId: e.id, ...proposal(firms.visit!, "5,100") });
    await sendProposal(firms.area!.actor, firms.area!.id, { enquiryId: e.id, ...proposal(firms.area!, "5.40") });

    const comparison = await getProposalComparison(buyerId, e.ref);
    expect(comparison?.columns.map((c) => c.businessId)).toEqual([firms.month!.id, firms.visit!.id, firms.area!.id]);
    expect(comparison).toMatchObject({ engagementType: "ongoing_contract", cadence: "quarterly", scale: "about 40,000 sq ft" });
    expect(comparison?.turnaroundLabel).toBeTruthy();
    expect(comparison?.firstProposalInMs).not.toBeNull();
  });

  it("keeps the response time the proposal was sent with when the sheet changes", async () => {
    const e = await brief("snapshot", [firms.month!]);
    await sendProposal(firms.month!.actor, firms.month!.id, { enquiryId: e.id, ...proposal(firms.month!, "18,400") });
    await prisma.service.update({ where: { id: firms.month!.serviceId }, data: { turnaround: "Next working day" } });
    try {
      const comparison = await getProposalComparison(buyerId, e.id);
      expect(comparison?.columns[0]?.proposal.turnaround).toBe("4-hour attendance");
    } finally {
      await prisma.service.update({ where: { id: firms.month!.serviceId }, data: { turnaround: "4-hour attendance" } });
    }
  });

  it("counts who has not replied and who declined, and names a decline with its reason (B8)", async () => {
    const e = await brief("header", [firms.month!, firms.visit!, firms.area!]);
    await sendProposal(firms.month!.actor, firms.month!.id, { enquiryId: e.id, ...proposal(firms.month!, "18,400") });
    await declineLead(firms.visit!.actor, firms.visit!.id, { enquiryId: e.id, reason: "Call-out only" });

    const comparison = await getProposalComparison(buyerId, e.id);
    expect(comparison?.recipientCount).toBe(3);
    expect(comparison?.columns).toHaveLength(1);
    expect(comparison?.declined).toEqual([{ businessId: firms.visit!.id, displayName: expect.any(String), declineReason: "Call-out only" }]);
    expect(comparison?.waiting.map((r) => r.businessId)).toEqual([firms.area!.id]);
  });

  it("renders with no replies yet rather than refusing (§States)", async () => {
    const e = await brief("none", [firms.month!, firms.visit!]);
    const comparison = await getProposalComparison(buyerId, e.id);
    expect(comparison?.columns).toEqual([]);
    expect(comparison?.waiting).toHaveLength(2);
  });

  it("marks the accepted column and declines the rest once the buyer accepts (B9)", async () => {
    const e = await brief("accepted", [firms.month!, firms.visit!]);
    const sent = await sendProposal(firms.month!.actor, firms.month!.id, { enquiryId: e.id, ...proposal(firms.month!, "18,400") });
    await sendProposal(firms.visit!.actor, firms.visit!.id, { enquiryId: e.id, ...proposal(firms.visit!, "5,100") });
    if (!sent.ok) throw new Error("send failed");
    expect(await acceptQuote(buyerId, sent.quoteId)).toMatchObject({ ok: true, declined: 1 });

    const comparison = await getProposalComparison(buyerId, e.id);
    expect(comparison?.acceptedBusinessId).toBe(firms.month!.id);
    expect(comparison?.columns.map((c) => c.state)).toEqual(["accepted", "declined"]);
    expect(comparison?.waiting).toEqual([]);
  });

  it("marks a proposal past its window as expired, and keeps it", async () => {
    const e = await brief("expired", [firms.month!]);
    const sent = await sendProposal(firms.month!.actor, firms.month!.id, { enquiryId: e.id, ...proposal(firms.month!, "18,400") });
    if (!sent.ok) throw new Error("send failed");
    await prisma.quote.update({ where: { id: sent.quoteId }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    const comparison = await getProposalComparison(buyerId, e.id);
    expect(comparison?.columns[0]?.state).toBe("expired");
  });

  it("is null for another buyer, and for an enquiry for things", async () => {
    const e = await brief("private", [firms.month!]);
    expect(await getProposalComparison(otherBuyerId, e.id)).toBeNull();

    const goods = await prisma.enquiry.create({
      data: {
        ref: `ENQ-${PREFIX}-goods-${Date.now().toString(36)}`,
        buyerId,
        requirement: `${PREFIX} goods`,
        closesAt: new Date(Date.now() + 86_400_000),
        lines: { create: [{ description: "Gate valve", qty: 4, sortOrder: 0 }] },
      },
      select: { id: true },
    });
    expect(await getProposalComparison(buyerId, goods.id)).toBeNull();
  });
});
