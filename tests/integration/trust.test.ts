import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { auditLog, openReports, priorsFor, resolveReport } from "@/lib/reports/service";
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
 * only for a visit **they** recorded. Site visits were withdrawn and the grant
 * was narrowed to the ops lead rather than widened. The subject check was
 * reading a column no code path filled in.
 */

const PREFIX = "trust-";

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });

let opsLeadId: string;
let moderatorId: string;
let fieldOfficerId: string;
let financeId: string;
let categoryId: string;
let areaId: string;
let seq = 0;

/**
 * Every row this suite writes, in the order the foreign keys allow.
 *
 * The listings are published, so a leaked one is not inert: it shows on the
 * home page and in `/dev/seat`, and the e2e dead-link check follows a cached
 * `trust-*` href into a 404 once the next reseed takes the row away. CI never
 * saw it because each job gets its own `supabase start`; a local database is
 * shared with every other worktree and keeps what it is given.
 *
 * This list used to open with three `SiteVisit*` deletes, ordered around two
 * `Restrict` foreign keys. #97 withdrew site visits and dropped the tables, so
 * `prisma.siteVisitPhoto` is `undefined` and the call threw — in `afterAll` on
 * a first run, and in `beforeAll` on every run after it, which skipped all 13
 * tests in this file. What remains needs ordering only for `AuditEvent`, whose
 * `subject` is a string rather than a foreign key and so cascades from nothing.
 */
async function removeFixtures() {
  const ours = await prisma.business.findMany({
    where: { slug: { startsWith: PREFIX } },
    select: { id: true },
  });
  const ids = ours.map((row) => row.id);
  if (ids.length === 0) return;

  const reports = await prisma.supplierReport.findMany({
    where: { subjectBusinessId: { in: ids } },
    select: { id: true },
  });

  // `AuditEvent.subject` is a string, not a foreign key — nothing cascades it.
  await prisma.auditEvent.deleteMany({
    where: {
      subject: {
        in: [
          ...ids.map((id) => `Business:${id}`),
          ...reports.map((report) => `SupplierReport:${report.id}`),
        ],
      },
    },
  });

  await prisma.supplierReport.deleteMany({ where: { subjectBusinessId: { in: ids } } });
  // By business rather than by address: the seller this suite creates has no
  // email, and after the business goes its `businessId` is set null and the row
  // is unreachable. Catches the ones earlier runs already left behind.
  await prisma.user.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.media.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.business.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

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

  await removeFixtures();
});

afterAll(async () => {
  await removeFixtures();
});

async function listing(name: string) {
  seq += 1;
  const stamp = `${Date.now()}${String(seq).padStart(2, "0")}`;
  return prisma.business.create({
    data: {
      tradeName: `${name} ${stamp}`,
      displayName: `${name} ${stamp}`,
      slug: `${PREFIX}${name.toLowerCase().replace(/\s+/g, "-")}-${stamp}`,
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

describe("the checkpoint — a tier is nobody's but the ops lead's", () => {
  /*
     §07 called this row "not a general grant" and enforced it with a subject
     check: a field verifier could tier a business they had recorded a visit to.
     Site visits were withdrawn, `Business.visitedByStaffId` went with them, and
     the conditional half had nothing left to read.

     Narrowed rather than widened. The failure the subject check existed to
     prevent — one field verifier tiering a business somebody else checked — is
     now impossible because no field verifier holds the row at all.
  */
  it("lets the ops lead set a tier", async () => {
    const business = await listing("Ops Tier");

    const result = await setVerificationTier({
      actor: actor(opsLeadId, "staff_ops_lead"),
      businessId: business.id,
      tier: 3,
      reason: "Trading history audited. Reply times and quote volume match the listing.",
    });
    expect(result).toMatchObject({ ok: true, tier: 3 });
  });

  it("refuses a field verifier", async () => {
    const business = await listing("Field Refused");

    await expect(
      setVerificationTier({
        actor: actor(fieldOfficerId, "staff_field"),
        businessId: business.id,
        tier: 3,
        reason: "Not my row any more.",
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("still refuses a moderator", async () => {
    const business = await listing("Moderator Refused");

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
