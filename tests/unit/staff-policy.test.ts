import { describe, expect, it } from "vitest";
import { ROLES, STAFF_ROLES, isRole, sameRoles } from "@/lib/auth/roles";
import {
  STAFF_INVITE_HOURS,
  holdsSellerSeat,
  inviteExpiry,
  losesViewAs,
  normaliseStaffEmail,
  refuseRosterChange,
  resendBlockedUntil,
  staffInviteState,
  staffRoleOf,
  withStaffRole,
  withoutStaffRoles,
} from "@/lib/staff/policy";
import { hashInviteToken, isWellFormedInviteToken, mintInviteToken, sameTokenHash } from "@/lib/staff/token";

/**
 * Board 4i's rules, without a database. Every refusal the staff console can
 * produce has a line here; `tests/integration/staff-roster.test.ts` proves the
 * service asks these under the lock.
 */

const NOW = new Date("2026-09-14T10:00:00Z");

describe("criterion 1 — three roles, and field_verifier is not one of them", () => {
  it("has exactly three staff roles", () => {
    expect([...STAFF_ROLES].sort()).toEqual(["staff_finance", "staff_moderator", "staff_ops_lead"]);
  });

  it("does not accept the retired value anywhere a role is parsed", () => {
    expect(isRole("staff_field")).toBe(false);
    expect((ROLES as readonly string[]).includes("staff_field")).toBe(false);
    expect(staffRoleOf(["staff_field"])).toBeNull();
  });
});

describe("one staff role per person — finance cannot also moderate", () => {
  it("replaces every staff role and keeps the rest", () => {
    expect(withStaffRole(["buyer", "staff_moderator"], "staff_finance")).toEqual(["buyer", "staff_finance"]);
  });

  it("collapses a row holding two staff roles to the one granted", () => {
    expect(withStaffRole(["staff_moderator", "staff_finance"], "staff_ops_lead")).toEqual(["staff_ops_lead"]);
  });

  it("reads the widest role from a row holding two", () => {
    expect(staffRoleOf(["staff_finance", "staff_ops_lead"])).toBe("staff_ops_lead");
  });

  it("deactivation removes staff roles only", () => {
    expect(withoutStaffRoles(["buyer", "staff_ops_lead"])).toEqual(["buyer"]);
  });

  it("treats a supplier seat as disqualifying, by role or by business", () => {
    expect(holdsSellerSeat(["seller_sales"], null)).toBe(true);
    expect(holdsSellerSeat(["buyer"], "biz_1")).toBe(true);
    expect(holdsSellerSeat(["buyer"], null)).toBe(false);
  });
});

describe("B7 — invitations go only to a staff domain", () => {
  it("normalises case and whitespace", () => {
    expect(normaliseStaffEmail("  S.Iqbal@BusinessListings.me ")).toEqual({
      ok: true,
      email: "s.iqbal@businesslistings.me",
    });
  });

  it("refuses the render's contractor address until Q3 is answered", () => {
    expect(normaliseStaffEmail("contractor@vendor.ae")).toEqual({ ok: false, error: "outside_domain" });
  });

  it("refuses a lookalike subdomain", () => {
    expect(normaliseStaffEmail("a@evil.businesslistings.me")).toEqual({ ok: false, error: "outside_domain" });
    expect(normaliseStaffEmail("a@businesslistings.me.evil.com")).toEqual({ ok: false, error: "outside_domain" });
  });

  it("refuses what cannot be an address", () => {
    for (const bad of ["", "@businesslistings.me", "a@", "a b@businesslistings.me", "a@b@businesslistings.me"]) {
      expect(normaliseStaffEmail(bad)).toEqual({ ok: false, error: "invalid_email" });
    }
  });
});

describe("criterion 7 — the last ops lead, and your own role", () => {
  const target = (roles: string[], suspendedAt: Date | null = null) => ({ id: "u_target", roles, suspendedAt });

  it("refuses demoting the only active ops lead", () => {
    expect(
      refuseRosterChange({ actorId: "u_me", target: target(["staff_ops_lead"]), next: "staff_moderator", activeOpsLeads: 1 }),
    ).toBe("last_ops_lead");
  });

  it("refuses deactivating the only active ops lead", () => {
    expect(
      refuseRosterChange({ actorId: "u_me", target: target(["staff_ops_lead"]), next: null, activeOpsLeads: 1 }),
    ).toBe("last_ops_lead");
  });

  it("allows it when another active ops lead remains", () => {
    expect(
      refuseRosterChange({ actorId: "u_me", target: target(["staff_ops_lead"]), next: null, activeOpsLeads: 2 }),
    ).toBeNull();
  });

  it("does not count a suspended ops lead towards the floor it is removed from", () => {
    // One active ops lead elsewhere; the suspended one is not it.
    expect(
      refuseRosterChange({
        actorId: "u_me",
        target: target(["staff_ops_lead"], NOW),
        next: null,
        activeOpsLeads: 1,
      }),
    ).toBeNull();
  });

  it("refuses any change to your own staff role, even with other ops leads", () => {
    expect(
      refuseRosterChange({
        actorId: "u_target",
        target: target(["staff_ops_lead"]),
        next: "staff_finance",
        activeOpsLeads: 3,
      }),
    ).toBe("self");
  });

  it("refuses a no-op, a non-staff target, and a new role for a suspended account", () => {
    expect(
      refuseRosterChange({ actorId: "u_me", target: target(["staff_moderator"]), next: "staff_moderator", activeOpsLeads: 2 }),
    ).toBe("same_role");
    expect(
      refuseRosterChange({ actorId: "u_me", target: target(["buyer"]), next: "staff_moderator", activeOpsLeads: 2 }),
    ).toBe("not_staff");
    expect(
      refuseRosterChange({
        actorId: "u_me",
        target: target(["staff_moderator"], NOW),
        next: "staff_finance",
        activeOpsLeads: 2,
      }),
    ).toBe("suspended");
  });

  it("allows promotion to ops lead whatever the count", () => {
    expect(
      refuseRosterChange({ actorId: "u_me", target: target(["staff_finance"]), next: "staff_ops_lead", activeOpsLeads: 1 }),
    ).toBeNull();
  });
});

describe("B8 — invitations expire and show their window", () => {
  it("expires after the stated hours", () => {
    expect(inviteExpiry(NOW).getTime() - NOW.getTime()).toBe(STAFF_INVITE_HOURS * 3_600_000);
  });

  it("reads expiry before the outcome columns would", () => {
    expect(staffInviteState({ expiresAt: new Date(NOW.getTime() + 1), acceptedAt: null, revokedAt: null }, NOW)).toBe(
      "pending",
    );
    expect(staffInviteState({ expiresAt: NOW, acceptedAt: null, revokedAt: null }, NOW)).toBe("expired");
    expect(staffInviteState({ expiresAt: NOW, acceptedAt: NOW, revokedAt: null }, NOW)).toBe("accepted");
    expect(staffInviteState({ expiresAt: NOW, acceptedAt: null, revokedAt: NOW }, NOW)).toBe("revoked");
  });

  it("limits resends server-side", () => {
    expect(resendBlockedUntil(new Date(NOW.getTime() - 60_000), NOW)).not.toBeNull();
    expect(resendBlockedUntil(new Date(NOW.getTime() - 16 * 60_000), NOW)).toBeNull();
  });
});

describe("a role change ends what it takes away", () => {
  it("ends view-as when moving a moderator to finance", () => {
    expect(losesViewAs(["staff_moderator"], ["staff_finance"])).toBe(true);
  });

  it("does not when both roles hold it", () => {
    expect(losesViewAs(["staff_moderator"], ["staff_ops_lead"])).toBe(false);
  });
});

describe("tokens", () => {
  it("mints 256 bits in a link-safe shape and stores only the hash", () => {
    const { token, tokenHash } = mintInviteToken();
    expect(isWellFormedInviteToken(token)).toBe(true);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toBe(hashInviteToken(token));
    expect(tokenHash).not.toContain(token);
  });

  it("mints a different token each time", () => {
    expect(mintInviteToken().token).not.toBe(mintInviteToken().token);
  });

  it("refuses a malformed token before any lookup", () => {
    for (const bad of ["", "short", "a".repeat(44), `${"a".repeat(42)}/`, `${"a".repeat(42)}%`]) {
      expect(isWellFormedInviteToken(bad)).toBe(false);
    }
  });

  it("compares digests in constant time and refuses mismatched lengths", () => {
    const hash = hashInviteToken("x");
    expect(sameTokenHash(hash, hash)).toBe(true);
    expect(sameTokenHash(hash, hashInviteToken("y"))).toBe(false);
    expect(sameTokenHash(hash, "ab")).toBe(false);
  });
});

describe("a claim is stale when it grants something different, not when it is shorter", () => {
  it("catches a same-length swap the old length check missed", () => {
    expect(sameRoles(["staff_moderator"], ["staff_finance"])).toBe(false);
  });

  it("ignores order and repeats", () => {
    expect(sameRoles(["buyer", "staff_finance"], ["staff_finance", "buyer", "buyer"])).toBe(true);
  });
});
