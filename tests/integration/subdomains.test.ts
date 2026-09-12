import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { claimSubdomain, proposedFor, releaseSubdomain, subdomainFor } from "@/lib/domains/service";
import { hostnameFor, labelFor } from "@/lib/domains/label";
import { getBusinessBySlug } from "@/lib/db/queries/business";
import { PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";

/**
 * Board 5e — a seller's own web address, second model.
 *
 * The file this replaces tested DNS: two records, per-record propagation, a
 * give-up clock and five failure causes. A label under our own zone has none of
 * that, and what is left to prove is smaller and more load-bearing:
 *
 *   - the entitlement holds, and holds through a snapshot rather than a plan row
 *   - the derivation is lossy, so a collision is refused rather than fudged
 *   - **the storefront actually answers on the label**, which is the whole
 *     feature and the half the previous model never reached — `businessForHostname`
 *     had no production caller for as long as it existed
 */

const actor = (id: string, businessId: string, ...roles: Role[]): Actor => ({
  id,
  roles,
  businessId,
});

let categoryId: string;
let proPlanId: string;
let freePlanId: string;
const madeBusinesses: string[] = [];
const madePlans: string[] = [];
let seq = 0;
const stamp = () => `${Date.now().toString(36)}${(seq += 1)}`;

async function makePlan(customDomain: boolean): Promise<string> {
  const id = `subdomain-test-${customDomain ? "pro" : "free"}-${stamp()}`;
  await prisma.plan.create({
    data: {
      id,
      name: `Subdomain fixture ${customDomain ? "with" : "without"}`,
      monthlyPriceAed: customDomain ? 899 : 0,
      teamSeats: 1,
      customDomain,
      sortOrder: 950,
    },
  });
  madePlans.push(id);
  return id;
}

async function makeSeller(planId: string, slug: string): Promise<{ id: string; slug: string }> {
  const business = await prisma.business.create({
    data: {
      displayName: slug,
      tradeName: `${slug} LLC`,
      slug,
      licenceNumber: `DED-S${stamp().slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
      primaryCategoryId: categoryId,
      claimStatus: "claimed",
      planId,
      publishedAt: new Date(),
      verificationTier: 2,
      verifiedAt: new Date(),
    },
    select: { id: true, slug: true },
  });
  madeBusinesses.push(business.id);
  return business;
}

beforeAll(async () => {
  const category = await prisma.category.findFirstOrThrow({
    where: { slug: "valves-and-fittings" },
    select: { id: true },
  });
  categoryId = category.id;
  proPlanId = await makePlan(true);
  freePlanId = await makePlan(false);
});

afterAll(async () => {
  for (const businessId of madeBusinesses.splice(0)) {
    await prisma.customDomain.deleteMany({ where: { businessId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
  }
  for (const id of madePlans.splice(0)) {
    await prisma.plan.deleteMany({ where: { id } });
  }
  await prisma.$disconnect();
});

describe("who may take an address", () => {
  it("gives one to a seller whose plan includes it", async () => {
    const business = await makeSeller(proPlanId, `indus-hydraulics-${stamp()}`);
    const result = await claimSubdomain(actor("u1", business.id, "seller_owner"), business.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The hyphens are gone, because the address is read aloud and typed.
    expect(result.subdomain.label).toBe(labelFor(business.slug));
    expect(result.subdomain.label).not.toContain("-");
    expect(result.subdomain.hostname).toBe(hostnameFor(labelFor(business.slug)));
  }, 30_000);

  it("refuses a seller whose plan does not", async () => {
    const business = await makeSeller(freePlanId, `al-bariq-${stamp()}`);
    const result = await claimSubdomain(actor("u2", business.id, "seller_owner"), business.id);
    expect(result).toMatchObject({ ok: false, error: "not_entitled" });
    expect(await subdomainFor(business.id)).toBeNull();
  }, 30_000);

  it("keeps it for a seller grandfathered by their snapshot", async () => {
    // The entitlement is read through `effectiveFor`, so what the seller bought
    // outlives a change to the plan they bought it on.
    const business = await makeSeller(freePlanId, `grandfathered-${stamp()}`);
    await prisma.subscription.create({
      data: {
        businessId: business.id,
        planId: freePlanId,
        status: "active",
        startedAt: new Date(),
        renewsAt: new Date(Date.now() + 30 * 86_400_000),
        entitlementSnapshot: {
          planId: freePlanId,
          capturedAt: new Date().toISOString(),
          teamSeats: 1,
          enquiriesPerMonth: null,
          productLimit: null,
          serviceLimit: null,
          locationLimit: null,
          photoLimit: null,
          customDomain: true,
        } as unknown as object,
      },
    });

    const result = await claimSubdomain(actor("u3", business.id, "seller_owner"), business.id);
    expect(result.ok).toBe(true);
  }, 30_000);

  it("refuses a seat that may not manage billing", async () => {
    const business = await makeSeller(proPlanId, `sales-seat-${stamp()}`);
    await expect(
      claimSubdomain(actor("u4", business.id, "seller_sales"), business.id),
    ).rejects.toBeInstanceOf(PermissionError);
  }, 30_000);

  it("refuses an owner claiming for somebody else's business", async () => {
    const mine = await makeSeller(proPlanId, `mine-${stamp()}`);
    const theirs = await makeSeller(proPlanId, `theirs-${stamp()}`);
    const result = await claimSubdomain(actor("u5", mine.id, "seller_owner"), theirs.id);
    expect(result).toMatchObject({ ok: false, error: "not_entitled" });
    expect(await subdomainFor(theirs.id)).toBeNull();
  }, 30_000);
});

describe("the derivation is lossy, and says so rather than fudging it", () => {
  it("refuses the second business whose slug flattens to a label already taken", async () => {
    const mark = stamp();
    const first = await makeSeller(proPlanId, `flatten-${mark}`);
    // Different slug, same label once the hyphens come out.
    const second = await makeSeller(proPlanId, `flatten${mark}`);
    expect(labelFor(first.slug)).toBe(labelFor(second.slug));

    expect(await claimSubdomain(actor("u6", first.id, "seller_owner"), first.id)).toMatchObject({
      ok: true,
    });
    const result = await claimSubdomain(actor("u7", second.id, "seller_owner"), second.id);
    // Refused, not given a suffix. A supplier handed a near-miss of the address
    // they were shown would print the one they were shown.
    expect(result).toMatchObject({ ok: false, error: "taken" });
  }, 30_000);

  it("shows the same refusal before the button that the claim would return", async () => {
    const mark = stamp();
    const first = await makeSeller(proPlanId, `preview-${mark}`);
    const second = await makeSeller(proPlanId, `preview${mark}`);
    await claimSubdomain(actor("u8", first.id, "seller_owner"), first.id);

    // One computation behind both, so the screen cannot promise an address the
    // write then refuses.
    const proposed = await proposedFor(second.id);
    expect(proposed.refusal).toBe("taken");
    expect(proposed.hostname).toBe(hostnameFor(labelFor(second.slug)));
  }, 30_000);

  it("refuses a second address to a business that already holds one", async () => {
    const business = await makeSeller(proPlanId, `only-one-${stamp()}`);
    await claimSubdomain(actor("u9", business.id, "seller_owner"), business.id);
    const again = await claimSubdomain(actor("u9", business.id, "seller_owner"), business.id);
    expect(again).toMatchObject({ ok: false, error: "already_have_one" });
  }, 30_000);
});

describe("the storefront answers on the address", () => {
  it("resolves the label to the same business the slug resolves to", async () => {
    const business = await makeSeller(proPlanId, `resolves-me-${stamp()}`);
    const claimed = await claimSubdomain(actor("u10", business.id, "seller_owner"), business.id);
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;

    /*
       The whole feature, and the half the previous model never reached:
       `businessForHostname` existed, was tested, and had no production caller
       for as long as it lived. `proxy.ts` rewrites the host to `/b/<label>`,
       and this is the query that route runs.
    */
    const bySlug = await getBusinessBySlug(business.slug);
    const byLabel = await getBusinessBySlug(claimed.subdomain.label);
    expect(bySlug?.id).toBe(business.id);
    expect(byLabel?.id).toBe(business.id);
  }, 30_000);

  it("stops answering the moment the address is given up", async () => {
    const business = await makeSeller(proPlanId, `given-up-${stamp()}`);
    const claimed = await claimSubdomain(actor("u11", business.id, "seller_owner"), business.id);
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    const { label } = claimed.subdomain;

    await releaseSubdomain(actor("u11", business.id, "seller_owner"), business.id);

    expect(await getBusinessBySlug(label)).toBeNull();
    // And the storefront is untouched, which is the reason the canonical points
    // at the slug rather than at the address.
    expect((await getBusinessBySlug(business.slug))?.id).toBe(business.id);
  }, 30_000);

  it("does not answer for a label nobody has taken", async () => {
    expect(await getBusinessBySlug(`unclaimed${stamp()}`)).toBeNull();
  }, 30_000);
});
