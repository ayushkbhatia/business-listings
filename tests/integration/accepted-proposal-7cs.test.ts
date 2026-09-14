import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import type { Actor } from "@/lib/auth/roles";
import { getAcceptedRecord } from "@/lib/db/queries/accepted-record";
import { getProposalComparison } from "@/lib/db/queries/proposal-comparison";
import { acceptQuote } from "@/lib/enquiry/service";
import type { ProposalInput } from "@/lib/quote/proposal";
import { findProposalDraft, saveProposalDraft, sendProposal } from "@/lib/quote/proposal-server";
import { reviewsBoard } from "@/lib/reviews/board";
import { createReview, enquiryForReview, requestReview } from "@/lib/reviews/service";

/**
 * Board `7c-s` against a real database: what only Postgres can show.
 *
 * That the payment terms a proposal is sent with reach the record (the column
 * `3j-s` left empty); that an accepted quote's terms and the brief its dates come
 * from cannot be edited afterwards, by anybody (AC8); that the record reads the
 * engagement it is the record of; and that a review of an engagement waits for
 * its first cycle at the write, not only on the page (B10).
 *
 * The file's own service, owner seat and buyer on seeded facilities firms.
 * Everything carries `PREFIX` and is removed at the end.
 */

const PREFIX = "7CS-ACCEPTED-FIXTURE";
const DAY = 86_400_000;

type Firm = { id: string; actor: Actor; serviceId: string; serviceSlug: string };
let tradeId: string;
let buyerId: string;
const firms: Record<string, Firm> = {};
const users: string[] = [];
const services: string[] = [];

async function firm(slug: string, basis: string): Promise<Firm> {
  const business = await prisma.business.findUniqueOrThrow({ where: { slug }, select: { id: true } });
  const seat = await prisma.user.create({
    data: { id: randomUUID(), fullName: `${PREFIX} owner`, roles: ["seller_owner"], businessId: business.id },
    select: { id: true, roles: true },
  });
  users.push(seat.id);
  const serviceSlug = `${PREFIX.toLowerCase()}-${slug}-${Date.now().toString(36)}`;
  const service = await prisma.service.create({
    data: {
      businessId: business.id,
      categoryId: tradeId,
      name: `${PREFIX} ${slug}`,
      slug: serviceSlug,
      engagementType: "ongoing_contract",
      feeBasis: basis,
      turnaround: "4-hour attendance",
      deliveredWhere: "on_site",
      scope: `${PREFIX} scope`,
      status: "live",
      position: 99,
    },
    select: { id: true },
  });
  services.push(service.id);
  return {
    id: business.id,
    actor: { id: seat.id, roles: seat.roles, businessId: business.id } as Actor,
    serviceId: service.id,
    serviceSlug,
  };
}

beforeAll(async () => {
  tradeId = (await prisma.category.findFirstOrThrow({ where: { slug: "hard-fm" }, select: { id: true } })).id;
  firms.month = await firm("emirates-facilities-group", "per_month");
  firms.visit = await firm("al-shirawi-facilities", "per_visit");
  // A buyer of the file's own, so no seeded review request can hide one from the seller's list.
  const buyer = await prisma.user.create({
    data: { id: randomUUID(), fullName: `${PREFIX} buyer`, phone: `+97150${Date.now().toString().slice(-7)}`, roles: ["buyer"] },
    select: { id: true },
  });
  users.push(buyer.id);
  buyerId = buyer.id;
});

afterAll(async () => {
  await prisma.reviewRequest.deleteMany({ where: { buyerId } });
  await prisma.enquiry.deleteMany({ where: { requirement: { contains: PREFIX } } });
  await prisma.service.deleteMany({ where: { id: { in: services } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

async function brief(
  label: string,
  recipients: Firm[],
  start: { startMode: "asap" } | { startMode: "from_date"; startsOn: Date } = { startMode: "asap" },
) {
  return prisma.enquiry.create({
    data: {
      ref: `ENQ-${PREFIX}-${label}-${Date.now().toString(36)}`,
      buyerId,
      requirement: `${PREFIX} ${label}`,
      emirate: "dubai",
      closesAt: new Date(Date.now() + 5 * DAY),
      lines: { create: [{ description: "Hard FM", qty: null, sortOrder: 0 }] },
      serviceBrief: {
        create: { categoryId: tradeId, engagementType: "ongoing_contract", cadence: "quarterly", building: "Tower B", ...start },
      },
      recipients: { create: recipients.map((f) => ({ businessId: f.id })) },
    },
    select: { id: true, ref: true },
  });
}

function proposal(f: Firm, overrides: Partial<ProposalInput> = {}): ProposalInput {
  return {
    serviceId: f.serviceId,
    fee: "18,400",
    mobilisation: "6,000",
    termMonths: "24",
    validityDays: 30,
    paymentTerms: "in_arrears",
    scope: `${PREFIX} scope for this buyer`,
    deliverable: "Monthly report",
    deliveredWhere: "On site",
    exclusions: `${PREFIX} major plant replacement`,
    ...overrides,
  };
}

async function acceptedContract(label: string, start?: Date, acceptedAt = new Date()) {
  const e = await brief(label, [firms.month!, firms.visit!], start ? { startMode: "from_date", startsOn: start } : undefined);
  const sent = await sendProposal(firms.month!.actor, firms.month!.id, { enquiryId: e.id, ...proposal(firms.month!) });
  await sendProposal(firms.visit!.actor, firms.visit!.id, { enquiryId: e.id, ...proposal(firms.visit!, { fee: "850" }) });
  if (!sent.ok) throw new Error(`send failed: ${sent.error}`);
  const accepted = await acceptQuote(buyerId, sent.quoteId, acceptedAt);
  if (!accepted.ok) throw new Error(`accept failed: ${accepted.error}`);
  return { ...e, quoteId: sent.quoteId };
}

const utcDay = (at: Date) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));

/* ── Payment terms, which `3j-s` had no field for ─────────────────────────── */

describe("a proposal's payment terms", () => {
  it("are kept by the draft and sent on the quote, where the record reads them", async () => {
    const e = await brief("payment", [firms.month!]);
    await saveProposalDraft(firms.month!.actor, firms.month!.id, { enquiryId: e.id, ...proposal(firms.month!, { paymentTerms: "on_completion" }) });
    expect((await findProposalDraft(e.id, firms.month!.id))?.paymentTerms).toBe("on_completion");

    const sent = await sendProposal(firms.month!.actor, firms.month!.id, { enquiryId: e.id, ...proposal(firms.month!) });
    if (!sent.ok) throw new Error("send failed");
    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: sent.quoteId }, select: { paymentTerms: true } });
    expect(quote.paymentTerms).toBe("in_arrears");
    expect((await getProposalComparison(buyerId, e.id))?.columns[0]?.quote.paymentTerms).toBe("in_arrears");
  });

  it("are not stated, rather than refused or defaulted, for a value outside the proposal's list", async () => {
    const e = await brief("payment-unknown", [firms.month!]);
    const sent = await sendProposal(firms.month!.actor, firms.month!.id, { enquiryId: e.id, ...proposal(firms.month!, { paymentTerms: "lc" }) });
    if (!sent.ok) throw new Error("send failed");
    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: sent.quoteId }, select: { paymentTerms: true } });
    expect(quote.paymentTerms).toBeNull();
  });
});

/* ── The record ────────────────────────────────────────────────────────────── */

describe("getAcceptedRecord for an accepted proposal", () => {
  it("reads the engagement: the brief, the site, the trade's turnaround label, the live service and the payment", async () => {
    const start = utcDay(new Date(Date.now() + 40 * DAY));
    const e = await acceptedContract("record", start);
    const record = await getAcceptedRecord(buyerId, e.ref);

    expect(record?.quote.lines).toEqual([]);
    expect(record?.quote.paymentTerms).toBe("in_arrears");
    expect(record?.quote.proposal).toMatchObject({ feeBasis: "per_month", termMonths: 24, exclusions: `${PREFIX} major plant replacement` });
    expect(record?.work).toMatchObject({
      brief: { engagementType: "ongoing_contract", cadence: "quarterly", startMode: "from_date", startsOn: start },
      site: { building: "Tower B", emirate: "dubai" },
      tradeSlug: "hard-fm",
      serviceSlug: firms.month!.serviceSlug,
    });
    expect(record?.work?.turnaroundLabel).toBeTruthy();
    // AC7, as the record reads it: released to one, the other declined by this acceptance.
    expect(record?.declinedCount).toBe(1);
  });

  it("has no work for a goods quote", async () => {
    const goods = await prisma.enquiry.findFirst({
      where: { contactReleasedToBusinessId: { not: null }, serviceBrief: null, quotes: { some: { status: "accepted", proposal: null } } },
      orderBy: { id: "asc" },
      select: { id: true, buyerId: true },
    });
    if (!goods) return;
    expect((await getAcceptedRecord(goods.buyerId, goods.id))?.work).toBeNull();
  });
});

/* ── AC8 — immutable after acceptance, for both parties ────────────────────── */

describe("an accepted record cannot be edited", () => {
  it("refuses a change to the accepted quote's terms, by trigger", async () => {
    const e = await acceptedContract("terms-fixed");
    await expect(prisma.quote.update({ where: { id: e.quoteId }, data: { paymentTerms: "advance" } })).rejects.toThrow(/accepted/);
    await expect(prisma.quote.update({ where: { id: e.quoteId }, data: { expiresAt: new Date() } })).rejects.toThrow(/accepted/);
    await expect(prisma.quote.update({ where: { id: e.quoteId }, data: { status: "lost" } })).rejects.toThrow(/accepted/);
    await expect(
      prisma.quoteProposal.update({ where: { quoteId: e.quoteId }, data: { exclusions: "nothing" } }),
    ).rejects.toThrow();
  });

  it("refuses a change to the brief its dates come from, and allows one before acceptance", async () => {
    const e = await acceptedContract("brief-fixed", utcDay(new Date(Date.now() + 30 * DAY)));
    await expect(
      prisma.serviceBrief.update({ where: { enquiryId: e.id }, data: { startsOn: utcDay(new Date(Date.now() + 90 * DAY)) } }),
    ).rejects.toThrow(/accepted/);

    const open = await brief("brief-open", [firms.month!]);
    await expect(prisma.serviceBrief.update({ where: { enquiryId: open.id }, data: { building: "Tower C" } })).resolves.toBeTruthy();
  });
});

/* ── B10 — the review waits for the first cycle, at the write ─────────────── */

describe("reviewing an engagement", () => {
  it("opens a quarter after the start, and the write refuses before then", async () => {
    const start = utcDay(new Date(Date.now() + 20 * DAY));
    const e = await acceptedContract("review-waits", start);

    const gate = await enquiryForReview(e.id);
    const opens = gate?.reviewOpensOn;
    expect(opens?.getUTCMonth()).toBe((start.getUTCMonth() + 3) % 12);

    const refused = await createReview({
      buyerId,
      enquiryId: e.id,
      ratings: { overall: 5, quotedAccurate: 5, onTime: 5, asDescribed: 5, responsiveness: 5 },
      body: "Too early to say anything about the work.",
    });
    expect(refused).toEqual({ ok: false, error: "not_yet_open" });
    expect(await prisma.review.count({ where: { enquiryId: e.id } })).toBe(0);

    expect(await requestReview({ businessId: firms.month!.id, enquiryId: e.id })).toEqual({ ok: false, error: "not_yet_open" });
  });

  it("lists an engagement whose review has opened on the seller's board, and not one still waiting", async () => {
    const waiting = await acceptedContract("board-waiting", utcDay(new Date(Date.now() + 20 * DAY)));
    // Accepted 150 days ago to start at once: reviews opened about 60 days ago, inside the window.
    const opened = await acceptedContract("board-opened", undefined, new Date(Date.now() - 150 * DAY));

    expect((await enquiryForReview(opened.id))?.reviewOpensOn?.getTime()).toBeLessThan(Date.now());
    const board = await reviewsBoard(firms.month!.actor, firms.month!.id);
    const askable = board.askable.map((row) => row.enquiryId);
    expect(askable).toContain(opened.id);
    expect(askable).not.toContain(waiting.id);
  });
});
