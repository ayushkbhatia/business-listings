import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import type { Actor } from "@/lib/auth/roles";
import type { Prisma, PrismaClient } from "@/lib/db/generated/client";
import { buildMatchIndex, chooseParent, type SideFacts } from "./match";
import { compare, type Listing, type Signal } from "./similarity";
import { loadMatchListings, readBands } from "./source";

/**
 * Board 12b — two listings that may be one company: finding them, merging
 * them, and putting them back.
 *
 * ## A merge never deletes
 *
 * Reviews, enquiries, quotes, products, locations, media and team seats all
 * hang off `business_id` and cascade. Deleting the absorbed listing destroys
 * the reviews that were the reason to merge in the first place, and thirty days
 * of reversibility would be reversibility of nothing.
 *
 * So the absorbed listing keeps its row, its id and its slug, gains a
 * `mergedIntoId`, and its children move across. **What moved is written down.**
 * Reversal replays that manifest rather than recomputing it: by the time
 * somebody unmerges, the surviving listing has rows of its own, and "everything
 * belonging to the winner" is no longer the set that arrived.
 *
 * ## Transaction pieces and audited wrappers
 *
 * `mergeListingsTx` and `unmergeTx` do the work inside a caller's transaction
 * and write no audit row. The pair screen, a bulk merge and a run rollback each
 * wrap them in their own `staffMutation` — one row per decision, one row for a
 * bulk merge of 1,412 (B4). `mergeBusinesses` and `unmergeBusinesses` are the
 * single-merge wrappers.
 */

export const REVERSIBLE_DAYS = 30;
const DAY_MS = 86_400_000;

type Db = PrismaClient | Prisma.TransactionClient;

/** The tables whose rows move, in the order they move. */
const MOVABLE = [
  "review",
  "quote",
  "product",
  "location",
  "media",
  "document",
  "user",
] as const;

type Movable = (typeof MOVABLE)[number];

export interface MergeManifest extends Partial<Record<Movable, string[]>> {
  /** Composite key, so these are enquiry ids rather than row ids. */
  enquiryRecipient?: string[];
  /** The absorbed listing's publish date, so a reversal puts it back live (criterion 9). */
  previousPublishedAt?: string | null;
  /** Moved locations' licence numbers before B9 stamped the absorbed licence on them. */
  locationLicence?: Record<string, string | null>;
  /** Moved locations' visibility before an owner hold took them down. */
  locationPublished?: Record<string, boolean>;
}

/* ── What each side of a pair carries ────────────────────────────────────── */

export interface ListingFacts extends SideFacts {
  displayName: string;
  slug: string;
  claimStatus: string;
  planName: string | null;
  subscriptionStatus: string | null;
  rating: number | null;
  licenceNumber: string;
  licenceAuthority: string;
  licenceImportRunId: string | null;
  mergedIntoId: string | null;
}

/** Paying, or was: the subscription states a merge must never orphan. */
const PAYING = new Set(["active", "trialing", "past_due"]);

export async function listingFacts(db: Db, ids: readonly string[]): Promise<Map<string, ListingFacts>> {
  if (ids.length === 0) return new Map();
  const rows = await db.business.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: {
      id: true,
      displayName: true,
      slug: true,
      claimStatus: true,
      publishedAt: true,
      createdAt: true,
      ratingOverall: true,
      licenceNumber: true,
      licenceAuthority: true,
      licenceImportRunId: true,
      mergedIntoId: true,
      plan: { select: { name: true } },
      subscription: { select: { status: true } },
      _count: { select: { reviews: true, products: true, recipients: true } },
    },
  });
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        displayName: row.displayName,
        slug: row.slug,
        claimStatus: row.claimStatus,
        claimed: row.claimStatus !== "unclaimed",
        paying: row.subscription !== null && PAYING.has(row.subscription.status),
        reviews: row._count.reviews,
        products: row._count.products,
        enquiries: row._count.recipients,
        publishedAt: row.publishedAt,
        createdAt: row.createdAt,
        planName: row.plan?.name ?? null,
        subscriptionStatus: row.subscription?.status ?? null,
        rating: row.ratingOverall,
        licenceNumber: row.licenceNumber,
        licenceAuthority: row.licenceAuthority,
        licenceImportRunId: row.licenceImportRunId,
        mergedIntoId: row.mergedIntoId,
      },
    ]),
  );
}

/* ── Finding pairs of listings ───────────────────────────────────────────── */

export interface RescanResult {
  /** New candidate rows written. Pairs already on the list are not re-added. */
  created: number;
  /** Pairs at or above the floor the scan found. */
  considered: number;
  /**
   * Pairs the cap dropped, unwritten.
   *
   * Reported rather than swallowed. A scan that silently stops at five hundred
   * tells whoever is clearing the list that they have seen everything.
   */
  dropped: number;
}

export interface ListingPair {
  a: Listing;
  b: Listing;
  score: number;
  band: "certain" | "probable";
  signals: Signal[];
}

/**
 * Every pair of listings at or above the floor, blocked rather than pairwise.
 *
 * At 41,000 listings a pairwise pass is 840 million comparisons; blocking on
 * licence digits, licence root, phone and identifying name words makes it the
 * handful of pairs that share something. Read-only, so the tuning preview can
 * ask what a different floor would find without writing it.
 */
export async function scanListingPairs(
  bands: Parameters<typeof compare>[2],
  db: Db = prisma,
): Promise<ListingPair[]> {
  const listings = await loadMatchListings(db);
  const index = buildMatchIndex(listings);
  const seen = new Set<string>();
  const found: ListingPair[] = [];

  for (const block of index.blocks.values()) {
    if (block.length < 2 || block.length > 200) continue;
    for (let i = 0; i < block.length; i += 1) {
      for (let j = i + 1; j < block.length; j += 1) {
        const [x, y] = block[i]! < block[j]! ? [block[i]!, block[j]!] : [block[j]!, block[i]!];
        const key = `${x}|${y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const a = index.listings.get(x)!;
        const b = index.listings.get(y)!;
        const result = compare(a, b, bands);
        if (result.band === "unlikely") continue;
        found.push({ a, b, score: result.score, band: result.band, signals: result.signals });
      }
    }
  }

  return found.sort((p, q) => q.score - p.score || (p.a.id < q.a.id ? -1 : 1));
}

/**
 * Regenerate the listing-pair list.
 *
 * Record A of a new pair is the side B1 would keep — claimed, then paying, then
 * the one with history — so the screen draws the parent on the left. It used
 * to be `a.id < b.id`, which put whichever listing was created first in the
 * surviving slot regardless of who had claimed it.
 *
 * Pairs already on the list in any state are not re-proposed: a pair kept
 * separate is the matcher being told something (B2), and one merged or
 * discarded has been answered.
 */
export async function findCandidates(limit = 500): Promise<RescanResult> {
  const bands = await readBands();
  const found = await scanListingPairs(bands);

  const existing = await prisma.mergeCandidate.findMany({
    where: { absorbId: { not: null } },
    select: { keepId: true, absorbId: true },
  });
  const seenPairs = new Set(
    existing.map(({ keepId, absorbId }) => (keepId < absorbId! ? `${keepId}|${absorbId}` : `${absorbId}|${keepId}`)),
  );

  const fresh = found.filter((pair) => {
    const key = `${pair.a.id}|${pair.b.id}`;
    if (seenPairs.has(key)) return false;
    seenPairs.add(key);
    return true;
  });
  const wanted = fresh.slice(0, limit);

  const facts = await listingFacts(prisma, wanted.flatMap((pair) => [pair.a.id, pair.b.id]));
  if (wanted.length > 0) {
    await prisma.mergeCandidate.createMany({
      data: wanted.map((pair) => {
        const a = facts.get(pair.a.id);
        const b = facts.get(pair.b.id);
        const choice = a && b ? chooseParent(a, b) : null;
        const keepId = choice?.kind === "parent" ? choice.parentId : pair.a.id;
        return {
          keepId,
          absorbId: keepId === pair.a.id ? pair.b.id : pair.a.id,
          score: pair.score,
          band: pair.band,
          signals: pair.signals as unknown as Prisma.InputJsonValue,
        };
      }),
      skipDuplicates: true,
    });
  }

  return { created: wanted.length, considered: found.length, dropped: Math.max(0, fresh.length - limit) };
}

/* ── Merging ─────────────────────────────────────────────────────────────── */

export type MergeResult =
  | { ok: true; mergeId: string; moved: number }
  | { ok: false; error: "not_found" | "already_merged" | "same_listing"; message: string };

export interface MergeTxInput {
  actorId: string;
  keepId: string;
  absorbId: string;
  reason: string;
  now: Date;
  batchId?: string | null;
  /**
   * Q2: the owner of the surviving listing has not agreed to the branch, so
   * the locations that move stay unpublished until they do.
   */
  holdLocations?: boolean;
  /** The pair this merge answers, which is not withdrawn along with the others. */
  candidateId?: string | null;
}

/** Refusals `mergeListingsTx` can raise; a caller turns them into sentences. */
export class MergeRefusal extends Error {
  constructor(readonly error: "not_found" | "already_merged" | "same_listing") {
    super(error);
    this.name = "MergeRefusal";
  }
}

/**
 * Merge `absorbId` into `keepId` inside the caller's transaction. No audit row:
 * the caller's `staffMutation` is the record.
 */
export async function mergeListingsTx(
  tx: Prisma.TransactionClient,
  input: MergeTxInput,
): Promise<{ mergeId: string; moved: number }> {
  if (input.keepId === input.absorbId) throw new MergeRefusal("same_listing");

  const [keep, absorb] = await Promise.all([
    tx.business.findUnique({
      where: { id: input.keepId },
      select: { id: true, slug: true, mergedIntoId: true },
    }),
    tx.business.findUnique({
      where: { id: input.absorbId },
      select: {
        id: true,
        slug: true,
        publishedAt: true,
        mergedIntoId: true,
        licenceNumber: true,
        licenceImportRunId: true,
      },
    }),
  ]);
  if (!keep || !absorb) throw new MergeRefusal("not_found");
  if (keep.mergedIntoId || absorb.mergedIntoId) throw new MergeRefusal("already_merged");

  const manifest: MergeManifest = {
    previousPublishedAt: absorb.publishedAt?.toISOString() ?? null,
  };
  let moved = 0;

  /*
   * Ids captured before the move, not after. After the update they are
   * indistinguishable from rows the surviving listing already had, and a
   * reversal that cannot tell them apart moves the wrong ones back.
   */
  for (const table of MOVABLE) {
    if (table === "location") {
      const rows = await tx.location.findMany({
        where: { businessId: absorb.id },
        select: { id: true, licenceNumber: true, published: true },
      });
      if (rows.length === 0) continue;
      const ids = rows.map((row) => row.id);
      manifest.location = ids;
      manifest.locationLicence = Object.fromEntries(rows.map((row) => [row.id, row.licenceNumber]));
      manifest.locationPublished = Object.fromEntries(rows.map((row) => [row.id, row.published]));
      await tx.location.updateMany({ where: { id: { in: ids } }, data: { businessId: keep.id } });
      // B9: a branch keeps its own registry identity. A location that arrives
      // from another listing carries that listing's licence, not the parent's.
      await tx.location.updateMany({
        where: { id: { in: ids }, licenceNumber: null },
        data: { licenceNumber: absorb.licenceNumber },
      });
      if (input.holdLocations) {
        await tx.location.updateMany({ where: { id: { in: ids } }, data: { published: false } });
      }
      moved += rows.length;
      continue;
    }
    const model = tx[table] as unknown as {
      findMany(args: unknown): Promise<{ id: string }[]>;
      updateMany(args: unknown): Promise<{ count: number }>;
    };
    const rows = await model.findMany({ where: { businessId: absorb.id }, select: { id: true } });
    if (rows.length === 0) continue;
    manifest[table] = rows.map((row) => row.id);
    await model.updateMany({ where: { id: { in: manifest[table]! } }, data: { businessId: keep.id } });
    moved += rows.length;
  }

  /*
   * `EnquiryRecipient` has a composite key, so a move can collide: the
   * surviving listing may already have received the same enquiry. Those are
   * left where they are — one recipient row per (enquiry, business) is the
   * point of the key, and a buyer who reached both listings reached one
   * company twice.
   */
  const recipients = await tx.enquiryRecipient.findMany({
    where: { businessId: absorb.id },
    select: { enquiryId: true },
  });
  const alreadyThere = new Set(
    (
      await tx.enquiryRecipient.findMany({
        where: { businessId: keep.id, enquiryId: { in: recipients.map((r) => r.enquiryId) } },
        select: { enquiryId: true },
      })
    ).map((r) => r.enquiryId),
  );
  const movableEnquiries = recipients.map((r) => r.enquiryId).filter((id) => !alreadyThere.has(id));
  if (movableEnquiries.length > 0) {
    manifest.enquiryRecipient = movableEnquiries;
    await tx.enquiryRecipient.updateMany({
      where: { businessId: absorb.id, enquiryId: { in: movableEnquiries } },
      data: { businessId: keep.id },
    });
    moved += movableEnquiries.length;
  }

  const merge = await tx.businessMerge.create({
    data: {
      keepId: keep.id,
      absorbId: absorb.id,
      actorId: input.actorId,
      reason: input.reason.trim(),
      manifest: manifest as Prisma.InputJsonValue,
      absorbedSlug: absorb.slug,
      reversibleUntil: new Date(input.now.getTime() + REVERSIBLE_DAYS * DAY_MS),
      batchId: input.batchId ?? null,
      sourceRunId: absorb.licenceImportRunId,
    },
    select: { id: true },
  });

  await tx.business.update({
    where: { id: absorb.id },
    data: { mergedIntoId: keep.id, mergedAt: input.now, publishedAt: null },
  });

  /*
   * The 301. Only for a listing that was published — a draft has no address
   * anybody has bookmarked — and `fromPath` is unique, so a listing merged
   * after a rename keeps both hops.
   */
  if (absorb.publishedAt) {
    await tx.redirect.upsert({
      where: { fromPath: `/b/${absorb.slug}` },
      create: { fromPath: `/b/${absorb.slug}`, toPath: `/b/${keep.slug}`, businessId: keep.id },
      update: { toPath: `/b/${keep.slug}`, businessId: keep.id },
    });
  }

  // "B already merged elsewhere": every other open pair naming the absorbed
  // listing stopped being a question, and says why rather than vanishing.
  await withdrawPairsTouching(tx, absorb.id, "merged_elsewhere", input.candidateId ?? undefined);

  return { mergeId: merge.id, moved };
}

/** Open pairs on either side of a listing that has left the directory. */
export async function withdrawPairsTouching(
  tx: Prisma.TransactionClient,
  businessId: string,
  reason: string,
  except?: string,
): Promise<number> {
  const { count } = await tx.mergeCandidate.updateMany({
    where: {
      state: "pending",
      ...(except ? { id: { not: except } } : {}),
      OR: [{ keepId: businessId }, { absorbId: businessId }],
    },
    data: { state: "withdrawn", withdrawnReason: reason },
  });
  return count;
}

export interface MergeInput {
  actor: Actor;
  keepId: string;
  absorbId: string;
  reason: string;
  /** Set when this came off a candidate row, so the row can be closed. */
  candidateId?: string;
}

/** One merge, audited on its own. The pair screen resolves through `resolvePair`. */
export async function mergeBusinesses(input: MergeInput, now = new Date()): Promise<MergeResult> {
  if (input.keepId === input.absorbId) {
    return { ok: false, error: "same_listing", message: "That is one listing, not two." };
  }
  const [keep, absorb] = await Promise.all([
    prisma.business.findUnique({ where: { id: input.keepId }, select: { mergedIntoId: true } }),
    prisma.business.findUnique({ where: { id: input.absorbId }, select: { mergedIntoId: true } }),
  ]);
  if (!keep || !absorb) {
    return { ok: false, error: "not_found", message: "One of those listings is not here." };
  }
  if (keep.mergedIntoId || absorb.mergedIntoId) {
    return {
      ok: false,
      error: "already_merged",
      message: "One of those listings has already been merged into another.",
    };
  }

  const result = await prisma.$transaction(
    async (tx) =>
      staffMutation(
        {
          actor: input.actor,
          capability: "business.merge",
          subject: `Business:${input.absorbId}`,
          reason: input.reason,
          tx,
        },
        async () => {
          const merged = await mergeListingsTx(tx, {
            actorId: input.actor.id,
            keepId: input.keepId,
            absorbId: input.absorbId,
            reason: input.reason,
            now,
            candidateId: input.candidateId ?? null,
          });
          if (input.candidateId) {
            await tx.mergeCandidate.update({
              where: { id: input.candidateId },
              data: {
                mergeId: merged.mergeId,
                state: "merged",
                resolvedAt: now,
                resolvedById: input.actor.id,
                resolutionReason: input.reason.trim(),
                reversibleUntil: new Date(now.getTime() + REVERSIBLE_DAYS * DAY_MS),
              },
            });
          }
          return {
            result: merged,
            before: { mergedIntoId: null },
            after: { mergedIntoId: input.keepId, moved: merged.moved, reversibleDays: REVERSIBLE_DAYS },
          };
        },
      ),
    { timeout: 60_000, maxWait: 10_000 },
  );

  return { ok: true, mergeId: result.mergeId, moved: result.moved };
}

export type UnmergeResult =
  | { ok: true; restored: number }
  | { ok: false; error: "not_found" | "already_reversed" | "window_closed"; message: string };

/**
 * Replay a merge's manifest backwards inside the caller's transaction.
 *
 * Criterion 9: both records restored exactly. The absorbed listing's publish
 * date comes back — the first version cleared `mergedIntoId` and left the
 * listing unpublished, so a reversed merge took a live company off the
 * directory — and so do the moved locations' licence numbers and visibility.
 */
export async function unmergeTx(
  tx: Prisma.TransactionClient,
  mergeId: string,
  input: { actorId: string; reason: string; now: Date },
): Promise<number> {
  const merge = await tx.businessMerge.findUniqueOrThrow({
    where: { id: mergeId },
    select: { id: true, keepId: true, absorbId: true, manifest: true, absorbedSlug: true },
  });
  const manifest = merge.manifest as MergeManifest;
  let count = 0;

  for (const table of MOVABLE) {
    const ids = manifest[table];
    if (!ids || ids.length === 0) continue;
    const model = tx[table] as unknown as { updateMany(args: unknown): Promise<{ count: number }> };
    const result = await model.updateMany({ where: { id: { in: ids } }, data: { businessId: merge.absorbId } });
    count += result.count;
  }

  for (const [id, licenceNumber] of Object.entries(manifest.locationLicence ?? {})) {
    const published = manifest.locationPublished?.[id];
    await tx.location.updateMany({
      where: { id },
      data: { licenceNumber, ...(published === undefined ? {} : { published }) },
    });
  }

  if (manifest.enquiryRecipient?.length) {
    const result = await tx.enquiryRecipient.updateMany({
      where: { businessId: merge.keepId, enquiryId: { in: manifest.enquiryRecipient } },
      data: { businessId: merge.absorbId },
    });
    count += result.count;
  }

  await tx.business.update({
    where: { id: merge.absorbId },
    data: {
      mergedIntoId: null,
      mergedAt: null,
      // Absent on a merge made before the manifest carried it; those leave the
      // publish date as the merge left it rather than inventing one.
      ...("previousPublishedAt" in manifest
        ? { publishedAt: manifest.previousPublishedAt ? new Date(manifest.previousPublishedAt) : null }
        : {}),
    },
  });

  // The 301 goes with it. A redirect to a listing that is live again sends
  // buyers to the wrong company.
  await tx.redirect.deleteMany({ where: { fromPath: `/b/${merge.absorbedSlug}` } });

  await tx.businessMerge.update({
    where: { id: merge.id },
    data: { reversedAt: input.now, reverseReason: input.reason.trim() },
  });

  return count;
}

/**
 * Put it back.
 *
 * The window is thirty days and it is a real refusal rather than a warning:
 * after that the surviving listing has been the listing for a month, buyers
 * have linked to it, and unpicking it would be a second disruption rather than
 * a correction.
 */
export async function unmergeBusinesses(
  input: { actor: Actor; mergeId: string; reason: string },
  now = new Date(),
): Promise<UnmergeResult> {
  const merge = await prisma.businessMerge.findUnique({
    where: { id: input.mergeId },
    select: { id: true, absorbId: true, reversibleUntil: true, reversedAt: true },
  });
  if (!merge) return { ok: false, error: "not_found", message: "That merge is not on record." };
  if (merge.reversedAt) {
    return { ok: false, error: "already_reversed", message: "That merge was already reversed." };
  }
  if (merge.reversibleUntil.getTime() < now.getTime()) {
    return {
      ok: false,
      error: "window_closed",
      message: `A merge is reversible for ${REVERSIBLE_DAYS} days. This one closed on ${merge.reversibleUntil.toISOString().slice(0, 10)}.`,
    };
  }

  const restored = await prisma.$transaction(
    async (tx) =>
      staffMutation(
        {
          actor: input.actor,
          capability: "business.merge",
          subject: `Business:${merge.absorbId}`,
          reason: input.reason,
          tx,
        },
        async () => {
          const count = await unmergeTx(tx, merge.id, { actorId: input.actor.id, reason: input.reason, now });
          // The pair it answered is a question again.
          await tx.mergeCandidate.updateMany({
            where: { mergeId: merge.id },
            data: {
              state: "pending",
              mergeId: null,
              batchId: null,
              resolvedAt: null,
              resolvedById: null,
              resolutionReason: null,
              reversibleUntil: null,
              reversedAt: now,
              reversedById: input.actor.id,
              reverseReason: input.reason.trim(),
              ownerConfirmation: "not_needed",
            },
          });
          return {
            result: count,
            before: { mergedIntoId: "set" },
            after: { mergedIntoId: null, restored: count },
          };
        },
      ),
    { timeout: 60_000, maxWait: 10_000 },
  );

  return { ok: true, restored };
}

export type DismissResult = { ok: true } | { ok: false; error: string };

/**
 * Not a match. It does not come back — B2, *keep as separate listings*.
 *
 * Inside the fence, like the merge. Deciding that two listings are *not* the
 * same company is as much a judgement about a real supplier as deciding that
 * they are — and it is the decision somebody disputes later, when their second
 * listing never reappears.
 */
export async function dismissCandidate(
  input: { actor: Actor; candidateId: string; reason: string },
  now = new Date(),
): Promise<DismissResult> {
  const candidate = await prisma.mergeCandidate.findUnique({
    where: { id: input.candidateId },
    select: { id: true, state: true, dismissedAt: true, keepId: true, absorbId: true, score: true, band: true },
  });
  if (!candidate || candidate.absorbId === null) return { ok: false, error: "That pair is not in the list." };
  if (candidate.dismissedAt || candidate.state !== "pending") {
    return { ok: false, error: "Somebody already decided that pair." };
  }

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "business.merge",
        subject: `Business:${candidate.absorbId}`,
        reason: input.reason,
        tx,
      },
      async () => {
        const row = await tx.mergeCandidate.update({
          where: { id: candidate.id },
          data: separatedData(input.actor.id, input.reason, now),
          select: { id: true },
        });
        return {
          result: row.id,
          before: {
            state: "pending",
            keepId: candidate.keepId,
            absorbId: candidate.absorbId,
            score: candidate.score,
            band: candidate.band,
          },
          after: { state: "separated", dismissedAt: now, dismissedById: input.actor.id },
        };
      },
    ),
  );

  return { ok: true };
}

/** The columns a keep-separate writes, old and new, so both readers agree. */
export function separatedData(actorId: string, reason: string, now: Date) {
  return {
    state: "separated" as const,
    dismissedAt: now,
    dismissedById: actorId,
    dismissReason: reason.trim(),
    resolvedAt: now,
    resolvedById: actorId,
    resolutionReason: reason.trim(),
    reversibleUntil: new Date(now.getTime() + REVERSIBLE_DAYS * DAY_MS),
  };
}
