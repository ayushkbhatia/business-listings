import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { previewRecipientsFor } from "@/app/(public)/rfq/preview";
import type { Role } from "@/lib/auth/roles";
import { selectRecipients, type FanoutRequest } from "@/lib/enquiry/fanout";
import { findBriefCandidates, type BriefMatchRequest } from "@/lib/enquiry/service-brief-server";
import { sendServiceEnquiry, type StorageDeps } from "@/lib/enquiry/service-enquiry-server";
import {
  createEnquiry,
  descendantsOf,
  findFanoutCandidates,
  type CreateEnquiryInput,
} from "@/lib/enquiry/service";
import { createReview, saveReviewDraft, writableSubject } from "@/lib/reviews/service";
import { EMPTY_REVIEW_FIELDS } from "@/lib/reviews/write";
import { loadReviewWrite, writeReviewLinkFor } from "@/lib/reviews/write-server";

/**
 * No supplier reviews itself, and no business enquires to itself.
 *
 * A seller's seat holds `buyer` as well — sign-up grants it, and a claim or a
 * team invitation adds the seller role beside it — so before this an owner
 * could send their own storefront an enquiry, answer it from the leads inbox,
 * which stamps `firstReplyAt`, and then review the reply: the verified-enquiry
 * rung, earned from one seat of one business. Or accept their own quote, for
 * the accepted-quote rung. The accepted records told buyers the whole time that
 * no supplier could write one about themselves.
 *
 * Two halves. The gate (`canReview`) refuses a subject that is the reviewer's
 * own business — on every path toward a review, and on the storefront's button
 * — while a buyer with no business and another supplier's seat pass exactly as
 * before. The send (`createEnquiry`) keeps the sender's own business out of
 * every recipient list: refused where the sender named it, dropped where a
 * matcher found it.
 *
 * ## Fixtures
 *
 * People of the file's own, named with `PREFIX` and deleted at the end; their
 * enquiries, drafts and reviews cascade with them. The owner seats sit on two
 * seeded Pro suppliers, so no monthly cap moves under the file, and on a
 * services firm this file makes and removes. Enquiries the gate is asked about
 * are written directly — the shape the leads inbox leaves behind, or an
 * enquiry sent before the send refused it.
 */

const PREFIX = "BL-OWN-BUSINESS";
const DAY = 86_400_000;
const BODY = "Quoted on the Sunday, delivered on the Tuesday, and the couplings matched the drawing.";
const RATINGS = { overall: 5, quotedAccurate: 5, onTime: null, asDescribed: null, responsiveness: null };

const users: string[] = [];
const businesses: string[] = [];

type Supplier = { id: string; slug: string; displayName: string; categoryId: string };
let x: Supplier;
let y: Supplier;

/** A seat on X that holds `buyer` too: the shape sign-up plus a claim leaves. */
let owner: { id: string; phone: string };
/** A buyer with no business at all. */
let buyer: string;
/** A seat on Y, buying from X — another business, and so X's customer. */
let seatOfY: string;

function phone(): string {
  return `+97150${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
}

async function person(
  label: string,
  roles: Role[],
  extra: { businessId?: string; phone?: string } = {},
): Promise<string> {
  const id = randomUUID();
  await prisma.user.create({
    data: {
      id,
      fullName: `${PREFIX} ${label}`,
      roles,
      ...(extra.businessId ? { businessId: extra.businessId } : {}),
      ...(extra.phone ? { phone: extra.phone } : {}),
    },
  });
  users.push(id);
  return id;
}

async function supplier(slug: string): Promise<Supplier> {
  const business = await prisma.business.findFirstOrThrow({
    where: { slug },
    select: { id: true, slug: true, displayName: true, primaryCategoryId: true },
  });
  return { id: business.id, slug: business.slug, displayName: business.displayName, categoryId: business.primaryCategoryId! };
}

let sequence = 0;

/**
 * An enquiry from `buyerId` that each of `to` answered a day ago — and, where
 * `accepted` is given, whose quote the buyer accepted. Written directly: the
 * rows the leads inbox and an acceptance leave, which is all the gate reads.
 */
async function answered(buyerId: string, to: readonly string[], accepted: string | null = null) {
  sequence += 1;
  const repliedAt = new Date(Date.now() - DAY);
  return prisma.enquiry.create({
    data: {
      ref: `ENQ-OWN${Date.now() % 100000}${sequence}`,
      buyerId,
      requirement: `${PREFIX} grooved couplings for a sprinkler riser, Al Quoz.`,
      closesAt: new Date(Date.now() + 5 * DAY),
      createdAt: new Date(Date.now() - 2 * DAY),
      ...(accepted ? { contactReleasedToBusinessId: accepted, contactReleasedAt: repliedAt } : {}),
      lines: { create: [{ description: `${PREFIX} grooved coupling`, qty: 12, unit: "pcs", sortOrder: 0 }] },
      recipients: { create: to.map((businessId) => ({ businessId, firstReplyAt: repliedAt })) },
    },
    select: { id: true, ref: true },
  });
}

/** A goods send in X's trade, shaped by the test. */
function send(over: Partial<CreateEnquiryInput>): CreateEnquiryInput {
  return {
    buyerId: null,
    requirement: `${PREFIX} — grooved couplings for a sprinkler riser, Al Quoz.`,
    lines: [{ description: `${PREFIX} grooved coupling`, qty: 12, unit: "pcs" }],
    categoryId: x.categoryId,
    emirate: "dubai",
    fanoutTo: 1,
    ...over,
  };
}

const enquiriesOf = (buyerId: string) => prisma.enquiry.count({ where: { buyerId } });

beforeAll(async () => {
  x = await supplier("al-waha-industrial-supplies");
  y = await supplier("copperfield-industrial-supplies-llc");

  const ownerPhone = phone();
  owner = {
    id: await person("owner of X", ["buyer", "seller_owner"], { businessId: x.id, phone: ownerPhone }),
    phone: ownerPhone,
  };
  buyer = await person("buyer with no business", ["buyer"]);
  seatOfY = await person("sales seat on Y", ["buyer", "seller_sales"], { businessId: y.id });
});

afterAll(async () => {
  // Enquiries, recipients, drafts and reviews cascade from the people who sent them.
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.business.deleteMany({ where: { id: { in: businesses } } });
  await prisma.$disconnect();
});

describe("the gate — no supplier reviews itself", () => {
  it("refuses the owner's review of the reply their own business sent, on every path, and writes nothing", async () => {
    const enquiry = await answered(owner.id, [x.id]);
    const now = new Date();

    expect(await createReview({ buyerId: owner.id, enquiryId: enquiry.id, ratings: RATINGS, body: BODY })).toEqual({
      ok: false,
      error: "own_business",
    });
    expect(
      await saveReviewDraft({
        buyerId: owner.id,
        enquiryId: enquiry.id,
        fields: { ...EMPTY_REVIEW_FIELDS, overall: 5, body: BODY },
      }),
    ).toEqual({ ok: false, error: "own_business" });
    // The photograph upload's gate, named or not.
    expect(await writableSubject(owner.id, enquiry.id)).toEqual({ ok: false, error: "own_business" });
    expect(await writableSubject(owner.id, enquiry.id, x.id)).toEqual({ ok: false, error: "own_business" });

    // `/review/new` offers no form: it names the supplier and the rule.
    expect(await loadReviewWrite({ buyerId: owner.id, enquiry: enquiry.ref, now })).toMatchObject({
      kind: "own_business",
      enquiry: { ref: enquiry.ref },
      supplier: { id: x.id, displayName: x.displayName },
    });
    // And the storefront's *Write a review* button is absent for them.
    expect(await writeReviewLinkFor(owner.id, x.id, now)).toBeNull();

    // Refused, not written.
    expect(await prisma.review.count({ where: { enquiryId: enquiry.id } })).toBe(0);
    expect(await prisma.reviewDraft.count({ where: { enquiryId: enquiry.id } })).toBe(0);
  });

  it("refuses it on the accepted-quote rung — their own quote, accepted by their own seat", async () => {
    const enquiry = await answered(owner.id, [x.id], x.id);

    expect(await createReview({ buyerId: owner.id, enquiryId: enquiry.id, ratings: RATINGS, body: BODY })).toEqual({
      ok: false,
      error: "own_business",
    });
    expect(
      await createReview({ buyerId: owner.id, enquiryId: enquiry.id, businessId: x.id, ratings: RATINGS, body: BODY }),
    ).toEqual({ ok: false, error: "own_business" });
    expect(await prisma.review.count({ where: { enquiryId: enquiry.id } })).toBe(0);
  });

  it("says so on the rail of the owner's other enquiries, rather than calling them unanswered", async () => {
    const first = await answered(owner.id, [x.id]);
    const second = await answered(owner.id, [x.id]);

    const page = await loadReviewWrite({ buyerId: owner.id, enquiry: first.ref, now: new Date() });
    expect(page.others.rows).toContainEqual({
      id: second.id,
      ref: second.ref,
      headline: expect.any(String),
      state: { kind: "own_business", supplierName: x.displayName },
    });
  });

  it("lets a buyer with no business review the same enquiry shape — the button, the form and the post", async () => {
    const enquiry = await answered(buyer, [x.id]);
    const now = new Date();

    expect(await writeReviewLinkFor(buyer, x.id, now)).toBe(
      `/review/new?${new URLSearchParams({ enq: enquiry.ref, about: x.id })}`,
    );
    expect(await loadReviewWrite({ buyerId: buyer, enquiry: enquiry.ref, about: x.id, now })).toMatchObject({
      kind: "form",
      mode: "new",
      supplier: { id: x.id },
      provenance: "verified_enquiry",
    });
    expect(await createReview({ buyerId: buyer, enquiryId: enquiry.id, ratings: RATINGS, body: BODY })).toMatchObject({
      ok: true,
      businessId: x.id,
      provenance: "verified_enquiry",
    });
  });

  it("lets another supplier's seat review X — a business buying from another is that supplier's customer", async () => {
    const enquiry = await answered(seatOfY, [x.id], x.id);
    expect(await createReview({ buyerId: seatOfY, enquiryId: enquiry.id, ratings: RATINGS, body: BODY })).toMatchObject({
      ok: true,
      businessId: x.id,
      provenance: "accepted_quote",
    });
  });

  it("takes the owner's own business out of the running, so one other reply is the subject rather than a choice", async () => {
    const enquiry = await answered(owner.id, [x.id, y.id]);
    const now = new Date();

    // Not "which supplier?" with their own business offered as an answer.
    expect(await loadReviewWrite({ buyerId: owner.id, enquiry: enquiry.ref, now })).toMatchObject({
      kind: "form",
      supplier: { id: y.id },
      provenance: "verified_enquiry",
    });
    expect(await writeReviewLinkFor(owner.id, y.id, now)).not.toBeNull();
    expect(await createReview({ buyerId: owner.id, enquiryId: enquiry.id, ratings: RATINGS, body: BODY })).toMatchObject({
      ok: true,
      businessId: y.id,
    });
  });
});

describe("the send — no business enquires to itself", () => {
  it("refuses the storefront composer's send to the sender's own business, and writes nothing", async () => {
    // Composer A: the storefront pins the page's own business and sends to one.
    const before = await enquiriesOf(owner.id);
    expect(await createEnquiry(send({ buyerId: owner.id, pinnedBusinessIds: [x.id] }))).toEqual({
      ok: false,
      error: "own_business",
    });
    // The picker naming it, beside another supplier: refused, not quietly trimmed.
    expect(
      await createEnquiry(send({ buyerId: owner.id, chosenBusinessIds: [x.id, y.id], fanoutTo: 2 })),
    ).toEqual({ ok: false, error: "own_business" });
    expect(await enquiriesOf(owner.id)).toBe(before);

    // The same send from a buyer with no business reaches X, and only X.
    const sent = await createEnquiry(send({ buyerId: buyer, pinnedBusinessIds: [x.id] }));
    expect(sent).toMatchObject({ ok: true });
    if (sent.ok) expect(sent.recipients.map((r) => r.businessId)).toEqual([x.id]);
  });

  it("refuses it signed out too, when the number typed into the composer is the owner's own", async () => {
    const before = await enquiriesOf(owner.id);
    const usersBefore = await prisma.user.count({ where: { phone: owner.phone } });

    expect(
      await createEnquiry(send({ phone: owner.phone, fullName: "Owner, signed out", pinnedBusinessIds: [x.id] })),
    ).toEqual({ ok: false, error: "own_business" });

    expect(await enquiriesOf(owner.id)).toBe(before);
    // The number resolved to the owner's account; no identity was minted for it.
    expect(await prisma.user.count({ where: { phone: owner.phone } })).toBe(usersBefore);
  });

  it("never hands the pinned slot to the next supplier in the ranking", async () => {
    // Before, an excluded id that arrived pinned was fetched back into the pool by id.
    const request: FanoutRequest = {
      categoryId: x.categoryId,
      categoryIds: await descendantsOf(x.categoryId),
      emirate: "dubai",
      lineCount: 1,
      want: 8,
      pinned: [x.id],
    };
    const pool = await findFanoutCandidates({ ...request, excludeBusinessIds: [x.id] });
    expect(pool.map((c) => c.businessId)).not.toContain(x.id);
  });

  it("never previews it, so the composer never ticks a supplier the send would refuse", async () => {
    // `/rfq/new` ticks what the preview lists; pinned first, so without the rule X leads the list.
    const input = { categoryId: x.categoryId, emirate: "dubai", lineCount: 1, fanoutTo: 8, pinnedBusinessIds: [x.id] };
    const ids = async (excludeBusinessId: string | null) =>
      (await previewRecipientsFor(input, { excludeBusinessId })).map((r) => r.businessId);

    expect(await ids(null)).toContain(x.id);
    expect(await ids(x.id)).not.toContain(x.id);
  });

  it("leaves it out of a fan-out the matcher chooses, and still sends to the rest", async () => {
    const request: FanoutRequest = {
      categoryId: x.categoryId,
      categoryIds: await descendantsOf(x.categoryId),
      emirate: "dubai",
      lineCount: 1,
      want: 8,
    };
    // Read-only, first: without the rule X is one of the eight, so the assertion below can fail.
    const unfiltered = selectRecipients(await findFanoutCandidates(request), request);
    expect(unfiltered.recipients.map((r) => r.businessId)).toContain(x.id);

    const sent = await createEnquiry(send({ buyerId: owner.id, fanoutTo: 8 }));
    expect(sent).toMatchObject({ ok: true });
    if (!sent.ok) return;
    expect(sent.recipients.length).toBeGreaterThan(0);
    expect(sent.recipients.map((r) => r.businessId)).not.toContain(x.id);
    expect(
      await prisma.enquiryRecipient.count({ where: { enquiryId: sent.enquiryId, businessId: x.id } }),
    ).toBe(0);
  });

  it("filters a recipient list that arrived already chosen, and refuses one that held nobody else", async () => {
    const summary = (s: Supplier) => ({ businessId: s.id, slug: s.slug, displayName: s.displayName });

    const both = await createEnquiry(
      send({ buyerId: owner.id, selection: { recipients: [summary(x), summary(y)], skipped: [] }, fanoutTo: 2 }),
    );
    expect(both).toMatchObject({ ok: true });
    if (both.ok) expect(both.recipients.map((r) => r.businessId)).toEqual([y.id]);

    expect(
      await createEnquiry(send({ buyerId: owner.id, selection: { recipients: [summary(x)], skipped: [] } })),
    ).toEqual({ ok: false, error: "own_business" });
  });
});

describe("the services paths — the storefront's service composer and the brief matcher", () => {
  let firm: { id: string; categoryId: string };
  let partner: string;

  beforeAll(async () => {
    const category = await prisma.category.findFirstOrThrow({
      where: { parentId: { not: null } },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    const mark = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
    const created = await prisma.business.create({
      data: {
        displayName: `${PREFIX} firm ${mark}`,
        tradeName: `${PREFIX} firm ${mark} LLC`,
        slug: `bl-own-business-${mark}`,
        licenceNumber: `DED-O${mark.slice(-6)}`,
        licenceAuthority: "DED",
        licenceExpiry: new Date(Date.now() + 300 * DAY),
        primaryCategoryId: category.id,
        claimStatus: "claimed",
        sellsKind: "services",
        publishedAt: new Date(),
        verificationTier: 2,
        verifiedAt: new Date(),
      },
      select: { id: true },
    });
    businesses.push(created.id);
    firm = { id: created.id, categoryId: category.id };
    await prisma.serviceCoverage.create({ data: { businessId: firm.id, emirate: "dubai", areaId: null } });
    await prisma.service.create({
      data: {
        businessId: firm.id,
        categoryId: category.id,
        name: "Statutory audit",
        slug: "statutory-audit",
        status: "live",
        position: 0,
        engagementType: "one_off_job",
      },
    });
    partner = await person("partner at the firm", ["buyer", "seller_owner"], { businessId: firm.id });
  });

  it("refuses the firm's own seat on its own storefront composer, and writes nothing", async () => {
    const storage: StorageDeps = {
      sign: async (_bucket, path) => ({ path, token: "token", url: `https://storage.test/${path}` }),
      stat: async () => null,
      remove: async () => undefined,
    };
    const result = await sendServiceEnquiry(
      {
        businessId: firm.id,
        service: "statutory-audit",
        requirement: `${PREFIX} FY2025 audit for a contracting company, three projects.`,
        scale: "AED 20–50m turnover",
        neededBy: "",
        attachment: null,
        contactPhone: "",
        contactName: "",
      },
      { buyerId: partner },
      storage,
    );
    expect(result).toEqual({ ok: false, error: "own_business" });
    expect(await enquiriesOf(partner)).toBe(0);
  });

  it("keeps the firm out of the brief matcher's pool for its own seat, and in it for everyone else", async () => {
    const request: BriefMatchRequest = {
      categoryId: firm.categoryId,
      site: { emirate: "dubai", areaId: null },
      scope: "emirate",
      engagement: null,
    };
    const ids = async (over: Partial<BriefMatchRequest> = {}) =>
      (await findBriefCandidates({ ...request, ...over })).map((candidate) => candidate.businessId);

    expect(await ids()).toContain(firm.id);
    expect(await ids({ excludeBusinessId: firm.id })).not.toContain(firm.id);
  });
});
