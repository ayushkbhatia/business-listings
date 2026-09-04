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
import { mayRemoveReview } from "./guards";

const actor = (...roles: Role[]): Actor => ({ id: `user_${roles.join("_")}`, roles });

describe("acceptance criterion 6 — a staff_moderator cannot change a verification tier", () => {
  /*
   * Rewritten against docs/permissions.md.
   *
   * It asserted "rejected for every role except ops_lead", which was true of
   * the inferred matrix and then untrue of §07, which gave a field verifier the
   * row as well **for a visit they recorded**. Site visits were withdrawn and
   * that conditional half had nothing left to read, so the grant was narrowed
   * rather than widened and the original assertion is true again — for a
   * different reason, which is why the history is left here rather than tidied
   * away.
   */

  it("is rejected server-side for a moderator", () => {
    const moderator = actor("staff_moderator");
    expect(can(moderator, "business.verification_tier.write")).toBe(false);
    expect(() => assertCan(moderator, "business.verification_tier.write")).toThrow(PermissionError);
  });

  it("is rejected for every role except the ops lead", () => {
    for (const role of ROLES) {
      expect(can(actor(role), "business.verification_tier.write"), role).toBe(
        role === "staff_ops_lead",
      );
    }
  });

  it("is allowed for ops_lead", () => {
    expect(() =>
      assertCan(actor("staff_ops_lead"), "business.verification_tier.write"),
    ).not.toThrow();
  });

  it("carries a mono reference code the buyer can quote to support", () => {
    try {
      assertCan(actor("staff_moderator"), "business.verification_tier.write");
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
     * rows §07 calls subject-dependent, and would answer it optimistically — a
     * scoped sales seat seeing every branch. The guard file does not export
     * one, so this asserts the list a reviewer should check against.
     *
     * `business.verification_tier.write` used to be on it, and is not since
     * site visits were withdrawn: its subject was the visit that licensed a
     * field verifier, and it is a plain ops-lead role check now.
     */
    expect(SUBJECT_DEPENDENT.sort()).toEqual(
      [
        "analytics.read",
        "audit.read",
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
