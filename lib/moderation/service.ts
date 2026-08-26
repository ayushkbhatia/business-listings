import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import type { Actor } from "@/lib/auth/roles";
import type { ModeratedField } from "@/lib/listing/service";

/**
 * Board 4b and 4c — draining the queue handoff 3 has been filling.
 *
 * Only three fields ever queue: trade name, primary category and licence.
 * `ModeratedField` is an enum precisely so a fourth is a migration and a
 * product decision rather than somebody's afternoon. If the queue gated
 * everything it would become the bottleneck on 41,000 listings and the whole
 * seller dashboard would feel dead.
 *
 * **Approving applies the change.** That sounds obvious and it is the part
 * worth stating: the queue row is a request, not a record of something that
 * already happened, so an approval that writes `status = approved` and stops
 * leaves a seller looking at a screen that says their new trade name was
 * approved and a listing that still shows the old one.
 *
 * A trade-name change also moves the slug — and `docs/routes.md` says slugs are
 * immutable once published and that a rename creates a 301 automatically. So
 * the redirect is written here, in the same transaction, rather than left to
 * whoever remembers.
 */

export type DecisionResult =
  | { ok: true; applied: boolean }
  | {
      ok: false;
      error: "not_found" | "already_decided" | "stale" | "slug_taken";
      message: string;
    };

export interface DecideInput {
  actor: Actor;
  requestId: string;
  reason: string;
}

const DAY_MS = 86_400_000;

/**
 * Whole days a row has been waiting.
 *
 * Computed here rather than in the page. `Date.now()` during render is an
 * impure call and `react-hooks/purity` refuses it — rightly: a component that
 * reads the clock renders differently every time it renders, which is the
 * definition of the thing React caches wrongly. The clock belongs on the
 * server side of the boundary, which is where the row came from anyway.
 */
export function ageInDays(from: Date, now = new Date()): number {
  /*
   * Never negative. The seed anchors its clock to the start of the Dubai day,
   * so a row it stamps "five hours ago" can sit a few hours ahead of a reader
   * whose clock is real — and "-1d waiting" on a queue is nonsense in a way
   * that makes the whole column look broken. A row from the future has been
   * waiting no time at all.
   */
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / DAY_MS));
}

/** What the queue shows, oldest first. Age is the ordering, not volume. */
export async function pendingQueue(limit = 50, offset = 0) {
  const rows = await prisma.listingChangeRequest.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
    take: limit,
    skip: offset,
    select: {
      id: true,
      field: true,
      beforeValue: true,
      afterValue: true,
      createdAt: true,
      business: { select: { id: true, displayName: true, slug: true, verificationTier: true } },
      actor: { select: { id: true, fullName: true } },
    },
  });

  const now = new Date();
  return rows.map((row) => ({ ...row, ageDays: ageInDays(row.createdAt, now) }));
}

export async function pendingQueueCount(): Promise<number> {
  return prisma.listingChangeRequest.count({ where: { status: "pending" } });
}

/**
 * One submission, with everything board 4c puts in front of the decision.
 *
 * Including the count of buyers currently waiting on this listing. That number
 * is the real cost of the delay, and it is the argument for deciding today
 * rather than tomorrow — which is why it sits next to the buttons rather than
 * in a report nobody opens.
 */
export async function submissionFor(requestId: string) {
  const request = await prisma.listingChangeRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      field: true,
      beforeValue: true,
      afterValue: true,
      status: true,
      decisionReason: true,
      decidedAt: true,
      createdAt: true,
      business: {
        select: {
          id: true,
          displayName: true,
          tradeName: true,
          slug: true,
          licenceNumber: true,
          licenceAuthority: true,
          licenceExpiry: true,
          verificationTier: true,
          primaryCategoryId: true,
          primaryCategory: { select: { id: true, name: true } },
        },
      },
      actor: { select: { id: true, fullName: true, email: true } },
      decidedBy: { select: { id: true, fullName: true } },
    },
  });
  if (!request) return null;

  const buyersWaiting = await prisma.enquiryRecipient.count({
    where: {
      businessId: request.business.id,
      state: { in: ["delivered", "opened"] },
    },
  });

  const now = new Date();
  return {
    ...request,
    buyersWaiting,
    ageDays: ageInDays(request.createdAt, now),
    decidedDaysAgo: request.decidedAt ? ageInDays(request.decidedAt, now) : null,
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Approve, and apply.
 *
 * `queue.decide` is moderator or ops lead. The audit action is `queue_decided`
 * for both directions — an approval and a rejection are the same kind of event
 * and the reason is what separates them.
 */
export async function approveChange(input: DecideInput): Promise<DecisionResult> {
  const request = await prisma.listingChangeRequest.findUnique({
    where: { id: input.requestId },
    select: {
      id: true,
      status: true,
      field: true,
      beforeValue: true,
      afterValue: true,
      businessId: true,
      business: {
        select: { tradeName: true, primaryCategoryId: true, licenceNumber: true, slug: true, publishedAt: true },
      },
    },
  });
  if (!request) {
    return { ok: false, error: "not_found", message: "That submission is not in the queue." };
  }
  if (request.status !== "pending") {
    return {
      ok: false,
      error: "already_decided",
      message: `That submission was already ${request.status}.`,
    };
  }

  /*
   * The listing may have moved since the seller asked. Approving a rename from
   * a value the business no longer has would overwrite a change nobody
   * reviewed — so the before-value is checked, not trusted.
   */
  const current =
    request.field === "trade_name"
      ? request.business.tradeName
      : request.field === "primary_category"
        ? request.business.primaryCategoryId
        : request.business.licenceNumber;

  if (request.beforeValue !== null && request.beforeValue !== current) {
    return {
      ok: false,
      error: "stale",
      message:
        "The listing has changed since this was submitted. Reject it and ask for the change again against what it says now.",
    };
  }

  const field: ModeratedField = request.field;
  const nextSlug = field === "trade_name" ? slugify(request.afterValue) : null;

  if (nextSlug && nextSlug !== request.business.slug) {
    const taken = await prisma.business.findFirst({
      where: { slug: nextSlug, id: { not: request.businessId } },
      select: { id: true },
    });
    if (taken) {
      return {
        ok: false,
        error: "slug_taken",
        message: `Another listing already uses the address /b/${nextSlug}. Reject this and ask for a name that does not collide.`,
      };
    }
  }

  await prisma.$transaction(async (tx) => {
    await staffMutation(
      {
        actor: input.actor,
        capability: "queue.decide",
        subject: `ListingChangeRequest:${request.id}`,
        reason: input.reason,
        tx,
      },
      async () => {
        const data =
          field === "trade_name"
            ? {
                tradeName: request.afterValue,
                displayName: request.afterValue.replace(/ (LLC|FZE)$/, ""),
                ...(nextSlug && nextSlug !== request.business.slug ? { slug: nextSlug } : {}),
              }
            : field === "primary_category"
              ? { primaryCategoryId: request.afterValue }
              : { licenceNumber: request.afterValue };

        const after = await tx.business.update({
          where: { id: request.businessId },
          data,
          select: { tradeName: true, slug: true, primaryCategoryId: true, licenceNumber: true },
        });

        /*
         * The 301. Only for a slug that actually moved, and only for a listing
         * that was published — a draft has no address anybody has bookmarked.
         * `fromPath` is unique, so a listing renamed twice keeps both hops
         * rather than losing the first.
         */
        if (nextSlug && nextSlug !== request.business.slug && request.business.publishedAt) {
          await tx.redirect.upsert({
            where: { fromPath: `/b/${request.business.slug}` },
            create: {
              fromPath: `/b/${request.business.slug}`,
              toPath: `/b/${nextSlug}`,
              businessId: request.businessId,
            },
            update: { toPath: `/b/${nextSlug}`, businessId: request.businessId },
          });
        }

        await tx.listingChangeRequest.update({
          where: { id: request.id },
          data: {
            status: "approved",
            decisionReason: input.reason,
            decidedById: input.actor.id,
            decidedAt: new Date(),
          },
        });

        return {
          result: true,
          before: { [field]: current },
          after: { [field]: request.afterValue, slug: after.slug },
        };
      },
    );
  });

  return { ok: true, applied: true };
}

/**
 * Reject, with a reason the seller reads.
 *
 * The reason is not internal. It goes on the request and the seller sees it on
 * their listing screen, so it has to say what is wrong and what correct looks
 * like — CLAUDE.md's voice rule, applied to the message staff type most often.
 */
export async function rejectChange(input: DecideInput): Promise<DecisionResult> {
  const request = await prisma.listingChangeRequest.findUnique({
    where: { id: input.requestId },
    select: { id: true, status: true, field: true, businessId: true },
  });
  if (!request) {
    return { ok: false, error: "not_found", message: "That submission is not in the queue." };
  }
  if (request.status !== "pending") {
    return {
      ok: false,
      error: "already_decided",
      message: `That submission was already ${request.status}.`,
    };
  }

  await prisma.$transaction(async (tx) => {
    await staffMutation(
      {
        actor: input.actor,
        capability: "queue.decide",
        subject: `ListingChangeRequest:${request.id}`,
        reason: input.reason,
        tx,
      },
      async () => {
        const after = await tx.listingChangeRequest.update({
          where: { id: request.id },
          data: {
            status: "rejected",
            decisionReason: input.reason,
            decidedById: input.actor.id,
            decidedAt: new Date(),
          },
          select: { status: true, decisionReason: true },
        });
        // Nothing changed on the business, and the audit row says so rather
        // than implying a mutation that did not happen.
        return { result: true, before: { status: "pending" }, after };
      },
    );
  });

  return { ok: true, applied: false };
}
