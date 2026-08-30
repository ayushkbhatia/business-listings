import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import type { Actor } from "@/lib/auth/roles";
import { compare, type Listing } from "./similarity";

/**
 * Board 12b — dedupe and merge.
 *
 * Criterion 2: *"dedupe above 90% bulk-merges; the 60–90% band requires a
 * decision; every merge is reversible for 30 days, writes an audit row and
 * creates a 301."*
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
 */

export const REVERSIBLE_DAYS = 30;

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
}

/* ── Finding candidates ──────────────────────────────────────────────────── */

async function listingsFor(where: object): Promise<Listing[]> {
  const rows = await prisma.business.findMany({
    where: { mergedIntoId: null, ...where },
    select: {
      id: true,
      tradeName: true,
      licenceNumber: true,
      licenceAuthority: true,
      locations: { select: { emirate: true, areaId: true, addressLine: true, phone: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    tradeName: row.tradeName,
    licenceNumber: row.licenceNumber,
    licenceAuthority: row.licenceAuthority,
    emirate: row.locations[0]?.emirate ?? null,
    areaId: row.locations[0]?.areaId ?? null,
    addressLine: row.locations[0]?.addressLine ?? null,
    phones: row.locations.map((l) => l.phone).filter((p): p is string => p !== null),
  }));
}

/**
 * Regenerate the candidate list.
 *
 * Blocked on licence digits and on the first identifying name token, rather
 * than compared pairwise. At 41,000 listings a pairwise pass is 840 million
 * comparisons; blocking makes it the handful of pairs that share something.
 *
 * Pairs already dismissed or already merged are not re-proposed — the partial
 * unique index says so, and a dedupe list that keeps offering back a pair
 * somebody rejected is a list people stop reading.
 */
export interface RescanResult {
  /** New candidate rows written. Pairs already on the list are not re-added. */
  created: number;
  /** Pairs above `unlikely` the scan actually found. */
  considered: number;
  /**
   * Pairs the cap dropped, unwritten.
   *
   * Reported rather than swallowed. A scan that silently stops at five hundred
   * tells whoever is clearing the list that they have seen everything, which is
   * the same failure `parseCsv` had at five thousand rows and the same one a
   * broken query rendering as "nothing to do" has. The screen says the number.
   */
  dropped: number;
}

export async function findCandidates(limit = 500): Promise<RescanResult> {
  const listings = await listingsFor({});

  const byBlock = new Map<string, Listing[]>();
  const addTo = (key: string, listing: Listing) => {
    if (!key) return;
    const list = byBlock.get(key) ?? [];
    list.push(listing);
    byBlock.set(key, list);
  };

  for (const listing of listings) {
    addTo(`licence:${listing.licenceNumber.replace(/\D/g, "")}`, listing);
    const token = listing.tradeName
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
      .split(/\s+/)
      .find((word) => word.length > 2);
    if (token) addTo(`name:${token}`, listing);
    for (const phone of listing.phones) addTo(`phone:${phone.replace(/\D/g, "").slice(-8)}`, listing);
  }

  const seen = new Set<string>();
  const found: { keepId: string; absorbId: string; score: number; band: string; signals: unknown }[] = [];

  for (const block of byBlock.values()) {
    if (block.length < 2 || block.length > 50) continue;
    for (let i = 0; i < block.length; i += 1) {
      for (let j = i + 1; j < block.length; j += 1) {
        const a = block[i]!;
        const b = block[j]!;
        const pair = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
        if (seen.has(pair)) continue;
        seen.add(pair);

        const result = compare(a, b);
        if (result.band === "unlikely") continue;

        /*
         * Which one survives is not arbitrary. The listing with more history
         * keeps its address — a 301 from a page nobody has linked to is free,
         * and one away from a page buyers have bookmarked is not.
         */
        const [keep, absorb] = a.id < b.id ? [a, b] : [b, a];
        found.push({
          keepId: keep.id,
          absorbId: absorb.id,
          score: result.score,
          band: result.band,
          signals: result.signals,
        });
      }
    }
  }

  found.sort((x, y) => y.score - x.score);

  /*
   * Two queries, not two per pair.
   *
   * This used to run a `findFirst` and a `create` for every candidate, which is
   * a thousand round-trips on a directory with a thousand duplicates and the
   * reason a scan took half a minute against a few thousand listings. The
   * blocking above exists precisely so this stays cheap at 41,000; doing it and
   * then spending the saving on round-trips was the wrong half of the fix.
   */
  const wanted = found.slice(0, limit);
  const existing = await prisma.mergeCandidate.findMany({
    select: { keepId: true, absorbId: true },
  });
  const seenPairs = new Set(
    existing.map(({ keepId, absorbId }) =>
      keepId < absorbId ? `${keepId}|${absorbId}` : `${absorbId}|${keepId}`,
    ),
  );

  const fresh = wanted.filter((candidate) => {
    const key =
      candidate.keepId < candidate.absorbId
        ? `${candidate.keepId}|${candidate.absorbId}`
        : `${candidate.absorbId}|${candidate.keepId}`;
    if (seenPairs.has(key)) return false;
    seenPairs.add(key);
    return true;
  });

  if (fresh.length > 0) {
    await prisma.mergeCandidate.createMany({
      data: fresh.map((candidate) => ({
        keepId: candidate.keepId,
        absorbId: candidate.absorbId,
        score: candidate.score,
        band: candidate.band as "certain" | "probable",
        signals: candidate.signals as object,
      })),
    });
  }

  const created = fresh.length;

  return { created, considered: found.length, dropped: Math.max(0, found.length - limit) };
}

/**
 * Merges that can still be put back.
 *
 * The reader `unmergeBusinesses` never had. `openCandidates` lists pairs
 * nobody has decided yet; nothing listed the decisions already taken, so the
 * reversal — thirty days of it, deliberately — was reachable from no screen.
 *
 * Ordered newest first, because a merge somebody regrets is usually the one
 * they have just done.
 */
export async function recentMerges(now = new Date(), limit = 50) {
  return prisma.businessMerge.findMany({
    where: { reversedAt: null, reversibleUntil: { gte: now } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      reason: true,
      absorbedSlug: true,
      reversibleUntil: true,
      createdAt: true,
      keep: { select: { displayName: true, slug: true } },
      absorb: { select: { displayName: true } },
      // What the reversal would put back, which is the number worth showing
      // beside the button — the manifest is the whole point of the window.
      _count: { select: { candidates: true } },
    },
  });
}

export async function openCandidates(band?: "certain" | "probable", limit = 100) {
  return prisma.mergeCandidate.findMany({
    where: { dismissedAt: null, mergeId: null, ...(band ? { band } : {}) },
    orderBy: [{ band: "asc" }, { score: "desc" }],
    take: limit,
    select: {
      id: true,
      score: true,
      band: true,
      signals: true,
      keep: {
        select: {
          id: true,
          displayName: true,
          slug: true,
          licenceNumber: true,
          _count: { select: { reviews: true, recipients: true, products: true } },
        },
      },
      absorb: {
        select: {
          id: true,
          displayName: true,
          slug: true,
          licenceNumber: true,
          _count: { select: { reviews: true, recipients: true, products: true } },
        },
      },
    },
  });
}

/* ── Merging ─────────────────────────────────────────────────────────────── */

export type MergeResult =
  | { ok: true; mergeId: string; moved: number }
  | { ok: false; error: "not_found" | "already_merged" | "same_listing"; message: string };

export interface MergeInput {
  actor: Actor;
  keepId: string;
  absorbId: string;
  reason: string;
  /** Set when this came off a candidate row, so the row can be closed. */
  candidateId?: string;
}

export async function mergeBusinesses(
  input: MergeInput,
  now = new Date(),
): Promise<MergeResult> {
  if (input.keepId === input.absorbId) {
    return { ok: false, error: "same_listing", message: "That is one listing, not two." };
  }

  const [keep, absorb] = await Promise.all([
    prisma.business.findUnique({
      where: { id: input.keepId },
      select: { id: true, slug: true, mergedIntoId: true },
    }),
    prisma.business.findUnique({
      where: { id: input.absorbId },
      select: { id: true, slug: true, publishedAt: true, mergedIntoId: true },
    }),
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

  const mergeId = await prisma.$transaction(
    async (tx) =>
      staffMutation(
        {
          actor: input.actor,
          capability: "business.merge",
          subject: `Business:${absorb.id}`,
          reason: input.reason,
          tx,
        },
        async () => {
          const manifest: MergeManifest = {};
          let moved = 0;

          /*
           * Ids captured before the move, not after. After the update they are
           * indistinguishable from rows the surviving listing already had, and
           * a reversal that cannot tell them apart moves the wrong ones back.
           */
          for (const table of MOVABLE) {
            const model = tx[table] as {
              findMany(args: unknown): Promise<{ id: string }[]>;
              updateMany(args: unknown): Promise<{ count: number }>;
            };
            const rows = await model.findMany({
              where: { businessId: absorb.id },
              select: { id: true },
            });
            if (rows.length === 0) continue;
            manifest[table] = rows.map((row) => row.id);
            await model.updateMany({
              where: { id: { in: manifest[table]! } },
              data: { businessId: keep.id },
            });
            moved += rows.length;
          }

          /*
           * `EnquiryRecipient` has a composite key, so a move can collide: the
           * surviving listing may already have received the same enquiry. Those
           * are left where they are — one recipient row per (enquiry, business)
           * is the point of the key, and a buyer who reached both listings
           * reached one company twice.
           */
          const recipients = await tx.enquiryRecipient.findMany({
            where: { businessId: absorb.id },
            select: { enquiryId: true },
          });
          const alreadyThere = new Set(
            (
              await tx.enquiryRecipient.findMany({
                where: {
                  businessId: keep.id,
                  enquiryId: { in: recipients.map((r) => r.enquiryId) },
                },
                select: { enquiryId: true },
              })
            ).map((r) => r.enquiryId),
          );
          const movableEnquiries = recipients
            .map((r) => r.enquiryId)
            .filter((id) => !alreadyThere.has(id));

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
              actorId: input.actor.id,
              reason: input.reason,
              manifest: manifest as object,
              absorbedSlug: absorb.slug,
              reversibleUntil: new Date(now.getTime() + REVERSIBLE_DAYS * 86_400_000),
            },
            select: { id: true },
          });

          await tx.business.update({
            where: { id: absorb.id },
            data: { mergedIntoId: keep.id, mergedAt: now, publishedAt: null },
          });

          /*
           * The 301. Only for a listing that was published — a draft has no
           * address anybody has bookmarked — and `fromPath` is unique, so a
           * listing merged after a rename keeps both hops.
           */
          if (absorb.publishedAt) {
            await tx.redirect.upsert({
              where: { fromPath: `/b/${absorb.slug}` },
              create: {
                fromPath: `/b/${absorb.slug}`,
                toPath: `/b/${keep.slug}`,
                businessId: keep.id,
              },
              update: { toPath: `/b/${keep.slug}`, businessId: keep.id },
            });
          }

          if (input.candidateId) {
            await tx.mergeCandidate.update({
              where: { id: input.candidateId },
              data: { mergeId: merge.id },
            });
          }

          return {
            result: { id: merge.id, moved },
            before: { mergedIntoId: null, slug: absorb.slug },
            after: { mergedIntoId: keep.id, moved, reversibleDays: REVERSIBLE_DAYS },
          };
        },
      ),
    { timeout: 60_000, maxWait: 10_000 },
  );

  return { ok: true, mergeId: mergeId.id, moved: mergeId.moved };
}

export type UnmergeResult =
  | { ok: true; restored: number }
  | { ok: false; error: "not_found" | "already_reversed" | "window_closed"; message: string };

/**
 * Put it back.
 *
 * A replay of the manifest, which is why the manifest exists. The window is
 * thirty days and it is a real refusal rather than a warning: after that the
 * surviving listing has been the listing for a month, buyers have linked to it,
 * and unpicking it would be a second disruption rather than a correction.
 */
export async function unmergeBusinesses(
  input: { actor: Actor; mergeId: string; reason: string },
  now = new Date(),
): Promise<UnmergeResult> {
  const merge = await prisma.businessMerge.findUnique({
    where: { id: input.mergeId },
    select: {
      id: true,
      keepId: true,
      absorbId: true,
      manifest: true,
      absorbedSlug: true,
      reversibleUntil: true,
      reversedAt: true,
    },
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

  const manifest = merge.manifest as MergeManifest;

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
          let count = 0;

          for (const table of MOVABLE) {
            const ids = manifest[table];
            if (!ids || ids.length === 0) continue;
            const model = tx[table] as {
              updateMany(args: unknown): Promise<{ count: number }>;
            };
            const result = await model.updateMany({
              where: { id: { in: ids } },
              data: { businessId: merge.absorbId },
            });
            count += result.count;
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
            data: { mergedIntoId: null, mergedAt: null },
          });

          // The 301 goes with it. A redirect to a listing that is live again
          // sends buyers to the wrong company.
          await tx.redirect.deleteMany({ where: { fromPath: `/b/${merge.absorbedSlug}` } });

          await tx.businessMerge.update({
            where: { id: merge.id },
            data: { reversedAt: now, reverseReason: input.reason },
          });

          return {
            result: count,
            before: { mergedIntoId: merge.keepId },
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
 * Not a match. It does not come back.
 *
 * Inside the fence, like `mergeBusinesses` and `unmergeBusinesses` above it.
 * Deciding that two listings are *not* the same company is as much a judgement
 * about a real supplier as deciding that they are — and it is the decision
 * somebody disputes later, when their second listing never reappears.
 *
 * Before this went through `staffMutation` the path had no capability check at
 * all: `/admin/ingest/dedupe` 404s for a seat without `business.merge`, but the
 * server action behind it only called `requireStaff()`, so any staff seat could
 * post to it. The fence closes that as well as writing the row.
 *
 * The audit action reads `merge`, because `ACTION_FOR_CAPABILITY` is 1:1 with
 * the capability and a dismissal is `business.merge` work. `before`/`after` are
 * what separate the three: a merge carries `mergedIntoId`, this carries the
 * score and band the pair was judged on.
 */
export async function dismissCandidate(input: {
  actor: Actor;
  candidateId: string;
  reason: string;
}): Promise<DismissResult> {
  const candidate = await prisma.mergeCandidate.findUnique({
    where: { id: input.candidateId },
    // Wider than the update needs: the audit row should say which two listings
    // were judged apart and how close the scorer thought they were.
    select: { id: true, dismissedAt: true, keepId: true, absorbId: true, score: true, band: true },
  });
  if (!candidate) return { ok: false, error: "That pair is not in the list." };
  if (candidate.dismissedAt) return { ok: false, error: "Somebody already dismissed that pair." };

  const dismissedAt = new Date();

  // One UPDATE and one INSERT, so the default transaction options are right —
  // the timeouts on the merge paths are for the thousands of rows they move.
  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "business.merge",
        // The absorbed listing, matching what merge and unmerge write for the
        // same pair, so `/admin/audit` shows the whole history of one business
        // together. A `MergeCandidate:` subject would be truthful and orphaned —
        // that id appears nowhere a person would think to search.
        subject: `Business:${candidate.absorbId}`,
        reason: input.reason,
        tx,
      },
      async () => {
        const row = await tx.mergeCandidate.update({
          where: { id: candidate.id },
          data: {
            dismissedAt,
            dismissedById: input.actor.id,
            // Kept on the row as well as in the audit event. The dedupe screen
            // reads it back beside the pair; the audit row is the record.
            dismissReason: input.reason.trim(),
          },
          select: { id: true },
        });
        return {
          result: row.id,
          before: {
            dismissedAt: null,
            keepId: candidate.keepId,
            absorbId: candidate.absorbId,
            score: candidate.score,
            band: candidate.band,
          },
          after: { dismissedAt, dismissedById: input.actor.id },
        };
      },
    ),
  );

  return { ok: true };
}
