import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { getLeadDetail, getLeadsForBusiness, getQuotesForBusiness } from "@/lib/db/queries/seller";

/**
 * Acceptance criterion 2, at the level the README specifies it:
 *
 *   "A seller cannot retrieve the buyer's phone, email or company name until
 *    acceptance — proven by a query-layer test, not a template inspection."
 *
 * So this calls the query functions the screens call and inspects what comes
 * back, rather than reading any markup. A screen cannot render a field that is
 * not in the payload, and the payload is what is asserted here.
 */

/** The seeded buyer's real contact details. None of these may ever appear. */
const BUYER_PHONE = "+971506412288";
const BUYER_EMAIL = "procurement@harbourcontracting.example";
const BUYER_COMPANY = "Harbour Contracting LLC";
const BUYER_TRN = "100487213600003";
const BUYER_SURNAME = "Al Hameli";

const SECRETS = [BUYER_PHONE, BUYER_EMAIL, BUYER_COMPANY, BUYER_TRN, BUYER_SURNAME];

let quotingBusinessId: string;
let otherRecipientId: string;
let strangerBusinessId: string;
let enquiryId: string;

beforeAll(async () => {
  const enquiry = await prisma.enquiry.findUniqueOrThrow({
    where: { ref: "ENQ-8863" },
    select: { id: true, recipients: { select: { businessId: true }, orderBy: { businessId: "asc" } } },
  });
  enquiryId = enquiry.id;
  // Hardcoded for the same reason the e2e specs hardcode slugs: the seed's
  // PRNG is fixed, so this is stable, and a seed change should fail loudly.
  const seller = await prisma.business.findUniqueOrThrow({
    where: { slug: "al-marwan-industrial-supplies-llc" },
    select: { id: true },
  });
  quotingBusinessId = seller.id;
  otherRecipientId = enquiry.recipients.find((r) => r.businessId !== quotingBusinessId)!.businessId;

  const stranger = await prisma.business.findFirstOrThrow({
    where: { id: { notIn: enquiry.recipients.map((r) => r.businessId) } },
    select: { id: true },
  });
  strangerBusinessId = stranger.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

function serialise(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}

describe("criterion 2 — before acceptance", () => {
  it("the leads inbox releases contact only where a quote was accepted", async () => {
    for (const businessId of [quotingBusinessId, otherRecipientId]) {
      const leads = await getLeadsForBusiness(businessId);
      expect(leads.length).toBeGreaterThan(0);

      // This buyer has accepted nothing, so none of their details may appear
      // in either inbox, whatever else is in it.
      const payload = serialise(leads);
      for (const secret of SECRETS) expect(payload).not.toContain(secret);

      /*
       * A lead is released only when that enquiry released to this business.
       * Asserting every lead is unreleased was too broad — a seller who won an
       * enquiry legitimately sees the buyer's details on it, and the seed now
       * has one.
       */
      for (const lead of leads) {
        const enquiry = await prisma.enquiry.findUniqueOrThrow({
          where: { id: lead.enquiryId },
          select: { contactReleasedToBusinessId: true },
        });
        expect(lead.buyer.released, `${lead.ref} for ${businessId}`).toBe(
          enquiry.contactReleasedToBusinessId === businessId,
        );
      }
    }
  });

  it("the lead detail carries a first name and nothing more", async () => {
    const lead = await getLeadDetail(quotingBusinessId, enquiryId);
    expect(lead).not.toBeNull();
    expect(lead!.buyer.released).toBe(false);
    expect(lead!.buyer.firstName).toBe("Rashid");

    const payload = serialise(lead);
    for (const secret of SECRETS) expect(payload).not.toContain(secret);
  });

  it("the quotes pipeline carries no contact details either", async () => {
    const quotes = await getQuotesForBusiness(quotingBusinessId);
    const payload = serialise(quotes);
    for (const secret of SECRETS) expect(payload).not.toContain(secret);
  });
});

describe("criterion 2 — scoping", () => {
  it("a business the enquiry was not sent to gets null, not a permission error", async () => {
    // The same answer as an unknown id, so the route cannot be used to discover
    // which enquiries exist.
    expect(await getLeadDetail(strangerBusinessId, enquiryId)).toBeNull();
  });

  it("an id that does not exist gets null", async () => {
    expect(await getLeadDetail(quotingBusinessId, "cmt00000000000000000000000")).toBeNull();
  });

  it("a seller's quotes list contains only their own", async () => {
    const quotes = await getQuotesForBusiness(quotingBusinessId);
    const ids = quotes.map((q) => q.id);
    const foreign = await prisma.quote.count({
      where: { id: { in: ids }, businessId: { not: quotingBusinessId } },
    });
    expect(foreign).toBe(0);
  });
});

describe("criterion 2 — after acceptance", () => {
  it("releases the details to the accepted business and to nobody else", async () => {
    // ENQ-8802 is seeded already accepted, so nothing here mutates state.
    const accepted = await prisma.enquiry.findUniqueOrThrow({
      where: { ref: "ENQ-8802" },
      select: {
        id: true,
        contactReleasedToBusinessId: true,
        recipients: { select: { businessId: true, state: true } },
      },
    });
    const winner = accepted.contactReleasedToBusinessId;
    expect(winner).not.toBeNull();

    const loser = accepted.recipients.find((r) => r.businessId !== winner);
    expect(loser, "ENQ-8802 needs a second recipient for this to prove anything").toBeDefined();

    const winnerView = await getLeadDetail(winner!, accepted.id);
    expect(winnerView?.buyer.released).toBe(true);

    const loserView = await getLeadDetail(loser!.businessId, accepted.id);
    // The declined recipient reads the same enquiry row and still sees a name.
    expect(loserView?.buyer.released).toBe(false);
    expect(serialise(loserView)).not.toContain("+9715");
  });
});

describe("catalogue matching, against the real seed", () => {
  it("matches what the seller stocks and flags what nobody does", async () => {
    const lead = await getLeadDetail(quotingBusinessId, enquiryId);
    const byDescription = new Map(lead!.lines.map((l) => [l.description, l]));

    const trunnion = [...byDescription.values()].find((l) => l.size === "DN600");
    expect(trunnion, "the seed must carry a line no catalogue can match").toBeDefined();
    // DN600 is larger than anything in the seeded catalogue. This is the
    // "flagged for manual pricing" state the step 1 checkpoint asks for.
    expect(trunnion!.match.best).toBeNull();

    const matched = [...byDescription.values()].filter((l) => l.match.best !== null);
    expect(matched.length).toBeGreaterThanOrEqual(2);
    for (const line of matched) {
      // Never a match from another seller's shelf.
      const product = await prisma.product.findUniqueOrThrow({
        where: { id: line.match.best!.product.id },
        select: { businessId: true },
      });
      expect(product.businessId).toBe(quotingBusinessId);
    }
  });
});
