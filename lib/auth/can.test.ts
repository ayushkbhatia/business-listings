import { describe, expect, it } from "vitest";
import { can, assertCan, capabilitiesFor } from "./can";
import { AUDITED_CAPABILITIES, CAPABILITIES, CAPABILITY_LIST } from "./capabilities";
import { PermissionError } from "./errors";
import { ROLES, STAFF_ROLES, type Actor, type Role } from "./roles";
import { assertCanChangeVerificationTier, mayChangeVerificationTier } from "./guards";

const actor = (...roles: Role[]): Actor => ({ id: `user_${roles.join("_")}`, roles });

describe("acceptance criterion 6 — a staff_moderator cannot change a verification tier", () => {
  it("is rejected server-side", () => {
    const moderator = actor("staff_moderator");
    expect(can(moderator, "business.verification_tier.write")).toBe(false);
    expect(() => assertCanChangeVerificationTier(moderator)).toThrow(PermissionError);
  });

  it("is rejected for every role except ops_lead", () => {
    for (const role of ROLES) {
      const expected = role === "staff_ops_lead";
      expect(can(actor(role), "business.verification_tier.write"), role).toBe(expected);
    }
  });

  it("is allowed for ops_lead", () => {
    expect(() => assertCanChangeVerificationTier(actor("staff_ops_lead"))).not.toThrow();
  });

  it("carries a mono reference code the buyer can quote to support", () => {
    try {
      assertCanChangeVerificationTier(actor("staff_moderator"));
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(PermissionError);
      const e = error as PermissionError;
      expect(e.code).toMatch(/^PERM-[0-9A-Z]{7}$/);
      expect(e.capability).toBe("business.verification_tier.write");
    }
  });

  it("gives the same code for the same denial, so support can look it up", () => {
    const first = new PermissionError("business.verification_tier.write", "a");
    const second = new PermissionError("business.verification_tier.write", "b");
    expect(first.code).toBe(second.code);
    expect(new PermissionError("review.remove", "a").code).not.toBe(first.code);
  });

  it("leaks no identity into the code", () => {
    const e = new PermissionError("business.verification_tier.write", "user_abc123");
    expect(e.code).not.toContain("abc123");
  });
});

describe("the matrix", () => {
  it("grants nothing to an actor with no role", () => {
    expect(capabilitiesFor(actor())).toEqual([]);
  });

  it("passes when any held role grants the capability", () => {
    expect(can(actor("staff_field", "staff_ops_lead"), "business.merge")).toBe(true);
    expect(can(actor("staff_field", "staff_moderator"), "business.merge")).toBe(false);
  });

  it("gives ops_lead every audited capability — it is the role that answers for them", () => {
    for (const capability of AUDITED_CAPABILITIES) {
      expect(can(actor("staff_ops_lead"), capability), capability).toBe(true);
    }
  });

  it("lets no buyer reach a staff capability", () => {
    const buyer = actor("buyer");
    for (const capability of CAPABILITY_LIST) {
      const staffOnly = CAPABILITIES[capability].roles.every((r) =>
        (STAFF_ROLES as readonly string[]).includes(r),
      );
      if (staffOnly) expect(can(buyer, capability), capability).toBe(false);
    }
  });

  it("lets no seller role reach a staff capability", () => {
    for (const role of ["seller_owner", "seller_manager", "seller_sales", "seller_finance"] as const) {
      for (const capability of CAPABILITY_LIST) {
        const staffOnly = CAPABILITIES[capability].roles.every((r) =>
          (STAFF_ROLES as readonly string[]).includes(r),
        );
        if (staffOnly) expect(can(actor(role), capability), `${role} ${capability}`).toBe(false);
      }
    }
  });

  it("names only roles that exist", () => {
    for (const capability of CAPABILITY_LIST) {
      for (const role of CAPABILITIES[capability].roles) {
        expect(ROLES, capability).toContain(role);
      }
    }
  });

  it("grants every capability to at least one role", () => {
    for (const capability of CAPABILITY_LIST) {
      expect(CAPABILITIES[capability].roles.length, capability).toBeGreaterThan(0);
    }
  });

  it("records why every row is what it is, and whether §07 confirmed it", () => {
    for (const capability of CAPABILITY_LIST) {
      const spec = CAPABILITIES[capability];
      expect(spec.why.length, capability).toBeGreaterThan(20);
      expect(["stated", "inferred"], capability).toContain(spec.source);
    }
  });

  it("marks every staff state change as audited", () => {
    for (const capability of CAPABILITY_LIST) {
      const spec = CAPABILITIES[capability];
      const isRead = capability.endsWith(".read");
      const staffOnly = spec.roles.every((r) => (STAFF_ROLES as readonly string[]).includes(r));
      if (staffOnly && !isRead) expect(spec.audited, capability).toBe(true);
    }
  });
});

describe("may* helpers", () => {
  it("mirror the assert form without throwing, for dimming a control", () => {
    // A locked panel is shown dimmed, never hidden — a seller cannot want what
    // they cannot see, and a staff member needs to know a queue exists.
    expect(mayChangeVerificationTier(actor("staff_moderator"))).toBe(false);
    expect(mayChangeVerificationTier(actor("staff_ops_lead"))).toBe(true);
  });
});

describe("assertCan", () => {
  it("throws PermissionError and nothing else", () => {
    expect(() => assertCan(actor("buyer"), "review.remove")).toThrow(PermissionError);
    expect(() => assertCan(actor("staff_moderator"), "review.remove")).not.toThrow();
  });
});
