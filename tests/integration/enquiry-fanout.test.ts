import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { acceptQuote, createEnquiry, findFanoutCandidates, descendantsOf } from "@/lib/enquiry/service";
import { getLeadDetail, getLeadsForBusiness } from "@/lib/db/queries/seller";
import { monthStart, scoreCandidate } from "@/lib/enquiry/fanout";

/**
 * The handoff 2 step 3 checkpoint, end to end:
 *
 *   "send to 5 sellers, quote from 2, accept 1 — then prove in a test that the
 *    other 4 never had access to the buyer's number."
 *
 * Plus acceptance criteria 1, 3 and 6. Against a real database, through the
 * same service the routes call.
 */

let categoryId: string;
let buyerId: string;
let admin: SupabaseClient | null = null;
const createdEnquiryIds: string[] = [];
const createdUserIds: string[] = [];

/**
 * Creating a lightweight identity needs the Supabase admin API, which CI has no
 * key for. Everything else in this file needs Postgres and nothing else, so
 * only the one test is guarded rather than the suite.
 */
const canCreateIdentities = Boolean(
  process.env["SUPABASE_SECRET_KEY"] && process.env["NEXT_PUBLIC_SUPABASE_URL"],
);
if (!canCreateIdentities) {
  console.warn(
    "[enquiry-fanout] the anonymous-buyer test is skipped: it needs SUPABASE_SECRET_KEY. " +
      "The provisional identity path is unproven in this environment.",
  );
}

/** Digits nobody else in the seed uses, so a leak is unambiguous. */
const BUYER_PHONE = "+971509988771";
const BUYER_NAME = "Khalid Al Nuaimi";

beforeAll(async () => {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const secret = process.env["SUPABASE_SECRET_KEY"];
  if (url && secret) {
    admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
  }

  const category = await prisma.category.findFirstOrThrow({
    where: { slug: "valves-and-fittings" },
    select: { id: true },
  });
  categoryId = category.id;

  const buyer = await prisma.user.findFirstOrThrow({
    where: { roles: { has: "buyer" }, isProvisional: false },
    select: { id: true },
  });
  buyerId = buyer.id;
});

afterEach(async () => {
  for (const id of createdEnquiryIds.splice(0)) {
    await prisma.enquiry.deleteMany({ where: { id } });
  }
  for (const id of createdUserIds.splice(0)) {
    await prisma.user.deleteMany({ where: { id } });
    // And the Supabase auth user behind it. Leaving one orphaned used to make
    // that number permanently unable to send an enquiry — the drift the
    // service now recovers from, but a test should not be creating it.
    await admin?.auth.admin.deleteUser(id).catch(() => undefined);
  }
  await prisma.user.deleteMany({ where: { phone: BUYER_PHONE } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

function lines() {
  return [
    { description: "Resilient seated gate valve, flanged", qty: 24, unit: "pcs", size: "DN100" },
    { description: "Wafer butterfly valve, gear operated", qty: 6, unit: "pcs", size: "DN200" },
  ];
}

async function sendToFive() {
  const result = await createEnquiry({
    buyerId,
    requirement: "Isolation valves for a chilled water riser. Delivery to Al Quoz.",
    lines: lines(),
    categoryId,
    emirate: "dubai",
    deliverToArea: "Al Quoz Industrial 1",
    fanoutTo: 5,
  });
  if (result.ok) createdEnquiryIds.push(result.enquiryId);
  return result;
}

describe("criterion 1 — sending an enquiry", () => {
  it("delivers to five suppliers and returns a reference", async () => {
    const result = await sendToFive();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    expect(result.ref).toMatch(/^ENQ-\d+$/);
    expect(result.recipients).toHaveLength(5);

    const rows = await prisma.enquiryRecipient.findMany({ where: { enquiryId: result.enquiryId } });
    expect(rows).toHaveLength(5);
    // Every one of them starts undelivered-to-opened, never pre-declined.
    expect(new Set(rows.map((r) => r.state))).toEqual(new Set(["delivered"]));
  });

  it.skipIf(!canCreateIdentities)("lets a buyer with no account send one, and builds them an identity", async () => {
    // The README is explicit: requiring signup before the first enquiry is the
    // fastest way to kill the funnel.
    const result = await createEnquiry({
      buyerId: null,
      phone: BUYER_PHONE,
      fullName: BUYER_NAME,
      requirement: "One gate valve, DN100, collection from Al Quoz today if possible.",
      lines: [{ description: "Gate valve", qty: 1, size: "DN100" }],
      categoryId,
      emirate: "dubai",
      fanoutTo: 1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    createdEnquiryIds.push(result.enquiryId);

    const enquiry = await prisma.enquiry.findUniqueOrThrow({
      where: { id: result.enquiryId },
      select: { buyer: { select: { id: true, isProvisional: true, claimToken: true, roles: true } } },
    });
    createdUserIds.push(enquiry.buyer.id);

    expect(enquiry.buyer.isProvisional).toBe(true);
    expect(enquiry.buyer.claimToken).not.toBeNull();
    // It can own an enquiry and nothing else until it is claimed.
    expect(enquiry.buyer.roles).toEqual([]);
  });

  it("refuses an enquiry with no lines rather than sending an empty one", async () => {
    const result = await createEnquiry({
      buyerId,
      requirement: "Something",
      lines: [],
      categoryId,
      fanoutTo: 3,
    });
    expect(result).toEqual({ ok: false, error: "no_lines" });
  });

  it("never sends to more than eight, whatever is asked for", async () => {
    const result = await createEnquiry({
      buyerId,
      requirement: "Valves, large order, quotes from anyone who stocks them.",
      lines: lines(),
      categoryId,
      emirate: "dubai",
      fanoutTo: 40,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    createdEnquiryIds.push(result.enquiryId);
    expect(result.recipients.length).toBeLessThanOrEqual(8);
  });
});

describe("criterion 6 — a capped seller is not offered", () => {
  it("excludes a free-plan seller who has had their three this month", async () => {
    const candidates = await findFanoutCandidates({
      categoryId,
      categoryIds: await descendantsOf(categoryId),
      emirate: "dubai",
      lineCount: 2,
      want: 8,
    });
    /*
       A capped candidate with **room left**, not simply the first capped one.

       The test filled a seller's month and then asserted they dropped out of
       the list, which only proves anything if there was room to fill. It took
       the first capped candidate in ranking order, and the seed gives at least
       one capped supplier three enquiries already — so whether this test proved
       its criterion or asserted `0 > 0` depended on which supplier happened to
       rank first. It broke the day `lib/search/ranking.ts` and
       `lib/enquiry/fanout.ts` stopped dividing the verification tier by a
       ceiling the ladder no longer has, which reordered them.

       Chosen by headroom, so the fixture is the one the criterion needs.
    */
    const since = monthStart(new Date());
    const capped = candidates.filter((c) => c.enquiriesPerMonth !== null);
    expect(
      capped.length,
      "the seed needs at least one capped plan for this to prove anything",
    ).toBeGreaterThan(0);

    let free: (typeof capped)[number] | undefined;
    let already = 0;
    for (const candidate of capped) {
      const used = await prisma.enquiryRecipient.count({
        where: { businessId: candidate.businessId, createdAt: { gte: since } },
      });
      if (used < candidate.enquiriesPerMonth!) {
        free = candidate;
        already = used;
        break;
      }
    }
    expect(
      free,
      "every capped supplier in this category has already used its month; the seed needs one with room",
    ).toBeDefined();

    // Fill their month.
    const filler: string[] = [];
    for (let i = already; i < free!.enquiriesPerMonth!; i += 1) {
      const made = await createEnquiry({
        buyerId,
        requirement: `Filler enquiry ${i}`,
        lines: [{ description: "Gate valve", qty: 1, size: "DN100" }],
        categoryId,
        emirate: "dubai",
        fanoutTo: 8,
        pinnedBusinessIds: [free!.businessId],
      });
      if (made.ok) {
        createdEnquiryIds.push(made.enquiryId);
        filler.push(made.enquiryId);
      }
    }
    expect(filler.length).toBeGreaterThan(0);

    const after = await findFanoutCandidates({
      categoryId,
      categoryIds: await descendantsOf(categoryId),
      emirate: "dubai",
      lineCount: 2,
      want: 8,
    });
    const stillOffered = after.find((c) => c.businessId === free!.businessId);
    expect(stillOffered?.enquiriesThisMonth).toBeGreaterThanOrEqual(free!.enquiriesPerMonth!);

    const result = await createEnquiry({
      buyerId,
      requirement: "One more, after the cap",
      lines: lines(),
      categoryId,
      emirate: "dubai",
      fanoutTo: 8,
      pinnedBusinessIds: [free!.businessId],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    createdEnquiryIds.push(result.enquiryId);

    // The buyer's list simply has one fewer option, and never says why.
    expect(result.recipients.map((r) => r.businessId)).not.toContain(free!.businessId);
    expect(result.skipped).toContainEqual({ businessId: free!.businessId, reason: "at_monthly_cap" });
  });

  it("keeps a pinned supplier whose trade is not the one being asked about", async () => {
    /*
       The defect behind `/rfq/new?to=<slug>`: `selectRecipients` only sorts by
       pinned, so a supplier outside the requested category was never in the
       pool to be sorted and could not be a recipient. Every `?to=` link in the
       app omits `?category=`, so a buyer pressing "Request a quote" on a
       storefront got an enquiry that supplier was not on — silently, and with
       no skipped row to find afterwards.

       Asked here the hard way round: pick a supplier who is in no part of the
       category being enquired about, pin them, and require them back.
    */
    const within = await descendantsOf(categoryId);

    const outsider = await prisma.business.findFirstOrThrow({
      where: {
        publishedAt: { not: null },
        suspendedAt: null,
        claimStatus: "claimed",
        // Outside the trade on both counts — neither their primary category nor
        // any they also list in is part of what is being asked about.
        primaryCategoryId: { notIn: within },
        NOT: { categories: { some: { categoryId: { in: within } } } },
      },
      select: { id: true },
    });

    const candidates = await findFanoutCandidates({
      categoryId,
      categoryIds: within,
      emirate: "dubai",
      lineCount: 1,
      want: 8,
      pinned: [outsider.id],
    });
    expect(candidates.map((c) => c.businessId)).toContain(outsider.id);

    const result = await createEnquiry({
      buyerId,
      requirement: "Pinned from a storefront in another trade",
      lines: lines(),
      categoryId,
      emirate: "dubai",
      fanoutTo: 5,
      pinnedBusinessIds: [outsider.id],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    createdEnquiryIds.push(result.enquiryId);

    // The supplier the buyer actually clicked is on their own enquiry.
    expect(result.recipients.map((r) => r.businessId)).toContain(outsider.id);
  });
});

describe("the checkpoint — five sellers, two quotes, accept one", () => {
  it("releases the number to the accepted seller and to nobody else", async () => {
    const sent = await sendToFive();
    expect(sent.ok).toBe(true);
    if (!sent.ok) throw new Error("unreachable");

    const [winner, runnerUp, ...losers] = sent.recipients;
    expect(losers).toHaveLength(3);

    // Two of the five quote.
    const quotes = await Promise.all(
      [winner!, runnerUp!].map((seller, i) =>
        prisma.quote.create({
          data: {
            ref: `QT-TEST-${sent.ref}-${i}`,
            enquiryId: sent.enquiryId,
            businessId: seller.businessId,
            revision: 1,
            status: "sent",
            sentAt: new Date(),
            expiresAt: new Date(Date.now() + 14 * 86_400_000),
            lines: {
              create: [
                { description: "Gate valve DN100", qty: 24, unitPrice: i === 0 ? "398.00" : "412.00" },
              ],
            },
          },
          select: { id: true, businessId: true },
        }),
      ),
    );

    // Before acceptance, none of the five can see the number.
    for (const seller of sent.recipients) {
      const lead = await getLeadDetail(seller.businessId, sent.enquiryId);
      expect(lead?.buyer.released, seller.slug).toBe(false);
    }

    const accepted = await acceptQuote(buyerId, quotes[0]!.id);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) throw new Error("unreachable");
    expect(accepted.businessId).toBe(winner!.businessId);
    expect(accepted.declined).toBe(4);

    /*
     * The proof the checkpoint asks for. Read through the query layer the
     * screens use, for each of the four who did not win, and assert the
     * payload contains no phone, no email and no company name.
     */
    const buyer = await prisma.user.findUniqueOrThrow({
      where: { id: buyerId },
      select: { phone: true, email: true, buyerCompany: { select: { name: true } } },
    });
    const secrets = [buyer.phone, buyer.email, buyer.buyerCompany?.name].filter(
      (s): s is string => Boolean(s),
    );
    expect(secrets.length, "the seeded buyer needs contact details to prove anything").toBeGreaterThan(0);

    for (const seller of [runnerUp!, ...losers]) {
      const lead = await getLeadDetail(seller.businessId, sent.enquiryId);
      expect(lead?.buyer.released, seller.slug).toBe(false);
      const payload = JSON.stringify(lead);
      for (const secret of secrets) expect(payload, seller.slug).not.toContain(secret);

      // And through the inbox, which is the other way in.
      const inbox = await getLeadsForBusiness(seller.businessId);
      const row = inbox.find((l) => l.enquiryId === sent.enquiryId);
      for (const secret of secrets) expect(JSON.stringify(row ?? {})).not.toContain(secret);
    }

    // The one who won does see them.
    const winnerView = await getLeadDetail(winner!.businessId, sent.enquiryId);
    expect(winnerView?.buyer.released).toBe(true);
  });

  it("creates no order, payment or fulfilment row — criterion 3", async () => {
    const sent = await sendToFive();
    if (!sent.ok) throw new Error("unreachable");
    const seller = sent.recipients[0]!;
    const quote = await prisma.quote.create({
      data: {
        ref: `QT-TEST-${sent.ref}-only`,
        enquiryId: sent.enquiryId,
        businessId: seller.businessId,
        revision: 1,
        status: "sent",
        sentAt: new Date(),
        lines: { create: [{ description: "Gate valve DN100", qty: 24, unitPrice: "398.00" }] },
      },
      select: { id: true },
    });

    const before = await counts();
    const accepted = await acceptQuote(buyerId, quote.id);
    expect(accepted.ok).toBe(true);
    const after = await counts();

    // Acceptance is the terminal state. Nothing is created after it.
    expect(after.invoice).toBe(before.invoice);
    expect(after.invoiceLine).toBe(before.invoiceLine);
    expect(after.quote).toBe(before.quote);
    expect(after.quoteLine).toBe(before.quoteLine);
    expect(after.enquiry).toBe(before.enquiry);
    expect(after.enquiryRecipient).toBe(before.enquiryRecipient);
    expect(after.message).toBe(before.message);
    expect(after.review).toBe(before.review);
    expect(after.subscription).toBe(before.subscription);
  });

  it("refuses a second acceptance rather than moving the release", async () => {
    const sent = await sendToFive();
    if (!sent.ok) throw new Error("unreachable");
    const [a, b] = sent.recipients;
    const made = await Promise.all(
      [a!, b!].map((seller, i) =>
        prisma.quote.create({
          data: {
            ref: `QT-TEST-${sent.ref}-dup${i}`,
            enquiryId: sent.enquiryId,
            businessId: seller.businessId,
            revision: 1,
            status: "sent",
            sentAt: new Date(),
            lines: { create: [{ description: "Gate valve", qty: 1, unitPrice: "400.00" }] },
          },
          select: { id: true },
        }),
      ),
    );

    expect((await acceptQuote(buyerId, made[0]!.id)).ok).toBe(true);
    expect(await acceptQuote(buyerId, made[1]!.id)).toEqual({ ok: false, error: "already_accepted" });

    const enquiry = await prisma.enquiry.findUniqueOrThrow({ where: { id: sent.enquiryId } });
    expect(enquiry.contactReleasedToBusinessId).toBe(a!.businessId);
  });

  it("refuses acceptance by somebody who is not the buyer", async () => {
    const sent = await sendToFive();
    if (!sent.ok) throw new Error("unreachable");
    const quote = await prisma.quote.create({
      data: {
        ref: `QT-TEST-${sent.ref}-other`,
        enquiryId: sent.enquiryId,
        businessId: sent.recipients[0]!.businessId,
        revision: 1,
        status: "sent",
        sentAt: new Date(),
        lines: { create: [{ description: "Gate valve", qty: 1, unitPrice: "400.00" }] },
      },
      select: { id: true },
    });
    const stranger = await prisma.user.findFirstOrThrow({
      where: { id: { not: buyerId }, roles: { has: "seller_owner" } },
      select: { id: true },
    });
    // Somebody else's enquiry and a missing one are the same answer.
    expect(await acceptQuote(stranger.id, quote.id)).toEqual({ ok: false, error: "not_found" });
  });
});

async function counts() {
  const [invoice, invoiceLine, quote, quoteLine, enquiry, enquiryRecipient, message, review, subscription] =
    await Promise.all([
      prisma.invoice.count(),
      prisma.invoiceLine.count(),
      prisma.quote.count(),
      prisma.quoteLine.count(),
      prisma.enquiry.count(),
      prisma.enquiryRecipient.count(),
      prisma.message.count(),
      prisma.review.count(),
      prisma.subscription.count(),
    ]);
  return { invoice, invoiceLine, quote, quoteLine, enquiry, enquiryRecipient, message, review, subscription };
}

describe("a sector's RFQ reaches the suppliers filed under its subcategories", () => {
  /*
     Found in handoff 5 step 2, and live in `main` until then.

     `findFanoutCandidates` matched `primaryCategoryId` against the requested
     id exactly, while search has covered a category and its children since
     handoff 1 through `categoryIdsFor`. Nothing showed it because the seed
     filed all 40 businesses against the six sectors and none against the four
     subcategories — so the set the fan-out was missing was empty.

     A buyer asking "Valves & fittings" for a chilled water riser plainly means
     the gate-valve suppliers as well. Missing them is their requirement not
     reaching a supplier who sells exactly the thing.
  */
  it("offers a supplier whose primary category is a child of the one asked for", async () => {
    const children = await prisma.category.findMany({
      where: { parentId: categoryId },
      select: { id: true },
    });
    expect(children.length, "the seed has no subcategories to test with").toBeGreaterThan(0);

    const childIds = children.map((child) => child.id);
    const filedUnderChild = await prisma.business.findMany({
      where: {
        primaryCategoryId: { in: childIds },
        claimStatus: "claimed",
        publishedAt: { not: null },
        suspendedAt: null,
      },
      select: { id: true },
    });
    expect(
      filedUnderChild.length,
      "no claimed listing is filed under a subcategory, so this proves nothing",
    ).toBeGreaterThan(0);

    const candidates = await findFanoutCandidates({
      categoryId,
      categoryIds: await descendantsOf(categoryId),
      emirate: "dubai",
      lineCount: 2,
      want: 8,
    });

    const offered = new Set(candidates.map((candidate) => candidate.businessId));
    expect(filedUnderChild.some((business) => offered.has(business.id))).toBe(true);
  }, 60_000);

  it("scores an exact match above a subcategory of it", async () => {
    const candidates = await findFanoutCandidates({
      categoryId,
      categoryIds: await descendantsOf(categoryId),
      emirate: "dubai",
      lineCount: 2,
      want: 8,
    });
    const exact = candidates.find((c) => c.primaryCategoryId === categoryId);
    const child = candidates.find((c) => c.primaryCategoryId !== categoryId);
    if (!exact || !child) return;

    const request = {
      categoryId,
      categoryIds: await descendantsOf(categoryId),
      emirate: "dubai",
      lineCount: 2,
      want: 8,
    };
    // Same candidate twice, differing only in where it is filed, so the
    // comparison is of the category term and nothing else.
    const asExact = scoreCandidate({ ...exact, primaryCategoryId: categoryId }, request);
    const asChild = scoreCandidate({ ...exact, primaryCategoryId: child.primaryCategoryId }, request);
    expect(asExact).toBeGreaterThan(asChild);
  }, 60_000);
});
