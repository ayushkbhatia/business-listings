import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { auditLog, openReports, priorsFor, resolveReport } from "@/lib/reports/service";
import { recordVisit, openVisitRequests, visitHistory, MIN_PHOTOS } from "@/lib/visits/service";
import { setVerificationTier } from "@/lib/verification/service";
import { PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";

/**
 * Step 3's checkpoint, and the two queues it drains.
 *
 *   "Prove a moderator cannot change a verification tier."
 *
 * That has been true and tested since step 0. What step 3 adds is the thing
 * that made the *other* half of the rule real: a field verifier may set a tier
 * only for a visit **they** recorded, and until `recordVisit` existed nothing
 * wrote `Business.visitedByStaffId` except the seed. The subject check was
 * reading a column no code path filled in.
 */

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });

let opsLeadId: string;
let moderatorId: string;
let fieldOfficerId: string;
let financeId: string;
let categoryId: string;
let areaId: string;
let seq = 0;

beforeAll(async () => {
  const staff = await prisma.user.findMany({
    where: {
      roles: { hasSome: ["staff_ops_lead", "staff_moderator", "staff_field", "staff_finance"] },
    },
    select: { id: true, roles: true },
  });
  const byRole = (role: Role) => staff.find((u) => u.roles.includes(role))!.id;
  opsLeadId = byRole("staff_ops_lead");
  moderatorId = byRole("staff_moderator");
  fieldOfficerId = byRole("staff_field");
  financeId = byRole("staff_finance");

  categoryId = (
    await prisma.category.findFirstOrThrow({ where: { parentId: null }, select: { id: true } })
  ).id;
  areaId = (await prisma.area.findFirstOrThrow({ select: { id: true } })).id;
});

async function listing(name: string) {
  seq += 1;
  const stamp = `${Date.now()}${String(seq).padStart(2, "0")}`;
  return prisma.business.create({
    data: {
      tradeName: `${name} ${stamp}`,
      displayName: `${name} ${stamp}`,
      slug: `trust-${name.toLowerCase().replace(/\s+/g, "-")}-${stamp}`,
      licenceNumber: `DED-${stamp.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
      primaryCategoryId: categoryId,
      claimStatus: "claimed",
      publishedAt: new Date(),
      locations: {
        create: {
          type: "head_office",
          emirate: "dubai",
          areaId,
          addressLine: "Warehouse 3, Street 12",
          published: true,
        },
      },
    },
    select: { id: true, slug: true, verificationTier: true },
  });
}

async function photo(businessId: string, over: Partial<{ lat: number; lng: number }> = {}) {
  const media = await prisma.media.create({
    data: {
      businessId,
      // `MediaKind` has no "photo". A visit photograph is a gallery image of
      // the premises, which is what the enum already calls that.
      kind: "gallery",
      storagePath: `visits/${businessId}/${Date.now()}${Math.floor(seq)}.jpg`,
      alt: "Premises",
    },
    select: { id: true },
  });
  return {
    mediaId: media.id,
    lat: over.lat ?? 25.1412,
    lng: over.lng ?? 55.2311,
    takenAt: new Date(),
  };
}

const REASON = "Attended the trade counter and the yard. Stock on the shelves, signage matches.";

describe("recording a visit", () => {
  it("writes the two columns the tier check reads, and nothing else does", async () => {
    const business = await listing("Visited");
    const photos = [await photo(business.id), await photo(business.id)];

    const result = await recordVisit({
      actor: actor(fieldOfficerId, "staff_field"),
      businessId: business.id,
      visitedAt: new Date(),
      premisesFound: true,
      signageMatches: true,
      stockPresent: true,
      photos,
      reason: REASON,
    });
    expect(result.ok).toBe(true);

    const after = await prisma.business.findUniqueOrThrow({
      where: { id: business.id },
      select: { visitedAt: true, visitedByStaffId: true, verificationTier: true },
    });
    expect(after.visitedAt).not.toBeNull();
    expect(after.visitedByStaffId).toBe(fieldOfficerId);
    // Recording what somebody found and deciding what it is worth are two
    // decisions, made by two capabilities.
    expect(after.verificationTier).toBe(business.verificationTier);
  });

  it("refuses fewer than two photographs", async () => {
    const business = await listing("One Photo");
    const result = await recordVisit({
      actor: actor(fieldOfficerId, "staff_field"),
      businessId: business.id,
      visitedAt: new Date(),
      premisesFound: true,
      signageMatches: true,
      stockPresent: true,
      photos: [await photo(business.id)],
      reason: REASON,
    });
    expect(result).toMatchObject({ ok: false, error: "needs_photos" });
    if (result.ok) return;
    expect(result.message).toContain(String(MIN_PHOTOS));
  });

  it("refuses a photograph taken outside the UAE", async () => {
    // A photograph from somewhere else is not evidence about this business.
    const business = await listing("Wrong Country");
    const result = await recordVisit({
      actor: actor(fieldOfficerId, "staff_field"),
      businessId: business.id,
      visitedAt: new Date(),
      premisesFound: true,
      signageMatches: true,
      stockPresent: true,
      photos: [
        await photo(business.id),
        await photo(business.id, { lat: 51.5074, lng: -0.1278 }),
      ],
      reason: REASON,
    });
    expect(result).toMatchObject({ ok: false, error: "outside_the_uae" });
  });

  it("refuses a moderator — visit.record is ops lead or field", async () => {
    const business = await listing("Not Theirs");
    await expect(
      recordVisit({
        actor: actor(moderatorId, "staff_moderator"),
        businessId: business.id,
        visitedAt: new Date(),
        premisesFound: true,
        signageMatches: true,
        stockPresent: true,
        photos: [await photo(business.id), await photo(business.id)],
        reason: REASON,
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("keeps what was found, so a tier can be argued with later", async () => {
    const business = await listing("Evidence");
    await recordVisit({
      actor: actor(fieldOfficerId, "staff_field"),
      businessId: business.id,
      visitedAt: new Date(),
      premisesFound: true,
      signageMatches: false,
      stockPresent: true,
      notes: "Signage still shows the previous tenant. Owner says the new board is on order.",
      photos: [await photo(business.id), await photo(business.id)],
      reason: REASON,
    });

    const history = await visitHistory(business.id);
    expect(history).toHaveLength(1);
    expect(history[0]!.signageMatches).toBe(false);
    expect(history[0]!.photos).toHaveLength(2);
    expect(history[0]!.staff.id).toBe(fieldOfficerId);
  });

  it("closes the seller's request when the visit answers one", async () => {
    const business = await listing("Requested");
    const owner = await prisma.user.create({
      data: {
        id: crypto.randomUUID(),
        fullName: "Visit Owner",
        roles: ["seller_owner"],
        businessId: business.id,
      },
      select: { id: true },
    });
    const request = await prisma.siteVisitRequest.create({
      data: { businessId: business.id, requestedById: owner.id },
      select: { id: true },
    });

    await recordVisit({
      actor: actor(fieldOfficerId, "staff_field"),
      businessId: business.id,
      requestId: request.id,
      visitedAt: new Date(),
      premisesFound: true,
      signageMatches: true,
      stockPresent: true,
      photos: [await photo(business.id), await photo(business.id)],
      reason: REASON,
    });

    const after = await prisma.siteVisitRequest.findUniqueOrThrow({
      where: { id: request.id },
      select: { completedAt: true },
    });
    expect(after.completedAt).not.toBeNull();

    const open = await openVisitRequests();
    expect(open.map((r) => r.id)).not.toContain(request.id);
  });
});

describe("the checkpoint — a tier is not a general grant", () => {
  it("lets the field verifier who recorded the visit set the tier", async () => {
    const business = await listing("Own Visit");
    await recordVisit({
      actor: actor(fieldOfficerId, "staff_field"),
      businessId: business.id,
      visitedAt: new Date(),
      premisesFound: true,
      signageMatches: true,
      stockPresent: true,
      photos: [await photo(business.id), await photo(business.id)],
      reason: REASON,
    });

    const result = await setVerificationTier({
      actor: actor(fieldOfficerId, "staff_field"),
      businessId: business.id,
      tier: 3,
      reason: "Visited on the date above. Premises, signage and stock all check out.",
    });
    expect(result).toMatchObject({ ok: true, tier: 3 });
  });

  it("refuses a different field verifier, on the same business", async () => {
    /*
     * The row §07 calls "not a general grant". Until `recordVisit` existed
     * nothing wrote `visitedByStaffId` but the seed, so this check was reading
     * a column no code path filled in.
     */
    const business = await listing("Somebody Else Visit");
    await recordVisit({
      actor: actor(fieldOfficerId, "staff_field"),
      businessId: business.id,
      visitedAt: new Date(),
      premisesFound: true,
      signageMatches: true,
      stockPresent: true,
      photos: [await photo(business.id), await photo(business.id)],
      reason: REASON,
    });

    await expect(
      setVerificationTier({
        actor: actor("00000000-0000-4000-8000-0000000000fe", "staff_field"),
        businessId: business.id,
        tier: 3,
        reason: "I did not visit this business.",
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("still refuses a moderator, whoever visited", async () => {
    const business = await listing("Moderator Refused");
    await recordVisit({
      actor: actor(fieldOfficerId, "staff_field"),
      businessId: business.id,
      visitedAt: new Date(),
      premisesFound: true,
      signageMatches: true,
      stockPresent: true,
      photos: [await photo(business.id), await photo(business.id)],
      reason: REASON,
    });

    await expect(
      setVerificationTier({
        actor: actor(moderatorId, "staff_moderator"),
        businessId: business.id,
        tier: 3,
        reason: "Not my row.",
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  });
});

describe("supplier reports", () => {
  async function reportOn(businessId: string, kind: "wrong_details" | "off_platform_payment") {
    return prisma.supplierReport.create({
      data: {
        subjectBusinessId: businessId,
        reporterId: kind === "off_platform_payment" ? null : null,
        kind,
        subjectField: kind === "wrong_details" ? "phone" : null,
        detail: "Landline is disconnected.",
      },
      select: { id: true },
    });
  }

  it("resolves with one of three outcomes and a reason", async () => {
    const business = await listing("Reported");
    const report = await reportOn(business.id, "wrong_details");

    const result = await resolveReport({
      actor: actor(moderatorId, "staff_moderator"),
      reportId: report.id,
      outcome: "seller_corrected",
      reason: "Seller updated the number and confirmed it with a call.",
    });
    expect(result.ok).toBe(true);

    const after = await prisma.supplierReport.findUniqueOrThrow({
      where: { id: report.id },
      select: { outcome: true, outcomeReason: true, resolvedAt: true },
    });
    expect(after.outcome).toBe("seller_corrected");
    expect(after.resolvedAt).not.toBeNull();
    // Never the word refund. There is no buyer money here to give back.
    expect(after.outcomeReason).not.toMatch(/refund/i);
  });

  it("keeps off-platform payment reports out of the conduct queue", async () => {
    // The README: they skip the queue. They are not a judgement call — the
    // platform detected them, and what is decided is about the account.
    const business = await listing("Steering");
    const report = await reportOn(business.id, "off_platform_payment");

    const queue = await openReports(200);
    expect(queue.map((r) => r.id)).not.toContain(report.id);
  });

  it("marks a report nobody filed as automatic", async () => {
    const business = await listing("Automatic");
    const report = await reportOn(business.id, "wrong_details");

    const queue = await openReports(200);
    const row = queue.find((r) => r.id === report.id);
    expect(row?.automatic).toBe(true);
  });

  it("counts prior reports on the same field, for the three-strikes flag", async () => {
    const business = await listing("Three Strikes");
    await reportOn(business.id, "wrong_details");
    await reportOn(business.id, "wrong_details");

    const priors = await priorsFor(business.id, "phone");
    expect(priors.onField).toBe(2);
  });

  it("refuses a second resolution", async () => {
    const business = await listing("Twice Resolved");
    const report = await reportOn(business.id, "wrong_details");

    await resolveReport({
      actor: actor(moderatorId, "staff_moderator"),
      reportId: report.id,
      outcome: "no_action",
      reason: "Checked the number and it rings. Nothing to correct.",
    });
    const again = await resolveReport({
      actor: actor(moderatorId, "staff_moderator"),
      reportId: report.id,
      outcome: "upheld",
      reason: "Changed my mind.",
    });
    expect(again).toMatchObject({ ok: false, error: "already_resolved" });
  });

  it("refuses a field verifier — report.resolve is moderator or ops lead", async () => {
    const business = await listing("Not Field");
    const report = await reportOn(business.id, "wrong_details");

    await expect(
      resolveReport({
        actor: actor(fieldOfficerId, "staff_field"),
        reportId: report.id,
        outcome: "no_action",
        reason: "Not my queue.",
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  });
});

describe("the audit log, scoped", () => {
  it("shows an ops lead everything", async () => {
    const rows = await auditLog(actor(opsLeadId, "staff_ops_lead"), { limit: 200 });
    expect(rows).not.toBeNull();
    const actors = new Set(rows!.map((row) => row.actor.id));
    // More than one person's actions, which is the whole difference.
    expect(actors.size).toBeGreaterThan(1);
  });

  it("shows a moderator their own actions and nobody else's", async () => {
    /*
     * §07's row: ops lead reads all of it, everybody else reads their own.
     * `auditScopeFor` has implemented this since handoff 3 and was called from
     * nowhere — so the narrowing existed and narrowed nothing.
     */
    const rows = await auditLog(actor(moderatorId, "staff_moderator"), { limit: 200 });
    expect(rows).not.toBeNull();
    expect(rows!.length).toBeGreaterThan(0);
    for (const row of rows!) {
      expect(row.actor.id).toBe(moderatorId);
    }
  });

  it("shows finance their own actions too", async () => {
    const rows = await auditLog(actor(financeId, "staff_finance"), { limit: 50 });
    expect(rows).not.toBeNull();
    for (const row of rows!) expect(row.actor.id).toBe(financeId);
  });

  it("shows a seller nothing at all", async () => {
    const seller = await prisma.user.findFirstOrThrow({
      where: { roles: { has: "seller_owner" } },
      select: { id: true },
    });
    expect(await auditLog(actor(seller.id, "seller_owner"))).toBeNull();
  });
});
