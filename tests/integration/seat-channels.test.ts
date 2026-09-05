import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { channelsFor, confirmVerification, removeChannel, startVerification } from "@/lib/team/channels";
import { reachabilityOf } from "@/lib/team/reachability";
import type { Actor } from "@/lib/auth/roles";
import { createHash } from "node:crypto";

/**
 * Board 7e §8.1 — proving a channel.
 *
 * Without this the amber row on board 7d is a dead end: a seat told it is not a
 * routing target, with nothing on any screen that would make it one.
 *
 * The code itself never leaves the sender, so these tests read the hash out of
 * `SeatChannelChallenge` and hash a guess to compare — which is the same thing
 * the service does, and is the only way to test a secret that is deliberately
 * not stored.
 */

const PREFIX = "7E-CHANNEL-FIXTURE";

let businessId: string;
const seats: string[] = [];

function actorFor(id: string): Actor {
  return { id, roles: ["seller_sales"], businessId };
}

beforeAll(async () => {
  const business = await prisma.business.findFirstOrThrow({
    where: { claimStatus: "claimed" },
    orderBy: { slug: "asc" },
    select: { id: true },
  });
  businessId = business.id;
});

afterEach(async () => {
  const people = seats.splice(0);
  if (people.length > 0) {
    // The challenge cascades from the channel, and the channel from the user.
    await prisma.seatChannel.deleteMany({ where: { userId: { in: people } } });
    await prisma.user.deleteMany({ where: { id: { in: people } } });
  }
  await prisma.authAttempt.deleteMany({ where: { identifier: { contains: PREFIX.toLowerCase() } } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seat(): Promise<string> {
  const id = crypto.randomUUID();
  await prisma.user.create({
    data: { id, businessId, fullName: `${PREFIX} seat`, roles: ["seller_sales"] as never },
  });
  seats.push(id);
  return id;
}

/** The address the fixtures use, unique per seat so the throttle never bites. */
function address(id: string): string {
  return `${PREFIX.toLowerCase()}-${id}@example.test`;
}

/** Brute-force the six digits against the stored hash. Six digits, one hash. */
async function codeFor(userId: string, kind: "whatsapp" | "email"): Promise<string> {
  const channel = await prisma.seatChannel.findUniqueOrThrow({
    where: { userId_kind: { userId, kind } },
    select: { challenge: { select: { codeHash: true } } },
  });
  const target = channel.challenge?.codeHash;
  if (!target) throw new Error("no challenge");
  for (let n = 0; n < 1_000_000; n += 1) {
    const candidate = String(n).padStart(6, "0");
    if (createHash("sha256").update(candidate).digest("hex") === target) return candidate;
  }
  throw new Error("no code matched, which means the hash is not of six digits");
}

describe("proving a channel", () => {
  it("stores it unverified, and it receives nothing until the code is right", async () => {
    const id = await seat();
    const actor = actorFor(id);

    const started = await startVerification(actor, { kind: "email", address: address(id) });
    expect(started.ok).toBe(true);

    const before = await reachabilityOf(businessId, id);
    expect(before?.reachable).toBe(false);
    expect(before?.unverified).toEqual(["email"]);

    // A wrong code is refused and burns an attempt against this one code.
    const wrong = await confirmVerification(actor, { kind: "email", code: "000000" });
    expect(wrong.ok).toBe(false);

    const code = await codeFor(id, "email");
    expect((await confirmVerification(actor, { kind: "email", code })).ok).toBe(true);

    const after = await reachabilityOf(businessId, id);
    expect(after?.reachable).toBe(true);
    expect(after?.verified).toEqual(["email"]);
  });

  it("spends the challenge, so the same six digits cannot be used twice", async () => {
    const id = await seat();
    const actor = actorFor(id);
    await startVerification(actor, { kind: "email", address: address(id) });
    const code = await codeFor(id, "email");
    await confirmVerification(actor, { kind: "email", code });

    const channel = await prisma.seatChannel.findUniqueOrThrow({
      where: { userId_kind: { userId: id, kind: "email" } },
      select: { challenge: { select: { id: true } } },
    });
    expect(channel.challenge).toBeNull();
  });

  it("un-verifies a channel whose address changed", async () => {
    /*
       Otherwise a seat could prove one number and edit the row to another,
       which is precisely the lie the whole rule exists to stop.
    */
    const id = await seat();
    const actor = actorFor(id);
    await startVerification(actor, { kind: "email", address: address(id) });
    await confirmVerification(actor, { kind: "email", code: await codeFor(id, "email") });
    expect((await reachabilityOf(businessId, id))?.reachable).toBe(true);

    await startVerification(actor, { kind: "email", address: `moved-${address(id)}` });

    const row = await prisma.seatChannel.findUniqueOrThrow({
      where: { userId_kind: { userId: id, kind: "email" } },
      select: { address: true, verifiedAt: true },
    });
    expect(row.address).toBe(`moved-${address(id)}`);
    expect(row.verifiedAt).toBeNull();
    expect((await reachabilityOf(businessId, id))?.reachable).toBe(false);
  });

  it("replaces the outstanding code rather than stacking a second", async () => {
    // Two valid codes is a window that stays open as long as somebody keeps
    // pressing the button. The same rule `inviteSeat` applies to its token.
    const id = await seat();
    const actor = actorFor(id);
    await startVerification(actor, { kind: "email", address: address(id) });
    const first = await codeFor(id, "email");

    await prisma.authAttempt.deleteMany({ where: { identifier: address(id) } });
    await startVerification(actor, { kind: "email", address: address(id) });
    const second = await codeFor(id, "email");

    expect(second).not.toBe(first);
    expect((await confirmVerification(actor, { kind: "email", code: first })).ok).toBe(false);
    expect((await confirmVerification(actor, { kind: "email", code: second })).ok).toBe(true);
  });

  it("refuses an address that is not the kind it claims to be", async () => {
    const id = await seat();
    const result = await startVerification(actorFor(id), {
      kind: "whatsapp",
      address: "somebody@example.test",
    });
    expect(result.ok).toBe(false);
  });

  it("refuses a kind nothing can carry", async () => {
    // SMS has no carrier — the Bird key has no `sms` scope — so a seat cannot
    // prove one. §10.3 keeps the matrix column and this refuses the proof.
    const id = await seat();
    const result = await startVerification(actorFor(id), {
      kind: "sms",
      address: "+971501112233",
    });
    expect(result.ok).toBe(false);
  });
});

describe("removing one", () => {
  it("takes it off the seat and out of the reachability answer", async () => {
    const id = await seat();
    const actor = actorFor(id);
    await startVerification(actor, { kind: "email", address: address(id) });
    await confirmVerification(actor, { kind: "email", code: await codeFor(id, "email") });

    expect((await removeChannel(actor, "email")).ok).toBe(true);
    expect(await channelsFor(actor)).toEqual([]);
    expect((await reachabilityOf(businessId, id))?.reachable).toBe(false);
  });
});
