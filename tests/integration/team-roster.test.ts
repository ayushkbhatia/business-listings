import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { tabWhere } from "@/lib/leads/inbox";
import { removeSeat } from "@/lib/team/invite";
import { rosterFor } from "@/lib/team/roster";
import type { Actor } from "@/lib/auth/roles";

/**
 * Board 7d — the numbers the screen states, against the rows behind them.
 *
 * §3: "if these two numbers disagree, one of the screens is lying and the seller
 * will find out." The board this was drawn from summed its own `OPEN` column to
 * 21 over an inbox showing 12, so the reconciliation is the test rather than a
 * note in the margin.
 *
 * Fixtures carry `PREFIX` and are deleted by it. The integration project runs
 * `fileParallelism: false` against one shared Postgres, and a leak is somebody
 * else's red test tomorrow.
 */

const PREFIX = "7D-ROSTER-FIXTURE";

let businessId: string;
let ownerId: string;
let buyerId: string;

const enquiries: string[] = [];
const seats: string[] = [];

function actorFor(id: string): Actor {
  return { id, roles: ["seller_owner"], businessId };
}

beforeAll(async () => {
  const business = await prisma.business.findFirstOrThrow({
    where: {
      claimStatus: "claimed",
      slug: { not: "al-marwan-industrial-supplies-llc" },
      team: { some: { roles: { has: "seller_owner" } } },
    },
    orderBy: { slug: "asc" },
    select: { id: true },
  });
  businessId = business.id;

  const owner = await prisma.user.findFirstOrThrow({
    where: { businessId, roles: { has: "seller_owner" } },
    select: { id: true },
  });
  ownerId = owner.id;

  const buyer = await prisma.user.findFirstOrThrow({
    where: { roles: { has: "buyer" } },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  buyerId = buyer.id;
});

afterEach(async () => {
  const ids = enquiries.splice(0);
  if (ids.length > 0) await prisma.enquiry.deleteMany({ where: { id: { in: ids } } });

  const people = seats.splice(0);
  if (people.length > 0) {
    await prisma.seatChannel.deleteMany({ where: { userId: { in: people } } });
    await prisma.user.deleteMany({ where: { id: { in: people } } });
  }

  await prisma.teamInvite.deleteMany({ where: { email: { contains: PREFIX.toLowerCase() } } });
  await prisma.business.update({ where: { id: businessId }, data: { routingCursorId: null } });
});

afterAll(async () => {
  await prisma.enquiry.deleteMany({ where: { requirement: { contains: PREFIX } } });
  await prisma.$disconnect();
});

async function seat(options: {
  roles?: string[];
  verified?: ("whatsapp" | "sms" | "email")[];
  name?: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  await prisma.user.create({
    data: {
      id,
      businessId,
      fullName: options.name ?? `${PREFIX} seat`,
      roles: (options.roles ?? ["seller_sales"]) as never,
    },
  });
  seats.push(id);
  for (const kind of options.verified ?? []) {
    await prisma.seatChannel.create({
      data: {
        userId: id,
        businessId,
        kind,
        address: kind === "email" ? `${id}@example.test` : "+971501112233",
        verifiedAt: new Date(),
      },
    });
  }
  return id;
}

/** An open lead by board 3j's definition: no outcome, not declined, no quote. */
async function openLead(label: string, assignedToId: string | null): Promise<string> {
  const enquiry = await prisma.enquiry.create({
    data: {
      ref: `ENQ-${PREFIX}-${label}`,
      buyerId,
      requirement: `${PREFIX} ${label} — gate valves for a riser.`,
      closesAt: new Date(Date.now() + 5 * 86_400_000),
      lines: { create: [{ description: `${PREFIX} valve`, qty: 4, sortOrder: 0 }] },
    },
    select: { id: true },
  });
  enquiries.push(enquiry.id);
  await prisma.enquiryRecipient.create({
    data: {
      enquiryId: enquiry.id,
      businessId,
      ...(assignedToId ? { assignedToId, assignedAt: new Date() } : {}),
    },
  });
  return enquiry.id;
}

describe("the open column", () => {
  it("sums with the unassigned row to board 3j's own count", async () => {
    const a = await seat({ verified: ["whatsapp"] });
    const b = await seat({ verified: ["email"] });
    await openLead("A1", a);
    await openLead("A2", a);
    await openLead("B1", b);
    await openLead("U1", null);

    const roster = await rosterFor(businessId, ownerId);
    const inbox = await prisma.enquiryRecipient.count({
      where: tabWhere(businessId, "open", { kind: "all" }),
    });

    const column = roster.seats.reduce((sum, row) => sum + row.open, 0);
    expect(column + roster.unassignedOpen).toBe(inbox);
    expect(roster.totalOpen).toBe(inbox);
    expect(roster.seats.find((row) => row.userId === a)?.open).toBe(2);
    expect(roster.seats.find((row) => row.userId === b)?.open).toBe(1);
  });

  it("does not count a lead that carries a quote, because board 3j does not", async () => {
    /*
       `Open` is "no quote sent yet" on both screens, and it is defined by the
       quote rather than by `EnquiryRecipient.state` — the reconciliation board
       3k asked for. A column here that counted the state column would disagree
       with the inbox on exactly the leads a seller is most likely to check.
    */
    const a = await seat({ verified: ["whatsapp"] });
    const quoted = await openLead("Q1", a);
    const before = await rosterFor(businessId, ownerId);

    await prisma.quote.create({
      data: {
        ref: `QT-${PREFIX}-1`,
        enquiryId: quoted,
        businessId,
        status: "sent",
        sentAt: new Date(),
        revision: 1,
      },
    });

    const after = await rosterFor(businessId, ownerId);
    expect(after.seats.find((row) => row.userId === a)?.open).toBe(
      (before.seats.find((row) => row.userId === a)?.open ?? 0) - 1,
    );
  });
});

describe("the seat cap", () => {
  it("counts a pending invitation as a seat taken", async () => {
    /*
       7d §3: the board's header read `3 of 5` over a table of four rows. If an
       invitation does not hold a seat then a seller at the cap can invite five
       more people and the cap means nothing — and `inviteSeat` already refuses
       on the same arithmetic, so a header that disagreed would promise an
       invitation the next screen refuses.
    */
    const before = await rosterFor(businessId, ownerId);
    await prisma.teamInvite.create({
      data: {
        businessId,
        email: `${PREFIX.toLowerCase()}@example.test`,
        roles: ["seller_sales"],
        token: `${PREFIX}-token-1`,
        invitedById: ownerId,
        expiresAt: new Date(Date.now() + 5 * 86_400_000),
      },
    });

    const after = await rosterFor(businessId, ownerId);
    expect(after.allowance.used).toBe(before.allowance.used + 1);
    expect(after.invites).toHaveLength(before.invites.length + 1);
  });

  it("keeps an expired invitation on the list, re-sendable rather than gone", async () => {
    // §7: "Invite expired — row stays with `Expired`, `Resend` in place of the
    // timer." A row that vanished would leave a held seat with nothing to
    // explain it.
    await prisma.teamInvite.create({
      data: {
        businessId,
        email: `${PREFIX.toLowerCase()}-old@example.test`,
        roles: ["seller_sales"],
        token: `${PREFIX}-token-2`,
        invitedById: ownerId,
        expiresAt: new Date(Date.now() - 86_400_000),
      },
    });

    const roster = await rosterFor(businessId, ownerId);
    const row = roster.invites.find((invite) => invite.contact.includes("-old@"));
    expect(row?.expired).toBe(true);
  });
});

describe("removing a seat", () => {
  it("moves every lead it was holding to the seat that was chosen", async () => {
    const leaver = await seat({ verified: ["whatsapp"], name: `${PREFIX} leaver` });
    const taker = await seat({ verified: ["whatsapp"], name: `${PREFIX} taker` });
    await openLead("R1", leaver);
    await openLead("R2", leaver);

    const result = await removeSeat(actorFor(ownerId), leaver, { reassignToId: taker });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.movedLeads).toBe(2);

    const orphans = await prisma.enquiryRecipient.count({
      where: { businessId, assignedToId: leaver },
    });
    expect(orphans).toBe(0);
    const moved = await prisma.enquiryRecipient.count({
      where: { businessId, assignedToId: taker },
    });
    expect(moved).toBe(2);
  });

  it("sends them to the unassigned queue when that is what was chosen", async () => {
    const leaver = await seat({ verified: ["whatsapp"] });
    const enquiryId = await openLead("R3", leaver);

    const result = await removeSeat(actorFor(ownerId), leaver, { reassignToId: null });
    expect(result.ok).toBe(true);

    const row = await prisma.enquiryRecipient.findUniqueOrThrow({
      where: { enquiryId_businessId: { enquiryId, businessId } },
      select: { assignedToId: true, assignedAt: true },
    });
    // Both columns, because an assignment time with no assignee is a row that
    // reads as assigned to somebody the join cannot name.
    expect(row.assignedToId).toBeNull();
    expect(row.assignedAt).toBeNull();
  });

  it("refuses a destination that cannot open an enquiry", async () => {
    /*
       §6.3's orphan, one door along. A finance seat holding twelve leads is
       twelve leads nobody can answer — board 7d §2 says Finance cannot reply at
       all — and the screen offering only lead seats is a courtesy rather than
       the fence.
    */
    const leaver = await seat({ verified: ["whatsapp"] });
    const finance = await seat({ roles: ["seller_finance"], verified: ["email"] });
    await openLead("R4", leaver);

    const result = await removeSeat(actorFor(ownerId), leaver, { reassignToId: finance });
    expect(result.ok).toBe(false);

    // And nothing moved: the refusal is before the transaction, so the seat is
    // still seated and still holding its lead.
    const still = await prisma.enquiryRecipient.count({
      where: { businessId, assignedToId: leaver },
    });
    expect(still).toBe(1);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: leaver },
      select: { businessId: true },
    });
    expect(user.businessId).toBe(businessId);
  });

  it("refuses somebody else's user id as a destination", async () => {
    const leaver = await seat({ verified: ["whatsapp"] });
    const stranger = await prisma.user.findFirstOrThrow({
      where: { businessId: { not: businessId }, roles: { has: "seller_owner" } },
      select: { id: true },
    });

    const result = await removeSeat(actorFor(ownerId), leaver, { reassignToId: stranger.id });
    expect(result.ok).toBe(false);
  });

  it("clears the round-robin cursor when it named the seat that left", async () => {
    // §8.3: "round-robin state must survive a seat being removed mid-rotation."
    // `nextAfter` restarts when the cursor names nobody; this is what stops the
    // column pointing at a person who is not on the team.
    const leaver = await seat({ verified: ["whatsapp"] });
    await prisma.business.update({
      where: { id: businessId },
      data: { routingCursorId: leaver },
    });

    await removeSeat(actorFor(ownerId), leaver, { reassignToId: null });

    const business = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { routingCursorId: true },
    });
    expect(business.routingCursorId).toBeNull();
  });

  it("takes the seat's channels with it", async () => {
    // An address for a business this person is no longer on. Left behind, it
    // keeps `reachabilityFor` answering about somebody who cannot open a lead.
    const leaver = await seat({ verified: ["whatsapp", "email"] });
    await removeSeat(actorFor(ownerId), leaver, { reassignToId: null });
    expect(await prisma.seatChannel.count({ where: { userId: leaver } })).toBe(0);
  });
});
