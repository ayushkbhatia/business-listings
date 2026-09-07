import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { Prisma } from "@/lib/db/generated/client";
import {
  INSTANT,
  MODERATED,
  isModerated,
  pendingChanges,
  requestModeratedChange,
  saveHours,
  saveProfile,
  withdrawChange,
} from "@/lib/listing/service";
import type { Actor } from "@/lib/auth/roles";

/**
 * Handoff 3 criterion 8, against a real database.
 *
 *   "Only trade name, category and licence changes enter the moderation queue;
 *    photographs, hours, products and description publish immediately."
 *
 * Both halves are load-bearing and they fail in opposite directions. A change
 * that should queue and does not is a listing saying something nobody checked.
 * A change that should publish and queues instead is a dashboard where nothing
 * a seller does appears — which, at 41,000 listings, is the one that kills the
 * product.
 */

const SLUG = "al-marwan-industrial-supplies-llc";

let actor: Actor;
let businessId: string;
let originalDisplayName: string;
let originalDescription: string | null;
/** Hours are seeded data these tests overwrite, so they are put back. */
let originalHours: { id: string; hours: unknown; ramadanHours: unknown }[] = [];

beforeAll(async () => {
  const business = await prisma.business.findUniqueOrThrow({
    where: { slug: SLUG },
    select: {
      id: true,
      displayName: true,
      description: true,
      team: { where: { roles: { has: "seller_owner" } }, select: { id: true, roles: true }, take: 1 },
    },
  });
  businessId = business.id;
  originalDisplayName = business.displayName;
  originalDescription = business.description;
  const owner = business.team[0]!;
  actor = { id: owner.id, roles: owner.roles, businessId: business.id };

  originalHours = await prisma.location.findMany({
    where: { businessId },
    select: { id: true, hours: true, ramadanHours: true },
  });
});

beforeEach(async () => {
  await prisma.listingChangeRequest.deleteMany({ where: { businessId } });
});

afterAll(async () => {
  await prisma.listingChangeRequest.deleteMany({ where: { businessId } });
  await prisma.business.update({
    where: { id: businessId },
    data: { displayName: originalDisplayName, description: originalDescription },
  });

  /*
   * Put the hours back.
   *
   * `saveHours` with `locationId: "all"` is a real feature and these tests
   * exercise it, which means they overwrite every branch of a seeded business.
   * Left alone, the next person to open /dashboard/hours sees six branches
   * closed every day but Sunday and spends an hour looking for the bug.
   */
  for (const location of originalHours) {
    await prisma.location.update({
      where: { id: location.id },
      data: {
        hours: location.hours as object,
        ramadanHours: (location.ramadanHours ?? Prisma.DbNull) as object,
      },
    });
  }

  await prisma.$disconnect();
});

describe("criterion 8 — the split is three fields and no more", () => {
  it("moderates exactly the fields that set the badge or the ranking", () => {
    /*
       Four since board 3b, and the fourth was a product decision rather than a
       drift: `additional_category` queues because category membership is the
       join the enquiry fan-out matches on and the facet buyers filter by, so
       adding one changes which demand a listing receives. It is also the only
       self-serve route a seller has into a market their licence may not cover.

       The list stays asserted in full rather than by length, because the way it
       would go wrong is a fifth field added quietly — and moderating more
       always feels safer in the moment.
    */
    expect([...MODERATED]).toEqual([
      "trade_name",
      "primary_category",
      "licence",
      "additional_category",
    ]);
  });

  it("does not moderate anything a seller is the authority on", () => {
    for (const field of INSTANT) {
      expect(isModerated(field), field).toBe(false);
    }
    expect(INSTANT).toContain("hours");
    expect(INSTANT).toContain("media");
    expect(INSTANT).toContain("products");
    expect(INSTANT).toContain("description");
  });
});

describe("criterion 8 — the instant half publishes on save", () => {
  it("changes the display name with nothing queued", async () => {
    const result = await saveProfile(actor, businessId, { displayName: "Al Marwan Supplies" });
    expect(result).toEqual({ ok: true });

    const after = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { displayName: true },
    });
    expect(after.displayName).toBe("Al Marwan Supplies");
    // The whole point: nothing to wait for.
    expect(await prisma.listingChangeRequest.count({ where: { businessId } })).toBe(0);
  });

  it("changes the description with nothing queued", async () => {
    await saveProfile(actor, businessId, { description: "Stockist of valves and fittings." });
    const after = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { description: true },
    });
    expect(after.description).toBe("Stockist of valves and fittings.");
    expect(await prisma.listingChangeRequest.count({ where: { businessId } })).toBe(0);
  });

  it("changes hours with nothing queued", async () => {
    const location = await prisma.location.findFirstOrThrow({
      where: { businessId },
      select: { id: true },
    });
    const result = await saveHours(actor, businessId, {
      locationId: location.id,
      hours: { sun: [{ open: "08:00", close: "13:00" }, { open: "16:00", close: "20:00" }] },
    });
    expect(result).toEqual({ ok: true, applied: 1 });
    expect(await prisma.listingChangeRequest.count({ where: { businessId } })).toBe(0);
  });

  it("copies hours to every branch in one save", async () => {
    // Most suppliers keep the same hours everywhere, and retyping a split shift
    // six times is how five of the six end up wrong.
    const branches = await prisma.location.count({ where: { businessId } });
    const result = await saveHours(actor, businessId, {
      locationId: "all",
      hours: { sun: [{ open: "09:00", close: "18:00" }] },
    });
    expect(result).toEqual({ ok: true, applied: branches });
  });

  it("refuses hours that close before they open, and says what to do", async () => {
    const location = await prisma.location.findFirstOrThrow({
      where: { businessId },
      select: { id: true },
    });
    const result = await saveHours(actor, businessId, {
      locationId: location.id,
      hours: { sun: [{ open: "16:00", close: "08:00" }] },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("enter two shifts");
  });

  it("clears a Ramadan block without clearing the ordinary week", async () => {
    const location = await prisma.location.findFirstOrThrow({
      where: { businessId },
      select: { id: true },
    });
    await saveHours(actor, businessId, {
      locationId: location.id,
      hours: { sun: [{ open: "08:00", close: "17:00" }] },
      ramadanHours: { all: [{ open: "09:00", close: "15:00" }] },
    });
    await saveHours(actor, businessId, {
      locationId: location.id,
      hours: { sun: [{ open: "08:00", close: "17:00" }] },
      ramadanHours: null,
    });

    const after = await prisma.location.findUniqueOrThrow({
      where: { id: location.id },
      select: { hours: true, ramadanHours: true },
    });
    expect(after.ramadanHours).toBeNull();
    expect((after.hours as Record<string, unknown>)["sun"]).toEqual([
      { open: "08:00", close: "17:00" },
    ]);
  });

  it("refuses a description over the limit, and says by how much", async () => {
    const result = await saveProfile(actor, businessId, { description: "x".repeat(601) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("601 characters");
    expect(result.error).toContain("600");
  });
});

describe("criterion 8 — the moderated half changes nothing until somebody decides", () => {
  it("queues a trade name change and leaves the listing saying what it said", async () => {
    const before = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { tradeName: true },
    });

    const result = await requestModeratedChange(
      actor,
      businessId,
      "trade_name",
      "Al Marwan Industrial Supplies FZE",
    );
    expect(result.ok).toBe(true);

    const after = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { tradeName: true },
    });
    // Nothing moved. That is the criterion.
    expect(after.tradeName).toBe(before.tradeName);

    const queued = await pendingChanges(businessId);
    expect(queued).toHaveLength(1);
    expect(queued[0]?.field).toBe("trade_name");
    // The queue shows the change, not only the ask.
    expect(queued[0]?.beforeValue).toBe(before.tradeName);
    expect(queued[0]?.afterValue).toBe("Al Marwan Industrial Supplies FZE");
  });

  it("queues a licence change without touching the licence", async () => {
    const before = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { licenceNumber: true },
    });
    await requestModeratedChange(actor, businessId, "licence", "DED-999123");

    const after = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { licenceNumber: true },
    });
    expect(after.licenceNumber).toBe(before.licenceNumber);
  });

  it("supersedes an earlier request rather than queueing a second", async () => {
    // A seller who submits twice has changed their mind, not asked twice.
    // Otherwise a moderator picks up a request already replaced.
    await requestModeratedChange(actor, businessId, "trade_name", "First attempt LLC");
    await requestModeratedChange(actor, businessId, "trade_name", "Second attempt LLC");

    const queued = await pendingChanges(businessId);
    expect(queued).toHaveLength(1);
    expect(queued[0]?.afterValue).toBe("Second attempt LLC");

    const withdrawn = await prisma.listingChangeRequest.count({
      where: { businessId, status: "withdrawn" },
    });
    expect(withdrawn).toBe(1);
  });

  it("refuses a change to what it already says", async () => {
    const business = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { tradeName: true },
    });
    const result = await requestModeratedChange(actor, businessId, "trade_name", business.tradeName);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("what it says now");
    expect(await pendingChanges(businessId)).toHaveLength(0);
  });

  it("lets the seller withdraw before anybody looks", async () => {
    const created = await requestModeratedChange(actor, businessId, "trade_name", "Withdraw me LLC");
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(await withdrawChange(actor, businessId, created.id)).toEqual({ ok: true });
    expect(await pendingChanges(businessId)).toHaveLength(0);
  });

  it("gives the same answer for another business's request as for one that does not exist", async () => {
    const stranger = await prisma.business.findFirstOrThrow({
      where: { id: { not: businessId } },
      select: { id: true },
    });
    const theirs = await prisma.listingChangeRequest.create({
      data: {
        businessId: stranger.id,
        actorId: actor.id,
        field: "trade_name",
        beforeValue: "Something",
        afterValue: "Something else",
      },
      select: { id: true },
    });

    const notMine = await withdrawChange(actor, businessId, theirs.id);
    const notReal = await withdrawChange(actor, businessId, "does-not-exist");
    expect(notMine).toEqual(notReal);

    await prisma.listingChangeRequest.delete({ where: { id: theirs.id } });
  });
});

describe("criterion 8 — a decision has to explain itself", () => {
  it("refuses an approval with no reason, at the database", async () => {
    // CLAUDE.md non-negotiable 3. The service layer will enforce it too, but a
    // constraint is what survives a service nobody remembered to call.
    const created = await requestModeratedChange(actor, businessId, "trade_name", "Needs a reason LLC");
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await expect(
      prisma.listingChangeRequest.update({
        where: { id: created.id },
        data: { status: "approved", decidedAt: new Date() },
      }),
    ).rejects.toThrow();
  });

  it("refuses a reason with no decision", async () => {
    // Paired both ways: half a change is not better than none.
    const created = await requestModeratedChange(actor, businessId, "trade_name", "Half a change LLC");
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await expect(
      prisma.listingChangeRequest.update({
        where: { id: created.id },
        data: { decisionReason: "Looks fine" },
      }),
    ).rejects.toThrow();
  });

  it("accepts a decision that carries both", async () => {
    const created = await requestModeratedChange(actor, businessId, "trade_name", "Approved LLC");
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const decided = await prisma.listingChangeRequest.update({
      where: { id: created.id },
      data: {
        status: "approved",
        decidedAt: new Date(),
        decisionReason: "Trade licence uploaded on 24 August shows the FZE suffix.",
      },
      select: { status: true, decisionReason: true },
    });
    expect(decided.status).toBe("approved");
    expect(decided.decisionReason).toContain("Trade licence");
  });
});
