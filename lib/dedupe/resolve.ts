import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import { assertCan, can } from "@/lib/auth/can";
import { PermissionError } from "@/lib/auth/errors";
import type { Actor } from "@/lib/auth/roles";
import { Prisma } from "@/lib/db/generated/client";
import type { Emirate } from "@/lib/db/generated/enums";
import { resolveEnquiryArea } from "@/lib/enquiry/area";
import { categorySlugFor, stagedOutcome } from "@/lib/ingest/classify";
import { runCounts } from "@/lib/ingest/counts";
import { chooseParent } from "./match";
import { licenceDigits } from "./similarity";
import {
  listingFacts,
  mergeListingsTx,
  MergeRefusal,
  REVERSIBLE_DAYS,
  separatedData,
  unmergeTx,
  withdrawPairsTouching,
} from "./service";
import { readBands } from "./source";

/**
 * Board 12b — resolving a pair.
 *
 * Three outcomes, all first-class (B2): **add B as a branch of A**, **keep as
 * separate listings**, **discard B**. A skip is none of them and writes nothing
 * (B3). Every outcome is a `staffMutation` with the acting user (B6), and every
 * one is reversible for thirty days — including a keep-separate, which is a
 * decision about a real company like the other two.
 *
 * A pair has two shapes and one set of outcomes:
 *
 *   record   a row from an import run against the listing it may duplicate.
 *            A branch is a new location on the listing, carrying the record's
 *            own licence number (B9). Keep-separate sends the record back to
 *            its run to publish as a listing of its own. Discard marks it a
 *            source error.
 *   listing  two listings. A branch is a merge: everything B has moves to A,
 *            B keeps its row and 301s. Keep-separate is the old dismissal.
 *            Discard takes B off the directory — only when B has nothing on it.
 *
 * ## The parent is not the reviewer's choice (B1)
 *
 * Record A of a record pair is the listing; a registry row has nothing to
 * lose. For two listings `chooseParent` decides — claimed, then paying, then
 * history — whichever side was drawn on the left. Two claimed listings (Q3)
 * are two owners and two subscriptions: this screen can keep them separate and
 * cannot merge or discard either.
 *
 * ## The owner's say (Q2)
 *
 * A branch added from the manual band to a listing somebody has claimed is
 * created unpublished and waits for the owner, who is the only person who
 * knows whether Shop 12 is theirs. A branch from a bulk merge is live and the
 * owner may still reject it while the merge is reversible. The owner answers
 * on their locations page (`decideBranch`).
 */

const DAY_MS = 86_400_000;

export type Outcome = "merge" | "separate" | "discard";

export type ResolveError =
  | "not_found"
  | "already_resolved"
  | "withdrawn"
  | "both_claimed"
  | "area_needed"
  | "has_history";

export type ResolveResult =
  | { ok: true; outcome: Outcome; parentName: string; heldForOwner: boolean }
  | { ok: false; error: ResolveError; message: string };

/** What a record pair's resolution changed, for its reversal. */
export interface RecordManifest {
  kind: "record";
  outcome: Outcome;
  locationId: string | null;
  previousDuplicateOfId: string | null;
}

/** What a listing pair's resolution changed beyond `BusinessMerge`. */
export interface ListingManifest {
  kind: "listing";
  outcome: Outcome;
  parentId: string | null;
  childId: string | null;
  previousPublishedAt: string | null;
}

const PENDING_PAIR = { state: "pending", mergeId: null, dismissedAt: null } as const;
const OPEN_RUN = new Set(["staged", "approved"]);

function newBatchId(): string {
  return `c${Date.now().toString(36)}${randomBytes(8).toString("hex")}`.slice(0, 25);
}

const pairSelect = {
  id: true,
  keepId: true,
  absorbId: true,
  stagedListingId: true,
  sourceRunId: true,
  score: true,
  band: true,
  state: true,
  mergeId: true,
  dismissedAt: true,
  reversedAt: true,
  reversibleUntil: true,
  resolvedAt: true,
  manifest: true,
  batchId: true,
  ownerConfirmation: true,
  keep: {
    select: {
      id: true,
      displayName: true,
      claimStatus: true,
      mergedIntoId: true,
      publishedAt: true,
      licenceNumber: true,
      locations: { select: { areaId: true, licenceNumber: true } },
    },
  },
  absorb: { select: { id: true, mergedIntoId: true, publishedAt: true, claimStatus: true } },
  stagedListing: {
    select: {
      id: true,
      runId: true,
      disposition: true,
      licenceNumber: true,
      emirate: true,
      areaName: true,
      phone: true,
      activityKey: true,
      duplicateOfId: true,
      run: { select: { status: true } },
    },
  },
} satisfies Prisma.MergeCandidateSelect;

type PairRow = Prisma.MergeCandidateGetPayload<{ select: typeof pairSelect }>;

/** Why a pending pair is no longer a question, or null if it still is. */
function staleBecause(pair: PairRow): string | null {
  if (pair.keep.mergedIntoId) return "merged_elsewhere";
  if (!pair.keep.publishedAt && pair.keep.claimStatus === "unclaimed") return "listing_withdrawn";
  if (pair.absorb) {
    if (pair.absorb.mergedIntoId) return "merged_elsewhere";
    if (!pair.absorb.publishedAt && pair.absorb.claimStatus === "unclaimed") return "listing_withdrawn";
  }
  if (pair.stagedListing) {
    if (pair.stagedListing.disposition !== "duplicate") return "record_moved";
    if (!OPEN_RUN.has(pair.stagedListing.run.status)) return "run_closed";
  }
  return null;
}

const WITHDRAWN_MESSAGE: Record<string, string> = {
  merged_elsewhere: "One side of that pair has been merged into another listing, so the pair was withdrawn.",
  listing_withdrawn: "One side of that pair is no longer in the directory, so the pair was withdrawn.",
  record_moved: "That record has already been resolved another way, so the pair was withdrawn.",
  run_closed: "The run that record came from was discarded or rolled back, so the pair was withdrawn.",
};

async function areas() {
  return prisma.area.findMany({ select: { id: true, name: true, emirate: true } });
}

/**
 * The branch a record would become: its area, and whether the listing already
 * has that address under that licence — a re-sent row, not a new branch.
 */
function branchPlan(
  pair: PairRow,
  areaList: { id: string; name: string; emirate: string }[],
  chosenAreaId: string | null | undefined,
) {
  const record = pair.stagedListing!;
  const areaId = chosenAreaId || resolveEnquiryArea(record.areaName, record.emirate, areaList);
  const area = areaId ? areaList.find((row) => row.id === areaId) : undefined;
  const recordDigits = licenceDigits(record.licenceNumber ?? "");
  const alreadyListed =
    !!areaId &&
    pair.keep.locations.some(
      (location) =>
        location.areaId === areaId &&
        licenceDigits(location.licenceNumber ?? pair.keep.licenceNumber) === recordDigits,
    );
  return { areaId: area ? area.id : null, area, alreadyListed };
}

/** A record's disposition as its run would have staged it with no pair. */
async function standaloneDisposition(
  tx: Prisma.TransactionClient,
  record: { activityKey: string; id: string },
) {
  const full = await tx.stagedListing.findUniqueOrThrow({
    where: { id: record.id },
    select: { activity: true, activityKey: true },
  });
  const [mapping, signal] = await Promise.all([
    full.activityKey
      ? tx.licenceActivityMapping.findUnique({ where: { activityKey: full.activityKey }, select: { categoryId: true } })
      : Promise.resolve(null),
    (async () => {
      const slug = categorySlugFor(full.activity);
      if (!slug) return null;
      return tx.category.findUnique({ where: { slug }, select: { id: true } });
    })(),
  ]);
  return stagedOutcome({
    verdict: { disposition: "ready", ground: null, categorySlug: null },
    duplicate: false,
    mappedCategoryId: mapping?.categoryId ?? null,
    signalCategoryId: signal?.id ?? null,
  });
}

/* ── One pair ────────────────────────────────────────────────────────────── */

export async function resolvePair(
  input: { actor: Actor; candidateId: string; outcome: Outcome; reason: string; areaId?: string | null },
  now = new Date(),
): Promise<ResolveResult> {
  assertCan(input.actor, "business.merge");

  const pair = await prisma.mergeCandidate.findUnique({ where: { id: input.candidateId }, select: pairSelect });
  if (!pair) return { ok: false, error: "not_found", message: "That pair is not in the queue." };
  if (pair.state !== "pending" || pair.mergeId || pair.dismissedAt) {
    return {
      ok: false,
      error: pair.state === "withdrawn" ? "withdrawn" : "already_resolved",
      message: "Somebody already decided that pair.",
    };
  }

  const stale = staleBecause(pair);
  if (stale) {
    await prisma.mergeCandidate.update({
      where: { id: pair.id },
      data: { state: "withdrawn", withdrawnReason: stale },
    });
    return { ok: false, error: "withdrawn", message: WITHDRAWN_MESSAGE[stale]! };
  }

  if (pair.stagedListing) return resolveRecordPair(pair, input, now);
  return resolveListingPair(pair, input, now);
}

async function resolveRecordPair(
  pair: PairRow,
  input: { actor: Actor; outcome: Outcome; reason: string; areaId?: string | null },
  now: Date,
): Promise<ResolveResult> {
  const record = pair.stagedListing!;
  const claimed = pair.keep.claimStatus !== "unclaimed";
  const areaList = input.outcome === "merge" ? await areas() : [];
  const plan = input.outcome === "merge" ? branchPlan(pair, areaList, input.areaId) : null;

  if (plan && !plan.areaId) {
    return {
      ok: false,
      error: "area_needed",
      message: `The register gives "${record.areaName ?? "no area"}", which is not an area we list. Choose the branch's area, then merge.`,
    };
  }

  const heldForOwner = input.outcome === "merge" && claimed && !plan!.alreadyListed;
  const action = input.outcome === "merge" ? "pair_merged" : input.outcome === "separate" ? "pair_separated" : "pair_discarded";

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "business.merge",
        action,
        subject: `Business:${pair.keepId}`,
        reason: input.reason,
        tx,
      },
      async () => {
        const manifest: RecordManifest = {
          kind: "record",
          outcome: input.outcome,
          locationId: null,
          previousDuplicateOfId: record.duplicateOfId,
        };

        if (input.outcome === "merge") {
          if (!plan!.alreadyListed) {
            const location = await tx.location.create({
              data: {
                businessId: pair.keepId,
                type: "sales_office",
                emirate: plan!.area!.emirate as Emirate,
                areaId: plan!.areaId!,
                addressLine: record.areaName?.trim() || plan!.area!.name,
                phone: record.phone,
                licenceNumber: record.licenceNumber,
                addedByCandidateId: pair.id,
                // Q2: a listing somebody has claimed gets the branch when they
                // say it is theirs, not before.
                published: !claimed,
                publishedAt: claimed ? null : now,
              },
              select: { id: true },
            });
            manifest.locationId = location.id;
          }
          await tx.stagedListing.update({
            where: { id: record.id },
            data: { disposition: "merged", businessId: pair.keepId },
          });
        } else if (input.outcome === "separate") {
          const outcome = await standaloneDisposition(tx, record);
          await tx.stagedListing.update({
            where: { id: record.id },
            data: {
              disposition: outcome.disposition,
              categoryId: outcome.categoryId,
              categorySource: outcome.categorySource,
              duplicateOfId: null,
              duplicateOfRow: null,
            },
          });
        } else {
          await tx.stagedListing.update({ where: { id: record.id }, data: { disposition: "discarded" } });
        }

        await tx.mergeCandidate.update({
          where: { id: pair.id },
          data: {
            state: input.outcome === "merge" ? "merged" : input.outcome === "separate" ? "separated" : "discarded",
            resolvedAt: now,
            resolvedById: input.actor.id,
            resolutionReason: input.reason.trim(),
            reversibleUntil: new Date(now.getTime() + REVERSIBLE_DAYS * DAY_MS),
            manifest: manifest as unknown as Prisma.InputJsonValue,
            ownerConfirmation: heldForOwner ? "awaiting" : "not_needed",
          },
        });

        const counts = await runCounts(tx, record.runId);
        await tx.licenceImportRun.update({ where: { id: record.runId }, data: counts });

        return {
          result: null,
          before: { state: "pending", disposition: "duplicate" },
          after: {
            candidateId: pair.id,
            kind: "record",
            outcome: input.outcome,
            recordId: record.id,
            parentId: pair.keepId,
            score: pair.score,
            band: pair.band,
            locationId: manifest.locationId,
            heldForOwner,
          },
        };
      },
    ),
  );

  return { ok: true, outcome: input.outcome, parentName: pair.keep.displayName, heldForOwner };
}

async function resolveListingPair(
  pair: PairRow,
  input: { actor: Actor; outcome: Outcome; reason: string },
  now: Date,
): Promise<ResolveResult> {
  const facts = await listingFacts(prisma, [pair.keepId, pair.absorbId!]);
  const choice = chooseParent(facts.get(pair.keepId)!, facts.get(pair.absorbId!)!);

  if (choice.kind === "both_claimed" && input.outcome !== "separate") {
    return {
      ok: false,
      error: "both_claimed",
      message:
        "Both listings are claimed. Two owners and two subscriptions are a support conversation, not a merge; keep them separate or skip.",
    };
  }

  const parentId = choice.kind === "parent" ? choice.parentId : null;
  const childId = choice.kind === "parent" ? choice.childId : null;
  const parent = parentId ? facts.get(parentId)! : null;
  const child = childId ? facts.get(childId)! : null;

  if (input.outcome === "discard" && child && (child.claimed || child.paying || child.reviews + child.products + child.enquiries > 0)) {
    return {
      ok: false,
      error: "has_history",
      message: `${child.displayName} has reviews, products or enquiries on it. Discarding would hide them; merge it as a branch instead.`,
    };
  }

  const heldForOwner = input.outcome === "merge" && !!parent?.claimed && pair.band !== "certain";
  const action = input.outcome === "merge" ? "pair_merged" : input.outcome === "separate" ? "pair_separated" : "pair_discarded";

  try {
    await prisma.$transaction(
      async (tx) =>
        staffMutation(
          {
            actor: input.actor,
            capability: "business.merge",
            action,
            // The listing the decision happens to: the one absorbed or discarded,
            // which B1 decides — not whichever side the scan stored second.
            subject: `Business:${childId ?? pair.absorbId}`,
            reason: input.reason,
            tx,
          },
          async () => {
            const manifest: ListingManifest = {
              kind: "listing",
              outcome: input.outcome,
              parentId,
              childId,
              previousPublishedAt: child?.publishedAt?.toISOString() ?? null,
            };
            let mergeId: string | null = null;

            if (input.outcome === "merge") {
              const merged = await mergeListingsTx(tx, {
                actorId: input.actor.id,
                keepId: parentId!,
                absorbId: childId!,
                reason: input.reason,
                now,
                holdLocations: heldForOwner,
                candidateId: pair.id,
              });
              mergeId = merged.mergeId;
              // The owner answers for the branches that arrived, so the ones
              // that arrived are marked — held or live.
              if (parent?.claimed) await tagMovedLocations(tx, mergeId, pair.id);
            } else if (input.outcome === "discard") {
              await tx.business.update({ where: { id: childId! }, data: { publishedAt: null } });
              await withdrawPairsTouching(tx, childId!, "listing_withdrawn", pair.id);
            }

            await tx.mergeCandidate.update({
              where: { id: pair.id },
              data: {
                ...(input.outcome === "separate"
                  ? separatedData(input.actor.id, input.reason, now)
                  : {
                      state: input.outcome === "merge" ? ("merged" as const) : ("discarded" as const),
                      resolvedAt: now,
                      resolvedById: input.actor.id,
                      resolutionReason: input.reason.trim(),
                      reversibleUntil: new Date(now.getTime() + REVERSIBLE_DAYS * DAY_MS),
                    }),
                mergeId,
                manifest: manifest as unknown as Prisma.InputJsonValue,
                ownerConfirmation: heldForOwner ? "awaiting" : parent?.claimed && input.outcome === "merge" ? "informed" : "not_needed",
              },
            });

            return {
              result: null,
              before: { state: "pending" },
              after: {
                candidateId: pair.id,
                kind: "listing",
                outcome: input.outcome,
                parentId,
                childId,
                score: pair.score,
                band: pair.band,
                mergeId,
                heldForOwner,
              },
            };
          },
        ),
      { timeout: 60_000, maxWait: 10_000 },
    );
  } catch (error) {
    if (error instanceof MergeRefusal) {
      return { ok: false, error: "withdrawn", message: "One of those listings has already been merged into another." };
    }
    throw error;
  }

  return {
    ok: true,
    outcome: input.outcome,
    parentName: (parent ?? facts.get(pair.keepId)!).displayName,
    heldForOwner,
  };
}

async function tagMovedLocations(tx: Prisma.TransactionClient, mergeId: string, candidateId: string): Promise<void> {
  const merge = await tx.businessMerge.findUniqueOrThrow({ where: { id: mergeId }, select: { manifest: true } });
  const ids = (merge.manifest as { location?: string[] }).location ?? [];
  if (ids.length === 0) return;
  await tx.location.updateMany({
    where: { id: { in: ids }, addedByCandidateId: null },
    data: { addedByCandidateId: candidateId },
  });
}

/* ── Many pairs — B4 ─────────────────────────────────────────────────────── */

export type BulkResult =
  | {
      ok: true;
      batchId: string;
      merged: number;
      /** Record pairs whose registry area is not one we list: left for a person. */
      skippedArea: number;
      /** Two claimed listings: never merged by a rule (Q3). */
      skippedBothClaimed: number;
      withdrawn: number;
    }
  | { ok: false; error: "nothing_to_merge"; message: string };

/** One bulk merge takes at most this many pairs; the rest wait for the next. */
export const BULK_LIMIT = 2_000;

/**
 * Every pending pair at or above the certain line, merged as one unit.
 *
 * One transaction, one audit row, one `MergeBatch` every merge points at, and
 * one reversal (B4). Two kinds of pair are left in the queue rather than merged
 * by a rule: a record whose area the register names in a way we cannot place,
 * and two claimed listings.
 *
 * Branches added to claimed listings here are live — above the certain line a
 * notice is right and a consent dialog is not (Q2) — and the owner can still
 * reject one from their locations page while the batch is reversible.
 */
export async function bulkMerge(
  input: { actor: Actor; reason: string; runId?: string | null; limit?: number },
  now = new Date(),
): Promise<BulkResult> {
  assertCan(input.actor, "business.merge");
  const bands = await readBands();
  const limit = Math.min(input.limit ?? BULK_LIMIT, BULK_LIMIT);

  const pairs = await prisma.mergeCandidate.findMany({
    where: {
      ...PENDING_PAIR,
      band: "certain",
      score: { gte: bands.certain },
      ...(input.runId ? { sourceRunId: input.runId } : {}),
    },
    orderBy: [{ score: "desc" }, { id: "asc" }],
    take: limit,
    select: pairSelect,
  });

  const areaList = await areas();
  const listingIds = pairs.filter((pair) => pair.absorbId).flatMap((pair) => [pair.keepId, pair.absorbId!]);
  const facts = await listingFacts(prisma, listingIds);

  let skippedArea = 0;
  let skippedBothClaimed = 0;
  const stale: { id: string; reason: string }[] = [];
  const records: { pair: PairRow; plan: ReturnType<typeof branchPlan> }[] = [];
  const listings: { pair: PairRow; parentId: string; childId: string; parentClaimed: boolean }[] = [];

  for (const pair of pairs) {
    const why = staleBecause(pair);
    if (why) {
      stale.push({ id: pair.id, reason: why });
      continue;
    }
    if (pair.stagedListing) {
      const plan = branchPlan(pair, areaList, null);
      if (!plan.areaId) skippedArea += 1;
      else records.push({ pair, plan });
    } else {
      const choice = chooseParent(facts.get(pair.keepId)!, facts.get(pair.absorbId!)!);
      if (choice.kind === "both_claimed") skippedBothClaimed += 1;
      else
        listings.push({
          pair,
          parentId: choice.parentId,
          childId: choice.childId,
          parentClaimed: facts.get(choice.parentId)!.claimed,
        });
    }
  }

  if (stale.length > 0) {
    for (const item of stale) {
      await prisma.mergeCandidate.update({ where: { id: item.id }, data: { state: "withdrawn", withdrawnReason: item.reason } });
    }
  }

  if (records.length + listings.length === 0) {
    return {
      ok: false,
      error: "nothing_to_merge",
      message: "No pair above the certain line can be merged by a rule right now.",
    };
  }

  const batchId = newBatchId();
  const reversibleUntil = new Date(now.getTime() + REVERSIBLE_DAYS * DAY_MS);
  const reason = input.reason.trim();

  await prisma.$transaction(
    async (tx) =>
      staffMutation(
        {
          actor: input.actor,
          capability: "business.merge",
          action: "pairs_bulk_merged",
          subject: `MergeBatch:${batchId}`,
          reason: input.reason,
          tx,
        },
        async () => {
          await tx.mergeBatch.create({
            data: {
              id: batchId,
              actorId: input.actor.id,
              reason,
              certainLine: bands.certain,
              pairCount: records.length + listings.length,
              reversibleUntil,
            },
          });

          const CHUNK = 500;
          for (let i = 0; i < records.length; i += CHUNK) {
            const slice = records.slice(i, i + CHUNK);
            const toCreate = slice.filter((item) => !item.plan.alreadyListed);
            const created =
              toCreate.length === 0
                ? []
                : await tx.location.createManyAndReturn({
                    data: toCreate.map(({ pair, plan }) => ({
                      businessId: pair.keepId,
                      type: "sales_office" as const,
                      emirate: plan.area!.emirate as Emirate,
                      areaId: plan.areaId!,
                      addressLine: pair.stagedListing!.areaName?.trim() || plan.area!.name,
                      phone: pair.stagedListing!.phone,
                      licenceNumber: pair.stagedListing!.licenceNumber,
                      addedByCandidateId: pair.id,
                      published: true,
                      publishedAt: now,
                    })),
                    select: { id: true, addedByCandidateId: true },
                  });
            const locationFor = new Map(created.map((row) => [row.addedByCandidateId!, row.id]));

            const recordRows = slice.map(({ pair }) => Prisma.sql`(${pair.stagedListingId}, ${pair.keepId})`);
            await tx.$executeRaw`
              UPDATE "staged_listing" AS s
                 SET "disposition" = 'merged'::"staged_disposition", "business_id" = v.business_id
                FROM (VALUES ${Prisma.join(recordRows)}) AS v(id, business_id)
               WHERE s."id" = v.id`;

            const pairRows = slice.map(({ pair, plan }) => {
              const manifest: RecordManifest = {
                kind: "record",
                outcome: "merge",
                locationId: locationFor.get(pair.id) ?? null,
                previousDuplicateOfId: pair.stagedListing!.duplicateOfId,
              };
              const owner = pair.keep.claimStatus !== "unclaimed" && !plan.alreadyListed ? "informed" : "not_needed";
              return Prisma.sql`(${pair.id}, ${JSON.stringify(manifest)}, ${owner})`;
            });
            await tx.$executeRaw`
              UPDATE "merge_candidate" AS c
                 SET "state" = 'merged'::"merge_candidate_state",
                     "resolved_at" = ${now},
                     "resolved_by_id" = ${input.actor.id}::uuid,
                     "resolution_reason" = ${reason},
                     "batch_id" = ${batchId},
                     "reversible_until" = ${reversibleUntil},
                     "manifest" = v.manifest::jsonb,
                     "owner_confirmation" = v.owner::"owner_confirmation"
                FROM (VALUES ${Prisma.join(pairRows)}) AS v(id, manifest, owner)
               WHERE c."id" = v.id`;
          }

          for (const { pair, parentId, childId, parentClaimed } of listings) {
            const merged = await mergeListingsTx(tx, {
              actorId: input.actor.id,
              keepId: parentId,
              absorbId: childId,
              reason,
              now,
              batchId,
              // Every pair in this batch is merged by it, not withdrawn by a
              // sibling merge that happened to run first.
              candidateId: pair.id,
            });
            if (parentClaimed) await tagMovedLocations(tx, merged.mergeId, pair.id);
            const manifest: ListingManifest = {
              kind: "listing",
              outcome: "merge",
              parentId,
              childId,
              previousPublishedAt: facts.get(childId)!.publishedAt?.toISOString() ?? null,
            };
            await tx.mergeCandidate.update({
              where: { id: pair.id },
              data: {
                state: "merged",
                mergeId: merged.mergeId,
                batchId,
                resolvedAt: now,
                resolvedById: input.actor.id,
                resolutionReason: reason,
                reversibleUntil,
                manifest: manifest as unknown as Prisma.InputJsonValue,
                ownerConfirmation: parentClaimed ? "informed" : "not_needed",
              },
            });
          }

          for (const runId of new Set(records.map(({ pair }) => pair.stagedListing!.runId))) {
            await tx.licenceImportRun.update({ where: { id: runId }, data: await runCounts(tx, runId) });
          }

          return {
            result: null,
            before: { pending: pairs.length },
            after: {
              batchId,
              merged: records.length + listings.length,
              recordPairs: records.length,
              listingPairs: listings.length,
              skippedArea,
              skippedBothClaimed,
              certainLine: bands.certain,
            },
          };
        },
      ),
    { timeout: 120_000, maxWait: 10_000 },
  );

  return {
    ok: true,
    batchId,
    merged: records.length + listings.length,
    skippedArea,
    skippedBothClaimed,
    withdrawn: stale.length,
  };
}

/* ── Putting it back ─────────────────────────────────────────────────────── */

export type ReverseError =
  | "not_found"
  | "not_resolved"
  | "window_closed"
  | "owner_confirmed"
  | "record_published"
  | "already_reversed";

export type ReverseResult = { ok: true } | { ok: false; error: ReverseError; message: string };

/** A refusal inside a reversal transaction, carried out as a result. */
export class ReverseRefusal extends Error {
  constructor(
    readonly error: ReverseError,
    message: string,
  ) {
    super(message);
    this.name = "ReverseRefusal";
  }
}

type ReverseMode = "staff" | "owner" | "rollback";

/**
 * Undo one resolution inside the caller's transaction, and leave the pair
 * pending. Criterion 9: both records as they were — the branch location gone,
 * the record a duplicate again, a discarded listing live again, a merge
 * replayed backwards.
 *
 * A branch the owner confirmed is theirs, and neither a person on this screen
 * nor a run rollback takes it away (B5); only the owner's own rejection, which
 * is `mode: "owner"`, reaches past that.
 */
export async function reverseResolutionTx(
  tx: Prisma.TransactionClient,
  candidateId: string,
  input: { actorId: string; reason: string; now: Date; mode: ReverseMode },
): Promise<void> {
  const pair = await tx.mergeCandidate.findUnique({ where: { id: candidateId }, select: pairSelect });
  if (!pair) throw new ReverseRefusal("not_found", "That decision is not on record.");
  if (pair.state === "pending" || pair.state === "withdrawn") {
    throw new ReverseRefusal("not_resolved", "That pair has not been decided, so there is nothing to put back.");
  }
  if (input.mode === "staff" && pair.reversibleUntil && pair.reversibleUntil.getTime() < input.now.getTime()) {
    throw new ReverseRefusal(
      "window_closed",
      `A decision is reversible for ${REVERSIBLE_DAYS} days. This one closed on ${pair.reversibleUntil.toISOString().slice(0, 10)}.`,
    );
  }
  if (input.mode !== "owner" && pair.ownerConfirmation === "confirmed") {
    throw new ReverseRefusal(
      "owner_confirmed",
      `The owner of ${pair.keep.displayName} confirmed this branch is theirs. It is not put back from here.`,
    );
  }

  if (pair.stagedListing) {
    const manifest = pair.manifest as unknown as RecordManifest | null;
    const record = await tx.stagedListing.findUniqueOrThrow({
      where: { id: pair.stagedListingId! },
      select: { disposition: true },
    });
    if (pair.state === "separated" && record.disposition === "published") {
      throw new ReverseRefusal(
        "record_published",
        "That record has since published as a listing of its own. Pair the two listings instead of putting this back.",
      );
    }
    if (manifest?.locationId) await tx.location.deleteMany({ where: { id: manifest.locationId } });
    await tx.stagedListing.update({
      where: { id: pair.stagedListingId! },
      data: {
        disposition: "duplicate",
        businessId: null,
        duplicateOfId: manifest?.previousDuplicateOfId ?? pair.keepId,
        duplicateOfRow: null,
        categoryId: null,
        categorySource: null,
        categorisedById: null,
        categorisedAt: null,
      },
    });
    const counts = await runCounts(tx, pair.stagedListing.runId);
    await tx.licenceImportRun.update({ where: { id: pair.stagedListing.runId }, data: counts });
  } else {
    const manifest = pair.manifest as unknown as ListingManifest | null;
    if (pair.state === "merged" && pair.mergeId) {
      await unmergeTx(tx, pair.mergeId, input);
      await tx.location.updateMany({ where: { addedByCandidateId: pair.id }, data: { addedByCandidateId: null } });
    }
    if (pair.state === "discarded" && manifest?.childId) {
      await tx.business.update({
        where: { id: manifest.childId },
        data: { publishedAt: manifest.previousPublishedAt ? new Date(manifest.previousPublishedAt) : null },
      });
    }
  }

  await tx.mergeCandidate.update({
    where: { id: pair.id },
    data: {
      state: "pending",
      mergeId: null,
      batchId: null,
      dismissedAt: null,
      dismissedById: null,
      dismissReason: null,
      resolvedAt: null,
      resolvedById: null,
      resolutionReason: null,
      reversibleUntil: null,
      manifest: Prisma.DbNull,
      ownerConfirmation: "not_needed",
      ownerDecidedAt: null,
      ownerDecidedById: null,
      reversedAt: input.now,
      reversedById: input.actorId,
      reverseReason: input.reason.trim(),
    },
  });
}

export async function reversePair(
  input: { actor: Actor; candidateId: string; reason: string },
  now = new Date(),
): Promise<ReverseResult> {
  assertCan(input.actor, "business.merge");
  const pair = await prisma.mergeCandidate.findUnique({
    where: { id: input.candidateId },
    select: { id: true, keepId: true, absorbId: true, manifest: true },
  });
  if (!pair) return { ok: false, error: "not_found", message: "That decision is not on record." };
  // Logged against the same listing the decision was logged against.
  const childId = pair.absorbId ? ((pair.manifest as unknown as ListingManifest | null)?.childId ?? pair.absorbId) : null;

  try {
    await prisma.$transaction(
      async (tx) =>
        staffMutation(
          {
            actor: input.actor,
            capability: "business.merge",
            action: "pair_reversed",
            subject: `Business:${childId ?? pair.keepId}`,
            reason: input.reason,
            tx,
          },
          async () => {
            await reverseResolutionTx(tx, pair.id, { actorId: input.actor.id, reason: input.reason, now, mode: "staff" });
            return { result: null, before: { candidateId: pair.id }, after: { candidateId: pair.id, state: "pending" } };
          },
        ),
      { timeout: 60_000, maxWait: 10_000 },
    );
  } catch (error) {
    if (error instanceof ReverseRefusal) return { ok: false, error: error.error, message: error.message };
    throw error;
  }
  return { ok: true };
}

export type BatchReverseResult =
  | { ok: true; restored: number; kept: number }
  | { ok: false; error: "not_found" | "already_reversed" | "window_closed"; message: string };

/**
 * A bulk merge, back as a unit (B4). Pairs somebody already reversed one at a
 * time are left as they are, and branches their owners confirmed are kept —
 * the count says how many.
 */
export async function reverseBatch(
  input: { actor: Actor; batchId: string; reason: string },
  now = new Date(),
): Promise<BatchReverseResult> {
  assertCan(input.actor, "business.merge");
  const batch = await prisma.mergeBatch.findUnique({
    where: { id: input.batchId },
    select: { id: true, reversedAt: true, reversibleUntil: true },
  });
  if (!batch) return { ok: false, error: "not_found", message: "That bulk merge is not on record." };
  if (batch.reversedAt) return { ok: false, error: "already_reversed", message: "That bulk merge was already reversed." };
  if (batch.reversibleUntil.getTime() < now.getTime()) {
    return {
      ok: false,
      error: "window_closed",
      message: `A bulk merge is reversible for ${REVERSIBLE_DAYS} days. This one closed on ${batch.reversibleUntil.toISOString().slice(0, 10)}.`,
    };
  }

  const members = await prisma.mergeCandidate.findMany({
    where: { batchId: batch.id, state: "merged" },
    select: { id: true, ownerConfirmation: true },
  });
  const reversible = members.filter((member) => member.ownerConfirmation !== "confirmed");

  await prisma.$transaction(
    async (tx) =>
      staffMutation(
        {
          actor: input.actor,
          capability: "business.merge",
          action: "batch_reversed",
          subject: `MergeBatch:${batch.id}`,
          reason: input.reason,
          tx,
        },
        async () => {
          for (const member of reversible) {
            await reverseResolutionTx(tx, member.id, { actorId: input.actor.id, reason: input.reason, now, mode: "rollback" });
          }
          await tx.mergeBatch.update({
            where: { id: batch.id },
            data: { reversedAt: now, reversedById: input.actor.id, reverseReason: input.reason.trim() },
          });
          return {
            result: null,
            before: { merged: members.length },
            after: { restored: reversible.length, kept: members.length - reversible.length },
          };
        },
      ),
    { timeout: 120_000, maxWait: 10_000 },
  );

  return { ok: true, restored: reversible.length, kept: members.length - reversible.length };
}

/* ── The owner's say — Q2 ────────────────────────────────────────────────── */

export type BranchDecisionResult =
  | { ok: true; decision: "confirm" | "reject" }
  | { ok: false; error: "not_found" | "not_open"; message: string };

/**
 * The owner of a claimed listing confirms a branch our team added, or says it
 * is not theirs.
 *
 * Confirm publishes the branch and makes it the owner's: no reversal on the
 * dedupe screen and no run rollback takes it after that. Reject puts the pair
 * back exactly as a reversal would and then resolves it as *keep separate*,
 * written against the owner — they are the person who knew, so the record
 * returns to its run to publish as a company of its own, and the matcher is
 * told the two are different (B2).
 */
export async function decideBranch(
  input: { actor: Actor; businessId: string; locationId: string; decision: "confirm" | "reject" },
  now = new Date(),
): Promise<BranchDecisionResult> {
  if (!can(input.actor, "listing.edit")) throw new PermissionError("listing.edit", input.actor.id);

  const location = await prisma.location.findUnique({
    where: { id: input.locationId },
    select: {
      id: true,
      businessId: true,
      published: true,
      addedByCandidate: { select: { id: true, state: true, ownerConfirmation: true, stagedListingId: true } },
    },
  });
  const pair = location?.addedByCandidate;
  if (!location || location.businessId !== input.businessId || !pair) {
    return { ok: false, error: "not_found", message: "That branch is not one our team added to this listing." };
  }
  if (pair.state !== "merged" || (pair.ownerConfirmation !== "awaiting" && pair.ownerConfirmation !== "informed")) {
    return { ok: false, error: "not_open", message: "That branch has already been confirmed or removed." };
  }

  if (input.decision === "confirm") {
    await prisma.$transaction([
      // Every branch the decision brought, not only the one clicked: a merged
      // listing can arrive with more than one location.
      prisma.location.updateMany({
        where: { addedByCandidateId: pair.id, published: false },
        data: { published: true, publishedAt: now },
      }),
      prisma.mergeCandidate.update({
        where: { id: pair.id },
        data: { ownerConfirmation: "confirmed", ownerDecidedAt: now, ownerDecidedById: input.actor.id },
      }),
    ]);
    return { ok: true, decision: "confirm" };
  }

  const reason = "The owner said this branch is not theirs.";
  await prisma.$transaction(
    async (tx) => {
      await reverseResolutionTx(tx, pair.id, { actorId: input.actor.id, reason, now, mode: "owner" });
      const record = pair.stagedListingId
        ? await tx.stagedListing.findUnique({ where: { id: pair.stagedListingId }, select: { id: true, activityKey: true, runId: true } })
        : null;
      if (record) {
        const outcome = await standaloneDisposition(tx, record);
        await tx.stagedListing.update({
          where: { id: record.id },
          data: {
            disposition: outcome.disposition,
            categoryId: outcome.categoryId,
            categorySource: outcome.categorySource,
            duplicateOfId: null,
          },
        });
        await tx.licenceImportRun.update({ where: { id: record.runId }, data: await runCounts(tx, record.runId) });
      }
      await tx.mergeCandidate.update({
        where: { id: pair.id },
        data: {
          ...separatedData(input.actor.id, reason, now),
          ownerConfirmation: "rejected",
          ownerDecidedAt: now,
          ownerDecidedById: input.actor.id,
        },
      });
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
  return { ok: true, decision: "reject" };
}

/* ── Runs — B5 ───────────────────────────────────────────────────────────── */

export interface RunMergePlan {
  /** Decisions the rollback will put back before it withdraws anything. */
  unwind: { candidateId: string; parentName: string }[];
  /** Branches owners confirmed. Any of these refuses the rollback, by name. */
  confirmed: { candidateId: string; parentName: string }[];
  /** Merges of a run's listing into another listing, made without a pair row. */
  looseMerges: string[];
}

/**
 * What rolling a run back would do to the decisions made from its records.
 *
 * Board 12b §Two reversal windows: a rollback unwinds the merges sourced from
 * its run first, or refuses and names them. It refuses exactly when an owner
 * has confirmed a branch — the one case where unwinding would take away
 * something a customer said was theirs. Everything else is put back.
 */
export async function runMergePlan(runId: string, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<RunMergePlan> {
  const [pairs, loose] = await Promise.all([
    /*
       Merges only. A record kept separate has become the run's own listing,
       which the rollback withdraws in the ordinary way; a discarded record
       changed nothing outside the run. A merge is the decision that put a
       run's record inside somebody else's listing — or somebody else's listing
       inside one of the run's — and that is what has to come back out.
    */
    db.mergeCandidate.findMany({
      where: {
        state: "merged",
        OR: [
          { sourceRunId: runId },
          { merge: { sourceRunId: runId } },
          { keep: { licenceImportRunId: runId } },
        ],
      },
      orderBy: [{ resolvedAt: "asc" }, { id: "asc" }],
      select: { id: true, ownerConfirmation: true, keep: { select: { displayName: true } }, state: true },
    }),
    db.businessMerge.findMany({
      where: {
        reversedAt: null,
        candidates: { none: {} },
        OR: [{ sourceRunId: runId }, { keep: { licenceImportRunId: runId } }],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    }),
  ]);
  const plan: RunMergePlan = { unwind: [], confirmed: [], looseMerges: loose.map((row) => row.id) };
  for (const pair of pairs) {
    const entry = { candidateId: pair.id, parentName: pair.keep.displayName };
    if (pair.ownerConfirmation === "confirmed") plan.confirmed.push(entry);
    else plan.unwind.push(entry);
  }
  return plan;
}

/**
 * Put back every decision made from a run's records, then withdraw every pair
 * the run still has open. Inside the rollback's own transaction; the rollback's
 * audit row is the record.
 */
export async function unwindRunTx(
  tx: Prisma.TransactionClient,
  runId: string,
  input: { actorId: string; reason: string; now: Date },
): Promise<{ unwound: number; withdrawn: number }> {
  const plan = await runMergePlan(runId, tx);
  for (const entry of plan.unwind) {
    await reverseResolutionTx(tx, entry.candidateId, { ...input, mode: "rollback" });
  }
  for (const mergeId of plan.looseMerges) {
    await unmergeTx(tx, mergeId, input);
  }
  const withdrawn = await withdrawRunPairsTx(tx, runId, "run_rolled_back");
  return { unwound: plan.unwind.length + plan.looseMerges.length, withdrawn };
}

/** A discarded or rolled-back run's open pairs stop being questions. */
export async function withdrawRunPairsTx(
  tx: Prisma.TransactionClient,
  runId: string,
  reason: "run_rolled_back" | "run_discarded",
): Promise<number> {
  const { count } = await tx.mergeCandidate.updateMany({
    where: { sourceRunId: runId, state: "pending" },
    data: { state: "withdrawn", withdrawnReason: reason },
  });
  return count;
}
