import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { actorFor } from "@/lib/auth/actor";
import { PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";
import { approveRequest, requestApproval } from "@/lib/buyer-company/approvals";
import { addSuppliers } from "@/lib/enquiry/add-recipients";
import { acceptQuote, createEnquiry, type CreateEnquiryInput } from "@/lib/enquiry/service";
import { sendQuoteForBusiness } from "@/lib/quote/send-quote";
import { createReview, saveReviewDraft, writableSubject } from "@/lib/reviews/service";
import { EMPTY_REVIEW_FIELDS } from "@/lib/reviews/write";
import { loadReviewWrite } from "@/lib/reviews/write-server";

/**
 * Build plan 9.4 — the conversion event, the terminal state and the trust
 * signal, each asked of the matrix in the service that writes it.
 *
 * `enquiry.create`, `quote.accept` and `review.create` had guards and no
 * caller. Asking them as they stood would have refused the buyer the product is
 * built for: a provisional identity holds no role, and all three were role
 * grants. So each test here is a pair — refused without the capability, allowed
 * with it — and the "with" side is always a person the product has to serve: a
 * buyer with no account, a signed-up buyer, a supplier's seat buying from
 * another supplier. The "without" side is §07's dash — a staff seat holding no
 * buyer role — and a suspended account, which board 7a says has no actor.
 *
 * A refusal is asserted by what did *not* happen as well as by the error: no
 * enquiry row, no release, no review. An assertion on the exception alone
 * passes for a check that threw after writing.
 *
 * ## Fixtures
 *
 * People of the file's own, every one named with `PREFIX` and deleted at the
 * end; their enquiries, quotes and reviews cascade with them. Two seeded Pro
 * suppliers answer, so no monthly cap moves under the file. Provisional
 * identities are written straight to Postgres with a phone and a claim token —
 * exactly the row `createProvisionalIdentity` leaves, minus the Supabase auth
 * user, which nothing on these paths reads. `enquiry-fanout.test.ts` covers the
 * send that mints one from nothing.
 */

const PREFIX = "BL-9.4-CAPABILITY";
const DAY = 86_400_000;
const BODY = "Quoted on the Sunday, delivered on the Tuesday, and the couplings matched the drawing.";

const made: string[] = [];
let a: { id: string; slug: string; displayName: string; categoryId: string; actor: Actor };
let b: { id: string; slug: string; displayName: string; categoryId: string; actor: Actor };

let phoneSeq = 0;
function phone(): string {
  // A block of numbers the seed does not use, unique per run and per call.
  phoneSeq += 1;
  return `+9715094${String(Date.now() % 1000).padStart(3, "0")}${String(phoneSeq).padStart(2, "0")}`;
}

async function person(
  label: string,
  roles: Role[],
  extra: { businessId?: string; suspended?: boolean; provisional?: boolean; phone?: string } = {},
): Promise<string> {
  const id = randomUUID();
  await prisma.user.create({
    data: {
      id,
      fullName: `${PREFIX} ${label}`,
      roles,
      ...(extra.businessId ? { businessId: extra.businessId } : {}),
      ...(extra.suspended ? { suspendedAt: new Date() } : {}),
      ...(extra.provisional ? { isProvisional: true, claimToken: randomUUID() } : {}),
      ...(extra.phone ? { phone: extra.phone } : {}),
    },
  });
  made.push(id);
  return id;
}

async function supplier(slug: string) {
  const business = await prisma.business.findFirstOrThrow({
    where: { slug },
    select: { id: true, slug: true, displayName: true, primaryCategoryId: true },
  });
  const seat = await prisma.user.findFirstOrThrow({
    where: { businessId: business.id, roles: { has: "seller_owner" } },
    orderBy: { id: "asc" },
    select: { id: true, roles: true },
  });
  return {
    id: business.id,
    slug: business.slug,
    displayName: business.displayName,
    categoryId: business.primaryCategoryId!,
    actor: { id: seat.id, roles: seat.roles, businessId: business.id } as Actor,
  };
}

beforeAll(async () => {
  a = await supplier("al-waha-industrial-supplies");
  b = await supplier("copperfield-industrial-supplies-llc");
});

afterAll(async () => {
  // Enquiries, quotes, recipients, drafts and reviews cascade from the buyer.
  await prisma.user.deleteMany({ where: { id: { in: made } } });
  await prisma.$disconnect();
});

/** A send to supplier A alone, recipients already chosen, as `1h-s` hands them in. */
function send(over: Partial<CreateEnquiryInput>): CreateEnquiryInput {
  return {
    buyerId: null,
    requirement: `${PREFIX} — grooved couplings for a sprinkler riser, Al Quoz.`,
    lines: [{ description: `${PREFIX} grooved coupling`, qty: 12, unit: "pcs" }],
    categoryId: a.categoryId,
    emirate: "dubai",
    fanoutTo: 1,
    selection: { recipients: [{ businessId: a.id, slug: a.slug, displayName: a.displayName }], skipped: [] },
    ...over,
  };
}

async function enquiriesOf(buyerId: string): Promise<number> {
  return prisma.enquiry.count({ where: { buyerId } });
}

/**
 * An open enquiry to A and B, written directly. The route for a person who
 * may send is `createEnquiry`; this is for one who may not — an enquiry that
 * predates a role change, or is simply the fixture the refusal needs.
 */
async function openEnquiry(buyerId: string, label: string) {
  return prisma.enquiry.create({
    data: {
      ref: `ENQ-94${label.toUpperCase()}${Date.now() % 100000}`,
      buyerId,
      requirement: `${PREFIX} ${label} — grooved couplings for a riser.`,
      closesAt: new Date(Date.now() + 5 * DAY),
      lines: { create: [{ description: `${PREFIX} coupling`, qty: 10, unit: "pcs", sortOrder: 0 }] },
      recipients: { create: [{ businessId: a.id }, { businessId: b.id }] },
    },
    select: { id: true, ref: true, lines: { select: { id: true } } },
  });
}

async function quoteFromA(enquiry: { id: string; lines: { id: string }[] }): Promise<string> {
  const sent = await sendQuoteForBusiness(a.actor, a.id, {
    enquiryId: enquiry.id,
    note: "",
    validityDays: 14,
    paymentTerms: "net_30",
    delivery: "included",
    lines: [
      {
        enquiryLineId: enquiry.lines[0]!.id,
        productId: null,
        description: `${PREFIX} coupling`,
        qty: 10,
        unitPrice: "38.50",
        leadTimeDays: 2,
      },
    ],
  });
  if (!sent.ok) throw new Error(`fixture quote did not send: ${JSON.stringify(sent)}`);
  return sent.quoteId;
}

/** An enquiry released to A three days ago — what an acceptance leaves — so the gate is open on it. */
async function acceptedEnquiry(buyerId: string, label: string) {
  const at = new Date(Date.now() - 3 * DAY);
  return prisma.enquiry.create({
    data: {
      ref: `ENQ-94R${label.toUpperCase()}${Date.now() % 100000}`,
      buyerId,
      requirement: `${PREFIX} ${label} — couplings, delivered and fitted.`,
      closesAt: new Date(at.getTime() - DAY),
      createdAt: new Date(at.getTime() - 5 * DAY),
      contactReleasedToBusinessId: a.id,
      contactReleasedAt: at,
      lines: { create: [{ description: `${PREFIX} coupling`, qty: 10, sortOrder: 0 }] },
      recipients: { create: [{ businessId: a.id, state: "quoted", firstReplyAt: at }] },
    },
    select: { id: true, ref: true },
  });
}

const ratings = { overall: 4, quotedAccurate: 5, onTime: null, asDescribed: 4, responsiveness: null };

async function released(enquiryId: string): Promise<string | null> {
  const row = await prisma.enquiry.findUniqueOrThrow({
    where: { id: enquiryId },
    select: { contactReleasedToBusinessId: true },
  });
  return row.contactReleasedToBusinessId;
}

/* ── What each person resolves to ──────────────────────────────────────────── */

describe("the actor a service reads for an id", () => {
  it("is provisional and roleless for a claim-token buyer, whatever the row carries", async () => {
    const id = await person("provisional", [], { provisional: true, phone: phone() });
    expect(await actorFor(id)).toEqual({ id, roles: [], provisional: true });
  });

  it("holds nothing for a suspended account, an unknown id, or a claimed account with no role", async () => {
    const suspended = await person("suspended buyer", ["buyer"], { suspended: true });
    const roleless = await person("roleless", []);
    const unknown = randomUUID();
    expect(await actorFor(suspended)).toEqual({ id: suspended, roles: [] });
    expect(await actorFor(unknown)).toEqual({ id: unknown, roles: [] });
    expect(await actorFor(roleless)).toEqual({ id: roleless, roles: [] });
  });

  it("carries the record's roles and business, never a claim", async () => {
    const seat = await person("sales seat", ["seller_sales"], { businessId: b.id });
    expect(await actorFor(seat)).toEqual({ id: seat, roles: ["seller_sales"], businessId: b.id });
  });
});

/* ── enquiry.create ────────────────────────────────────────────────────────── */

describe("enquiry.create — createEnquiry", () => {
  it("refuses a staff seat with no buyer role, and writes no enquiry", async () => {
    const moderator = await person("moderator", ["staff_moderator"]);
    await expect(createEnquiry(send({ buyerId: moderator }))).rejects.toBeInstanceOf(PermissionError);
    expect(await enquiriesOf(moderator)).toBe(0);
  });

  it("refuses a suspended buyer, and writes no enquiry", async () => {
    const suspended = await person("suspended sender", ["buyer"], { suspended: true });
    await expect(createEnquiry(send({ buyerId: suspended }))).rejects.toBeInstanceOf(PermissionError);
    expect(await enquiriesOf(suspended)).toBe(0);
  });

  it("sends for a buyer, for a supplier's seat, and for a staff member who also buys", async () => {
    const buyer = await person("buyer", ["buyer"]);
    const sales = await person("seat at B", ["seller_sales"], { businessId: b.id });
    const opsWhoBuys = await person("ops lead who buys", ["buyer", "staff_ops_lead"]);
    for (const sender of [buyer, sales, opsWhoBuys]) {
      expect(await createEnquiry(send({ buyerId: sender }))).toMatchObject({ ok: true });
      expect(await enquiriesOf(sender)).toBe(1);
    }
  });

  it("sends for a visitor whose number is a provisional identity, and hands back its token", async () => {
    const number = phone();
    const provisional = await person("provisional sender", [], { provisional: true, phone: number });
    const result = await createEnquiry(send({ phone: number, fullName: "Khalid" }));
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("unreachable");
    expect(result.claimToken).not.toBeNull();
    expect(await enquiriesOf(provisional)).toBe(1);
  });

  it("asks a signed-out send the same question when the number belongs to an account", async () => {
    // Otherwise signing out would be the way round the check.
    const number = phone();
    const staff = await person("staff with a mobile", ["staff_finance"], { phone: number });
    await expect(createEnquiry(send({ phone: number }))).rejects.toBeInstanceOf(PermissionError);
    expect(await enquiriesOf(staff)).toBe(0);
  });

  it("stops a suspended provisional identity's number from sending again", async () => {
    const number = phone();
    const spam = await person("suspended provisional", [], { provisional: true, phone: number, suspended: true });
    await expect(createEnquiry(send({ phone: number }))).rejects.toBeInstanceOf(PermissionError);
    expect(await enquiriesOf(spam)).toBe(0);
  });
});

describe("enquiry.create — addSuppliers, the same send to more suppliers", () => {
  it("refuses a staff seat and adds nobody; lets the provisional owner through to the matcher", async () => {
    const staff = await person("staff owner", ["staff_moderator"]);
    const theirs = await openEnquiry(staff, "addstaff");
    await expect(
      addSuppliers({ buyerId: staff, refOrId: theirs.ref, chosenBusinessIds: [b.id] }),
    ).rejects.toBeInstanceOf(PermissionError);
    expect(await prisma.enquiryRecipient.count({ where: { enquiryId: theirs.id } })).toBe(2);

    const provisional = await person("provisional adder", [], { provisional: true, phone: phone() });
    const mine = await openEnquiry(provisional, "addprov");
    // Past the matrix: whatever the matcher says next is a value, not a PermissionError.
    const result = await addSuppliers({ buyerId: provisional, refOrId: mine.ref, chosenBusinessIds: [b.id] });
    expect(result).toHaveProperty("ok");
  });
});

/* ── quote.accept ──────────────────────────────────────────────────────────── */

describe("quote.accept — acceptQuote", () => {
  it("lets a buyer with no account accept from their claim-token link — the finding", async () => {
    // Buyer-only, asked, this refused the person most enquiries belong to.
    const provisional = await person("provisional accepter", [], { provisional: true, phone: phone() });
    const enquiry = await openEnquiry(provisional, "acceptprov");
    const quote = await quoteFromA(enquiry);
    expect(await acceptQuote(provisional, quote)).toMatchObject({ ok: true, businessId: a.id });
    expect(await released(enquiry.id)).toBe(a.id);
  });

  it("lets a supplier's seat accept on the enquiry it was allowed to send", async () => {
    const sales = await person("seat accepting", ["seller_sales"], { businessId: b.id });
    const enquiry = await openEnquiry(sales, "acceptseat");
    const quote = await quoteFromA(enquiry);
    expect(await acceptQuote(sales, quote)).toMatchObject({ ok: true });
    expect(await released(enquiry.id)).toBe(a.id);
  });

  it("refuses a staff seat on its own enquiry, and releases nothing", async () => {
    const staff = await person("staff accepter", ["staff_ops_lead"]);
    const enquiry = await openEnquiry(staff, "acceptstaff");
    const quote = await quoteFromA(enquiry);
    await expect(acceptQuote(staff, quote)).rejects.toBeInstanceOf(PermissionError);
    expect(await released(enquiry.id)).toBeNull();
    expect(await prisma.quote.findUniqueOrThrow({ where: { id: quote }, select: { status: true } })).toEqual({
      status: "sent",
    });
  });

  it("refuses a suspended buyer on their own enquiry, and releases nothing", async () => {
    const suspended = await person("suspended accepter", ["buyer"]);
    const enquiry = await openEnquiry(suspended, "acceptsusp");
    const quote = await quoteFromA(enquiry);
    await prisma.user.update({ where: { id: suspended }, data: { suspendedAt: new Date() } });
    await expect(acceptQuote(suspended, quote)).rejects.toBeInstanceOf(PermissionError);
    expect(await released(enquiry.id)).toBeNull();
  });

  it("asks before it reads the quote, so a refused seat learns nothing about the id", async () => {
    const staff = await person("staff guesser", ["staff_moderator"]);
    await expect(acceptQuote(staff, randomUUID())).rejects.toBeInstanceOf(PermissionError);
  });
});

describe("quote.accept — the company approval that ends in an acceptance", () => {
  it("refuses a raiser without it before a colleague is asked anything", async () => {
    const staff = await person("staff raiser", ["staff_moderator"]);
    const before = await prisma.quoteApproval.count();
    await expect(requestApproval(staff, randomUUID(), {})).rejects.toBeInstanceOf(PermissionError);
    expect(await prisma.quoteApproval.count()).toBe(before);
  });

  it("refuses an approver without it — approving is the acceptance", async () => {
    // The raiser is asked inside `acceptQuote`; the passing path for both is
    // board 7b's own suite, whose members all hold `buyer`.
    const staff = await person("staff approver", ["staff_finance"]);
    await expect(approveRequest(staff, randomUUID())).rejects.toBeInstanceOf(PermissionError);
  });
});

/* ── review.create ─────────────────────────────────────────────────────────── */

describe("review.create — createReview and the paths toward it", () => {
  it("lets a buyer with no account review from their link — the finding, again", async () => {
    const provisional = await person("provisional reviewer", [], { provisional: true, phone: phone() });
    const enquiry = await acceptedEnquiry(provisional, "revprov");
    expect((await writableSubject(provisional, enquiry.id)).ok).toBe(true);
    expect(
      await saveReviewDraft({ buyerId: provisional, enquiryId: enquiry.id, fields: { ...EMPTY_REVIEW_FIELDS, overall: 4 } }),
    ).toMatchObject({ ok: true });
    expect(await createReview({ buyerId: provisional, enquiryId: enquiry.id, ratings, body: BODY })).toMatchObject({
      ok: true,
      businessId: a.id,
      provenance: "accepted_quote",
    });
  });

  it("lets a supplier's seat review the supplier it accepted", async () => {
    const sales = await person("seat reviewer", ["seller_sales"], { businessId: b.id });
    const enquiry = await acceptedEnquiry(sales, "revseat");
    expect(await createReview({ buyerId: sales, enquiryId: enquiry.id, ratings, body: BODY })).toMatchObject({ ok: true });
  });

  it("refuses a staff seat on an enquiry the gate would pass, on every path, and writes nothing", async () => {
    const staff = await person("staff reviewer", ["staff_moderator"]);
    const enquiry = await acceptedEnquiry(staff, "revstaff");

    await expect(writableSubject(staff, enquiry.id)).rejects.toBeInstanceOf(PermissionError);
    await expect(
      saveReviewDraft({ buyerId: staff, enquiryId: enquiry.id, fields: { ...EMPTY_REVIEW_FIELDS, overall: 4 } }),
    ).rejects.toBeInstanceOf(PermissionError);
    await expect(createReview({ buyerId: staff, enquiryId: enquiry.id, ratings, body: BODY })).rejects.toBeInstanceOf(
      PermissionError,
    );

    expect(await prisma.review.count({ where: { enquiryId: enquiry.id } })).toBe(0);
    expect(await prisma.reviewDraft.count({ where: { enquiryId: enquiry.id } })).toBe(0);
  });

  it("refuses a suspended buyer, and writes nothing", async () => {
    const suspended = await person("suspended reviewer", ["buyer"], { suspended: true });
    const enquiry = await acceptedEnquiry(suspended, "revsusp");
    await expect(
      createReview({ buyerId: suspended, enquiryId: enquiry.id, ratings, body: BODY }),
    ).rejects.toBeInstanceOf(PermissionError);
    expect(await prisma.review.count({ where: { enquiryId: enquiry.id } })).toBe(0);
  });
});

/* ── The screens' half ─────────────────────────────────────────────────────── */

describe("the review page offers the form exactly where createReview would take it", () => {
  it("says the account cannot write one, rather than offering a form that is refused on post", async () => {
    const staff = await person("staff on the page", ["staff_moderator"]);
    const enquiry = await acceptedEnquiry(staff, "pagestaff");
    const page = await loadReviewWrite({ buyerId: staff, enquiry: enquiry.ref, now: new Date() });
    expect(page).toMatchObject({ kind: "refused", reason: "not_permitted", enquiry: { ref: enquiry.ref } });
    // Its other enquiries are refused for the same reason, so none is listed as open.
    await acceptedEnquiry(staff, "pagestaff2");
    expect((await loadReviewWrite({ buyerId: staff, enquiry: enquiry.ref, now: new Date() })).others).toEqual({
      rows: [],
      more: 0,
    });
  });

  it("offers the form to a provisional buyer on the same enquiry shape", async () => {
    const provisional = await person("provisional on the page", [], { provisional: true, phone: phone() });
    const enquiry = await acceptedEnquiry(provisional, "pageprov");
    const page = await loadReviewWrite({ buyerId: provisional, enquiry: enquiry.ref, now: new Date() });
    expect(page).toMatchObject({ kind: "form", mode: "new" });
  });
});
