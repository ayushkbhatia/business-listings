import { describe, expect, it } from "vitest";
import { CAPABILITIES, type Capability } from "@/lib/auth/capabilities";
import { can } from "@/lib/auth/can";
import { MATRIX_GROUPS, grantCount, roleDelta, staffCapabilities, staffMatrix } from "@/lib/staff/matrix";
import { hasMessage } from "@/lib/i18n";

/**
 * Board 4i `B5` and criterion 5 — the matrix the staff screen draws is the table
 * every console gate reads. These pin the three properties that make that true.
 */

describe("the drawn matrix is the capability table", () => {
  it("names every capability some staff role holds, exactly once", () => {
    const grouped = MATRIX_GROUPS.flatMap((group) => [...group.capabilities]);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual(staffCapabilities().sort());
  });

  it("draws a tick exactly where can() grants", () => {
    for (const group of staffMatrix()) {
      for (const row of group.rows) {
        for (const [role, granted] of Object.entries(row.grants)) {
          expect(can({ id: "x", roles: [role as never] }, row.capability), `${row.capability} × ${role}`).toBe(
            granted,
          );
        }
      }
    }
  });

  it("has a label for every row and every group", () => {
    for (const group of staffMatrix()) {
      expect(hasMessage(`admin.staff.matrix_group.${group.key}`)).toBe(true);
      for (const row of group.rows) expect(hasMessage(`staff.capability.${row.capability}`)).toBe(true);
    }
  });
});

describe("the grants board 4i says are worth preserving", () => {
  const holders = (capability: Capability) => [...CAPABILITIES[capability].roles];

  it("B2 — only ops lead writes the verification tier", () => {
    expect(holders("business.verification_tier.write")).toEqual(["staff_ops_lead"]);
  });

  it("finance can move money and cannot moderate anything", () => {
    expect(holders("subscription.credit")).toEqual(["staff_finance"]);
    const finance = { id: "f", roles: ["staff_finance" as const] };
    for (const capability of [
      "queue.decide",
      "report.resolve",
      "review.hold",
      "review.remove",
      "claim.resolve",
      "business.suspend",
    ] as const) {
      expect(can(finance, capability), capability).toBe(false);
    }
  });

  it("moderator is narrow on purpose", () => {
    const moderator = { id: "m", roles: ["staff_moderator" as const] };
    expect(can(moderator, "queue.decide")).toBe(true);
    for (const capability of [
      "review.remove",
      "claim.resolve",
      "business.suspend",
      "taxonomy.write",
      "staff.manage",
      "subscription.credit",
    ] as const) {
      expect(can(moderator, capability), capability).toBe(false);
    }
  });

  it("every staff seat reads the roster; only ops lead manages it", () => {
    expect(holders("staff.read").sort()).toEqual(["staff_finance", "staff_moderator", "staff_ops_lead"]);
    expect(holders("staff.manage")).toEqual(["staff_ops_lead"]);
  });
});

describe("what a change of role does", () => {
  it("moderator to finance gains credits and loses the queue", () => {
    const { gains, loses } = roleDelta("staff_moderator", "staff_finance");
    expect(gains).toContain("subscription.credit");
    expect(loses).toContain("queue.decide");
    expect(gains).not.toContain("staff.read");
    expect(loses).not.toContain("staff.read");
  });

  it("deactivation loses everything the role held", () => {
    expect(roleDelta("staff_finance", null).loses).toHaveLength(grantCount("staff_finance"));
  });
});
