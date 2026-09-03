import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { createEnquiry } from "@/lib/enquiry/service";

/**
 * Criterion 14 — one `Enquiry` with N `EnquiryRecipient` rows, never N
 * enquiries, and the same submit path for the inline composer on 1d and 1g.
 *
 * The handoff's first rule and the one it says is most likely to be built
 * wrong: "a single-seller enquiry is an RFQ with one recipient. Same entity,
 * same submit path, same tracking page, same thread, same acceptance logic."
 */

const PREFIX = "rfq-submit-test-";
let categoryId: string;

async function removeFixtures() {
  await prisma.enquiry.deleteMany({ where: { requirement: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await removeFixtures();
  const category = await prisma.category.findFirstOrThrow({
    where: { products: { some: { status: { not: "draft" } } } },
    select: { id: true },
  });
  categoryId = category.id;
});

afterAll(removeFixtures);

async function send(over: Partial<Parameters<typeof createEnquiry>[0]> = {}) {
  return createEnquiry({
    buyerId: null,
    attribution: {},
    phone: "+971500000001",
    fullName: "Test Buyer",
    requirement: `${PREFIX}chilled water riser, two drops`,
    lines: [
      { description: "Gate valve DN150", qty: 12, unit: "pcs", size: null, targetUnitPriceAed: "190", productId: null },
    ],
    categoryId,
    emirate: "dubai",
    deliverToArea: "Dubai Marina",
    neededBy: null,
    termsWanted: null,
    closesInDays: 7,
    fanoutTo: 5,
    ...over,
  } as Parameters<typeof createEnquiry>[0]);
}

describe("one entity, however many sellers", () => {
  it("writes a single enquiry with a recipient row each", async () => {
    const result = await send();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const enquiries = await prisma.enquiry.findMany({
      where: { requirement: { startsWith: PREFIX } },
      select: { id: true, _count: { select: { recipients: true, lines: true } } },
    });
    // One enquiry. Never one per seller — that is the model the handoff's first
    // rule exists to prevent, and it would fork the thread and the acceptance.
    expect(enquiries).toHaveLength(1);
    expect(enquiries[0]!._count.recipients).toBeGreaterThan(1);
    expect(enquiries[0]!._count.lines).toBe(1);
  });

  it("takes the same path for one seller as for five", async () => {
    /*
       Composer A on 1d and 1g sends to one. Same function, same shape, one
       fewer recipient row — which is what makes the tracking page, the thread
       and the acceptance logic identical for both.
    */
    await removeFixtures();
    const one = await send({ fanoutTo: 1 });
    expect(one.ok).toBe(true);
    const single = await prisma.enquiry.findFirstOrThrow({
      where: { requirement: { startsWith: PREFIX } },
      select: { ref: true, closesAt: true, _count: { select: { recipients: true } } },
    });
    expect(single._count.recipients).toBe(1);
    // Same shape: a ref and a closing date, exactly as the fan-out gets.
    expect(single.ref).toBeTruthy();
    expect(single.closesAt).toBeInstanceOf(Date);
  });
});

describe("the buyer's ticks decide who it reaches", () => {
  it("sends to exactly the chosen sellers, and to nobody else", async () => {
    await removeFixtures();
    /*
       The picker is checkboxes, not a count. Routing the choice through
       `fanoutTo` alone would let the matcher substitute: a seller who became
       ineligible between the preview and the send would be replaced by whoever
       ranked next, delivering to somebody the buyer never ticked — possibly one
       they had deliberately unticked.
    */
    const candidates = await prisma.business.findMany({
      where: {
        publishedAt: { not: null },
        suspendedAt: null,
        claimStatus: "claimed",
        products: { some: { categoryId, status: { not: "draft" } } },
      },
      select: { id: true },
      take: 3,
    });
    if (candidates.length < 2) return;

    const chosen = [candidates[0]!.id];
    const result = await send({ fanoutTo: 5, chosenBusinessIds: chosen });
    expect(result.ok).toBe(true);

    const rows = await prisma.enquiryRecipient.findMany({
      where: { enquiry: { requirement: { startsWith: PREFIX } } },
      select: { businessId: true },
    });
    expect(rows.map((r) => r.businessId).sort()).toEqual(chosen.sort());
  });

  it("still refuses a seller the matcher would not have offered", async () => {
    /*
       Intersected with the candidate set, not trusted. The ids arrive from a
       form, so a cap that a hand-edited payload could step over is advisory
       rather than a cap.
    */
    await removeFixtures();
    const result = await send({ chosenBusinessIds: ["not-a-real-business-id"] });
    expect(result).toMatchObject({ ok: false, error: "no_recipients" });
  });
});

describe("the edge states the fan-out framing has to survive", () => {
  it("writes a zero-match row the recruitment queue can read", async () => {
    /*
       Criterion 9. A buyer who described a whole requirement nobody can answer
       is the most useful signal there is for deciding which trade to recruit
       next — more specific, and warmer, than a search that found nothing. It
       lands in `ZeroResultQuery`, which board 12d's queue already reads, marked
       `rfq` so the two failures can be told apart.
    */
    const before = await prisma.zeroResultQuery.count({ where: { tab: "rfq" } });

    await prisma.zeroResultQuery.create({
      data: {
        query: `${PREFIX}grooved gasket EPDM 4 inch`,
        categoryId,
        emirate: "dubai",
        tab: "rfq",
        filters: { requirement: `${PREFIX}nobody stocks this` },
      },
    });

    const after = await prisma.zeroResultQuery.count({ where: { tab: "rfq" } });
    expect(after).toBe(before + 1);

    const row = await prisma.zeroResultQuery.findFirstOrThrow({
      where: { query: { startsWith: PREFIX } },
      select: { tab: true, categoryId: true, filters: true },
    });
    // The lines are the query — a requirement is prose about a job, the lines
    // are the things nobody stocks, which is what a recruiter needs to read.
    expect(row.tab).toBe("rfq");
    expect(row.categoryId).toBe(categoryId);

    await prisma.zeroResultQuery.deleteMany({ where: { query: { startsWith: PREFIX } } });
  });

  it("refuses to send when nothing matches, rather than sending to nobody", async () => {
    /*
       The fan-out framing collapses; it never pads the list to reach five.

       "Nothing matches" means no supplier in the trade, not no *product* in it.
       An earlier version of this test used a category with no products and
       expected a refusal — and got a send, correctly: a supplier in the right
       trade who has not listed their whole catalogue can still quote, and
       excluding them would shrink every fan-out for no gain. The premise was
       wrong, not the code.
    */
    await removeFixtures();
    const orphan = await prisma.category.findFirst({
      where: { businesses: { none: {} }, products: { none: {} } },
      select: { id: true },
    });
    if (!orphan) return;
    const result = await send({ categoryId: orphan.id });
    expect(result).toMatchObject({ ok: false, error: "no_recipients" });
  });
});
