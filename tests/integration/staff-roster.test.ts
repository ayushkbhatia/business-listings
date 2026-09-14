import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";
import { auditRows, readAuditPage } from "@/lib/audit/log";
import { acceptStaffInvite, readStaffInvite } from "@/lib/staff/accept";
import { staffRoster } from "@/lib/staff/roster";
import {
  changeStaffRole,
  deactivateStaff,
  inviteStaff,
  resendStaffInvite,
  revokeStaffInvite,
} from "@/lib/staff/service";
import { hashInviteToken } from "@/lib/staff/token";
import { purgeAuditRows } from "./audit-cleanup";

/**
 * Board 4i against a real database — acceptance criteria 1, 3, 6, 7, 8 and 9,
 * and the service-layer rules the screen only mirrors.
 *
 * Create-and-destroy fixtures. The seeded ops leads are borrowed in exactly one
 * block — criterion 7 needs a world where somebody is the last ops lead — and
 * that block suspends them inside `try` and restores them in `finally`, because
 * the acceptance suite signs in as one of them and a crash here must not sign
 * it out of the console.
 */

/*
   The carrier, replaced at its boundary. Whether a local environment has an
   email sender configured is not this suite's business, and the token exists
   only in the message — so the mock records what would have been sent, and
   `delivery` decides whether the send "worked", which is the fork the service
   takes between handing back a link and not.
*/
const sent = vi.hoisted(() => ({ tokens: [] as string[], delivery: true }));
vi.mock("@/lib/staff/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/staff/email")>();
  return {
    ...actual,
    sendStaffInviteEmail: async (input: { token: string }) => {
      sent.tokens.push(input.token);
      return sent.delivery;
    },
  };
});

const PREFIX = `staff4i-${process.pid}-`;
const DOMAIN = "businesslistings.me";
const REASON = "Integration fixture for board 4i, written by the staff roster suite.";
let seq = 0;

const madeUsers: string[] = [];

async function person(roles: Role[], extra: { email?: string; businessId?: string | null } = {}) {
  const user = await prisma.user.create({
    data: {
      id: randomUUID(),
      fullName: `Staff Fixture ${seq}`,
      email: extra.email ?? `${PREFIX}${seq++}@${DOMAIN}`,
      roles,
      ...(extra.businessId ? { businessId: extra.businessId } : {}),
    },
    select: { id: true, email: true, roles: true },
  });
  madeUsers.push(user.id);
  return user;
}

const actorOf = (user: { id: string; roles: Role[] }): Actor => ({ id: user.id, roles: user.roles });
const freshEmail = () => `${PREFIX}${seq++}@${DOMAIN}`;

/** The token the last send carried. */
function lastToken(): string {
  const token = sent.tokens.at(-1);
  if (!token) throw new Error("expected an invitation to have been sent");
  return token;
}

let opsLead: { id: string; roles: Role[]; email: string | null };

beforeAll(async () => {
  opsLead = await person(["staff_ops_lead"]);
});

afterAll(async () => {
  if (madeUsers.length === 0) return;
  await purgeAuditRows({ OR: [{ actorId: { in: madeUsers } }, { subject: { in: madeUsers.map((id) => `User:${id}`) } }] });
  await prisma.viewAsSession.deleteMany({ where: { staffId: { in: madeUsers } } });
  await prisma.staffInvite.deleteMany({
    where: { OR: [{ invitedById: { in: madeUsers } }, { acceptedById: { in: madeUsers } }] },
  });
  await prisma.user.deleteMany({ where: { id: { in: madeUsers } } });
});

describe("criterion 1 — the database enum has three staff roles", () => {
  it("does not hold staff_field", async () => {
    const rows = await prisma.$queryRaw<{ value: string }[]>`
      SELECT unnest(enum_range(NULL::"role"))::text AS value
    `;
    const values = rows.map((row) => row.value);
    expect(values).not.toContain("staff_field");
    expect(values.filter((v) => v.startsWith("staff_")).sort()).toEqual([
      "staff_finance",
      "staff_moderator",
      "staff_ops_lead",
    ]);
  });

  it("refuses staff_field in an invitation, by CHECK and by type", async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO staff_invite (id, email, role, token_hash, invited_by_id, expires_at, last_sent_at)
        VALUES (${randomUUID()}, ${freshEmail()}, 'staff_field', ${randomUUID()}, ${opsLead.id}::uuid, now(), now())
      `,
    ).rejects.toThrow();
  });
});

describe("inviting — B3, B7, B8", () => {
  it("records the invitation, hashes the token, and writes the reason under the inviter", async () => {
    const email = freshEmail();
    const result = await inviteStaff({
      actor: actorOf(opsLead),
      email: `  ${email.toUpperCase()} `,
      role: "staff_moderator",
      reason: REASON,
      inviterName: "Fixture Ops",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const token = lastToken();
    // Delivered, so no link is handed back to be copied around.
    expect(result.link).toBeNull();
    const row = await prisma.staffInvite.findUniqueOrThrow({ where: { id: result.inviteId } });
    expect(row.email).toBe(email);
    expect(row.tokenHash).toBe(hashInviteToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.expiresAt.getTime() - row.lastSentAt.getTime()).toBe(72 * 3_600_000);

    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { subject: `StaffInvite:${result.inviteId}` },
      orderBy: { id: "asc" },
    });
    expect(audit).toMatchObject({ actorId: opsLead.id, action: "staff_invited", reason: REASON });
  });

  it("hands back the link only when the email did not go", async () => {
    sent.delivery = false;
    try {
      const result = await inviteStaff({
        actor: actorOf(opsLead),
        email: freshEmail(),
        role: "staff_finance",
        reason: REASON,
        inviterName: "Fixture Ops",
      });
      expect(result).toMatchObject({ ok: true, delivered: false });
      if (!result.ok) return;
      expect(result.link).toMatch(new RegExp(`/staff/invite/${lastToken()}$`));
    } finally {
      sent.delivery = true;
    }
  });

  it("refuses a moderator before reading anything, and a blank reason before writing anything", async () => {
    const moderator = await person(["staff_moderator"]);
    const email = freshEmail();
    await expect(
      inviteStaff({ actor: actorOf(moderator), email, role: "staff_finance", reason: REASON, inviterName: "x" }),
    ).rejects.toBeInstanceOf(PermissionError);
    await expect(
      inviteStaff({ actor: actorOf(opsLead), email, role: "staff_finance", reason: "  ", inviterName: "x" }),
    ).rejects.toBeInstanceOf(AuditReasonError);
    expect(await prisma.staffInvite.count({ where: { email } })).toBe(0);
  });

  it("refuses an address off the staff domain, an existing member of staff and a supplier seat", async () => {
    const staff = await person(["staff_finance"]);
    const business = await prisma.business.findFirstOrThrow({ orderBy: { id: "asc" }, select: { id: true } });
    const seller = await person(["seller_sales"], { businessId: business.id });

    const attempt = (email: string) =>
      inviteStaff({ actor: actorOf(opsLead), email, role: "staff_moderator", reason: REASON, inviterName: "x" });

    expect(await attempt("contractor@vendor.ae")).toEqual({ ok: false, error: "outside_domain" });
    expect(await attempt(staff.email!)).toEqual({ ok: false, error: "already_staff" });
    expect(await attempt(seller.email!)).toEqual({ ok: false, error: "seller_seat" });
  });

  it("refuses a second outstanding invitation to the same address, including two at once", async () => {
    const email = freshEmail();
    const attempt = () =>
      inviteStaff({ actor: actorOf(opsLead), email, role: "staff_moderator", reason: REASON, inviterName: "x" });
    const [a, b] = await Promise.all([attempt(), attempt()]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((r) => !r.ok)).toEqual({ ok: false, error: "already_invited" });
    expect(await prisma.staffInvite.count({ where: { email, acceptedAt: null, revokedAt: null } })).toBe(1);
  });
});

describe("resending and revoking — B8, and the states table's expired invitation", () => {
  it("refuses a resend inside the window, then issues a new link that kills the old one", async () => {
    const invited = await inviteStaff({
      actor: actorOf(opsLead),
      email: freshEmail(),
      role: "staff_finance",
      reason: REASON,
      inviterName: "x",
    });
    if (!invited.ok) throw new Error("setup");
    const first = lastToken();

    const early = await resendStaffInvite({ actor: actorOf(opsLead), inviteId: invited.inviteId, reason: REASON, inviterName: "x" });
    expect(early).toMatchObject({ ok: false, error: "too_soon" });

    // The invitation row is not the log; moving its send time back is a fixture, not a rewrite of history.
    await prisma.staffInvite.update({
      where: { id: invited.inviteId },
      data: { lastSentAt: new Date(Date.now() - 20 * 60_000), expiresAt: new Date(Date.now() - 60_000) },
    });
    expect((await readStaffInvite(first)).state).toBe("expired");

    const resent = await resendStaffInvite({ actor: actorOf(opsLead), inviteId: invited.inviteId, reason: REASON, inviterName: "x" });
    expect(resent.ok).toBe(true);
    if (!resent.ok) return;
    const second = lastToken();

    expect(second).not.toBe(first);
    expect((await readStaffInvite(first)).state).toBe("not_found");
    expect((await readStaffInvite(second)).state).toBe("ok");
    const row = await prisma.staffInvite.findUniqueOrThrow({ where: { id: invited.inviteId } });
    expect(row.sendCount).toBe(2);
    expect(
      await prisma.auditEvent.count({ where: { subject: `StaffInvite:${invited.inviteId}`, action: "staff_invite_resent" } }),
    ).toBe(1);
  });

  it("revokes once, and the link then says nothing about anybody", async () => {
    const invited = await inviteStaff({
      actor: actorOf(opsLead),
      email: freshEmail(),
      role: "staff_moderator",
      reason: REASON,
      inviterName: "x",
    });
    if (!invited.ok) throw new Error("setup");
    const token = lastToken();

    expect(await revokeStaffInvite({ actor: actorOf(opsLead), inviteId: invited.inviteId, reason: REASON })).toEqual({ ok: true });
    expect(await revokeStaffInvite({ actor: actorOf(opsLead), inviteId: invited.inviteId, reason: REASON })).toEqual({
      ok: false,
      error: "not_outstanding",
    });
    expect(await readStaffInvite(token)).toEqual({ state: "revoked" });
  });
});

describe("accepting", () => {
  async function invite(role: "staff_moderator" | "staff_finance" | "staff_ops_lead", email = freshEmail()) {
    const result = await inviteStaff({ actor: actorOf(opsLead), email, role, reason: REASON, inviterName: "x" });
    if (!result.ok) throw new Error(`setup: ${result.error}`);
    return { id: result.inviteId, token: lastToken(), email };
  }

  it("grants exactly the invited role to the invited address, once", async () => {
    const offer = await invite("staff_finance");
    const invitee = await person(["buyer"], { email: offer.email });

    expect(await acceptStaffInvite(offer.token, actorOf(invitee))).toEqual({ ok: true, role: "staff_finance" });

    const after = await prisma.user.findUniqueOrThrow({ where: { id: invitee.id } });
    expect([...after.roles].sort()).toEqual(["buyer", "staff_finance"]);
    expect(after.staffDeactivatedAt).toBeNull();
    const row = await prisma.staffInvite.findUniqueOrThrow({ where: { id: offer.id } });
    expect(row.acceptedById).toBe(invitee.id);

    expect(await acceptStaffInvite(offer.token, actorOf(invitee))).toEqual({ ok: false, reason: "used" });
    expect(await readStaffInvite(offer.token)).toEqual({ state: "used" });
  });

  it("refuses another account holding the link", async () => {
    const offer = await invite("staff_moderator");
    const stranger = await person(["buyer"]);
    expect(await acceptStaffInvite(offer.token, actorOf(stranger))).toEqual({ ok: false, reason: "wrong_account" });
    const row = await prisma.staffInvite.findUniqueOrThrow({ where: { id: offer.id } });
    expect(row.acceptedAt).toBeNull();
  });

  it("refuses an expired link and a malformed one without a lookup", async () => {
    const offer = await invite("staff_moderator");
    const invitee = await person(["buyer"], { email: offer.email });
    await prisma.staffInvite.update({ where: { id: offer.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await acceptStaffInvite(offer.token, actorOf(invitee))).toEqual({ ok: false, reason: "expired" });
    expect(await acceptStaffInvite("../../etc/passwd", actorOf(invitee))).toEqual({ ok: false, reason: "not_found" });
  });

  it("returns a deactivated member of staff to the roster", async () => {
    const leaver = await person(["staff_moderator"]);
    expect(await deactivateStaff({ actor: actorOf(opsLead), userId: leaver.id, reason: REASON })).toEqual({ ok: true });
    const offer = await invite("staff_moderator", leaver.email!);
    expect(await acceptStaffInvite(offer.token, { id: leaver.id, roles: [] })).toEqual({ ok: true, role: "staff_moderator" });
    const back = await prisma.user.findUniqueOrThrow({ where: { id: leaver.id } });
    expect(back.staffDeactivatedAt).toBeNull();
    expect(back.roles).toEqual(["staff_moderator"]);
  });
});

describe("changing a role and deactivating — B3, B9, and the suspended-staff state", () => {
  it("swaps one staff role for another, keeps other roles, and logs both sides", async () => {
    const target = await person(["buyer", "staff_moderator"]);
    expect(
      await changeStaffRole({ actor: actorOf(opsLead), userId: target.id, role: "staff_finance", reason: REASON }),
    ).toEqual({ ok: true });

    const after = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect([...after.roles].sort()).toEqual(["buyer", "staff_finance"]);
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { subject: `User:${target.id}`, action: "staff_role_changed" },
      orderBy: { id: "asc" },
    });
    expect(audit.before).toEqual({ role: "staff_moderator" });
    expect(audit.after).toEqual({ role: "staff_finance" });
  });

  it("ends a live view-as session when the new role cannot view-as", async () => {
    const target = await person(["staff_moderator"]);
    const business = await prisma.business.findFirstOrThrow({ orderBy: { id: "asc" }, select: { id: true } });
    const session = await prisma.viewAsSession.create({
      data: { staffId: target.id, businessId: business.id, ticketRef: "SUP-4I", expiresAt: new Date(Date.now() + 30 * 60_000) },
    });
    await changeStaffRole({ actor: actorOf(opsLead), userId: target.id, role: "staff_finance", reason: REASON });
    const ended = await prisma.viewAsSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(ended.endedAt).not.toBeNull();
  });

  it("refuses your own role, a no-op, and a moderator acting", async () => {
    const moderator = await person(["staff_moderator"]);
    expect(
      await changeStaffRole({ actor: actorOf(opsLead), userId: opsLead.id, role: "staff_finance", reason: REASON }),
    ).toEqual({ ok: false, error: "self" });
    expect(
      await changeStaffRole({ actor: actorOf(opsLead), userId: moderator.id, role: "staff_moderator", reason: REASON }),
    ).toEqual({ ok: false, error: "same_role" });
    await expect(
      deactivateStaff({ actor: actorOf(moderator), userId: opsLead.id, reason: REASON }),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("deactivates, keeps non-staff roles, and leaves the person's log entries under their name", async () => {
    const leaver = await person(["buyer", "staff_finance"]);
    // A decision the leaver made while they held the role.
    await prisma.auditEvent.create({
      data: { actorId: leaver.id, action: "credit_issued", subject: "Subscription:fixture4i", reason: REASON },
    });

    expect(await deactivateStaff({ actor: actorOf(opsLead), userId: leaver.id, reason: REASON })).toEqual({ ok: true });

    const after = await prisma.user.findUniqueOrThrow({ where: { id: leaver.id } });
    expect(after.roles).toEqual(["buyer"]);
    expect(after.staffDeactivatedAt).not.toBeNull();
    expect(await prisma.auditEvent.count({ where: { actorId: leaver.id } })).toBe(1);

    const roster = await staffRoster(actorOf(opsLead));
    expect(roster?.former.some((f) => f.id === leaver.id)).toBe(true);
    expect(roster?.members.some((m) => m.id === leaver.id)).toBe(false);
  });
});

describe("criterion 7 — the last ops lead cannot be removed or demoted", () => {
  const suspended: string[] = [];

  afterEach(async () => {
    if (suspended.length > 0) {
      await prisma.user.updateMany({ where: { id: { in: suspended } }, data: { suspendedAt: null } });
      suspended.length = 0;
    }
  });

  it("lets exactly one of two ops leads remove the other when both try at once", async () => {
    const a = await person(["staff_ops_lead"]);
    const b = await person(["staff_ops_lead"]);

    try {
      // A world where a and b are the only active ops leads.
      const others = await prisma.user.findMany({
        where: { roles: { has: "staff_ops_lead" }, suspendedAt: null, id: { notIn: [a.id, b.id] } },
        select: { id: true },
        orderBy: { id: "asc" },
      });
      suspended.push(...others.map((o) => o.id));
      await prisma.user.updateMany({ where: { id: { in: suspended } }, data: { suspendedAt: new Date() } });

      const [first, second] = await Promise.all([
        deactivateStaff({ actor: actorOf(a), userId: b.id, reason: REASON }),
        deactivateStaff({ actor: actorOf(b), userId: a.id, reason: REASON }),
      ]);
      const outcomes = [first, second];
      expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
      expect(outcomes.find((o) => !o.ok)).toEqual({ ok: false, error: "last_ops_lead" });

      const remaining = await prisma.user.count({
        where: { id: { in: [a.id, b.id] }, roles: { has: "staff_ops_lead" } },
      });
      expect(remaining).toBe(1);
    } finally {
      await prisma.user.updateMany({ where: { id: { in: suspended } }, data: { suspendedAt: null } });
    }
  });
});

describe("B6 — the log is append-only", () => {
  it("refuses an UPDATE and an unflagged DELETE, from any path", async () => {
    const row = await prisma.auditEvent.create({
      data: { actorId: opsLead.id, action: "staff_changed", subject: `User:${opsLead.id}`, reason: REASON },
    });
    await expect(prisma.auditEvent.update({ where: { id: row.id }, data: { reason: "rewritten" } })).rejects.toThrow(
      /append-only/,
    );
    await expect(prisma.auditEvent.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRaw`DELETE FROM audit_event WHERE id = ${row.id}`).rejects.toThrow(/append-only/);
    expect(await prisma.auditEvent.count({ where: { id: row.id } })).toBe(1);
  });

  it("refuses a blast radius without a unit at the database too", async () => {
    await expect(
      prisma.auditEvent.create({
        data: { actorId: opsLead.id, action: "pairs_bulk_merged", subject: "MergeBatch:x", reason: REASON, blastRadius: 3 },
      }),
    ).rejects.toThrow();
  });
});

describe("reading the log back — scope, filters, pages and export", () => {
  it("pages without skipping or repeating rows that share a timestamp", async () => {
    const author = await person(["staff_ops_lead"]);
    const at = new Date();
    await prisma.auditEvent.createMany({
      data: Array.from({ length: 23 }, (_, i) => ({
        actorId: author.id,
        action: "staff_changed",
        subject: `User:${author.id}`,
        reason: `${REASON} Row ${i}.`,
        createdAt: at,
      })),
    });

    const filter = { actorId: author.id };
    const seen: string[] = [];
    let page = await readAuditPage(actorOf(opsLead), filter, { size: 10 });
    expect(page?.total).toBe(23);
    expect(page?.from).toBe(1);
    while (page) {
      seen.push(...page.entries.map((e) => e.id));
      if (!page.older) break;
      page = await readAuditPage(actorOf(opsLead), filter, { after: page.older, size: 10 });
    }
    expect(seen).toHaveLength(23);
    expect(new Set(seen).size).toBe(23);

    // And back again from the last page.
    const last = await readAuditPage(actorOf(opsLead), filter, { after: (await readAuditPage(actorOf(opsLead), filter, { size: 20 }))!.older, size: 10 });
    expect(last?.from).toBe(21);
    const back = await readAuditPage(actorOf(opsLead), filter, { before: last!.newer, size: 10 });
    expect(back?.from).toBe(11);
    expect(back?.entries).toHaveLength(10);

    const exported: string[] = [];
    for await (const batch of auditRows(actorOf(opsLead), filter, 7)) exported.push(...batch.map((e) => e.id));
    expect(exported).toEqual(seen);
  });

  it("gives a non-ops viewer their own rows whatever actor they ask for", async () => {
    const moderator = await person(["staff_moderator"]);
    await prisma.auditEvent.create({
      data: { actorId: moderator.id, action: "queue_decided", subject: "ListingChangeRequest:x4i", reason: REASON },
    });
    const page = await readAuditPage(actorOf(moderator), { actorId: opsLead.id });
    expect(page?.scope).toBe("own");
    expect(page?.entries.every((e) => e.actorId === moderator.id)).toBe(true);
    expect(page?.total).toBe(1);
  });

  it("names the subject and says what happened", async () => {
    const target = await person(["staff_moderator"]);
    await changeStaffRole({ actor: actorOf(opsLead), userId: target.id, role: "staff_finance", reason: REASON });
    const page = await readAuditPage(actorOf(opsLead), { subject: `User:${target.id}`, action: "staff_role_changed" });
    expect(page?.entries[0]).toMatchObject({
      headline: expect.stringContaining("changed a staff role"),
      subjectName: expect.stringContaining("Staff Fixture"),
    });
  });
});

describe("criterion 9 — the roster is complete, and a non-ops seat reads less of it", () => {
  it("lists every holder of a staff role, uncapped", async () => {
    const roster = await staffRoster(actorOf(opsLead));
    const holders = await prisma.user.count({
      where: { roles: { hasSome: ["staff_ops_lead", "staff_moderator", "staff_finance"] } },
    });
    expect(roster?.members).toHaveLength(holders);
    expect(roster?.counts.staff).toBe(holders);
    expect(roster?.counts.roles).toBe(3);
    expect(roster?.counts.retired).toBe(1);
  });

  it("withholds invitations, former staff and colleagues' workload from a moderator", async () => {
    const moderator = await person(["staff_moderator"]);
    const roster = await staffRoster(actorOf(moderator));
    expect(roster?.depth).toBe("limited");
    expect(roster?.invites).toEqual([]);
    expect(roster?.former).toEqual([]);
    const others = roster?.members.filter((m) => m.id !== moderator.id) ?? [];
    expect(others.every((m) => m.decisions === null && m.lastActiveAt === null)).toBe(true);
    expect(roster?.members.find((m) => m.id === moderator.id)?.decisions).toBe(0);
  });

  it("is refused outright to a seat with no staff role", async () => {
    const buyer = await person(["buyer"]);
    expect(await staffRoster(actorOf(buyer))).toBeNull();
  });
});
