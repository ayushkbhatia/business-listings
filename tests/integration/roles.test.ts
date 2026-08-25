import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { PermissionError } from "@/lib/auth/errors";
import { cancelSubscription, changePlan, invoicesFor, quotePlanChange } from "@/lib/billing/service";
import { requestModeratedChange, saveProfile } from "@/lib/listing/service";
import { applyImport } from "@/lib/import/service";
import type { Actor } from "@/lib/auth/roles";

/**
 * Handoff 3 criterion 9, against a real database.
 *
 *   "A `sales` role user is rejected server-side from billing, plan and licence
 *    mutations."
 *
 * This is the only criterion in the handoff that is a claim about what the code
 * *refuses* to do, and those are the ones that pass by accident. A screen that
 * simply does not render a button passes a manual check and fails the moment
 * somebody posts the form directly, which is exactly what an unhappy employee
 * with a sales seat would do.
 *
 * So every assertion here calls the service, not a page. `assertCan*` is the
 * first line of each mutation on purpose — a check further down is a check some
 * future early return can skip.
 */

const SLUG = "al-marwan-industrial-supplies-llc";

let businessId: string;
let owner: Actor;
let sales: Actor;
let manager: Actor;
let finance: Actor;

beforeAll(async () => {
  const business = await prisma.business.findUniqueOrThrow({
    where: { slug: SLUG },
    select: {
      id: true,
      team: { where: { roles: { has: "seller_owner" } }, select: { id: true, roles: true }, take: 1 },
    },
  });
  businessId = business.id;
  const ownerRow = business.team[0]!;
  owner = { id: ownerRow.id, roles: ownerRow.roles, businessId };

  // Real actors, differing only in their roles. Nothing here is a mock: the
  // capability check reads `actor.roles`, so this is the production path.
  sales = { id: ownerRow.id, roles: ["seller_sales"], businessId };
  manager = { id: ownerRow.id, roles: ["seller_manager"], businessId };
  finance = { id: ownerRow.id, roles: ["seller_finance"], businessId };
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("criterion 9 — a sales seat is refused, server-side", () => {
  it("cannot read a plan-change quote", async () => {
    await expect(quotePlanChange(sales, businessId, "pro")).rejects.toThrow(PermissionError);
  });

  it("cannot change the plan", async () => {
    await expect(changePlan(sales, businessId, "pro")).rejects.toThrow(PermissionError);
  });

  it("cannot cancel the subscription", async () => {
    await expect(cancelSubscription(sales, businessId)).rejects.toThrow(PermissionError);
  });

  it("cannot read invoices", async () => {
    await expect(invoicesFor(sales, businessId)).rejects.toThrow(PermissionError);
  });

  it("cannot submit a licence change", async () => {
    await expect(
      requestModeratedChange(sales, businessId, "licence", "DED-000111"),
    ).rejects.toThrow(PermissionError);
  });

  it("cannot submit a trade name or category change either", async () => {
    // The criterion names licence. The other two moderated fields are the same
    // kind of act and go through the same guard.
    await expect(
      requestModeratedChange(sales, businessId, "trade_name", "Something Else LLC"),
    ).rejects.toThrow(PermissionError);
    await expect(
      requestModeratedChange(sales, businessId, "primary_category", "whatever"),
    ).rejects.toThrow(PermissionError);
  });

  it("cannot edit the listing profile", async () => {
    await expect(saveProfile(sales, businessId, { description: "hello" })).rejects.toThrow(
      PermissionError,
    );
  });

  it("cannot import a catalogue", async () => {
    await expect(
      applyImport(sales, {
        businessId,
        categoryId: "anything",
        filename: "x.csv",
        text: "Item\nValve\n",
        plan: { columns: [{ header: "Item", target: { kind: "name" } }] },
      }),
    ).rejects.toThrow(PermissionError);
  });

  it("refuses before reading anything, not after", async () => {
    // A guard that runs after the first query is a guard that has already
    // leaked whether a record exists. This asks for a business that is not the
    // actor's, and still gets the permission error rather than "not found".
    await expect(quotePlanChange(sales, "some-other-business", "pro")).rejects.toThrow(
      PermissionError,
    );
  });
});

describe("criterion 9 — the seats that should be allowed still are", () => {
  it("lets the owner quote a plan change", async () => {
    const result = await quotePlanChange(owner, businessId, "basic");
    expect(result.ok).toBe(true);
  });

  it("lets the finance seat read invoices, and not change the plan", async () => {
    /*
     * The finance seat exists so the owner does not have to hold the card —
     * and §07 stops there. "See invoices & billing" is owner and finance;
     * "Change plan or cancel" is owner alone. This asserted finance could do
     * both, by analogy with billing.manage, and the matrix separates them: a
     * finance seat reads what was spent and does not decide what to buy.
     */
    await expect(invoicesFor(finance, businessId)).resolves.toBeInstanceOf(Array);
    await expect(quotePlanChange(finance, businessId, "basic")).rejects.toThrow(PermissionError);
  });

  it("lets the manager edit the listing but not the plan", async () => {
    // The split the matrix draws: a manager shapes the public profile and does
    // not hold the card.
    await expect(saveProfile(manager, businessId, {})).resolves.toEqual({ ok: true });
    await expect(quotePlanChange(manager, businessId, "pro")).rejects.toThrow(PermissionError);
  });

  it("does not let the finance seat edit the listing", async () => {
    await expect(saveProfile(finance, businessId, { description: "no" })).rejects.toThrow(
      PermissionError,
    );
  });
});

describe("criterion 9 — the matrix says the same thing as the guards", () => {
  it("excludes sales from every capability the criterion names", async () => {
    const { can } = await import("@/lib/auth/can");
    for (const capability of ["billing.manage", "plan.change", "listing.edit"] as const) {
      expect(can(sales, capability), capability).toBe(false);
    }
  });

  it("keeps sales able to do the job the seat exists for", async () => {
    const { can } = await import("@/lib/auth/can");
    // A sales seat replies and quotes. Taking that away would make the seat
    // pointless, and the criterion is about billing, not about muzzling them.
    expect(can(sales, "enquiry.respond")).toBe(true);
    expect(can(sales, "quote.send")).toBe(true);
  });
});
