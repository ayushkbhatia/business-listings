import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { resolveConflict, openConflictIfContested, conflictFor } from "@/lib/onboarding/conflict";
import { PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";

/**
 * Handoff 4 criterion 3, and the step-1 checkpoint:
 *
 *   "A conflicting claim can be resolved four ways, and the resolution
 *    notifies both parties."
 *
 * Each resolution gets its own conflict, because resolving one consumes it —
 * which is itself the point of the partial unique index. Two staff cannot
 * settle the same dispute in opposite directions.
 *
 * The assertion every one of these shares is the one that matters most to the
 * people involved: **nothing is destroyed**. Reviews and enquiries belong to
 * the listing, not to whoever wins the argument about it, and a supplier's
 * first fear on claiming is that claiming resets them.
 */

const PREFIX = "conflict-";
const ENQUIRY_PREFIX = "ENQ-C-";

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });

let opsLeadId: string;
let moderatorId: string;
let categoryId: string;
let areaId: string;
let seq = 0;

/**
 * Every row this suite writes, including the one it does not name.
 *
 * The contested listings are published, so a leaked one shows on the home page
 * and in `/dev/seat`. CI never saw the accumulation because each job gets its
 * own `supabase start`; a local database is shared with every sibling worktree
 * and keeps what it is given.
 *
 * `split_into_two` produces a *second* business under its own slug —
 * `second-company-trading-llc`, then `-2`, `-3` on each later run — which the
 * prefix would never match. `ClaimConflict.producedBusinessId` is how it is
 * found, and it has to be read before the conflict is cascaded away.
 */
async function removeFixtures() {
  const ours = await prisma.business.findMany({
    where: { slug: { startsWith: PREFIX } },
    select: { id: true },
  });
  const ids = ours.map((row) => row.id);

  if (ids.length > 0) {
    const conflicts = await prisma.claimConflict.findMany({
      where: { businessId: { in: ids } },
      select: { id: true, producedBusinessId: true },
    });
    const businessIds = [
      ...ids,
      ...conflicts.flatMap((row) => (row.producedBusinessId ? [row.producedBusinessId] : [])),
    ];

    // The claimants and the buyer, gathered while the rows naming them stand.
    const [submissions, reviews, seated] = await Promise.all([
      prisma.claimSubmission.findMany({
        where: { businessId: { in: ids } },
        select: { claimantId: true },
      }),
      prisma.review.findMany({ where: { businessId: { in: ids } }, select: { buyerId: true } }),
      prisma.user.findMany({ where: { businessId: { in: businessIds } }, select: { id: true } }),
    ]);
    const userIds = [
      ...new Set([
        ...submissions.map((row) => row.claimantId),
        ...reviews.map((row) => row.buyerId),
        ...seated.map((row) => row.id),
      ]),
    ];

    // `AuditEvent.subject` is a string, not a foreign key — nothing cascades it.
    await prisma.auditEvent.deleteMany({
      where: { subject: { in: conflicts.map((row) => `ClaimConflict:${row.id}`) } },
    });
    await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  // Outside the branch: an interrupted run can leave an enquiry whose business
  // is already gone, and nothing else would ever collect it.
  await prisma.enquiry.deleteMany({ where: { ref: { startsWith: ENQUIRY_PREFIX } } });
}

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
    await prisma.category.findFirstOrThrow({
      where: { parentId: null },
      select: { id: true },
    })
  ).id;
  areaId = (await prisma.area.findFirstOrThrow({ select: { id: true } })).id;

  await removeFixtures();
});

afterAll(async () => {
  await removeFixtures();
});

/**
 * A listing with a review, an enquiry and two people claiming it.
 *
 * Built rather than seeded because each test consumes one, and because the
 * review and the enquiry are the things being asserted about — a fixture that
 * shares them with another test cannot prove they survived.
 */
async function contestedListing(label: string) {
  seq += 1;
  // Digits only: it goes into phone numbers, and User.id is a uuid with no
  // database default — the seed supplies explicit ones and so must this.
  const stamp = `${Date.now()}${String(seq).padStart(2, "0")}`;

  const business = await prisma.business.create({
    data: {
      tradeName: `${label} Trading LLC ${stamp}`,
      displayName: `${label} Trading ${stamp}`,
      slug: `${PREFIX}${label.toLowerCase()}-${stamp}`,
      licenceNumber: `DED-${stamp.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 200 * 86_400_000),
      primaryCategoryId: categoryId,
      claimStatus: "disputed",
      publishedAt: new Date(),
      locations: {
        create: {
          type: "head_office",
          emirate: "dubai",
          areaId,
          addressLine: "Warehouse 14, Street 8",
          published: true,
        },
      },
    },
    select: { id: true, slug: true },
  });

  const buyer = await prisma.user.create({
    data: {
      id: crypto.randomUUID(),
      phone: `+9715${stamp.slice(-9)}`,
      fullName: "Conflict Buyer",
      roles: ["buyer"],
    },
    select: { id: true },
  });

  const enquiry = await prisma.enquiry.create({
    data: {
      ref: `${ENQUIRY_PREFIX}${stamp}`,
      buyerId: buyer.id,
      requirement: "Gate valves, DN100, for a fit-out.",
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
      body: "Delivered on the day they said. Counter staff knew the stock.",
      editableUntil: new Date(Date.now() + 14 * 86_400_000),
    },
  });

  const [claimantA, claimantB] = await Promise.all([
    prisma.user.create({
      data: {
        id: crypto.randomUUID(),
        phone: `+9715${stamp.slice(-8)}1`,
        fullName: `${label} Claimant A`,
        roles: ["buyer"],
      },
      select: { id: true },
    }),
    prisma.user.create({
      data: {
        id: crypto.randomUUID(),
        phone: `+9715${stamp.slice(-8)}2`,
        fullName: `${label} Claimant B`,
        roles: ["buyer"],
      },
      select: { id: true },
    }),
  ]);

  await prisma.claimSubmission.create({
    data: {
      businessId: business.id,
      claimantId: claimantA.id,
      route: "phone_callback",
      phone: "+97144001122",
      contested: true,
    },
  });
  await prisma.claimSubmission.create({
    data: {
      businessId: business.id,
      claimantId: claimantB.id,
      route: "phone_callback",
      phone: "+97144001122",
      contested: true,
    },
  });

  const conflictId = await openConflictIfContested(business.id);
  if (!conflictId) throw new Error("no conflict was opened");

  return { businessId: business.id, slug: business.slug, conflictId, claimantA, claimantB };
}

async function survivors(businessId: string) {
  const [reviews, enquiries] = await Promise.all([
    prisma.review.count({ where: { businessId, removedAt: null } }),
    prisma.enquiryRecipient.count({ where: { businessId } }),
  ]);
  return { reviews, enquiries };
}

const REASON =
  "Called the number on the DED record. The licence holder is the person who answered.";

describe("opening a conflict", () => {
  it("opens one row for two undecided claims, and only one", async () => {
    const { businessId, conflictId } = await contestedListing("Once");

    // Idempotent: a third claim, or a retry, must not open a second.
    const again = await openConflictIfContested(businessId);
    expect(again).toBe(conflictId);

    const count = await prisma.claimConflict.count({
      where: { businessId, resolvedAt: null },
    });
    expect(count).toBe(1);
  });

  it("puts the count of waiting buyers in front of the decision", async () => {
    const { conflictId } = await contestedListing("Waiting");
    const conflict = await conflictFor(conflictId);

    // Board 4c: the real cost of the delay.
    expect(conflict?.buyersWaiting).toBe(1);
    // And what claiming preserves, which is what both parties are asking.
    expect(conflict?.preserved.reviews).toBe(1);
    expect(conflict?.preserved.enquiries).toBe(1);
  });
});

describe("resolving a conflicting claim, four ways", () => {
  it("awards to A", async () => {
    const { businessId, conflictId, claimantA, claimantB } = await contestedListing("AwardA");
    const before = await survivors(businessId);

    const result = await resolveConflict({
      actor: actor(opsLeadId, "staff_ops_lead"),
      conflictId,
      resolution: "award_to_a",
      reason: REASON,
    });
    expect(result.ok).toBe(true);

    const business = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { claimStatus: true },
    });
    expect(business.claimStatus).toBe("claimed");

    const a = await prisma.user.findUniqueOrThrow({
      where: { id: claimantA.id },
      select: { businessId: true, roles: true },
    });
    expect(a.businessId).toBe(businessId);
    expect(a.roles).toContain("seller_owner");

    // The loser gets nothing, and is told — an undecided claim would put the
    // listing straight back in the queue.
    const b = await prisma.user.findUniqueOrThrow({
      where: { id: claimantB.id },
      select: { businessId: true },
    });
    expect(b.businessId).toBeNull();

    const open = await prisma.claimSubmission.count({
      where: { businessId, decidedAt: null },
    });
    expect(open).toBe(0);

    expect(await survivors(businessId)).toEqual(before);
  });

  it("awards to B", async () => {
    const { businessId, conflictId, claimantA, claimantB } = await contestedListing("AwardB");

    await resolveConflict({
      actor: actor(opsLeadId, "staff_ops_lead"),
      conflictId,
      resolution: "award_to_b",
      reason: REASON,
    });

    const b = await prisma.user.findUniqueOrThrow({
      where: { id: claimantB.id },
      select: { businessId: true },
    });
    expect(b.businessId).toBe(businessId);

    const a = await prisma.user.findUniqueOrThrow({
      where: { id: claimantA.id },
      select: { businessId: true },
    });
    expect(a.businessId).toBeNull();
  });

  it("splits into two listings, and the original keeps its address and its history", async () => {
    const { businessId, slug, conflictId, claimantB } = await contestedListing("Split");
    const before = await survivors(businessId);

    const result = await resolveConflict({
      actor: actor(opsLeadId, "staff_ops_lead"),
      conflictId,
      resolution: "split_into_two",
      reason: "Two trade licences, two companies, one subdivided warehouse. Both are real.",
      secondTradeName: "Second Company Trading LLC",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.producedBusinessId).toBeTruthy();

    // Whoever was there first keeps the address buyers already have.
    const original = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { slug: true },
    });
    expect(original.slug).toBe(slug);
    expect(await survivors(businessId)).toEqual(before);

    const created = await prisma.business.findUniqueOrThrow({
      where: { id: result.producedBusinessId! },
      select: {
        tradeName: true,
        slug: true,
        publishedAt: true,
        verificationTier: true,
        claimStatus: true,
        _count: { select: { reviews: true, recipients: true, locations: true } },
      },
    });
    expect(created.tradeName).toBe("Second Company Trading LLC");
    expect(created.slug).not.toBe(slug);
    // Nothing has been checked about a listing a dispute produced, and it says
    // so: tier 0, unpublished, no borrowed reviews.
    expect(created.publishedAt).toBeNull();
    expect(created.verificationTier).toBe(0);
    expect(created._count.reviews).toBe(0);
    expect(created._count.recipients).toBe(0);
    expect(created._count.locations).toBe(1);

    const b = await prisma.user.findUniqueOrThrow({
      where: { id: claimantB.id },
      select: { businessId: true },
    });
    expect(b.businessId).toBe(result.producedBusinessId);
  });

  it("merges as branches, so one company is not two search results", async () => {
    const { businessId, conflictId, claimantA, claimantB } = await contestedListing("Merge");
    const before = await survivors(businessId);
    const locationsBefore = await prisma.location.count({ where: { businessId } });

    const result = await resolveConflict({
      actor: actor(opsLeadId, "staff_ops_lead"),
      conflictId,
      resolution: "merge_as_branches",
      reason: "One company. A mainland licence and a JAFZA licence, which is normal.",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.producedLocationId).toBeTruthy();
    expect(result.producedBusinessId).toBeUndefined();

    expect(await prisma.location.count({ where: { businessId } })).toBe(locationsBefore + 1);
    expect(await survivors(businessId)).toEqual(before);

    // Both claimants on the same listing. That is what "one company" means.
    for (const claimant of [claimantA, claimantB]) {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: claimant.id },
        select: { businessId: true },
      });
      expect(user.businessId).toBe(businessId);
    }
  });

  it("records which of the four it was, and what it produced", async () => {
    const { conflictId } = await contestedListing("Recorded");

    await resolveConflict({
      actor: actor(opsLeadId, "staff_ops_lead"),
      conflictId,
      resolution: "split_into_two",
      reason: "Two licences, two companies, one door.",
      secondTradeName: "Recorded Second LLC",
    });

    const conflict = await prisma.claimConflict.findUniqueOrThrow({
      where: { id: conflictId },
      select: {
        resolution: true,
        reason: true,
        resolvedById: true,
        producedBusinessId: true,
      },
    });
    expect(conflict.resolution).toBe("split_into_two");
    expect(conflict.resolvedById).toBe(opsLeadId);
    expect(conflict.producedBusinessId).toBeTruthy();
    // The audit row alone would say "claim_resolved" and nothing about which
    // way, which is unreadable a year later.
    expect(conflict.reason).toContain("Two licences");
  });
});

describe("who may resolve one", () => {
  it("refuses a moderator — §07 gives claim.resolve to ops lead alone", async () => {
    const { conflictId } = await contestedListing("Refused");

    await expect(
      resolveConflict({
        actor: actor(moderatorId, "staff_moderator"),
        conflictId,
        resolution: "award_to_a",
        reason: REASON,
      }),
    ).rejects.toBeInstanceOf(PermissionError);

    const conflict = await prisma.claimConflict.findUniqueOrThrow({
      where: { id: conflictId },
      select: { resolvedAt: true },
    });
    expect(conflict.resolvedAt).toBeNull();
  });

  it("writes one audit row with the reason, on the resolution that succeeds", async () => {
    const { conflictId } = await contestedListing("Audited");

    await resolveConflict({
      actor: actor(opsLeadId, "staff_ops_lead"),
      conflictId,
      resolution: "award_to_a",
      reason: REASON,
    });

    const rows = await prisma.auditEvent.findMany({
      where: { action: "claim_resolved", subject: `ClaimConflict:${conflictId}` },
      select: { reason: true, actorId: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason).toBe(REASON);
    expect(rows[0]!.actorId).toBe(opsLeadId);
  });

  it("refuses a second resolution of the same conflict", async () => {
    const { conflictId } = await contestedListing("Twice");

    await resolveConflict({
      actor: actor(opsLeadId, "staff_ops_lead"),
      conflictId,
      resolution: "award_to_a",
      reason: REASON,
    });

    const second = await resolveConflict({
      actor: actor(opsLeadId, "staff_ops_lead"),
      conflictId,
      resolution: "award_to_b",
      reason: "Changed my mind.",
    });
    expect(second).toMatchObject({ ok: false, error: "already_resolved" });
  });

  it("refuses a split with no name for the second company", async () => {
    const { conflictId } = await contestedListing("Unnamed");

    const result = await resolveConflict({
      actor: actor(opsLeadId, "staff_ops_lead"),
      conflictId,
      resolution: "split_into_two",
      reason: "Two companies here.",
    });
    expect(result).toMatchObject({ ok: false, error: "needs_a_name" });
  });
});
