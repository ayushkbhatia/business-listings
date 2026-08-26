import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { assertCanManageBilling } from "@/lib/auth/guards";
import type { Actor } from "@/lib/auth/roles";
import { effectiveFor } from "@/lib/billing/entitlements-service";
import { certificateIssuer, checkRecords, dnsResolver } from "./ports";
import {
  checkHostname,
  domainState,
  normaliseHostname,
  recordsFor,
  type DnsRecord,
  type DomainStatus,
  type FailureCause,
  type HostnameRefusal,
} from "./state";

/**
 * Board 5e — custom domains.
 *
 * A Pro entitlement. `Plan.customDomain` has been a real boolean since handoff
 * 3 with nothing behind it, and the pricing page has been selling "your own web
 * address" at AED 899 the whole time. This is the thing it was selling.
 *
 * The entitlement is read from the subscription's snapshot rather than the plan
 * row, so a seller who signed up when Basic included it keeps it — which is
 * what grandfathering is for and why the snapshot carries caps.
 */

/** Where a seller's CNAME points. Not a URL: it is a DNS name. */
export const DOMAIN_TARGET = process.env["NEXT_PUBLIC_DOMAIN_TARGET"] ?? "stores.businesslistings.me";

/** Our own domain, so a seller cannot point one of ours at another of ours. */
const OUR_DOMAIN = DOMAIN_TARGET.split(".").slice(-2).join(".");

export type AddRefusal = HostnameRefusal | "not_entitled" | "taken" | "already_have_one";

export interface DomainView {
  hostname: string;
  status: DomainStatus;
  cnameState: string;
  txtState: string;
  records: DnsRecord[];
  addedAt: Date;
  lastCheckedAt: Date | null;
  verifiedAt: Date | null;
  failureCause: FailureCause | null;
  /** False while no certificate provider is configured. */
  certificateLive: boolean;
  certificateRef: string | null;
}

export async function domainFor(businessId: string): Promise<DomainView | null> {
  const domain = await prisma.customDomain.findUnique({ where: { businessId } });
  if (!domain) return null;

  return {
    hostname: domain.hostname,
    status: domain.status,
    cnameState: domain.cnameState,
    txtState: domain.txtState,
    records: recordsFor(domain.hostname, domain.token, DOMAIN_TARGET),
    addedAt: domain.addedAt,
    lastCheckedAt: domain.lastCheckedAt,
    verifiedAt: domain.verifiedAt,
    failureCause: (domain.failureCause as FailureCause | null) ?? null,
    certificateLive: certificateIssuer().live,
    certificateRef: domain.certificateRef,
  };
}

export type AddResult = { ok: true; domain: DomainView } | { ok: false; error: AddRefusal };

/**
 * Claim a hostname.
 *
 * Does not check DNS. The seller has not been given the records yet, so there
 * is nothing to find — the first poll happens after they have somewhere to copy
 * them from.
 */
export async function addDomain(
  actor: Actor,
  businessId: string,
  input: string,
): Promise<AddResult> {
  assertCanManageBilling(actor);
  if (actor.businessId !== businessId) return { ok: false, error: "not_entitled" };

  const caps = await effectiveFor(businessId);
  // Read from the snapshot, so a seller grandfathered on a plan that included
  // it keeps it even after the plan changed.
  if (!caps?.customDomain) return { ok: false, error: "not_entitled" };

  const hostname = normaliseHostname(input);
  const refusal = checkHostname(hostname, OUR_DOMAIN);
  if (refusal) return { ok: false, error: refusal };

  const [existing, taken] = await Promise.all([
    prisma.customDomain.findUnique({ where: { businessId }, select: { id: true } }),
    prisma.customDomain.findUnique({ where: { hostname }, select: { businessId: true } }),
  ]);
  if (existing) return { ok: false, error: "already_have_one" };
  if (taken) return { ok: false, error: "taken" };

  await prisma.customDomain.create({
    data: {
      businessId,
      hostname,
      // 24 bytes of randomness. A token somebody can guess is a domain somebody
      // else can verify.
      token: randomBytes(24).toString("base64url"),
    },
  });

  return { ok: true, domain: (await domainFor(businessId))! };
}

export async function removeDomain(actor: Actor, businessId: string): Promise<{ ok: boolean }> {
  assertCanManageBilling(actor);
  if (actor.businessId !== businessId) return { ok: false };

  const domain = await prisma.customDomain.findUnique({
    where: { businessId },
    select: { certificateRef: true },
  });
  if (domain?.certificateRef) await certificateIssuer().revoke(domain.certificateRef);

  await prisma.customDomain.deleteMany({ where: { businessId } });
  return { ok: true };
}

export interface PollResult {
  checked: number;
  verified: number;
  revoked: number;
  failed: number;
  ranAt: Date;
}

const HOUR_MS = 3_600_000;

/**
 * The poller. Board 5e's third step, every sixty seconds.
 *
 * A verified domain is still checked — that is the only way `revoked` is ever
 * reached, and criterion 8 asks for it. A failed one is not: the cause has been
 * named and re-checking on a loop would keep overwriting it with the same
 * answer while the seller reads it.
 */
export async function pollDomains(now = new Date(), limit = 100): Promise<PollResult> {
  const due = await prisma.customDomain.findMany({
    where: { status: { in: ["pending", "partial", "verified", "revoked"] } },
    orderBy: [{ lastCheckedAt: { sort: "asc", nulls: "first" } }],
    take: limit,
  });

  const resolver = dnsResolver();
  const issuer = certificateIssuer();
  let verified = 0;
  let revoked = 0;
  let failed = 0;

  for (const domain of due) {
    const records = await checkRecords(resolver, domain.hostname, domain.token, DOMAIN_TARGET);
    const hours = (now.getTime() - domain.addedAt.getTime()) / HOUR_MS;
    const state = domainState(records, hours, domain.verifiedAt !== null);

    /*
     * The certificate is asked for once, when the records first both resolve.
     * With the console issuer this always fails and `certificateRef` stays
     * null, which is exactly what the screens read to say the records are
     * correct and nothing has been issued.
     */
    let certificateRef = domain.certificateRef;
    if (state.status === "verified" && !certificateRef && issuer.live) {
      const issued = await issuer.issue(domain.hostname);
      if (issued.ok) certificateRef = issued.reference ?? null;
    }

    await prisma.customDomain.update({
      where: { id: domain.id },
      data: {
        status: state.status,
        cnameState: records.cname,
        txtState: records.txt,
        lastCheckedAt: now,
        verifiedAt: state.status === "verified" ? (domain.verifiedAt ?? now) : domain.verifiedAt,
        failureCause: state.cause ?? null,
        certificateRef,
      },
    });

    if (state.status === "verified" && !domain.verifiedAt) verified += 1;
    if (state.status === "revoked" && domain.status !== "revoked") revoked += 1;
    if (state.status === "failed") failed += 1;
  }

  return { checked: due.length, verified, revoked, failed, ranAt: now };
}

/** Which business a request on a custom hostname belongs to. */
export async function businessForHostname(hostname: string): Promise<string | null> {
  const domain = await prisma.customDomain.findFirst({
    // Only a verified one serves. A pending domain that resolved early would
    // otherwise serve a storefront before we had confirmed it belongs to them.
    where: { hostname: normaliseHostname(hostname), status: "verified" },
    select: { business: { select: { slug: true } } },
  });
  return domain?.business.slug ?? null;
}
