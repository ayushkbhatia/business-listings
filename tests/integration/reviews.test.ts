import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { AuditReasonError } from "@/lib/auth/errors";
import { PermissionError } from "@/lib/auth/errors";
import type { Actor } from "@/lib/auth/roles";
import {
  createReview,
  editReview,
  removeReview,
  replyToReview,
  requestReview,
} from "@/lib/reviews/service";

/**
 * Acceptance criterion 9:
 *
 *   "A review cannot be created without a confirmed enquiry or accepted quote;
 *    removal without a reason throws; removal writes an audit row."
 *
 * Against a real database, through the same service the screens call.
 */

let buyerId: string;
let businessId: string;
let acceptedEnquiryId: string;
let openEnquiryId: string;
let moderator: Actor;
let fieldStaff: Actor;

const createdReviewIds: string[] = [];
const createdRequestIds: string[] = [];

const RATINGS = { overall: 4, quotedAccurate: 5, onTime: 3, asDescribed: 4, responsiveness: 5 };
const BODY = "Quoted quickly, delivered on the day they said, and the paperwork was right.";

beforeAll(async () => {
  // ENQ-8802 is seeded already accepted, and its review is seeded too — so a
  // fresh accepted enquiry is made here rather than fighting the fixture.
  const open = await prisma.enquiry.findFirstOrThrow({
    where: { contactReleasedToBusinessId: null, review: null },
    select: { id: true, buyerId: true, recipients: { select: { businessId: true }, take: 1 } },
  });
  openEnquiryId = open.id;
  buyerId = open.buyerId;
  businessId = open.recipients[0]!.businessId;

  const staff = await prisma.user.findFirst({ where: { roles: { has: "staff_moderator" } }, select: { id: true } });
  moderator = { id: staff?.id ?? buyerId, roles: ["staff_moderator"] };
  fieldStaff = { id: staff?.id ?? buyerId, roles: ["staff_field"] };
});

/** A fresh accepted enquiry, so each test starts from the same place. */
async function acceptedEnquiry(): Promise<string> {
  const enquiry = await prisma.enquiry.create({
    data: {
      ref: `ENQ-T${Math.floor(Math.random() * 1_000_000)}`,
      buyerId,
      requirement: "A fixture enquiry for the review tests.",
      closesAt: new Date(Date.now() + 86_400_000),
      contactReleasedToBusinessId: businessId,
      contactReleasedAt: new Date(),
      lines: { create: [{ description: "Gate valve", qty: 1, sortOrder: 0 }] },
      recipients: { create: [{ businessId, state: "quoted" }] },
    },
    select: { id: true },
  });
  acceptedEnquiryId = enquiry.id;
  return enquiry.id;
}

afterEach(async () => {
  await prisma.reviewRequest.deleteMany({ where: { id: { in: createdRequestIds.splice(0) } } });
  await prisma.review.deleteMany({ where: { id: { in: createdReviewIds.splice(0) } } });
  await prisma.auditEvent.deleteMany({ where: { action: "review_removed", reason: { contains: "integration test" } } });
  if (acceptedEnquiryId) {
    await prisma.enquiry.deleteMany({ where: { id: acceptedEnquiryId } });
    acceptedEnquiryId = "";
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function write(enquiryId: string) {
  const result = await createReview({ buyerId, enquiryId, ratings: RATINGS, body: BODY });
  if (result.ok) createdReviewIds.push(result.reviewId);
  return result;
}

describe("criterion 9 — the gate", () => {
  it("accepts a review from the buyer whose quote was accepted", async () => {
    const result = await write(await acceptedEnquiry());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.businessId).toBe(businessId);
  });

  it("refuses one with no accepted quote", async () => {
    // The gate is the product: a rating nobody had to earn is one nobody reads.
    expect(await write(openEnquiryId)).toEqual({ ok: false, error: "no_accepted_quote" });
  });

  it("refuses one from somebody who is not the buyer", async () => {
    const id = await acceptedEnquiry();
    const stranger = await prisma.user.findFirstOrThrow({
      where: { id: { not: buyerId }, roles: { has: "seller_owner" } },
      select: { id: true },
    });
    const result = await createReview({
      buyerId: stranger.id,
      enquiryId: id,
      ratings: RATINGS,
      body: BODY,
    });
    expect(result).toEqual({ ok: false, error: "not_your_enquiry" });
  });

  it("allows one per enquiry and no more", async () => {
    const id = await acceptedEnquiry();
    expect((await write(id)).ok).toBe(true);
    expect(await write(id)).toEqual({ ok: false, error: "already_reviewed" });
  });

  it("refuses a rating with no words", async () => {
    const id = await acceptedEnquiry();
    const result = await createReview({ buyerId, enquiryId: id, ratings: RATINGS, body: "Good." });
    expect(result).toEqual({ ok: false, error: "empty_body" });
  });

  it("refuses a dimension outside one to five", async () => {
    const id = await acceptedEnquiry();
    const result = await createReview({
      buyerId,
      enquiryId: id,
      ratings: { ...RATINGS, onTime: 0 },
      body: BODY,
    });
    expect(result).toEqual({ ok: false, error: "invalid_ratings" });
  });
});

describe("criterion 9 — removal", () => {
  it("throws without a reason", async () => {
    const id = await acceptedEnquiry();
    const written = await write(id);
    if (!written.ok) throw new Error("unreachable");

    await expect(
      removeReview({ actor: moderator, reviewId: written.reviewId, ground: "abuse", reason: "" }),
    ).rejects.toBeInstanceOf(AuditReasonError);

    // And a row of punctuation is not a reason either.
    await expect(
      removeReview({ actor: moderator, reviewId: written.reviewId, ground: "abuse", reason: "..." }),
    ).rejects.toBeInstanceOf(AuditReasonError);

    const still = await prisma.review.findUniqueOrThrow({ where: { id: written.reviewId } });
    expect(still.removedAt).toBeNull();
  });

  it("throws for staff without the capability", async () => {
    const id = await acceptedEnquiry();
    const written = await write(id);
    if (!written.ok) throw new Error("unreachable");

    await expect(
      removeReview({
        actor: fieldStaff,
        reviewId: written.reviewId,
        ground: "abuse",
        reason: "integration test — field staff should not be able to do this",
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("writes an audit row naming the review, the actor and the reason", async () => {
    const id = await acceptedEnquiry();
    const written = await write(id);
    if (!written.ok) throw new Error("unreachable");

    const result = await removeReview({
      actor: moderator,
      reviewId: written.reviewId,
      ground: "private_information",
      reason: "integration test — the body quoted the buyer's mobile number",
    });
    expect(result).toEqual({ ok: true });

    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { subject: `Review:${written.reviewId}` },
      orderBy: { createdAt: "desc" },
    });
    expect(audit.action).toBe("review_removed");
    expect(audit.actorId).toBe(moderator.id);
    expect(audit.reason).toContain("private_information");
    expect(audit.reason).toContain("integration test");
    // Before and after, so a reviewer can see what was taken down.
    expect(audit.before).not.toBeNull();
    expect(audit.after).not.toBeNull();

    const review = await prisma.review.findUniqueOrThrow({ where: { id: written.reviewId } });
    expect(review.removedAt).not.toBeNull();
    expect(review.removalReason).toContain("private_information");
  });

  it("refuses a ground that is not one of the four", async () => {
    const id = await acceptedEnquiry();
    const written = await write(id);
    if (!written.ok) throw new Error("unreachable");
    // "It is unfair" is not one of them.
    const result = await removeReview({
      actor: moderator,
      reviewId: written.reviewId,
      ground: "unfair" as never,
      reason: "integration test — a seller did not like it",
    });
    expect(result).toEqual({ ok: false, error: "invalid_ground" });
  });

  it("cannot be removed twice", async () => {
    const id = await acceptedEnquiry();
    const written = await write(id);
    if (!written.ok) throw new Error("unreachable");
    const reason = "integration test — abusive language about a named employee";
    await removeReview({ actor: moderator, reviewId: written.reviewId, ground: "abuse", reason });
    expect(
      await removeReview({ actor: moderator, reviewId: written.reviewId, ground: "abuse", reason }),
    ).toEqual({ ok: false, error: "already_removed" });
  });

  it("the database refuses a removal with no reason, not only the service", async () => {
    // schema.prisma has promised this constraint since handoff 0 and it was
    // never written. A service-layer check is one forgotten call away.
    const id = await acceptedEnquiry();
    const written = await write(id);
    if (!written.ok) throw new Error("unreachable");

    await expect(
      prisma.review.update({
        where: { id: written.reviewId },
        data: { removedAt: new Date() },
      }),
    ).rejects.toThrow(/review_removal_has_a_reason/);
  });
});

describe("the seller's one reply", () => {
  it("posts once", async () => {
    const id = await acceptedEnquiry();
    const written = await write(id);
    if (!written.ok) throw new Error("unreachable");

    expect(
      await replyToReview({ businessId, reviewId: written.reviewId, body: "Thank you — glad the timing worked." }),
    ).toEqual({ ok: true });
  });

  it("cannot be posted twice, so it cannot be rewritten after the fact", async () => {
    const id = await acceptedEnquiry();
    const written = await write(id);
    if (!written.ok) throw new Error("unreachable");

    await replyToReview({ businessId, reviewId: written.reviewId, body: "First reply." });
    expect(
      await replyToReview({ businessId, reviewId: written.reviewId, body: "Actually, second reply." }),
    ).toEqual({ ok: false, error: "already_replied" });

    const review = await prisma.review.findUniqueOrThrow({ where: { id: written.reviewId } });
    expect(review.sellerReply).toBe("First reply.");
  });

  it("cannot be posted by another business", async () => {
    const id = await acceptedEnquiry();
    const written = await write(id);
    if (!written.ok) throw new Error("unreachable");
    const other = await prisma.business.findFirstOrThrow({
      where: { id: { not: businessId } },
      select: { id: true },
    });
    expect(
      await replyToReview({ businessId: other.id, reviewId: written.reviewId, body: "Not mine." }),
    ).toEqual({ ok: false, error: "not_yours" });
  });
});

describe("editing", () => {
  it("is allowed inside the window", async () => {
    const id = await acceptedEnquiry();
    const written = await write(id);
    if (!written.ok) throw new Error("unreachable");
    expect(
      await editReview({
        buyerId,
        reviewId: written.reviewId,
        ratings: { ...RATINGS, overall: 5 },
        body: "Revised after the second delivery, which was just as good as the first.",
      }),
    ).toEqual({ ok: true });
  });

  it("is closed after fourteen days", async () => {
    const id = await acceptedEnquiry();
    const written = await write(id);
    if (!written.ok) throw new Error("unreachable");
    const later = new Date(Date.now() + 15 * 86_400_000);
    expect(
      await editReview({ buyerId, reviewId: written.reviewId, ratings: RATINGS, body: BODY, now: later }),
    ).toEqual({ ok: false, error: "window_closed" });
  });
});

describe("asking for a review", () => {
  it("is allowed once about a recent accepted quote", async () => {
    const id = await acceptedEnquiry();
    const result = await requestReview({ businessId, enquiryId: id });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    createdRequestIds.push(result.requestId);
  });

  it("is refused a second time for the same buyer, ever", async () => {
    const first = await acceptedEnquiry();
    const asked = await requestReview({ businessId, enquiryId: first });
    if (asked.ok) createdRequestIds.push(asked.requestId);

    // A different enquiry, the same buyer.
    const second = await prisma.enquiry.create({
      data: {
        ref: `ENQ-T${Math.floor(Math.random() * 1_000_000)}`,
        buyerId,
        requirement: "A second fixture enquiry.",
        closesAt: new Date(Date.now() + 86_400_000),
        contactReleasedToBusinessId: businessId,
        contactReleasedAt: new Date(),
        lines: { create: [{ description: "Gate valve", qty: 1, sortOrder: 0 }] },
        recipients: { create: [{ businessId, state: "quoted" }] },
      },
      select: { id: true },
    });

    expect(await requestReview({ businessId, enquiryId: second.id })).toEqual({
      ok: false,
      error: "already_asked",
    });
    await prisma.enquiry.delete({ where: { id: second.id } });
  });

  it("is refused for an enquiry with no accepted quote", async () => {
    expect(await requestReview({ businessId, enquiryId: openEnquiryId })).toEqual({
      ok: false,
      error: "no_accepted_quote",
    });
  });

  it("is refused once the deal is older than ninety days", async () => {
    const id = await acceptedEnquiry();
    await prisma.enquiry.update({
      where: { id },
      data: { contactReleasedAt: new Date(Date.now() - 91 * 86_400_000) },
    });
    expect(await requestReview({ businessId, enquiryId: id })).toEqual({ ok: false, error: "too_old" });
  });
});
