import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import type { Actor } from "@/lib/auth/roles";
import { approveRequest, requestSplitApproval } from "@/lib/buyer-company/approvals";
import { approversFor } from "@/lib/buyer-company/queue";
import { createCompany, setRuleFlag } from "@/lib/buyer-company/service";
import { monthSpend } from "@/lib/buyer-company/store";
import { getReviewBoard } from "@/lib/db/queries";
import { getAcceptedRecord, getAcceptedRecordFor } from "@/lib/db/queries/accepted-record";
import { getQuoteComparison } from "@/lib/db/queries/quote-comparison";
import { getLeadDetail } from "@/lib/db/queries/seller";
import { acceptSplit } from "@/lib/enquiry/accept";
import { reportAcceptedQuote, setBuyerReference } from "@/lib/enquiry/accepted-record-server";
import { acceptQuote } from "@/lib/enquiry/service";
import { buildComparison } from "@/lib/quote/comparison";
import { filsToAed } from "@/lib/quote/money";
import { sendQuoteForBusiness } from "@/lib/quote/send-quote";
import { cheapestAcceptableSplit } from "@/lib/quote/split";
import { canReview, provenanceOf } from "@/lib/reviews/eligibility";
import { createReview, enquiryForReview } from "@/lib/reviews/service";

/**
 * Board `1o` — accepting an enquiry's lines from several suppliers, D1–D7 as the
 * owner confirmed them on 1 Oct 2026, against a real database.
 *
 *   - D1: the supplier opts in on the quote, and it is fixed once sent;
 *   - D2/D3: whole lines, one supplier each, one decision — the enquiry is decided;
 *   - D4: a record per supplier, and the buyer's contact released to each;
 *   - D5: the company's rule once, on the parts together, one approval;
 *   - D6: a review per supplier accepted from;
 *   - D7: a line the supplier added goes with their part;
 *   - AC7: one supplier's whole quote is the ordinary accept.
 *
 * Suppliers, owners and buyers are this file's own, prefixed, so no seeded
 * count moves and nothing another file writes can satisfy an assertion here.
 */

// No carrier is real here: in-app confirms, and email is captured rather than sent.
vi.mock("@/lib/notify/senders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notify/senders")>();
  return {
    ...actual,
    resolveNotificationSenders: () => ({
      in_app: new actual.InAppNotificationSender(),
      email: { name: "capture", channel: "email", send: async () => ({ delivered: true, providerRef: "capture" }) },
    }),
  };
});

const PREFIX = "spl1o";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const users: string[] = [];
const companies: string[] = [];
let buyerId: string;
let categoryId: string;
const suppliers: { id: string; slug: string; name: string; actor: Actor }[] = [];

async function user(label: string, over: Partial<{ roles: string[]; businessId: string }> = {}) {
  const id = randomUUID();
  await prisma.user.create({
    data: {
      id,
      fullName: `${PREFIX} ${label}`,
      email: `${PREFIX}-${label.replace(/\W+/g, "-")}-${id.slice(0, 8)}@example.test`,
      phone: `+9715${String(Date.now()).slice(-7)}${String(users.length).padStart(2, "0")}`,
      roles: (over.roles ?? ["buyer"]) as never,
      ...(over.businessId ? { businessId: over.businessId } : {}),
    },
  });
  users.push(id);
  return id;
}

async function removeFixtures() {
  const businesses = await prisma.business.findMany({ where: { slug: { startsWith: `${PREFIX}-` } }, select: { id: true } });
  const ids = businesses.map((b) => b.id);
  await prisma.supplierReport.deleteMany({ where: { subjectBusinessId: { in: ids } } });
  await prisma.enquiry.deleteMany({ where: { requirement: { startsWith: PREFIX } } });
  await prisma.notificationDelivery.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.user.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.business.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  await removeFixtures();
  categoryId = (await prisma.category.findFirstOrThrow({ where: { slug: "valves-and-fittings" }, select: { id: true } })).id;
  const names = ["Sahara Valve Works", "Lagoon Fittings Co.", "Mirdif Pipe Supply", "Qusais Flow Trading"];
  for (const [index, name] of names.entries()) {
    const slug = `${PREFIX}-${index}-${randomUUID().slice(0, 6)}`;
    const business = await prisma.business.create({
      data: {
        tradeName: `${name} LLC`,
        displayName: name,
        slug,
        licenceNumber: `DED-${PREFIX}-${index}`,
        licenceAuthority: "DED",
        licenceExpiry: new Date(Date.now() + 400 * DAY),
        verificationTier: 2,
        verifiedAt: new Date(Date.now() - 90 * DAY),
        claimStatus: "claimed",
        planId: "pro",
        primaryCategoryId: categoryId,
        source: "self_added",
        publishedAt: null,
      },
      select: { id: true },
    });
    const ownerId = await user(`owner${index}`, { roles: ["seller_owner"], businessId: business.id });
    // In-app for an accepted quote, chosen; a part of one inherits it (`ROUTES_LIKE`), and a decline is on the floor.
    await prisma.notificationPreference.create({
      data: { businessId: business.id, routing: { quote_accepted: ["in_app"] }, quietHoursEnabled: false },
    });
    suppliers.push({ id: business.id, slug, name, actor: { id: ownerId, roles: ["seller_owner"], businessId: business.id } as Actor });
  }
  buyerId = await user("buyer");
});

afterAll(async () => {
  await removeFixtures();
  await prisma.buyerCompany.deleteMany({ where: { id: { in: companies } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

/*
   Board `1n`'s three lines, priced as drawn. Sahara and Qusais quote all or
   nothing; Lagoon (two lines) and Mirdif (all three) let their prices hold for
   part of a quote — so the 13,560 split, Lagoon's valve and Mirdif's couplings
   and gaskets, is one a buyer may accept.
*/
const QTY = [40, 120, 120];
const QUOTES: { prices: (string | null)[]; allowsPartial: boolean }[] = [
  { prices: ["198.00", "46.00", "12.00"], allowsPartial: false },
  { prices: ["183.00", "50.00", null], allowsPartial: true },
  { prices: ["268.00", "41.00", "11.00"], allowsPartial: true },
  { prices: ["236.00", "48.00", "13.00"], allowsPartial: false },
];

let seq = 0;
/** An enquiry sent to all four, each quoting through the composer's own send. */
async function board(over: Partial<{ buyer: string; companyId: string; quotes: typeof QUOTES; qty: number[] }> = {}) {
  seq += 1;
  const qty = over.qty ?? QTY;
  const quotes = over.quotes ?? QUOTES;
  const enquiry = await prisma.enquiry.create({
    data: {
      ref: `ENQ-${PREFIX}-${Date.now().toString(36)}-${seq}`,
      buyerId: over.buyer ?? buyerId,
      ...(over.companyId ? { buyerCompanyId: over.companyId } : {}),
      requirement: `${PREFIX} chilled water riser ${seq}. Valves, couplings, gaskets.`,
      closesAt: new Date(Date.now() + 3 * DAY),
      createdAt: new Date(Date.now() - 2 * DAY),
      lines: {
        create: ["Gate valve", "Grooved coupling", "EPDM gasket"].map((description, index) => ({
          description,
          qty: qty[index]!,
          unit: "pcs",
          sortOrder: index,
        })),
      },
      recipients: { create: suppliers.map((supplier) => ({ businessId: supplier.id, createdAt: new Date(Date.now() - 2 * DAY) })) },
    },
    select: { id: true, ref: true, lines: { select: { id: true }, orderBy: { sortOrder: "asc" } } },
  });
  const lineIds = enquiry.lines.map((line) => line.id);
  const quoteIds: string[] = [];
  for (const [index, quote] of quotes.entries()) {
    const sent = await sendQuoteForBusiness(suppliers[index]!.actor, suppliers[index]!.id, {
      enquiryId: enquiry.id,
      note: "",
      validityDays: 14,
      allowsPartial: quote.allowsPartial,
      lines: quote.prices.flatMap((price, lineIndex) =>
        price === null
          ? []
          : [
              {
                enquiryLineId: lineIds[lineIndex]!,
                productId: null,
                description: `line ${lineIndex}`,
                qty: qty[lineIndex]!,
                unitPrice: price,
                leadTimeDays: 3,
              },
            ],
      ),
    });
    if (!sent.ok) throw new Error(`quote fixture: ${sent.error}`);
    quoteIds.push(sent.quoteId);
  }
  return { id: enquiry.id, ref: enquiry.ref, lineIds, quoteIds };
}

/** The board's split: Lagoon's valve, Mirdif's couplings and gaskets. */
const boardSplit = (e: Awaited<ReturnType<typeof board>>) => [
  { lineId: e.lineIds[0]!, quoteId: e.quoteIds[1]! },
  { lineId: e.lineIds[1]!, quoteId: e.quoteIds[2]! },
  { lineId: e.lineIds[2]!, quoteId: e.quoteIds[2]! },
];

describe("D1 — the supplier opts in, and it holds once sent", () => {
  it("stores the choice the composer sent, off unless ticked", async () => {
    const e = await board();
    const quotes = await prisma.quote.findMany({ where: { id: { in: e.quoteIds } }, select: { id: true, allowsPartial: true } });
    expect(e.quoteIds.map((id) => quotes.find((q) => q.id === id)!.allowsPartial)).toEqual([false, true, true, false]);
  });

  it("refuses to change it on a sent quote: the buyer chooses against it", async () => {
    const e = await board();
    await expect(prisma.quote.update({ where: { id: e.quoteIds[0]! }, data: { allowsPartial: true } })).rejects.toThrow(
      /fixed once sent/,
    );
  });

  it("computes the cheapest split the rules allow from the stored choices", async () => {
    const e = await board();
    const data = (await getQuoteComparison(buyerId, e.ref))!;
    const best = cheapestAcceptableSplit(buildComparison(data.input, new Date()));
    expect(best && filsToAed(best.plan.totalFils)).toBe("13560.00");
    expect(best?.picks).toEqual(boardSplit(e));
  });
});

describe("accepting across suppliers — D2, D3, D4", () => {
  it("accepts the chosen lines from each supplier in one decision, and nothing else", async () => {
    const e = await board();
    const result = await acceptSplit(buyerId, e.ref, boardSplit(e));
    expect(result).toMatchObject({ ok: true, enquiryId: e.id });
    const [sahara, lagoon, mirdif, qusais] = suppliers;

    // Decided, and the marker names the larger share: Lagoon's 7,320 against Mirdif's 6,240.
    const enquiry = await prisma.enquiry.findUniqueOrThrow({ where: { id: e.id } });
    expect(enquiry.contactReleasedToBusinessId).toBe(lagoon!.id);
    expect(enquiry.contactReleasedAt).not.toBeNull();

    const quotes = await prisma.quote.findMany({
      where: { enquiryId: e.id },
      select: { id: true, businessId: true, status: true, lostReason: true, lines: { select: { enquiryLineId: true, acceptedAt: true } } },
    });
    const quoteOf = (businessId: string) => quotes.find((q) => q.businessId === businessId)!;
    expect(quotes).toHaveLength(4);
    expect(quoteOf(lagoon!.id).status).toBe("accepted");
    expect(quoteOf(mirdif!.id).status).toBe("accepted");
    expect([quoteOf(sahara!.id), quoteOf(qusais!.id)].map((q) => [q.status, q.lostReason])).toEqual([
      ["lost", "buyer_accepted_another"],
      ["lost", "buyer_accepted_another"],
    ]);
    // The lines each acceptance covers, and no others (D2).
    const covered = (businessId: string) =>
      quoteOf(businessId)
        .lines.filter((line) => line.acceptedAt !== null)
        .map((line) => e.lineIds.indexOf(line.enquiryLineId!))
        .sort();
    expect(covered(lagoon!.id)).toEqual([0]);
    expect(covered(mirdif!.id)).toEqual([1, 2]);

    // The buyer's contact went to each supplier accepted from, and to nobody else (D4).
    const recipients = await prisma.enquiryRecipient.findMany({ where: { enquiryId: e.id }, select: { businessId: true, state: true, contactReleasedAt: true } });
    const recipient = (businessId: string) => recipients.find((r) => r.businessId === businessId)!;
    expect([lagoon, mirdif].map((s) => [recipient(s!.id).state, recipient(s!.id).contactReleasedAt !== null])).toEqual([
      ["quoted", true],
      ["quoted", true],
    ]);
    expect([sahara, qusais].map((s) => [recipient(s!.id).state, recipient(s!.id).contactReleasedAt])).toEqual([
      ["declined", null],
      ["declined", null],
    ]);
  });

  it("releases the buyer to the supplier the marker does not name, and to no supplier left out", async () => {
    const e = await board();
    expect((await acceptSplit(buyerId, e.ref, boardSplit(e))).ok).toBe(true);
    const [sahara, , mirdif] = suppliers;

    const won = await getLeadDetail(mirdif!.id, e.id);
    expect(won?.buyer.released).toBe(true);
    expect(won?.acceptedAt).not.toBeNull();
    const lost = await getLeadDetail(sahara!.id, e.id);
    expect(lost?.buyer).toEqual({ released: false, firstName: expect.any(String) });
  });

  it("tells each supplier what was taken from them, and the rest that theirs was not", async () => {
    const e = await board();
    expect((await acceptSplit(buyerId, e.ref, boardSplit(e))).ok).toBe(true);
    const [sahara, lagoon, mirdif, qusais] = suppliers;
    const told = await prisma.notificationDelivery.findMany({
      where: { enquiryId: e.id, channel: "in_app" },
      select: { businessId: true, event: true },
    });
    const events = (businessId: string) => told.filter((row) => row.businessId === businessId).map((row) => row.event).sort();
    expect(events(lagoon!.id)).toEqual(["quote_partly_accepted"]);
    expect(events(mirdif!.id)).toEqual(["quote_partly_accepted"]);
    expect(events(sahara!.id)).toEqual(["quote_declined"]);
    expect(events(qusais!.id)).toEqual(["quote_declined"]);
  });

  it("keeps a record per supplier: its own lines, its own total, the buyer's other suppliers named", async () => {
    const e = await board();
    expect((await acceptSplit(buyerId, e.ref, boardSplit(e))).ok).toBe(true);
    const [sahara, lagoon, mirdif] = suppliers;

    const main = (await getAcceptedRecord(buyerId, e.ref))!;
    expect(main.supplier.id).toBe(lagoon!.id);
    expect(main.quote.lines.map((line) => line.description)).toEqual(["line 0"]);
    expect(main.quote.totalAed).toBe("7320.00");
    expect(main.partOfQuote).toBe(true);
    expect(main.acceptedFrom.map((s) => s.businessId).sort()).toEqual([lagoon!.id, mirdif!.id].sort());

    const other = (await getAcceptedRecordFor(buyerId, e.ref, mirdif!.slug))!;
    expect(other.supplier.id).toBe(mirdif!.id);
    expect(other.quote.lines.map((line) => line.description)).toEqual(["line 1", "line 2"]);
    expect(other.quote.totalAed).toBe("6240.00");
    expect(other.linesNotAccepted).toEqual([]);

    // A supplier nothing was accepted from has no record: the same null as none at all.
    expect(await getAcceptedRecordFor(buyerId, e.ref, sahara!.slug)).toBeNull();
    expect(await getAcceptedRecord(buyerId, e.ref, sahara!.id)).toBeNull();
  });

  it("names the lines nobody was chosen for, and accepts none of them (D3)", async () => {
    const e = await board();
    const picks = boardSplit(e).slice(0, 2);
    expect((await acceptSplit(buyerId, e.ref, picks)).ok).toBe(true);
    const record = (await getAcceptedRecord(buyerId, e.ref))!;
    expect(record.linesNotAccepted).toEqual(["EPDM gasket"]);
    const gasket = await prisma.quoteLine.findMany({ where: { enquiryLineId: e.lineIds[2]! }, select: { acceptedAt: true } });
    expect(gasket.every((line) => line.acceptedAt === null)).toBe(true);
  });
});

describe("what a split refuses — and writes nothing for", () => {
  it("refuses part of an all-or-nothing quote (D1)", async () => {
    const e = await board();
    const picks = [
      { lineId: e.lineIds[0]!, quoteId: e.quoteIds[1]! },
      { lineId: e.lineIds[1]!, quoteId: e.quoteIds[0]! },
    ];
    expect(await acceptSplit(buyerId, e.ref, picks)).toEqual({ ok: false, error: "all_or_nothing", lineId: e.lineIds[1]! });
    const enquiry = await prisma.enquiry.findUniqueOrThrow({ where: { id: e.id }, select: { contactReleasedToBusinessId: true } });
    expect(enquiry.contactReleasedToBusinessId).toBeNull();
    expect(await prisma.quote.count({ where: { enquiryId: e.id, status: "accepted" } })).toBe(0);
  });

  it("refuses a quote the supplier has since revised: that price was replaced", async () => {
    const e = await board();
    const mirdif = suppliers[2]!;
    const revised = await sendQuoteForBusiness(mirdif.actor, mirdif.id, {
      enquiryId: e.id,
      note: "",
      validityDays: 14,
      allowsPartial: true,
      lines: e.lineIds.map((lineId, index) => ({ enquiryLineId: lineId, productId: null, description: `r2 ${index}`, qty: QTY[index]!, unitPrice: "10.00", leadTimeDays: 3 })),
    });
    expect(revised.ok).toBe(true);
    expect(await acceptSplit(buyerId, e.ref, boardSplit(e))).toMatchObject({ ok: false, error: "revised", quoteId: e.quoteIds[2]! });
  });

  it("is one decision: once decided, neither a split nor a single accept follows it", async () => {
    const e = await board();
    expect((await acceptSplit(buyerId, e.ref, boardSplit(e))).ok).toBe(true);
    expect(await acceptSplit(buyerId, e.ref, boardSplit(e))).toEqual({ ok: false, error: "already_accepted" });
    expect(await acceptQuote(buyerId, e.quoteIds[0]!)).toMatchObject({ ok: false, error: "already_accepted" });
  });

  it("reads one supplier's whole quote as the ordinary accept (AC7)", async () => {
    const e = await board();
    const picks = e.lineIds.map((lineId) => ({ lineId, quoteId: e.quoteIds[0]! }));
    expect(await acceptSplit(buyerId, e.ref, picks)).toMatchObject({ ok: true, parts: [{ quoteId: e.quoteIds[0]!, whole: true }] });
    const told = await prisma.notificationDelivery.findMany({
      where: { enquiryId: e.id, businessId: suppliers[0]!.id, channel: "in_app" },
      select: { event: true },
    });
    expect(told.map((row) => row.event)).toEqual(["quote_accepted"]);
    const record = (await getAcceptedRecord(buyerId, e.ref))!;
    expect(record.partOfQuote).toBe(false);
    expect(record.quote.totalAed).toBe("14880.00");
  });
});

describe("D6 — one review per supplier accepted from", () => {
  const RATINGS = { overall: 4, quotedAccurate: 5, onTime: 4, asDescribed: 4, responsiveness: 5 };
  const BODY = "Delivered the lines we took from them on the day they said, with the paperwork right.";

  it("asks which supplier, takes one review about each, and no third", async () => {
    const e = await board();
    expect((await acceptSplit(buyerId, e.ref, boardSplit(e))).ok).toBe(true);
    const [sahara, lagoon, mirdif] = suppliers;

    expect(canReview(buyerId, await enquiryForReview(e.id))).toEqual({ ok: false, reason: "ambiguous_subject" });

    const first = await createReview({ buyerId, enquiryId: e.id, businessId: mirdif!.id, ratings: RATINGS, body: BODY });
    expect(first).toMatchObject({ ok: true, businessId: mirdif!.id, provenance: "accepted_quote" });

    // The one left is the subject now, still on the accepted-quote rung.
    expect(canReview(buyerId, await enquiryForReview(e.id))).toEqual({ ok: true, businessId: lagoon!.id, provenance: "accepted_quote" });
    const second = await createReview({ buyerId, enquiryId: e.id, ratings: RATINGS, body: BODY });
    expect(second).toMatchObject({ ok: true, businessId: lagoon!.id, provenance: "accepted_quote" });

    expect(await createReview({ buyerId, enquiryId: e.id, businessId: mirdif!.id, ratings: RATINGS, body: BODY })).toEqual({
      ok: false,
      error: "already_reviewed",
    });
    // A supplier nothing was accepted from is not what the extra reviews are for.
    expect(await createReview({ buyerId, enquiryId: e.id, businessId: sahara!.id, ratings: RATINGS, body: BODY })).toEqual({
      ok: false,
      error: "no_confirmed_enquiry",
    });
    expect(await prisma.review.count({ where: { enquiryId: e.id } })).toBe(2);

    // The storefront's Accepted chip and the list under it are one predicate,
    // for the supplier the enquiry's column does not name too (board 1m).
    if (!first.ok) throw new Error(first.error);
    const storefront = await getReviewBoard(mirdif!.id, { filter: "accepted", sort: "recent", page: 1 });
    expect(storefront.counts.accepted).toBe(1);
    expect(storefront.total).toBe(1);
    expect(storefront.reviews.map((review) => review.id)).toEqual([first.reviewId]);
    expect(provenanceOf(storefront.reviews[0]!)).toBe("accepted_quote");
  });
});

describe("D4 — the buyer's two writes, per record", () => {
  it("files a report about each supplier separately, and none about one left out", async () => {
    const e = await board();
    expect((await acceptSplit(buyerId, e.ref, boardSplit(e))).ok).toBe(true);
    const [sahara, lagoon, mirdif] = suppliers;
    const detail = "The couplings arrived a week after the date on the record, and nobody called ahead.";

    expect(await reportAcceptedQuote({ buyerId, refOrId: e.ref, detail, businessId: mirdif!.id })).toMatchObject({ ok: true });
    expect(await reportAcceptedQuote({ buyerId, refOrId: e.ref, detail, businessId: mirdif!.id })).toEqual({
      ok: false,
      error: "already_reported",
    });
    // Without a name, the main supplier's record.
    expect(await reportAcceptedQuote({ buyerId, refOrId: e.ref, detail })).toMatchObject({ ok: true });
    expect(await reportAcceptedQuote({ buyerId, refOrId: e.ref, detail, businessId: sahara!.id })).toEqual({
      ok: false,
      error: "not_found",
    });
    const reports = await prisma.supplierReport.findMany({ where: { enquiryId: e.id }, select: { subjectBusinessId: true } });
    expect(reports.map((r) => r.subjectBusinessId).sort()).toEqual([lagoon!.id, mirdif!.id].sort());
  });

  it("keeps each supplier's PO number on their own record", async () => {
    const e = await board();
    expect((await acceptSplit(buyerId, e.ref, boardSplit(e))).ok).toBe(true);
    const [, lagoon, mirdif] = suppliers;
    expect(await setBuyerReference({ buyerId, refOrId: e.ref, value: "PO-MIRDIF-7", businessId: mirdif!.id })).toEqual({
      ok: true,
      buyerReference: "PO-MIRDIF-7",
    });
    expect((await getAcceptedRecordFor(buyerId, e.ref, mirdif!.slug))!.buyerReference).toBe("PO-MIRDIF-7");
    expect((await getAcceptedRecord(buyerId, e.ref))!.buyerReference).toBeNull();
    const enquiry = await prisma.enquiry.findUniqueOrThrow({ where: { id: e.id }, select: { buyerReference: true } });
    expect(enquiry.buyerReference).toBeNull();
    expect(lagoon).toBeDefined();
  });
});

describe("D5 — the company's rule, once, on the parts together", () => {
  // Three lines of one each; Sahara-like pricing is not needed here.
  const COMPANY_QUOTES = [
    { prices: ["3000.00", "3000.00", "4000.00"], allowsPartial: true },
    { prices: ["5000.00", "5000.00", "5000.00"], allowsPartial: true },
    { prices: ["9000.00", "9000.00", "9000.00"], allowsPartial: false },
    { prices: ["9500.00", "9500.00", "9500.00"], allowsPartial: false },
  ];

  async function companyWithLimit(label: string, limitAed: number) {
    const admin = await user(`${label} admin`);
    const created = await createCompany(admin, { name: `${label} ${PREFIX} Trading`, trn: "100 4482 1690 0003" });
    if (!created.ok) throw new Error(`company fixture: ${created.error}`);
    companies.push(created.companyId);
    const raiser = await user(`${label} procurement`);
    await prisma.buyerCompanyMember.create({ data: { companyId: created.companyId, userId: raiser, role: "procurement", monthlyLimitAed: limitAed } });
    return { companyId: created.companyId, admin, raiser };
  }

  it("holds a split whose parts together pass a limit neither passes alone, and approves it as asked", async () => {
    const { companyId, admin, raiser } = await companyWithLimit("split", 10_000);
    const e = await board({ buyer: raiser, companyId, quotes: COMPANY_QUOTES, qty: [1, 1, 1] });
    // Two lines from the first supplier (6,000) and one from the second (5,000): 11,000.
    const picks = [
      { lineId: e.lineIds[0]!, quoteId: e.quoteIds[0]! },
      { lineId: e.lineIds[1]!, quoteId: e.quoteIds[0]! },
      { lineId: e.lineIds[2]!, quoteId: e.quoteIds[1]! },
    ];
    expect(await acceptSplit(raiser, e.ref, picks)).toEqual({ ok: false, error: "approval_required" });

    const requested = await requestSplitApproval(raiser, e.ref, picks, {
      poNumbers: { [e.quoteIds[0]!]: "PO-A-11", [e.quoteIds[1]!]: "PO-B-12" },
    });
    if (!requested.ok) throw new Error(requested.error);
    const request = await prisma.quoteApproval.findUniqueOrThrow({ where: { id: requested.approvalId } });
    // One request, at the combined value, with the parts as asked.
    expect(request.valueFils).toBe(1_100_000n);
    expect(request.reasons).toEqual(["over_limit"]);
    expect(request.quoteId).toBe(e.quoteIds[0]!);
    expect(request.split).toEqual([
      { quoteId: e.quoteIds[0]!, quoteRevision: 1, enquiryLineIds: [e.lineIds[0]!, e.lineIds[1]!].sort(), poNumber: "PO-A-11" },
      { quoteId: e.quoteIds[1]!, quoteRevision: 1, enquiryLineIds: [e.lineIds[2]!], poNumber: "PO-B-12" },
    ].sort((a, b) => a.quoteId.localeCompare(b.quoteId)));
    expect(await approversFor(requested.approvalId)).toEqual([admin]);

    expect(await approveRequest(admin, requested.approvalId)).toMatchObject({ ok: true, outcome: "approved" });

    const quotes = await prisma.quote.findMany({ where: { enquiryId: e.id }, select: { id: true, status: true, buyerReference: true } });
    const quote = (id: string) => quotes.find((q) => q.id === id)!;
    expect([quote(e.quoteIds[0]!), quote(e.quoteIds[1]!)].map((q) => [q.status, q.buyerReference])).toEqual([
      ["accepted", "PO-A-11"],
      ["accepted", "PO-B-12"],
    ]);
    // The month counts what was accepted — the lines taken, not the whole quotes —
    // against the approver, on whose authority it was committed.
    const spend = await monthSpend(prisma, companyId, new Date());
    expect(spend.byPerson.get(admin)).toBe(1_100_000n);
    expect(spend.byPerson.get(raiser)).toBeUndefined();
  });

  it("requires a PO number for every supplier where the company requires one", async () => {
    const { companyId, admin, raiser } = await companyWithLimit("po", 1_000);
    expect((await setRuleFlag(admin, "requirePoNumber", true)).ok).toBe(true);
    const e = await board({ buyer: raiser, companyId, quotes: COMPANY_QUOTES, qty: [1, 1, 1] });
    const picks = [
      { lineId: e.lineIds[0]!, quoteId: e.quoteIds[0]! },
      { lineId: e.lineIds[1]!, quoteId: e.quoteIds[0]! },
      { lineId: e.lineIds[2]!, quoteId: e.quoteIds[1]! },
    ];
    expect(await requestSplitApproval(raiser, e.ref, picks, { poNumbers: { [e.quoteIds[0]!]: "PO-A-1" } })).toEqual({
      ok: false,
      error: "po_required",
    });
  });
});

describe("the decided marker and the per-supplier release stay in step", () => {
  it("stamps a recipient that arrives on an enquiry already released to it", async () => {
    const releasedAt = new Date(Date.now() - HOUR);
    const enquiry = await prisma.enquiry.create({
      data: {
        ref: `ENQ-${PREFIX}-${Date.now().toString(36)}-trig`,
        buyerId,
        requirement: `${PREFIX} written released, as the seed writes it.`,
        closesAt: new Date(Date.now() + DAY),
        contactReleasedToBusinessId: suppliers[0]!.id,
        contactReleasedAt: releasedAt,
      },
      select: { id: true },
    });
    await prisma.enquiryRecipient.createMany({
      data: [
        { enquiryId: enquiry.id, businessId: suppliers[0]!.id },
        { enquiryId: enquiry.id, businessId: suppliers[1]!.id },
      ],
    });
    const rows = await prisma.enquiryRecipient.findMany({ where: { enquiryId: enquiry.id }, select: { businessId: true, contactReleasedAt: true } });
    expect(rows.find((r) => r.businessId === suppliers[0]!.id)!.contactReleasedAt).toEqual(releasedAt);
    expect(rows.find((r) => r.businessId === suppliers[1]!.id)!.contactReleasedAt).toBeNull();
  });

  it("stamps the recipient when the enquiry's column is set the older way", async () => {
    const e = await board();
    const at = new Date();
    await prisma.enquiry.update({ where: { id: e.id }, data: { contactReleasedToBusinessId: suppliers[3]!.id, contactReleasedAt: at } });
    const row = await prisma.enquiryRecipient.findUniqueOrThrow({
      where: { enquiryId_businessId: { enquiryId: e.id, businessId: suppliers[3]!.id } },
      select: { contactReleasedAt: true },
    });
    expect(row.contactReleasedAt).toEqual(at);
  });
});
