import { describe, expect, it } from "vitest";
import { can, assertCan, capabilitiesFor } from "./can";
import {
  AUDITED_CAPABILITIES,
  CAPABILITIES,
  CAPABILITY_LIST,
  SUBJECT_DEPENDENT,
} from "./capabilities";
import { PermissionError } from "./errors";
import { ROLES, STAFF_ROLES, type Actor, type Role } from "./roles";
import { assertCanSetVerificationTier, canSetVerificationTier } from "./subject";
import { mayRemoveReview } from "./guards";

const actor = (...roles: Role[]): Actor => ({ id: `user_${roles.join("_")}`, roles });

describe("acceptance criterion 6 — a staff_moderator cannot change a verification tier", () => {
  /*
   * Rewritten against docs/permissions.md.
   *
   * This asserted "rejected for every role except ops_lead", which was true of
   * the inferred matrix and is not true of §07: a field verifier holds the row
   * too, **only for a visit they recorded**. The criterion itself is unchanged
   * — a moderator still cannot — but the test around it was asserting a
   * narrower world than the one the design describes, and would have made the
   * correct implementation look like a regression.
   */
  const OWN_VISIT = { businessId: "b1", recordedByStaffId: "user_staff_field" };
  const SOMEBODY_ELSES = { businessId: "b1", recordedByStaffId: "user_someone_else" };

  it("is rejected server-side for a moderator", () => {
    const moderator = actor("staff_moderator");
    expect(can(moderator, "business.verification_tier.write")).toBe(false);
    expect(() => assertCanSetVerificationTier(moderator, OWN_VISIT)).toThrow(PermissionError);
  });

  it("is rejected for every role that does not hold the row", () => {
    for (const role of ROLES) {
      const holds = role === "staff_ops_lead" || role === "staff_field";
      expect(can(actor(role), "business.verification_tier.write"), role).toBe(holds);
    }
  });

  it("is allowed for ops_lead, with or without a visit", () => {
    const opsLead = actor("staff_ops_lead");
    expect(() => assertCanSetVerificationTier(opsLead, OWN_VISIT)).not.toThrow();
    expect(() => assertCanSetVerificationTier(opsLead, null)).not.toThrow();
  });

  it("lets a field verifier set a tier only for a visit they recorded", () => {
    // permissions.md: "it is not a general grant. Enforce with a subject check,
    // not just a role check."
    const verifier = actor("staff_field");
    expect(canSetVerificationTier(verifier, OWN_VISIT)).toBe(true);
    expect(canSetVerificationTier(verifier, SOMEBODY_ELSES)).toBe(false);
  });

  it("denies a field verifier where no visit was recorded at all", () => {
    // A tier change licensed by a visit that did not happen is the thing this
    // check exists to prevent, so missing information denies.
    const verifier = actor("staff_field");
    expect(canSetVerificationTier(verifier, null)).toBe(false);
    expect(canSetVerificationTier(verifier, { businessId: "b1", recordedByStaffId: null })).toBe(
      false,
    );
  });

  it("carries a mono reference code the buyer can quote to support", () => {
    try {
      assertCanSetVerificationTier(actor("staff_moderator"), OWN_VISIT);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(PermissionError);
      const e = error as PermissionError;
      expect(e.code).toMatch(/^PERM-[0-9A-Z]{7}$/);
    }
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

  it("does not give ops_lead everything, and the exceptions are deliberate", () => {
    /*
     * This asserted that ops lead holds every audited capability, which was
     * true of the inferred matrix and is false in §07. Two rows are finance's
     * alone — issuing a subscription credit and exporting VAT data — and the
     * separation is the point: the role that can suspend an account and change
     * a verification tier is not also the role that can move money.
     *
     * "The most senior role can do everything" is a plausible assumption and
     * this matrix does not make it, so the test does not either.
     */
    const opsLead = actor("staff_ops_lead");
    const withheld = AUDITED_CAPABILITIES.filter((c) => !can(opsLead, c));
    expect(withheld).toEqual(["subscription.credit"]);

    expect(can(opsLead, "revenue.read")).toBe(false);
    expect(can(actor("staff_finance"), "subscription.credit")).toBe(true);
    expect(can(actor("staff_finance"), "revenue.read")).toBe(true);
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
    expect(mayRemoveReview(actor("staff_moderator"))).toBe(false);
    expect(mayRemoveReview(actor("staff_ops_lead"))).toBe(true);
  });

  it("are not offered for a subject-dependent row", () => {
    /*
     * A `may*` taking only an actor would answer the wrong question for the
     * three rows §07 calls subject-dependent, and would answer it optimistically
     * — a field verifier dimming nothing, a scoped sales seat seeing every
     * branch. The guard file does not export one, so this asserts the list a
     * reviewer should check against.
     */
    expect(SUBJECT_DEPENDENT.sort()).toEqual(
      [
        "analytics.read",
        "audit.read",
        "business.verification_tier.write",
        "enquiry.read_other_business",
        "enquiry.respond",
        "quote.send",
      ].sort(),
    );
  });
});

describe("assertCan", () => {
  it("throws PermissionError and nothing else", () => {
    expect(() => assertCan(actor("buyer"), "review.remove")).toThrow(PermissionError);
    // A moderator may reject a submission and resolve a report, and may not
    // remove a published review — §07 holds that one rung higher.
    expect(() => assertCan(actor("staff_moderator"), "review.remove")).toThrow(PermissionError);
    expect(() => assertCan(actor("staff_ops_lead"), "review.remove")).not.toThrow();
  });
});
