import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { reachabilityFor, routableSeats } from "@/lib/team/reachability";
import { routeLead } from "@/lib/leads/router";
import { postMessage } from "@/lib/messaging/service";

/**
 * Boards 7d and 7e — the rule that spans them.
 *
 *   > A seat with no verified notification channel cannot be a routing target.
 *
 * Everything here is about a query or a decision no screen can be trusted to
 * make, which is why none of it is a unit test. Routing reads four things —
 * the mode, who can reply, who is reachable, whether the counter is open — and
 * a wrong answer to any of them produces the failure the whole handoff exists
 * to close: a lead assigned to somebody nobody told.
 *
 * Fixtures carry `PREFIX` and are deleted by it. The integration project runs
 * `fileParallelism: false` against one shared Postgres and a leak is somebody
 * else's red test tomorrow.
 */

const PREFIX = "7D-ROUTING-FIXTURE";

/*
   A fixed instant inside the seeded counter's week.

   Routing skips a business whose counter is shut, which is the point of 7d §4 —
   and it means a test that let `now` default would pass on a Tuesday and fail on
   a Saturday. The flagship seller's hours are `sat: []`, so the first run of
   this file on a weekend reported `outside_hours` and looked like a router bug.

   Tuesday 8 September 2026, 10:00 in Dubai: inside the 08:00–13:00 shift.
*/
const OPEN = new Date("2026-09-08T06:00:00Z");
/*
   Three in the morning, Dubai, when no branch of any seeded supplier is open.

   Not "a Saturday": al-marwan publishes six branches and two of them trade on a
   Saturday, so the first version of this asserted a closure the business does
   not have — and the router was right where the test was wrong. A night hour is
   the only instant that is shut for every branch regardless of the week.
*/
const SHUT = new Date("2026-09-07T23:00:00Z");

let businessId: string;
let ownerId: string;
let buyerId: string;

const enquiries: string[] = [];
const seats: string[] = [];

beforeAll(async () => {
  const business = await prisma.business.findFirstOrThrow({
    where: { slug: "al-marwan-industrial-supplies-llc" },
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

  await prisma.business.update({
    where: { id: businessId },
    data: { leadRouting: "everyone", routingCursorId: null },
  });
});

afterAll(async () => {
  await prisma.enquiry.deleteMany({ where: { requirement: { contains: PREFIX } } });
  await prisma.$disconnect();
});

/** A seat with whichever channels the test needs. Returns its id. */
async function seat(options: {
  roles?: string[];
  verified?: ("whatsapp" | "sms" | "email")[];
  unverified?: ("whatsapp" | "sms" | "email")[];
  branchId?: string | null;
}): Promise<string> {
  const id = crypto.randomUUID();
  await prisma.user.create({
    data: {
      id,
      businessId,
      fullName: `${PREFIX} seat`,
      roles: (options.roles ?? ["seller_sales"]) as never,
      ...(options.branchId ? { branchId: options.branchId } : {}),
    },
  });
  seats.push(id);

  for (const kind of options.verified ?? []) {
    await prisma.seatChannel.create({
      data: { userId: id, businessId, kind, address: address(kind), verifiedAt: new Date() },
    });
  }
  for (const kind of options.unverified ?? []) {
    await prisma.seatChannel.create({
      data: { userId: id, businessId, kind, address: address(kind) },
    });
  }
  return id;
}

function address(kind: string): string {
  return kind === "email" ? `${PREFIX}-${crypto.randomUUID()}@example.test` : "+971501112233";
}

async function enquiry(label: string, deliverToArea?: string): Promise<string> {
  const row = await prisma.enquiry.create({
    data: {
      ref: `ENQ-${PREFIX}-${label}`,
      buyerId,
      requirement: `${PREFIX} ${label} — gate valves for a riser.`,
      closesAt: new Date(Date.now() + 5 * 86_400_000),
      ...(deliverToArea ? { deliverToArea } : {}),
      lines: { create: [{ description: `${PREFIX} valve`, qty: 4, sortOrder: 0 }] },
    },
    select: { id: true },
  });
  enquiries.push(row.id);
  await prisma.enquiryRecipient.create({
    data: { enquiryId: row.id, businessId },
  });
  return row.id;
}

async function recipientOf(enquiryId: string) {
  return prisma.enquiryRecipient.findUniqueOrThrow({
    where: { enquiryId_businessId: { enquiryId, businessId } },
    select: { assignedToId: true, routedAt: true, unroutedReason: true },
  });
}

describe("reachability", () => {
  it("counts a seat reachable only once a channel is verified", async () => {
    const unproven = await seat({ unverified: ["whatsapp"] });
    const proven = await seat({ verified: ["whatsapp"] });

    const reach = await reachabilityFor(businessId);
    expect(reach.get(unproven)?.reachable).toBe(false);
    expect(reach.get(unproven)?.unverified).toEqual(["whatsapp"]);
    expect(reach.get(proven)?.reachable).toBe(true);
  });

  it("does not count in-app, because everything would be reachable", async () => {
    /*
       There is no in-app row to create — the enum has three members and that is
       the assertion. 7e §2 keeps in-app always on for anything with a deadline,
       so counting it as a channel would make the routing rule vacuous.
    */
    const kinds = await prisma.$queryRaw<{ enumlabel: string }[]>`
      SELECT e.enumlabel FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'seat_channel_kind'`;
    expect(kinds.map((k) => k.enumlabel).sort()).toEqual(["email", "sms", "whatsapp"]);
  });

  it("calls a seat with only email slow rather than unreachable", async () => {
    // 7d §3 renders it amber: the lead arrives, tomorrow.
    const slow = await seat({ verified: ["email"] });
    const fast = await seat({ verified: ["whatsapp", "email"] });

    const reach = await reachabilityFor(businessId);
    expect(reach.get(slow)).toMatchObject({ reachable: true, slowOnly: true });
    expect(reach.get(fast)?.slowOnly).toBe(false);
  });

  it("orders the channels the way routing will try them", async () => {
    const person = await seat({ verified: ["email", "whatsapp"] });
    const reach = await reachabilityFor(businessId);
    // Fastest first, whatever order the rows were written in.
    expect(reach.get(person)?.verified).toEqual(["whatsapp", "email"]);
  });

  it("never makes a finance seat a lead target, however reachable", async () => {
    /*
       7d §2: Finance cannot reply to an enquiry or send a quote, so routing a
       lead to one is the same dead end by a different door. Reachable and
       routable are two questions.
    */
    const finance = await seat({ roles: ["seller_finance"], verified: ["whatsapp", "email"] });
    const reach = await reachabilityFor(businessId);
    expect(reach.get(finance)?.reachable).toBe(true);
    expect(reach.get(finance)?.canTakeLeads).toBe(false);
    expect(await routableSeats(businessId)).not.toContain(finance);
  });

  it("reports an unknown seat as unreachable rather than absent", async () => {
    // Absent and unreachable are not the same thing to a caller.
    const bare = await seat({});
    const reach = await reachabilityFor(businessId);
    expect(reach.has(bare)).toBe(true);
    expect(reach.get(bare)?.reachable).toBe(false);
  });
});

describe("routing", () => {
  it("leaves a lead unassigned under everyone, and says that is why", async () => {
    await seat({ verified: ["whatsapp"] });
    const id = await enquiry("EVERYONE");
    const outcome = await routeLead({ enquiryId: id, businessId, now: OPEN });

    expect(outcome).toEqual({ routed: false, reason: "routing_off" });
    const row = await recipientOf(id);
    // Unrouted and unassigned are the same null and opposite meanings. Under
    // `everyone` nobody was meant to own it.
    expect(row.assignedToId).toBeNull();
    expect(row.unroutedReason).toBe("routing_off");
    expect(row.routedAt).not.toBeNull();
  });

  it("alternates between eligible seats under round-robin", async () => {
    const a = await seat({ verified: ["whatsapp"] });
    const b = await seat({ verified: ["whatsapp"] });
    await prisma.business.update({ where: { id: businessId }, data: { leadRouting: "round_robin" } });

    const first = await enquiry("RR-1");
    const second = await enquiry("RR-2");
    await routeLead({ enquiryId: first, businessId, now: OPEN });
    await routeLead({ enquiryId: second, businessId, now: OPEN });

    const got = [(await recipientOf(first)).assignedToId, (await recipientOf(second)).assignedToId];
    expect(new Set(got)).toEqual(new Set([a, b].sort().slice(0, 2)));
    expect(got[0]).not.toBe(got[1]);
  });

  it("survives the cursor's seat being removed mid-rotation", async () => {
    /*
       7d §8.3. An integer index into a list that just got shorter points at the
       wrong person; a cursor that names the seat degrades to "start again",
       which is the correct answer rather than an arbitrary one.
    */
    const a = await seat({ verified: ["whatsapp"] });
    const leaving = await seat({ verified: ["whatsapp"] });
    await prisma.business.update({
      where: { id: businessId },
      data: { leadRouting: "round_robin", routingCursorId: leaving },
    });

    /*
       How a seat actually leaves: `removeSeat` nulls `User.businessId` and keeps
       the row, because a quote with no author is unauditable. So the cursor
       still points at a real person who is no longer eligible — which is the
       case an integer index cannot survive and this one has to.
    */
    await prisma.user.update({ where: { id: leaving }, data: { businessId: null } });

    const id = await enquiry("RR-GONE");
    const outcome = await routeLead({ enquiryId: id, businessId, now: OPEN });
    expect(outcome).toEqual({ routed: true, userId: a });
  });

  it("skips a seat with nothing verified, and names the reason", async () => {
    await seat({ unverified: ["whatsapp", "email"] });
    await prisma.business.update({ where: { id: businessId }, data: { leadRouting: "round_robin" } });

    const id = await enquiry("UNREACHABLE");
    expect(await routeLead({ enquiryId: id, businessId, now: OPEN })).toEqual({
      routed: false,
      reason: "no_reachable_seat",
    });

    const row = await recipientOf(id);
    expect(row.assignedToId).toBeNull();
    expect(row.unroutedReason).toBe("no_reachable_seat");
  });

  it("never routes to a finance seat even when it is the only one reachable", async () => {
    await seat({ roles: ["seller_finance"], verified: ["whatsapp"] });
    await prisma.business.update({ where: { id: businessId }, data: { leadRouting: "round_robin" } });

    const id = await enquiry("FINANCE-ONLY");
    const outcome = await routeLead({ enquiryId: id, businessId, now: OPEN });
    expect(outcome).toMatchObject({ routed: false, reason: "no_reachable_seat" });
  });

  it("skips a business whose counters are all shut, and says so", async () => {
    /*
       7d §4: round-robin "skips anyone outside working hours". The reason is
       reported separately from an unreachable seat on purpose — a team that is
       simply asleep is eligible again tomorrow, and telling the seller to go and
       fix a channel would send them after something that is not broken.

       Hours come from `openNow`, the same Asia/Dubai, Ramadan-aware helper the
       storefront's "Open now" badge reads. One source, per 7d §8.4 and 7e §5.
    */
    await seat({ verified: ["whatsapp"] });
    await prisma.business.update({ where: { id: businessId }, data: { leadRouting: "round_robin" } });

    const id = await enquiry("SHUT");
    expect(await routeLead({ enquiryId: id, businessId, now: SHUT })).toEqual({
      routed: false,
      reason: "outside_hours",
    });
    expect((await recipientOf(id)).unroutedReason).toBe("outside_hours");
  });

  it("does not move a lead somebody is already working on", async () => {
    const a = await seat({ verified: ["whatsapp"] });
    await prisma.business.update({ where: { id: businessId }, data: { leadRouting: "round_robin" } });

    const id = await enquiry("ALREADY");
    await prisma.enquiryRecipient.update({
      where: { enquiryId_businessId: { enquiryId: id, businessId } },
      data: { assignedToId: ownerId, assignedAt: new Date() },
    });

    expect(await routeLead({ enquiryId: id, businessId, now: OPEN })).toBeNull();
    expect((await recipientOf(id)).assignedToId).toBe(ownerId);
    expect(a).not.toBe(ownerId);
  });

  it("cannot record an assignee and a failure at once", async () => {
    // A check constraint, not a convention: the router either placed the lead
    // or it did not, and a row claiming both is unreadable by either screen.
    const id = await enquiry("EXCLUSIVE");
    await expect(
      prisma.enquiryRecipient.update({
        where: { enquiryId_businessId: { enquiryId: id, businessId } },
        data: { assignedToId: ownerId, unroutedReason: "no_reachable_seat" },
      }),
    ).rejects.toThrow();
  });
});

describe("an automatic message is not a first reply", () => {
  it("leaves the clock running", async () => {
    /*
       Board 7e §4, and the most consequential correction in the pair. An
       auto-reply fires precisely when `firstReplyAt` is null, so without the
       guard the acknowledgement stamps the clock it exists to apologise for —
       and every seller would install one to win the reply-time band without
       answering anybody.
    */
    const id = await enquiry("AUTOREPLY");

    const sent = await postMessage({
      enquiryId: id,
      businessId,
      senderId: ownerId,
      sender: "seller",
      body: `${PREFIX} the counter is closed and reopens at 08:00.`,
      automatic: true,
    });
    expect(sent.ok).toBe(true);

    const row = await prisma.enquiryRecipient.findUniqueOrThrow({
      where: { enquiryId_businessId: { enquiryId: id, businessId } },
      select: { firstReplyAt: true },
    });
    expect(row.firstReplyAt).toBeNull();
  });

  it("still stamps it for a message a person typed", async () => {
    const id = await enquiry("HUMAN");
    await postMessage({
      enquiryId: id,
      businessId,
      senderId: ownerId,
      sender: "seller",
      body: `${PREFIX} we can do ten days on the DN150.`,
    });

    const row = await prisma.enquiryRecipient.findUniqueOrThrow({
      where: { enquiryId_businessId: { enquiryId: id, businessId } },
      select: { firstReplyAt: true },
    });
    expect(row.firstReplyAt).not.toBeNull();
  });
});
