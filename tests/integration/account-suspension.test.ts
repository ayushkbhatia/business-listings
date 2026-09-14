import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { liftAccountSuspension, suspendAccount } from "@/lib/account/suspension";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import type { Actor } from "@/lib/auth/roles";
import { purgeAuditRows } from "./audit-cleanup";

/**
 * Board 7a `B7` — suspending a person's account, against a real database.
 *
 * `User.suspendedAt` had readers on every sign-in path and no writer outside a
 * test fixture, so the sign-in screen's *contact support — the reason is in
 * your email* described a state nothing could produce and a promise nothing
 * kept. These pin the writer: ops lead only, a written reason on the audit row,
 * one row per suspension however many ops leads press at once, and no staff
 * seat suspended around board 4i's deactivation rules.
 *
 * Create-and-destroy fixtures. Suspending a seeded buyer would sign out
 * whichever acceptance seat happens to be that buyer.
 */

const PREFIX = `susp7a-${process.pid}-`;
let seq = 0;
const madeUsers: string[] = [];

let opsLead: Actor;
let moderator: Actor;

beforeAll(async () => {
  const [lead, mod] = await Promise.all([
    prisma.user.findFirstOrThrow({ where: { roles: { has: "staff_ops_lead" } }, orderBy: { id: "asc" }, select: { id: true, roles: true } }),
    prisma.user.findFirstOrThrow({ where: { roles: { has: "staff_moderator" } }, orderBy: { id: "asc" }, select: { id: true, roles: true } }),
  ]);
  opsLead = { id: lead.id, roles: lead.roles };
  moderator = { id: mod.id, roles: mod.roles };
});

afterAll(async () => {
  if (madeUsers.length) {
    // Append-only since board 4i; test cleanup is the one sanctioned deleter.
    await purgeAuditRows({ subject: { in: madeUsers.map((id) => `User:${id}`) } });
    await prisma.user.deleteMany({ where: { id: { in: madeUsers } } });
  }
  await prisma.$disconnect();
});

async function person(roles: Actor["roles"] = ["buyer"]) {
  const id = crypto.randomUUID();
  madeUsers.push(id);
  await prisma.user.create({
    data: { id, email: `${PREFIX}${seq++}@example.test`, fullName: "Rajesh Nair", roles: [...roles] },
  });
  return id;
}

const REASON = "Repeated fake enquiries sent to 14 suppliers in Al Quoz, reported on 12 Sep.";

describe("suspending an account", () => {
  it("is refused to a moderator, server-side", async () => {
    const userId = await person();
    await expect(suspendAccount({ actor: moderator, userId, reason: REASON })).rejects.toThrow(PermissionError);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).suspendedAt).toBeNull();
  });

  it("is refused without a written reason", async () => {
    const userId = await person();
    await expect(suspendAccount({ actor: opsLead, userId, reason: "  " })).rejects.toThrow(AuditReasonError);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).suspendedAt).toBeNull();
  });

  it("suspends, writes the reason on the audit row, and emails it", async () => {
    const userId = await person();
    const result = await suspendAccount({ actor: opsLead, userId, reason: REASON });
    expect(result).toMatchObject({ ok: true, emailed: true });

    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { suspendedAt: true } });
    expect(row.suspendedAt).not.toBeNull();

    const audit = await prisma.auditEvent.findMany({ where: { subject: `User:${userId}` } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "account_suspended", actorId: opsLead.id, reason: REASON });
  });

  it("writes one row and one audit event when two ops leads press at once", async () => {
    const userId = await person();
    const results = await Promise.all([
      suspendAccount({ actor: opsLead, userId, reason: REASON }),
      suspendAccount({ actor: opsLead, userId, reason: REASON }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error === "already_suspended")).toHaveLength(1);
    // The loser's audit row went down with its transaction.
    expect(await prisma.auditEvent.count({ where: { subject: `User:${userId}` } })).toBe(1);
  });

  it("refuses yourself, and a staff seat — board 4i deactivates those", async () => {
    expect(await suspendAccount({ actor: opsLead, userId: opsLead.id, reason: REASON })).toEqual({ ok: false, error: "self" });
    const staff = await person(["staff_finance"]);
    expect(await suspendAccount({ actor: opsLead, userId: staff, reason: REASON })).toEqual({ ok: false, error: "staff_seat" });
  });

  it("lifts it with a reason of its own", async () => {
    const userId = await person();
    await suspendAccount({ actor: opsLead, userId, reason: REASON });
    const lifted = await liftAccountSuspension({ actor: opsLead, userId, reason: "Reporter withdrew the complaint on 13 Sep." });
    expect(lifted).toMatchObject({ ok: true });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).suspendedAt).toBeNull();

    const actions = await prisma.auditEvent.findMany({
      where: { subject: `User:${userId}` },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { action: true },
    });
    expect(actions.map((a) => a.action)).toEqual(["account_suspended", "account_reinstated"]);
    expect(await liftAccountSuspension({ actor: opsLead, userId, reason: "Again, by mistake." })).toEqual({
      ok: false,
      error: "not_suspended",
    });
  });
});
