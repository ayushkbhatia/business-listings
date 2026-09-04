import { describe, expect, it } from "vitest";
import {
  analyticsScopeFor,
  auditScopeFor,
  canReadOtherBusinessEnquiries,
  canRespondToEnquiry,
  withinScope,
} from "@/lib/auth/subject";
import { can } from "@/lib/auth/can";
import { SUBJECT_DEPENDENT } from "@/lib/auth/capabilities";
import type { Actor } from "@/lib/auth/roles";

/**
 * The three rows a role cannot answer, and the direction each fails in.
 *
 * permissions.md: "Role is an input, never the check itself — three of the rows
 * above are subject-dependent and a role-only check gets them wrong." Getting
 * them wrong is not symmetrical: each one fails *open*, which is why they are
 * tested separately from the matrix rather than inside it.
 */

const verifier: Actor = { id: "field_1", roles: ["staff_field"] };
const opsLead: Actor = { id: "ops_1", roles: ["staff_ops_lead"] };

describe("setting a verification tier is a plain role check again", () => {
  /*
     It was subject-dependent, and this suite existed because of that: a field
     verifier held `business.verification_tier.write` only for a business they
     had recorded a visit to, and a role-only check would have let any verifier
     tier any business — the one row CLAUDE.md calls a non-negotiable.

     Site visits were withdrawn and `Business.visitedByStaffId` with them, so
     the conditional half had no evidence left to read. The grant was narrowed
     to the ops lead rather than widened to an unconditional one, which is the
     safe direction: the failure this suite guarded against is now impossible
     because the role that could commit it no longer holds the row.
  */
  it("is held by the ops lead and nobody else", () => {
    expect(can(opsLead, "business.verification_tier.write")).toBe(true);
    expect(can(verifier, "business.verification_tier.write")).toBe(false);
    expect(can({ id: "mod_1", roles: ["staff_moderator"] }, "business.verification_tier.write")).toBe(
      false,
    );
  });

  it("is no longer declared subject-dependent", () => {
    // A leftover `subject` on the row would send call sites back through a
    // check that has no row to read, which throws rather than refusing.
    expect(SUBJECT_DEPENDENT).not.toContain("business.verification_tier.write");
  });
});

describe("a branch-scoped sales seat", () => {
  const scoped: Actor = { id: "s1", roles: ["seller_sales"], businessId: "b1", branchId: "quoz" };
  const unscoped: Actor = { id: "s2", roles: ["seller_sales"], businessId: "b1" };

  it("reaches its own branch", () => {
    expect(canRespondToEnquiry(scoped, { businessId: "b1", branchId: "quoz" })).toBe(true);
  });

  it("does not reach another branch", () => {
    // Board 7d shows Fatima scoped to Al Quoz. A role-only check makes the
    // scoping do nothing at all.
    expect(canRespondToEnquiry(scoped, { businessId: "b1", branchId: "mussafah" })).toBe(false);
  });

  it("still reaches an enquiry that was not routed to a branch", () => {
    // It was not routed away from them, and hiding it loses the enquiry rather
    // than scoping it.
    expect(canRespondToEnquiry(scoped, { businessId: "b1", branchId: null })).toBe(true);
    expect(canRespondToEnquiry(scoped, { businessId: "b1" })).toBe(true);
  });

  it("narrows what a seat holds and never widens it", () => {
    // Scoping cannot reach outside the business, and an unscoped seat is
    // limited by the business check alone.
    expect(withinScope(scoped, { businessId: "b2", branchId: "quoz" })).toBe(false);
    expect(withinScope(unscoped, { businessId: "b1", branchId: "mussafah" })).toBe(true);
  });
});

describe("analytics is a scope, not a yes or no", () => {
  it("gives an owner and a manager the whole business", () => {
    for (const role of ["seller_owner", "seller_manager"] as const) {
      const scope = analyticsScopeFor({ id: "u", roles: [role], businessId: "b1" });
      expect(scope, role).toEqual({ kind: "all", businessId: "b1" });
    }
  });

  it("gives a sales seat their own leads", () => {
    // A boolean would have made each screen invent the narrowing itself, then
    // invent it differently on the next one.
    expect(analyticsScopeFor({ id: "s1", roles: ["seller_sales"], businessId: "b1" })).toEqual({
      kind: "own_leads",
      businessId: "b1",
      actorId: "s1",
    });
  });

  it("carries the branch through where the seat is scoped", () => {
    expect(
      analyticsScopeFor({ id: "s1", roles: ["seller_sales"], businessId: "b1", branchId: "quoz" }),
    ).toMatchObject({ kind: "own_leads", branchId: "quoz" });
  });

  it("gives the finance seat nothing, because §07 does not give it the row", () => {
    expect(analyticsScopeFor({ id: "f1", roles: ["seller_finance"], businessId: "b1" })).toBeNull();
  });
});

describe("reading another business's enquiries is audit-only", () => {
  const moderator: Actor = { id: "mod_1", roles: ["staff_moderator"] };

  it("requires a reason, by the signature rather than by a check", () => {
    /*
     * §07 calls this "the one row that matters most: support needs it, and it
     * must be impossible to do silently." A caller with nothing to write cannot
     * form the argument, which is the point — returning a boolean and leaving
     * the audit row to the caller is exactly how the read becomes silent.
     */
    expect(
      canReadOtherBusinessEnquiries(moderator, { businessId: "b9", reason: "" }),
    ).toBe(false);
    expect(
      canReadOtherBusinessEnquiries(moderator, { businessId: "b9", reason: "   " }),
    ).toBe(false);
    expect(
      canReadOtherBusinessEnquiries(moderator, {
        businessId: "b9",
        reason: "Supplier called about an enquiry they say never arrived.",
      }),
    ).toBe(true);
  });

  it("asks nothing of a seller reading their own", () => {
    const owner: Actor = { id: "o1", roles: ["seller_owner"], businessId: "b1" };
    // Not a cross-business read, and not the row — a seller does not hold it.
    expect(canReadOtherBusinessEnquiries(owner, { businessId: "b1", reason: "" })).toBe(false);
  });

  it("refuses a role that does not hold it, reason or no reason", () => {
    const field: Actor = { id: "f1", roles: ["staff_field"] };
    expect(
      canReadOtherBusinessEnquiries(field, { businessId: "b9", reason: "A very good reason." }),
    ).toBe(false);
  });
});

describe("the audit log is scoped too", () => {
  it("gives an ops lead all of it", () => {
    expect(auditScopeFor(opsLead)).toEqual({ kind: "all" });
  });

  it("gives every other staff role their own actions", () => {
    // §07: "own actions" for moderator, field verifier and finance. A boolean
    // would have shown a moderator the whole log.
    for (const role of ["staff_moderator", "staff_field", "staff_finance"] as const) {
      expect(auditScopeFor({ id: "u1", roles: [role] }), role).toEqual({
        kind: "own",
        actorId: "u1",
      });
    }
  });

  it("gives a seller nothing", () => {
    expect(auditScopeFor({ id: "o1", roles: ["seller_owner"], businessId: "b1" })).toBeNull();
  });
});
