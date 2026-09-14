import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import { assertCan } from "@/lib/auth/can";
import type { Actor } from "@/lib/auth/roles";
import type { Prisma } from "@/lib/db/generated/client";
import { resolveEnquiryArea } from "@/lib/enquiry/area";
import { effectiveAuthority } from "@/lib/ingest/classify";
import { runCounts } from "@/lib/ingest/counts";
import { KNOWN_AUTHORITIES, separatedLicences } from "@/lib/ingest/service";
import { bandsProblem, percent, roundBand, type BandsProblem } from "./bands";
import { bestMatch, buildMatchIndex, chooseParent } from "./match";
import { PENDING } from "./queue";
import { listingFacts, scanListingPairs } from "./service";
import { bandFor, licenceDigits, type Bands, type Signal } from "./similarity";
import { BANDS_SETTING_KEY, loadMatchListings, readBands, recordAsListing } from "./source";

/**
 * `Tune matching` — board `12b` B8.
 *
 * *"Tune matching changes how many pairs reach this screen, so the queue size
 * must be previewed before it is applied."* The preview runs the real matcher
 * against the proposed lines and writes nothing; applying runs the same
 * computation again inside the transaction that stores the lines, so what was
 * previewed and what happens cannot drift apart between two code paths.
 *
 * Moving the lines moves three things:
 *
 *  - pending pairs change band, and the ones under a raised floor are withdrawn
 *    with the reason `below_floor`;
 *  - records still open in a run that now reach a lowered floor become
 *    duplicates with a pair of their own;
 *  - listing pairs a lowered floor reaches are added.
 */

export interface TuningFigures {
  certain: number;
  probable: number;
  /** Pending pairs the proposed floor would withdraw. */
  withdrawn: number;
  /** Open records that would newly pair with a listing. */
  newRecordPairs: number;
  /** Listing pairs that would newly reach the floor. */
  newListingPairs: number;
}

export type TuningPreview =
  | { ok: true; current: Bands; proposed: Bands; now: { certain: number; probable: number }; after: TuningFigures }
  | { ok: false; problem: BandsProblem };

type Db = typeof prisma | Prisma.TransactionClient;

interface Computed {
  proposed: Bands;
  pending: { id: string; score: number; band: string }[];
  after: TuningFigures;
  recordPairs: { recordId: string; runId: string; listingId: string; score: number; band: "certain" | "probable"; signals: Signal[] }[];
  listingPairs: { a: string; b: string; score: number; band: "certain" | "probable"; signals: Signal[] }[];
}

async function compute(proposed: Bands, db: Db): Promise<Computed> {
  const [pending, records, listings, areas, existingListingPairs, separations] = await Promise.all([
    db.mergeCandidate.findMany({ where: PENDING, select: { id: true, score: true, band: true } }),
    db.stagedListing.findMany({
      where: {
        disposition: { in: ["ready", "needs_category"] },
        run: { status: { in: ["staged", "approved"] } },
      },
      select: {
        id: true,
        runId: true,
        tradeName: true,
        licenceNumber: true,
        licenceAuthority: true,
        emirate: true,
        areaName: true,
        phone: true,
        activityKey: true,
        run: { select: { source: true } },
      },
    }),
    loadMatchListings(db),
    db.area.findMany({ select: { id: true, name: true, emirate: true } }),
    db.mergeCandidate.findMany({ where: { absorbId: { not: null } }, select: { keepId: true, absorbId: true } }),
    // A record somebody kept separate is not pulled back into a pair by a
    // lower floor (B2).
    separatedLicences(db),
  ]);

  const after: TuningFigures = { certain: 0, probable: 0, withdrawn: 0, newRecordPairs: 0, newListingPairs: 0 };
  for (const pair of pending) {
    const band = bandFor(pair.score, proposed);
    if (band === "unlikely") after.withdrawn += 1;
    else after[band] += 1;
  }

  const index = buildMatchIndex(listings);
  const areaName = new Map(areas.map((area) => [area.id, area.name]));
  const recordPairs: Computed["recordPairs"] = [];
  for (const record of records) {
    const areaId = resolveEnquiryArea(record.areaName, record.emirate, areas);
    const authority = effectiveAuthority(record.licenceAuthority, record.run.source, KNOWN_AUTHORITIES);
    const { match } = bestMatch(
      recordAsListing({
        id: record.id,
        tradeName: record.tradeName,
        licenceNumber: record.licenceNumber,
        authority: authority.code ?? authority.stated ?? record.run.source,
        emirate: record.emirate,
        areaId,
        areaName: areaId ? (areaName.get(areaId) ?? null) : record.areaName,
        phone: record.phone,
        activityKey: record.activityKey,
      }),
      index,
      proposed,
      separations.get(licenceDigits(record.licenceNumber ?? "")) ?? new Set(),
    );
    if (match) {
      recordPairs.push({
        recordId: record.id,
        runId: record.runId,
        listingId: match.listing.id,
        score: match.similarity.score,
        band: match.similarity.band as "certain" | "probable",
        signals: match.similarity.signals,
      });
      after[match.similarity.band as "certain" | "probable"] += 1;
    }
  }
  after.newRecordPairs = recordPairs.length;

  const seen = new Set(
    existingListingPairs.map(({ keepId, absorbId }) => (keepId < absorbId! ? `${keepId}|${absorbId}` : `${absorbId}|${keepId}`)),
  );
  const listingPairs = (await scanListingPairs(proposed, db))
    .filter((pair) => !seen.has(`${pair.a.id}|${pair.b.id}`))
    .map((pair) => ({ a: pair.a.id, b: pair.b.id, score: pair.score, band: pair.band, signals: pair.signals }));
  for (const pair of listingPairs) after[pair.band] += 1;
  after.newListingPairs = listingPairs.length;

  return { proposed, pending, after, recordPairs, listingPairs };
}

export async function previewTuning(input: { actor: Actor; bands: Bands }): Promise<TuningPreview> {
  assertCan(input.actor, "business.merge");
  const proposed = { floor: roundBand(input.bands.floor), certain: roundBand(input.bands.certain) };
  const problem = bandsProblem(proposed);
  if (problem) return { ok: false, problem };

  const [current, pending, computed] = await Promise.all([
    readBands(),
    prisma.mergeCandidate.groupBy({ by: ["band"], where: PENDING, _count: { _all: true } }),
    compute(proposed, prisma),
  ]);
  const of = (band: string) => pending.find((row) => row.band === band)?._count._all ?? 0;
  return {
    ok: true,
    current,
    proposed,
    now: { certain: of("certain"), probable: of("probable") },
    after: computed.after,
  };
}

export type TuningResult =
  | { ok: true; bands: Bands; after: TuningFigures }
  | { ok: false; problem: BandsProblem };

/** A re-tune adds at most this many listing pairs; the rest wait for a rescan. */
const LISTING_PAIR_CAP = 500;

export async function applyTuning(
  input: { actor: Actor; bands: Bands; reason: string },
  now = new Date(),
): Promise<TuningResult> {
  assertCan(input.actor, "business.merge");
  const proposed = { floor: roundBand(input.bands.floor), certain: roundBand(input.bands.certain) };
  const problem = bandsProblem(proposed);
  if (problem) return { ok: false, problem };
  const current = await readBands();

  const after = await prisma.$transaction(
    async (tx) =>
      staffMutation(
        {
          actor: input.actor,
          capability: "business.merge",
          action: "matching_tuned",
          subject: `PlatformSetting:${BANDS_SETTING_KEY}`,
          reason: input.reason,
          tx,
        },
        async () => {
          const computed = await compute(proposed, tx);

          await tx.platformSetting.upsert({
            where: { key: BANDS_SETTING_KEY },
            create: { key: BANDS_SETTING_KEY, value: proposed as unknown as Prisma.InputJsonValue, updatedById: input.actor.id },
            update: { value: proposed as unknown as Prisma.InputJsonValue, updatedById: input.actor.id },
          });

          await tx.mergeCandidate.updateMany({
            where: { ...PENDING, score: { gte: proposed.certain } },
            data: { band: "certain" },
          });
          await tx.mergeCandidate.updateMany({
            where: { ...PENDING, score: { gte: proposed.floor, lt: proposed.certain } },
            data: { band: "probable" },
          });
          await tx.mergeCandidate.updateMany({
            where: { ...PENDING, score: { lt: proposed.floor } },
            data: { state: "withdrawn", withdrawnReason: "below_floor" },
          });

          const runs = new Set<string>();
          for (const pair of computed.recordPairs) {
            await tx.stagedListing.update({
              where: { id: pair.recordId },
              data: {
                disposition: "duplicate",
                duplicateOfId: pair.listingId,
                categoryId: null,
                categorySource: null,
                categorisedById: null,
                categorisedAt: null,
              },
            });
            await tx.mergeCandidate.create({
              data: {
                keepId: pair.listingId,
                stagedListingId: pair.recordId,
                sourceRunId: pair.runId,
                score: pair.score,
                band: pair.band,
                signals: pair.signals as unknown as Prisma.InputJsonValue,
              },
            });
            runs.add(pair.runId);
          }
          for (const runId of runs) {
            await tx.licenceImportRun.update({ where: { id: runId }, data: await runCounts(tx, runId) });
          }

          const listingPairs = computed.listingPairs.slice(0, LISTING_PAIR_CAP);
          const facts = await listingFacts(tx, listingPairs.flatMap((pair) => [pair.a, pair.b]));
          if (listingPairs.length > 0) {
            await tx.mergeCandidate.createMany({
              data: listingPairs.map((pair) => {
                const a = facts.get(pair.a);
                const b = facts.get(pair.b);
                const choice = a && b ? chooseParent(a, b) : null;
                const keepId = choice?.kind === "parent" ? choice.parentId : pair.a;
                return {
                  keepId,
                  absorbId: keepId === pair.a ? pair.b : pair.a,
                  score: pair.score,
                  band: pair.band,
                  signals: pair.signals as unknown as Prisma.InputJsonValue,
                };
              }),
              skipDuplicates: true,
            });
          }

          return {
            result: computed.after,
            before: { floorLine: percent(current.floor), certainLine: percent(current.certain) },
            after: {
              floorLine: percent(proposed.floor),
              certainLine: percent(proposed.certain),
              ...computed.after,
              listingPairsCapped: Math.max(0, computed.listingPairs.length - LISTING_PAIR_CAP),
              at: now.toISOString(),
            },
          };
        },
      ),
    { timeout: 120_000, maxWait: 10_000 },
  );

  return { ok: true, bands: proposed, after };
}
