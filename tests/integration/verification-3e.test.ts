import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { getVerification } from "@/lib/db/queries/verification";
import { getOverview } from "@/lib/db/queries/overview";
import { sweepExpiredLicences } from "@/lib/verification/expiry-job";
import { sweepExpiringLicences } from "@/lib/verification/licence-notice-job";
import { approveDocument, rejectDocument } from "@/lib/verification/review";
import { EXPIRED_LICENCE_TIER, VERIFIED_TIER } from "@/lib/verification";
import { PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";

/**
 * Board 3e — verification and documents.
 *
 * The criteria a unit test cannot reach: what the sweep actually writes, what
 * the query actually selects, and whether a staff decision leaves an audit row
 * behind it.
 */

const PREFIX = "v3e-";
const DAY = 86_400_000;

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });

let categoryId: string;
let areaId: string;
let opsLeadId: string;
let moderatorId: string;
let seq = 0;

async function removeFixtures() {
  const ours = await prisma.business.findMany({
    where: { slug: { startsWith: PREFIX } },
    select: { id: true },
  });
  const ids = ours.map((row) => row.id);
  if (ids.length === 0) return;

  const documents = await prisma.document.findMany({
    where: { businessId: { in: ids } },
    select: { id: true },
  });
  // `AuditEvent.subject` is a string rather than a foreign key, so nothing
  // cascades it — the same ordering trust.test.ts needs.
  await prisma.auditEvent.deleteMany({
    where: { subject: { in: documents.map((document) => `Document:${document.id}`) } },
  });
  await prisma.notificationDelivery.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.notificationPreference.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.document.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.user.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.business.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  categoryId = (
    await prisma.category.findFirstOrThrow({ where: { parentId: null }, select: { id: true } })
  ).id;
  areaId = (await prisma.area.findFirstOrThrow({ select: { id: true } })).id;

  const staff = await prisma.user.findMany({
    where: { roles: { hasSome: ["staff_ops_lead", "staff_moderator"] } },
    select: { id: true, roles: true },
  });
  opsLeadId = staff.find((user) => user.roles.includes("staff_ops_lead"))!.id;
  moderatorId = staff.find((user) => user.roles.includes("staff_moderator"))!.id;

  await removeFixtures();
});

afterAll(removeFixtures);

/** A claimed, published, tier-2 listing whose licence expires when told. */
async function listing(expiresInDays: number, tier = VERIFIED_TIER) {
  seq += 1;
  const stamp = `${Date.now()}${String(seq).padStart(2, "0")}`;
  return prisma.business.create({
    data: {
      tradeName: `Verification Fixture ${stamp}`,
      displayName: `Verification Fixture ${stamp}`,
      slug: `${PREFIX}${stamp}`,
      licenceNumber: `DED-${stamp.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + expiresInDays * DAY),
      trn: "100123456783003",
      primaryCategoryId: categoryId,
      claimStatus: "claimed",
      publishedAt: new Date(),
      verificationTier: tier,
      verifiedAt: new Date(Date.now() - 200 * DAY),
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
    select: { id: true, slug: true, verificationTier: true, licenceExpiry: true },
  });
}

describe("criterion 3 — the tier drops to 1 when the licence expires overnight", () => {
  it("drops to claimed, not to the badge threshold", async () => {
    // Expires in twelve hours. The sweep runs "tomorrow".
    const business = await listing(0.5);
    expect(business.verificationTier).toBe(VERIFIED_TIER);

    const tomorrow = new Date(Date.now() + DAY);
    await sweepExpiredLicences(tomorrow);

    const after = await prisma.business.findUniqueOrThrow({
      where: { id: business.id },
      select: { verificationTier: true, verifiedAt: true, publishedAt: true },
    });
    expect(after.verificationTier).toBe(EXPIRED_LICENCE_TIER);
    expect(after.verificationTier).toBeLessThan(VERIFIED_TIER);

    /*
       Criterion 4. An expiry withdraws a claim; it does not destroy a record.
       `verifiedAt` still says when we checked — that happened, and rewriting it
       would erase the history staff need to know what to re-check — and the
       listing is still published.
    */
    expect(after.verifiedAt).not.toBeNull();
    expect(after.publishedAt).not.toBeNull();
  });

  it("leaves a listing whose licence is still current alone", async () => {
    const business = await listing(200);
    await sweepExpiredLicences(new Date());
    const after = await prisma.business.findUniqueOrThrow({
      where: { id: business.id },
      select: { verificationTier: true },
    });
    expect(after.verificationTier).toBe(VERIFIED_TIER);
  });
});

describe("criterion 10 — days to expiry is computed, never stored", () => {
  it("moves with the clock the query is asked about, on one unchanged row", async () => {
    const business = await listing(220);

    const today = await getVerification(business.id);
    const inAWeek = await getVerification(business.id, new Date(Date.now() + 7 * DAY));

    expect(today!.daysToExpiry).toBe(220);
    expect(inAWeek!.daysToExpiry).toBe(213);
    expect(today!.stage).toBe("current");

    // Nothing on the row moved between the two reads.
    const row = await prisma.business.findUniqueOrThrow({
      where: { id: business.id },
      select: { licenceExpiry: true },
    });
    expect(row.licenceExpiry).toEqual(business.licenceExpiry);
  });

  it("reports the stage the rail draws", async () => {
    const notice = await listing(40);
    const urgent = await listing(9);
    expect((await getVerification(notice.id))!.stage).toBe("notice");
    expect((await getVerification(urgent.id))!.stage).toBe("urgent");
  });
});

describe("criterion 11 — board 3a knows when to put the licence row on the page", () => {
  it("appears at sixty days, escalates at fourteen, and says nothing before", async () => {
    // The half a browser test cannot pin down: whether the row renders depends
    // on a date, and the e2e's seeded seller has three hundred days to run.
    const quiet = await listing(200);
    const notice = await listing(40);
    const urgent = await listing(9);
    const lapsed = await listing(-2, EXPIRED_LICENCE_TIER);

    expect((await getOverview(quiet.id))!.licenceStage).toBe("current");
    expect((await getOverview(notice.id))!.licenceStage).toBe("notice");
    expect((await getOverview(urgent.id))!.licenceStage).toBe("urgent");
    expect((await getOverview(lapsed.id))!.licenceStage).toBe("lapsed");

    // And the count beside it is the same one the verification screen computes.
    expect((await getOverview(notice.id))!.daysToLicenceExpiry).toBe(
      (await getVerification(notice.id))!.daysToExpiry,
    );
  });
});

describe("criterion 7 — the TRN is masked in the response, not in the view", () => {
  it("never returns the fifteen digits", async () => {
    const business = await listing(100);
    const view = await getVerification(business.id);

    const trnRow = view!.checked.find((row) => row.kind === "vat_certificate")!;
    expect(trnRow.number).toBe("100 •••• •••• 3003");
    // The whole payload, not just the field somebody remembered to check.
    expect(JSON.stringify(view)).not.toContain("100123456783003");
  });
});

describe("criterion 6 — a document we have not checked never sets the tier", () => {
  it("approving a credential moves no tier and writes an audit row", async () => {
    const business = await listing(100);
    const document = await prisma.document.create({
      data: {
        businessId: business.id,
        kind: "certificate",
        storagePath: `${business.id}/certificate/iso.pdf`,
        filename: "iso.pdf",
        displayName: "ISO 9001:2015",
        reference: "GB-4471102",
        validUntil: new Date(Date.now() + 400 * DAY),
        isPublic: true,
      },
      select: { id: true },
    });

    const before = await getVerification(business.id);
    expect(before!.credentials[0]!.state).toBe("in_review");
    expect(before!.credentials[0]!.onStorefront).toBe(false);

    const result = await approveDocument({
      actor: actor(moderatorId, "staff_moderator"),
      documentId: document.id,
      reason: "Certificate matches the registrar's entry for this licence.",
    });
    expect(result.ok).toBe(true);

    const after = await getVerification(business.id);
    expect(after!.tier).toBe(VERIFIED_TIER);
    expect(after!.credentials[0]!.state).toBe("on_file");
    expect(after!.credentials[0]!.onStorefront).toBe(true);

    // Non-negotiable 3: the decision is in the log, with the words.
    const audit = await prisma.auditEvent.findFirst({
      where: { subject: `Document:${document.id}` },
      select: { reason: true, actorId: true },
    });
    expect(audit?.actorId).toBe(moderatorId);
    expect(audit?.reason).toContain("registrar");
  });

  it("refuses to decide a trade licence, which is never published", async () => {
    const business = await listing(100);
    const document = await prisma.document.create({
      data: {
        businessId: business.id,
        kind: "trade_licence",
        storagePath: `${business.id}/trade_licence/scan.pdf`,
        filename: "scan.pdf",
        displayName: "Trade licence",
        isPublic: true,
      },
      select: { id: true },
    });

    const result = await approveDocument({
      actor: actor(moderatorId, "staff_moderator"),
      documentId: document.id,
      reason: "Trying to publish a licence scan.",
    });
    expect(result).toMatchObject({ ok: false, error: "not_a_credential" });
  });

  it("refuses a seat that does not hold queue.decide", async () => {
    const business = await listing(100);
    const document = await prisma.document.create({
      data: {
        businessId: business.id,
        kind: "certificate",
        storagePath: `${business.id}/certificate/x.pdf`,
        filename: "x.pdf",
        displayName: "Civil Defence approval",
        isPublic: true,
      },
      select: { id: true },
    });

    await expect(
      approveDocument({
        actor: actor(business.id, "seller_owner"),
        documentId: document.id,
        reason: "A seller deciding their own credential.",
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("a rejection takes it off the shop window and keeps the file", async () => {
    const business = await listing(100);
    const document = await prisma.document.create({
      data: {
        businessId: business.id,
        kind: "certificate",
        storagePath: `${business.id}/certificate/blurry.pdf`,
        filename: "blurry.pdf",
        displayName: "Civil Defence approval",
        isPublic: true,
      },
      select: { id: true },
    });

    await rejectDocument({
      actor: actor(opsLeadId, "staff_ops_lead"),
      documentId: document.id,
      reason: "The scan is cut off at the expiry date. Upload a full page and we will look again.",
    });

    const after = await prisma.document.findUniqueOrThrow({
      where: { id: document.id },
      select: { isPublic: true, reviewedAt: true, reviewReason: true },
    });
    expect(after.isPublic).toBe(false);
    expect(after.reviewedAt).not.toBeNull();
    expect(after.reviewReason).toContain("full page");
  });
});

describe("the 60 and 14 day notices", () => {
  /**
   * A seat the notification can actually reach.
   *
   * `notify()` returns without writing anything when there is no
   * `NotificationPreference` or no recipient — so a business with neither is
   * swept every night and records nothing, which is correct (there is nobody to
   * tell) and useless as a test of the guard. The guard *is* the delivery log.
   */
  async function reachableOwner(businessId: string) {
    const user = await prisma.user.create({
      data: {
        id: crypto.randomUUID(),
        businessId,
        roles: ["seller_owner"],
        fullName: "Fixture Owner",
      },
      select: { id: true },
    });
    /*
       And the event has to be in the matrix. `route()` returns no decisions for
       an event a seller has not routed anywhere, and no decisions means no
       delivery row — an event absent from the matrix sends nothing at all,
       which is board 7e's design and is also how a job can look wired and not
       be. The seed routes `document_expiring` to email and in-app; this is the
       same two.
    */
    await prisma.notificationPreference.create({
      data: { businessId, routing: { document_expiring: ["email", "in_app"] } },
    });
    return user;
  }

  it("sends one per stage and not one per day", async () => {
    const business = await listing(55);
    await reachableOwner(business.id);

    await sweepExpiringLicences(new Date());

    const afterFirst = await prisma.notificationDelivery.count({
      where: { businessId: business.id, event: "document_expiring" },
    });
    expect(afterFirst).toBeGreaterThan(0);

    // The same day again, and again well inside the same stage. A daily sweep
    // over a sixty-day window would otherwise send sixty emails.
    await sweepExpiringLicences(new Date());
    await sweepExpiringLicences(new Date(Date.now() + 20 * DAY));

    const afterAll = await prisma.notificationDelivery.count({
      where: { businessId: business.id, event: "document_expiring" },
    });
    expect(afterAll).toBe(afterFirst);
  });

  it("sends again when the licence crosses into the urgent stage", async () => {
    // Nine days out is inside fourteen, so this is the urgent notice and not a
    // repeat of the sixty-day one. The two are told apart by when the delivery
    // was written relative to the expiry, which is what the log already holds.
    const business = await listing(9);
    await reachableOwner(business.id);

    await sweepExpiringLicences(new Date());
    const urgent = await prisma.notificationDelivery.count({
      where: { businessId: business.id, event: "document_expiring" },
    });
    expect(urgent).toBeGreaterThan(0);

    await sweepExpiringLicences(new Date());
    expect(
      await prisma.notificationDelivery.count({
        where: { businessId: business.id, event: "document_expiring" },
      }),
    ).toBe(urgent);
  });

  it("does not warn about a licence that has already lapsed", async () => {
    // That one belongs to sweepExpiredLicences, which drops the tier. An email
    // saying "expires in 0 days" the morning after would be news of something
    // already done.
    const business = await listing(-3, EXPIRED_LICENCE_TIER);
    await reachableOwner(business.id);

    await sweepExpiringLicences(new Date());

    expect(
      await prisma.notificationDelivery.count({
        where: { businessId: business.id, event: "document_expiring" },
      }),
    ).toBe(0);
  });
});
