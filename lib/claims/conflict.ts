import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import { assertReason } from "@/lib/audit/write-audit";
import { assertCan, can } from "@/lib/auth/can";
import type { Actor, Role } from "@/lib/auth/roles";
import type { ClaimPartyReason, Prisma } from "@/lib/db/generated/client";
import { resolveEnquiryArea } from "@/lib/enquiry/area";
import { t } from "@/lib/i18n";
import { displayNameFor } from "@/lib/ingest/classify";
import { onClaimConflictResolved, onClaimDocumentsRequested } from "@/lib/notify/events";
import { normaliseLicenceNumber, sameLicenceNumber } from "@/lib/verification/licence/number";
import { lockListingClaims } from "./lock";
import { registerEntriesFor } from "./records";
import { seatOnAward, seatOnLoss } from "./seats";

/**
 * Board 4c — the decisions an ops lead makes about a conflict.
 *
 * Four of them end it and three do not:
 *
 *   - **resolve** — `award`, `split`, `merge_branch`, or `keep_owner` on a
 *     challenge. One call whichever control invoked it (`B2`): *Award to A* on
 *     the card and *Award to A & notify both* in the rail are the same
 *     `award`, and *Split into two listings* and *Create a separate listing for
 *     B* are the same `split`. Every resolution notifies every claimant (`B3`).
 *   - **escalate** to a named holder, pausing the clock (Q5).
 *   - **request documents** from every side — the registered tenancy contract
 *     for their unit (Q4) — with the clock running.
 *   - **log a call**, which is evidence only when it went to the number on the
 *     public licence record (`B7`) and which the decision log reads back.
 *
 * Every one is `claim.resolve` — ops lead alone, checked here on every write
 * and not only by what a screen offers (criterion 1). A moderator who opens a
 * conflict sees the evidence and may hand it to an ops lead through the
 * queue's assignment, and nothing else.
 *
 * Every one is a `staffMutation` whose reason is the internal note (`B4`). The
 * note never reaches a claimant: what a claimant who lost is told is one of
 * four fixed sentences, `ClaimSubmission.partyReason`, sent verbatim.
 */

export type Resolution = "award" | "split" | "merge_branch" | "keep_owner";

export const RESOLUTIONS: readonly Resolution[] = ["award", "split", "merge_branch", "keep_owner"];

export function isResolution(value: string): value is Resolution {
  return (RESOLUTIONS as readonly string[]).includes(value);
}

export const PARTY_REASONS: readonly ClaimPartyReason[] = [
  "not_source_licence",
  "details_do_not_match",
  "not_confirmed_by_phone",
  "documents_not_received",
];

export function isPartyReason(value: string): value is ClaimPartyReason {
  return (PARTY_REASONS as readonly string[]).includes(value);
}

export type ConflictError =
  | "not_found"
  | "closed"
  | "not_a_claim"
  | "challenge_award_refused"
  | "not_a_challenge"
  | "licence_lapsed"
  | "needs_a_second_claim"
  | "reason_required"
  | "needs_a_licence"
  | "licence_has_a_listing"
  | "split_needs_a_name"
  | "split_needs_an_expiry"
  | "holder_cannot_resolve"
  | "no_address"
  | "already_requested";

export type ConflictResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: ConflictError; claimId?: string };

export interface ResolveInput {
  actor: Actor;
  conflictId: string;
  resolution: Resolution;
  /** The claim that wins the listing: the award, or the side that keeps it on a split or a merge. */
  claimId?: string | null;
  /** The claim a split builds a listing for, or whose licence a merge makes a branch. */
  secondClaimId?: string | null;
  /** The internal note. Required, never shown to a claimant (`B4`). */
  note: string;
  /** What every other claimant is told. One of four, per claim (`B3`). */
  partyReasons: Readonly<Record<string, ClaimPartyReason>>;
  /** Only where the register holds nothing for the second claim's licence. */
  split?: { legalName?: string | null; licenceExpiry?: Date | null };
}

class Lost extends Error {
  constructor() {
    super("conflict closed concurrently");
    this.name = "ConflictLost";
  }
}


const CLAIM_FIELDS = {
  id: true,
  route: true,
  createdAt: true,
  decidedAt: true,
  claimantId: true,
  statedLicenceNumber: true,
  ocrLicenceNumber: true,
  statedLicenceExpiry: true,
  ocrLicenceExpiry: true,
  claimant: { select: { id: true, businessId: true, roles: true } },
} as const;

async function loadForDecision(tx: Prisma.TransactionClient, conflictId: string) {
  const conflict = await tx.claimConflict.findUnique({
    where: { id: conflictId },
    select: {
      id: true,
      businessId: true,
      challenge: true,
      resolvedAt: true,
      dissolvedAt: true,
      escalatedToId: true,
      submissionAId: true,
      submissionBId: true,
      business: {
        select: {
          id: true,
          claimStatus: true,
          licenceNumber: true,
          licenceAuthority: true,
          primaryCategoryId: true,
          sectorId: true,
          locations: {
            orderBy: [{ published: "desc" }, { createdAt: "asc" }, { id: "asc" }],
            take: 1,
            select: { emirate: true, areaId: true, addressLine: true },
          },
        },
      },
    },
  });
  if (!conflict) return null;
  const claims = await tx.claimSubmission.findMany({
    where: {
      OR: [
        { conflictId },
        { id: { in: [conflict.submissionAId, conflict.submissionBId].filter((id): id is string => id !== null) } },
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: CLAIM_FIELDS,
  });
  return { ...conflict, claims };
}

type Loaded = NonNullable<Awaited<ReturnType<typeof loadForDecision>>>;
type LoadedClaim = Loaded["claims"][number];

function licenceOf(claim: LoadedClaim, authority: string): string | null {
  const raw = claim.statedLicenceNumber ?? claim.ocrLicenceNumber;
  if (!raw) return null;
  const normalised = normaliseLicenceNumber(raw, authority);
  return normalised.ok ? normalised.value : raw.trim();
}

function expiryOf(claim: LoadedClaim): Date | null {
  return claim.statedLicenceExpiry ?? claim.ocrLicenceExpiry ?? null;
}

/**
 * What the resolution will do, checked before anything is written. The same
 * function the confirm sheet's numbers come from would be better still; the
 * sheet reads `conflictReviewFor`, which states the same facts.
 */
function plan(input: ResolveInput, conflict: Loaded, now: Date): ConflictResult<{ winner: LoadedClaim | null; second: LoadedClaim | null; losers: LoadedClaim[] }> {
  const live = conflict.claims.filter((claim) => claim.decidedAt === null);
  const byId = new Map(live.map((claim) => [claim.id, claim]));

  if (input.resolution === "keep_owner") {
    if (!conflict.challenge) return { ok: false, error: "not_a_challenge" };
    const losers = live;
    for (const loser of losers) {
      if (!input.partyReasons[loser.id]) return { ok: false, error: "reason_required", claimId: loser.id };
    }
    return { ok: true, winner: null, second: null, losers };
  }

  // §Flagged 2: the challenge case is not drawn, so the listing does not move.
  if (conflict.challenge) return { ok: false, error: "challenge_award_refused" };

  const winner = input.claimId ? byId.get(input.claimId) : undefined;
  if (!winner) return { ok: false, error: "not_a_claim" };
  const winnerExpiry = expiryOf(winner);
  if (winnerExpiry && winnerExpiry.getTime() < now.getTime()) return { ok: false, error: "licence_lapsed" };

  let second: LoadedClaim | null = null;
  if (input.resolution === "split" || input.resolution === "merge_branch") {
    second = input.secondClaimId ? (byId.get(input.secondClaimId) ?? null) : null;
    if (!second || second.id === winner.id) return { ok: false, error: "needs_a_second_claim" };
    const secondLicence = licenceOf(second, conflict.business.licenceAuthority);
    if (!secondLicence) return { ok: false, error: "needs_a_licence", claimId: second.id };
    // The listing's own licence is not a second company's, nor a branch of itself.
    if (sameLicenceNumber(secondLicence, conflict.business.licenceNumber, conflict.business.licenceAuthority)) {
      return { ok: false, error: "licence_has_a_listing", claimId: second.id };
    }
  }

  const losers = live.filter((claim) => claim.id !== winner.id && claim.id !== second?.id);
  for (const loser of losers) {
    if (!input.partyReasons[loser.id]) return { ok: false, error: "reason_required", claimId: loser.id };
  }
  return { ok: true, winner, second, losers };
}

async function heldEnquiries(tx: Prisma.TransactionClient, businessId: string): Promise<number> {
  return tx.enquiryRecipient.count({ where: { businessId, state: { in: ["delivered", "opened"] } } });
}

async function freeSlug(tx: Prisma.TransactionClient, base: string): Promise<string> {
  const root = base || "listing";
  for (let n = 0; n < 50; n += 1) {
    const candidate = n === 0 ? root : `${root}-${n + 1}`;
    const taken = await tx.business.findFirst({ where: { slug: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  throw new Error(`could not find a free slug from ${root}`);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Resolve a conflict. One transaction: the listing, every claim, every seat,
 * whatever the resolution builds, the conflict row and its one audit row naming
 * the actor, the resolution, the reason and every claim id (`B14`).
 */
export async function resolveConflict(
  input: ResolveInput,
  now = new Date(),
): Promise<ConflictResult<{ producedBusinessId: string | null; producedLocationId: string | null; enquiriesReleased: number }>> {
  assertCan(input.actor, "claim.resolve");
  assertReason("claim_resolved", input.note);

  const head = await prisma.claimConflict.findUnique({ where: { id: input.conflictId }, select: { businessId: true } });
  if (!head) return { ok: false, error: "not_found" };

  // The split's register read happens outside the lock: it reads the register, not the conflict.
  const precheck = await prisma.claimSubmission.findMany({
    where: { id: { in: [input.secondClaimId].filter((id): id is string => !!id) } },
    select: { statedLicenceNumber: true, ocrLicenceNumber: true, business: { select: { licenceAuthority: true } } },
  });
  const secondNumber = precheck[0] ? (precheck[0].statedLicenceNumber ?? precheck[0].ocrLicenceNumber) : null;
  const register =
    input.resolution === "split" && secondNumber && precheck[0]
      ? await registerEntriesFor([{ number: secondNumber, authority: precheck[0].business.licenceAuthority }])
      : new Map();
  const secondEntry = register.size > 0 ? [...register.values()][0]! : null;
  const areas =
    input.resolution === "split" || input.resolution === "merge_branch"
      ? await prisma.area.findMany({ select: { id: true, name: true, emirate: true } })
      : [];

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      await lockListingClaims(tx, head.businessId);
      const conflict = await loadForDecision(tx, input.conflictId);
      if (!conflict) throw new Lost();
      if (conflict.resolvedAt || conflict.dissolvedAt) throw new Lost();

      const checked = plan(input, conflict, now);
      if (!checked.ok) return checked;
      const { winner, second, losers } = checked;
      const business = conflict.business;
      const base = business.locations[0] ?? null;

      // Split: the second claim's licence must not already be a listing — that
      // listing is where they belong, and a copy of it is the duplicate 12b exists to undo.
      let split: { legalName: string; licenceNumber: string; licenceExpiry: Date } | null = null;
      if (input.resolution === "split" && second) {
        const licence = licenceOf(second, business.licenceAuthority)!;
        if (secondEntry?.businessId) {
          return { ok: false as const, error: "licence_has_a_listing" as const, claimId: second.id };
        }
        const legalName = (secondEntry?.tradeName ?? input.split?.legalName ?? "").trim();
        if (!legalName) return { ok: false as const, error: "split_needs_a_name" as const, claimId: second.id };
        const licenceExpiry = secondEntry?.licenceExpiry ?? expiryOf(second) ?? input.split?.licenceExpiry ?? null;
        if (!licenceExpiry) return { ok: false as const, error: "split_needs_an_expiry" as const, claimId: second.id };
        split = { legalName, licenceNumber: licence, licenceExpiry };
      }

      // A branch is a place: a listing with no address has nowhere to put one.
      if (input.resolution === "merge_branch" && !base) return { ok: false as const, error: "no_address" as const };

      const enquiriesReleased = await heldEnquiries(tx, business.id);
      const claimIds = conflict.claims.map((claim) => claim.id);

      return staffMutation(
        {
          actor: input.actor,
          capability: "claim.resolve",
          subject: `ClaimConflict:${conflict.id}`,
          reason: input.note,
          tx,
        },
        async () => {
          let producedBusinessId: string | null = null;
          let producedLocationId: string | null = null;

          /*
             The winner: the normal claim approval (`B11`). The listing is
             claimed and the winner holds its owner seat — which is also the
             release of everything the listing holds (`B9`): the enquiries
             waiting on it reach the winner's inbox through that seat and no
             other, because every losing seat goes in this same transaction.
             The tier does not move: claiming inherits history, not trust
             (`2a` criterion 7).
          */
          if (winner) {
            await tx.claimSubmission.update({
              where: { id: winner.id },
              data: {
                status: "claimed",
                outcome: "approved",
                partyReason: null,
                decidedAt: now,
                decidedById: input.actor.id,
                decisionReason: t("claim.decided.awarded"),
              },
            });
            await tx.business.update({ where: { id: business.id }, data: { claimStatus: "claimed" } });
            await tx.user.update({
              where: { id: winner.claimantId },
              data: seatOnAward({ businessId: winner.claimant.businessId, roles: winner.claimant.roles as Role[] }, business.id),
            });
          }

          // Split: a listing for the second claim, built from its licence record (`B12`).
          if (second && split) {
            const fromRegister = secondEntry ? resolveEnquiryArea(secondEntry.areaName, secondEntry.emirate, areas) : null;
            const areaId = fromRegister ?? base?.areaId ?? null;
            const emirate = areas.find((area) => area.id === areaId)?.emirate ?? base?.emirate ?? null;
            const created = await tx.business.create({
              data: {
                tradeName: split.legalName,
                displayName: displayNameFor(split.legalName),
                slug: await freeSlug(tx, slugify(displayNameFor(split.legalName))),
                licenceNumber: split.licenceNumber,
                licenceAuthority: business.licenceAuthority,
                licenceExpiry: split.licenceExpiry,
                primaryCategoryId: business.primaryCategoryId,
                sectorId: business.sectorId,
                claimStatus: "claimed",
                source: "self_added",
                // Unpublished: nothing on it has been checked, and its owner
                // finishes it through onboarding before it goes live.
                publishedAt: null,
                ...(areaId && emirate
                  ? {
                      locations: {
                        create: {
                          type: "head_office",
                          emirate: emirate as never,
                          areaId,
                          // The register keeps an area, not a street line; the shared premises are the best address there is.
                          addressLine: fromRegister && fromRegister !== base?.areaId ? (secondEntry?.areaName ?? "") : (base?.addressLine ?? ""),
                          published: true,
                        },
                      },
                    }
                  : {}),
              },
              select: { id: true },
            });
            producedBusinessId = created.id;
            // Off this listing, onto its own.
            const holder = { businessId: second.claimant.businessId, roles: second.claimant.roles as Role[] };
            await tx.user.update({
              where: { id: second.claimantId },
              data: seatOnAward(seatOnLoss(holder, business.id) ?? holder, created.id),
            });
            await tx.claimSubmission.update({
              where: { id: second.id },
              data: {
                status: "claimed",
                outcome: "rejected",
                partyReason: null,
                decidedAt: now,
                decidedById: input.actor.id,
                decisionReason: t("claim.decided.split"),
              },
            });
          }

          // Merge: the second claim's licence becomes a branch, keeping its own number (`B13`).
          if (second && base && input.resolution === "merge_branch") {
            const licence = licenceOf(second, business.licenceAuthority)!;
            const location = await tx.location.create({
              data: {
                businessId: business.id,
                type: "sales_office",
                emirate: base.emirate,
                areaId: base.areaId,
                addressLine: base.addressLine,
                licenceNumber: licence,
                /*
                   Held until the owner publishes it on `/dashboard/locations`.
                   12b's rule for a branch a person added to a claimed listing:
                   the owner is the one who knows whether the unit is theirs.
                */
                published: false,
              },
              select: { id: true },
            });
            producedLocationId = location.id;
            const seat = seatOnLoss({ businessId: second.claimant.businessId, roles: second.claimant.roles as Role[] }, business.id);
            if (seat) await tx.user.update({ where: { id: second.claimantId }, data: seat });
            await tx.claimSubmission.update({
              where: { id: second.id },
              data: {
                status: "claimed",
                outcome: "rejected",
                partyReason: null,
                decidedAt: now,
                decidedById: input.actor.id,
                decisionReason: t("claim.decided.merged"),
              },
            });
          }

          // Everybody else: not awarded, told one of four fixed reasons, seat back.
          for (const loser of losers) {
            const reason = input.partyReasons[loser.id]!;
            await tx.claimSubmission.update({
              where: { id: loser.id },
              data: {
                status: "claimed",
                outcome: "rejected",
                partyReason: reason,
                decidedAt: now,
                decidedById: input.actor.id,
                decisionReason: t(`claim.party_reason.${reason}`),
              },
            });
            const seat = seatOnLoss({ businessId: loser.claimant.businessId, roles: loser.claimant.roles as Role[] }, business.id);
            if (seat) await tx.user.update({ where: { id: loser.claimantId }, data: seat });
          }

          const resolution =
            input.resolution === "award"
              ? ("award" as const)
              : input.resolution === "split"
                ? ("split_into_two" as const)
                : input.resolution === "merge_branch"
                  ? ("merge_as_branches" as const)
                  : ("keep_owner" as const);

          const closed = await tx.claimConflict.updateMany({
            where: { id: conflict.id, resolvedAt: null, dissolvedAt: null },
            data: {
              resolution,
              resolvedAt: now,
              resolvedById: input.actor.id,
              reason: input.note.trim(),
              awardedSubmissionId: winner?.id ?? null,
              secondSubmissionId: second?.id ?? null,
              producedBusinessId,
              producedLocationId,
              buyersWaiting: enquiriesReleased,
            },
          });
          if (closed.count === 0) throw new Lost();

          return {
            result: { producedBusinessId, producedLocationId, enquiriesReleased },
            before: { claimStatus: business.claimStatus, claims: claimIds },
            after: {
              resolution,
              claimStatus: winner ? "claimed" : business.claimStatus,
              awarded: winner?.id ?? null,
              second: second?.id ?? null,
              notAwarded: losers.map((loser) => ({ claim: loser.id, partyReason: input.partyReasons[loser.id] })),
              producedBusinessId,
              producedLocationId,
              // B9: what the award released to the winner, and only to them.
              enquiriesReleased: winner ? enquiriesReleased : 0,
            },
          };
        },
      ).then((result) => ({ ok: true as const, ...result }));
    });

    if (outcome.ok) await onClaimConflictResolved({ conflictId: input.conflictId });
    return outcome;
  } catch (error) {
    if (error instanceof Lost) return { ok: false, error: "closed" };
    throw error;
  }
}

/** The staff who may hold an escalated conflict: those who could resolve it. */
export async function conflictHolders(): Promise<{ id: string; name: string }[]> {
  const rows = await prisma.user.findMany({
    where: { roles: { has: "staff_ops_lead" } },
    orderBy: [{ fullName: "asc" }, { id: "asc" }],
    select: { id: true, fullName: true, email: true, roles: true },
  });
  return rows
    .filter((row) => can({ id: row.id, roles: row.roles as Role[] }, "claim.resolve"))
    .map((row) => ({ id: row.id, name: row.fullName ?? row.email ?? row.id }));
}

/**
 * Escalate to a named holder (Q5, `D-ESCALATE`). The clock pauses, the queue
 * shows the row as escalated rather than overdue, and nobody's grants change:
 * the holder is staff who could already resolve it.
 */
export async function escalateConflict(
  input: { actor: Actor; conflictId: string; holderId: string; note: string },
  now = new Date(),
): Promise<ConflictResult> {
  assertCan(input.actor, "claim.resolve");
  assertReason("claim_escalated", input.note);
  const holder = await prisma.user.findUnique({ where: { id: input.holderId }, select: { id: true, roles: true } });
  if (!holder || !can({ id: holder.id, roles: holder.roles as Role[] }, "claim.resolve")) {
    return { ok: false, error: "holder_cannot_resolve" };
  }
  return closedOr(input.conflictId, async (tx, conflict) =>
    staffMutation(
      { actor: input.actor, capability: "claim.resolve", action: "claim_escalated", subject: `ClaimConflict:${conflict.id}`, reason: input.note, tx },
      async () => {
        await tx.claimConflict.update({
          where: { id: conflict.id },
          data: { escalatedAt: now, escalatedById: input.actor.id, escalatedToId: holder.id, escalationNote: input.note.trim() },
        });
        return {
          result: { ok: true as const },
          before: { escalatedToId: conflict.escalatedToId },
          after: { escalatedToId: holder.id, escalatedAt: now.toISOString() },
        };
      },
    ),
  );
}

/**
 * Ask every side for the registered tenancy contract for their unit (Q4,
 * `D-DOCS`). Each claimant can get their own without the other — a
 * no-objection letter from the other party would have told each that the
 * other exists (`2a` AC5). The clock keeps running (`4c-s` B6).
 */
export async function requestConflictDocuments(
  input: { actor: Actor; conflictId: string; note: string },
  now = new Date(),
): Promise<ConflictResult> {
  assertCan(input.actor, "claim.resolve");
  assertReason("claim_docs_requested", input.note);
  const result = await closedOr(input.conflictId, async (tx, conflict) => {
    if (conflict.docsRequestedAt && !conflict.docsReceivedAt) return { ok: false as const, error: "already_requested" as const };
    return staffMutation(
      { actor: input.actor, capability: "claim.resolve", action: "claim_docs_requested", subject: `ClaimConflict:${conflict.id}`, reason: input.note, tx },
      async () => {
        await tx.claimConflict.update({
          where: { id: conflict.id },
          data: { docsRequestedAt: now, docsRequestedById: input.actor.id, docsRequestNote: input.note.trim(), docsReceivedAt: null },
        });
        return { result: { ok: true as const }, before: null, after: { docsRequestedAt: now.toISOString(), document: "tenancy_contract" } };
      },
    );
  });
  if (result.ok) await onClaimDocumentsRequested({ conflictId: input.conflictId });
  return result;
}

export type CallTarget = "public_record" | "claimant_supplied";

/**
 * A call, logged. Evidence only when it went to the number on the public
 * licence record (`B7`); a number the claimant supplied proves contact, not
 * ownership — the decision log says which, and the strength rule reads only
 * the first kind (Q1). The note is the reason, as on every audited action.
 */
export async function logConflictCall(input: {
  actor: Actor;
  conflictId: string;
  claimId: string;
  to: CallTarget;
  confirmed: boolean;
  note: string;
}): Promise<ConflictResult> {
  assertCan(input.actor, "claim.resolve");
  assertReason("claim_call_logged", input.note);
  return closedOr(input.conflictId, async (tx, conflict) => {
    const sides = [conflict.submissionAId, conflict.submissionBId].filter((id): id is string => id !== null);
    const claim = await tx.claimSubmission.findFirst({
      where: { id: input.claimId, OR: [{ conflictId: conflict.id }, { id: { in: sides } }] },
      select: { id: true },
    });
    if (!claim) return { ok: false as const, error: "not_a_claim" as const };
    return staffMutation(
      { actor: input.actor, capability: "claim.resolve", action: "claim_call_logged", subject: `ClaimConflict:${conflict.id}`, reason: input.note, tx },
      async () => ({
        result: { ok: true as const },
        before: null,
        after: { claim: claim.id, to: input.to, confirmed: input.confirmed },
      }),
    );
  });
}

interface OpenConflict {
  id: string;
  submissionAId: string;
  submissionBId: string | null;
  escalatedToId: string | null;
  docsRequestedAt: Date | null;
  docsReceivedAt: Date | null;
}

/** Runs a decision against an open conflict, under the listing's claim lock, or says it is closed. */
async function closedOr(
  conflictId: string,
  run: (tx: Prisma.TransactionClient, conflict: OpenConflict) => Promise<ConflictResult>,
): Promise<ConflictResult> {
  const head = await prisma.claimConflict.findUnique({ where: { id: conflictId }, select: { businessId: true } });
  if (!head) return { ok: false, error: "not_found" };
  try {
    return await prisma.$transaction(async (tx) => {
      await lockListingClaims(tx, head.businessId);
      const conflict = await tx.claimConflict.findUnique({
        where: { id: conflictId },
        select: {
          id: true,
          resolvedAt: true,
          dissolvedAt: true,
          submissionAId: true,
          submissionBId: true,
          escalatedToId: true,
          docsRequestedAt: true,
          docsReceivedAt: true,
        },
      });
      if (!conflict || conflict.resolvedAt || conflict.dissolvedAt) throw new Lost();
      return run(tx, conflict);
    });
  } catch (error) {
    if (error instanceof Lost) return { ok: false, error: "closed" };
    throw error;
  }
}
