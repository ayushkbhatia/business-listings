import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import { assertCan } from "@/lib/auth/can";
import type { Actor } from "@/lib/auth/roles";
import { parseCsv } from "@/lib/import/csv";
import { resolveEnquiryArea } from "@/lib/enquiry/area";
import { buildBusinessSearchText } from "@/lib/search/index-text";
import { normaliseLicenceNumber } from "@/lib/verification/licence/number";
import { buildMatchIndex, bestMatch } from "@/lib/dedupe/match";
import { licenceDigits } from "@/lib/dedupe/similarity";
import { loadMatchListings, readBands, recordAsListing } from "@/lib/dedupe/source";
import { runMergePlan, unwindRunTx, withdrawRunPairsTx } from "@/lib/dedupe/resolve";
import { can } from "@/lib/auth/can";
import { $Enums, Prisma } from "@/lib/db/generated/client";
import { runCounts } from "./counts";
import {
  activityKey,
  classify,
  displayNameFor,
  effectiveAuthority,
  heldReasons,
  KEPT_BECAUSE,
  licenceKey,
  normaliseEmirate,
  stagedOutcome,
  tally,
  type KeptBecause,
  type LicenceRecord,
  type RollbackManifest,
} from "./classify";

export { KEPT_BECAUSE, type KeptBecause, type RollbackManifest };

/**
 * Board 12a — the licence-record importer.
 *
 * Criterion 1: *"an import run of 8,000 records stages without publishing,
 * categorises what it can, queues what it cannot, and lists rejections by
 * countable reason."*
 *
 * The order of those clauses is the design. **Nothing publishes itself** — a
 * run parses and stages, and a person approves (B1). `stageRun` has no path
 * that writes a `Business`, and `StagedListing` has a CHECK refusing a
 * `business_id` on any row not marked `published`.
 *
 * ## A run's life
 *
 *     staged ──publish──▶ approved ──rollback (30 days)──▶ rolled_back
 *        └────discard───▶ discarded
 *
 * Publishing is not once. A run approves with part of its file still waiting on
 * the categorisation queue (B3), and the records that queue clears afterwards
 * publish from the same run by the same control, each time audited. The old
 * approval moved the run to `approved` and could never be called again, which
 * stranded every record it had skipped — the build plan's "approval
 * permanently strands every row it skipped".
 *
 * Every one of those transitions, and the upload itself, is a `staffMutation`
 * with a written reason (B8).
 */

/** B4. Every run is reversible for this long after its first publish. */
export const REVERSIBLE_DAYS = 30;

const DAY_MS = 86_400_000;

/**
 * `Business.licenceAuthority` is an enum and a staged authority is free text.
 *
 * An export from an authority we have not seen is a real thing — a new free
 * zone opens and its code is not in our enum — and it must not stop the import.
 * An unrecognised code stages fine and holds the record back from becoming a
 * listing, where the enum would refuse it anyway.
 */
export const KNOWN_AUTHORITIES: ReadonlySet<string> = new Set(
  Object.values($Enums.Authority) as string[],
);

/**
 * A run id before the run exists.
 *
 * The upload is audited (B8), and `staffMutation` names its subject before the
 * mutation runs — the reason and the permission are checked before anything is
 * written, which is the order that makes a denied upload write nothing. So the
 * id is chosen here rather than by the column default. Same length and
 * alphabet as a cuid, and `id` is a TEXT column that only needs to be unique.
 */
function newRunId(): string {
  return `c${Date.now().toString(36)}${randomBytes(8).toString("hex")}`.slice(0, 25);
}

const COLUMN_ALIASES: Record<keyof LicenceRecord, readonly string[]> = {
  tradeName: ["trade name", "tradename", "name", "company", "company name", "الاسم التجاري"],
  licenceNumber: ["licence no", "license no", "licence number", "license number", "licence", "license"],
  licenceAuthority: ["authority", "issuing authority", "licence authority", "free zone"],
  licenceExpiry: ["expiry date", "expiry", "licence expiry", "valid until", "expires"],
  emirate: ["emirate", "state", "region"],
  areaName: ["area", "location", "district"],
  activity: ["activity", "activities", "business activity", "licence activity"],
  phone: ["phone", "telephone", "tel", "contact", "mobile"],
};

/** Which column of the export is which field, by header. */
export function mapColumns(headers: readonly string[]): Partial<Record<keyof LicenceRecord, number>> {
  const map: Partial<Record<keyof LicenceRecord, number>> = {};

  headers.forEach((header, index) => {
    const key = header.trim().toLowerCase();
    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (map[field as keyof LicenceRecord] !== undefined) continue;
      if (aliases.includes(key)) map[field as keyof LicenceRecord] = index;
    }
  });

  return map;
}

/**
 * A date, from whatever an authority wrote.
 *
 * Exports carry ISO, `DD/MM/YYYY` and `DD-MM-YYYY`, and the last two are the
 * dangerous ones: read as American, `03/08/2027` is five months out — which
 * would push a live licence over the 24-month floor and reject a real supplier.
 * Day-first is assumed, because every authority here writes day-first.
 */
export function parseLicenceDate(value: string | undefined): Date | null {
  const text = (value ?? "").trim();
  if (!text) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return validDate(+iso[1]!, +iso[2]!, +iso[3]!);

  const dayFirst = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  if (dayFirst) return validDate(+dayFirst[3]!, +dayFirst[2]!, +dayFirst[1]!);

  return null;
}

/**
 * `Date.UTC(2027, 1, 31)` is the third of March, silently. An expiry of 31/02
 * is a typing error in the export and becomes a real-looking date a month
 * later; refusing it holds the record for a person instead (B6).
 */
function validDate(year: number, month: number, day: number): Date | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date
    : null;
}

/** One authority export. Larger than a catalogue, and still bounded. */
export const MAX_LICENCE_ROWS = 50_000;

export type StageResult =
  | { ok: true; runId: string; totals: ReturnType<typeof tally>; truncated: number }
  | { ok: false; error: "empty" | "no_trade_name_column"; message: string };

export interface StageInput {
  actor: Actor;
  source: string;
  filename: string;
  text: string;
  /** B8: the upload is logged with a written reason, like approval and rollback. */
  reason: string;
}

/**
 * Licence digits a person has said are not a given listing — board 12b B2.
 *
 * From a record kept separate, the record's digits against the listing it was
 * paired with. From two listings kept separate, each listing's digits against
 * the other, because next month's file re-sends one of them.
 */
export async function separatedLicences(
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<Map<string, Set<string>>> {
  const rows = await db.mergeCandidate.findMany({
    where: { state: "separated" },
    select: {
      keepId: true,
      absorbId: true,
      keep: { select: { licenceNumber: true } },
      absorb: { select: { licenceNumber: true } },
      stagedListing: { select: { licenceNumber: true } },
    },
  });
  const map = new Map<string, Set<string>>();
  const add = (licence: string | null | undefined, listingId: string | null) => {
    const digits = licenceDigits(licence ?? "");
    if (!digits || !listingId) return;
    const set = map.get(digits) ?? new Set<string>();
    set.add(listingId);
    map.set(digits, set);
  };
  for (const row of rows) {
    add(row.stagedListing?.licenceNumber, row.keepId);
    add(row.absorb?.licenceNumber, row.keepId);
    add(row.keep.licenceNumber, row.absorbId);
  }
  return map;
}

/**
 * Parse, classify, stage. Publishes nothing.
 *
 * **Whole or not at all.** The run row and every staged record are written in
 * one transaction, so a failure at record 6,000 leaves no run rather than a
 * run of 5,999 that reads as the file ("Parse failure: the run fails whole. A
 * half-imported registry file is worse than none").
 *
 * This used to sit outside `staffMutation`, on the argument that staging
 * changes nothing a buyer sees. B8 moved it inside: an upload is the start of
 * the one path in the product that mints thousands of listings, and "who
 * loaded this file, and why" is the first question anybody asks of a bad run —
 * run 10 duplicated a whole free zone.
 */
export async function stageRun(input: StageInput, now = new Date()): Promise<StageResult> {
  // Refused before an 8,000-row file is parsed, not after. `staffMutation`
  // asserts it again at the write, which is the check that counts.
  assertCan(input.actor, "queue.decide");

  /*
   * A ceiling of its own. `MAX_ROWS` is 5,000, which is right for a seller's
   * catalogue and wrong for an authority export — criterion 1 names 8,000, and
   * an emirate has rather more companies than that.
   */
  const { headers, rows: body, truncated } = parseCsv(input.text, MAX_LICENCE_ROWS);
  if (body.length === 0) {
    return { ok: false, error: "empty", message: "That file has no rows under its header." };
  }

  const columns = mapColumns(headers);

  if (columns.tradeName === undefined) {
    return {
      ok: false,
      error: "no_trade_name_column",
      message:
        "No column looks like a trade name. The importer needs one — everything else it can do without.",
    };
  }

  const at = (row: string[], key: keyof LicenceRecord): string | undefined => {
    const index = columns[key];
    return index === undefined ? undefined : row[index];
  };

  const source = input.source.trim().toUpperCase();

  const records = body.map((row, index) => {
    const record: LicenceRecord = {
      tradeName: at(row, "tradeName")?.trim() || null,
      licenceNumber: at(row, "licenceNumber")?.trim() || null,
      licenceAuthority: at(row, "licenceAuthority")?.trim() || null,
      licenceExpiry: parseLicenceDate(at(row, "licenceExpiry")),
      emirate: at(row, "emirate")?.trim() || null,
      areaName: at(row, "areaName")?.trim() || null,
      activity: at(row, "activity")?.trim() || null,
      phone: at(row, "phone")?.trim() || null,
    };
    const authority = effectiveAuthority(record.licenceAuthority, source, KNOWN_AUTHORITIES);
    return {
      rowNumber: index + 1,
      // Everything as it arrived. A rejection has to be arguable, and it is not
      // if we threw away what we were arguing about (B5).
      raw: Object.fromEntries(headers.map((header, i) => [header, row[i] ?? ""])),
      record,
      key: activityKey(record.activity),
      licence: licenceKey(authority.code ?? authority.stated ?? source, record.licenceNumber),
      verdict: classify(record, now),
    };
  });

  const [categories, mappings, listings, bands, areas, separations] = await Promise.all([
    prisma.category.findMany({ select: { id: true, slug: true } }),
    prisma.licenceActivityMapping.findMany({
      where: { activityKey: { in: [...new Set(records.map((r) => r.key).filter(Boolean))] } },
      select: { activityKey: true, categoryId: true },
    }),
    /*
       B9, and then board 12b: a record is paired with the listing it most
       resembles — the same licence, a branch of it (a shared root), or a shared
       phone and most of a name — and a pair at or above the floor goes to a
       person instead of becoming a second listing. The first version of this
       matched licence numbers exactly and nothing else, so `DED-441908-01`
       staged as a new company beside `DED-441908`.
    */
    loadMatchListings(),
    readBands(),
    prisma.area.findMany({ select: { id: true, name: true, emirate: true } }),
    /*
       B2: *keep as separate* teaches the matcher. A record a person said is
       not a listing is not paired with that listing again when next month's
       file re-sends it.
    */
    separatedLicences(),
  ]);

  const categoryBySlug = new Map(categories.map((category) => [category.slug, category.id]));
  const mappedCategory = new Map(mappings.map((m) => [m.activityKey, m.categoryId]));
  const index = buildMatchIndex(listings);
  const areaById = new Map(areas.map((area) => [area.id, area]));

  // The first row of the file carrying a licence keeps it; a later one repeats it.
  const firstRowFor = new Map<string, number>();
  let belowFloor = 0;

  const staged = records.map((row) => {
    let duplicateOfId: string | null = null;
    let duplicateOfRow: number | null = null;
    let pair: { score: number; band: "certain" | "probable"; signals: unknown } | null = null;

    if (row.verdict.disposition !== "rejected") {
      const earlier = row.licence ? firstRowFor.get(row.licence) : undefined;
      if (row.licence && earlier !== undefined) {
        // An exact repeat inside one file is the file repeating itself, not a
        // company to argue about. It does not reach the dedupe queue.
        duplicateOfRow = earlier;
      } else {
        if (row.licence) firstRowFor.set(row.licence, row.rowNumber);
        const emirate = normaliseEmirate(row.record.emirate);
        const areaId = resolveEnquiryArea(row.record.areaName, emirate, areas);
        const authority = effectiveAuthority(row.record.licenceAuthority, source, KNOWN_AUTHORITIES);
        const result = bestMatch(
          recordAsListing({
            id: String(row.rowNumber),
            tradeName: row.record.tradeName ?? null,
            licenceNumber: row.record.licenceNumber ?? null,
            authority: authority.code ?? authority.stated ?? source,
            emirate,
            areaId,
            areaName: areaId ? (areaById.get(areaId)?.name ?? null) : (row.record.areaName ?? null),
            phone: row.record.phone ?? null,
            activityKey: row.key,
          }),
          index,
          bands,
          separations.get(licenceDigits(row.record.licenceNumber ?? "")) ?? new Set(),
        );
        if (result.match) {
          duplicateOfId = result.match.listing.id;
          pair = {
            score: result.match.similarity.score,
            band: result.match.similarity.band as "certain" | "probable",
            signals: result.match.similarity.signals,
          };
        } else if (result.nearMiss) {
          belowFloor += 1;
        }
      }
    }

    const signalSlug = row.verdict.categorySlug;
    const outcome = stagedOutcome({
      verdict: row.verdict,
      duplicate: duplicateOfId !== null || duplicateOfRow !== null,
      mappedCategoryId: row.key ? (mappedCategory.get(row.key) ?? null) : null,
      signalCategoryId: signalSlug ? (categoryBySlug.get(signalSlug) ?? null) : null,
    });

    return { ...row, outcome, duplicateOfId, duplicateOfRow, pair };
  });

  const totals = tally(staged.map((row) => row.outcome));
  const runId = newRunId();

  await prisma.$transaction(
    async (tx) =>
      staffMutation(
        {
          actor: input.actor,
          capability: "queue.decide",
          subject: `LicenceImportRun:${runId}`,
          reason: input.reason,
          tx,
        },
        async () => {
          await tx.licenceImportRun.create({
            data: {
              id: runId,
              actorId: input.actor.id,
              source,
              filename: input.filename.trim() || "export.csv",
              status: "parsing",
              rowCount: totals.rows,
              truncatedCount: truncated,
              stagedCount: totals.staged,
              categorisedCount: totals.categorised,
              queuedCount: totals.queued,
              rejectedCount: totals.rejected,
              duplicateCount: totals.duplicates,
              belowFloorCount: belowFloor,
              headers,
            },
            select: { id: true },
          });

          /*
           * Chunked. `createMany` with 8,000 rows in one statement is a parameter
           * count Postgres refuses, and finding that out at 8,000 rather than at
           * 40 is the whole reason criterion 1 names a real number.
           */
          const CHUNK = 500;
          let pairs = 0;
          // B4: the records this upload staged, counted from the rows each
          // `createManyAndReturn` gave back.
          let recordsStaged = 0;
          for (let i = 0; i < staged.length; i += CHUNK) {
            const slice = staged.slice(i, i + CHUNK);
            const created = await tx.stagedListing.createManyAndReturn({
              data: slice.map((row) => ({
                runId,
                rowNumber: row.rowNumber,
                raw: row.raw,
                tradeName: row.record.tradeName ?? null,
                licenceNumber: row.record.licenceNumber ?? null,
                licenceAuthority: row.record.licenceAuthority ?? null,
                licenceExpiry: row.record.licenceExpiry ?? null,
                emirate: normaliseEmirate(row.record.emirate),
                areaName: row.record.areaName ?? null,
                activity: row.record.activity ?? null,
                activityKey: row.key,
                phone: row.record.phone ?? null,
                categoryId: row.outcome.categoryId,
                categorySource: row.outcome.categorySource,
                disposition: row.outcome.disposition,
                rejectionGround: row.outcome.ground,
                duplicateOfId: row.duplicateOfId,
                duplicateOfRow: row.duplicateOfRow,
              })),
              select: { id: true, rowNumber: true },
            });
            recordsStaged += created.length;

            // The pair each duplicate goes to board 12b as, in the same
            // transaction: a record marked duplicate with no pair is a record
            // no screen can ever resolve.
            const idByRow = new Map(created.map((row) => [row.rowNumber, row.id]));
            const candidates = slice
              .filter((row) => row.pair && row.duplicateOfId)
              .map((row) => ({
                keepId: row.duplicateOfId!,
                stagedListingId: idByRow.get(row.rowNumber)!,
                sourceRunId: runId,
                score: row.pair!.score,
                band: row.pair!.band,
                signals: row.pair!.signals as Prisma.InputJsonValue,
              }));
            if (candidates.length > 0) {
              await tx.mergeCandidate.createMany({ data: candidates });
              pairs += candidates.length;
            }
          }

          // Staged only once every record is in. `parsing` is never visible
          // outside this transaction, which is the point of it.
          await tx.licenceImportRun.update({ where: { id: runId }, data: { status: "staged" } });

          return {
            result: runId,
            before: null,
            after: {
              status: "staged",
              source,
              filename: input.filename,
              rows: totals.rows,
              newListings: totals.staged,
              categorised: totals.categorised,
              queued: totals.queued,
              duplicates: totals.duplicates,
              pairs,
              belowFloor,
              rejected: totals.rejected,
              truncated,
            },
            blastRadius: { count: recordsStaged, unit: "records" },
          };
        },
      ),
    { timeout: 120_000, maxWait: 10_000 },
  );

  return { ok: true, runId, totals, truncated };
}

/* ── Publishing ──────────────────────────────────────────────────────────── */

export type PublishResult =
  | { ok: true; created: number; held: number; duplicates: number; withoutAddress: number }
  | {
      ok: false;
      error: "not_found" | "not_open" | "nothing_ready";
      message: string;
    };

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Publish what in this run can publish: approve a staged run, or publish what
 * its queue has cleared since.
 *
 * The audited event that changes what a buyer sees. A listing created here is
 * **live, unclaimed and tier 0** — handoff `12a`: "6,104 new listings will go
 * live as unclaimed pages only after you approve this run — and every one of
 * them carries the 'not verified by us' banner until someone claims it." The
 * first version of this created every listing unpublished, which made the
 * directory's whole cold-start mechanism a set of pages nobody could reach —
 * including the business itself, which is how a claim starts.
 *
 * What does not publish, and stays exactly where it is (B3):
 *
 *  - a record waiting on a category — unreachable by search, facets and the
 *    fan-out, so publishing it is "Other" without the label;
 *  - an authority we have no code for, a missing licence number, a missing
 *    expiry — each of which the old approval skipped in silence or invented;
 *  - a licence another run has put in the directory since this one was staged,
 *    which is marked a duplicate here rather than created twice (B9).
 */
export async function publishRun(
  input: { actor: Actor; runId: string; reason: string },
  now = new Date(),
): Promise<PublishResult> {
  assertCan(input.actor, "queue.decide");

  const run = await prisma.licenceImportRun.findUnique({
    where: { id: input.runId },
    select: { id: true, status: true, source: true, reversibleUntil: true },
  });
  if (!run) return { ok: false, error: "not_found", message: "That run is not in the importer." };
  if (run.status !== "staged" && run.status !== "approved") {
    return {
      ok: false,
      error: "not_open",
      message:
        run.status === "rolled_back"
          ? "That run was rolled back. Nothing more publishes from it."
          : `That run is ${run.status}. Nothing publishes from it.`,
    };
  }

  const open = await prisma.stagedListing.findMany({
    where: { runId: run.id, disposition: { in: ["ready", "needs_category"] } },
    orderBy: { rowNumber: "asc" },
    select: {
      id: true,
      rowNumber: true,
      disposition: true,
      tradeName: true,
      licenceNumber: true,
      licenceAuthority: true,
      licenceExpiry: true,
      emirate: true,
      areaName: true,
      activity: true,
      activityKey: true,
      phone: true,
      categoryId: true,
    },
  });

  const candidates = open.filter(
    (row) => heldReasons(row, run.source, KNOWN_AUTHORITIES).length === 0,
  );
  const held = open.length - candidates.length;

  /*
     Re-matched at publish, because another run may have published this
     company between the file being staged and this click — and a pair found
     now goes to board 12b rather than becoming a second listing (B9).
     Separations a person already made are honoured, so a record kept separate
     is not sent straight back.
  */
  const [listings, bands, areas, separations] = await Promise.all([
    candidates.length > 0 ? loadMatchListings() : Promise.resolve([]),
    readBands(),
    prisma.area.findMany({ select: { id: true, name: true, emirate: true } }),
    candidates.length > 0 ? separatedLicences() : Promise.resolve(new Map<string, Set<string>>()),
  ]);
  const index = buildMatchIndex(listings);
  const areaName = new Map(areas.map((area) => [area.id, area.name]));

  const collided: { id: string; businessId: string; score: number; band: string; signals: unknown }[] = [];
  const ready = candidates.filter((row) => {
    const authority = effectiveAuthority(row.licenceAuthority, run.source, KNOWN_AUTHORITIES).code!;
    const areaId = resolveEnquiryArea(row.areaName, row.emirate, areas);
    const { match } = bestMatch(
      recordAsListing({
        id: row.id,
        tradeName: row.tradeName,
        licenceNumber: row.licenceNumber,
        authority,
        emirate: row.emirate,
        areaId,
        areaName: areaId ? (areaName.get(areaId) ?? null) : row.areaName,
        phone: row.phone,
        activityKey: row.activityKey,
      }),
      index,
      bands,
      separations.get(licenceDigits(row.licenceNumber ?? "")) ?? new Set(),
    );
    if (match) {
      collided.push({
        id: row.id,
        businessId: match.listing.id,
        score: match.similarity.score,
        band: match.similarity.band,
        signals: match.similarity.signals,
      });
      return false;
    }
    return true;
  });

  const firstDecision = run.status === "staged";

  /*
     A run with nothing new is a valid monthly delta and approving it is a real
     decision — "zero new listings" must read as a result, not an error. A run
     whose records are all still waiting is not: there is nothing to decide yet.
  */
  if (ready.length === 0 && (held > 0 || !firstDecision) && collided.length === 0) {
    return {
      ok: false,
      error: "nothing_ready",
      message:
        held > 0
          ? "Nothing in this run can publish yet. The records left are waiting on the categorisation queue or on a fix."
          : "Everything in this run that can publish already has.",
    };
  }

  const categoryIds = [...new Set(ready.map((row) => row.categoryId!))];
  const [categories, takenSlugs] = await Promise.all([
    prisma.category.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true, name: true, synonyms: true },
    }),
    // Slugs must be free on arrival, and two rows of one export can want the
    // same one. Resolved against the database and against each other.
    prisma.business.findMany({ select: { slug: true } }),
  ]);
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const taken = new Set(takenSlugs.map((row) => row.slug));

  const prepared = ready.map((row) => {
    const authority = effectiveAuthority(row.licenceAuthority, run.source, KNOWN_AUTHORITIES)
      .code as $Enums.Authority;
    const base = slugify(row.tradeName ?? "") || `listing-${row.id.slice(-8)}`;
    let slug = base;
    for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;
    taken.add(slug);

    const normalised = normaliseLicenceNumber(row.licenceNumber!, authority);
    const category = categoryById.get(row.categoryId!);
    const displayName = displayNameFor(row.tradeName!);

    return {
      row,
      slug,
      areaId: resolveEnquiryArea(row.areaName, row.emirate, areas),
      business: {
        tradeName: row.tradeName!.trim(),
        displayName,
        slug,
        // Canonical where the number agrees with its authority, and as the
        // register wrote it where it does not — rewriting a disagreeing prefix
        // would erase the disagreement.
        licenceNumber: normalised.ok ? normalised.value : row.licenceNumber!.trim(),
        licenceAuthority: authority,
        // B6: the register's date, expired or not. Under the 24-month floor an
        // expired licence publishes, and the listing carries the fact.
        licenceExpiry: row.licenceExpiry!,
        licenceActivity: row.activity,
        primaryCategoryId: row.categoryId!,
        claimStatus: "unclaimed" as const,
        source: "licence_import" as const,
        licenceImportRunId: run.id,
        // Nothing has been checked. Tier 0 says so, and the unclaimed banner
        // says it to the buyer.
        verificationTier: 0,
        publishedAt: now,
        searchText: buildBusinessSearchText({
          displayName,
          tradeName: row.tradeName!,
          description: null,
          categoryNames: category ? [category.name] : [],
          synonyms: category?.synonyms ?? [],
          products: [],
        }),
      },
    };
  });

  const withoutAddress = prepared.filter((item) => item.areaId === null).length;

  const created = await prisma.$transaction(
    async (tx) =>
      staffMutation(
        {
          actor: input.actor,
          capability: "queue.decide",
          subject: `LicenceImportRun:${run.id}`,
          reason: input.reason,
          tx,
        },
        async () => {
          /*
           * Three statements per five hundred listings, not three per listing.
           * The first version created each business, then updated its staged
           * row, one round trip at a time — 12,000 of them for a 6,000-listing
           * run, inside one transaction, against a pooled database.
           */
          const CHUNK = 500;
          let count = 0;

          for (let i = 0; i < prepared.length; i += CHUNK) {
            const slice = prepared.slice(i, i + CHUNK);
            const rows = await tx.business.createManyAndReturn({
              data: slice.map((item) => item.business),
              select: { id: true, slug: true },
            });
            const idBySlug = new Map(rows.map((row) => [row.slug, row.id]));

            /*
             * The register's address, where its area is one we know. An area we
             * cannot match exactly gets no branch rather than a guessed one —
             * `resolveEnquiryArea`'s rule, and for the same reason: a wrong area
             * sends a buyer to the wrong part of the emirate.
             */
            const locations = slice
              .filter((item) => item.areaId !== null)
              .map((item) => ({
                businessId: idBySlug.get(item.slug)!,
                type: "head_office" as const,
                emirate: item.row.emirate as $Enums.Emirate,
                areaId: item.areaId!,
                addressLine: item.row.areaName!.trim(),
                phone: item.row.phone,
                phoneVerified: false,
                published: true,
                publishedAt: now,
              }));
            if (locations.length > 0) await tx.location.createMany({ data: locations });

            const pairs = slice.map((item) => Prisma.sql`(${item.row.id}, ${idBySlug.get(item.slug)!})`);
            await tx.$executeRaw`
              UPDATE "staged_listing" AS s
                 SET "disposition" = 'published'::"staged_disposition",
                     "business_id" = v.business_id
                FROM (VALUES ${Prisma.join(pairs)}) AS v(id, business_id)
               WHERE s."id" = v.id`;
            count += rows.length;
          }

          if (collided.length > 0) {
            const pairs = collided.map((item) => Prisma.sql`(${item.id}, ${item.businessId})`);
            await tx.$executeRaw`
              UPDATE "staged_listing" AS s
                 SET "disposition" = 'duplicate'::"staged_disposition",
                     "duplicate_of_id" = v.business_id,
                     "category_id" = NULL,
                     "category_source" = NULL,
                     "categorised_by_id" = NULL,
                     "categorised_at" = NULL
                FROM (VALUES ${Prisma.join(pairs)}) AS v(id, business_id)
               WHERE s."id" = v.id`;
            await tx.mergeCandidate.createMany({
              data: collided.map((item) => ({
                keepId: item.businessId,
                stagedListingId: item.id,
                sourceRunId: run.id,
                score: item.score,
                band: item.band as "certain" | "probable",
                signals: item.signals as Prisma.InputJsonValue,
              })),
              skipDuplicates: true,
            });
          }

          const counts = await runCounts(tx, run.id);

          await tx.licenceImportRun.update({
            where: { id: run.id },
            data: {
              ...counts,
              ...(firstDecision
                ? {
                    status: "approved" as const,
                    decisionReason: input.reason.trim(),
                    decidedAt: now,
                    decidedById: input.actor.id,
                  }
                : {}),
              // The window opens on the first listing, not on the decision: a
              // run approved with nothing new has nothing to take back.
              ...(run.reversibleUntil === null && count > 0
                ? { reversibleUntil: new Date(now.getTime() + REVERSIBLE_DAYS * DAY_MS) }
                : {}),
            },
          });

          return {
            result: count,
            before: { status: run.status },
            after: {
              status: "approved",
              listingsCreated: count,
              heldBack: held,
              newDuplicates: collided.length,
              withoutAddress,
            },
            /*
               B4: the listings this decision put live, counted from the rows
               `createManyAndReturn` gave back. Zero is a real result here — a
               monthly delta with nothing new is still a decision about a run.
            */
            blastRadius: { count, unit: "listings" },
          };
        },
      ),
    // 8,000 rows is a long transaction. The default 5s timeout is for a
    // request, not for an import somebody kicked off and walked away from.
    { timeout: 120_000, maxWait: 10_000 },
  );

  return { ok: true, created, held, duplicates: collided.length, withoutAddress };
}

/* ── Discarding ──────────────────────────────────────────────────────────── */

export type DiscardResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "not_staged"; message: string };

/**
 * A staged run nobody should publish. The records stay, raw rows and all (B5):
 * a discarded file is evidence about a source, and next month's may need
 * comparing with it.
 */
export async function discardRun(
  input: { actor: Actor; runId: string; reason: string },
  now = new Date(),
): Promise<DiscardResult> {
  const run = await prisma.licenceImportRun.findUnique({
    where: { id: input.runId },
    select: { id: true, status: true },
  });
  if (!run) return { ok: false, error: "not_found", message: "That run is not in the importer." };
  if (run.status !== "staged") {
    return {
      ok: false,
      error: "not_staged",
      message:
        run.status === "approved"
          ? "That run has published. Roll it back instead of discarding it."
          : `That run is already ${run.status.replace("_", " ")}.`,
    };
  }

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "queue.decide",
        subject: `LicenceImportRun:${run.id}`,
        reason: input.reason,
        tx,
      },
      async () => {
        // Conditional on the status it was read in, so two people discarding
        // and approving at once cannot both win.
        const { count } = await tx.licenceImportRun.updateMany({
          where: { id: run.id, status: "staged" },
          data: {
            status: "discarded",
            decisionReason: input.reason.trim(),
            decidedAt: now,
            decidedById: input.actor.id,
          },
        });
        if (count !== 1) throw new RunMovedError();
        // A discarded run's duplicates are no longer anybody's question.
        const withdrawn = await withdrawRunPairsTx(tx, run.id, "run_discarded");
        return {
          result: null,
          before: { status: "staged" },
          after: { status: "discarded", pairsWithdrawn: withdrawn },
          // B4: the open pairs the discard withdrew, counted by the updateMany in
          // `withdrawRunPairsTx`. None withdrawn means it touched only the run.
          blastRadius: withdrawn > 0 ? { count: withdrawn, unit: "pairs" } : null,
        };
      },
    ),
  );

  return { ok: true };
}

/** A run changed state between being read and being written. */
export class RunMovedError extends Error {
  constructor() {
    super("The run changed while this decision was being made.");
    this.name = "RunMovedError";
  }
}

/* ── Rolling back ────────────────────────────────────────────────────────── */

async function rollbackPlan(
  runId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<RollbackManifest> {
  const businesses = await db.business.findMany({
    where: { licenceImportRunId: runId },
    select: {
      id: true,
      claimStatus: true,
      publishedAt: true,
      mergedIntoId: true,
      subscription: { select: { id: true } },
      _count: { select: { claimSubmissions: true, team: true, absorbed: true } },
    },
  });

  const plan: RollbackManifest = { withdrawn: [], kept: [] };
  for (const business of businesses) {
    const why: KeptBecause | null =
      business.claimStatus !== "unclaimed"
        ? "claimed"
        : business._count.claimSubmissions > 0
          ? "claim_in_progress"
          : business.subscription
            ? "subscribed"
            : business._count.team > 0
              ? "team"
              : business.mergedIntoId !== null || business._count.absorbed > 0
                ? "merged"
                : null;
    if (why) plan.kept.push({ id: business.id, why });
    // Already unpublished is already off the directory; the manifest records
    // what this rollback took down, not what was down before it.
    else if (business.publishedAt !== null) plan.withdrawn.push(business.id);
  }
  return plan;
}

export interface RollbackPreview {
  withdraw: number;
  kept: number;
  keptBecause: Record<KeptBecause, number>;
  /**
   * Board 12b B5: merges made from this run's records that the rollback puts
   * back first, by the listing they went into.
   */
  unwind: string[];
  /** Branches owners confirmed, which refuse the rollback by name. */
  confirmed: string[];
}

/** What a rollback would do, now, for the confirm dialog. Writes nothing. */
export async function rollbackPreview(runId: string): Promise<RollbackPreview> {
  const [plan, merges] = await Promise.all([rollbackPlan(runId), runMergePlan(runId)]);
  const keptBecause = Object.fromEntries(KEPT_BECAUSE.map((why) => [why, 0])) as Record<
    KeptBecause,
    number
  >;
  /*
     A listing kept only because it is part of a merge the rollback will put
     back is not kept: once the merge unwinds it is an unclaimed listing from
     this run like any other. Counted as withdrawn here so the dialog's figure
     is what the rollback will actually do.
  */
  const unwinding = merges.unwind.length + merges.looseMerges.length > 0;
  let withdraw = plan.withdrawn.length;
  for (const item of plan.kept) {
    if (item.why === "merged" && unwinding) withdraw += 1;
    else keptBecause[item.why] += 1;
  }
  return {
    withdraw,
    kept: plan.kept.length - (withdraw - plan.withdrawn.length),
    keptBecause,
    unwind: merges.unwind.map((entry) => entry.parentName),
    confirmed: merges.confirmed.map((entry) => entry.parentName),
  };
}

export type RollbackResult =
  | { ok: true; withdrawn: number; kept: number; unwound: number }
  | {
      ok: false;
      error: "not_found" | "not_approved" | "window_closed" | "merges_confirmed" | "merges_need_merge_role";
      message: string;
    };

/**
 * Take a run's listings back off the directory, inside the thirty days.
 *
 * **Detaches, never deletes.** A withdrawn listing is unpublished and keeps its
 * row, its slug, its record of where it came from and anything that arrived
 * while it was live — an enquiry a buyer sent it is still that buyer's enquiry.
 * A listing somebody has claimed is not withdrawn at all (`rollbackPlan`).
 *
 * The window is a refusal, not a warning. After thirty days the listings have
 * been the directory for a month, and taking them down is a second disruption
 * rather than a correction.
 */
export async function rollbackRun(
  input: { actor: Actor; runId: string; reason: string },
  now = new Date(),
): Promise<RollbackResult> {
  assertCan(input.actor, "queue.decide");

  const run = await prisma.licenceImportRun.findUnique({
    where: { id: input.runId },
    select: { id: true, status: true, reversibleUntil: true },
  });
  if (!run) return { ok: false, error: "not_found", message: "That run is not in the importer." };
  if (run.status !== "approved" || run.reversibleUntil === null) {
    return {
      ok: false,
      error: "not_approved",
      message:
        run.status === "rolled_back"
          ? "That run was already rolled back."
          : "Only a run that has published listings can be rolled back.",
    };
  }
  if (run.reversibleUntil.getTime() < now.getTime()) {
    return {
      ok: false,
      error: "window_closed",
      message: `A run is reversible for ${REVERSIBLE_DAYS} days. This one closed on ${run.reversibleUntil
        .toISOString()
        .slice(0, 10)}.`,
    };
  }

  /*
     Board 12b B5 — two reversal windows that have to know about each other. A
     merge consumes a record from a run, so rolling the run back on day 20
     would leave a branch from a run that no longer exists inside somebody's
     listing. The merges come out first. A branch its owner confirmed is theirs,
     and the rollback refuses rather than take it, naming the listings.
  */
  const merges = await runMergePlan(run.id);
  if (merges.confirmed.length > 0) {
    const names = merges.confirmed.map((entry) => entry.parentName);
    return {
      ok: false,
      error: "merges_confirmed",
      message: `Records from this run became branches that their owners confirmed: ${names.join(", ")}. Those are the owners' now, so the run cannot be rolled back.`,
    };
  }
  // Putting merges back is the merge role's work. A seat that may roll a run
  // back but not merge is refused rather than allowed to undo merges by proxy.
  if (merges.unwind.length + merges.looseMerges.length > 0 && !can(input.actor, "business.merge")) {
    return {
      ok: false,
      error: "merges_need_merge_role",
      message: `Records from this run were merged into ${merges.unwind.length + merges.looseMerges.length} listings. Rolling it back puts those merges back, which only an ops lead can do.`,
    };
  }

  const result = await prisma.$transaction(
    async (tx) =>
      staffMutation(
        {
          actor: input.actor,
          capability: "queue.decide",
          subject: `LicenceImportRun:${run.id}`,
          reason: input.reason,
          tx,
        },
        async () => {
          const unwound = await unwindRunTx(tx, run.id, { actorId: input.actor.id, reason: input.reason, now });
          // Planned after the merges come out, so a listing that was merged
          // away and is now its own listing again is withdrawn with the rest.
          const plan = await rollbackPlan(run.id, tx);

          const CHUNK = 1_000;
          let withdrawn = 0;
          for (let i = 0; i < plan.withdrawn.length; i += CHUNK) {
            const result = await tx.business.updateMany({
              /*
                 Re-checked in the write. A claim can land between the plan and
                 this statement, and the rule is that a claimed listing is never
                 withdrawn — not that it was unclaimed a moment ago.
              */
              where: {
                id: { in: plan.withdrawn.slice(i, i + CHUNK) },
                claimStatus: "unclaimed",
                claimSubmissions: { none: {} },
                publishedAt: { not: null },
              },
              data: { publishedAt: null },
            });
            withdrawn += result.count;
          }

          // Anything the write declined is still live, and the manifest says so
          // rather than claiming a withdrawal that did not happen.
          if (withdrawn !== plan.withdrawn.length) {
            const stillLive = await tx.business.findMany({
              where: { id: { in: plan.withdrawn }, publishedAt: { not: null } },
              select: { id: true },
            });
            const live = new Set(stillLive.map((row) => row.id));
            plan.withdrawn = plan.withdrawn.filter((id) => !live.has(id));
            plan.kept.push(...[...live].map((id) => ({ id, why: "claim_in_progress" as const })));
          }

          const { count } = await tx.licenceImportRun.updateMany({
            where: { id: run.id, status: "approved" },
            data: {
              status: "rolled_back",
              rolledBackAt: now,
              rolledBackById: input.actor.id,
              rollbackReason: input.reason.trim(),
              rollbackManifest: plan as unknown as Prisma.InputJsonValue,
            },
          });
          // Somebody else rolled it back first. Undo this attempt whole.
          if (count !== 1) throw new RunMovedError();

          return {
            result: { withdrawn: plan.withdrawn.length, kept: plan.kept.length, unwound: unwound.unwound },
            before: { status: "approved", live: plan.withdrawn.length + plan.kept.length },
            after: {
              status: "rolled_back",
              withdrawn: plan.withdrawn.length,
              kept: plan.kept.length,
              mergesUnwound: unwound.unwound,
              pairsWithdrawn: unwound.withdrawn,
            },
            // B4: the listings taken off the directory, summed from the
            // updateMany counts above — not the plan, which a claim can undercut.
            blastRadius: { count: withdrawn, unit: "listings" },
          };
        },
      ),
    { timeout: 120_000, maxWait: 10_000 },
  );

  return { ok: true, ...result };
}

export { runCounts };
