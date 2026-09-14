import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import type { Actor } from "@/lib/auth/roles";
import { getAcceptedRecord } from "@/lib/db/queries/accepted-record";
import { getBuyerEnquiry } from "@/lib/db/queries/enquiry";
import { getTrackingByRef } from "@/lib/db/queries/enquiry-tracking";
import { getLeadDetail } from "@/lib/db/queries/seller";
import { acceptQuote } from "@/lib/enquiry/service";
import { declineLead } from "@/lib/leads/decline";
import { postMessage } from "@/lib/messaging/service";
import { saveDraft } from "@/lib/quote/draft";
import type { ProposalInput } from "@/lib/quote/proposal";
import { findProposalDraft, proposalServicesFor, saveProposalDraft, sendProposal } from "@/lib/quote/proposal-server";
import { acceptedQuotePdf } from "@/lib/quote/record-pdf";
import { sendQuoteForBusiness } from "@/lib/quote/send-quote";
import { workEnquiryOf } from "@/lib/quote/work-enquiry";
import { getPipeline } from "@/lib/quotes/pipeline";
import { whileHoldingEnquiryLock } from "./hold-enquiry-lock";

/**
 * Board `3j-s` against a real database.
 *
 * What only Postgres can show: that a proposal writes no line and the triggers
 * refuse one, that a sent proposal cannot be edited, that the send takes the
 * fence under the enquiry's row lock, that two sends from one draft produce one
 * proposal, and that a supplier's decline is a different row from the buyer's
 * choice everywhere a declined row is read.
 *
 * ## Fixtures
 *
 * The file's own services under two seeded facilities firms, the file's own
 * owner seats on them, and a seeded buyer. Every enquiry carries `PREFIX` in its
 * requirement and is deleted by it; the services and seats are deleted at the end.
 */

const PREFIX = "3JS-PROPOSAL-FIXTURE";

type Firm = { id: string; actor: Actor; serviceId: string; serviceName: string };
let efg: Firm;
let shirawi: Firm;
let buyerId: string;
let tradeId: string;
const seats: string[] = [];
const services: string[] = [];
const created: string[] = [];

const SCOPE = `${PREFIX} Quarterly PPM across the building, 24/7 reactive line.`;
const EXCLUDED = `${PREFIX} Major plant replacement and civil works.`;

async function firm(slug: string, basis: string | null): Promise<Firm> {
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
      deliveredWhere: "on_site",
      deliverable: "Monthly report",
      scope: SCOPE,
      excluded: EXCLUDED,
      status: "live",
      position: 99,
    },
    select: { id: true, name: true },
  });
  services.push(service.id);
  return {
    id: business.id,
    actor: { id: seat.id, roles: seat.roles, businessId: business.id } as Actor,
    serviceId: service.id,
    serviceName: service.name,
  };
}

beforeAll(async () => {
  tradeId = (await prisma.category.findFirstOrThrow({ where: { slug: "hard-fm" }, select: { id: true } })).id;
  efg = await firm("emirates-facilities-group", "per_month");
  shirawi = await firm("al-shirawi-facilities", "per_visit");
  buyerId = (
    await prisma.user.findFirstOrThrow({ where: { roles: { has: "buyer" } }, orderBy: { id: "asc" }, select: { id: true } })
  ).id;
});

afterEach(async () => {
  const ids = created.splice(0);
  if (ids.length > 0) await prisma.enquiry.deleteMany({ where: { id: { in: ids } } });
});

afterAll(async () => {
  await prisma.enquiry.deleteMany({ where: { requirement: { contains: PREFIX } } });
  await prisma.service.deleteMany({ where: { id: { in: services } } });
  await prisma.user.deleteMany({ where: { id: { in: seats } } });
  await prisma.$disconnect();
});

/** A brief in Hard FM, sent to both firms, with the one unquantified line `1h-s` writes. */
async function brief(label: string, options: { closesInDays?: number } = {}) {
  const row = await prisma.enquiry.create({
    data: {
      ref: `ENQ-${PREFIX}-${label}-${Date.now().toString(36)}`,
      buyerId,
      requirement: `${PREFIX} ${label} — two towers need planned maintenance.`,
      emirate: "dubai",
      scale: "12 floors, 3 chillers",
      closesAt: new Date(Date.now() + (options.closesInDays ?? 5) * 86_400_000),
      lines: { create: [{ description: "Hard FM & MEP maintenance", qty: null, sortOrder: 0 }] },
      serviceBrief: { create: { categoryId: tradeId, engagementType: "ongoing_contract", cadence: "quarterly", startMode: "asap" } },
      recipients: { create: [{ businessId: efg.id }, { businessId: shirawi.id }] },
    },
    select: { id: true, ref: true, lines: { select: { id: true } } },
  });
  created.push(row.id);
  return row;
}

function proposal(firmRow: Firm, overrides: Partial<ProposalInput> = {}): ProposalInput {
  return {
    serviceId: firmRow.serviceId,
    fee: "18,400",
    mobilisation: "6,000",
    termMonths: "24",
    validityDays: 30,
    paymentTerms: "in_arrears",
    scope: `${SCOPE} Across both towers.`,
    deliverable: "Monthly report with photographs",
    deliveredWhere: "On site, both towers",
    exclusions: EXCLUDED,
    ...overrides,
  };
}

/* ── What a proposal writes ────────────────────────────────────────────────── */

describe("sending a proposal", () => {
  it("writes one quote with a proposal beside it and no line, the basis copied from the service", async () => {
    const e = await brief("send");
    const result = await sendProposal(efg.actor, efg.id, { enquiryId: e.id, ...proposal(efg) });
    expect(result).toMatchObject({ ok: true, revision: 1 });
    if (!result.ok) return;

    const quote = await prisma.quote.findUniqueOrThrow({
      where: { id: result.quoteId },
      select: { status: true, validityDays: true, expiresAt: true, sentAt: true, lines: true, proposal: true },
    });
    expect(quote.status).toBe("sent");
    expect(quote.lines).toHaveLength(0);
    expect(quote.validityDays).toBe(30);
    expect(quote.proposal).toMatchObject({
      serviceId: efg.serviceId,
      feeBasis: "per_month",
      feeBasisLabel: "Per month",
      termMonths: 24,
      deliveredWhere: "On site, both towers",
    });
    expect(quote.proposal?.feeAed?.toString()).toBe("18400");
    expect(quote.proposal?.mobilisationAed?.toString()).toBe("6000");

    const recipient = await prisma.enquiryRecipient.findUniqueOrThrow({
      where: { enquiryId_businessId: { enquiryId: e.id, businessId: efg.id } },
      select: { state: true, firstReplyAt: true },
    });
    expect(recipient.state).toBe("quoted");
    expect(recipient.firstReplyAt).not.toBeNull();
  });

  it("does not write the buyer's edits back to the scope sheet (B3)", async () => {
    const e = await brief("no-write-back");
    await sendProposal(efg.actor, efg.id, {
      enquiryId: e.id,
      ...proposal(efg, { scope: `${PREFIX} edited for this buyer`, exclusions: `${PREFIX} edited exclusions` }),
    });
    const service = await prisma.service.findUniqueOrThrow({ where: { id: efg.serviceId }, select: { scope: true, excluded: true } });
    expect(service).toEqual({ scope: SCOPE, excluded: EXCLUDED });
  });

  it("refuses every bad field at once, and writes nothing", async () => {
    const e = await brief("refusals");
    const result = await sendProposal(efg.actor, efg.id, {
      enquiryId: e.id,
      ...proposal(efg, { fee: "18-20k", termMonths: "240", scope: "  " }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusals?.map((r) => `${r.field}:${r.code}`)).toEqual(["fee:not_amount", "term:not_months", "scope:required"]);
    expect(await prisma.quote.count({ where: { enquiryId: e.id } })).toBe(0);
  });

  it("blocks a service with no fee basis, and one whose basis its family no longer offers (AC8)", async () => {
    const e = await brief("no-basis");
    await prisma.service.update({ where: { id: efg.serviceId }, data: { feeBasis: null } });
    try {
      const none = await sendProposal(efg.actor, efg.id, { enquiryId: e.id, ...proposal(efg) });
      expect(none).toMatchObject({ ok: false, refusals: [{ field: "service", code: "no_basis" }] });

      await prisma.service.update({ where: { id: efg.serviceId }, data: { feeBasis: "per_container" } });
      const stale = await sendProposal(efg.actor, efg.id, { enquiryId: e.id, ...proposal(efg) });
      expect(stale).toMatchObject({ ok: false, refusals: [{ field: "service", code: "stale_basis" }] });
      expect(await prisma.quote.count({ where: { enquiryId: e.id, status: { not: "draft" } } })).toBe(0);
    } finally {
      await prisma.service.update({ where: { id: efg.serviceId }, data: { feeBasis: "per_month" } });
    }
  });

  it("refuses a service that is not the seller's own", async () => {
    const e = await brief("foreign-service");
    const result = await sendProposal(efg.actor, efg.id, { enquiryId: e.id, ...proposal(efg, { serviceId: shirawi.serviceId }) });
    expect(result).toMatchObject({ ok: false, refusals: [{ field: "service", code: "required" }] });
  });

  it("offers the seller's services in the trade, and reads the basis label from the family", async () => {
    const e = await brief("services");
    const work = await workEnquiryOf(prisma, e.id);
    expect(work).toMatchObject({ categoryId: tradeId, isBrief: true });
    const offered = await proposalServicesFor(efg.id, work!);
    expect(offered.find((s) => s.id === efg.serviceId)).toMatchObject({ basis: "ok", feeBasisLabel: "Per month" });
    expect(offered.some((s) => s.id === shirawi.serviceId)).toBe(false);
  });
});

/* ── Drafts and revisions ──────────────────────────────────────────────────── */

describe("drafts and revisions (B10)", () => {
  it("autosaves without replying, and the send promotes the same row", async () => {
    const e = await brief("draft");
    const saved = await saveProposalDraft(efg.actor, efg.id, { enquiryId: e.id, ...proposal(efg, { fee: "18,4" }) });
    expect(saved.ok).toBe(true);

    const draft = await findProposalDraft(e.id, efg.id);
    // Half-typed is kept as not stated — never refused, and never read as 184.
    expect(draft?.proposal?.feeAed).toBeNull();
    const recipient = await prisma.enquiryRecipient.findUniqueOrThrow({
      where: { enquiryId_businessId: { enquiryId: e.id, businessId: efg.id } },
      select: { state: true, firstReplyAt: true },
    });
    expect(recipient).toEqual({ state: "delivered", firstReplyAt: null });

    const sent = await sendProposal(efg.actor, efg.id, { enquiryId: e.id, ...proposal(efg) });
    expect(sent).toMatchObject({ ok: true, quoteId: draft!.id });
    expect(await prisma.quote.count({ where: { enquiryId: e.id, businessId: efg.id } })).toBe(1);
  });

  it("makes a second send revision 2 and leaves revision 1 exactly as sent", async () => {
    const e = await brief("revision");
    const first = await sendProposal(efg.actor, efg.id, { enquiryId: e.id, ...proposal(efg) });
    const second = await sendProposal(efg.actor, efg.id, { enquiryId: e.id, ...proposal(efg, { fee: "17,900" }) });
    expect(second).toMatchObject({ ok: true, revision: 2 });
    if (!first.ok) throw new Error("first send failed");
    const r1 = await prisma.quoteProposal.findUniqueOrThrow({ where: { quoteId: first.quoteId }, select: { feeAed: true } });
    expect(r1.feeAed?.toString()).toBe("18400");
  });

  it("refuses an edit to a sent proposal and a line on any proposal, at the database", async () => {
    const e = await brief("triggers");
    const sent = await sendProposal(efg.actor, efg.id, { enquiryId: e.id, ...proposal(efg) });
    if (!sent.ok) throw new Error("send failed");

    await expect(
      prisma.quoteProposal.update({ where: { quoteId: sent.quoteId }, data: { feeAed: "1.00" } }),
    ).rejects.toThrow(/has been sent/);
    await expect(
      prisma.quoteLine.create({ data: { quoteId: sent.quoteId, description: "a parts list", unitPrice: "1.00" } }),
    ).rejects.toThrow(/carries no lines/);
  });

  it("never lets two sends racing from one draft write over each other", async () => {
    const e = await brief("race");
    await saveProposalDraft(efg.actor, efg.id, { enquiryId: e.id, ...proposal(efg) });
    /*
       Two outcomes are correct and which one happens is the scheduler's:
       both read the draft, and the second is refused under the lock rather than
       writing over a proposal the buyer holds; or the first commits before the
       second reads, and the second is simply revision 2. What must never happen
       is an error, or two sent quotes at one revision.
    */
    const results = await Promise.all([
      sendProposal(efg.actor, efg.id, { enquiryId: e.id, ...proposal(efg) }),
      sendProposal(efg.actor, efg.id, { enquiryId: e.id, ...proposal(efg, { fee: "1,000" }) }),
    ]);
    const ok = results.filter((r) => r.ok);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    for (const refused of results.filter((r) => !r.ok)) {
      expect(refused).toMatchObject({ error: expect.stringMatching(/sent from another tab/) });
    }
    const sent = await prisma.quote.findMany({
      where: { enquiryId: e.id, businessId: efg.id, status: "sent" },
      select: { revision: true },
    });
    expect(sent).toHaveLength(ok.length);
    expect(new Set(sent.map((q) => q.revision)).size).toBe(sent.length);
  });
});

/* ── One way to answer work ────────────────────────────────────────────────── */

describe("the goods composer on an enquiry for work (B2)", () => {
  it("refuses to price the brief's line, and refuses to autosave one", async () => {
    const e = await brief("goods-path");
    const sent = await sendQuoteForBusiness(efg.actor, efg.id, {
      enquiryId: e.id,
      note: "",
      validityDays: 14,
      lines: [{ enquiryLineId: e.lines[0]!.id, productId: null, description: "Hard FM", qty: null, unitPrice: "18400.00", leadTimeDays: null }],
    });
    expect(sent).toMatchObject({ ok: false });
    const draft = await saveDraft(efg.actor, efg.id, {
      enquiryId: e.id,
      note: "",
      validityDays: 14,
      lines: [{ enquiryLineId: e.lines[0]!.id, productId: null, description: "Hard FM", qty: null, unitPrice: "18400.00", leadTimeDays: null }],
    });
    expect(draft).toEqual({ ok: false, error: "work_enquiry" });
    expect(await prisma.quoteLine.count({ where: { quote: { enquiryId: e.id } } })).toBe(0);
  });
});

/* ── The fence ─────────────────────────────────────────────────────────────── */

describe("the fence", () => {
  it("refuses a proposal once the buyer accepted another supplier, and on a closed enquiry", async () => {
    const e = await brief("fence");
    const fromShirawi = await sendProposal(shirawi.actor, shirawi.id, { enquiryId: e.id, ...proposal(shirawi, { fee: "850" }) });
    if (!fromShirawi.ok) throw new Error("fixture send failed");
    expect(await acceptQuote(buyerId, fromShirawi.quoteId)).toMatchObject({ ok: true });

    expect(await sendProposal(efg.actor, efg.id, { enquiryId: e.id, ...proposal(efg) })).toMatchObject({ ok: false });
    expect(await prisma.quote.count({ where: { enquiryId: e.id, businessId: efg.id } })).toBe(0);

    const closed = await brief("closed", { closesInDays: -1 });
    expect(await sendProposal(efg.actor, efg.id, { enquiryId: closed.id, ...proposal(efg) })).toMatchObject({ ok: false });
  });
});

/* ── Decline ───────────────────────────────────────────────────────────────── */

describe("a supplier's decline", () => {
  it("is shown to the buyer with the reason, answers the enquiry, and closes the composer", async () => {
    const e = await brief("decline");
    await saveProposalDraft(efg.actor, efg.id, { enquiryId: e.id, ...proposal(efg) });

    expect(await declineLead(efg.actor, efg.id, { enquiryId: e.id, reason: "  Outside the   area we cover " })).toEqual({ ok: true });

    const recipient = await prisma.enquiryRecipient.findUniqueOrThrow({
      where: { enquiryId_businessId: { enquiryId: e.id, businessId: efg.id } },
      select: { state: true, declinedAt: true, declinedById: true, declineReason: true, firstReplyAt: true },
    });
    expect(recipient).toMatchObject({ state: "declined", declinedById: efg.actor.id, declineReason: "Outside the area we cover" });
    expect(recipient.firstReplyAt).not.toBeNull();
    // The seller's working copy goes with it.
    expect(await findProposalDraft(e.id, efg.id)).toBeNull();

    const tracking = await getTrackingByRef(buyerId, e.ref);
    const row = tracking?.recipients.find((r) => r.businessId === efg.id);
    expect(row).toMatchObject({ state: "declined", declineReason: "Outside the area we cover", declinedBySupplier: true });

    const refused = await sendProposal(efg.actor, efg.id, { enquiryId: e.id, ...proposal(efg) });
    expect(refused).toMatchObject({ ok: false, error: expect.stringMatching(/You declined/) });
    expect(await declineLead(efg.actor, efg.id, { enquiryId: e.id })).toEqual({ ok: false, error: "already_declined" });
  });

  it("cannot be undone by a message afterwards", async () => {
    const e = await brief("decline-message");
    await declineLead(efg.actor, efg.id, { enquiryId: e.id });
    const posted = await postMessage({
      enquiryId: e.id,
      businessId: efg.id,
      senderId: efg.actor.id,
      sender: "seller",
      body: "Sorry we could not help on this one.",
    });
    expect(posted.ok).toBe(true);
    const recipient = await prisma.enquiryRecipient.findUniqueOrThrow({
      where: { enquiryId_businessId: { enquiryId: e.id, businessId: efg.id } },
      select: { state: true },
    });
    expect(recipient.state).toBe("declined");
  });

  it("is refused once a proposal is with the buyer, and a reason over one line", async () => {
    const e = await brief("decline-after");
    await sendProposal(efg.actor, efg.id, { enquiryId: e.id, ...proposal(efg) });
    expect(await declineLead(efg.actor, efg.id, { enquiryId: e.id })).toEqual({ ok: false, error: "already_replied" });
    expect(await declineLead(shirawi.actor, shirawi.id, { enquiryId: e.id, reason: "x".repeat(201) })).toEqual({
      ok: false,
      error: "reason_too_long",
    });
  });
});

/* ── Downstream ────────────────────────────────────────────────────────────── */

describe("what reads a proposal", () => {
  it("reaches the buyer, the pipeline and the accepted record as a fee on a basis, never as a total", async () => {
    const e = await brief("downstream");
    const sent = await sendProposal(efg.actor, efg.id, { enquiryId: e.id, ...proposal(efg) });
    await sendProposal(shirawi.actor, shirawi.id, { enquiryId: e.id, ...proposal(shirawi, { fee: "850", mobilisation: "0", termMonths: "" }) });
    if (!sent.ok) throw new Error("send failed");

    const buyerView = await getBuyerEnquiry(buyerId, e.id);
    const efgQuote = buyerView?.quotes.find((q) => q.business.id === efg.id);
    expect(efgQuote?.proposal).toMatchObject({ feeAed: "18400", feeBasisLabel: "Per month", termMonths: 24 });
    expect(buyerView?.quotes.find((q) => q.business.id === shirawi.id)?.proposal).toMatchObject({
      mobilisationAed: "0",
      termMonths: null,
    });

    const lead = await getLeadDetail(efg.id, e.id);
    expect(lead?.quotes[0]?.proposal?.scope).toContain("Across both towers");

    const pipeline = await getPipeline({ businessId: efg.id, tab: "all", scope: { kind: "all" } });
    const row = pipeline.rows.find((r) => r.quoteId === sent.quoteId);
    expect(row?.proposal).toMatchObject({ feeBasisLabel: "Per month" });
    expect(pipeline.proposalCount).toBeGreaterThanOrEqual(1);

    expect(await acceptQuote(buyerId, sent.quoteId)).toMatchObject({ ok: true, declined: 1 });
    const record = await getAcceptedRecord(buyerId, e.id);
    expect(record?.quote.lines).toEqual([]);
    expect(record?.quote.proposal).toMatchObject({
      feeBasisLabel: "Per month",
      termMonths: 24,
      exclusions: EXCLUDED,
    });
    // Declined *by this acceptance* — Al Shirawi quoted and lost.
    expect(record?.declinedCount).toBe(1);

    const pdf = acceptedQuotePdf(record!, new Date());
    const text = pdf.bytes.toString("latin1");
    // Board `7c-s` renamed the section; the fields are what this board promised.
    expect(text).toContain("What was agreed");
    expect(text).toContain("24 months");
    expect(text).toContain(`${PREFIX} Major plant replacement and civil works.`);
  });

  it("does not count a supplier's own decline as declined by the acceptance", async () => {
    const e = await brief("record-decline");
    await declineLead(shirawi.actor, shirawi.id, { enquiryId: e.id, reason: "Call-out only" });
    const sent = await sendProposal(efg.actor, efg.id, { enquiryId: e.id, ...proposal(efg) });
    if (!sent.ok) throw new Error("send failed");
    await acceptQuote(buyerId, sent.quoteId);

    const record = await getAcceptedRecord(buyerId, e.id);
    expect(record?.declinedCount).toBe(0);
    const tracking = await getTrackingByRef(buyerId, e.ref);
    expect(tracking?.recipients.find((r) => r.businessId === shirawi.id)).toMatchObject({
      declinedBySupplier: true,
      declineReason: "Call-out only",
    });
  });
});

describe("two sends with no draft between them", () => {
  it("serialise under the lock into revisions 1 and 2, rather than one failing on the unique revision", async () => {
    const e = await brief("race-no-draft");
    const results = await Promise.all([
      sendProposal(efg.actor, efg.id, { enquiryId: e.id, ...proposal(efg) }),
      sendProposal(efg.actor, efg.id, { enquiryId: e.id, ...proposal(efg, { fee: "17,900" }) }),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    const revisions = (
      await prisma.quote.findMany({ where: { enquiryId: e.id, businessId: efg.id }, select: { revision: true } })
    ).map((q) => q.revision);
    expect(revisions.sort()).toEqual([1, 2]);
  });
});

describe("an autosave and a send", () => {
  it("an autosave that waited on a send writes nothing over the proposal it sent", async () => {
    const e = await brief("autosave-after-send");
    await saveProposalDraft(efg.actor, efg.id, { enquiryId: e.id, ...proposal(efg) });
    const draft = await findProposalDraft(e.id, efg.id);
    if (!draft) throw new Error("no draft");

    const late = await whileHoldingEnquiryLock(
      e.id,
      () => saveProposalDraft(efg.actor, efg.id, { enquiryId: e.id, ...proposal(efg, { fee: "1" }) }),
      // What the send's promotion commits while the autosave waits for the lock.
      (tx) => tx.quote.update({ where: { id: draft.id }, data: { status: "sent", sentAt: new Date() } }),
    );

    // Before the lock this was `quote_proposal_immutable` refusing the upsert, as a 500.
    expect(late).toEqual({ ok: false, error: "superseded" });
    const held = await prisma.quoteProposal.findUniqueOrThrow({ where: { quoteId: draft.id }, select: { feeAed: true } });
    expect(String(held.feeAed)).toBe("18400");
    expect(await prisma.quote.count({ where: { enquiryId: e.id, businessId: efg.id, status: "draft" } })).toBe(0);
  });

  it("a send that waited on an autosave promotes the draft it made rather than colliding with it", async () => {
    const e = await brief("send-after-autosave");
    const result = await whileHoldingEnquiryLock(
      e.id,
      () => sendProposal(efg.actor, efg.id, { enquiryId: e.id, ...proposal(efg) }),
      // What an autosave's create commits while the send waits for the lock.
      (tx) =>
        tx.quote.create({
          data: { ref: `DRAFT-race-${e.id}`, enquiryId: e.id, businessId: efg.id, revision: 1, status: "draft", validityDays: 30 },
        }),
    );

    expect(result).toMatchObject({ ok: true, revision: 1 });
    const quotes = await prisma.quote.findMany({
      where: { enquiryId: e.id, businessId: efg.id },
      select: { status: true, proposal: { select: { feeAed: true } } },
    });
    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({ status: "sent" });
    expect(String(quotes[0]!.proposal?.feeAed)).toBe("18400");
  });
});
