import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import type { Actor } from "@/lib/auth/roles";
import { getAcceptedRecord } from "@/lib/db/queries/accepted-record";
import { reportAcceptedQuote, setBuyerReference } from "@/lib/enquiry/accepted-record-server";
import { acceptQuote } from "@/lib/enquiry/service";
import { saveDraft } from "@/lib/quote/draft";
import { sendQuoteForBusiness, type SendQuoteInput } from "@/lib/quote/send-quote";
import { extendQuote } from "@/lib/quotes/extend";
import { reportEvidence, resolveReport } from "@/lib/reports/service";

/**
 * Board `7c` against a real database: the fence, the accept, the record and the
 * two things a buyer may write on it.
 *
 * ## Why these are integration tests
 *
 * The defect was a transaction-shaped one. `sendQuoteForBusiness` read the
 * enquiry, judged it open, and wrote — so a buyer's accept committing between
 * the read and the write left a quote on an accepted enquiry. Only Postgres can
 * show that the row lock settles it, and only Prisma can show what the record
 * query actually selects.
 *
 * ## Fixtures
 *
 * Two Pro sellers with owner seats, so no monthly cap moves under the file, and
 * a buyer of the file's own. Every enquiry carries `PREFIX` in its requirement
 * and is deleted by that.
 */

const PREFIX = "7C-RECORD-FIXTURE";

let buyerId: string;
let otherBuyerId: string;
let a: { id: string; actor: Actor };
let b: { id: string; actor: Actor };
const created: string[] = [];

async function seller(slug: string) {
  const business = await prisma.business.findFirstOrThrow({ where: { slug }, select: { id: true } });
  const seat = await prisma.user.findFirstOrThrow({
    where: { businessId: business.id, roles: { has: "seller_owner" } },
    orderBy: { id: "asc" },
    select: { id: true, roles: true },
  });
  return { id: business.id, actor: { id: seat.id, roles: seat.roles, businessId: business.id } as Actor };
}

beforeAll(async () => {
  a = await seller("al-waha-industrial-supplies");
  b = await seller("copperfield-industrial-supplies-llc");
  const buyers = await prisma.user.findMany({
    where: { roles: { has: "buyer" } },
    orderBy: { id: "asc" },
    select: { id: true },
    take: 2,
  });
  buyerId = buyers[0]!.id;
  otherBuyerId = buyers[1]!.id;
});

afterEach(async () => {
  const ids = created.splice(0);
  if (ids.length > 0) await prisma.enquiry.deleteMany({ where: { id: { in: ids } } });
});

afterAll(async () => {
  await prisma.enquiry.deleteMany({ where: { requirement: { contains: PREFIX } } });
  await prisma.$disconnect();
});

/** An open enquiry sent to both sellers, with one line. */
async function enquiry(label: string) {
  const row = await prisma.enquiry.create({
    data: {
      ref: `ENQ-${PREFIX}-${label}-${Date.now().toString(36)}`,
      buyerId,
      requirement: `${PREFIX} ${label} — grooved couplings for a riser.`,
      closesAt: new Date(Date.now() + 5 * 86_400_000),
      lines: { create: [{ description: `${PREFIX} coupling`, qty: 10, unit: "pcs", sortOrder: 0 }] },
      recipients: { create: [{ businessId: a.id }, { businessId: b.id }] },
    },
    select: { id: true, ref: true, lines: { select: { id: true } } },
  });
  created.push(row.id);
  return row;
}

function input(e: Awaited<ReturnType<typeof enquiry>>, price = "40.00"): SendQuoteInput {
  return {
    enquiryId: e.id,
    note: "",
    validityDays: 14,
    paymentTerms: "net_30",
    delivery: "included",
    lines: [{ enquiryLineId: e.lines[0]!.id, productId: null, description: `${PREFIX} coupling`, qty: 10, unitPrice: price, leadTimeDays: 3 }],
  };
}

async function quoted(label: string) {
  const e = await enquiry(label);
  const fromA = await sendQuoteForBusiness(a.actor, a.id, input(e, "40.00"));
  const fromB = await sendQuoteForBusiness(b.actor, b.id, input(e, "42.00"));
  if (!fromA.ok || !fromB.ok) throw new Error("fixture quotes did not send");
  return { e, quoteA: fromA.quoteId, quoteB: fromB.quoteId };
}

/* ── The fence ─────────────────────────────────────────────────────────────── */

describe("sending a quote after acceptance — the 7c fix", () => {
  it("refuses a losing supplier, writes no quote, and leaves them declined", async () => {
    const { e, quoteA } = await quoted("loser");
    expect(await acceptQuote(buyerId, quoteA)).toMatchObject({ ok: true });

    const before = await prisma.quote.count({ where: { enquiryId: e.id } });
    const result = await sendQuoteForBusiness(b.actor, b.id, input(e, "30.00"));

    expect(result).toMatchObject({ ok: false });
    expect(await prisma.quote.count({ where: { enquiryId: e.id } })).toBe(before);
    const recipient = await prisma.enquiryRecipient.findUniqueOrThrow({
      where: { enquiryId_businessId: { enquiryId: e.id, businessId: b.id } },
      select: { state: true },
    });
    // The defect flipped this back to `quoted`.
    expect(recipient.state).toBe("declined");
  });

  it("refuses the winner a revision: the accepted quote is the last row", async () => {
    const { e, quoteA } = await quoted("winner");
    await acceptQuote(buyerId, quoteA);
    const result = await sendQuoteForBusiness(a.actor, a.id, input(e, "39.00"));
    expect(result).toMatchObject({ ok: false });
    expect(await prisma.quote.count({ where: { enquiryId: e.id, businessId: a.id } })).toBe(1);
  });

  it("refuses a suspended listing, and a lead the seller marked", async () => {
    const e = await enquiry("suspended");
    await prisma.business.update({ where: { id: b.id }, data: { suspendedAt: new Date() } });
    try {
      expect(await sendQuoteForBusiness(b.actor, b.id, input(e))).toMatchObject({ ok: false });
    } finally {
      await prisma.business.update({ where: { id: b.id }, data: { suspendedAt: null } });
    }

    await prisma.enquiryRecipient.update({
      where: { enquiryId_businessId: { enquiryId: e.id, businessId: a.id } },
      data: { outcome: "lost", outcomeAt: new Date() },
    });
    expect(await sendQuoteForBusiness(a.actor, a.id, input(e))).toMatchObject({ ok: false });
  });

  it("refuses a closed enquiry that nobody accepted, and says it closed", async () => {
    const e = await enquiry("closed");
    await prisma.enquiry.update({ where: { id: e.id }, data: { closesAt: new Date(Date.now() - 60_000) } });
    expect(await sendQuoteForBusiness(a.actor, a.id, input(e))).toEqual({
      ok: false,
      error: expect.stringContaining("can no longer be sent"),
    });
  });

  it("stores the terms the seller quoted, and null for what they left unstated", async () => {
    const e = await enquiry("terms");
    const stated = await sendQuoteForBusiness(a.actor, a.id, input(e));
    const unstated = await sendQuoteForBusiness(b.actor, b.id, {
      ...input(e),
      paymentTerms: "not-a-term",
      delivery: null,
    });
    if (!stated.ok || !unstated.ok) throw new Error("quotes did not send");
    const rows = await prisma.quote.findMany({
      where: { id: { in: [stated.quoteId, unstated.quoteId] } },
      select: { id: true, paymentTerms: true, delivery: true },
    });
    expect(rows.find((r) => r.id === stated.quoteId)).toMatchObject({ paymentTerms: "net_30", delivery: "included" });
    expect(rows.find((r) => r.id === unstated.quoteId)).toMatchObject({ paymentTerms: null, delivery: null });
  });

  it("lets exactly one of an accept and a send race win, never both", async () => {
    for (let round = 0; round < 4; round += 1) {
      const { e, quoteA } = await quoted(`race-${round}`);
      const [accept, send] = await Promise.all([
        acceptQuote(buyerId, quoteA),
        sendQuoteForBusiness(b.actor, b.id, input(e, "20.00")),
      ]);
      expect(accept.ok).toBe(true);

      const late = await prisma.quote.findMany({
        where: { enquiryId: e.id, businessId: b.id },
        select: { status: true },
      });
      if (send.ok) {
        // The send committed first; the accept then treated it like every
        // other supplier's quote.
        expect(late.every((q) => q.status === "lost")).toBe(true);
      } else {
        expect(late).toHaveLength(1);
      }
      const recipient = await prisma.enquiryRecipient.findUniqueOrThrow({
        where: { enquiryId_businessId: { enquiryId: e.id, businessId: b.id } },
        select: { state: true },
      });
      expect(recipient.state).toBe("declined");
    }
  });

  it("refuses autosave on an accepted enquiry", async () => {
    const { e, quoteA } = await quoted("draft");
    await acceptQuote(buyerId, quoteA);
    const draft = await saveDraft(b.actor, b.id, { ...input(e), lines: input(e).lines });
    expect(draft).toMatchObject({ ok: false, error: "fenced", reason: "accepted_elsewhere" });
    expect(await prisma.quote.count({ where: { enquiryId: e.id, status: "draft" } })).toBe(0);
  });

  it("refuses extending a quote on an enquiry accepted elsewhere", async () => {
    const { e, quoteA, quoteB } = await quoted("extend");
    await acceptQuote(buyerId, quoteA);
    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: quoteB }, select: { expiresAt: true } });
    const result = await extendQuote(b.actor, b.id, {
      quoteId: quoteB,
      until: new Date(quote.expiresAt!.getTime() + 3 * 86_400_000),
    });
    expect(result).toMatchObject({ ok: false, error: "decided" });
    void e;
  });
});

/* ── Accepting ─────────────────────────────────────────────────────────────── */

describe("accepting", () => {
  it("releases contact to exactly one supplier when two accepts race — B3", async () => {
    const { e, quoteA, quoteB } = await quoted("double");
    const results = await Promise.all([acceptQuote(buyerId, quoteA), acceptQuote(buyerId, quoteB)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ error: "already_accepted" });
    expect(await prisma.quote.count({ where: { enquiryId: e.id, status: "accepted" } })).toBe(1);
  });

  it("refuses a revision the supplier has since replaced", async () => {
    const e = await enquiry("revised");
    const r1 = await sendQuoteForBusiness(a.actor, a.id, input(e, "40.00"));
    const r2 = await sendQuoteForBusiness(a.actor, a.id, input(e, "38.00"));
    if (!r1.ok || !r2.ok) throw new Error("revisions did not send");

    expect(await acceptQuote(buyerId, r1.quoteId)).toMatchObject({ ok: false, error: "revised" });
    // Rolled back with it: the enquiry is still open.
    const row = await prisma.enquiry.findUniqueOrThrow({ where: { id: e.id }, select: { contactReleasedToBusinessId: true } });
    expect(row.contactReleasedToBusinessId).toBeNull();
    expect(await acceptQuote(buyerId, r2.quoteId)).toMatchObject({ ok: true });
  });

  it("refuses a quote the sweep has expired, and a draft by id", async () => {
    const { quoteA, quoteB } = await quoted("not-open");
    await prisma.quote.update({ where: { id: quoteA }, data: { status: "expired" } });
    expect(await acceptQuote(buyerId, quoteA)).toMatchObject({ ok: false, error: "not_open" });

    await prisma.quote.update({ where: { id: quoteB }, data: { status: "draft" } });
    expect(await acceptQuote(buyerId, quoteB)).toMatchObject({ ok: false, error: "not_found" });
  });
});

/* ── The record ────────────────────────────────────────────────────────────── */

describe("getAcceptedRecord", () => {
  it("is null until acceptance, and for anybody but the buyer — B6", async () => {
    const { e, quoteA } = await quoted("gate");
    expect(await getAcceptedRecord(buyerId, e.id)).toBeNull();
    await acceptQuote(buyerId, quoteA);
    expect(await getAcceptedRecord(buyerId, e.ref)).not.toBeNull();
    expect(await getAcceptedRecord(otherBuyerId, e.id)).toBeNull();
  });

  it("reads the accepted quote's lines, total, terms and the declined count", async () => {
    const { e, quoteA } = await quoted("content");
    await acceptQuote(buyerId, quoteA);
    const record = await getAcceptedRecord(buyerId, e.id);
    expect(record).toMatchObject({
      declinedCount: 1,
      quote: { id: quoteA, paymentTerms: "net_30", delivery: "included", totalAed: "400.00" },
      supplier: { id: a.id },
      report: { kind: "none" },
      review: { kind: "none" },
    });
    expect(record!.quote.lines[0]).toMatchObject({ lineTotal: "400.00", manual: true, sku: null });
  });

  it("takes commitments from the supplier's own typed messages only", async () => {
    const { e, quoteA } = await quoted("commitments");
    await acceptQuote(buyerId, quoteA);
    const base = Date.now() - 3_600_000;
    await prisma.message.createMany({
      data: [
        { enquiryId: e.id, businessId: a.id, senderId: buyerId, body: "Please deliver on Thursday.", createdAt: new Date(base) },
        { enquiryId: e.id, businessId: a.id, senderId: a.actor.id, body: "Confirmed. Delivery on Thursday morning.", createdAt: new Date(base + 1000) },
        { enquiryId: e.id, businessId: a.id, senderId: a.actor.id, body: "Following up in 2 days.", automatic: true, createdAt: new Date(base + 2000) },
        { enquiryId: e.id, businessId: a.id, senderId: a.actor.id, body: "Pay the IBAN within 2 days.", flaggedAt: new Date(), createdAt: new Date(base + 3000) },
        // The other supplier's thread is about another business.
        { enquiryId: e.id, businessId: b.id, senderId: b.actor.id, body: "We could do it tomorrow.", createdAt: new Date(base + 4000) },
      ],
    });
    const record = await getAcceptedRecord(buyerId, e.id);
    expect(record!.commitments.map((c) => c.text)).toEqual(["Delivery on Thursday morning."]);
  });

  it("names the branch of the seat the lead was routed to — step 3.4", async () => {
    const { e, quoteA } = await quoted("branch");
    const branches = await prisma.location.findMany({
      where: { businessId: a.id, published: true },
      orderBy: { id: "desc" },
      select: { id: true, addressLine: true },
    });
    if (branches.length === 0) return; // the seed gives this seller at least one; guard rather than fake one
    const routedTo = branches[0]!;
    const seat = await prisma.user.findUniqueOrThrow({ where: { id: a.actor.id }, select: { branchId: true } });
    await prisma.user.update({ where: { id: a.actor.id }, data: { branchId: routedTo.id } });
    try {
      await prisma.enquiryRecipient.update({
        where: { enquiryId_businessId: { enquiryId: e.id, businessId: a.id } },
        data: { assignedToId: a.actor.id, assignedAt: new Date() },
      });
      await acceptQuote(buyerId, quoteA);
      const record = await getAcceptedRecord(buyerId, e.id);
      expect(record!.supplier.location?.addressLine).toBe(routedTo.addressLine);
    } finally {
      await prisma.user.update({ where: { id: a.actor.id }, data: { branchId: seat.branchId } });
    }
  });
});

/* ── The buyer's two writes ────────────────────────────────────────────────── */

describe("setBuyerReference", () => {
  it("sets, normalises and clears the buyer's own reference, only once accepted", async () => {
    const { e, quoteA } = await quoted("reference");
    expect(await setBuyerReference({ buyerId, refOrId: e.id, value: "PO-1" })).toMatchObject({ ok: false, error: "not_found" });

    await acceptQuote(buyerId, quoteA);
    expect(await setBuyerReference({ buyerId, refOrId: e.ref, value: "  PO-2026   0418 " })).toEqual({
      ok: true,
      buyerReference: "PO-2026 0418",
    });
    expect((await getAcceptedRecord(buyerId, e.id))!.buyerReference).toBe("PO-2026 0418");

    expect(await setBuyerReference({ buyerId, refOrId: e.id, value: "x".repeat(41) })).toMatchObject({ error: "too_long" });
    expect(await setBuyerReference({ buyerId, refOrId: e.id, value: "PO\t1" })).toMatchObject({ error: "invalid" });
    expect(await setBuyerReference({ buyerId: otherBuyerId, refOrId: e.id, value: "PO-9" })).toMatchObject({ error: "not_found" });

    expect(await setBuyerReference({ buyerId, refOrId: e.id, value: "   " })).toEqual({ ok: true, buyerReference: null });
  });

  it("is held to 40 characters by the database too", async () => {
    const e = await enquiry("check");
    await expect(
      prisma.enquiry.update({ where: { id: e.id }, data: { buyerReference: "x".repeat(41) } }),
    ).rejects.toThrow();
  });
});

describe("reportAcceptedQuote — B8", () => {
  it("files one report with the thread attached, and the second is told it exists", async () => {
    const { e, quoteA } = await quoted("report");
    await acceptQuote(buyerId, quoteA);

    expect(await reportAcceptedQuote({ buyerId, refOrId: e.id, detail: "short" })).toMatchObject({ error: "too_short" });
    expect(
      await reportAcceptedQuote({ buyerId: otherBuyerId, refOrId: e.id, detail: "Nothing arrived on the agreed date at all." }),
    ).toMatchObject({ error: "not_found" });

    const filed = await reportAcceptedQuote({ buyerId, refOrId: e.id, detail: "Nothing arrived on the agreed date at all." });
    expect(filed.ok).toBe(true);
    const again = await reportAcceptedQuote({ buyerId, refOrId: e.id, detail: "Still nothing, a week after the agreed date." });
    expect(again).toMatchObject({ ok: false, error: "already_reported" });

    const report = await prisma.supplierReport.findUniqueOrThrow({
      where: { enquiryId: e.id },
      select: { id: true, kind: true, subjectBusinessId: true, reporterId: true, outcome: true },
    });
    expect(report).toMatchObject({ kind: "accepted_quote", subjectBusinessId: a.id, reporterId: buyerId, outcome: null });
    expect((await getAcceptedRecord(buyerId, e.id))!.report).toMatchObject({ kind: "open" });

    // The trust team reads the thread between the buyer and this supplier only.
    await prisma.message.create({ data: { enquiryId: e.id, businessId: b.id, senderId: b.actor.id, body: "Other thread" } });
    await prisma.message.create({ data: { enquiryId: e.id, businessId: a.id, senderId: a.actor.id, body: "Our thread" } });
    const evidence = await reportEvidence(report.id);
    expect(evidence!.messages.map((m) => m.body)).toEqual(["Our thread"]);
    expect(evidence!.quote).toMatchObject({ revision: 1 });

    // Resolved in the ordinary queue, with a reason — and the record shows it.
    const opsLead = await prisma.user.findFirstOrThrow({
      where: { roles: { has: "staff_ops_lead" } },
      select: { id: true, roles: true },
    });
    const resolved = await resolveReport({
      actor: { id: opsLead.id, roles: opsLead.roles } as Actor,
      reportId: report.id,
      outcome: "seller_corrected",
      reason: "Replacement delivered and confirmed by the buyer in the thread.",
    });
    expect(resolved).toEqual({ ok: true });
    expect((await getAcceptedRecord(buyerId, e.id))!.report).toMatchObject({
      kind: "resolved",
      outcome: "seller_corrected",
      reason: "Replacement delivered and confirmed by the buyer in the thread.",
    });

    await prisma.supplierReport.delete({ where: { id: report.id } });
  });
});
