import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { createEnquiry } from "@/lib/enquiry/service";
import { addSuppliers, additionalSuppliersFor } from "@/lib/enquiry/add-recipients";

/**
 * Board 1i — *Add two more suppliers*, against a database.
 *
 * What a unit test cannot reach: that the matcher re-runs with every current
 * recipient excluded, so nobody is sent the same enquiry twice; that the ticks
 * are intersected rather than trusted and a capped supplier is recorded and not
 * delivered to; that the cap of eight holds on the write; and that a closed,
 * accepted or someone else's enquiry is refused before anything is matched.
 *
 * A goods trade of its own, so the seed's suppliers cannot move a count.
 */

const PREFIX = "add-1i-";
let seq = 0;
const stamp = () => `${Date.now().toString(36)}${(seq += 1)}`;

const businesses: string[] = [];
const users: string[] = [];
let tradeId: string;
let buyerId: string;
let otherBuyerId: string;
let capPlan: { id: string; cap: number } | null = null;

async function makeFirm(fields: { plan?: string; replyMs?: number } = {}) {
  const mark = stamp();
  const firm = await prisma.business.create({
    data: {
      displayName: `${PREFIX}${mark}`,
      tradeName: `${PREFIX}${mark} LLC`,
      slug: `${PREFIX}${mark}`,
      licenceNumber: `DED-A${mark.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
      primaryCategoryId: tradeId,
      claimStatus: "claimed",
      publishedAt: new Date(),
      verificationTier: 2,
      ...(fields.replyMs !== undefined ? { responseTimeMedianMs: fields.replyMs } : {}),
      ...(fields.plan ? { planId: fields.plan } : {}),
    },
    select: { id: true, displayName: true },
  });
  businesses.push(firm.id);
  return firm;
}

async function send(fanoutTo: number, over: { closesInDays?: number } = {}) {
  const result = await createEnquiry({
    buyerId,
    requirement: `${PREFIX}Isolation valves for a chilled water riser.`,
    lines: [{ description: "Gate valve, flanged", qty: 24 }],
    categoryId: tradeId,
    emirate: "dubai",
    fanoutTo,
    ...(over.closesInDays ? { closesInDays: over.closesInDays } : {}),
  });
  if (!result.ok) throw new Error(`send failed: ${result.error}`);
  return result;
}

const recipientsOf = async (enquiryId: string) =>
  (await prisma.enquiryRecipient.findMany({ where: { enquiryId }, select: { businessId: true } })).map((r) => r.businessId);

beforeAll(async () => {
  const mark = stamp();
  const trade = await prisma.category.create({
    data: { name: `${PREFIX}trade`, slug: `${PREFIX}trade-${mark}`, code: "AT", tradeKind: "goods" },
    select: { id: true },
  });
  tradeId = trade.id;

  const plan = await prisma.plan.findFirst({ where: { enquiriesPerMonth: { not: null } }, select: { id: true, enquiriesPerMonth: true } });
  capPlan = plan?.enquiriesPerMonth ? { id: plan.id, cap: plan.enquiriesPerMonth } : null;

  buyerId = randomUUID();
  otherBuyerId = randomUUID();
  await prisma.user.createMany({
    data: [
      { id: buyerId, fullName: "Khalid Al Nuaimi", roles: ["buyer"] },
      { id: otherBuyerId, fullName: "Someone Else", roles: ["buyer"] },
    ],
  });
  users.push(buyerId, otherBuyerId);
});

afterAll(async () => {
  await prisma.enquiry.deleteMany({ where: { requirement: { startsWith: PREFIX } } });
  await prisma.business.deleteMany({ where: { id: { in: businesses } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.category.deleteMany({ where: { id: tradeId } });
});

describe("additionalSuppliersFor — who the link offers", () => {
  it("offers two suppliers from the same trade, and nobody already on the enquiry", async () => {
    for (let i = 0; i < 6; i += 1) await makeFirm();
    const sent = await send(3);

    const state = await additionalSuppliersFor(buyerId, sent.ref);
    expect(state.ok).toBe(true);
    if (!state.ok) return;
    expect(state).toMatchObject({ sent: 3, wanted: 2 });
    expect(state.suppliers).toHaveLength(2);
    const already = await recipientsOf(sent.enquiryId);
    for (const supplier of state.suppliers) expect(already).not.toContain(supplier.businessId);
  });

  it("is the same 404 for somebody else's enquiry as for none", async () => {
    const sent = await send(1);
    expect(await additionalSuppliersFor(otherBuyerId, sent.ref)).toEqual({ ok: false, reason: "not_found" });
    expect(await additionalSuppliersFor(buyerId, "ENQ-0")).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses a closed or accepted enquiry, and a brief", async () => {
    const closed = await send(1);
    await prisma.enquiry.update({ where: { id: closed.enquiryId }, data: { closesAt: new Date(Date.now() - 60_000) } });
    expect(await additionalSuppliersFor(buyerId, closed.ref)).toEqual({ ok: false, reason: "closed" });

    const accepted = await send(1);
    const [firstRecipient] = await recipientsOf(accepted.enquiryId);
    await prisma.enquiry.update({
      where: { id: accepted.enquiryId },
      data: { contactReleasedToBusinessId: firstRecipient!, contactReleasedAt: new Date() },
    });
    expect(await additionalSuppliersFor(buyerId, accepted.enquiryId)).toEqual({ ok: false, reason: "accepted" });

    const brief = await send(1);
    await prisma.serviceBrief.create({
      data: { enquiryId: brief.enquiryId, categoryId: tradeId, engagementType: "one_off_job", startMode: "asap" },
    });
    expect(await additionalSuppliersFor(buyerId, brief.ref)).toEqual({ ok: false, reason: "brief" });
  });

  it("never pads: when nobody else matches, it offers nobody", async () => {
    const sent = await send(8);
    // Everyone left in the trade is now on an enquiry of eight — or there are
    // fewer than eight and all of them are. Either way nobody can be added.
    const state = await additionalSuppliersFor(buyerId, sent.ref);
    if (!state.ok) {
      expect(state.reason).toBe("full");
      return;
    }
    const inTrade = await prisma.business.count({ where: { primaryCategoryId: tradeId } });
    expect(state.suppliers.length).toBeLessThanOrEqual(Math.max(0, inTrade - state.sent));
    const already = await recipientsOf(sent.enquiryId);
    for (const supplier of state.suppliers) expect(already).not.toContain(supplier.businessId);
  });
});

describe("addSuppliers — the send", () => {
  it("adds exactly the ticked suppliers, never a substitute for one unticked", async () => {
    for (let i = 0; i < 4; i += 1) await makeFirm();
    const sent = await send(2);
    const state = await additionalSuppliersFor(buyerId, sent.ref);
    if (!state.ok) throw new Error(state.reason);
    const [keep, drop] = state.suppliers;

    const result = await addSuppliers({ buyerId, refOrId: sent.ref, chosenBusinessIds: [keep!.businessId] });
    expect(result).toMatchObject({ ok: true, added: 1 });

    const after = await recipientsOf(sent.enquiryId);
    expect(after).toHaveLength(3);
    expect(after).toContain(keep!.businessId);
    if (drop) expect(after).not.toContain(drop.businessId);

    // A ticked id the matcher would not offer — already a recipient — adds nothing.
    expect(await addSuppliers({ buyerId, refOrId: sent.ref, chosenBusinessIds: [after[0]!] })).toEqual({
      ok: false,
      reason: "none_available",
    });
    expect(await addSuppliers({ buyerId, refOrId: sent.ref, chosenBusinessIds: [] })).toEqual({
      ok: false,
      reason: "none_chosen",
    });
  });

  it("records a supplier at their monthly cap as missed and does not deliver to them — D4", async () => {
    if (!capPlan) return;
    const sent = await send(1);
    // A supplier who would rank first — fastest reply — but has no room this month.
    const capped = await makeFirm({ plan: capPlan.id, replyMs: 60_000 });
    for (let i = 0; i < capPlan.cap; i += 1) {
      await prisma.enquiry.create({
        data: {
          ref: `ENQ-${PREFIX}${stamp()}`,
          buyerId,
          requirement: `${PREFIX}filler`,
          closesAt: new Date(Date.now() + 86_400_000),
          recipients: { create: { businessId: capped.id } },
        },
      });
    }

    const state = await additionalSuppliersFor(buyerId, sent.ref);
    if (!state.ok) throw new Error(state.reason);
    expect(state.suppliers.map((s) => s.businessId)).not.toContain(capped.id);

    const result = await addSuppliers({
      buyerId,
      refOrId: sent.enquiryId,
      chosenBusinessIds: [...state.suppliers.map((s) => s.businessId), capped.id],
    });
    expect(result.ok).toBe(true);
    expect(await recipientsOf(sent.enquiryId)).not.toContain(capped.id);
    const missed = await prisma.missedEnquiry.findMany({ where: { enquiryId: sent.enquiryId }, select: { businessId: true, reason: true } });
    expect(missed).toContainEqual({ businessId: capped.id, reason: "at_monthly_cap" });
  });

  it("holds the cap at eight, and refuses once it is reached", async () => {
    for (let i = 0; i < 8; i += 1) await makeFirm();
    const sent = await send(7);
    const state = await additionalSuppliersFor(buyerId, sent.ref);
    if (!state.ok) throw new Error(state.reason);
    expect(state.wanted).toBe(1);
    expect(state.suppliers).toHaveLength(1);

    const result = await addSuppliers({ buyerId, refOrId: sent.ref, chosenBusinessIds: state.suppliers.map((s) => s.businessId) });
    expect(result).toMatchObject({ ok: true, added: 1 });
    expect(await recipientsOf(sent.enquiryId)).toHaveLength(8);

    expect(await additionalSuppliersFor(buyerId, sent.ref)).toEqual({ ok: false, reason: "full" });
    expect(await addSuppliers({ buyerId, refOrId: sent.ref, chosenBusinessIds: ["anyone"] })).toEqual({ ok: false, reason: "full" });
  });

  it("offers as many as declined when every supplier declined", async () => {
    for (let i = 0; i < 4; i += 1) await makeFirm();
    const sent = await send(3);
    await prisma.enquiryRecipient.updateMany({ where: { enquiryId: sent.enquiryId }, data: { state: "declined" } });
    const state = await additionalSuppliersFor(buyerId, sent.ref);
    if (!state.ok) throw new Error(state.reason);
    expect(state.wanted).toBe(3);
  });
});
