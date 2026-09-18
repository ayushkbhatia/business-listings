import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { getReviewBoard } from "@/lib/db/queries";
import { reviewsBoard } from "@/lib/reviews/board";
import type { ReviewPhotoStorage } from "@/lib/reviews/photos";
import {
  createReview,
  editReview,
  replyToReview,
  saveReviewDraft,
  writableSubject,
} from "@/lib/reviews/service";
import { EMPTY_REVIEW_FIELDS, reviewPhotoPath, type ReviewFields } from "@/lib/reviews/write";
import { loadReviewWrite } from "@/lib/reviews/write-server";
import { jpegWithExif } from "@/tests/fixtures/images";

/**
 * Board 10f — writing a review, against a real database.
 *
 * The gate's window, skippable dimensions stored as null, the draft that no
 * seller reader can see, photographs stripped before they are attached, the
 * edit that keeps what it replaced, and the database refusing an edit the
 * service would also refuse.
 *
 * A buyer and company of its own, removed at the end with everything that
 * cascades from them. The supplier is a seeded claimed business; every review
 * written here is on this buyer's enquiries and goes with them.
 */

const DAY = 86_400_000;
const GPS = "GPSLatitude 25.0772 N";
const BODY = "Quote matched the final invoice to the dirham, and the crew stayed until it was done.";

let buyerId: string;
let companyId: string;
let businessId: string;
let otherBusinessId: string;
let ownerId: string;

/** A bucket in memory. `put` stands in for the browser's signed upload. */
function memoryStorage() {
  const objects = new Map<string, Uint8Array>();
  const removed: string[] = [];
  const storage: ReviewPhotoStorage = {
    sign: async (path) => ({ path, token: "t", url: `memory://${path}` }),
    read: async (path) => objects.get(path) ?? null,
    replace: async (path, bytes) => {
      objects.set(path, bytes);
      return true;
    },
    remove: async (path) => {
      objects.delete(path);
      removed.push(path);
    },
    url: (path) => `https://storage.test/${path}`,
  };
  return { storage, objects, removed, put: (path: string, bytes: Uint8Array) => objects.set(path, bytes) };
}

beforeAll(async () => {
  const [business, other] = await prisma.business.findMany({
    where: { claimStatus: "claimed", team: { some: { roles: { has: "seller_owner" } } } },
    orderBy: { id: "asc" },
    take: 2,
    select: { id: true, team: { where: { roles: { has: "seller_owner" } }, select: { id: true }, take: 1 } },
  });
  businessId = business!.id;
  ownerId = business!.team[0]!.id;
  otherBusinessId = other!.id;

  const company = await prisma.buyerCompany.create({ data: { name: "Marina Facilities LLC (10f test)" } });
  companyId = company.id;
  const buyer = await prisma.user.create({
    data: { id: randomUUID(), fullName: "Priya Menon (10f test)", roles: [] },
    select: { id: true },
  });
  buyerId = buyer.id;
  // Board 7b: membership is the record; its trigger writes `user.buyer_company_id`.
  await prisma.buyerCompanyMember.create({ data: { companyId, userId: buyerId, role: "company_admin" } });
});

afterAll(async () => {
  // Enquiries, reviews, drafts, revisions and media cascade from the buyer.
  if (buyerId) {
    await prisma.media.deleteMany({ where: { review: { buyerId } } });
    await prisma.user.deleteMany({ where: { id: buyerId } });
  }
  if (companyId) await prisma.buyerCompany.deleteMany({ where: { id: companyId } });
  await prisma.$disconnect();
});

let sequence = 0;

async function accepted(acceptedDaysAgo = 3, supplier = businessId): Promise<{ id: string; ref: string }> {
  sequence += 1;
  const at = new Date(Date.now() - acceptedDaysAgo * DAY);
  return prisma.enquiry.create({
    data: {
      ref: `ENQ-10F${Date.now() % 100000}${sequence}`,
      buyerId,
      requirement: "Deep clean AMC, 3 retail units, Sharjah. Quarterly visits.",
      closesAt: new Date(at.getTime() - DAY),
      createdAt: new Date(at.getTime() - 5 * DAY),
      contactReleasedToBusinessId: supplier,
      contactReleasedAt: at,
      lines: { create: [{ description: "Deep clean, retail unit", qty: 3, sortOrder: 0 }] },
      recipients: { create: [{ businessId: supplier, state: "quoted", firstReplyAt: at }] },
    },
    select: { id: true, ref: true },
  });
}

const fields = (over: Partial<ReviewFields> = {}): ReviewFields => ({
  ...EMPTY_REVIEW_FIELDS,
  overall: 4,
  quotedAccurate: 5,
  onTime: null,
  asDescribed: 4,
  responsiveness: null,
  body: BODY,
  ...over,
});

const ratingsOf = (f: ReviewFields) => ({
  overall: f.overall!,
  quotedAccurate: f.quotedAccurate,
  onTime: f.onTime,
  asDescribed: f.asDescribed,
  responsiveness: f.responsiveness,
});

describe("B4 — a skipped dimension is null, and averages without it", () => {
  it("stores null and leaves it out of 1m's and 11c's figures", async () => {
    const enquiry = await accepted();
    const f = fields();
    const result = await createReview({ buyerId, enquiryId: enquiry.id, ratings: ratingsOf(f), body: f.body });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = await prisma.review.findUniqueOrThrow({ where: { id: result.reviewId } });
    expect([row.overall, row.quotedAccurate, row.onTime, row.asDescribed, row.responsiveness]).toEqual([4, 5, null, 4, null]);

    // The public figures read the database's own average, which skips nulls.
    const board = await getReviewBoard(businessId, { filter: "all", sort: "recent", page: 1 });
    for (const dimension of board.summary.dimensions) {
      expect(dimension.average === null || (dimension.average >= 1 && dimension.average <= 5)).toBe(true);
    }
    const seller = await reviewsBoard({ id: ownerId, roles: ["seller_owner"], businessId }, businessId);
    for (const dimension of seller.dimensions) {
      expect(dimension.average === null || dimension.average >= 1).toBe(true);
    }
    const card = seller.reviews.find((review) => review.id === result.reviewId);
    expect(card?.dimensions.find((d) => d.key === "onTime")?.score).toBeNull();
  });

  it("refuses a post with no overall, and a body under forty", async () => {
    const enquiry = await accepted();
    expect(
      await createReview({ buyerId, enquiryId: enquiry.id, ratings: { ...ratingsOf(fields()), overall: 0 }, body: BODY }),
    ).toEqual({ ok: false, error: "invalid_ratings" });
    expect(
      await createReview({ buyerId, enquiryId: enquiry.id, ratings: ratingsOf(fields()), body: "Good, would use again." }),
    ).toEqual({ ok: false, error: "body_short" });
  });

  it("refuses contact details in the text", async () => {
    const enquiry = await accepted();
    expect(
      await createReview({
        buyerId,
        enquiryId: enquiry.id,
        ratings: ratingsOf(fields()),
        body: `${BODY} Call the supervisor on 050 641 2288.`,
      }),
    ).toEqual({ ok: false, error: "contact_details" });
  });
});

describe("Q1 — the window", () => {
  it("is open on day ninety and closed after it, from acceptance", async () => {
    const open = await accepted(89);
    expect((await writableSubject(buyerId, open.id)).ok).toBe(true);

    const closed = await accepted(92);
    const result = await createReview({ buyerId, enquiryId: closed.id, ratings: ratingsOf(fields()), body: BODY });
    expect(result).toEqual({ ok: false, error: "window_closed" });

    const page = await loadReviewWrite({ buyerId, enquiry: closed.ref, now: new Date() });
    expect(page.kind).toBe("closed");
  });
});

describe("B9 — one draft per enquiry, never visible to the seller", () => {
  it("upserts, is invisible to every review reader, and becomes the review on post", async () => {
    const enquiry = await accepted();
    const before = await getReviewBoard(businessId, { filter: "all", sort: "recent", page: 1 });
    const notifications = await prisma.notificationDelivery.count({ where: { event: "review_posted" } });

    expect((await saveReviewDraft({ buyerId, enquiryId: enquiry.id, fields: fields({ overall: 3, body: "Half" }) })).ok).toBe(true);
    expect((await saveReviewDraft({ buyerId, enquiryId: enquiry.id, fields: fields({ body: "Half written, then more." }) })).ok).toBe(true);
    expect(await prisma.reviewDraft.count({ where: { enquiryId: enquiry.id } })).toBe(1);

    // No review row, no count moved, no notification.
    const during = await getReviewBoard(businessId, { filter: "all", sort: "recent", page: 1 });
    expect(during.summary.count).toBe(before.summary.count);
    expect(await prisma.notificationDelivery.count({ where: { event: "review_posted" } })).toBe(notifications);

    const page = await loadReviewWrite({ buyerId, enquiry: enquiry.ref, now: new Date() });
    expect(page.kind).toBe("form");
    if (page.kind === "form") {
      expect(page.fields.body).toBe("Half written, then more.");
      expect(page.draftSavedAt).not.toBeNull();
      expect(page.company).toBe("Marina Facilities LLC (10f test)");
    }

    const posted = await createReview({ buyerId, enquiryId: enquiry.id, ratings: ratingsOf(fields()), body: BODY });
    expect(posted.ok).toBe(true);
    expect(await prisma.reviewDraft.count({ where: { enquiryId: enquiry.id } })).toBe(0);
  });

  it("refuses a draft the gate refuses", async () => {
    const silent = await prisma.enquiry.create({
      data: {
        ref: `ENQ-10FS${Date.now() % 100000}`,
        buyerId,
        requirement: "Nobody replied to this one.",
        closesAt: new Date(Date.now() + DAY),
        recipients: { create: [{ businessId, state: "delivered" }] },
      },
      select: { id: true, ref: true },
    });
    expect(await saveReviewDraft({ buyerId, enquiryId: silent.id, fields: fields() })).toEqual({
      ok: false,
      error: "no_confirmed_enquiry",
    });
    const page = await loadReviewWrite({ buyerId, enquiry: silent.ref, now: new Date() });
    expect(page).toMatchObject({ kind: "refused", reason: "no_confirmed_enquiry" });
  });
});

describe("B6 — photographs are stripped before anything points at them", () => {
  it("rewrites a photo without its EXIF and attaches it as review media", async () => {
    const enquiry = await accepted();
    const { storage, objects, put } = memoryStorage();
    const path = reviewPhotoPath(businessId, enquiry.id, "site.jpg");
    put(path, jpegWithExif({ width: 1200, height: 900, exif: GPS }));

    const result = await createReview(
      {
        buyerId,
        enquiryId: enquiry.id,
        ratings: ratingsOf(fields()),
        body: BODY,
        photos: [{ path, width: null, height: null, bytes: null }],
      },
      storage,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(Buffer.from(objects.get(path)!).includes(Buffer.from(GPS))).toBe(false);
    const media = await prisma.media.findMany({ where: { reviewId: result.reviewId } });
    expect(media).toHaveLength(1);
    expect(media[0]).toMatchObject({ kind: "review", storagePath: path, width: 1200, height: 900, businessId: null });
  });

  it("refuses a path from another enquiry, and deletes a file that is not an image", async () => {
    const enquiry = await accepted();
    const elsewhere = await accepted();
    const { storage, put, removed } = memoryStorage();
    const foreign = reviewPhotoPath(businessId, elsewhere.id, "site.jpg");
    put(foreign, jpegWithExif({ width: 1200, height: 900, exif: null }));
    expect(
      await createReview(
        { buyerId, enquiryId: enquiry.id, ratings: ratingsOf(fields()), body: BODY, photos: [{ path: foreign, width: null, height: null, bytes: null }] },
        storage,
      ),
    ).toEqual({ ok: false, error: "photos_invalid" });

    const notImage = reviewPhotoPath(businessId, enquiry.id, "licence.png");
    put(notImage, new TextEncoder().encode("%PDF-1.7"));
    expect(
      await createReview(
        { buyerId, enquiryId: enquiry.id, ratings: ratingsOf(fields()), body: BODY, photos: [{ path: notImage, width: null, height: null, bytes: null }] },
        storage,
      ),
    ).toEqual({ ok: false, error: "photos_invalid" });
    expect(removed).toContain(notImage);
    expect(await prisma.review.count({ where: { enquiryId: enquiry.id } })).toBe(0);
  });
});

describe("editing keeps what it replaced", () => {
  it("writes a revision with the old words and photos, and swaps the media", async () => {
    const enquiry = await accepted();
    const { storage, put } = memoryStorage();
    const first = reviewPhotoPath(businessId, enquiry.id, "first.jpg");
    const second = reviewPhotoPath(businessId, enquiry.id, "second.jpg");
    put(first, jpegWithExif({ width: 800, height: 600, exif: null }));
    put(second, jpegWithExif({ width: 800, height: 600, exif: GPS }));

    const posted = await createReview(
      { buyerId, enquiryId: enquiry.id, ratings: ratingsOf(fields()), body: BODY, photos: [{ path: first, width: null, height: null, bytes: null }] },
      storage,
    );
    if (!posted.ok) throw new Error(posted.error);

    const edited = await editReview(
      {
        buyerId,
        reviewId: posted.reviewId,
        ratings: { ...ratingsOf(fields()), overall: 5, onTime: 4 },
        body: `${BODY} Second visit was on the day.`,
        showCompanyName: false,
        photos: [{ path: second, width: null, height: null, bytes: null }],
      },
      storage,
    );
    expect(edited).toEqual({ ok: true, businessId });

    const [revision] = await prisma.reviewRevision.findMany({ where: { reviewId: posted.reviewId } });
    expect(revision).toMatchObject({ overall: 4, onTime: null, body: BODY, showCompanyName: true, photoPaths: [first] });
    const review = await prisma.review.findUniqueOrThrow({
      where: { id: posted.reviewId },
      select: { overall: true, onTime: true, showCompanyName: true, media: { select: { storagePath: true } } },
    });
    expect(review).toMatchObject({ overall: 5, onTime: 4, showCompanyName: false });
    expect(review.media.map((m) => m.storagePath)).toEqual([second]);

    const page = await loadReviewWrite({ buyerId, enquiry: enquiry.ref, now: new Date() });
    expect(page).toMatchObject({ kind: "reviewed", review: { editable: true, edited: true } });

    // The history is append-only.
    await expect(prisma.reviewRevision.deleteMany({ where: { reviewId: posted.reviewId } })).rejects.toThrow(
      /retained history/,
    );
  });

  it("stops after a seller reply — in the service and in the database", async () => {
    const enquiry = await accepted();
    const posted = await createReview({ buyerId, enquiryId: enquiry.id, ratings: ratingsOf(fields()), body: BODY });
    if (!posted.ok) throw new Error(posted.error);
    expect(await replyToReview({ businessId, reviewId: posted.reviewId, body: "Thank you." })).toEqual({ ok: true });

    expect(
      await editReview({ buyerId, reviewId: posted.reviewId, ratings: ratingsOf(fields()), body: `${BODY} Changed.` }),
    ).toEqual({ ok: false, error: "window_closed" });
    await expect(
      prisma.review.update({ where: { id: posted.reviewId }, data: { body: "Rewritten under a reply." } }),
    ).rejects.toThrow(/past editing/);
    expect(await writableSubject(buyerId, enquiry.id)).toEqual({ ok: false, error: "frozen" });

    const page = await loadReviewWrite({ buyerId, enquiry: enquiry.ref, edit: true, now: new Date() });
    expect(page).toMatchObject({ kind: "reviewed", review: { editable: false, sellerReply: "Thank you." } });
  });

  it("refuses a change to whose review it is or when it was written, even inside the window", async () => {
    const enquiry = await accepted();
    const other = await accepted();
    const posted = await createReview({ buyerId, enquiryId: enquiry.id, ratings: ratingsOf(fields()), body: BODY });
    if (!posted.ok) throw new Error(posted.error);
    await expect(
      prisma.review.update({ where: { id: posted.reviewId }, data: { enquiryId: other.id } }),
    ).rejects.toThrow(/keeps its enquiry/);
    await expect(
      prisma.review.update({ where: { id: posted.reviewId }, data: { createdAt: new Date(0) } }),
    ).rejects.toThrow(/keeps its enquiry/);
    // The supplier moves only with a 12b merge, which is a staff decision audited elsewhere.
    await prisma.review.update({ where: { id: posted.reviewId }, data: { businessId: otherBusinessId } });
    await prisma.review.update({ where: { id: posted.reviewId }, data: { businessId } });
  });
});

describe("B11 — one review per enquiry is the index, not a check", () => {
  it("answers a second concurrent post already_reviewed", async () => {
    const enquiry = await accepted();
    const post = () => createReview({ buyerId, enquiryId: enquiry.id, ratings: ratingsOf(fields()), body: BODY });
    const results = await Promise.all([post(), post()]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: "already_reviewed" }]);
  });
});

describe("B1 — the page's state comes from the enquiry, never from the query string", () => {
  it("answers somebody else's enquiry the same as one that does not exist", async () => {
    const enquiry = await accepted();
    const stranger = await prisma.user.create({ data: { id: randomUUID(), roles: [] }, select: { id: true } });
    try {
      const theirs = await loadReviewWrite({ buyerId: stranger.id, enquiry: enquiry.ref, now: new Date() });
      const missing = await loadReviewWrite({ buyerId: stranger.id, enquiry: "ENQ-0000000", now: new Date() });
      expect(theirs).toEqual(missing);
      expect(theirs).toMatchObject({ kind: "refused", reason: "not_your_enquiry", enquiry: null });
    } finally {
      await prisma.user.delete({ where: { id: stranger.id } });
    }
  });

  it("lists other enquiries with the gate's own verdict on each", async () => {
    const current = await accepted(2);
    const page = await loadReviewWrite({ buyerId, enquiry: current.ref, now: new Date() });
    expect(page.kind).not.toBe("refused");
    const kinds = new Set(page.others.rows.map((row) => row.state.kind));
    // This buyer has open, reviewed and closed enquiries by now; a closed one is never listed as open.
    for (const row of page.others.rows) {
      if (row.state.kind === "open" && row.state.closesOn) {
        expect(row.state.closesOn.getTime()).toBeGreaterThan(Date.now() - DAY);
      }
    }
    expect(kinds.size).toBeGreaterThan(0);
    expect(page.others.rows.length).toBeLessThanOrEqual(5);
  });
});

describe("the moderation list reaches past its two hundred newest", () => {
  it("narrows to one supplier by name or slug", async () => {
    const { reviewsForModeration } = await import("@/lib/reviews/service");
    const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { displayName: true, slug: true } });
    const byName = await reviewsForModeration(200, business.displayName.slice(0, 6).toUpperCase());
    expect(byName.length).toBeGreaterThan(0);
    expect(byName.every((row) => row.businessName.toLowerCase().includes(business.displayName.slice(0, 6).toLowerCase()))).toBe(true);
    const bySlug = await reviewsForModeration(200, business.slug);
    expect(bySlug.every((row) => row.businessSlug.includes(business.slug))).toBe(true);
  });
});
