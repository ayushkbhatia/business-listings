import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { findClaimCandidates, submitClaim, whatClaimingPreserves } from "@/lib/onboarding/claim";
import { goLive, setupStateFor, TASK_POINTS } from "@/lib/onboarding/service";
import { WEIGHTS } from "@/lib/metrics/profile-strength";
import type { Actor } from "@/lib/auth/roles";

/**
 * Handoff 3 criteria 1 to 4, against a real database.
 *
 * The one worth reading carefully is criterion 2. "Claiming preserves existing
 * reviews and any historical enquiries" sounds like a thing that could not
 * possibly go wrong — until somebody implements claiming as create-then-migrate
 * rather than attach, at which point it goes wrong silently and the supplier
 * whose fourteen reviews vanished is the one who tells us.
 */

const UNCLAIMED_SLUG = "al-wadi-technical-services-llc";
const CLAIMED_SLUG = "al-marwan-industrial-supplies-llc";

let claimant: Actor;
let unclaimedId: string;

beforeAll(async () => {
  const buyer = await prisma.user.findFirstOrThrow({
    where: { roles: { has: "buyer" } },
    select: { id: true, roles: true },
  });
  claimant = { id: buyer.id, roles: buyer.roles };

  const business = await prisma.business.findUniqueOrThrow({
    where: { slug: UNCLAIMED_SLUG },
    select: { id: true },
  });
  unclaimedId = business.id;
});

afterEach(async () => {
  await prisma.claimSubmission.deleteMany({ where: { claimantId: claimant.id } });
});

afterAll(async () => {
  await prisma.claimSubmission.deleteMany({ where: { claimantId: claimant.id } });
  await prisma.$disconnect();
});

describe("criterion 1 — a supplier finds their own listing", () => {
  it("finds one by trade name", async () => {
    const results = await findClaimCandidates("Al Wadi");
    expect(results.some((r) => r.slug === UNCLAIMED_SLUG)).toBe(true);
  });

  it("finds one by licence number, punctuation and all", async () => {
    // An export writes DED-123456 and a person types 123456. A search that
    // misses on the hyphen sends them to "add from scratch", which creates the
    // duplicate this screen exists to prevent.
    const business = await prisma.business.findUniqueOrThrow({
      where: { slug: UNCLAIMED_SLUG },
      select: { licenceNumber: true },
    });
    const digits = business.licenceNumber.replace(/\D/g, "");

    const withPunctuation = await findClaimCandidates(business.licenceNumber);
    const digitsOnly = await findClaimCandidates(digits);

    expect(withPunctuation.some((r) => r.slug === UNCLAIMED_SLUG)).toBe(true);
    expect(digitsOnly.some((r) => r.slug === UNCLAIMED_SLUG)).toBe(true);
  });

  it("finds one by the phone number on its branch", async () => {
    const location = await prisma.location.findFirstOrThrow({
      where: { phone: { not: null } },
      select: { phone: true, business: { select: { slug: true } } },
    });
    const results = await findClaimCandidates(location.phone!.replace(/\D/g, ""));
    expect(results.some((r) => r.slug === location.business.slug)).toBe(true);
  });

  it("returns nothing for a query too short to mean anything", async () => {
    expect(await findClaimCandidates("a")).toEqual([]);
    expect(await findClaimCandidates("  ")).toEqual([]);
  });

  it("says what each candidate already has, so the fear can be answered", async () => {
    const results = await findClaimCandidates("Al Marwan");
    const marwan = results.find((r) => r.slug === CLAIMED_SLUG);
    expect(marwan).toBeDefined();
    expect(marwan!.reviewCount).toBeGreaterThanOrEqual(0);
    expect(marwan!.enquiryCount).toBeGreaterThan(0);
  });
});

describe("criterion 2 — claiming preserves what is already there", () => {
  it("changes nothing about the listing when a claim is submitted", async () => {
    const before = await prisma.business.findUniqueOrThrow({
      where: { id: unclaimedId },
      select: {
        claimStatus: true,
        verificationTier: true,
        _count: { select: { reviews: true, recipients: true, products: true } },
      },
    });

    const document = await prisma.document.create({
      data: {
        businessId: unclaimedId,
        kind: "trade_licence",
        storagePath: `${unclaimedId}/trade_licence/test.pdf`,
        filename: "licence.pdf",
      },
      select: { id: true },
    });

    const result = await submitClaim(claimant, {
      businessId: unclaimedId,
      route: "licence_upload",
      documentId: document.id,
    });
    expect(result.ok).toBe(true);

    const after = await prisma.business.findUniqueOrThrow({
      where: { id: unclaimedId },
      select: {
        claimStatus: true,
        verificationTier: true,
        _count: { select: { reviews: true, recipients: true, products: true } },
      },
    });

    // Not one row moved. Ownership waits for a person, which is handoff 4.
    expect(after).toEqual(before);

    /*
     * The claim first. `document_id` is ON DELETE RESTRICT precisely so a
     * licence claim cannot lose the licence it rests on, and this is what that
     * feels like from the other side.
     */
    await prisma.claimSubmission.deleteMany({ where: { documentId: document.id } });
    await prisma.document.delete({ where: { id: document.id } });
  });

  it("preserves reviews and historical enquiries on a listing that has them", async () => {
    const business = await prisma.business.findUniqueOrThrow({
      where: { slug: CLAIMED_SLUG },
      select: { id: true },
    });

    const before = await whatClaimingPreserves(business.id);
    expect(before.enquiries).toBeGreaterThan(0);

    await submitClaim(claimant, {
      businessId: business.id,
      route: "phone_callback",
      phone: "+97145550000",
    });

    expect(await whatClaimingPreserves(business.id)).toEqual(before);
  });

  it("takes a contested claim rather than refusing it", async () => {
    // The second person may well be the real owner of a listing an ex-employee
    // claimed. Closing the door is the wrong side to be wrong on.
    const business = await prisma.business.findUniqueOrThrow({
      where: { slug: CLAIMED_SLUG },
      select: { id: true },
    });

    const result = await submitClaim(claimant, {
      businessId: business.id,
      route: "phone_callback",
      phone: "+97145550000",
    });
    expect(result).toMatchObject({ ok: true, contested: true });
  });

  it("refuses a second claim from the same person", async () => {
    await submitClaim(claimant, {
      businessId: unclaimedId,
      route: "phone_callback",
      phone: "+97145550000",
    });
    const again = await submitClaim(claimant, {
      businessId: unclaimedId,
      route: "phone_callback",
      phone: "+97145550000",
    });
    expect(again.ok).toBe(false);
  });

  it("refuses a route without the evidence that route is", async () => {
    const noDocument = await submitClaim(claimant, {
      businessId: unclaimedId,
      route: "licence_upload",
    });
    expect(noDocument.ok).toBe(false);

    const noPhone = await submitClaim(claimant, {
      businessId: unclaimedId,
      route: "phone_callback",
    });
    expect(noPhone.ok).toBe(false);
  });

  it("refuses at the database too, if a service ever forgets", async () => {
    await expect(
      prisma.claimSubmission.create({
        data: { businessId: unclaimedId, claimantId: claimant.id, route: "licence_upload" },
      }),
    ).rejects.toThrow();
  });
});

describe("criterion 3 — the listing is live before the plan step", () => {
  let temporaryId: string;

  afterEach(async () => {
    if (temporaryId) {
      await prisma.location.deleteMany({ where: { businessId: temporaryId } });
      await prisma.business.deleteMany({ where: { id: temporaryId } });
    }
  });

  it("goes live on Free without anybody choosing a plan", async () => {
    const category = await prisma.category.findFirstOrThrow({ select: { id: true } });
    const area = await prisma.area.findFirstOrThrow({ select: { id: true, emirate: true } });

    const created = await prisma.business.create({
      data: {
        tradeName: "Test Onboarding Supplies LLC",
        displayName: "Test Onboarding Supplies",
        slug: `test-onboarding-${Date.now()}`,
        licenceNumber: "DED-TEST01",
        licenceAuthority: "DED",
        licenceExpiry: new Date(Date.now() + 365 * 86_400_000),
        primaryCategoryId: category.id,
        source: "self_added",
      },
      select: { id: true },
    });
    temporaryId = created.id;

    // No plan and not published, which is where the funnel leaves them after
    // the profile step.
    const before = await prisma.business.findUniqueOrThrow({
      where: { id: temporaryId },
      select: { planId: true, publishedAt: true },
    });
    expect(before.planId).toBeNull();
    expect(before.publishedAt).toBeNull();

    // A listing with no address is not a listing a buyer can visit.
    expect(await goLive(temporaryId)).toMatchObject({ ok: false });

    await prisma.location.create({
      data: {
        businessId: temporaryId,
        type: "head_office",
        emirate: area.emirate,
        areaId: area.id,
        addressLine: "Unit 4, Street 12",
        hours: {},
      },
    });

    const result = await goLive(temporaryId);
    expect(result.ok).toBe(true);

    const after = await prisma.business.findUniqueOrThrow({
      where: { id: temporaryId },
      select: { planId: true, publishedAt: true, locations: { select: { published: true } } },
    });
    // Live, on Free, and the plan screen has not been rendered yet.
    expect(after.planId).toBe("free");
    expect(after.publishedAt).not.toBeNull();
    expect(after.locations.every((l) => l.published)).toBe(true);
  });

  it("does not reset the go-live date when the seller steps back and forward", async () => {
    const category = await prisma.category.findFirstOrThrow({ select: { id: true } });
    const area = await prisma.area.findFirstOrThrow({ select: { id: true, emirate: true } });

    const created = await prisma.business.create({
      data: {
        tradeName: "Test Idempotent LLC",
        displayName: "Test Idempotent",
        slug: `test-idempotent-${Date.now()}`,
        licenceNumber: "DED-TEST02",
        licenceAuthority: "DED",
        licenceExpiry: new Date(Date.now() + 365 * 86_400_000),
        primaryCategoryId: category.id,
        source: "self_added",
        locations: {
          create: {
            type: "head_office",
            emirate: area.emirate,
            areaId: area.id,
            addressLine: "Unit 5",
            hours: {},
          },
        },
      },
      select: { id: true },
    });
    temporaryId = created.id;

    await goLive(temporaryId);
    const first = await prisma.business.findUniqueOrThrow({
      where: { id: temporaryId },
      select: { publishedAt: true },
    });

    await goLive(temporaryId);
    const second = await prisma.business.findUniqueOrThrow({
      where: { id: temporaryId },
      select: { publishedAt: true },
    });

    expect(second.publishedAt?.toISOString()).toBe(first.publishedAt?.toISOString());
  });
});

describe("criterion 4 — the four setup tasks", () => {
  it("derives completion from rows, never from a flag", async () => {
    const business = await prisma.business.findUniqueOrThrow({
      where: { slug: CLAIMED_SLUG },
      select: { id: true, _count: { select: { products: true } } },
    });

    const state = await setupStateFor(business.id);
    const products = state.tasks.find((t) => t.task === "products")!;

    // The count is the catalogue, not a stored answer about the catalogue. A
    // seller who adds products from the catalogue screen gets the same credit.
    expect(products.progress.got).toBe(business._count.products);
  });

  it("is independent — each task reads only its own rows", async () => {
    const business = await prisma.business.findUniqueOrThrow({
      where: { slug: CLAIMED_SLUG },
      select: {
        id: true,
        _count: { select: { products: true, team: true } },
      },
    });
    const state = await setupStateFor(business.id);

    /*
     * Each task's progress equals its own count and nothing else's. Asserting
     * a *particular* split — "products done, photographs not" — would pin the
     * test to how many products the seed happens to make, and the seed changes
     * for reasons that have nothing to do with this.
     */
    expect(state.tasks.find((t) => t.task === "products")?.progress.got).toBe(
      business._count.products,
    );
    expect(state.tasks.find((t) => t.task === "team")?.progress.got).toBe(business._count.team);

    // The seed stores no media at all, so this one is unambiguous.
    expect(state.tasks.find((t) => t.task === "photos")?.progress.got).toBe(0);
    expect(state.tasks.find((t) => t.task === "photos")?.done).toBe(false);
  });

  it("is resumable, because there is no session in the state at all", async () => {
    // Two reads with nothing between them give the same answer, which is what
    // "resumable after logout" means when nothing is held in a session.
    const business = await prisma.business.findUniqueOrThrow({
      where: { slug: CLAIMED_SLUG },
      select: { id: true },
    });
    const first = await setupStateFor(business.id);
    const second = await setupStateFor(business.id);
    expect(second).toEqual(first);
  });

  it("states what each task is worth, from the same weights the meter uses", async () => {
    // Board 8a publishes these numbers. Two copies that drifted apart would be
    // a promise the product breaks in front of the person it made it to.
    expect(TASK_POINTS.photos).toBe(WEIGHTS.photos);
    expect(TASK_POINTS.products).toBe(WEIGHTS.catalogue);
    expect(TASK_POINTS.team).toBe(WEIGHTS.team);
    // A visit moves trust, not strength, and the hub says so rather than
    // implying a meter it does not touch.
    expect(TASK_POINTS.visit).toBe(0);
  });

  it("marks the 80% threshold the boards draw", async () => {
    const business = await prisma.business.findUniqueOrThrow({
      where: { slug: CLAIMED_SLUG },
      select: { id: true },
    });
    expect((await setupStateFor(business.id)).threshold).toBe(80);
  });
});
