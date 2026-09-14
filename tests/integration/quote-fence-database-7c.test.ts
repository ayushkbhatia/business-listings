import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import type { Actor } from "@/lib/auth/roles";
import { acceptQuote } from "@/lib/enquiry/service";
import { extendQuote } from "@/lib/quotes/extend";
import { whileHoldingEnquiryLock } from "./hold-enquiry-lock";

/**
 * Board `7c` — nothing is sent on an enquiry once a quote on it is accepted,
 * held by the database (`quote_not_sent_after_acceptance`).
 *
 * The application's fence is proven in `accepted-record-7c.test.ts` and
 * `send-quote.test.ts`. This file writes around it on purpose, with raw Prisma
 * calls no service makes, because the trigger exists for exactly the writer
 * that skips the fence. It also proves the other half: acceptance, read
 * receipts and the winner's superseded revisions keep working.
 */

const PREFIX = "7C-DB-FENCE-FIXTURE";
const DAY = 86_400_000;
const REFUSED = /has an accepted quote; nothing more is sent on it/;

let buyerId: string;
let winnerId: string;
let otherId: string;
let owner: Actor;
const created: string[] = [];

beforeAll(async () => {
  const winner = await prisma.business.findFirstOrThrow({
    where: { slug: "al-marwan-industrial-supplies-llc" },
    select: { id: true },
  });
  winnerId = winner.id;
  const seat = await prisma.user.findFirstOrThrow({
    where: { businessId: winnerId, roles: { has: "seller_owner" } },
    orderBy: { id: "asc" },
    select: { id: true, roles: true },
  });
  owner = { id: seat.id, roles: seat.roles, businessId: winnerId };

  otherId = (
    await prisma.business.findFirstOrThrow({
      where: { id: { not: winnerId }, claimStatus: "claimed", publishedAt: { not: null }, suspendedAt: null },
      orderBy: [{ slug: "asc" }, { id: "asc" }],
      select: { id: true },
    })
  ).id;
  buyerId = (
    await prisma.user.findFirstOrThrow({
      where: { roles: { has: "buyer" } },
      orderBy: { id: "asc" },
      select: { id: true },
    })
  ).id;
});

afterEach(async () => {
  const ids = created.splice(0);
  if (ids.length > 0) await prisma.enquiry.deleteMany({ where: { id: { in: ids } } });
});

afterAll(async () => {
  await prisma.enquiry.deleteMany({ where: { requirement: { contains: PREFIX } } });
  await prisma.$disconnect();
});

let seq = 0;
async function enquiry() {
  seq += 1;
  const row = await prisma.enquiry.create({
    data: {
      ref: `ENQ-${PREFIX}-${Date.now().toString(36)}-${seq}`,
      buyerId,
      requirement: `${PREFIX} gate valves ${seq}`,
      closesAt: new Date(Date.now() + 5 * DAY),
      recipients: {
        create: [
          { businessId: winnerId, state: "quoted", firstReplyAt: new Date() },
          { businessId: otherId, state: "quoted", firstReplyAt: new Date() },
        ],
      },
    },
    select: { id: true, ref: true },
  });
  created.push(row.id);
  return row;
}

async function quote(
  enquiryId: string,
  businessId: string,
  over: { status?: "draft" | "sent" | "read" | "lost"; revision?: number } = {},
) {
  seq += 1;
  const status = over.status ?? "sent";
  return prisma.quote.create({
    data: {
      ref: `QT-${PREFIX}-${Date.now().toString(36)}-${seq}`,
      enquiryId,
      businessId,
      revision: over.revision ?? 1,
      status,
      ...(status === "draft"
        ? {}
        : { sentAt: new Date(Date.now() - DAY), expiresAt: new Date(Date.now() + 10 * DAY) }),
    },
    select: { id: true },
  });
}

async function release(enquiryId: string, businessId: string) {
  await prisma.enquiry.update({
    where: { id: enquiryId },
    data: { contactReleasedToBusinessId: businessId, contactReleasedAt: new Date() },
  });
}

describe("before acceptance, nothing is refused", () => {
  it("sends, promotes and extends as it always has", async () => {
    const e = await enquiry();
    const sent = await quote(e.id, winnerId);
    const draft = await quote(e.id, otherId, { status: "draft" });
    await expect(
      prisma.quote.update({ where: { id: draft.id }, data: { status: "sent", sentAt: new Date() } }),
    ).resolves.toBeTruthy();
    await expect(
      prisma.quote.update({ where: { id: sent.id }, data: { expiresAt: new Date(Date.now() + 20 * DAY) } }),
    ).resolves.toBeTruthy();
  });
});

describe("after acceptance, nothing more is sent", () => {
  it("refuses a new sent quote, but not a draft or a lost one", async () => {
    const e = await enquiry();
    await quote(e.id, winnerId);
    await release(e.id, winnerId);

    await expect(quote(e.id, otherId)).rejects.toThrow(REFUSED);
    await expect(quote(e.id, otherId, { status: "read" })).rejects.toThrow(REFUSED);
    await expect(quote(e.id, otherId, { status: "draft" })).resolves.toBeTruthy();
    await expect(quote(e.id, otherId, { status: "lost", revision: 2 })).resolves.toBeTruthy();
  });

  it("refuses a draft promoted and a lost quote revived", async () => {
    const e = await enquiry();
    await quote(e.id, winnerId);
    const draft = await quote(e.id, otherId, { status: "draft" });
    const lost = await quote(e.id, otherId, { status: "lost", revision: 2 });
    await release(e.id, winnerId);

    await expect(
      prisma.quote.update({ where: { id: draft.id }, data: { status: "sent", sentAt: new Date() } }),
    ).rejects.toThrow(REFUSED);
    await expect(prisma.quote.update({ where: { id: lost.id }, data: { status: "sent" } })).rejects.toThrow(REFUSED);
  });

  it("refuses a live quote re-sent, revised or extended, and lets it be read or shortened", async () => {
    const e = await enquiry();
    const live = await quote(e.id, winnerId);
    await release(e.id, winnerId);

    await expect(prisma.quote.update({ where: { id: live.id }, data: { sentAt: new Date() } })).rejects.toThrow(
      REFUSED,
    );
    await expect(prisma.quote.update({ where: { id: live.id }, data: { revision: 5 } })).rejects.toThrow(REFUSED);
    await expect(
      prisma.quote.update({ where: { id: live.id }, data: { expiresAt: new Date(Date.now() + 30 * DAY) } }),
    ).rejects.toThrow(REFUSED);

    // A read receipt is not a send.
    await expect(
      prisma.quote.update({ where: { id: live.id }, data: { status: "read", readAt: new Date() } }),
    ).resolves.toMatchObject({ status: "read" });
    // Nor is pulling a window in.
    await expect(
      prisma.quote.update({ where: { id: live.id }, data: { expiresAt: new Date(Date.now() + DAY) } }),
    ).resolves.toBeTruthy();
  });
});

describe("the application's paths still work around it", () => {
  it("accepts one quote and marks the other lost", async () => {
    const e = await enquiry();
    const mine = await quote(e.id, winnerId);
    const theirs = await quote(e.id, otherId);

    expect(await acceptQuote(buyerId, mine.id)).toMatchObject({ ok: true });
    const statuses = await prisma.quote.findMany({
      where: { id: { in: [mine.id, theirs.id] } },
      select: { id: true, status: true },
    });
    expect(Object.fromEntries(statuses.map((q) => [q.id, q.status]))).toEqual({
      [mine.id]: "accepted",
      [theirs.id]: "lost",
    });
  });

  it("answers `decided` when the winner's superseded revision is extended after acceptance", async () => {
    const e = await enquiry();
    // Revision 1 stays `sent` once revision 2 is accepted, as `acceptQuote` leaves it.
    const r1 = await quote(e.id, winnerId, { revision: 1 });
    const r2 = await quote(e.id, winnerId, { revision: 2 });
    expect(await acceptQuote(buyerId, r2.id)).toMatchObject({ ok: true });
    const after = await prisma.quote.findUniqueOrThrow({ where: { id: r1.id }, select: { status: true } });
    expect(after.status).toBe("sent");

    const result = await extendQuote(owner, winnerId, { quoteId: r1.id, until: new Date(Date.now() + 20 * DAY) });
    expect(result).toEqual({ ok: false, error: "decided" });
  });

  it("waits on an acceptance that lands mid-extend, and answers `decided` rather than failing", async () => {
    /*
       The extend reads the enquiry as open, then an accept commits before it
       writes. Before this board the check and the update sat outside any lock:
       the write went through, or — with the trigger — failed as a raw error.
       Now the extend re-reads under the lock and says what happened.
    */
    const e = await enquiry();
    const r1 = await quote(e.id, winnerId, { revision: 1 });
    const r2 = await quote(e.id, winnerId, { revision: 2 });

    const result = await whileHoldingEnquiryLock(
      e.id,
      () => extendQuote(owner, winnerId, { quoteId: r1.id, until: new Date(Date.now() + 20 * DAY) }),
      async (tx) => {
        await tx.enquiry.update({
          where: { id: e.id },
          data: { contactReleasedToBusinessId: winnerId, contactReleasedAt: new Date() },
        });
        await tx.quote.update({ where: { id: r2.id }, data: { status: "accepted", acceptedAt: new Date() } });
      },
    );

    expect(result).toEqual({ ok: false, error: "decided" });
    const r1After = await prisma.quote.findUniqueOrThrow({ where: { id: r1.id }, select: { extensionCount: true } });
    expect(r1After.extensionCount).toBe(0);
  });
});
