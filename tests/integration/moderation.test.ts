import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { approveChange, rejectChange, submissionFor } from "@/lib/moderation/service";
import { requestModeratedChange } from "@/lib/listing/service";
import { PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";

/**
 * Draining the queue handoff 3 fills.
 *
 * The half worth testing hardest is that **approving applies the change**. A
 * queue row is a request, not a record of something that already happened, and
 * an approval that sets `status = approved` and stops leaves a seller reading
 * that their new trade name was approved on a listing that still shows the old
 * one. That failure looks exactly like success from the console.
 */

/**
 * The slug is the slugified trade name, so the two move together — see
 * `listingWithOwner`. Change one and the cleanup below stops matching.
 */
const TRADE_NAME = "Queue Test Trading LLC";
const SLUG_PREFIX = "queue-test-trading-llc-";
const ENQUIRY_PREFIX = "ENQ-M-";
const OWNER_NAME = "Queue Owner";
const BUYER_NAME = "Waiting Buyer";

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });

let opsLeadId: string;
let moderatorId: string;
let fieldOfficerId: string;
let seq = 0;

/**
 * Every row this suite writes.
 *
 * The listings are published, so a leaked one shows on the home page and in
 * `/dev/seat`. CI never saw the accumulation because each job gets its own
 * `supabase start`; a local database is shared with every sibling worktree and
 * keeps what it is given.
 *
 * The slug prefix alone is not enough to find them. Half this file's point is
 * that approving a trade-name change **renames the listing**, so a fixture that
 * ends the run as `moved-address-trading-llc-…` or `renamed-supplies-llc-…` no
 * longer matches what it was created as. The owner seat is the stable handle:
 * `Queue Owner` carries `businessId` and no rename touches it.
 *
 * `ListingChangeRequest.actor` is `Restrict` on `User`, so the owner cannot go
 * before the requests they filed. The business takes those with it — they
 * cascade — which is why the owner is deleted afterwards and not before.
 */
async function removeFixtures() {
  const [bySlug, byOwner] = await Promise.all([
    prisma.business.findMany({
      where: { slug: { startsWith: SLUG_PREFIX } },
      select: { id: true, slug: true },
    }),
    prisma.user.findMany({
      where: { fullName: OWNER_NAME, businessId: { not: null } },
      select: { businessId: true },
    }),
  ]);
  const ids = [
    ...new Set([
      ...bySlug.map((row) => row.id),
      ...byOwner.flatMap((row) => (row.businessId ? [row.businessId] : [])),
    ]),
  ];

  if (ids.length > 0) {
    const [requests, moved] = await Promise.all([
      prisma.listingChangeRequest.findMany({
        where: { businessId: { in: ids } },
        select: { id: true },
      }),
      // A rename leaves a 301 behind, and `Redirect.business` is `SetNull` —
      // it survives the cascade as a redirect to nothing unless it is named.
      prisma.redirect.findMany({ where: { businessId: { in: ids } }, select: { id: true } }),
    ]);

    // `AuditEvent.subject` is a string, not a foreign key — nothing cascades it.
    await prisma.auditEvent.deleteMany({
      where: { subject: { in: requests.map((row) => `ListingChangeRequest:${row.id}`) } },
    });
    await prisma.redirect.deleteMany({ where: { id: { in: moved.map((row) => row.id) } } });
    await prisma.business.deleteMany({ where: { id: { in: ids } } });
  }

  await prisma.redirect.deleteMany({ where: { fromPath: { startsWith: `/b/${SLUG_PREFIX}` } } });
  await prisma.enquiry.deleteMany({ where: { ref: { startsWith: ENQUIRY_PREFIX } } });
  await prisma.user.deleteMany({ where: { fullName: { in: [OWNER_NAME, BUYER_NAME] } } });
}

beforeAll(async () => {
  const staff = await prisma.user.findMany({
    where: { roles: { hasSome: ["staff_ops_lead", "staff_moderator", "staff_field"] } },
    select: { id: true, roles: true },
  });
  const byRole = (role: Role) => staff.find((u) => u.roles.includes(role))!.id;
  opsLeadId = byRole("staff_ops_lead");
  moderatorId = byRole("staff_moderator");
  fieldOfficerId = byRole("staff_field");

  await removeFixtures();
});

afterAll(async () => {
  await removeFixtures();
});

/** A published listing with an owner who can ask for a change. */
async function listingWithOwner() {
  seq += 1;
  const stamp = `${Date.now()}${String(seq).padStart(2, "0")}`;
  const categoryId = (
    await prisma.category.findFirstOrThrow({ where: { parentId: null }, select: { id: true } })
  ).id;
  const areaId = (await prisma.area.findFirstOrThrow({ select: { id: true } })).id;

  /*
   * The slug is the slugified trade name, as it is in production. A fixture
   * whose slug is unrelated to its name cannot collide with anything, which
   * quietly turned the slug-collision test into a test of nothing.
   */
  const tradeName = `${TRADE_NAME} ${stamp}`;
  const business = await prisma.business.create({
    data: {
      tradeName,
      displayName: `Queue Test Trading ${stamp}`,
      slug: tradeName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, ""),
      licenceNumber: `DED-${stamp.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 200 * 86_400_000),
      primaryCategoryId: categoryId,
      claimStatus: "claimed",
      publishedAt: new Date(),
      locations: {
        create: {
          type: "head_office",
          emirate: "dubai",
          areaId,
          addressLine: "Unit 3, Street 11",
          published: true,
        },
      },
    },
    select: { id: true, slug: true, tradeName: true, licenceNumber: true },
  });

  const owner = await prisma.user.create({
    data: {
      id: crypto.randomUUID(),
      phone: `+9715${stamp.slice(-9)}`,
      fullName: OWNER_NAME,
      roles: ["seller_owner"],
      businessId: business.id,
    },
    select: { id: true },
  });

  /*
   * With the businessId. `requestModeratedChange` refuses an actor whose
   * `businessId` does not match the listing, and an actor built without one
   * fails that check silently — which is how the first version of this file
   * had eight tests passing while testing nothing at all.
   */
  return {
    business,
    ownerActor: { ...actor(owner.id, "seller_owner"), businessId: business.id } satisfies Actor,
  };
}

/**
 * Fails loudly when a fixture could not be built.
 *
 * `if (!asked.ok) return` is the tempting shape and it is a trap: a setup that
 * quietly stops turns the test green without running a single assertion.
 */
function requested(result: { ok: true; id: string } | { ok: false; error: string }): string {
  if (!result.ok) throw new Error(`could not request the change: ${result.error}`);
  return result.id;
}

const REASON = "Checked the trade name against the DED licence. The amendment certificate matches.";

describe("approving applies the change", () => {
  it("writes the new trade name onto the listing, not just onto the request", async () => {
    const { business, ownerActor } = await listingWithOwner();
    /*
     * Unique per run. A fixed name works once and then collides with the
     * listing the previous run renamed — this suite runs against a database it
     * does not reset, and a slug is unique forever.
     */
    const newName = `Renamed Supplies LLC ${business.slug.slice(-6)}`;
    const askedId = requested(await requestModeratedChange(
      ownerActor,
      business.id,
      "trade_name",
      newName,
    ));

    const result = await approveChange({
      actor: actor(moderatorId, "staff_moderator"),
      requestId: askedId,
      reason: REASON,
    });
    expect(result).toMatchObject({ ok: true, applied: true });

    const after = await prisma.business.findUniqueOrThrow({
      where: { id: business.id },
      select: { tradeName: true, slug: true },
    });
    expect(after.tradeName).toBe(newName);
    expect(after.slug).toBe(
      newName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
    );
  });

  it("leaves a 301 behind, because slugs are immutable once published", async () => {
    const { business, ownerActor } = await listingWithOwner();
    const askedId = requested(await requestModeratedChange(
      ownerActor,
      business.id,
      "trade_name",
      `Moved Address Trading LLC ${business.slug.slice(-4)}`,
    ));

    await approveChange({
      actor: actor(opsLeadId, "staff_ops_lead"),
      requestId: askedId,
      reason: REASON,
    });

    const redirect = await prisma.redirect.findUnique({
      where: { fromPath: `/b/${business.slug}` },
      select: { toPath: true, statusCode: true, businessId: true },
    });
    expect(redirect).not.toBeNull();
    expect(redirect!.statusCode).toBe(301);
    expect(redirect!.businessId).toBe(business.id);

    const after = await prisma.business.findUniqueOrThrow({
      where: { id: business.id },
      select: { slug: true },
    });
    expect(redirect!.toPath).toBe(`/b/${after.slug}`);
  });

  it("refuses a rename onto an address another listing already holds", async () => {
    const { business: first } = await listingWithOwner();
    const { business: second, ownerActor } = await listingWithOwner();

    const askedId = requested(await requestModeratedChange(
      ownerActor,
      second.id,
      "trade_name",
      first.tradeName,
    ));

    const result = await approveChange({
      actor: actor(opsLeadId, "staff_ops_lead"),
      requestId: askedId,
      reason: REASON,
    });
    expect(result).toMatchObject({ ok: false, error: "slug_taken" });

    // And the listing did not move.
    const after = await prisma.business.findUniqueOrThrow({
      where: { id: second.id },
      select: { slug: true },
    });
    expect(after.slug).toBe(second.slug);
  });

  it("refuses a stale request rather than overwriting a change nobody reviewed", async () => {
    const { business, ownerActor } = await listingWithOwner();
    const askedId = requested(await requestModeratedChange(
      ownerActor,
      business.id,
      "licence",
      "DED-999001",
    ));

    // Somebody changed the licence by another path while this sat in the queue.
    await prisma.business.update({
      where: { id: business.id },
      data: { licenceNumber: "DED-888002" },
    });

    const result = await approveChange({
      actor: actor(moderatorId, "staff_moderator"),
      requestId: askedId,
      reason: REASON,
    });
    expect(result).toMatchObject({ ok: false, error: "stale" });

    const after = await prisma.business.findUniqueOrThrow({
      where: { id: business.id },
      select: { licenceNumber: true },
    });
    expect(after.licenceNumber).toBe("DED-888002");
  });
});

describe("rejecting changes nothing but the request", () => {
  it("leaves the listing alone and gives the seller the reason", async () => {
    const { business, ownerActor } = await listingWithOwner();
    const askedId = requested(await requestModeratedChange(
      ownerActor,
      business.id,
      "licence",
      "DED-700111",
    ));

    const reason =
      "That number belongs to a different licence holder on the register. Send the renewed licence and it goes through the same day.";
    const result = await rejectChange({
      actor: actor(moderatorId, "staff_moderator"),
      requestId: askedId,
      reason,
    });
    expect(result).toMatchObject({ ok: true, applied: false });

    const after = await prisma.business.findUniqueOrThrow({
      where: { id: business.id },
      select: { licenceNumber: true },
    });
    expect(after.licenceNumber).toBe(business.licenceNumber);

    const request = await prisma.listingChangeRequest.findUniqueOrThrow({
      where: { id: askedId },
      select: { status: true, decisionReason: true, decidedById: true },
    });
    expect(request.status).toBe("rejected");
    expect(request.decisionReason).toBe(reason);
    expect(request.decidedById).toBe(moderatorId);
  });

  it("refuses a second decision on the same request", async () => {
    const { business, ownerActor } = await listingWithOwner();
    const askedId = requested(await requestModeratedChange(ownerActor, business.id, "licence", "DED-700222"));

    await rejectChange({
      actor: actor(moderatorId, "staff_moderator"),
      requestId: askedId,
      reason: REASON,
    });
    const again = await approveChange({
      actor: actor(moderatorId, "staff_moderator"),
      requestId: askedId,
      reason: REASON,
    });
    expect(again).toMatchObject({ ok: false, error: "already_decided" });
  });
});

describe("who may decide", () => {
  it("refuses a field verifier — queue.decide is moderator or ops lead", async () => {
    const { business, ownerActor } = await listingWithOwner();
    const askedId = requested(await requestModeratedChange(ownerActor, business.id, "licence", "DED-700333"));

    await expect(
      approveChange({
        actor: actor(fieldOfficerId, "staff_field"),
        requestId: askedId,
        reason: REASON,
      }),
    ).rejects.toBeInstanceOf(PermissionError);

    const request = await prisma.listingChangeRequest.findUniqueOrThrow({
      where: { id: askedId },
      select: { status: true },
    });
    expect(request.status).toBe("pending");
  });

  it("writes one queue_decided audit row per decision, carrying the reason", async () => {
    const { business, ownerActor } = await listingWithOwner();
    const askedId = requested(await requestModeratedChange(ownerActor, business.id, "licence", "DED-700444"));

    await approveChange({
      actor: actor(moderatorId, "staff_moderator"),
      requestId: askedId,
      reason: REASON,
    });

    const rows = await prisma.auditEvent.findMany({
      where: { action: "queue_decided", subject: `ListingChangeRequest:${askedId}` },
      select: { reason: true, actorId: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason).toBe(REASON);
    expect(rows[0]!.actorId).toBe(moderatorId);
  });
});

describe("what the review screen puts in front of the decision", () => {
  it("counts the buyers waiting on the listing", async () => {
    const { business, ownerActor } = await listingWithOwner();
    const askedId = requested(await requestModeratedChange(ownerActor, business.id, "licence", "DED-700555"));

    const buyer = await prisma.user.create({
      data: { id: crypto.randomUUID(), fullName: BUYER_NAME, roles: ["buyer"] },
      select: { id: true },
    });
    const enquiry = await prisma.enquiry.create({
      data: {
        ref: `${ENQUIRY_PREFIX}${Date.now()}${seq}`,
        buyerId: buyer.id,
        requirement: "Butterfly valves, DN80.",
        closesAt: new Date(Date.now() + 7 * 86_400_000),
      },
      select: { id: true },
    });
    await prisma.enquiryRecipient.create({
      data: { enquiryId: enquiry.id, businessId: business.id, state: "delivered" },
    });

    const submission = await submissionFor(askedId);
    expect(submission?.buyersWaiting).toBe(1);
    // Never negative, whatever the seed's clock says.
    expect(submission?.ageDays).toBeGreaterThanOrEqual(0);
  });
});
