import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import type { Actor } from "@/lib/auth/roles";
import type { ClaimResolution } from "@/lib/db/generated/client";
import { ageInDays } from "@/lib/moderation/service";

/**
 * Board 4c — two licences, one premises, similar names.
 *
 * The case the README singles out, and the one the step-1 checkpoint is about:
 * a conflicting claim must be resolvable four different ways. Not because four
 * is a tidy number, but because the four are genuinely different situations
 * that look identical in the queue:
 *
 *   - **award_to_a / award_to_b** — one of them is the licence holder and the
 *     other is a competitor, a former partner, or somebody who mistyped. The
 *     listing keeps its history and one person gets the keys.
 *   - **split_into_two** — two real companies at one address. Common in UAE
 *     industrial areas, where a warehouse is subdivided and two trade licences
 *     share a door. Both deserve a listing.
 *   - **merge_as_branches** — one company, two licences, which is what a
 *     mainland licence plus a free-zone licence looks like from outside. One
 *     listing, two locations.
 *
 * `claim.resolve` is **ops lead only** — §07, and the reason is in the outcome
 * list above: deciding who owns a listing is the most consequential thing staff
 * do to a business short of suspending it, and two of these four create or
 * restructure businesses.
 *
 * What a resolution must never do is destroy history. Reviews and enquiries
 * belong to the listing, not to whoever wins the argument about it, and a
 * seller's first fear when claiming is that claiming resets them. Every path
 * here keeps the original `Business` row and everything hanging off it.
 */

export interface ConflictSummary {
  id: string;
  businessId: string;
  buyersWaiting: number;
  createdAt: Date;
}

/**
 * Opens a conflict when a second undecided claim lands on a listing.
 *
 * Called from `submitClaim`, not from a screen. Handoff 3 takes a contested
 * submission and flags it; without this, noticing that two of them are a pair
 * was left to whoever read the queue carefully.
 *
 * Idempotent by way of the partial unique index — one open conflict per
 * business, so two claims arriving together cannot open two rows and let two
 * staff resolve the same dispute in opposite directions.
 */
export async function openConflictIfContested(businessId: string): Promise<string | null> {
  const open = await prisma.claimSubmission.findMany({
    where: { businessId, decidedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true },
    take: 2,
  });
  if (open.length < 2) return null;

  const existing = await prisma.claimConflict.findFirst({
    where: { businessId, resolvedAt: null },
    select: { id: true },
  });
  if (existing) return existing.id;

  const buyersWaiting = await prisma.enquiryRecipient.count({
    where: { businessId, state: { in: ["delivered", "opened"] } },
  });

  try {
    const created = await prisma.claimConflict.create({
      data: {
        businessId,
        submissionAId: open[0]!.id,
        submissionBId: open[1]!.id,
        buyersWaiting,
      },
      select: { id: true },
    });
    return created.id;
  } catch {
    // Lost the race against a concurrent claim. The other one opened it.
    const raced = await prisma.claimConflict.findFirst({
      where: { businessId, resolvedAt: null },
      select: { id: true },
    });
    return raced?.id ?? null;
  }
}

/** Everything board 4c puts in front of the decision. */
export async function conflictFor(conflictId: string) {
  const conflict = await prisma.claimConflict.findUnique({
    where: { id: conflictId },
    select: {
      id: true,
      businessId: true,
      resolution: true,
      resolvedAt: true,
      reason: true,
      buyersWaiting: true,
      createdAt: true,
      business: {
        select: {
          id: true,
          displayName: true,
          tradeName: true,
          slug: true,
          licenceNumber: true,
          licenceAuthority: true,
          claimStatus: true,
          primaryCategoryId: true,
          publishedAt: true,
          locations: { select: { id: true, addressLine: true, emirate: true, areaId: true } },
        },
      },
      submissionA: { select: CLAIM_SELECT },
      submissionB: { select: CLAIM_SELECT },
    },
  });
  if (!conflict) return null;

  const [reviews, enquiries] = await Promise.all([
    prisma.review.count({ where: { businessId: conflict.businessId, removedAt: null } }),
    prisma.enquiryRecipient.count({ where: { businessId: conflict.businessId } }),
  ]);

  // Stated on the screen, because "what happens to my reviews" is the question
  // both parties are actually asking.
  return {
    ...conflict,
    preserved: { reviews, enquiries },
    ageDays: ageInDays(conflict.createdAt),
  };
}

const CLAIM_SELECT = {
  id: true,
  route: true,
  phone: true,
  documentId: true,
  createdAt: true,
  claimant: { select: { id: true, fullName: true, email: true, phone: true } },
  document: { select: { id: true, filename: true, kind: true } },
} as const;

export async function openConflicts(limit = 50) {
  const rows = await prisma.claimConflict.findMany({
    where: { resolvedAt: null },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: {
      id: true,
      buyersWaiting: true,
      createdAt: true,
      business: { select: { id: true, displayName: true, slug: true, licenceNumber: true } },
      submissionA: { select: { claimant: { select: { fullName: true } } } },
      submissionB: { select: { claimant: { select: { fullName: true } } } },
    },
  });

  const now = new Date();
  return rows.map((row) => ({ ...row, ageDays: ageInDays(row.createdAt, now) }));
}

export type ResolveResult =
  | { ok: true; producedBusinessId?: string; producedLocationId?: string }
  | { ok: false; error: "not_found" | "already_resolved" | "needs_a_name"; message: string };

export interface ResolveInput {
  actor: Actor;
  conflictId: string;
  resolution: ClaimResolution;
  reason: string;
  /**
   * Required for `split_into_two`: the second company needs its own trade name
   * and its own slug, and neither can be derived from a licence number.
   */
  secondTradeName?: string;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Resolve, four ways.
 *
 * Every path writes exactly one `claim_resolved` audit row with a written
 * reason, decides both submissions, and leaves the original listing's reviews
 * and enquiries untouched. What differs is what it produces.
 */
export async function resolveConflict(input: ResolveInput): Promise<ResolveResult> {
  const conflict = await prisma.claimConflict.findUnique({
    where: { id: input.conflictId },
    select: {
      id: true,
      businessId: true,
      resolvedAt: true,
      submissionAId: true,
      submissionBId: true,
      submissionA: { select: { claimantId: true } },
      submissionB: { select: { claimantId: true } },
      business: {
        select: {
          id: true,
          tradeName: true,
          slug: true,
          licenceAuthority: true,
          licenceExpiry: true,
          primaryCategoryId: true,
          source: true,
          locations: {
            orderBy: { createdAt: "asc" },
            take: 1,
            select: { emirate: true, areaId: true, addressLine: true },
          },
        },
      },
    },
  });
  if (!conflict) {
    return { ok: false, error: "not_found", message: "That conflict is not in the queue." };
  }
  if (conflict.resolvedAt) {
    return {
      ok: false,
      error: "already_resolved",
      message: "Somebody already settled this one.",
    };
  }

  const name = input.secondTradeName?.trim();
  if (input.resolution === "split_into_two" && !name) {
    return {
      ok: false,
      error: "needs_a_name",
      message: "A split creates a second listing, so it needs the second company's trade name.",
    };
  }

  const now = new Date();
  const winner =
    input.resolution === "award_to_b"
      ? conflict.submissionB.claimantId
      : conflict.submissionA.claimantId;

  const produced = await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "claim.resolve",
        subject: `ClaimConflict:${conflict.id}`,
        reason: input.reason,
        tx,
      },
      async () => {
        let producedBusinessId: string | null = null;
        let producedLocationId: string | null = null;

        if (input.resolution === "award_to_a" || input.resolution === "award_to_b") {
          /*
           * One owner. The loser's submission is decided too — leaving it open
           * would put the listing straight back in the queue, and telling
           * somebody nothing is worse than telling them no.
           */
          await tx.business.update({
            where: { id: conflict.businessId },
            data: { claimStatus: "claimed" },
          });
          await tx.user.update({
            where: { id: winner },
            data: { businessId: conflict.businessId, roles: { set: ["seller_owner"] } },
          });
        }

        if (input.resolution === "split_into_two") {
          /*
           * Two real companies at one address. The original keeps its
           * reviews, its enquiries and its slug — whoever was there first
           * keeps the address buyers already have — and the second gets a new
           * listing with nothing on it, which is the honest starting point.
           */
          const base = conflict.business.locations[0];
          const created = await tx.business.create({
            data: {
              tradeName: name!,
              displayName: name!.replace(/ (LLC|FZE)$/, ""),
              slug: await freeSlug(tx, slugify(name!)),
              licenceNumber: `PENDING-${conflict.id.slice(-8).toUpperCase()}`,
              licenceAuthority: conflict.business.licenceAuthority,
              licenceExpiry: conflict.business.licenceExpiry,
              primaryCategoryId: conflict.business.primaryCategoryId,
              claimStatus: "claimed",
              source: "self_added",
              // Not published. A listing produced by a dispute has had nothing
              // checked, and tier 0 with no publish date says exactly that.
              publishedAt: null,
              ...(base
                ? {
                    locations: {
                      create: {
                        type: "head_office",
                        emirate: base.emirate,
                        areaId: base.areaId,
                        addressLine: base.addressLine,
                        published: true,
                      },
                    },
                  }
                : {}),
            },
            select: { id: true },
          });
          producedBusinessId = created.id;

          await tx.business.update({
            where: { id: conflict.businessId },
            data: { claimStatus: "claimed" },
          });
          await tx.user.update({
            where: { id: conflict.submissionA.claimantId },
            data: { businessId: conflict.businessId, roles: { set: ["seller_owner"] } },
          });
          await tx.user.update({
            where: { id: conflict.submissionB.claimantId },
            data: { businessId: created.id, roles: { set: ["seller_owner"] } },
          });
        }

        if (input.resolution === "merge_as_branches") {
          /*
           * One company, two licences — a mainland licence plus a free-zone
           * one is the usual shape. Both claimants end up on the same listing,
           * and the second licence becomes a branch rather than a second
           * listing competing with the first in every search result.
           */
          const base = conflict.business.locations[0];
          const branch = await tx.location.create({
            data: {
              businessId: conflict.businessId,
              type: "sales_office",
              emirate: base?.emirate ?? "dubai",
              areaId: base!.areaId,
              addressLine: base?.addressLine ?? "",
              published: true,
            },
            select: { id: true },
          });
          producedLocationId = branch.id;

          await tx.business.update({
            where: { id: conflict.businessId },
            data: { claimStatus: "claimed" },
          });
          for (const claimantId of [
            conflict.submissionA.claimantId,
            conflict.submissionB.claimantId,
          ]) {
            await tx.user.update({
              where: { id: claimantId },
              data: { businessId: conflict.businessId, roles: { set: ["seller_owner"] } },
            });
          }
        }

        // Both submissions decided, always, whichever way it went.
        await tx.claimSubmission.updateMany({
          where: { id: { in: [conflict.submissionAId, conflict.submissionBId] } },
          data: { status: "claimed", decidedAt: now, decisionReason: input.reason },
        });

        await tx.claimConflict.update({
          where: { id: conflict.id },
          data: {
            resolution: input.resolution,
            resolvedById: input.actor.id,
            resolvedAt: now,
            reason: input.reason,
            producedBusinessId,
            producedLocationId,
          },
        });

        return {
          result: { producedBusinessId, producedLocationId },
          before: { claimStatus: "disputed" },
          after: {
            resolution: input.resolution,
            producedBusinessId,
            producedLocationId,
          },
        };
      },
    ),
  );

  return {
    ok: true,
    ...(produced.producedBusinessId ? { producedBusinessId: produced.producedBusinessId } : {}),
    ...(produced.producedLocationId ? { producedLocationId: produced.producedLocationId } : {}),
  };
}

/** Slugs are immutable once published, so a new one must be free on arrival. */
async function freeSlug(
  tx: { business: { findFirst(args: unknown): Promise<{ id: string } | null> } },
  base: string,
): Promise<string> {
  for (let n = 0; n < 50; n += 1) {
    const candidate = n === 0 ? base : `${base}-${n + 1}`;
    const taken = await tx.business.findFirst({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }
  throw new Error(`could not find a free slug from ${base}`);
}
