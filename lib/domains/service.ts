import "server-only";
import { prisma } from "@/lib/db/client";
import { assertCanManageBilling } from "@/lib/auth/guards";
import type { Actor } from "@/lib/auth/roles";
import { effectiveFor } from "@/lib/billing/entitlements-service";
import { checkLabel, hostnameFor, labelFor, SUBDOMAIN_ZONE, type LabelRefusal } from "./label";

/**
 * Board 5e — a seller's own web address.
 *
 * A Pro entitlement. `Plan.customDomain` has been a real boolean since handoff
 * 3 with nothing behind it, and the pricing page has been selling "your own web
 * address" at AED 899 the whole time. This is the thing it was selling.
 *
 * The entitlement is read from the subscription's snapshot rather than the plan
 * row, so a seller who signed up when Basic included it keeps it — which is
 * what grandfathering is for and why the snapshot carries caps.
 *
 * ## What this used to be
 *
 * It was written for a domain the seller owns and points at us: a CNAME, a TXT
 * record with a random token, per-record propagation states, a 24-hour give-up
 * clock, five named failure causes, an hourly DNS poll and a certificate we had
 * no provider to issue. Half of it was `live: false` ports refusing honestly,
 * because the two things it needed — a Vercel domains token and a provisioned
 * `stores.businesslistings.me` — were never going to arrive.
 *
 * On 9 Sep 2026 the product changed: a seller gets a label under our own zone.
 * `indus-hydraulics` becomes `indushydraulics.businesslistings.me`. We own the
 * zone, so there is nothing for anyone to verify, nothing to poll, and one
 * wildcard certificate covers every seller who will ever have one.
 *
 * All of that machinery is gone rather than kept for a bring-your-own-domain
 * that may never come back. The precedent is this project's own: the site-visit
 * rung and the trade-references rung were deleted rather than reserved, on the
 * grounds that a thing nobody performs means whatever somebody decides on the
 * day they find it.
 *
 * ## What it is not
 *
 * It is not a second identity. The label is derived from the slug, so there is
 * no name to moderate, nothing to squat, and nothing that can drift away from
 * `displayName`. `lib/domains/label.ts` holds those rules, and holds them
 * separately because `proxy.ts` has to apply them at the edge with no database
 * to ask.
 */

export { SUBDOMAIN_ZONE };

export type ClaimRefusal = LabelRefusal | "not_entitled" | "taken" | "already_have_one";

export interface SubdomainView {
  /** The label alone, which is the part a seller chose nothing about. */
  label: string;
  /** The whole address, which is what they read out. */
  hostname: string;
  claimedAt: Date;
}

function viewOf(row: { hostname: string; addedAt: Date }): SubdomainView {
  return {
    label: row.hostname.split(".")[0] ?? row.hostname,
    hostname: row.hostname,
    claimedAt: row.addedAt,
  };
}

/** The address this business holds, or null where it holds none. */
export async function subdomainFor(businessId: string): Promise<SubdomainView | null> {
  const row = await prisma.customDomain.findUnique({
    where: { businessId },
    select: { hostname: true, addedAt: true },
  });
  return row ? viewOf(row) : null;
}

/**
 * The address a business would be given, before it asks for one.
 *
 * The screen shows this so a seller can see what they are about to get rather
 * than agreeing to a surprise, and it is the same computation `claimSubdomain`
 * runs — one function, so the preview cannot promise an address the claim then
 * refuses.
 */
export async function proposedFor(
  businessId: string,
): Promise<{ label: string; hostname: string; refusal: ClaimRefusal | null }> {
  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { slug: true },
  });
  const label = labelFor(business.slug);
  const refusal = await refusalFor(businessId, label);
  return { label, hostname: hostnameFor(label), refusal };
}

async function refusalFor(businessId: string, label: string): Promise<ClaimRefusal | null> {
  const bad = checkLabel(label);
  if (bad) return bad;

  const [existing, taken] = await Promise.all([
    prisma.customDomain.findUnique({ where: { businessId }, select: { id: true } }),
    prisma.customDomain.findUnique({
      where: { hostname: hostnameFor(label) },
      select: { businessId: true },
    }),
  ]);
  if (existing) return "already_have_one";
  // `labelFor` is lossy — `indus-hydraulics` and `indushydraulics` flatten to
  // the same label — so a collision is possible and is refused rather than
  // resolved with a suffix. A supplier handed a near-miss of the address they
  // were shown would print the one they were shown.
  if (taken) return "taken";
  return null;
}

export type ClaimResult =
  | { ok: true; subdomain: SubdomainView }
  | { ok: false; error: ClaimRefusal };

/**
 * Take the address.
 *
 * Nothing to verify and nothing to wait for: the zone is ours, the wildcard
 * record already answers, and `proxy.ts` serves the storefront from the moment
 * the row exists. A seller who claims one can read it out on the phone the same
 * minute, which is the difference this model makes.
 */
export async function claimSubdomain(actor: Actor, businessId: string): Promise<ClaimResult> {
  assertCanManageBilling(actor);
  if (actor.businessId !== businessId) return { ok: false, error: "not_entitled" };

  const caps = await effectiveFor(businessId);
  // Read from the snapshot, so a seller grandfathered on a plan that included
  // it keeps it even after the plan changed.
  if (!caps?.customDomain) return { ok: false, error: "not_entitled" };

  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { slug: true },
  });
  const label = labelFor(business.slug);

  const refusal = await refusalFor(businessId, label);
  if (refusal) return { ok: false, error: refusal };

  const hostname = hostnameFor(label);
  await prisma.customDomain.create({
    data: {
      businessId,
      hostname,
      /*
         The columns the DNS model needed and this one does not.

         `token` is `NOT NULL` and there is no longer anything to put in it, so
         it is written empty rather than given a plausible-looking secret that
         verifies nothing. `status` goes straight to `verified` because there is
         no state between asking and having. All four come out with the model
         rename, in the migration that follows this change.
      */
      token: "",
      status: "verified",
      verifiedAt: new Date(),
    },
  });

  return { ok: true, subdomain: (await subdomainFor(businessId))! };
}

/**
 * Give it up.
 *
 * The address stops resolving immediately — `proxy.ts` rewrites to `/b/<label>`
 * and the storefront resolver finds nothing, so the host 404s. The storefront
 * itself is untouched: it was always at `/b/<slug>` and that is where its
 * canonical always pointed, which is the whole reason the canonical decision
 * went the way it did.
 */
export async function releaseSubdomain(
  actor: Actor,
  businessId: string,
): Promise<{ ok: boolean }> {
  assertCanManageBilling(actor);
  if (actor.businessId !== businessId) return { ok: false };

  await prisma.customDomain.deleteMany({ where: { businessId } });
  return { ok: true };
}
