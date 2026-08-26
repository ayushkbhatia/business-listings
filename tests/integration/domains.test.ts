import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { addDomain, domainFor, pollDomains, removeDomain, businessForHostname, DOMAIN_TARGET } from "@/lib/domains/service";
import { consoleIssuer, setCertificateIssuer, setDnsResolver, type CertificateIssuer, type DnsResolver } from "@/lib/domains/ports";
import { VERIFY_PREFIX } from "@/lib/domains/state";
import type { Actor } from "@/lib/auth/roles";

/**
 * Criterion 8, against a real database.
 *
 *   "Domain verification shows per-record status, handles partial propagation
 *    without reading as failure, issues a certificate on both records
 *    resolving, and handles the revoked case by continuing to serve the
 *    platform URL."
 *
 * The third clause is the one that cannot be finished here: there is no
 * certificate provider, so what is asserted is that the flow reaches the point
 * of asking and says plainly that nothing was issued. A test that pretended
 * otherwise would be the failure the port exists to prevent.
 */

let businessId: string;
let actor: Actor;
let originalPlanId: string | null;

/** DNS as this test says it is. */
const zone = new Map<string, { cname?: string; txt?: string[] }>();
const fakeResolver: DnsResolver = {
  name: "test",
  async cname(hostname) {
    return zone.get(hostname)?.cname ?? null;
  },
  async txt(hostname) {
    const label = hostname.split(".")[0] ?? hostname;
    const rest = hostname.split(".").slice(1).join(".");
    return zone.get(`${VERIFY_PREFIX}.${label}.${rest}`)?.txt ?? [];
  },
};

beforeAll(async () => {
  const business = await prisma.business.findFirstOrThrow({
    where: { claimStatus: "claimed", team: { some: { roles: { has: "seller_owner" } } } },
    select: {
      id: true,
      planId: true,
      team: { where: { roles: { has: "seller_owner" } }, select: { id: true, roles: true }, take: 1 },
    },
  });
  businessId = business.id;
  originalPlanId = business.planId;
  const owner = business.team[0]!;
  actor = { id: owner.id, roles: owner.roles, businessId };

  // Custom domains are a Pro entitlement, and the snapshot is what is read.
  await prisma.business.update({ where: { id: businessId }, data: { planId: "pro" } });
  await prisma.subscription.deleteMany({ where: { businessId } });

  setDnsResolver(fakeResolver);
});

afterEach(async () => {
  await prisma.customDomain.deleteMany({ where: { businessId } });
  zone.clear();
  setCertificateIssuer(consoleIssuer);
});

afterAll(async () => {
  await prisma.business.update({ where: { id: businessId }, data: { planId: originalPlanId } });
  await prisma.$disconnect();
});

async function claim(hostname = "shop.alwaha.ae") {
  const result = await addDomain(actor, businessId, hostname);
  if (!result.ok) throw new Error(`fixture failed: ${result.error}`);
  return result.domain;
}

/** Put both records in the fake zone, exactly as the seller was told to. */
function publishRecords(domain: { records: { type: string; name: string; value: string }[] }, hostname = "shop.alwaha.ae") {
  const zoneName = hostname.split(".").slice(1).join(".");
  for (const record of domain.records) {
    const fqdn = `${record.name}.${zoneName}`;
    const entry = zone.get(fqdn) ?? {};
    if (record.type === "CNAME") entry.cname = record.value;
    else entry.txt = [record.value];
    zone.set(fqdn, entry);
  }
}

describe("claiming a hostname", () => {
  it("gives the two records, with the label rather than the whole name", async () => {
    const domain = await claim();
    expect(domain.records).toHaveLength(2);
    expect(domain.records[0]).toMatchObject({ type: "CNAME", name: "shop", value: DOMAIN_TARGET });
    expect(domain.records[1]!.name).toBe(`${VERIFY_PREFIX}.shop`);
    expect(domain.status).toBe("pending");
  }, 60_000);

  it("refuses an apex domain", async () => {
    const result = await addDomain(actor, businessId, "alwaha.ae");
    expect(result).toMatchObject({ ok: false, error: "apex_domain" });
  }, 60_000);

  it("refuses a hostname another seller already has", async () => {
    await claim();
    const other = await prisma.business.findFirstOrThrow({
      where: { id: { not: businessId } },
      select: { id: true },
    });
    await prisma.customDomain.create({
      data: { businessId: other.id, hostname: "taken.alwaha.ae", token: "x" },
    });
    await prisma.customDomain.deleteMany({ where: { businessId } });

    const result = await addDomain(actor, businessId, "taken.alwaha.ae");
    expect(result).toMatchObject({ ok: false, error: "taken" });
    await prisma.customDomain.deleteMany({ where: { businessId: other.id } });
  }, 60_000);

  it("refuses a seller whose plan does not include it", async () => {
    await prisma.business.update({ where: { id: businessId }, data: { planId: "free" } });
    const result = await addDomain(actor, businessId, "shop.alwaha.ae");
    expect(result).toMatchObject({ ok: false, error: "not_entitled" });
    await prisma.business.update({ where: { id: businessId }, data: { planId: "pro" } });
  }, 60_000);
});

describe("criterion 8 — the states, in order", () => {
  it("stays pending while nothing has propagated", async () => {
    await claim();
    await pollDomains();
    const domain = await domainFor(businessId);
    expect(domain).toMatchObject({ status: "pending", cnameState: "waiting", txtState: "waiting" });
  }, 60_000);

  it("reads one record up and one not as partial, never as failure", async () => {
    /*
     * The clause that decides whether this flow is usable. A seller who added
     * both records at once will often see one resolve first, and an error
     * screen sends them back to undo work that was correct.
     */
    const domain = await claim();
    zone.set("shop.alwaha.ae", { cname: DOMAIN_TARGET });

    await pollDomains();
    const after = await domainFor(businessId);
    expect(after).toMatchObject({ status: "partial", cnameState: "found", txtState: "waiting" });
    expect(after!.failureCause).toBeNull();
    void domain;
  }, 60_000);

  it("verifies when both resolve, and says the certificate is not issued", async () => {
    const domain = await claim();
    publishRecords(domain);

    await pollDomains();
    const after = await domainFor(businessId);
    expect(after!.status).toBe("verified");
    expect(after!.verifiedAt).not.toBeNull();

    // There is no certificate provider. The flow reaches the point of asking
    // and says so rather than showing a padlock that means nothing.
    expect(after!.certificateLive).toBe(false);
    expect(after!.certificateRef).toBeNull();
  }, 60_000);

  it("asks a live issuer, and records what it gets back", async () => {
    const issued: string[] = [];
    const fakeIssuer: CertificateIssuer = {
      name: "test",
      live: true,
      async issue(hostname) {
        issued.push(hostname);
        return { ok: true, reference: `cert_${hostname}` };
      },
      async revoke() {
        return { ok: true };
      },
    };
    setCertificateIssuer(fakeIssuer);

    const domain = await claim();
    publishRecords(domain);
    await pollDomains();

    const after = await domainFor(businessId);
    expect(issued).toEqual(["shop.alwaha.ae"]);
    expect(after!.certificateRef).toBe("cert_shop.alwaha.ae");

    // And it is asked once, not on every poll.
    await pollDomains();
    expect(issued).toHaveLength(1);
  }, 60_000);

  it("names a likely cause after a day, rather than saying DNS failed", async () => {
    const domain = await claim();
    zone.set("shop.alwaha.ae", { cname: DOMAIN_TARGET });
    await prisma.customDomain.update({
      where: { businessId },
      data: { addedAt: new Date(Date.now() - 30 * 3_600_000) },
    });

    await pollDomains();
    const after = await domainFor(businessId);
    expect(after!.status).toBe("failed");
    expect(after!.failureCause).toBe("cname_only");
    void domain;
  }, 60_000);

  it("tells a wrong CNAME from a missing one", async () => {
    await claim();
    zone.set("shop.alwaha.ae", { cname: "some-other-host.example.com" });
    await prisma.customDomain.update({
      where: { businessId },
      data: { addedAt: new Date(Date.now() - 30 * 3_600_000) },
    });

    await pollDomains();
    const after = await domainFor(businessId);
    expect(after!.cnameState).toBe("wrong_value");
    expect(after!.failureCause).toBe("cname_points_elsewhere");
  }, 60_000);
});

describe("criterion 8 — a domain that stops resolving", () => {
  it("goes to revoked, and the platform URL keeps serving", async () => {
    const domain = await claim();
    publishRecords(domain);
    await pollDomains();
    expect((await domainFor(businessId))!.status).toBe("verified");

    // The seller changes registrar and the records go.
    zone.clear();
    await pollDomains();

    const after = await domainFor(businessId);
    expect(after!.status).toBe("revoked");
    // Never `failed`. They did the setup correctly once.
    expect(after!.failureCause).toBeNull();

    // The storefront is still there under its own address.
    const business = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { slug: true, publishedAt: true },
    });
    expect(business.publishedAt).not.toBeNull();
    expect(await businessForHostname("shop.alwaha.ae")).toBeNull();
  }, 120_000);

  it("comes back on its own when the records return", async () => {
    const domain = await claim();
    publishRecords(domain);
    await pollDomains();
    zone.clear();
    await pollDomains();
    expect((await domainFor(businessId))!.status).toBe("revoked");

    publishRecords(domain);
    await pollDomains();
    expect((await domainFor(businessId))!.status).toBe("verified");
  }, 120_000);
});

describe("what a custom hostname serves", () => {
  it("serves nothing until it is verified", async () => {
    await claim();
    expect(await businessForHostname("shop.alwaha.ae")).toBeNull();
  }, 60_000);

  it("serves the storefront once it is", async () => {
    const domain = await claim();
    publishRecords(domain);
    await pollDomains();

    const business = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { slug: true },
    });
    expect(await businessForHostname("shop.alwaha.ae")).toBe(business.slug);
  }, 60_000);

  it("takes the hostname as somebody would type it", async () => {
    const domain = await claim();
    publishRecords(domain);
    await pollDomains();
    const business = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { slug: true },
    });
    expect(await businessForHostname("Shop.AlWaha.ae.")).toBe(business.slug);
  }, 60_000);
});

describe("giving it up", () => {
  it("revokes the certificate it asked for", async () => {
    const revoked: string[] = [];
    setCertificateIssuer({
      name: "test",
      live: true,
      async issue(hostname) {
        return { ok: true, reference: `cert_${hostname}` };
      },
      async revoke(reference) {
        revoked.push(reference);
        return { ok: true };
      },
    });

    const domain = await claim();
    publishRecords(domain);
    await pollDomains();
    await removeDomain(actor, businessId);

    expect(revoked).toEqual(["cert_shop.alwaha.ae"]);
    expect(await domainFor(businessId)).toBeNull();
  }, 60_000);
});
