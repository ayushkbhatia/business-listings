import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import type { Actor } from "@/lib/auth/roles";
import { acceptQuote, createEnquiry } from "@/lib/enquiry/service";
import { sendQuoteForBusiness, type SendQuoteInput } from "@/lib/quote/send-quote";
import {
  addAddress,
  archiveAddress,
  createCompany,
  setDefaultAddress,
  setRuleFlag,
  updateDetails,
  updateRule,
} from "@/lib/buyer-company/service";
import {
  acceptCompanyInvite,
  changeSeat,
  deactivateMember,
  inviteMember,
  leaveCompany,
  readCompanyInvite,
  resendInvite,
  revokeInvite,
} from "@/lib/buyer-company/team-service";
import { answerQuery, approveRequest, queryRequest, requestApproval, withdrawRequest } from "@/lib/buyer-company/approvals";
import { acceptanceOutlook, approvalDetail, approvalQueue, approversFor, companyAccount, companyHistory } from "@/lib/buyer-company/queue";
import { monthSpend } from "@/lib/buyer-company/store";
import { parseSnapshot } from "@/lib/buyer-company/address";

/**
 * Board `7b` against a real database.
 *
 * The gate is a transaction-shaped rule: the threshold, the person's authority
 * and the month's spend are read under the company lock in the same
 * transaction as the acceptance's claim. Only Postgres shows that two
 * acceptances a second apart cannot both fit under a limit with room for one,
 * that the mirror follows the membership, and that the history refuses edits.
 *
 * ## Fixtures
 *
 * One company per `describe`, set up through `createCompany` so the path under
 * test is the path production takes; people of the file's own; two seeded Pro
 * sellers with owner seats who send real quotes. Everything is deleted by the
 * `PREFIX` at the end — companies cascade their members, invitations,
 * addresses, requests and history; users cascade their enquiries.
 */

const PREFIX = "7B-COMPANY-FIXTURE";
const people: string[] = [];
const companies: string[] = [];

let a: { id: string; actor: Actor };
let b: { id: string; actor: Actor };

async function seller(slug: string) {
  const business = await prisma.business.findFirstOrThrow({ where: { slug }, select: { id: true } });
  const seat = await prisma.user.findFirstOrThrow({
    where: { businessId: business.id, roles: { has: "seller_owner" } },
    orderBy: { id: "asc" },
    select: { id: true, roles: true },
  });
  return { id: business.id, actor: { id: seat.id, roles: seat.roles, businessId: business.id } as Actor };
}

async function person(name: string, email?: string): Promise<string> {
  const id = randomUUID();
  await prisma.user.create({
    data: {
      id,
      fullName: `${name} (${PREFIX})`,
      email: email ?? `${id.slice(0, 8)}@${PREFIX.toLowerCase()}.example`,
      roles: ["buyer"],
    },
  });
  people.push(id);
  return id;
}

/** A company with an admin, set up the way the page does it. */
async function company(label: string) {
  const admin = await person(`${label} admin`);
  const created = await createCompany(admin, { name: `${label} ${PREFIX} Trading`, trn: "100 4482 1690 0003" });
  if (!created.ok) throw new Error(`company fixture: ${created.error}`);
  companies.push(created.companyId);
  return { companyId: created.companyId, admin };
}

/** A member added straight to the record — the invitation path has tests of its own. */
async function seat(companyId: string, role: "company_admin" | "procurement" | "requester", limit: number | null = null) {
  const id = await person(`${role} ${people.length}`);
  await prisma.buyerCompanyMember.create({ data: { companyId, userId: id, role, monthlyLimitAed: limit } });
  return id;
}

/** An open enquiry raised for the company, sent to both sellers, and a quote from `a` at `total` over three lines. */
async function quotedEnquiry(buyerId: string, companyId: string, total: number) {
  // Three lines that sum to the total exactly: the gate compares fils.
  const fils = total * 100;
  const part = Math.floor(fils / 3);
  const prices = [part, part, fils - 2 * part].map((f) => (f / 100).toFixed(2));
  const e = await prisma.enquiry.create({
    data: {
      ref: `ENQ-${PREFIX}-${randomUUID().slice(0, 8)}`,
      buyerId,
      buyerCompanyId: companyId,
      requirement: `${PREFIX} three lines of grooved couplings.`,
      closesAt: new Date(Date.now() + 5 * 86_400_000),
      lines: {
        create: [0, 1, 2].map((i) => ({ description: `${PREFIX} line ${i}`, qty: 1, unit: "lot", sortOrder: i })),
      },
      recipients: { create: [{ businessId: a.id }, { businessId: b.id }] },
    },
    select: { id: true, lines: { select: { id: true }, orderBy: { sortOrder: "asc" } } },
  });
  const input: SendQuoteInput = {
    enquiryId: e.id,
    note: "",
    validityDays: 14,
    paymentTerms: "net_30",
    delivery: "included",
    lines: e.lines.map((line, i) => ({
      enquiryLineId: line.id,
      productId: null,
      description: `${PREFIX} line ${i}`,
      qty: 1,
      unitPrice: prices[i]!,
      leadTimeDays: 3,
    })),
  };
  const sent = await sendQuoteForBusiness(a.actor, a.id, input);
  if (!sent.ok) throw new Error(`quote fixture: ${sent.error}`);
  return { enquiryId: e.id, quoteId: sent.quoteId, input };
}

beforeAll(async () => {
  a = await seller("al-waha-industrial-supplies");
  b = await seller("copperfield-industrial-supplies-llc");
});

afterAll(async () => {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.buyer_company_maintenance', 'on', true)`;
    await tx.buyerCompanyEvent.deleteMany({ where: { companyId: { in: companies } } });
  });
  await prisma.enquiry.deleteMany({ where: { requirement: { contains: PREFIX } } });
  await prisma.buyerCompany.deleteMany({ where: { id: { in: companies } } });
  await prisma.user.deleteMany({ where: { id: { in: people } } });
  await prisma.$disconnect();
});

/* ── The company ───────────────────────────────────────────────────────────── */

describe("setting up a company", () => {
  it("makes the person its admin, mirrors the membership onto the user, and records it", async () => {
    const { companyId, admin } = await company("setup");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: admin }, select: { buyerCompanyId: true } });
    expect(user.buyerCompanyId).toBe(companyId);
    const member = await prisma.buyerCompanyMember.findFirstOrThrow({ where: { userId: admin, deactivatedAt: null } });
    expect(member.role).toBe("company_admin");
    const row = await prisma.buyerCompany.findUniqueOrThrow({ where: { id: companyId }, select: { trn: true } });
    // Spaces are a display concern; the column holds fifteen digits.
    expect(row.trn).toBe("100448216900003");
    const events = await prisma.buyerCompanyEvent.findMany({ where: { companyId } });
    expect(events.map((e) => e.kind)).toEqual(["company_created"]);
  });

  it("refuses a second company for somebody who already has one", async () => {
    const { admin } = await company("twice");
    expect(await createCompany(admin, { name: "Another one" })).toMatchObject({ ok: false, error: "already_member" });
  });

  it("refuses a TRN that is not fifteen digits, and says which field", async () => {
    const someone = await person("bad trn");
    const result = await createCompany(someone, { name: "Bad TRN Trading", trn: "10044821690003" });
    expect(result).toMatchObject({ ok: false, error: "invalid", errors: { trn: "invalid" } });
  });
});

describe("the mirror is the membership's", () => {
  it("refuses a direct write to user.buyer_company_id", async () => {
    const { companyId } = await company("mirror");
    const outsider = await person("outsider");
    await expect(
      prisma.user.update({ where: { id: outsider }, data: { buyerCompanyId: companyId } }),
    ).rejects.toThrow(/follows buyer_company_member/);
  });

  it("clears on deactivation and follows a new membership", async () => {
    const { companyId, admin } = await company("follow");
    const member = await seat(companyId, "requester");
    expect(await deactivateMember(admin, (await prisma.buyerCompanyMember.findFirstOrThrow({ where: { userId: member } })).id)).toEqual({ ok: true });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: member } })).buyerCompanyId).toBeNull();
  });
});

describe("details", () => {
  it("records what changed, and only that", async () => {
    const { companyId, admin } = await company("details");
    const result = await updateDetails(admin, {
      name: `details ${PREFIX} Trading`,
      trn: "100448216900003",
      licenceNumber: "ded-772104",
      accountsEmail: "Accounts@Example.AE",
    });
    expect(result).toEqual({ ok: true, changed: ["licenceNumber", "accountsEmail"] });
    const row = await prisma.buyerCompany.findUniqueOrThrow({ where: { id: companyId } });
    expect(row.licenceNumber).toBe("DED-772104");
    expect(row.accountsEmail).toBe("accounts@example.ae");
    const event = await prisma.buyerCompanyEvent.findFirstOrThrow({ where: { companyId, kind: "details_changed" } });
    expect(event.before).toEqual({ licenceNumber: null, accountsEmail: null });
    expect(event.after).toEqual({ licenceNumber: "DED-772104", accountsEmail: "accounts@example.ae" });
  });

  it("refuses a member who is not an admin", async () => {
    const { companyId } = await company("not-admin");
    const member = await seat(companyId, "procurement", 10_000);
    expect(await updateDetails(member, { name: "Mine now" })).toEqual({ ok: false, error: "not_admin" });
  });

  it("keeps the history append-only", async () => {
    const { companyId } = await company("history");
    const event = await prisma.buyerCompanyEvent.findFirstOrThrow({ where: { companyId } });
    await expect(
      prisma.buyerCompanyEvent.update({ where: { id: event.id }, data: { note: "edited" } }),
    ).rejects.toThrow(/not edited/);
    await expect(prisma.buyerCompanyEvent.delete({ where: { id: event.id } })).rejects.toThrow(/not deleted/);
  });
});

describe("delivery addresses", () => {
  const site = {
    label: "Site store",
    addressLine: "JLT Cluster D basement",
    emirate: "dubai",
    accessUntil: "11:00",
    loadLimit: "small_parcels",
  };

  it("makes the first address the default, and moves the default on request", async () => {
    const { companyId, admin } = await company("addresses");
    const first = await addAddress(admin, { label: "Marina Plaza", addressLine: "Tower 2, Level 14", emirate: "dubai", accessFrom: "07:00", accessUntil: "17:00" });
    const second = await addAddress(admin, site);
    if (!first.ok || !second.ok) throw new Error("address fixture");
    const rows = await prisma.buyerDeliveryAddress.findMany({ where: { companyId }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.isDefault)).toEqual([true, false]);
    expect(rows[1]).toMatchObject({ accessFrom: null, accessUntil: 660, loadLimit: "small_parcels" });

    // The default cannot go while another could take its place.
    expect(await archiveAddress(admin, first.addressId)).toEqual({ ok: false, error: "default_needs_replacement" });
    expect(await setDefaultAddress(admin, second.addressId)).toMatchObject({ ok: true });
    expect(await archiveAddress(admin, first.addressId)).toMatchObject({ ok: true });
    const after = await prisma.buyerDeliveryAddress.findMany({ where: { companyId }, orderBy: { createdAt: "asc" } });
    expect(after.map((r) => [r.isDefault, r.archivedAt !== null])).toEqual([[false, true], [true, false]]);
  });

  it("refuses a window that ends before it starts", async () => {
    const { admin } = await company("window");
    expect(await addAddress(admin, { ...site, accessFrom: "12:00", accessUntil: "11:00" })).toMatchObject({
      ok: false,
      error: "invalid",
      errors: { accessUntil: "window_order" },
    });
  });

  it("puts the address on an enquiry as a snapshot, and routes on its emirate", async () => {
    const { companyId, admin } = await company("snapshot");
    const added = await addAddress(admin, { ...site, attnName: "Joseph D'Souza", attnPhone: "050 220 1188" });
    if (!added.ok) throw new Error("address fixture");
    const category = await prisma.category.findFirstOrThrow({ where: { parentId: { not: null } }, select: { id: true }, orderBy: { id: "asc" } });
    const result = await createEnquiry({
      buyerId: admin,
      requirement: `${PREFIX} gaskets for the site store, delivered before eleven.`,
      lines: [{ description: `${PREFIX} gasket`, qty: 10 }],
      categoryId: category.id,
      emirate: "sharjah",
      deliveryAddressId: added.addressId,
      fanoutTo: 1,
      selection: { recipients: [{ businessId: a.id, slug: "al-waha-industrial-supplies", displayName: "Al Waha" }], skipped: [] },
    } as never);
    if (!result.ok) throw new Error(`enquiry: ${result.error}`);
    const row = await prisma.enquiry.findUniqueOrThrow({ where: { id: result.enquiryId } });
    expect(row.buyerCompanyId).toBe(companyId);
    expect(row.deliveryAddressId).toBe(added.addressId);
    // The address decides the emirate, not what the form also posted.
    expect(row.emirate).toBe("dubai");
    const snapshot = parseSnapshot(row.deliverySnapshot);
    expect(snapshot).toMatchObject({ label: "Site store", accessUntil: 660, loadLimit: "small_parcels", attnPhone: "+971502201188" });
  });
});

/* ── The gate ──────────────────────────────────────────────────────────────── */

describe("accepting a quote on a company enquiry", () => {
  it("lets procurement accept inside their month, and counts it against them", async () => {
    const { companyId } = await company("inside");
    const priya = await seat(companyId, "procurement", 25_000);
    const q = await quotedEnquiry(priya, companyId, 15_624);
    expect(await acceptQuote(priya, q.quoteId)).toMatchObject({ ok: true });
    const spend = await monthSpend(prisma, companyId, new Date());
    expect(spend.byPerson.get(priya)).toBe(1_562_400n);
    const event = await prisma.buyerCompanyEvent.findFirstOrThrow({ where: { companyId, kind: "quote_accepted" } });
    expect(event.actorId).toBe(priya);
  });

  it("holds the one that would take them past the limit, and routes it to someone whose authority covers it", async () => {
    const { companyId, admin } = await company("beyond");
    const priya = await seat(companyId, "procurement", 25_000);
    const first = await quotedEnquiry(priya, companyId, 12_400);
    expect(await acceptQuote(priya, first.quoteId)).toMatchObject({ ok: true });

    // The board's row: AED 15,624 raised by Priya, inside the threshold, beyond her month.
    const second = await quotedEnquiry(priya, companyId, 15_624);
    expect(await acceptQuote(priya, second.quoteId)).toEqual({ ok: false, error: "approval_required" });
    const requested = await requestApproval(priya, second.quoteId, { note: "Site needs it Sunday." });
    if (!requested.ok) throw new Error(requested.error);
    const request = await prisma.quoteApproval.findUniqueOrThrow({ where: { id: requested.approvalId } });
    expect(request.reasons).toEqual(["over_limit"]);
    expect(request.valueFils).toBe(1_562_400n);
    expect(await approversFor(requested.approvalId)).toEqual([admin]);

    // Nobody approves their own request.
    expect(await approveRequest(priya, requested.approvalId)).toMatchObject({ ok: false, error: "not_approver" });

    const approved = await approveRequest(admin, requested.approvalId);
    expect(approved).toMatchObject({ ok: true, outcome: "approved" });
    const enquiry = await prisma.enquiry.findUniqueOrThrow({ where: { id: second.enquiryId } });
    expect(enquiry.contactReleasedToBusinessId).toBe(a.id);
    // Committed on the approver's authority, not the raiser's.
    const spend = await monthSpend(prisma, companyId, new Date());
    expect(spend.byPerson.get(priya)).toBe(1_240_000n);
    expect(spend.byPerson.get(admin)).toBe(1_562_400n);
  });

  it("sends everything a requester wants accepted for approval, which procurement may give within their own month", async () => {
    const { companyId } = await company("requester");
    const priya = await seat(companyId, "procurement", 25_000);
    const joseph = await seat(companyId, "requester");
    const q = await quotedEnquiry(joseph, companyId, 5_000);
    expect(await acceptQuote(joseph, q.quoteId)).toEqual({ ok: false, error: "approval_required" });
    const requested = await requestApproval(joseph, q.quoteId, {});
    if (!requested.ok) throw new Error(requested.error);
    expect((await prisma.quoteApproval.findUniqueOrThrow({ where: { id: requested.approvalId } })).reasons).toEqual(["no_authority"]);
    expect(await approveRequest(priya, requested.approvalId)).toMatchObject({ ok: true });
    expect((await monthSpend(prisma, companyId, new Date())).byPerson.get(priya)).toBe(500_000n);
  });

  it("sends a quote over the threshold to the named approver and nobody else", async () => {
    const { companyId, admin } = await company("threshold");
    const second = await seat(companyId, "company_admin");
    const priya = await seat(companyId, "procurement", 100_000);
    expect(await updateRule(admin, { thresholdAed: "25000", approverId: admin })).toEqual({ ok: true });
    const q = await quotedEnquiry(priya, companyId, 30_000);
    const requested = await requestApproval(priya, q.quoteId, {});
    if (!requested.ok) throw new Error(requested.error);
    expect(await approversFor(requested.approvalId)).toEqual([admin]);
    expect(await approveRequest(second, requested.approvalId)).toMatchObject({ ok: false, error: "not_approver" });
    expect(await approveRequest(admin, requested.approvalId)).toMatchObject({ ok: true });
  });

  it("will not let the named approver wave their own through, and says nobody can when there is no second admin", async () => {
    const { companyId, admin } = await company("own");
    expect(await updateRule(admin, { thresholdAed: "25000", approverId: admin })).toEqual({ ok: true });
    const q = await quotedEnquiry(admin, companyId, 30_000);
    expect(await acceptQuote(admin, q.quoteId)).toEqual({ ok: false, error: "approval_required" });
    expect(await requestApproval(admin, q.quoteId, {})).toEqual({ ok: false, error: "no_approver" });
    const account = await companyAccount(admin);
    expect(account?.ruleFacts.approverHasNoCover).toBe(true);

    // A second admin covers it.
    const cover = await seat(companyId, "company_admin");
    const requested = await requestApproval(admin, q.quoteId, {});
    if (!requested.ok) throw new Error(requested.error);
    expect(await approversFor(requested.approvalId)).toEqual([cover]);
  });

  it("asks for a PO number and a cost code when the company requires them, and writes them with the acceptance", async () => {
    const { companyId, admin } = await company("po");
    await setRuleFlag(admin, "requirePoNumber", true);
    await setRuleFlag(admin, "requireCostCode", true);
    const q = await quotedEnquiry(admin, companyId, 1_000);
    expect(await acceptQuote(admin, q.quoteId)).toEqual({ ok: false, error: "po_required" });
    expect(await acceptQuote(admin, q.quoteId, new Date(), { poNumber: "PO-2026-0418" })).toEqual({ ok: false, error: "cost_code_required" });
    expect(await acceptQuote(admin, q.quoteId, new Date(), { poNumber: " PO-2026-0418 ", costCode: "JLT-D-MEP" })).toMatchObject({ ok: true });
    const row = await prisma.enquiry.findUniqueOrThrow({ where: { id: q.enquiryId } });
    expect(row.buyerReference).toBe("PO-2026-0418");
    expect(row.costCode).toBe("JLT-D-MEP");
  });

  it("holds a quote from an unverified supplier when the company asks, at any value, even for an admin", async () => {
    const { companyId, admin } = await company("unverified");
    const cover = await seat(companyId, "company_admin");
    await setRuleFlag(admin, "unverifiedNeedsApproval", true);
    const before = await prisma.business.findUniqueOrThrow({ where: { id: a.id }, select: { verificationTier: true } });
    await prisma.business.update({ where: { id: a.id }, data: { verificationTier: 1 } });
    try {
      const q = await quotedEnquiry(admin, companyId, 500);
      expect(await acceptQuote(admin, q.quoteId)).toEqual({ ok: false, error: "approval_required" });
      const requested = await requestApproval(admin, q.quoteId, {});
      if (!requested.ok) throw new Error(requested.error);
      expect((await prisma.quoteApproval.findUniqueOrThrow({ where: { id: requested.approvalId } })).reasons).toEqual(["unverified_supplier"]);
      expect(await approversFor(requested.approvalId)).toEqual([cover]);
    } finally {
      await prisma.business.update({ where: { id: a.id }, data: { verificationTier: before.verificationTier } });
    }
  });

  it("lets two acceptances race and fits only the one the limit has room for", async () => {
    const { companyId } = await company("race");
    const priya = await seat(companyId, "procurement", 25_000);
    const one = await quotedEnquiry(priya, companyId, 15_000);
    const two = await quotedEnquiry(priya, companyId, 15_000);
    const results = await Promise.all([acceptQuote(priya, one.quoteId), acceptQuote(priya, two.quoteId)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error === "approval_required")).toHaveLength(1);
    expect((await monthSpend(prisma, companyId, new Date())).byPerson.get(priya)).toBe(1_500_000n);
  });

  it("refuses somebody who no longer buys for the company the enquiry was raised for", async () => {
    const { companyId, admin } = await company("left");
    const priya = await seat(companyId, "procurement", 25_000);
    const q = await quotedEnquiry(priya, companyId, 1_000);
    const member = await prisma.buyerCompanyMember.findFirstOrThrow({ where: { userId: priya, deactivatedAt: null } });
    await deactivateMember(admin, member.id);
    expect(await acceptQuote(priya, q.quoteId)).toEqual({ ok: false, error: "not_member" });
  });
});

describe("the request's life", () => {
  it("goes back with a question, comes back with an answer, and is approved", async () => {
    const { companyId, admin } = await company("query");
    const joseph = await seat(companyId, "requester");
    const q = await quotedEnquiry(joseph, companyId, 2_000);
    const requested = await requestApproval(joseph, q.quoteId, {});
    if (!requested.ok) throw new Error(requested.error);

    expect(await queryRequest(admin, requested.approvalId, "   ")).toEqual({ ok: false, error: "note_required" });
    expect(await queryRequest(admin, requested.approvalId, "Is delivery included?")).toEqual({ ok: true, outcome: "queried" });
    // Queried is not pending: nothing to approve until it is answered.
    expect(await approveRequest(admin, requested.approvalId)).toMatchObject({ ok: false, error: "approval_closed" });
    expect(await answerQuery(joseph, requested.approvalId, "Yes, and unloading.")).toEqual({ ok: true });
    expect(await approveRequest(admin, requested.approvalId)).toMatchObject({ ok: true, outcome: "approved" });

    const detail = await approvalDetail(joseph, requested.approvalId);
    expect(detail?.timeline.map((line) => line.kind)).toEqual([
      "approval_requested",
      "approval_queried",
      "approval_answered",
      "approval_approved",
    ]);
  });

  it("closes a request whose quote was revised underneath it, rather than approving a price nobody asked about", async () => {
    const { companyId, admin } = await company("revised");
    const joseph = await seat(companyId, "requester");
    const q = await quotedEnquiry(joseph, companyId, 3_000);
    const requested = await requestApproval(joseph, q.quoteId, {});
    if (!requested.ok) throw new Error(requested.error);
    const revised = await sendQuoteForBusiness(a.actor, a.id, {
      ...q.input,
      lines: q.input.lines.map((line) => ({ ...line, unitPrice: "1200.00" })),
    });
    expect(revised).toMatchObject({ ok: true });
    expect(await approveRequest(admin, requested.approvalId)).toMatchObject({ ok: false, error: "revised" });
    expect((await prisma.quoteApproval.findUniqueOrThrow({ where: { id: requested.approvalId } })).status).toBe("superseded");
  });

  it("replaces an open request when another quote on the enquiry is sent for approval, and withdraws on request", async () => {
    const { companyId } = await company("replace");
    const joseph = await seat(companyId, "requester");
    await seat(companyId, "company_admin");
    const q = await quotedEnquiry(joseph, companyId, 3_000);
    const fromB = await sendQuoteForBusiness(b.actor, b.id, q.input);
    if (!fromB.ok) throw new Error("quote b");
    const first = await requestApproval(joseph, q.quoteId, {});
    const second = await requestApproval(joseph, fromB.quoteId, {});
    if (!first.ok || !second.ok) throw new Error("requests");
    expect((await prisma.quoteApproval.findUniqueOrThrow({ where: { id: first.approvalId } })).status).toBe("superseded");
    expect(await withdrawRequest(joseph, second.approvalId)).toEqual({ ok: true });
    expect(await withdrawRequest(joseph, second.approvalId)).toEqual({ ok: false, error: "closed" });
  });

  it("keeps what was asked fixed, by trigger", async () => {
    const { companyId } = await company("fixed");
    const joseph = await seat(companyId, "requester");
    await seat(companyId, "company_admin");
    const q = await quotedEnquiry(joseph, companyId, 3_000);
    const requested = await requestApproval(joseph, q.quoteId, {});
    if (!requested.ok) throw new Error(requested.error);
    await expect(
      prisma.quoteApproval.update({ where: { id: requested.approvalId }, data: { valueFils: 1n } }),
    ).rejects.toThrow(/fixed once asked/);
    await withdrawRequest(joseph, requested.approvalId);
    await expect(
      prisma.quoteApproval.update({ where: { id: requested.approvalId }, data: { status: "pending" } }),
    ).rejects.toThrow(/not reopened/);
  });

  it("tells the raiser what will happen before they press anything, from the same rule", async () => {
    const { companyId } = await company("outlook");
    const priya = await seat(companyId, "procurement", 10_000);
    const q = await quotedEnquiry(priya, companyId, 12_000);
    const outlook = await acceptanceOutlook(priya, { id: q.enquiryId, buyerCompanyId: companyId }, q.quoteId);
    expect(outlook).toMatchObject({ kind: "company", need: { required: true, reasons: ["over_limit"] }, remainingAed: "10000.00" });
  });
});

/* ── The team ──────────────────────────────────────────────────────────────── */

describe("invitations", () => {
  it("seats the invited address in the invited role, and only that address", async () => {
    const { companyId, admin } = await company("invite");
    const email = `invitee-${randomUUID().slice(0, 6)}@${PREFIX.toLowerCase()}.example`;
    const sent = await inviteMember(admin, { fullName: "Priya Menon", email, role: "procurement", monthlyLimitAed: "25,000" });
    if (!sent.ok) throw new Error(sent.error);
    const token = sent.acceptUrl.split("/").pop()!;
    expect(await readCompanyInvite(token)).toMatchObject({ state: "invited", role: "procurement", monthlyLimitAed: 25_000 });

    const stranger = await person("stranger");
    expect(await acceptCompanyInvite(token, stranger)).toEqual({ ok: false, error: "wrong_account" });

    const invitee = await person("invitee", email);
    expect(await acceptCompanyInvite(token, invitee)).toEqual({ ok: true, companyId });
    expect(await acceptCompanyInvite(token, invitee)).toEqual({ ok: false, error: "used" });
    const member = await prisma.buyerCompanyMember.findFirstOrThrow({ where: { userId: invitee, deactivatedAt: null } });
    expect(member).toMatchObject({ role: "procurement", monthlyLimitAed: 25_000, invitedById: admin });
  });

  it("expires, and a resend replaces the link", async () => {
    const { admin } = await company("expiry");
    const email = `late-${randomUUID().slice(0, 6)}@${PREFIX.toLowerCase()}.example`;
    const long = new Date(Date.now() - 8 * 86_400_000);
    const sent = await inviteMember(admin, { fullName: "Late Invitee", email, role: "requester" }, long);
    if (!sent.ok) throw new Error(sent.error);
    const oldToken = sent.acceptUrl.split("/").pop()!;
    const invitee = await person("late", email);
    expect(await acceptCompanyInvite(oldToken, invitee)).toEqual({ ok: false, error: "expired" });

    const resent = await resendInvite(admin, sent.inviteId);
    if (!resent.ok) throw new Error(resent.error);
    expect(await acceptCompanyInvite(oldToken, invitee)).toEqual({ ok: false, error: "not_found" });
    expect(await acceptCompanyInvite(resent.acceptUrl.split("/").pop()!, invitee)).toMatchObject({ ok: true });
  });

  it("refuses a duplicate while one is outstanding, and a revoked link", async () => {
    const { admin } = await company("revoke");
    const email = `twice-${randomUUID().slice(0, 6)}@${PREFIX.toLowerCase()}.example`;
    const sent = await inviteMember(admin, { fullName: "Twice", email, role: "requester" });
    if (!sent.ok) throw new Error(sent.error);
    expect(await inviteMember(admin, { fullName: "Twice", email, role: "requester" })).toEqual({ ok: false, error: "already_invited" });
    expect(await revokeInvite(admin, sent.inviteId)).toEqual({ ok: true });
    const invitee = await person("revoked", email);
    expect(await acceptCompanyInvite(sent.acceptUrl.split("/").pop()!, invitee)).toEqual({ ok: false, error: "revoked" });
  });
});

describe("seats", () => {
  it("keeps the last admin and the named approver", async () => {
    const { companyId, admin } = await company("seats");
    const mine = await prisma.buyerCompanyMember.findFirstOrThrow({ where: { userId: admin, deactivatedAt: null } });
    expect(await changeSeat(admin, mine.id, { role: "requester" })).toEqual({ ok: false, error: "last_admin" });
    expect(await leaveCompany(admin)).toEqual({ ok: false, error: "last_admin" });

    const other = await seat(companyId, "company_admin");
    await updateRule(admin, { thresholdAed: "10000", approverId: other });
    const theirs = await prisma.buyerCompanyMember.findFirstOrThrow({ where: { userId: other, deactivatedAt: null } });
    expect(await deactivateMember(admin, theirs.id)).toEqual({ ok: false, error: "is_approver" });
    expect(await changeSeat(admin, theirs.id, { role: "procurement", monthlyLimitAed: "5000" })).toEqual({ ok: false, error: "is_approver" });
  });

  it("withdraws a departing member's open request, so nobody accepts a quote in their name", async () => {
    const { companyId, admin } = await company("depart");
    const joseph = await seat(companyId, "requester");
    const q = await quotedEnquiry(joseph, companyId, 800);
    const requested = await requestApproval(joseph, q.quoteId, {});
    if (!requested.ok) throw new Error(requested.error);
    const member = await prisma.buyerCompanyMember.findFirstOrThrow({ where: { userId: joseph, deactivatedAt: null } });
    await deactivateMember(admin, member.id);
    expect((await prisma.quoteApproval.findUniqueOrThrow({ where: { id: requested.approvalId } })).status).toBe("withdrawn");
  });

  it("requires a limit for procurement and refuses one elsewhere", async () => {
    const { companyId, admin } = await company("limits");
    const priya = await seat(companyId, "requester");
    const member = await prisma.buyerCompanyMember.findFirstOrThrow({ where: { userId: priya } });
    expect(await changeSeat(admin, member.id, { role: "procurement" })).toMatchObject({ ok: false, errors: { monthlyLimitAed: "required" } });
    expect(await changeSeat(admin, member.id, { role: "procurement", monthlyLimitAed: "AED 25,000" })).toEqual({ ok: true });
    expect((await prisma.buyerCompanyMember.findUniqueOrThrow({ where: { id: member.id } })).monthlyLimitAed).toBe(25_000);
  });
});

describe("reads", () => {
  it("shows the queue to whoever may decide it, and the history newest first", async () => {
    const { companyId, admin } = await company("reads");
    const joseph = await seat(companyId, "requester");
    const q = await quotedEnquiry(joseph, companyId, 900);
    const requested = await requestApproval(joseph, q.quoteId, {});
    if (!requested.ok) throw new Error(requested.error);

    const adminView = await approvalQueue(admin);
    expect(adminView?.awaitingYou.map((c) => c.id)).toEqual([requested.approvalId]);
    const josephView = await approvalQueue(joseph);
    expect(josephView?.yours.map((c) => c.id)).toEqual([requested.approvalId]);
    expect(josephView?.awaitingYou).toEqual([]);

    const account = await companyAccount(admin);
    expect(account?.awaitingYouCount).toBe(1);
    const history = await companyHistory(admin, null);
    expect(history?.lines[0]?.kind).toBe("approval_requested");
  });
});

/* ── What reaches the supplier, and what stays ─────────────────────────────── */

describe("the supplier's side", () => {
  it("shows the area and access constraints before acceptance, and the address and invoicing details only after", async () => {
    const { getLeadDetail } = await import("@/lib/db/queries/seller");
    const { companyId, admin } = await company("supplier-view");
    await updateDetails(admin, {
      name: `supplier-view ${PREFIX} Trading`,
      trn: "100448216900003",
      licenceNumber: "DED-772104",
      accountsEmail: "accounts@supplier-view.example",
    });
    const added = await addAddress(admin, {
      label: "Marina Plaza, Tower 2, Level 14",
      addressLine: "Al Marsa Street, Dubai Marina",
      emirate: "dubai",
      attnName: "Rami Haddad",
      attnPhone: "050 220 1188",
      accessPoint: "Loading bay",
      accessFrom: "07:00",
      accessUntil: "17:00",
    });
    if (!added.ok) throw new Error("address");
    const q = await quotedEnquiry(admin, companyId, 900);
    // As `createEnquiry` would have written it for this address.
    const snapshot = {
      v: 1,
      label: "Marina Plaza, Tower 2, Level 14",
      addressLine: "Al Marsa Street, Dubai Marina",
      emirate: "dubai",
      areaId: null,
      areaName: null,
      attnName: "Rami Haddad",
      attnPhone: "+971502201188",
      accessPoint: "Loading bay",
      accessFrom: 420,
      accessUntil: 1020,
      loadLimit: null,
    };
    await prisma.enquiry.update({
      where: { id: q.enquiryId },
      data: { deliveryAddressId: added.addressId, deliverySnapshot: snapshot as never },
    });

    const before = await getLeadDetail(a.id, q.enquiryId);
    expect(before?.delivery?.constraints).toMatchObject({ accessPoint: "Loading bay", accessFrom: 420, accessUntil: 1020 });
    expect(before?.delivery?.address).toBeNull();
    expect(before?.buyer.released).toBe(false);

    expect(await acceptQuote(admin, q.quoteId)).toMatchObject({ ok: true });
    const after = await getLeadDetail(a.id, q.enquiryId);
    expect(after?.delivery?.address).toMatchObject({ addressLine: "Al Marsa Street, Dubai Marina", attnPhone: "+971502201188" });
    expect(after?.buyer).toMatchObject({
      released: true,
      companyTrn: "100448216900003",
      companyLicence: "DED-772104",
      companyAccountsEmail: "accounts@supplier-view.example",
    });
    // The losing supplier learns none of it.
    const loser = await getLeadDetail(b.id, q.enquiryId);
    expect(loser?.delivery?.address).toBeNull();
    expect(loser?.buyer.released).toBe(false);
  });
});

describe("after acceptance", () => {
  it("keeps a required PO number: it can be corrected, not removed", async () => {
    const { setBuyerReference } = await import("@/lib/enquiry/accepted-record-server");
    const { companyId, admin } = await company("po-kept");
    await setRuleFlag(admin, "requirePoNumber", true);
    const q = await quotedEnquiry(admin, companyId, 700);
    expect(await acceptQuote(admin, q.quoteId, new Date(), { poNumber: "PO-1" })).toMatchObject({ ok: true });
    expect(await setBuyerReference({ buyerId: admin, refOrId: q.enquiryId, value: "PO-2" })).toEqual({ ok: true, buyerReference: "PO-2" });
    expect(await setBuyerReference({ buyerId: admin, refOrId: q.enquiryId, value: "  " })).toEqual({ ok: false, error: "required" });
  });
});

describe("enquiries a member sends", () => {
  it("are raised for their company without being told, and not for a company they have left", async () => {
    const { companyId, admin } = await company("auto");
    const category = await prisma.category.findFirstOrThrow({ where: { parentId: { not: null } }, select: { id: true }, orderBy: { id: "asc" } });
    const send = (buyerId: string) =>
      createEnquiry({
        buyerId,
        requirement: `${PREFIX} flanges for the plant room, raised by a member.`,
        lines: [{ description: `${PREFIX} flange`, qty: 4 }],
        categoryId: category.id,
        fanoutTo: 1,
        selection: { recipients: [{ businessId: a.id, slug: "al-waha-industrial-supplies", displayName: "Al Waha" }], skipped: [] },
      } as never);
    const sent = await send(admin);
    if (!sent.ok) throw new Error(sent.error);
    expect((await prisma.enquiry.findUniqueOrThrow({ where: { id: sent.enquiryId } })).buyerCompanyId).toBe(companyId);

    const joseph = await seat(companyId, "requester");
    const member = await prisma.buyerCompanyMember.findFirstOrThrow({ where: { userId: joseph } });
    await deactivateMember(admin, member.id);
    const later = await send(joseph);
    if (!later.ok) throw new Error(later.error);
    expect((await prisma.enquiry.findUniqueOrThrow({ where: { id: later.enquiryId } })).buyerCompanyId).toBeNull();
  });
});

describe("a supplier asking to be paid off-platform", () => {
  it("is told to the company's admins when the company asked, and to nobody when it did not", async () => {
    const { postSellerMessage } = await import("@/lib/messaging/service");
    const { companyId, admin } = await company("off-platform");
    const q = await quotedEnquiry(admin, companyId, 400);
    const deliveries = () =>
      prisma.notificationDelivery.count({ where: { event: "off_platform_flagged", enquiryId: q.enquiryId, recipientUserId: admin } });

    const first = await postSellerMessage(a.actor, a.id, {
      enquiryId: q.enquiryId,
      body: "To save the platform fee, transfer the deposit to IBAN AE070331234567890123456 and we deal directly.",
    });
    expect(first).toMatchObject({ ok: true });
    expect(await deliveries()).toBeGreaterThan(0);

    await setRuleFlag(admin, "tellAdminsOffPlatform", false);
    const count = await deliveries();
    await postSellerMessage(a.actor, a.id, {
      enquiryId: q.enquiryId,
      body: "Or pay outside the platform to IBAN AE070331234567890123456, it is quicker.",
    });
    expect(await deliveries()).toBe(count);

    await prisma.notificationDelivery.deleteMany({ where: { enquiryId: q.enquiryId } });
    const { purgeThreadMessages } = await import("./thread-cleanup");
    await purgeThreadMessages({ enquiryId: q.enquiryId });
    await prisma.supplierReport.deleteMany({ where: { subjectBusinessId: a.id, kind: "off_platform_payment", createdAt: { gte: new Date(Date.now() - 60_000) } } });
  });
});
