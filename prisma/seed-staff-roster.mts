import type { PrismaClient } from "../lib/db/generated/client.js";
import { mintInviteToken } from "../lib/staff/token.js";

/**
 * Board 4i — the roster's states, against the staff the seed already has.
 *
 * The board's states table names seven, and each gets a row a screen or a test
 * can reach:
 *
 *   - typical — the five staff seats `main()` creates, with measured last-active
 *     times and decisions already in the log from the boards before this one;
 *   - invite pending — `incoming.moderator@`, inside its window;
 *   - invite expired — `lapsed.finance@`, past it and resendable;
 *   - last ops lead — not seeded: the seed has two ops leads on purpose (board 6f
 *     needs a second approver), so the floor is proved in integration tests,
 *     where a transaction can make one the last;
 *   - role retired — the former field verifier, deactivated, with the reason on
 *     its audit row;
 *   - log filtered — every row below is a real action with a real subject;
 *   - suspended staff account — covered by the deactivated row, whose earlier
 *     audit entries stay under its name.
 *
 * Two fixtures exist for the acceptance suite and nothing else, and are named
 * so: `staff.fixture.role@` has its role changed by `admin-staff.spec.ts`, and
 * `staff.fixture.leaver@` is deactivated by it. Their ids sort after every
 * original staff seat, so a test that takes "the first moderator" by id still
 * gets `moderator@`.
 *
 * PRNG-free. Invitation tokens come from `node:crypto`, not the seed's `rnd()`,
 * so no slug elsewhere moves because this ran.
 */

type Db = PrismaClient;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The same shape `main()` uses, so the fixtures sit beside the seats they join. */
function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

export const STAFF_FIXTURE_ROLE_ID = uuid(6);
export const STAFF_FIXTURE_LEAVER_ID = uuid(7);

export async function seedStaffRoster(db: Db, now: Date): Promise<void> {
  console.log("→ staff roster, invitations and a retired role's holder, for board 4i");

  const ago = (ms: number) => new Date(now.getTime() - ms);
  const ahead = (ms: number) => new Date(now.getTime() + ms);

  const opsLead = await db.user.findUniqueOrThrow({ where: { id: uuid(1) }, select: { id: true } });

  // ── Measured activity on the seats that exist ─────────────────────────────
  // What `requireStaff()` would have written had these people used the console.
  const activity: [number, number][] = [
    [1, 2 * 60_000],
    [2, 4 * 60_000],
    [4, 26 * HOUR],
    [5, 3 * DAY],
  ];
  for (const [n, sinceMs] of activity) {
    await db.user.update({ where: { id: uuid(n) }, data: { staffLastActiveAt: ago(sinceMs) } });
  }

  // ── The former field verifier ─────────────────────────────────────────────
  // Board 4i Q1 reassigns a retired role's holders; production's one holder was
  // moved to moderator by the retirement migration. The seed takes the other
  // road the board allows — offboarding — so the deactivated state has a row,
  // and so "the moderator" stays one account for every test that looks for it.
  await db.user.update({
    where: { id: uuid(3) },
    data: { staffDeactivatedAt: ago(9 * DAY), staffLastActiveAt: ago(10 * DAY) },
  });

  // ── Acceptance fixtures ───────────────────────────────────────────────────
  await db.user.createMany({
    data: [
      {
        id: STAFF_FIXTURE_ROLE_ID,
        email: "staff.fixture.role@businesslistings.me",
        fullName: "Role Change Fixture",
        roles: ["staff_moderator"],
        staffLastActiveAt: ago(5 * HOUR),
      },
      {
        id: STAFF_FIXTURE_LEAVER_ID,
        email: "staff.fixture.leaver@businesslistings.me",
        fullName: "Deactivation Fixture",
        roles: ["staff_finance"],
        staffLastActiveAt: ago(2 * DAY),
      },
    ],
  });

  // ── Invitations ───────────────────────────────────────────────────────────
  const pending = { id: "seedstaffinvite4ipending01", ...mintInviteToken() };
  const expired = { id: "seedstaffinvite4iexpired01", ...mintInviteToken() };
  const revocable = { id: "seedstaffinvite4irevoke001", ...mintInviteToken() };

  await db.staffInvite.createMany({
    data: [
      {
        id: pending.id,
        email: "incoming.moderator@businesslistings.me",
        role: "staff_moderator",
        tokenHash: pending.tokenHash,
        invitedById: opsLead.id,
        lastSentAt: ago(22 * HOUR),
        expiresAt: ahead(50 * HOUR),
        createdAt: ago(22 * HOUR),
      },
      {
        id: expired.id,
        email: "lapsed.finance@businesslistings.me",
        role: "staff_finance",
        tokenHash: expired.tokenHash,
        invitedById: opsLead.id,
        lastSentAt: ago(6 * DAY),
        expiresAt: ago(3 * DAY),
        createdAt: ago(6 * DAY),
      },
      {
        id: revocable.id,
        email: "staff.fixture.revoke@businesslistings.me",
        role: "staff_moderator",
        tokenHash: revocable.tokenHash,
        invitedById: opsLead.id,
        lastSentAt: ago(3 * HOUR),
        expiresAt: ahead(69 * HOUR),
        createdAt: ago(3 * HOUR),
      },
    ],
  });

  // ── The decisions those rows owe ──────────────────────────────────────────
  // Non-negotiable 3: every one of these is a staff state change, so every one
  // has a written reason and a named actor who holds `staff.manage`.
  await db.auditEvent.createMany({
    data: [
      {
        actorId: opsLead.id,
        action: "staff_deactivated",
        subject: `User:${uuid(3)}`,
        reason:
          "Field verifier retired by the 5 Sep cut. Offboarded rather than moved to moderation: this seat carried no moderation work to move.",
        before: { role: "staff_field" },
        after: { role: null },
        createdAt: ago(9 * DAY),
      },
      {
        actorId: opsLead.id,
        action: "staff_invited",
        subject: `StaffInvite:${expired.id}`,
        reason: "Second finance seat, so quarter-end VAT exports have cover when the first is away.",
        after: { email: "lapsed.finance@businesslistings.me", role: "staff_finance" },
        createdAt: ago(6 * DAY),
      },
      {
        actorId: opsLead.id,
        action: "staff_invited",
        subject: `StaffInvite:${pending.id}`,
        reason: "A second moderator for the approval queue, so decisions do not wait on one person.",
        after: { email: "incoming.moderator@businesslistings.me", role: "staff_moderator" },
        createdAt: ago(22 * HOUR),
      },
      {
        actorId: opsLead.id,
        action: "staff_invited",
        subject: `StaffInvite:${revocable.id}`,
        reason: "Acceptance fixture: an outstanding invitation the staff suite revokes.",
        after: { email: "staff.fixture.revoke@businesslistings.me", role: "staff_moderator" },
        createdAt: ago(3 * HOUR),
      },
    ],
  });
}
