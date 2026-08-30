import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  dismissCandidate,
  findCandidates,
  mergeBusinesses,
  openCandidates,
  unmergeBusinesses,
  REVERSIBLE_DAYS,
} from "@/lib/dedupe/service";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";

/**
 * Criterion 2, against a real database:
 *
 *   "Dedupe above 90% bulk-merges; the 60–90% band requires a decision; every
 *    merge is reversible for 30 days, writes an audit row and creates a 301."
 *
 * The assertion under all of it is the one board 12b is worried about:
 * **merging two listings must not destroy anything.** Reviews and enquiries
 * hang off `business_id` and cascade, so a merge that deletes the loser deletes
 * the reviews that were the reason to merge — and thirty days of reversibility
 * would be reversibility of nothing.
 */

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });

let opsLeadId: string;
let moderatorId: string;
let categoryId: string;
let areaId: string;
let seq = 0;

beforeAll(async () => {
  opsLeadId = (
    await prisma.user.findFirstOrThrow({
      where: { roles: { has: "staff_ops_lead" } },
      select: { id: true },
    })
  ).id;
  moderatorId = (
    await prisma.user.findFirstOrThrow({
      where: { roles: { has: "staff_moderator" } },
      select: { id: true },
    })
  ).id;
  categoryId = (
    /*
       Ordered, because "the first root category" was whatever Postgres felt
       like returning. This file creates 27 businesses in it, and on CI that
       landed on a different category than it does on a laptop — which moved a
       content metric in `page-matrix.test.ts` and turned a green suite red for
       reasons neither file mentions. Undefined ordering in a fixture is a
       fixture that means something different on every machine.
    */
    await prisma.category.findFirstOrThrow({
      where: { parentId: null },
      orderBy: { sortOrder: "asc" },
      select: { id: true },
    })
  ).id;
  areaId = (await prisma.area.findFirstOrThrow({ select: { id: true } })).id;
});

/** A published listing with a review, an enquiry and a product of its own. */
async function listingWithHistory(name: string) {
  seq += 1;
  const stamp = `${Date.now()}${String(seq).padStart(2, "0")}`;

  const business = await prisma.business.create({
    data: {
      tradeName: `${name} ${stamp}`,
      displayName: `${name} ${stamp}`,
      slug: `dedupe-${name.toLowerCase().replace(/\s+/g, "-")}-${stamp}`,
      licenceNumber: `DED-${stamp.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
      primaryCategoryId: categoryId,
      claimStatus: "claimed",
      publishedAt: new Date(),
      /*
         Verified, so these do not drag the category's verified share.

         Nothing in dedupe reads the tier — matching is on name, licence and
         phone — but the SEO page matrix reads it, and 27 unverified fixtures
         took a real category from 2/2 to 2/29 and pushed it under the thirty
         per cent floor. A fixture for one subsystem should not move another
         subsystem's numbers.
      */
      verificationTier: 2,
      locations: {
        create: {
          type: "head_office",
          emirate: "dubai",
          areaId,
          addressLine: "Warehouse 9, Street 4",
          phone: `04${stamp.slice(-7)}`,
          published: true,
        },
      },
    },
    select: { id: true, slug: true, licenceNumber: true },
  });

  const buyer = await prisma.user.create({
    data: { id: crypto.randomUUID(), fullName: "Dedupe Buyer", roles: ["buyer"] },
    select: { id: true },
  });
  const enquiry = await prisma.enquiry.create({
    data: {
      ref: `ENQ-D-${stamp}`,
      buyerId: buyer.id,
      requirement: "Gate valves, DN100.",
      closesAt: new Date(Date.now() + 7 * 86_400_000),
    },
    select: { id: true },
  });
  await prisma.enquiryRecipient.create({
    data: { enquiryId: enquiry.id, businessId: business.id, state: "delivered" },
  });
  await prisma.review.create({
    data: {
      businessId: business.id,
      buyerId: buyer.id,
      enquiryId: enquiry.id,
      overall: 5,
      quotedAccurate: 5,
      onTime: 5,
      asDescribed: 5,
      responsiveness: 5,
      body: "Stock on the shelves and counter staff who knew it.",
      editableUntil: new Date(Date.now() + 14 * 86_400_000),
    },
  });
  await prisma.product.create({
    data: {
      businessId: business.id,
      categoryId,
      name: `Gate valve ${stamp}`,
      slug: `gate-valve-${stamp}`,
      status: "live",
      availability: "in_stock",
      searchText: `gate valve ${stamp}`,
    },
  });

  return business;
}

async function counts(businessId: string) {
  const [reviews, recipients, products, locations] = await Promise.all([
    prisma.review.count({ where: { businessId } }),
    prisma.enquiryRecipient.count({ where: { businessId } }),
    prisma.product.count({ where: { businessId } }),
    prisma.location.count({ where: { businessId } }),
  ]);
  return { reviews, recipients, products, locations };
}

const REASON =
  "Same licence number on both records. One is the DED export, the other came from the free-zone list.";

describe("merging moves everything and destroys nothing", () => {
  it("moves the absorbed listing's history onto the survivor", async () => {
    const keep = await listingWithHistory("Keeper");
    const absorb = await listingWithHistory("Absorbed");

    const keepBefore = await counts(keep.id);
    const absorbBefore = await counts(absorb.id);

    const result = await mergeBusinesses({
      actor: actor(opsLeadId, "staff_ops_lead"),
      keepId: keep.id,
      absorbId: absorb.id,
      reason: REASON,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const keepAfter = await counts(keep.id);
    expect(keepAfter.reviews).toBe(keepBefore.reviews + absorbBefore.reviews);
    expect(keepAfter.products).toBe(keepBefore.products + absorbBefore.products);
    expect(keepAfter.recipients).toBe(keepBefore.recipients + absorbBefore.recipients);
    expect(keepAfter.locations).toBe(keepBefore.locations + absorbBefore.locations);

    // Nothing was deleted anywhere.
    expect(result.moved).toBeGreaterThan(0);
  });

  it("keeps the absorbed listing's row, rather than deleting it", async () => {
    const keep = await listingWithHistory("Survivor");
    const absorb = await listingWithHistory("Folded");

    await mergeBusinesses({
      actor: actor(opsLeadId, "staff_ops_lead"),
      keepId: keep.id,
      absorbId: absorb.id,
      reason: REASON,
    });

    const still = await prisma.business.findUnique({
      where: { id: absorb.id },
      select: { id: true, slug: true, mergedIntoId: true, mergedAt: true, publishedAt: true },
    });
    expect(still).not.toBeNull();
    expect(still!.slug).toBe(absorb.slug);
    expect(still!.mergedIntoId).toBe(keep.id);
    expect(still!.mergedAt).not.toBeNull();
    // Unpublished, because it is not a listing any more.
    expect(still!.publishedAt).toBeNull();
  });

  it("creates the 301, pointing at the survivor", async () => {
    const keep = await listingWithHistory("Address Keeper");
    const absorb = await listingWithHistory("Address Gone");

    await mergeBusinesses({
      actor: actor(opsLeadId, "staff_ops_lead"),
      keepId: keep.id,
      absorbId: absorb.id,
      reason: REASON,
    });

    const redirect = await prisma.redirect.findUnique({
      where: { fromPath: `/b/${absorb.slug}` },
      select: { toPath: true, statusCode: true },
    });
    expect(redirect).not.toBeNull();
    expect(redirect!.toPath).toBe(`/b/${keep.slug}`);
    expect(redirect!.statusCode).toBe(301);
  });

  it("writes one audit row with the reason", async () => {
    const keep = await listingWithHistory("Audited Keep");
    const absorb = await listingWithHistory("Audited Absorb");

    await mergeBusinesses({
      actor: actor(opsLeadId, "staff_ops_lead"),
      keepId: keep.id,
      absorbId: absorb.id,
      reason: REASON,
    });

    const rows = await prisma.auditEvent.findMany({
      where: { action: "merge", subject: `Business:${absorb.id}` },
      select: { reason: true, actorId: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason).toBe(REASON);
    expect(rows[0]!.actorId).toBe(opsLeadId);
  });

  it("refuses a moderator — business.merge is ops lead alone", async () => {
    const keep = await listingWithHistory("Refused Keep");
    const absorb = await listingWithHistory("Refused Absorb");

    await expect(
      mergeBusinesses({
        actor: actor(moderatorId, "staff_moderator"),
        keepId: keep.id,
        absorbId: absorb.id,
        reason: REASON,
      }),
    ).rejects.toBeInstanceOf(PermissionError);

    const untouched = await prisma.business.findUniqueOrThrow({
      where: { id: absorb.id },
      select: { mergedIntoId: true },
    });
    expect(untouched.mergedIntoId).toBeNull();
  });

  it("refuses merging a listing into itself", async () => {
    const one = await listingWithHistory("Alone");
    const result = await mergeBusinesses({
      actor: actor(opsLeadId, "staff_ops_lead"),
      keepId: one.id,
      absorbId: one.id,
      reason: REASON,
    });
    expect(result).toMatchObject({ ok: false, error: "same_listing" });
  });

  it("refuses merging something already merged", async () => {
    const keep = await listingWithHistory("Twice Keep");
    const absorb = await listingWithHistory("Twice Absorb");
    const third = await listingWithHistory("Twice Third");

    await mergeBusinesses({
      actor: actor(opsLeadId, "staff_ops_lead"),
      keepId: keep.id,
      absorbId: absorb.id,
      reason: REASON,
    });
    const again = await mergeBusinesses({
      actor: actor(opsLeadId, "staff_ops_lead"),
      keepId: third.id,
      absorbId: absorb.id,
      reason: REASON,
    });
    expect(again).toMatchObject({ ok: false, error: "already_merged" });
  });
});

describe("reversing a merge, within thirty days", () => {
  it("puts everything back where it came from", async () => {
    const keep = await listingWithHistory("Reverse Keep");
    const absorb = await listingWithHistory("Reverse Absorb");

    const keepBefore = await counts(keep.id);
    const absorbBefore = await counts(absorb.id);

    const merged = await mergeBusinesses({
      actor: actor(opsLeadId, "staff_ops_lead"),
      keepId: keep.id,
      absorbId: absorb.id,
      reason: REASON,
    });
    if (!merged.ok) throw new Error("merge failed");

    const reversed = await unmergeBusinesses({
      actor: actor(opsLeadId, "staff_ops_lead"),
      mergeId: merged.mergeId,
      reason: "Two different companies. The licence numbers differ by a digit and I misread them.",
    });
    expect(reversed.ok).toBe(true);

    // Exactly what each had before, on each.
    expect(await counts(keep.id)).toEqual(keepBefore);
    expect(await counts(absorb.id)).toEqual(absorbBefore);

    const restored = await prisma.business.findUniqueOrThrow({
      where: { id: absorb.id },
      select: { mergedIntoId: true, mergedAt: true },
    });
    expect(restored.mergedIntoId).toBeNull();
    expect(restored.mergedAt).toBeNull();
  });

  it("takes the 301 down, so buyers stop being sent to the wrong company", async () => {
    const keep = await listingWithHistory("Redirect Keep");
    const absorb = await listingWithHistory("Redirect Absorb");

    const merged = await mergeBusinesses({
      actor: actor(opsLeadId, "staff_ops_lead"),
      keepId: keep.id,
      absorbId: absorb.id,
      reason: REASON,
    });
    if (!merged.ok) throw new Error("merge failed");

    await unmergeBusinesses({
      actor: actor(opsLeadId, "staff_ops_lead"),
      mergeId: merged.mergeId,
      reason: "Reversed — they are two companies.",
    });

    const redirect = await prisma.redirect.findUnique({
      where: { fromPath: `/b/${absorb.slug}` },
    });
    expect(redirect).toBeNull();
  });

  it("replays the manifest rather than recomputing what belongs where", async () => {
    /*
     * The reason the manifest exists. After the merge the surviving listing
     * gains rows of its own; "everything belonging to the winner" is no longer
     * the set that arrived, and a reversal that recomputed would take the new
     * ones too.
     */
    const keep = await listingWithHistory("Manifest Keep");
    const absorb = await listingWithHistory("Manifest Absorb");

    const merged = await mergeBusinesses({
      actor: actor(opsLeadId, "staff_ops_lead"),
      keepId: keep.id,
      absorbId: absorb.id,
      reason: REASON,
    });
    if (!merged.ok) throw new Error("merge failed");

    // A product added to the survivor after the merge.
    const afterwards = await prisma.product.create({
      data: {
        businessId: keep.id,
        categoryId,
        name: `Added later ${Date.now()}`,
        slug: `added-later-${Date.now()}`,
        status: "live",
        availability: "in_stock",
        searchText: "added later",
      },
      select: { id: true },
    });

    await unmergeBusinesses({
      actor: actor(opsLeadId, "staff_ops_lead"),
      mergeId: merged.mergeId,
      reason: "Reversed.",
    });

    // The new product stayed with the survivor.
    const still = await prisma.product.findUniqueOrThrow({
      where: { id: afterwards.id },
      select: { businessId: true },
    });
    expect(still.businessId).toBe(keep.id);
  });

  it("refuses once the window has closed", async () => {
    const keep = await listingWithHistory("Late Keep");
    const absorb = await listingWithHistory("Late Absorb");

    const merged = await mergeBusinesses({
      actor: actor(opsLeadId, "staff_ops_lead"),
      keepId: keep.id,
      absorbId: absorb.id,
      reason: REASON,
    });
    if (!merged.ok) throw new Error("merge failed");

    const past = new Date(Date.now() + (REVERSIBLE_DAYS + 1) * 86_400_000);
    const result = await unmergeBusinesses(
      {
        actor: actor(opsLeadId, "staff_ops_lead"),
        mergeId: merged.mergeId,
        reason: "Too late.",
      },
      past,
    );
    expect(result).toMatchObject({ ok: false, error: "window_closed" });
  });

  it("refuses a second reversal", async () => {
    const keep = await listingWithHistory("Twice Reverse Keep");
    const absorb = await listingWithHistory("Twice Reverse Absorb");

    const merged = await mergeBusinesses({
      actor: actor(opsLeadId, "staff_ops_lead"),
      keepId: keep.id,
      absorbId: absorb.id,
      reason: REASON,
    });
    if (!merged.ok) throw new Error("merge failed");

    await unmergeBusinesses({
      actor: actor(opsLeadId, "staff_ops_lead"),
      mergeId: merged.mergeId,
      reason: "Reversed.",
    });
    const again = await unmergeBusinesses({
      actor: actor(opsLeadId, "staff_ops_lead"),
      mergeId: merged.mergeId,
      reason: "Again.",
    });
    expect(again).toMatchObject({ ok: false, error: "already_reversed" });
  });
});

describe("the candidate list", () => {
  it("finds a pair that shares a licence number, and bands it certain", async () => {
    const stamp = `${Date.now()}`;
    const shared = `DED-${stamp.slice(-6)}`;

    const first = await listingWithHistory("Band Certain One");
    const second = await listingWithHistory("Band Certain Two");
    await prisma.business.updateMany({
      where: { id: { in: [first.id, second.id] } },
      data: { licenceNumber: shared },
    });

    /*
     * An explicit limit, because the default is five hundred and this suite
     * leaves a directory with thousands of high-scoring pairs in it — the
     * licence importer's own tests import the same file more than once. This
     * test is about banding, not about the cap; the cap has its own test below.
     */
    await findCandidates(50_000);

    const candidate = await prisma.mergeCandidate.findFirst({
      where: {
        OR: [
          { keepId: first.id, absorbId: second.id },
          { keepId: second.id, absorbId: first.id },
        ],
      },
      select: { band: true, score: true, signals: true },
    });
    expect(candidate).not.toBeNull();
    expect(candidate!.band).toBe("certain");
    expect(candidate!.score).toBeGreaterThanOrEqual(0.9);
    // The signals are on the row, so the screen can say why.
    expect(JSON.stringify(candidate!.signals)).toContain("licence_number");
  }, 60_000);

  it("says how many pairs the cap dropped rather than swallowing them", async () => {
    /*
     * The same failure `parseCsv` had at five thousand rows: a scan that stops
     * at a cap and reports only what it wrote tells whoever is clearing the
     * list that they have seen everything. With the cap at one, everything but
     * the top pair is dropped and the count has to say so.
     */
    const first = await listingWithHistory("Capped One");
    const second = await listingWithHistory("Capped Two");
    const third = await listingWithHistory("Capped Three");
    const stamp = `${Date.now()}`;
    await prisma.business.updateMany({
      where: { id: { in: [first.id, second.id, third.id] } },
      data: { licenceNumber: `DED-${stamp.slice(-6)}` },
    });

    const scan = await findCandidates(1);
    expect(scan.considered).toBeGreaterThan(1);
    expect(scan.dropped).toBe(scan.considered - 1);
    expect(scan.created).toBeLessThanOrEqual(1);
  }, 60_000);

  it("does not re-propose a pair somebody dismissed", async () => {
    const stamp = `${Date.now()}`;
    const first = await listingWithHistory("Dismiss One");
    const second = await listingWithHistory("Dismiss Two");
    await prisma.business.updateMany({
      where: { id: { in: [first.id, second.id] } },
      data: { licenceNumber: `DED-${stamp.slice(-6)}` },
    });

    await findCandidates(50_000);
    const candidate = await prisma.mergeCandidate.findFirstOrThrow({
      where: {
        OR: [
          { keepId: first.id, absorbId: second.id },
          { keepId: second.id, absorbId: first.id },
        ],
      },
      select: { id: true },
    });

    await dismissCandidate({
      actor: actor(opsLeadId, "staff_ops_lead"),
      candidateId: candidate.id,
      reason: "Two brothers, two companies, one family name. Not a duplicate.",
    });

    await findCandidates(50_000);
    const count = await prisma.mergeCandidate.count({
      where: {
        OR: [
          { keepId: first.id, absorbId: second.id },
          { keepId: second.id, absorbId: first.id },
        ],
      },
    });
    // Still one row, and it is the dismissed one.
    expect(count).toBe(1);

    const open = await openCandidates();
    expect(open.map((c) => c.id)).not.toContain(candidate.id);
  }, 60_000);

  /*
     Dismissal is inside the audit fence, like merging and unmerging. Deciding
     two listings are not the same company is the decision a supplier disputes
     when their second listing never comes back, so it is the one that has to
     carry a written reason.

     These three also pin the hole the fence closed: before it, the path had no
     capability check anywhere. The screen 404s for a moderator, but the server
     action behind it only called `requireStaff()`.
  */
  async function candidateFor(label: string) {
    const stamp = `${Date.now()}`;
    const first = await listingWithHistory(`${label} One`);
    const second = await listingWithHistory(`${label} Two`);
    await prisma.business.updateMany({
      where: { id: { in: [first.id, second.id] } },
      data: { licenceNumber: `DED-${stamp.slice(-6)}` },
    });
    await findCandidates(50_000);
    return prisma.mergeCandidate.findFirstOrThrow({
      where: {
        OR: [
          { keepId: first.id, absorbId: second.id },
          { keepId: second.id, absorbId: first.id },
        ],
      },
      select: { id: true, absorbId: true },
    });
  }

  it("writes an audit row with the reason somebody typed", async () => {
    const candidate = await candidateFor("Audited Dismiss");
    const reason = "Different trade licence, different owner. Checked both.";

    await dismissCandidate({
      actor: actor(opsLeadId, "staff_ops_lead"),
      candidateId: candidate.id,
      reason,
    });

    const audit = await prisma.auditEvent.findFirst({
      where: {
        actorId: opsLeadId,
        action: "merge",
        subject: `Business:${candidate.absorbId}`,
      },
      orderBy: { createdAt: "desc" },
      select: { reason: true, before: true, after: true },
    });
    expect(audit?.reason).toBe(reason);
    // What separates a dismissal from a merge in the log, since both write
    // `merge` — the action name is 1:1 with the capability.
    expect(audit?.before).toMatchObject({ absorbId: candidate.absorbId });
    expect(audit?.after).toMatchObject({ dismissedById: opsLeadId });
  }, 60_000);

  it("refuses a blank reason, and dismisses nothing", async () => {
    const candidate = await candidateFor("Blank Reason");

    await expect(
      dismissCandidate({
        actor: actor(opsLeadId, "staff_ops_lead"),
        candidateId: candidate.id,
        reason: "   ",
      }),
    ).rejects.toThrow(AuditReasonError);

    const row = await prisma.mergeCandidate.findUniqueOrThrow({
      where: { id: candidate.id },
      select: { dismissedAt: true },
    });
    expect(row.dismissedAt).toBeNull();
  }, 60_000);

  it("refuses a seat without business.merge, even though the screen already 404s", async () => {
    const candidate = await candidateFor("Moderator Dismiss");

    await expect(
      dismissCandidate({
        actor: actor(moderatorId, "staff_moderator"),
        candidateId: candidate.id,
        reason: "A moderator should not be able to decide this.",
      }),
    ).rejects.toThrow(PermissionError);

    const row = await prisma.mergeCandidate.findUniqueOrThrow({
      where: { id: candidate.id },
      select: { dismissedAt: true },
    });
    expect(row.dismissedAt).toBeNull();
  }, 60_000);
});
