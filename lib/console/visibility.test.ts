import { describe, expect, it } from "vitest";
import { mayOpen } from "./visibility";
import type { Actor } from "@/lib/auth/roles";

/**
 * The overview links every figure to the screen that fixes it, and §07 does not
 * give every seat every screen. A number linking into a 404 is what happens
 * when the two lists are kept separately — which they were, until the revenue
 * screens made `/admin/dunning` real and finance-only.
 */

const actor = (...roles: Actor["roles"]): Actor => ({ id: "u1", roles });

describe("what a seat may open from the overview", () => {
  it("keeps the money screens away from an ops lead", () => {
    // `revenue.read` and `subscription.credit` are both finance in §07.
    const opsLead = actor("staff_ops_lead");
    expect(mayOpen(opsLead, "revenue")).toBe(false);
    expect(mayOpen(opsLead, "dunning")).toBe(false);
    expect(mayOpen(opsLead, "invoices")).toBe(false);
  });

  it("gives finance the money screens and not the moderation queues", () => {
    const finance = actor("staff_finance");
    expect(mayOpen(finance, "revenue")).toBe(true);
    expect(mayOpen(finance, "invoices")).toBe(true);
    expect(mayOpen(finance, "queue")).toBe(false);
    expect(mayOpen(finance, "reports")).toBe(false);
  });

  it("gives a moderator the queues and the CRM", () => {
    const moderator = actor("staff_moderator");
    expect(mayOpen(moderator, "queue")).toBe(true);
    expect(mayOpen(moderator, "reports")).toBe(true);
    expect(mayOpen(moderator, "crm")).toBe(true);
    expect(mayOpen(moderator, "revenue")).toBe(false);
  });

  it("opens a screen nothing gates to every seat", () => {
    // The overview itself, `/admin/businesses` and `/admin/quotes`.
    for (const seat of [actor("staff_ops_lead"), actor("staff_moderator"), actor("staff_finance")]) {
      expect(mayOpen(seat, "admin")).toBe(true);
      expect(mayOpen(seat, "businesses")).toBe(true);
    }
  });
});
