import "server-only";
import { Prisma } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import { repairClaims } from "@/lib/auth/flow";
import { assertCanCloseAccount } from "@/lib/auth/guards";
import { isRole, SELLER_ROLES, type Actor, type Role } from "@/lib/auth/roles";
import { effectiveFor } from "@/lib/billing/entitlements-service";
import { closureBlockers, type ClosureBlockers } from "./blockers";
import { sendClosureEmail } from "./email";
import {
  canReverse,
  closureState,
  hashReversalToken,
  looksLikeReversalToken,
  newReversalToken,
  ownerClosureDates,
  platformClosureDates,
  type ClosureState,
} from "./policy";
import { endSessions } from "./sessions";

/**
 * Board `11i` — closing an account, and every way back.
 *
 * ## The three things most likely to be built wrong
 *
 * The handoff names them, and each is a rule this module holds rather than a
 * screen:
 *
 * 1. **Closure is a status transition, never a delete.** Nothing in the
 *    retained set moves. The business row survives as the anchor every enquiry,
 *    quote and review hangs from, and its slug stays on it for good.
 * 2. **The blockers are enforced here, at request time,** inside the
 *    transaction that writes the closure (`B1`). The disabled button is a
 *    courtesy.
 * 3. **The listing comes down at request,** not when the window ends (`B2`).
 *
 * ## How the listing comes down
 *
 * `publishedAt` is nulled. 118 public reads already require it, including the
 * ones nobody would think to update — the sitemap, curated lists, area pages,
 * the enquiry fan-out, the claim-match rail. A new flag in one predicate would
 * have missed most of them. The value it had goes on the snapshot, so a
 * reversal restores the original go-live date rather than stamping a new one,
 * and a check constraint refuses a row that is both closing and published.
 *
 * ## How the team is signed out
 *
 * The same writes `removeSeat` makes, so there is one definition of a revoked
 * seat: `businessId` and `branchId` nulled, seller roles dropped, the claim
 * repaired. `getActor` reads `businessId` from the profile row on every request,
 * so the revocation is effective on the next page load; `endSessions` then
 * deletes the sessions themselves (`B7`). Unlike `removeSeat`, leads keep their
 * assignee and seat channels are kept until the closure is final — both so a
 * reversal puts the team back exactly as it was.
 */

export interface ClosureSeatSnapshot {
  userId: string;
  roles: Role[];
  branchId: string | null;
}

/** What a reversal restores. Stored on `business_closure.snapshot`. */
export interface ClosureSnapshot {
  version: 1;
  publishedAt: string | null;
  seats: ClosureSeatSnapshot[];
  subdomain: string | null;
  invitesRevoked: number;
}

const EMPTY_SNAPSHOT: ClosureSnapshot = {
  version: 1,
  publishedAt: null,
  seats: [],
  subdomain: null,
  invitesRevoked: 0,
};

/** Read a stored snapshot back, refusing anything that is not one. */
export function readSnapshot(value: unknown): ClosureSnapshot {
  if (!value || typeof value !== "object") return EMPTY_SNAPSHOT;
  const raw = value as Partial<ClosureSnapshot>;
  if (raw.version !== 1) return EMPTY_SNAPSHOT;

  const seats = Array.isArray(raw.seats)
    ? raw.seats.flatMap((seat): ClosureSeatSnapshot[] => {
        if (!seat || typeof seat.userId !== "string" || !Array.isArray(seat.roles)) return [];
        return [
          {
            userId: seat.userId,
            roles: seat.roles.filter((role): role is Role => typeof role === "string" && isRole(role)),
            branchId: typeof seat.branchId === "string" ? seat.branchId : null,
          },
        ];
      })
    : [];

  return {
    version: 1,
    publishedAt: typeof raw.publishedAt === "string" ? raw.publishedAt : null,
    seats,
    subdomain: typeof raw.subdomain === "string" ? raw.subdomain : null,
    invitesRevoked: typeof raw.invitesRevoked === "number" ? raw.invitesRevoked : 0,
  };
}

const CLOSURE_SELECT = {
  id: true,
  businessId: true,
  initiator: true,
  requestedById: true,
  ownerId: true,
  requestedAt: true,
  effectiveAt: true,
  appliedAt: true,
  finalAt: true,
  reversedAt: true,
  reversedVia: true,
  finalisedAt: true,
  snapshot: true,
  emailDeliveredAt: true,
} as const satisfies Prisma.BusinessClosureSelect;

export type ClosureRow = Prisma.BusinessClosureGetPayload<{ select: typeof CLOSURE_SELECT }>;

/** A closure that is neither reversed nor final. At most one per business. */
const OPEN = { reversedAt: null, finalisedAt: null } as const;

function isSellerRole(role: Role): boolean {
  return (SELLER_ROLES as readonly string[]).includes(role);
}

/** A stable key for "this business already has an open closure" races. */
function isOneOpenViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    String(error.meta?.["target"] ?? error.message).includes("business_closure")
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

/** The open closure on a business, or null. */
export async function openClosureFor(businessId: string): Promise<ClosureRow | null> {
  return prisma.businessClosure.findFirst({
    where: { businessId, ...OPEN },
    select: CLOSURE_SELECT,
  });
}

/**
 * The open closure this person owns, where they have no seat any more.
 *
 * The reversal screen's other door. Closure revokes the owner's seat, so an
 * owner who signs in again during the window arrives with no `businessId` — and
 * without this they would reach a 404 rather than the one screen they need.
 */
export async function openClosureOwnedBy(userId: string): Promise<(ClosureRow & { business: { displayName: string; slug: string } }) | null> {
  return prisma.businessClosure.findFirst({
    where: { ownerId: userId, ...OPEN, appliedAt: { not: null } },
    // One open closure per business, but one owner can own two businesses.
    orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
    select: { ...CLOSURE_SELECT, business: { select: { displayName: true, slug: true } } },
  });
}

export interface ClosureView {
  closure: ClosureRow;
  state: ClosureState;
}

export function viewOf(closure: ClosureRow, now: Date = new Date()): ClosureView {
  return { closure, state: closureState(closure, now) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Applying a closure — shared by the owner's request and a platform notice
// ─────────────────────────────────────────────────────────────────────────────

interface Applied {
  snapshot: ClosureSnapshot;
  seatUserIds: string[];
  slug: string;
}

/**
 * Take the listing down and revoke the team. Runs inside the caller's
 * transaction, and is the only code that does either.
 */
async function applyClosure(
  tx: Prisma.TransactionClient,
  closureId: string,
  businessId: string,
  now: Date,
): Promise<Applied> {
  const business = await tx.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { slug: true, publishedAt: true },
  });

  const seats = await tx.user.findMany({
    where: { businessId },
    select: { id: true, roles: true, branchId: true },
    orderBy: { id: "asc" },
  });

  const subdomain = await tx.customDomain.findUnique({
    where: { businessId },
    select: { hostname: true },
  });

  // B2 — out of every public read, now.
  await tx.business.update({
    where: { id: businessId },
    data: { publishedAt: null, closureRequestedAt: now },
  });

  // B7 — the same writes `removeSeat` makes, one seat at a time because each
  // keeps its own non-seller roles.
  for (const seat of seats) {
    await tx.user.update({
      where: { id: seat.id },
      data: {
        businessId: null,
        branchId: null,
        roles: seat.roles.filter((role) => !isSellerRole(role as Role)),
      },
    });
  }

  // An invitation accepted during the window would seat somebody on a business
  // that is leaving the directory.
  const invites = await tx.teamInvite.updateMany({
    where: { businessId, acceptedAt: null, revokedAt: null },
    data: { revokedAt: now },
  });

  // B10 — the storefront address is released. Kept on the snapshot so a
  // reversal can put it back if nobody took it and the plan still carries it.
  await tx.customDomain.deleteMany({ where: { businessId } });

  const snapshot: ClosureSnapshot = {
    version: 1,
    publishedAt: business.publishedAt?.toISOString() ?? null,
    seats: seats.map((seat) => ({
      userId: seat.id,
      roles: seat.roles.filter((role): role is Role => isRole(role)),
      branchId: seat.branchId,
    })),
    subdomain: subdomain?.hostname ?? null,
    invitesRevoked: invites.count,
  };

  await tx.businessClosure.update({
    where: { id: closureId },
    data: { appliedAt: now, snapshot: snapshot as unknown as Prisma.InputJsonValue },
  });

  return { snapshot, seatUserIds: seats.map((seat) => seat.id), slug: business.slug };
}

/** The writes that cannot happen inside a database transaction. */
async function afterApplied(applied: Applied): Promise<{ sessionsEnded: number | null }> {
  // Roles are read from the JWT claim first; a revoked seat whose claim still
  // names a business is a seat that can open the dashboard until the claim is
  // rebuilt. Same reason `removeSeat` does it.
  for (const seat of applied.snapshot.seats) {
    await repairClaims(
      seat.userId,
      seat.roles.filter((role) => !isSellerRole(role)),
      null,
    );
  }
  return { sessionsEnded: await endSessions(applied.seatUserIds) };
}

// ─────────────────────────────────────────────────────────────────────────────
// The owner closes
// ─────────────────────────────────────────────────────────────────────────────

export type RequestClosureResult =
  | {
      ok: true;
      closureId: string;
      slug: string;
      finalAt: Date;
      emailDelivered: boolean;
      /** Where the email went, masked for the confirmation screen. */
      emailTo: string | null;
      seatsRevoked: number;
      sessionsEnded: number | null;
    }
  | { ok: false; error: "not_found" | "already_closing" | "closed" }
  | { ok: false; error: "blocked"; blockers: ClosureBlockers };

/**
 * Build notes `B1`, `B2`, `B7`, `B10` — and acceptance criteria 1, 2 and 7.
 */
export async function requestClosure(actor: Actor, now: Date = new Date()): Promise<RequestClosureResult> {
  assertCanCloseAccount(actor);
  const businessId = actor.businessId;
  if (!businessId) return { ok: false, error: "not_found" };

  const owner = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { email: true },
  });

  const { token, hash } = newReversalToken();
  const { effectiveAt, finalAt } = ownerClosureDates(now);

  let outcome:
    | { kind: "blocked"; blockers: ClosureBlockers }
    | { kind: "applied"; closureId: string; applied: Applied; businessName: string }
    | { kind: "missing" }
    | { kind: "closing" }
    | { kind: "closed" };

  try {
    outcome = await prisma.$transaction(
      async (tx) => {
        /*
           The row lock first. Two tabs pressing the button at once both pass the
           screen; this makes the second wait for the first and then find the
           closure it opened. The partial unique index is the backstop.
        */
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "business" WHERE id = ${businessId} FOR UPDATE
        `;
        if (locked.length === 0) return { kind: "missing" as const };

        const business = await tx.business.findUniqueOrThrow({
          where: { id: businessId },
          select: { displayName: true, closureRequestedAt: true, closedAt: true },
        });
        if (business.closedAt) return { kind: "closed" as const };
        if (business.closureRequestedAt) return { kind: "closing" as const };

        const pending = await tx.businessClosure.findFirst({
          where: { businessId, ...OPEN },
          select: { id: true },
        });
        if (pending) return { kind: "closing" as const };

        // B1, at request time and inside the lock.
        const blockers = await closureBlockers(businessId, now, tx);
        if (!blockers.clear) return { kind: "blocked" as const, blockers };

        const closure = await tx.businessClosure.create({
          data: {
            businessId,
            initiator: "owner",
            requestedById: actor.id,
            ownerId: actor.id,
            requestedAt: now,
            effectiveAt,
            finalAt,
            tokenHash: hash,
          },
          select: { id: true },
        });

        const applied = await applyClosure(tx, closure.id, businessId, now);
        return {
          kind: "applied" as const,
          closureId: closure.id,
          applied,
          businessName: business.displayName,
        };
      },
      { timeout: 20_000 },
    );
  } catch (error) {
    if (isOneOpenViolation(error)) return { ok: false, error: "already_closing" };
    throw error;
  }

  if (outcome.kind === "missing") return { ok: false, error: "not_found" };
  if (outcome.kind === "closing") return { ok: false, error: "already_closing" };
  if (outcome.kind === "closed") return { ok: false, error: "closed" };
  if (outcome.kind === "blocked") return { ok: false, error: "blocked", blockers: outcome.blockers };

  const { sessionsEnded } = await afterApplied(outcome.applied);

  // B3 — the way back.
  const emailDelivered = await sendClosureEmail({
    kind: "requested",
    to: owner?.email ?? null,
    businessName: outcome.businessName,
    date: finalAt,
    token,
  });
  if (emailDelivered) {
    await prisma.businessClosure.update({
      where: { id: outcome.closureId },
      data: { emailDeliveredAt: new Date() },
    });
  }

  return {
    ok: true,
    closureId: outcome.closureId,
    slug: outcome.applied.slug,
    finalAt,
    emailDelivered,
    emailTo: owner?.email ?? null,
    seatsRevoked: outcome.applied.seatUserIds.length,
    sessionsEnded,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reversal
// ─────────────────────────────────────────────────────────────────────────────

export type ReverseResult =
  | { ok: true; slug: string; businessName: string; seatsRestored: number; seatsSkipped: number }
  | { ok: false; error: "invalid" | "not_found" | "expired" | "already_reversed" | "final" | "platform" };

interface RestoreOutcome {
  slug: string;
  businessName: string;
  ownerEmail: string | null;
  restoredUserIds: { userId: string; roles: Role[] }[];
  skipped: number;
}

/**
 * Put everything back that `applyClosure` took down, inside the caller's
 * transaction.
 *
 * Exactly as it was, where that is still true: the original go-live date, each
 * seat with its roles and branch, and the storefront address. A seat whose
 * person has since joined another business is left where they are — putting
 * them back would pull them out of a team they chose — and is counted, so the
 * screen can say so.
 */
async function restore(
  tx: Prisma.TransactionClient,
  closure: ClosureRow,
  now: Date,
  by: { userId: string | null; via: "email" | "dashboard" | "staff" },
): Promise<RestoreOutcome> {
  const snapshot = readSnapshot(closure.snapshot);

  const business = await tx.business.update({
    where: { id: closure.businessId },
    data: {
      publishedAt: snapshot.publishedAt ? new Date(snapshot.publishedAt) : null,
      closureRequestedAt: null,
    },
    select: { slug: true, displayName: true },
  });

  const restoredUserIds: { userId: string; roles: Role[] }[] = [];
  let skipped = 0;

  for (const seat of snapshot.seats) {
    const person = await tx.user.findUnique({
      where: { id: seat.userId },
      select: { businessId: true, roles: true },
    });
    if (!person || person.businessId !== null) {
      skipped += 1;
      continue;
    }

    // A branch that was deleted during the window is not put back.
    const branch = seat.branchId
      ? await tx.location.findFirst({
          where: { id: seat.branchId, businessId: closure.businessId },
          select: { id: true },
        })
      : null;

    const roles = [
      ...new Set([
        ...person.roles.filter((role): role is Role => isRole(role)),
        ...seat.roles.filter(isSellerRole),
      ]),
    ];

    await tx.user.update({
      where: { id: seat.userId },
      data: { businessId: closure.businessId, branchId: branch?.id ?? null, roles },
    });
    restoredUserIds.push({ userId: seat.userId, roles });
  }

  if (snapshot.subdomain) {
    const caps = await effectiveFor(closure.businessId);
    const taken = await tx.customDomain.findUnique({
      where: { hostname: snapshot.subdomain },
      select: { id: true },
    });
    if (caps?.customDomain && !taken) {
      await tx.customDomain.create({
        data: {
          businessId: closure.businessId,
          hostname: snapshot.subdomain,
          token: "",
          status: "verified",
          verifiedAt: now,
        },
      });
    }
  }

  await tx.businessClosure.update({
    where: { id: closure.id },
    data: { reversedAt: now, reversedById: by.userId, reversedVia: by.via },
  });

  const owner = closure.ownerId
    ? await tx.user.findUnique({ where: { id: closure.ownerId }, select: { email: true } })
    : null;

  return {
    slug: business.slug,
    businessName: business.displayName,
    ownerEmail: owner?.email ?? null,
    restoredUserIds,
    skipped,
  };
}

async function afterRestored(outcome: RestoreOutcome): Promise<void> {
  for (const seat of outcome.restoredUserIds) {
    await repairClaims(seat.userId, seat.roles, null);
  }
}

/** Refusals shared by both doors, in the order a seller would want to hear them. */
function refusalFor(closure: ClosureRow | null, now: Date): Extract<ReverseResult, { ok: false }> | null {
  if (!closure) return { ok: false, error: "not_found" };
  if (closure.reversedAt) return { ok: false, error: "already_reversed" };
  if (closure.finalisedAt) return { ok: false, error: "final" };
  if (closure.initiator === "platform") return { ok: false, error: "platform" };
  if (!canReverse(closure, now)) return { ok: false, error: "expired" };
  return null;
}

async function reverse(
  closureId: string,
  now: Date,
  by: { userId: string | null; via: "email" | "dashboard" },
): Promise<ReverseResult> {
  const outcome = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "business_closure" WHERE id = ${closureId} FOR UPDATE`;
      const closure = await tx.businessClosure.findUnique({
        where: { id: closureId },
        select: CLOSURE_SELECT,
      });
      const refusal = refusalFor(closure, now);
      if (refusal) return refusal;

      const restored = await restore(tx, closure!, now, {
        // The email link is unauthenticated by design (B3). The act is the
        // owner's — the token went to them and nobody else — and the row says
        // it arrived by email, so the log never claims a sign-in that did not
        // happen.
        userId: by.userId ?? closure!.ownerId,
        via: by.via,
      });
      return { ok: true as const, restored };
    },
    { timeout: 20_000 },
  );

  if (!outcome.ok) return outcome;

  await afterRestored(outcome.restored);
  await sendClosureEmail({
    kind: "reopened",
    to: outcome.restored.ownerEmail,
    businessName: outcome.restored.businessName,
  });

  return {
    ok: true,
    slug: outcome.restored.slug,
    businessName: outcome.restored.businessName,
    seatsRestored: outcome.restored.restoredUserIds.length,
    seatsSkipped: outcome.restored.skipped,
  };
}

/** The closure a reversal link points at, for the page that asks to confirm. */
export async function closureForToken(
  token: string,
): Promise<(ClosureRow & { business: { displayName: string; slug: string } }) | null> {
  if (!looksLikeReversalToken(token)) return null;
  return prisma.businessClosure.findUnique({
    where: { tokenHash: hashReversalToken(token) },
    select: { ...CLOSURE_SELECT, business: { select: { displayName: true, slug: true } } },
  });
}

/**
 * Build note `B3` — one link, one action.
 *
 * The page the link opens only reads; this runs on the button. A link that
 * reversed on GET would be reversed by every mail scanner that pre-fetches URLs,
 * which is most corporate mailboxes.
 */
export async function reverseByToken(token: string, now: Date = new Date()): Promise<ReverseResult> {
  if (!looksLikeReversalToken(token)) return { ok: false, error: "invalid" };
  const closure = await prisma.businessClosure.findUnique({
    where: { tokenHash: hashReversalToken(token) },
    select: { id: true },
  });
  if (!closure) return { ok: false, error: "invalid" };
  return reverse(closure.id, now, { userId: null, via: "email" });
}

/** The reversal screen's button, for an owner who signed in again. */
export async function reverseAsOwner(actor: Actor, now: Date = new Date()): Promise<ReverseResult> {
  const closure = await openClosureOwnedBy(actor.id);
  if (!closure) return { ok: false, error: "not_found" };
  return reverse(closure.id, now, { userId: actor.id, via: "dashboard" });
}

// ─────────────────────────────────────────────────────────────────────────────
// The platform closes — build note B8
// ─────────────────────────────────────────────────────────────────────────────

export type NoticeResult =
  | { ok: true; effectiveAt: Date; emailDelivered: boolean }
  | { ok: false; error: "not_found" | "licence_current" | "already_closing" | "closed" };

/**
 * Give notice that a listing will close because its licence lapsed.
 *
 * Ops lead only, audited with a reason. Nothing comes down today: the seller
 * is told first, keeps their seat for the notice period, and can stop it by
 * renewing — an ops lead's check of the new licence moves `licenceExpiry`, and
 * the nightly job withdraws the notice on its own.
 */
export async function giveLicenceLapseNotice(input: {
  actor: Actor;
  businessId: string;
  reason: string;
  now?: Date;
}): Promise<NoticeResult> {
  const now = input.now ?? new Date();
  const business = await prisma.business.findUnique({
    where: { id: input.businessId },
    select: {
      id: true,
      displayName: true,
      licenceExpiry: true,
      closureRequestedAt: true,
      closedAt: true,
      team: { where: { roles: { has: "seller_owner" } }, select: { id: true, email: true }, take: 1 },
    },
  });
  if (!business) return { ok: false, error: "not_found" };
  if (business.closedAt) return { ok: false, error: "closed" };
  if (business.closureRequestedAt) return { ok: false, error: "already_closing" };
  if (business.licenceExpiry.getTime() > now.getTime()) return { ok: false, error: "licence_current" };

  const { effectiveAt, finalAt } = platformClosureDates(now);
  const { hash } = newReversalToken();
  const owner = business.team[0] ?? null;

  try {
    await prisma.$transaction(async (tx) => {
      await staffMutation(
        {
          actor: input.actor,
          capability: "business.close",
          action: "closure_noticed",
          subject: `Business:${business.id}`,
          reason: input.reason,
          tx,
        },
        async () => {
          const closure = await tx.businessClosure.create({
            data: {
              businessId: business.id,
              initiator: "platform",
              requestedById: input.actor.id,
              ownerId: owner?.id ?? null,
              requestedAt: now,
              effectiveAt,
              finalAt,
              tokenHash: hash,
            },
            select: { id: true, effectiveAt: true },
          });
          return { result: closure, before: null, after: { closureId: closure.id, effectiveAt } };
        },
      );
    });
  } catch (error) {
    if (isOneOpenViolation(error)) return { ok: false, error: "already_closing" };
    throw error;
  }

  const emailDelivered = await sendClosureEmail({
    kind: "notice",
    to: owner?.email ?? null,
    businessName: business.displayName,
    date: effectiveAt,
    licenceExpiredOn: business.licenceExpiry,
  });

  return { ok: true, effectiveAt, emailDelivered };
}

export type WithdrawResult =
  | { ok: true; slug: string; restored: boolean }
  | { ok: false; error: "not_found" | "final" };

/**
 * Undo an open closure by hand, with a reason. A notice that has not taken
 * effect is simply marked withdrawn; one that has is restored exactly as the
 * owner's own reversal would restore it.
 */
export async function withdrawClosure(input: {
  actor: Actor;
  businessId: string;
  reason: string;
  now?: Date;
}): Promise<WithdrawResult> {
  const now = input.now ?? new Date();
  const closure = await openClosureFor(input.businessId);
  if (!closure) return { ok: false, error: "not_found" };
  if (closureState(closure, now) === "due") return { ok: false, error: "final" };

  const outcome = await prisma.$transaction(
    async (tx) =>
      staffMutation(
        {
          actor: input.actor,
          capability: "business.close",
          action: "closure_withdrawn",
          subject: `Business:${input.businessId}`,
          reason: input.reason,
          tx,
        },
        async () => {
          if (!closure.appliedAt) {
            await tx.businessClosure.update({
              where: { id: closure.id },
              data: { reversedAt: now, reversedById: input.actor.id, reversedVia: "staff" },
            });
            const business = await tx.business.findUniqueOrThrow({
              where: { id: input.businessId },
              select: { slug: true },
            });
            const result = { slug: business.slug, restored: null as RestoreOutcome | null };
            return { result, before: { state: "noticed" }, after: { state: "withdrawn" } };
          }
          const restored = await restore(tx, closure, now, { userId: input.actor.id, via: "staff" });
          return {
            result: { slug: restored.slug, restored },
            before: { state: "requested" },
            after: { state: "withdrawn", seatsRestored: restored.restoredUserIds.length },
          };
        },
      ),
    { timeout: 20_000 },
  );

  if (outcome.restored) await afterRestored(outcome.restored);
  return { ok: true, slug: outcome.slug, restored: outcome.restored !== null };
}

export type ReopenResult =
  | { ok: true; slug: string }
  | { ok: false; error: "not_found" | "not_closed" | "no_such_user" | "user_has_business" };

/**
 * Q2 — a closed business reopened for the same licence holder.
 *
 * The slug was reserved for exactly this. An ops lead who has checked the
 * claimant's licence against the record seats them as owner; the business stays
 * unpublished, and they go live again through the setup hub like any other
 * listing, which is where the go-live gate lives. Nothing is published by staff
 * on a seller's behalf.
 */
export async function reopenClosedBusiness(input: {
  actor: Actor;
  businessId: string;
  ownerEmail: string;
  reason: string;
}): Promise<ReopenResult> {
  const business = await prisma.business.findUnique({
    where: { id: input.businessId },
    select: { id: true, slug: true, closedAt: true },
  });
  if (!business) return { ok: false, error: "not_found" };
  if (!business.closedAt) return { ok: false, error: "not_closed" };

  const person = await prisma.user.findFirst({
    where: { email: { equals: input.ownerEmail.trim(), mode: "insensitive" } },
    select: { id: true, roles: true, businessId: true },
  });
  if (!person) return { ok: false, error: "no_such_user" };
  if (person.businessId) return { ok: false, error: "user_has_business" };

  const roles = [
    ...new Set([...person.roles.filter((role): role is Role => isRole(role)), "seller_owner" as Role]),
  ];

  await prisma.$transaction(async (tx) => {
    await staffMutation(
      {
        actor: input.actor,
        capability: "business.close",
        action: "closure_reopened",
        subject: `Business:${business.id}`,
        reason: input.reason,
        tx,
      },
      async () => {
        await tx.business.update({
          where: { id: business.id },
          data: { closedAt: null, closureRequestedAt: null },
        });
        await tx.user.update({
          where: { id: person.id },
          data: { businessId: business.id, roles },
        });
        return {
          result: null,
          before: { closedAt: business.closedAt },
          after: { closedAt: null, ownerId: person.id },
        };
      },
    );
  });

  await repairClaims(person.id, roles, business.id);
  return { ok: true, slug: business.slug };
}

// ─────────────────────────────────────────────────────────────────────────────
// The nightly sweep
// ─────────────────────────────────────────────────────────────────────────────

export interface ClosureSweepResult {
  /** Platform notices that ran out and took effect. */
  applied: number;
  /** Platform notices withdrawn because the licence was renewed in time. */
  withdrawnRenewed: number;
  /** Platform notices that ran out but cannot apply while we are still charging. */
  heldBySubscription: number;
  /** Closures whose window passed and are now final. */
  finalised: number;
  /** Slugs whose public pages changed, for the route to revalidate. */
  slugs: string[];
}

/**
 * Apply due platform notices and finalise closures whose window has passed.
 *
 * No audit row, for the reason `lib/verification/expiry-job.ts` gives: a cron
 * following a published sequence has no actor, and `AuditEvent.actorId` is NOT
 * NULL because the log records decisions. The decision was the ops lead's
 * notice, and that has its row.
 */
export async function sweepClosures(now: Date = new Date()): Promise<ClosureSweepResult> {
  const result: ClosureSweepResult = {
    applied: 0,
    withdrawnRenewed: 0,
    heldBySubscription: 0,
    finalised: 0,
    slugs: [],
  };

  const due = await prisma.businessClosure.findMany({
    where: { initiator: "platform", appliedAt: null, ...OPEN, effectiveAt: { lte: now } },
    select: { id: true, businessId: true, finalAt: true, ownerId: true },
  });

  for (const notice of due) {
    const business = await prisma.business.findUniqueOrThrow({
      where: { id: notice.businessId },
      select: { licenceExpiry: true, displayName: true },
    });

    if (business.licenceExpiry.getTime() > now.getTime()) {
      await prisma.businessClosure.update({
        where: { id: notice.id },
        data: { reversedAt: now, reversedVia: "licence_renewed" },
      });
      result.withdrawnRenewed += 1;
      continue;
    }

    /*
       Still charging, so not yet. B1 is about a seller's request, but the
       reason behind it — closing an account we are still charging produces a
       refund question we cannot answer — applies to our own closure just as
       much. It stays pending and the admin screen says why.
    */
    const blockers = await closureBlockers(notice.businessId, now);
    if (blockers.subscription) {
      result.heldBySubscription += 1;
      continue;
    }

    const applied = await prisma.$transaction(
      (tx) => applyClosure(tx, notice.id, notice.businessId, now),
      { timeout: 20_000 },
    );
    await afterApplied(applied);

    const owner = notice.ownerId
      ? await prisma.user.findUnique({ where: { id: notice.ownerId }, select: { email: true } })
      : null;
    await sendClosureEmail({
      kind: "applied",
      to: owner?.email ?? null,
      businessName: business.displayName,
      date: notice.finalAt,
    });

    result.applied += 1;
    result.slugs.push(applied.slug);
  }

  const ending = await prisma.businessClosure.findMany({
    where: { appliedAt: { not: null }, ...OPEN, finalAt: { lte: now } },
    select: { id: true, businessId: true, snapshot: true },
  });

  for (const closure of ending) {
    const snapshot = readSnapshot(closure.snapshot);
    await prisma.$transaction(async (tx) => {
      await tx.businessClosure.update({ where: { id: closure.id }, data: { finalisedAt: now } });
      await tx.business.update({ where: { id: closure.businessId }, data: { closedAt: now } });
      /*
         Channels go now, not at request. They were kept through the window so a
         reversal did not make every seat re-verify a WhatsApp number; once the
         closure is final they are addresses for a business nobody is on.
      */
      await tx.seatChannel.deleteMany({
        where: { userId: { in: snapshot.seats.map((seat) => seat.userId) }, user: { businessId: null } },
      });
    });
    result.finalised += 1;
  }

  return result;
}
