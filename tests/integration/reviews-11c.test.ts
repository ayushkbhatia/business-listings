import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import type { Actor } from "@/lib/auth/roles";
import {
  liveRequestChannels,
  removeSellerReply,
  replyToReview,
  requestReview,
} from "@/lib/reviews/service";
import { logIncentiveFinding, openDispute, openDisputes, resolveDispute } from "@/lib/reviews/disputes";
import { reviewsBoard } from "@/lib/reviews/board";
import { REPLY_WINDOW_DAYS } from "@/lib/reviews/eligibility";

/**
 * Board 11c, against a real database and through the same services the screens
 * call.
 *
 * The acceptance criteria this file is here for are the ones a unit test cannot
 * reach: **2** (one request per buyer, ever, enforced server-side), **5** (every
 * count in the header reconciles with the list beneath it), **9** (the reply
 * window closes as a state and not a deletion) and **10** (every dispute
 * produces a logged outcome with one of the four reason codes).
 */

let businessId: string;
let ownerId: string;
let buyerId: string;
let opsLead: Actor;
let moderator: Actor;

const enquiryIds: string[] = [];
const reviewIds: string[] = [];
const disputeIds: string[] = [];
const requestIds: string[] = [];
const reportIds: string[] = [];

beforeAll(async () => {
  /*
     An owner whose business already has reviews.

     Not "the first seller_owner": the dimension-average and reconciliation
     tests below have nothing to assert against an empty board, and a test that
     returns early on the fixture it happened to draw is a test that proves
     nothing while reporting a pass. `al-waha-industrial-supplies` is the review
     depth in this seed — 34 published, one held, one removed.
  */
  const owner = await prisma.user.findFirstOrThrow({
    where: {
      roles: { has: "seller_owner" },
      business: { is: { reviews: { some: { removedAt: null, heldAt: null } } } },
    },
    select: { id: true, businessId: true },
  });
  ownerId = owner.id;
  businessId = owner.businessId!;

  const buyer = await prisma.user.findFirstOrThrow({
    where: { roles: { has: "buyer" } },
    select: { id: true },
  });
  buyerId = buyer.id;

  const ops = await prisma.user.findFirstOrThrow({
    where: { roles: { has: "staff_ops_lead" } },
    select: { id: true, roles: true },
  });
  opsLead = { id: ops.id, roles: ops.roles };

  const mod = await prisma.user.findFirstOrThrow({
    where: { roles: { has: "staff_moderator" } },
    select: { id: true, roles: true },
  });
  moderator = { id: mod.id, roles: mod.roles };
});

afterEach(async () => {
  await prisma.notificationDelivery.deleteMany({
    where: { event: { in: ["review_dispute_decided", "review_requested"] }, businessId },
  });
  await prisma.supplierReport.deleteMany({ where: { id: { in: reportIds.splice(0) } } });
  await prisma.reviewDispute.deleteMany({ where: { id: { in: disputeIds.splice(0) } } });
  await prisma.reviewRequest.deleteMany({ where: { id: { in: requestIds.splice(0) } } });
  await prisma.review.deleteMany({ where: { id: { in: reviewIds.splice(0) } } });
  await prisma.enquiry.deleteMany({ where: { id: { in: enquiryIds.splice(0) } } });
  await prisma.auditEvent.deleteMany({ where: { reason: { contains: "11c fixture" } } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

let counter = 0;
function ref(): string {
  counter += 1;
  return `ENQ-11C${counter}${Math.floor(Math.random() * 100_000)}`;
}

/** A buyer we can reach, or one we cannot. Both are real states on `User`. */
async function makeBuyer(contact: { phone?: string; email?: string }): Promise<string> {
  const suffix = `${Date.now()}${counter}${Math.floor(Math.random() * 10_000)}`;
  const user = await prisma.user.create({
    data: {
      id: crypto.randomUUID(),
      fullName: "Fixture Buyer",
      roles: ["buyer"],
      ...(contact.phone ? { phone: `${contact.phone}${suffix.slice(-6)}` } : {}),
      ...(contact.email ? { email: `f${suffix}@example.test` } : {}),
    },
    select: { id: true },
  });
  return user.id;
}

async function acceptedEnquiry(who: string = buyerId, acceptedAt = new Date()): Promise<string> {
  const enquiry = await prisma.enquiry.create({
    data: {
      ref: ref(),
      buyerId: who,
      requirement: "An 11c fixture enquiry.",
      closesAt: new Date(Date.now() + 86_400_000),
      contactReleasedToBusinessId: businessId,
      contactReleasedAt: acceptedAt,
      lines: { create: [{ description: "Gate valve", qty: 1, sortOrder: 0 }] },
      recipients: { create: [{ businessId, state: "quoted", firstReplyAt: acceptedAt }] },
    },
    select: { id: true },
  });
  enquiryIds.push(enquiry.id);
  return enquiry.id;
}

async function makeReview(options: { createdAt?: Date; reply?: string } = {}): Promise<string> {
  const enquiryId = await acceptedEnquiry();
  const createdAt = options.createdAt ?? new Date();
  const review = await prisma.review.create({
    data: {
      businessId,
      buyerId,
      enquiryId,
      overall: 3,
      quotedAccurate: 3,
      onTime: 3,
      asDescribed: 3,
      responsiveness: 3,
      body: "An 11c fixture review, long enough to be a sentence somebody wrote.",
      editableUntil: new Date(createdAt.getTime() + 14 * 86_400_000),
      createdAt,
      ...(options.reply ? { sellerReply: options.reply, sellerRepliedAt: createdAt } : {}),
    },
    select: { id: true },
  });
  reviewIds.push(review.id);
  return review.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// B2 — the request channel
// ─────────────────────────────────────────────────────────────────────────────

describe("B2 — a request has to have somewhere to go", () => {
  it("sends where we hold an address the live templates can use", async () => {
    const who = await makeBuyer({ email: "yes" });
    const result = await requestReview({ businessId, enquiryId: await acceptedEnquiry(who) });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    requestIds.push(result.requestId);
    expect(result.channel).toBe("email");
  });

  it("refuses rather than spending the one request on silence", async () => {
    /*
       Criterion 2 is that a buyer can be asked at most once, ever — so the row
       *is* the rule, and a request that recorded the ask and delivered nothing
       would have spent a seller's single chance on a buyer who never heard.
       The panel shows this buyer with the reason instead.
    */
    const who = await makeBuyer({});
    const result = await requestReview({ businessId, enquiryId: await acceptedEnquiry(who) });
    expect(result).toEqual({ ok: false, error: "unreachable" });
    expect(await prisma.reviewRequest.count({ where: { buyerId: who } })).toBe(0);
  });

  it("does not offer WhatsApp while its template is waiting on Meta", async () => {
    // Every WhatsApp template in this product ships `pending_meta`. A matrix
    // that routed on a phone number alone would find nothing live and send
    // nothing at all, having told the seller it had.
    const live = await liveRequestChannels();
    expect(live.has("whatsapp")).toBe(false);
    expect(live.has("email")).toBe(true);
  });

  it("writes a delivery row, so a request that went nowhere is findable", async () => {
    const who = await makeBuyer({ email: "yes" });
    const enquiryId = await acceptedEnquiry(who);
    const result = await requestReview({ businessId, enquiryId });
    if (result.ok) requestIds.push(result.requestId);

    const deliveries = await prisma.notificationDelivery.findMany({
      where: { event: "review_requested", enquiryId },
      select: { channel: true, status: true },
    });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.channel).toBe("email");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Criterion 9 — the reply window closes, and closing is a state
// ─────────────────────────────────────────────────────────────────────────────

describe("criterion 9 — the reply window", () => {
  it("accepts a reply inside twenty-eight days", async () => {
    const reviewId = await makeReview({
      createdAt: new Date(Date.now() - (REPLY_WINDOW_DAYS - 1) * 86_400_000),
    });
    expect(await replyToReview({ businessId, reviewId, body: "Thank you." })).toEqual({ ok: true });
  });

  it("refuses one after them", async () => {
    const reviewId = await makeReview({
      createdAt: new Date(Date.now() - (REPLY_WINDOW_DAYS + 1) * 86_400_000),
    });
    expect(await replyToReview({ businessId, reviewId, body: "Thank you." })).toEqual({
      ok: false,
      error: "window_closed",
    });
  });

  it("closes without deleting anything", async () => {
    /*
       "Closing is a state change, not a deletion." Nothing is written when the
       window passes: the row is exactly as it was, and the only thing that
       changed is what the page renders and what this service accepts.
    */
    const createdAt = new Date(Date.now() - (REPLY_WINDOW_DAYS + 1) * 86_400_000);
    const reviewId = await makeReview({ createdAt });
    await replyToReview({ businessId, reviewId, body: "Too late." });

    const after = await prisma.review.findUniqueOrThrow({
      where: { id: reviewId },
      select: { sellerReply: true, removedAt: true, heldAt: true, createdAt: true },
    });
    expect(after).toEqual({
      sellerReply: null,
      removedAt: null,
      heldAt: null,
      createdAt: after.createdAt,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B5 — the dispute, and criterion 10
// ─────────────────────────────────────────────────────────────────────────────

const CASE = "The account belongs to a competitor two units down, and there is no delivery on our side.";

describe("B5 — raising a dispute", () => {
  it("takes one of the four grounds and a case", async () => {
    const reviewId = await makeReview();
    const result = await openDispute({
      businessId,
      raisedById: ownerId,
      reviewId,
      ground: "no_traceable_enquiry",
      detail: CASE,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    disputeIds.push(result.disputeId);
  });

  it("refuses a ground that is not one of the four", async () => {
    const reviewId = await makeReview();
    expect(
      await openDispute({
        businessId,
        raisedById: ownerId,
        reviewId,
        ground: "unfair",
        detail: CASE,
      }),
    ).toEqual({ ok: false, error: "invalid_ground" });
  });

  it("refuses a ground with no case behind it", async () => {
    const reviewId = await makeReview();
    expect(
      await openDispute({
        businessId,
        raisedById: ownerId,
        reviewId,
        ground: "abuse",
        detail: "unfair",
      }),
    ).toEqual({ ok: false, error: "detail_too_short" });
  });

  it("allows one open dispute per review and no more", async () => {
    // Two tabs, or two taps on a slow connection: without the partial unique
    // index the second write succeeds and one case is decided twice, on the
    // queue whose promise is a single answer in two working days.
    const reviewId = await makeReview();
    const first = await openDispute({
      businessId,
      raisedById: ownerId,
      reviewId,
      ground: "abuse",
      detail: CASE,
    });
    if (first.ok) disputeIds.push(first.disputeId);

    expect(
      await openDispute({
        businessId,
        raisedById: ownerId,
        reviewId,
        ground: "private_information",
        detail: CASE,
      }),
    ).toEqual({ ok: false, error: "already_disputed" });
  });

  it("is refused on somebody else's review", async () => {
    const reviewId = await makeReview();
    expect(
      await openDispute({
        businessId: "not-this-business",
        raisedById: ownerId,
        reviewId,
        ground: "abuse",
        detail: CASE,
      }),
    ).toEqual({ ok: false, error: "not_yours" });
  });
});

describe("criterion 10 — every dispute produces a logged outcome", () => {
  async function raise(ground: "abuse" | "no_traceable_enquiry" = "abuse"): Promise<string> {
    const reviewId = await makeReview();
    const result = await openDispute({
      businessId,
      raisedById: ownerId,
      reviewId,
      ground,
      detail: CASE,
    });
    if (!result.ok) throw new Error(`could not raise: ${result.error}`);
    disputeIds.push(result.disputeId);
    return result.disputeId;
  }

  it("refuses one, leaving the review standing, with the reason on the row", async () => {
    const disputeId = await raise();
    const outcome = await resolveDispute({
      actor: moderator,
      disputeId,
      outcome: "refused",
      reason: "11c fixture — the enquiry thread shows an accepted quote from this buyer.",
    });
    expect(outcome).toEqual({ ok: true });

    const row = await prisma.reviewDispute.findUniqueOrThrow({
      where: { id: disputeId },
      select: { outcome: true, outcomeReason: true, resolvedAt: true, decidedById: true, review: { select: { removedAt: true } } },
    });
    expect(row.outcome).toBe("refused");
    expect(row.resolvedAt).not.toBeNull();
    expect(row.decidedById).toBe(moderator.id);
    expect(row.outcomeReason).toContain("11c fixture");
    expect(row.review.removedAt).toBeNull();
  });

  it("upholds one, removing the review in the same transaction", async () => {
    const disputeId = await raise();
    const dispute = await prisma.reviewDispute.findUniqueOrThrow({
      where: { id: disputeId },
      select: { reviewId: true },
    });

    expect(
      await resolveDispute({
        actor: opsLead,
        disputeId,
        outcome: "upheld",
        reason: "11c fixture — the body carries a slur aimed at a named member of staff.",
      }),
    ).toEqual({ ok: true });

    const review = await prisma.review.findUniqueOrThrow({
      where: { id: dispute.reviewId },
      select: { removedAt: true, removalReason: true },
    });
    expect(review.removedAt).not.toBeNull();
    // The ground travels with the prose, in front of it, so the log answers
    // "what did we decide" without opening the row it points at.
    expect(review.removalReason).toMatch(/^abuse: /);
  });

  it("writes two audit rows for an upheld one, under two subjects", async () => {
    /*
       Two things happened and the log is read by subject: somebody asking what
       happened to a review greps `Review:…`, and somebody asking how we decide
       abuse disputes reads the resolutions. One row under either name would
       hide the other question.
    */
    const disputeId = await raise();
    const dispute = await prisma.reviewDispute.findUniqueOrThrow({
      where: { id: disputeId },
      select: { reviewId: true },
    });
    await resolveDispute({
      actor: opsLead,
      disputeId,
      outcome: "upheld",
      reason: "11c fixture — abusive language about a named person.",
    });

    const rows = await prisma.auditEvent.findMany({
      where: { reason: { contains: "11c fixture" } },
      select: { action: true, subject: true },
    });
    expect(rows.map((row) => row.action).sort()).toEqual([
      "review_dispute_resolved",
      "review_removed",
    ]);
    expect(rows.map((row) => row.subject).sort()).toEqual(
      [`Review:${dispute.reviewId}`, `ReviewDispute:${disputeId}`].sort(),
    );
  });

  it("does not let a moderator uphold one, because upholding removes a review", async () => {
    // §07 holds `review.remove` at ops lead alone. That falls out of the matrix
    // rather than being invented here — and it is a sentence on screen rather
    // than a thrown capability error, because a moderator needs to know where
    // the decision lives.
    const disputeId = await raise();
    const outcome = await resolveDispute({
      actor: moderator,
      disputeId,
      outcome: "upheld",
      reason: "11c fixture — a moderator trying to grant one.",
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.error).toBe("not_permitted");

    const row = await prisma.reviewDispute.findUniqueOrThrow({
      where: { id: disputeId },
      select: { outcome: true, review: { select: { removedAt: true } } },
    });
    expect(row.outcome).toBeNull();
    expect(row.review.removedAt).toBeNull();
  });

  it("tells the seller, because the rail promised it would", async () => {
    /*
       "Decided by our team in about 2 working days — we email you the outcome."
       A promise in shipped copy with no emitter behind it is the
       unowned-commitment shape board 4e Q2 already got wrong once, and the log
       was the easy half of it.

       The outcome and the ground travel; the moderator's prose does not.
       `render()` refuses a value that looks like contact details, and a reason
       explaining that a review published somebody's mobile number is a
       legitimate reason and would throw rather than send.
    */
    const disputeId = await raise();
    await resolveDispute({
      actor: moderator,
      disputeId,
      outcome: "refused",
      reason: "11c fixture — the enquiry thread names this buyer.",
    });

    const deliveries = await prisma.notificationDelivery.findMany({
      where: { event: "review_dispute_decided", businessId },
      orderBy: { createdAt: "desc" },
      take: 2,
      select: { channel: true, status: true },
    });
    // Both carriers the seller's matrix routes this to, or the one that is
    // live; what matters is that something left rather than which.
    expect(deliveries.length).toBeGreaterThan(0);
    expect(deliveries.map((row) => row.channel)).toContain("email");
  });

  it("shows the seller the decision on the card, not only in the email", async () => {
    // §States: a refused dispute leaves "the reason logged and emailed" — and a
    // seller who raised one, waited two working days and came back to a page
    // that looked exactly as it did before has been told nothing.
    const actor: Actor = { id: ownerId, roles: ["seller_owner"], businessId };
    const disputeId = await raise();
    const dispute = await prisma.reviewDispute.findUniqueOrThrow({
      where: { id: disputeId },
      select: { reviewId: true },
    });
    await resolveDispute({
      actor: moderator,
      disputeId,
      outcome: "refused",
      reason: "11c fixture — the reviewer is the buyer on an accepted quote.",
    });

    const board = await reviewsBoard(actor, businessId);
    const card = board.reviews.find((review) => review.id === dispute.reviewId);
    expect(card?.dispute?.outcome).toBe("refused");
    expect(card?.dispute?.reason).toContain("11c fixture");
    expect(card?.dispute?.decidedAt).not.toBeNull();
    // And the review is back to needing a reply, not stuck under review.
    expect(card?.state).toBe("awaiting_reply");
  });

  it("cannot be decided twice", async () => {
    const disputeId = await raise();
    await resolveDispute({
      actor: moderator,
      disputeId,
      outcome: "refused",
      reason: "11c fixture — first decision.",
    });
    const second = await resolveDispute({
      actor: moderator,
      disputeId,
      outcome: "refused",
      reason: "11c fixture — second decision.",
    });
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("unreachable");
    expect(second.error).toBe("already_resolved");
  });

  it("puts an open one in the 4h queue with its ground and the words being disputed", async () => {
    const disputeId = await raise("no_traceable_enquiry");
    const queue = await openDisputes(200);
    const mine = queue.find((row) => row.id === disputeId);
    expect(mine).toBeDefined();
    expect(mine!.ground).toBe("no_traceable_enquiry");
    expect(mine!.detail).toBe(CASE);
    expect(mine!.reviewBody).toContain("11c fixture review");
    // The single most useful fact on this ground, derived from the enquiry
    // rather than stored: a seller claiming the reviewer was never a buyer,
    // against a quote their own account accepted, has answered the dispute.
    expect(mine!.fromAcceptedQuote).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B4 and B6
// ─────────────────────────────────────────────────────────────────────────────

describe("B4 — a reply can itself breach policy", () => {
  it("takes the reply down, keeps the text, and gives no second reply", async () => {
    const reviewId = await makeReview({ reply: "A reply that broke the rules." });
    expect(
      await removeSellerReply({
        actor: opsLead,
        reviewId,
        reason: "11c fixture — the reply named the buyer's mobile number.",
      }),
    ).toEqual({ ok: true });

    const after = await prisma.review.findUniqueOrThrow({
      where: { id: reviewId },
      select: { sellerReply: true, replyRemovedAt: true, replyRemovalReason: true, removedAt: true },
    });
    // The text stays as the record of what was said, the review stands, and
    // the seller does not get another box to write in.
    expect(after.sellerReply).toBe("A reply that broke the rules.");
    expect(after.replyRemovedAt).not.toBeNull();
    expect(after.replyRemovalReason).toContain("11c fixture");
    expect(after.removedAt).toBeNull();

    expect(
      await replyToReview({ businessId, reviewId, body: "A second attempt." }),
    ).toEqual({ ok: false, error: "already_replied" });
  });

  it("refuses where there is no reply to remove", async () => {
    const reviewId = await makeReview();
    expect(
      await removeSellerReply({ actor: opsLead, reviewId, reason: "11c fixture — nothing here." }),
    ).toEqual({ ok: false, error: "no_reply" });
  });

  it("logs it under its own action, not under the review's removal", async () => {
    const reviewId = await makeReview({ reply: "A reply that broke the rules." });
    await removeSellerReply({
      actor: opsLead,
      reviewId,
      reason: "11c fixture — abusive language in the reply.",
    });
    const rows = await prisma.auditEvent.findMany({
      where: { subject: `Review:${reviewId}` },
      select: { action: true },
    });
    expect(rows.map((row) => row.action)).toEqual(["review_reply_removed"]);
  });
});

describe("B6 — the incentivised-review log", () => {
  it("files one finding against the account, in the reports queue", async () => {
    const reviewId = await makeReview();
    const result = await logIncentiveFinding({
      actor: opsLead,
      reviewId,
      reason: "11c fixture — a credit note was offered in the thread in exchange for five stars.",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    reportIds.push(result.reportId);

    const report = await prisma.supplierReport.findUniqueOrThrow({
      where: { id: result.reportId },
      select: { kind: true, reviewId: true, subjectBusinessId: true, outcome: true },
    });
    expect(report.kind).toBe("review_integrity");
    expect(report.reviewId).toBe(reviewId);
    expect(report.subjectBusinessId).toBe(businessId);
    // Open, so it is work in the queue rather than a note in a log.
    expect(report.outcome).toBeNull();
  });

  it("records one finding per review and not one per moderator who looks", async () => {
    const reviewId = await makeReview();
    const first = await logIncentiveFinding({
      actor: opsLead,
      reviewId,
      reason: "11c fixture — the first finding.",
    });
    if (first.ok) reportIds.push(first.reportId);

    expect(
      await logIncentiveFinding({
        actor: opsLead,
        reviewId,
        reason: "11c fixture — the same thing, found again.",
      }),
    ).toEqual({ ok: false, error: "already_logged" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Criterion 5 — the header reconciles with the list
// ─────────────────────────────────────────────────────────────────────────────

describe("criterion 5 — every count reconciles", () => {
  it("splits the page into two partitions that both add up", async () => {
    /*
       The board's largest arithmetic failure was "126 · 94 from a verified
       enquiry" with no account of the other 32. Two partitions here, and the
       test is that each one sums rather than that either has a particular value.
    */
    const actor: Actor = { id: ownerId, roles: ["seller_owner"], businessId };
    const board = await reviewsBoard(actor, businessId);

    expect(board.fromAcceptedQuote + board.fromConfirmedEnquiry).toBe(board.total);
    expect(board.counts.accepted_quote + board.counts.verified_enquiry).toBe(board.counts.on_page);
    expect(board.counts.on_page).toBe(board.total);
    expect(board.counts.needs_reply).toBeLessThanOrEqual(board.counts.on_page);
  });

  it("keeps a removed review on the page and out of the average", async () => {
    const actor: Actor = { id: ownerId, roles: ["seller_owner"], businessId };
    const before = await reviewsBoard(actor, businessId);

    const reviewId = await makeReview();
    const withOne = await reviewsBoard(actor, businessId);
    expect(withOne.counts.on_page).toBe(before.counts.on_page + 1);

    await prisma.review.update({
      where: { id: reviewId },
      data: { removedAt: new Date(), removalReason: "abuse: 11c fixture." },
    });

    const after = await reviewsBoard(actor, businessId);
    expect(after.counts.on_page).toBe(before.counts.on_page);
    expect(after.counts.off_page).toBe(before.counts.off_page + 1);
    // Still reachable, under the chip that names it.
    const shown = await reviewsBoard(actor, businessId, "off_page");
    expect(shown.reviews.some((review) => review.id === reviewId)).toBe(true);
  });

  it("criterion 4 — names the weakest dimension in words, and only when there is one", async () => {
    /*
       The board flagged "As described" as weakest with an amber bar, an amber
       figure and nothing a reader who cannot separate the ambers from the
       greens could use. The word is the fix — and it is withheld when every
       dimension scores the same, because a "weakest" over four equal numbers is
       a label picked by sort order rather than by the data.

       Flagged off the *rounded* averages, so the word always agrees with the
       number printed beside it.
    */
    const actor: Actor = { id: ownerId, roles: ["seller_owner"], businessId };
    const board = await reviewsBoard(actor, businessId);
    expect(board.total).toBeGreaterThan(0);

    const lowest = Math.min(...board.dimensions.map((row) => row.average));
    const highest = Math.max(...board.dimensions.map((row) => row.average));
    for (const dimension of board.dimensions) {
      expect(dimension.weakest).toBe(lowest < highest && dimension.average === lowest);
    }
    // Never every row at once: that would be four labels and no diagnosis.
    expect(board.dimensions.every((row) => row.weakest)).toBe(false);
  });

  it("counts a review under dispute as still needing a reply", async () => {
    // Q3 keeps it on the buyer's page unchanged, so a seller who says nothing
    // has said nothing in public for the two working days the decision takes.
    const actor: Actor = { id: ownerId, roles: ["seller_owner"], businessId };
    const reviewId = await makeReview();
    const before = await reviewsBoard(actor, businessId);

    const raised = await openDispute({
      businessId,
      raisedById: ownerId,
      reviewId,
      ground: "abuse",
      detail: CASE,
    });
    if (raised.ok) disputeIds.push(raised.disputeId);

    const after = await reviewsBoard(actor, businessId);
    expect(after.counts.needs_reply).toBe(before.counts.needs_reply);
    const card = after.reviews.find((review) => review.id === reviewId);
    expect(card?.state).toBe("under_dispute");
    expect(card?.replyOpen).toBe(true);
  });
});
