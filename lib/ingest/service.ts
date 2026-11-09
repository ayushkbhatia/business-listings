import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { readIngestText } from "@/lib/storage";
import { t } from "@/lib/i18n";
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
import { candidateBlockCap, loadCandidateListings, readBands, recordAsListing } from "@/lib/dedupe/source";
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

/**
 * Records matched against one candidate read — T4.4.
 *
 * Smaller than the write chunk's five hundred, and for a different reason: the
 * candidate query's cost is in the number of **distinct words** this many
 * records carry, each of which is a trigram lookup. Two hundred records is a
 * few hundred words, which is one indexed read of a sensible size; five hundred
 * was measurably worse for no fewer candidates.
 */
const MATCH_CHUNK = 200;

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
  | {
      ok: true;
      runId: string;
      totals: ReturnType<typeof tally>;
      truncated: number;
      /**
       * Records actually written — T4.2.
       *
       * The same as `totals.rows` on a run that finished, and lower on one
       * that did not: the chunks commit as they go, so the two numbers are
       * genuinely different questions now. The caller reports the shortfall
       * rather than the intention.
       */
      written: number;
    }
  | { ok: false; error: "empty" | "no_trade_name_column" | "no_file"; message: string };

export interface StageInput {
  actor: Actor;
  source: string;
  filename: string;
  /**
   * The file's text, when the caller already has it.
   *
   * The seed and the integration tests do, and they should: putting a fixture
   * through object storage to test the classifier would be testing Supabase.
   * The console does not — see `uploadPath`.
   */
  text?: string;
  /**
   * Where the browser put the file in `ingest-uploads` — task T4.1.
   *
   * The console's path. The file used to travel in the server action's request
   * body, under a 4 MB `bodySizeLimit` against a declared 50,000-row ceiling —
   * and a 40,000-row register export is 6–10 MB, so the importer refused the
   * file the feature was built for. The browser writes to a signed URL and this
   * is the object the server reads.
   *
   * Recorded on the run, because a resumed stage re-reads it and because a
   * rejection has to be arguable from the file it came from.
   */
  uploadPath?: string;
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

/* ── Parse and classify, which is the part that is pure of writes ────────── */

/**
 * Everything `stageRun` works out before it writes anything — T4.2.
 *
 * Lifted out of `stageRun` whole, because the resume needs exactly it: a run
 * that stopped at record 19,500 is continued by reading the same file, working
 * out the same answers, and writing the rows that are not there yet. Two
 * implementations of "what does this file say" is the one thing that could not
 * be allowed, so there is one.
 *
 * It reads the database — categories, the match index, the bands, the areas,
 * the separations — and writes nothing.
 */
interface StagedRow {
  rowNumber: number;
  /** Every column as it arrived (B5). A rejection has to be arguable. */
  raw: Record<string, string>;
  record: LicenceRecord;
  key: string;
  licence: string | null;
  verdict: ReturnType<typeof classify>;
  outcome: ReturnType<typeof stagedOutcome>;
  duplicateOfId: string | null;
  duplicateOfRow: number | null;
  pair: { score: number; band: "certain" | "probable"; signals: unknown } | null;
}

interface Prepared {
  headers: string[];
  truncated: number;
  belowFloor: number;
  staged: StagedRow[];
  totals: ReturnType<typeof tally>;
}

async function prepareStage(
  text: string,
  sourceInput: string,
  now: Date,
): Promise<
  | { ok: true; prepared: Prepared }
  | { ok: false; error: "empty" | "no_trade_name_column"; message: string }
> {
  /*
   * A ceiling of its own. `MAX_ROWS` is 5,000, which is right for a seller's
   * catalogue and wrong for an authority export — criterion 1 names 8,000, and
   * an emirate has rather more companies than that.
   */
  const { headers, rows: body, truncated } = parseCsv(text, MAX_LICENCE_ROWS);
  if (body.length === 0) {
    return { ok: false, error: "empty", message: t("ingest.refuse.empty") };
  }

  const columns = mapColumns(headers);

  if (columns.tradeName === undefined) {
    return {
      ok: false,
      error: "no_trade_name_column",
      message: t("ingest.refuse.no_trade_name_column"),
    };
  }

  const at = (row: string[], key: keyof LicenceRecord): string | undefined => {
    const index = columns[key];
    return index === undefined ? undefined : row[index];
  };

  const source = sourceInput.trim().toUpperCase();

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

  const [categories, mappings, bands, areas, separations, blockCap] = await Promise.all([
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
    readBands(),
    prisma.area.findMany({ select: { id: true, name: true, emirate: true } }),
    /*
       B2: *keep as separate* teaches the matcher. A record a person said is
       not a listing is not paired with that listing again when next month's
       file re-sends it.
    */
    separatedLicences(),
    /*
       T4.5 — how many listings one word may block, for a directory this size.
       Counted **once per run** rather than per chunk: it is one `count` on an
       indexed predicate and the answer cannot meaningfully move while a file is
       being staged.
    */
    candidateBlockCap(),
  ]);

  const categoryBySlug = new Map(categories.map((category) => [category.slug, category.id]));
  const mappedCategory = new Map(mappings.map((m) => [m.activityKey, m.categoryId]));
  const areaById = new Map(areas.map((area) => [area.id, area]));

  // The first row of the file carrying a licence keeps it; a later one repeats it.
  const firstRowFor = new Map<string, number>();
  let belowFloor = 0;
  const staged: StagedRow[] = [];

  /*
     T4.4 — matched a chunk at a time, against the candidates for that chunk.

     This used to call `loadMatchListings()`: every listing in the directory,
     with all of its locations and each location's area, and an in-process
     blocking index over all of it — built here and again at publish. At 41,000
     listings that is tens of megabytes held in a serverless function and
     150,000 keys indexed to answer questions about a few hundred records, with
     a cost that grows with the directory rather than with the file.

     `loadCandidateListings` asks the database the same question the blocking
     index answered — which listings share a licence, a phone or an identifying
     word with these records — over three indexed reads. The matcher is
     untouched: the index is still built with `buildMatchIndex` and the pair is
     still found by `bestMatch`, from a smaller set.
  */
  for (let i = 0; i < records.length; i += MATCH_CHUNK) {
    const slice = records.slice(i, i + MATCH_CHUNK);

    /*
       Each record in the matcher's shape, built once: the candidate query reads
       their blocking keys and `bestMatch` then compares against them. A record
       the classifier rejected outright is left out — it will never be paired,
       so its words should not widen the query either.
    */
    const asListing = new Map(
      slice
        .filter((row) => row.verdict.disposition !== "rejected")
        .map((row) => {
          const emirate = normaliseEmirate(row.record.emirate);
          const areaId = resolveEnquiryArea(row.record.areaName, emirate, areas);
          const authority = effectiveAuthority(row.record.licenceAuthority, source, KNOWN_AUTHORITIES);
          return [
            row.rowNumber,
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
          ] as const;
        }),
    );

    /*
       The cap travels with the candidates — T4.5.

       `loadCandidateListings` has already dropped the words that identify
       nobody *in the directory*, so the index must not apply a second, tighter
       cap to the two hundred rows it brought back: a word shared by three of
       three hundred candidates is the signal, not the noise.
    */
    const index = buildMatchIndex(
      await loadCandidateListings([...asListing.values()], prisma, blockCap),
      blockCap,
    );

    for (const row of slice) {
      let duplicateOfId: string | null = null;
      let duplicateOfRow: number | null = null;
      let pair: { score: number; band: "certain" | "probable"; signals: unknown } | null = null;

      const self = asListing.get(row.rowNumber);
      if (self) {
        const earlier = row.licence ? firstRowFor.get(row.licence) : undefined;
        if (row.licence && earlier !== undefined) {
          // An exact repeat inside one file is the file repeating itself, not a
          // company to argue about. It does not reach the dedupe queue.
          duplicateOfRow = earlier;
        } else {
          if (row.licence) firstRowFor.set(row.licence, row.rowNumber);
          const result = bestMatch(
            self,
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

      staged.push({ ...row, outcome, duplicateOfId, duplicateOfRow, pair });
    }
  }
  const totals = tally(staged.map((row) => row.outcome));
  return { ok: true, prepared: { headers, truncated, belowFloor, staged, totals } };
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
     The bytes, from wherever this caller has them — T4.1.

     Read *after* the capability check and before anything else, so a request
     with no file costs one storage round trip rather than a parse. A path that
     storage no longer holds is a sentence rather than a throw: the object can
     be gone because somebody staged, failed, and came back an hour later, and
     "upload the file again" is the whole of what they need to know.
  */
  const text = input.uploadPath ? await readIngestText(input.uploadPath) : (input.text ?? null);
  if (text === null) {
    return {
      ok: false,
      error: "no_file",
      message: input.uploadPath
        ? t("ingest.refuse.upload_gone")
        : t("ingest.refuse.no_file"),
    };
  }

  const source = input.source.trim().toUpperCase();
  const prep = await prepareStage(text, source, now);
  if (!prep.ok) return prep;
  const { headers, truncated, belowFloor, staged, totals } = prep.prepared;

  const runId = newRunId();

  /*
     Three phases, and the transaction boundaries are the task — T4.2.

     This used to be **one** interactive transaction: the audit row, the run,
     every staged record and the status change, with `timeout: 120_000`, on a
     pooled connection the app opens with `connection_limit=1`. At 41,000
     records that is one transaction holding the only connection for minutes,
     with no `maxDuration` declared anywhere on the path — so the platform kills
     the function, Postgres rolls the whole thing back, and forty thousand
     records of work is gone with nothing to show that it was ever attempted.

     Now:

       1 · the run and its audit row, in one short transaction;
       2 · the records, five hundred at a time, each chunk its own transaction;
       3 · `staged`, once every record is in.

     **The invariant the one big transaction was protecting still holds.** The
     old comment put it as "whole or not at all", because a run of 5,999 that
     reads as the file is worse than no run. What actually must not happen is a
     run *reading as complete* while partial — and that is phase 3's job, not
     the transaction's. A run interrupted between chunks stays `parsing`, which
     every screen already renders, nothing publishes from, and
     `resumeStageRun` continues.
  */
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
              uploadPath: input.uploadPath ?? null,
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
              belowFloor,
              rejected: totals.rejected,
              truncated,
            },
            /*
               B4: what this decision is about, which is the whole file.

               Counted from the classified records rather than from the rows
               `createManyAndReturn` gave back, because the rows are no longer
               written in this transaction. It is the same number unless a chunk
               fails, and a run that stopped half way is a run whose audit row
               should still say what was being attempted.
            */
            blastRadius: { count: staged.length, unit: "records" },
          };
        },
      ),
    // Short, because all it writes is two rows. The 120 seconds this used to
    // ask for was the chunk loop's, and the chunk loop has left.
    { timeout: 20_000, maxWait: 10_000 },
  );

  const written = await writeStagedChunks(runId, staged, 0);
  await finishStaging(runId);

  return { ok: true, runId, totals, truncated, written };
}

/** Five hundred records per transaction. See `writeStagedChunks`. */
const STAGE_CHUNK = 500;

/**
 * Write the records from `from` onwards, a chunk per transaction — T4.2.
 *
 * `createMany` with 41,000 rows in one statement is a parameter count Postgres
 * refuses, so the loop was always chunked; what has changed is that each chunk
 * **commits**. A run interrupted at chunk 40 has 20,000 records durably staged
 * and a cursor that says so.
 *
 * ## The cursor is the data
 *
 * There is no `staged_through` column, deliberately. `staged_listing` has a
 * unique key on `(run_id, row_number)`, so the rows themselves say exactly how
 * far this run got — `max(row_number)` — and a number stored beside them is a
 * second source of that truth that can disagree with it. `skipDuplicates` makes
 * a chunk that is re-run a no-op rather than a constraint violation, so a
 * resume that overlaps by one chunk is correct rather than fatal.
 *
 * That is why this takes an index: the resume works out where to start by
 * asking the table, and passes it.
 */
async function writeStagedChunks(
  runId: string,
  staged: readonly StagedRow[],
  from: number,
): Promise<number> {
  let written = 0;

  for (let i = from; i < staged.length; i += STAGE_CHUNK) {
    const slice = staged.slice(i, i + STAGE_CHUNK);
    await prisma.$transaction(
      async (tx) => {
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
          skipDuplicates: true,
          select: { id: true, rowNumber: true },
        });
        written += created.length;

        /*
           The pair each duplicate goes to board 12b as, in the **same**
           transaction as the record: a record marked duplicate with no pair is
           a record no screen can ever resolve, and that invariant is per
           record rather than per file — which is exactly why chunking the
           transaction is safe here.
        */
        const idByRow = new Map(created.map((row) => [row.rowNumber, row.id]));
        const candidates = slice
          .filter((row) => row.pair && row.duplicateOfId && idByRow.has(row.rowNumber))
          .map((row) => ({
            keepId: row.duplicateOfId!,
            stagedListingId: idByRow.get(row.rowNumber)!,
            sourceRunId: runId,
            score: row.pair!.score,
            band: row.pair!.band,
            signals: row.pair!.signals as Prisma.InputJsonValue,
          }));
        if (candidates.length > 0) {
          await tx.mergeCandidate.createMany({ data: candidates, skipDuplicates: true });
        }
      },
      // One chunk is two statements over five hundred rows. Seconds, not
      // minutes — and a timeout that cannot outlive the route's `maxDuration`.
      { timeout: 30_000, maxWait: 10_000 },
    );
  }

  return written;
}

/**
 * `staged`, and the counts, once every record is in — T4.2 phase 3.
 *
 * The status change is the thing that makes a run read as the file, so it is
 * the last write and it is its own statement. `runCounts` recounts from the
 * rows rather than trusting the tally, which is also what makes a resumed run's
 * figures right: the tally describes the file and the rows describe what was
 * stored.
 */
async function finishStaging(runId: string): Promise<void> {
  const counts = await runCounts(prisma, runId);
  await prisma.licenceImportRun.update({
    where: { id: runId },
    data: { ...counts, status: "staged" },
  });
}

/* ── Resuming a run that stopped between chunks ──────────────────────────── */

export type ResumeResult =
  | { ok: true; written: number; remaining: number }
  | {
      ok: false;
      error: "not_found" | "not_parsing" | "no_file" | "empty" | "no_trade_name_column";
      message: string;
    };

/**
 * Continue a run left `parsing` — T4.2.
 *
 * The staging loop commits a chunk at a time, so an interrupted run is 20,000
 * records that are really there and 21,000 that are not. This reads the same
 * file out of `ingest-uploads`, works out the same answers, and writes the rows
 * that are missing.
 *
 * ## Four things make it safe to run twice
 *
 * 1. **The file.** T4.1 keeps the object, so the bytes are the same bytes.
 * 2. **The clock.** It classifies against the run's own `createdAt`, not
 *    against now. `classify` reads the expiry date against a date, so a resume
 *    an hour later would otherwise hold back a licence that expired in between
 *    and the run would answer two different things about one file.
 * 3. **The cursor.** `max(row_number)` for the run, from the rows themselves.
 * 4. **The unique key.** `(run_id, row_number)` plus `skipDuplicates`, so an
 *    overlap is a no-op rather than a constraint violation.
 *
 * ## Audited as its own decision
 *
 * It takes a reason, and writes a row. An ops lead continuing somebody else's
 * interrupted run hours later is exactly the question the log exists to answer,
 * and the uploader's reason cannot be made to stand in for a decision they were
 * not there for.
 *
 * What it does **not** re-decide: a record already written keeps the verdict it
 * was written with. The live match index may have moved since — another run may
 * have published a company this file also carries — and the rows that have not
 * been written yet are matched against the index as it is now. That is the same
 * re-match `publishRun` does at its own moment, and it is why the pairs go to a
 * person rather than straight into the directory.
 */
export async function resumeStageRun(input: {
  actor: Actor;
  runId: string;
  reason: string;
}): Promise<ResumeResult> {
  assertCan(input.actor, "queue.decide");

  const run = await prisma.licenceImportRun.findUnique({
    where: { id: input.runId },
    select: { id: true, status: true, source: true, uploadPath: true, createdAt: true, rowCount: true },
  });
  if (!run) return { ok: false, error: "not_found", message: t("ingest.refuse.run_not_found") };
  if (run.status !== "parsing") {
    return {
      ok: false,
      error: "not_parsing",
      message: t("ingest.refuse.not_parsing", { status: run.status }),
    };
  }
  if (!run.uploadPath) {
    return {
      ok: false,
      error: "no_file",
      message: t("ingest.refuse.staged_from_text"),
    };
  }

  const text = await readIngestText(run.uploadPath);
  if (text === null) {
    return {
      ok: false,
      error: "no_file",
      message: t("ingest.refuse.upload_gone_resume"),
    };
  }

  // The run's own clock, not this moment. See point 2 above.
  const prep = await prepareStage(text, run.source, run.createdAt);
  if (!prep.ok) return prep;
  const { staged } = prep.prepared;

  /*
     Where it got to, asked of the rows. `_max` over an indexed column on one
     run's rows, which is a single index read however large the run is.
  */
  const cursor = await prisma.stagedListing.aggregate({
    where: { runId: run.id },
    _max: { rowNumber: true },
  });
  const through = cursor._max.rowNumber ?? 0;
  const from = staged.findIndex((row) => row.rowNumber > through);

  let written = 0;
  if (from !== -1) {
    written = await writeStagedChunks(run.id, staged, from);
  }

  await prisma.$transaction(
    async (tx) =>
      staffMutation(
        {
          actor: input.actor,
          capability: "queue.decide",
          subject: `LicenceImportRun:${run.id}`,
          reason: input.reason,
          tx,
        },
        async () => ({
          result: written,
          before: { status: "parsing", stagedThrough: through },
          after: { status: "staged", stagedThrough: staged.at(-1)?.rowNumber ?? through },
          blastRadius: { count: written, unit: "records" },
        }),
      ),
    { timeout: 20_000, maxWait: 10_000 },
  );

  await finishStaging(run.id);

  return { ok: true, written, remaining: 0 };
}

/* ── Publishing ──────────────────────────────────────────────────────────── */

export type PublishResult =
  | { ok: true; created: number; held: number; duplicates: number; withoutAddress: number }
  | {
      ok: false;
      error: "not_found" | "not_open" | "nothing_ready";
      message: string;
    };

/**
 * A free slug for each base, resolved against the index rather than the table —
 * T4.3.
 *
 * ## What it replaced
 *
 * `findMany({ select: { slug: true } })` — every slug in the directory, read
 * into a Set on every publish, to answer a question about at most six thousand
 * of them. A sequential scan whose cost grows with the directory instead of
 * with the run.
 *
 * ## What it does
 *
 * One indexed read for the bases this run actually wants (`slug IN (…)`, at most
 * a few thousand keys), and a second read **only for the bases that turn out to
 * be taken** (`slug LIKE 'base-%'`), to find the lowest free suffix. A run whose
 * trade names are all new — the common case for a register export — costs one
 * query.
 *
 * ## And the constraint is still the authority
 *
 * Two rows of one file can want the same slug, so the batch resolves against
 * itself as well. But nothing here holds a lock: another publish, or a seller
 * claiming a listing, can take a slug between this read and the insert. That
 * race is not closed by reading more — it is closed by `business.slug` being
 * `@unique`, and by `insertBusinessChunk` retrying the rows Postgres refuses.
 * This function's job is to make the refusal rare, not to make it impossible.
 */
async function claimSlugs(bases: readonly string[]): Promise<string[]> {
  const wanted = [...new Set(bases)];
  const exact =
    wanted.length === 0
      ? []
      : await prisma.business.findMany({
          where: { slug: { in: wanted } },
          select: { slug: true },
        });
  const taken = new Set(exact.map((row) => row.slug));
  // Suffixed siblings, read lazily: one query per base that is actually taken.
  const families = new Map<string, Set<string>>();

  const out: string[] = [];
  for (const base of bases) {
    if (!taken.has(base)) {
      taken.add(base);
      out.push(base);
      continue;
    }
    let family = families.get(base);
    if (!family) {
      const rows = await prisma.business.findMany({
        where: { slug: { startsWith: `${base}-` } },
        select: { slug: true },
      });
      family = new Set(rows.map((row) => row.slug));
      families.set(base, family);
    }
    let n = 2;
    while (taken.has(`${base}-${String(n)}`) || family.has(`${base}-${String(n)}`)) n += 1;
    const slug = `${base}-${String(n)}`;
    taken.add(slug);
    family.add(slug);
    out.push(slug);
  }
  return out;
}

/** The suffix a row gets when Postgres refuses the slug this run chose. */
function reslug(slug: string): string {
  return `${slug}-${randomBytes(3).toString("hex")}`;
}

/**
 * One chunk of listings, with the slug collisions Postgres finds — T4.3.
 *
 * The happy path is one statement for five hundred rows, which is what it was
 * before. What is new is the refusal: `business.slug` is `@unique`, so a slug
 * another writer took between `claimSlugs` and here comes back as `P2002`, and
 * one `createMany` is all-or-nothing.
 *
 * On that refusal the chunk is retried **row by row**, each row keeping the slug
 * it was given and the refused ones taking a random suffix — `safeName`'s
 * answer to the same problem one layer down. Five hundred round trips, for a
 * chunk that actually collided, which is the trade the task asks for: the cost
 * lands on the rare case instead of on every publish.
 *
 * It returns the rows it created, in the shape `createManyAndReturn` does, so
 * the caller's `idBySlug` map is built the same way either route was taken.
 *
 * ## Why the retry is not a loop
 *
 * A random three-byte suffix on a slug that was already free a moment ago does
 * not collide twice in any realistic world, and a `while (true)` around an
 * insert is how a function that should have failed loudly becomes one that
 * spends its whole `maxDuration` instead. A second refusal on the same row
 * throws, with the slug in the message.
 */
async function insertBusinessChunk(
  tx: Prisma.TransactionClient,
  slice: readonly { business: { slug: string } & Record<string, unknown> }[],
): Promise<{ id: string; slug: string }[]> {
  try {
    return await tx.business.createManyAndReturn({
      data: slice.map((item) => item.business as never),
      select: { id: true, slug: true },
    });
  } catch (error) {
    if (!isSlugCollision(error)) throw error;

    const rows: { id: string; slug: string }[] = [];
    for (const item of slice) {
      try {
        rows.push(
          await tx.business.create({ data: item.business as never, select: { id: true, slug: true } }),
        );
      } catch (first) {
        if (!isSlugCollision(first)) throw first;
        /*
           Renamed, and the **caller's** map is keyed by the slug that was
           actually written — which is why this returns the row rather than the
           slug it asked for. A location pointing at a business by a slug the
           database refused is the defect this would otherwise introduce.
        */
        rows.push(
          await tx.business.create({
            data: { ...item.business, slug: reslug(item.business.slug) } as never,
            select: { id: true, slug: true },
          }),
        );
      }
    }
    return rows;
  }
}

/** A unique violation naming the slug, and nothing else. */
function isSlugCollision(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const target = (error.meta as { target?: unknown } | undefined)?.target;
  const fields = Array.isArray(target) ? target.map(String) : [String(target ?? "")];
  return fields.some((field) => field.includes("slug"));
}

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
  if (!run) return { ok: false, error: "not_found", message: t("ingest.refuse.run_not_found") };
  if (run.status !== "staged" && run.status !== "approved") {
    return {
      ok: false,
      error: "not_open",
      message:
        run.status === "rolled_back"
          ? t("ingest.refuse.rolled_back_publish")
          : t("ingest.refuse.not_open", { status: run.status }),
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
  const [bands, areas, separations, blockCap] = await Promise.all([
    readBands(),
    prisma.area.findMany({ select: { id: true, name: true, emirate: true } }),
    candidates.length > 0 ? separatedLicences() : Promise.resolve(new Map<string, Set<string>>()),
    candidateBlockCap(),
  ]);
  const areaName = new Map(areas.map((area) => [area.id, area.name]));

  const collided: { id: string; businessId: string; score: number; band: string; signals: unknown }[] = [];
  const ready: typeof candidates = [];

  /*
     T4.4 — a chunk at a time here too, against that chunk's candidates.

     `loadMatchListings()` read the whole directory into memory for the second
     time in one run, after staging had already done it once. Same three indexed
     reads as the staging side, and the same untouched matcher over what comes
     back.
  */
  for (let i = 0; i < candidates.length; i += MATCH_CHUNK) {
    const slice = candidates.slice(i, i + MATCH_CHUNK);
    const asListing = new Map(
      slice.map((row) => {
        const authority = effectiveAuthority(row.licenceAuthority, run.source, KNOWN_AUTHORITIES).code!;
        const areaId = resolveEnquiryArea(row.areaName, row.emirate, areas);
        return [
          row.id,
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
        ] as const;
      }),
    );
    const index = buildMatchIndex(
      await loadCandidateListings([...asListing.values()], prisma, blockCap),
      blockCap,
    );

    for (const row of slice) {
      const { match } = bestMatch(
        asListing.get(row.id)!,
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
        continue;
      }
      ready.push(row);
    }
  }

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
      message: held > 0 ? t("ingest.refuse.all_waiting") : t("ingest.refuse.nothing_left"),
    };
  }

  const categoryIds = [...new Set(ready.map((row) => row.categoryId!))];
  const categories = await prisma.category.findMany({
    where: { id: { in: categoryIds } },
    select: { id: true, name: true, synonyms: true },
  });
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  /*
     T4.3 — the slugs this run wants, asked for by name.

     This used to be `prisma.business.findMany({ select: { slug: true } })`:
     **every slug in the directory**, into one Set, on every publish. At 41,000
     listings that is a sequential scan and 41,000 strings in the function's
     memory before a single listing is written, and it grows with the directory
     rather than with the run — the one shape that is certain to be fine in
     testing and wrong in production.
  */
  const slugFor = await claimSlugs(
    ready.map((row) => slugify(row.tradeName ?? "") || `listing-${row.id.slice(-8)}`),
  );

  const prepared = ready.map((row, index) => {
    const authority = effectiveAuthority(row.licenceAuthority, run.source, KNOWN_AUTHORITIES)
      .code as $Enums.Authority;
    const slug = slugFor[index]!;

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

  /*
     Three phases again — T4.2, and the same reason as staging.

     This was one interactive transaction with `timeout: 120_000` holding the
     app's single pooled connection while it created six thousand businesses,
     six thousand locations and six thousand staged-row updates. A platform
     timeout anywhere in it rolled back the whole publish, and an ops lead who
     had pressed Approve was left with a run that said `staged` and no
     explanation.

       1 · the decision: the audit row and the status change.
       2 · the listings, five hundred at a time, each chunk its own transaction.
       3 · the duplicates found at publish, and the recounted figures.

     **The cursor is the data here too, and more cleanly than in staging.** A
     staged row that has published carries `disposition = 'published'`, and the
     query that chooses what to publish asks for `ready` and `needs_category` —
     so a publish that stopped at chunk 9 has nothing to skip on the next
     attempt, because the rows it wrote have left the set. `publishRun` was
     already callable twice on an `approved` run, for the records the
     categorisation queue clears afterwards (B3); an interrupted publish is the
     same shape and resumes through the same control.
  */
  await prisma.$transaction(
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
          if (firstDecision) {
            await tx.licenceImportRun.update({
              where: { id: run.id },
              data: {
                status: "approved",
                decisionReason: input.reason.trim(),
                decidedAt: now,
                decidedById: input.actor.id,
              },
            });
          }
          return {
            result: ready.length,
            before: { status: run.status },
            after: {
              status: "approved",
              /*
                 What this decision is about, not what the loop managed. The
                 listings are written after this commits, so a number counted
                 from them would either be zero or would need the audit row to
                 be rewritten afterwards — and an audit row that gets rewritten
                 is not a log.
              */
              willPublish: ready.length,
              heldBack: held,
              newDuplicates: collided.length,
              withoutAddress,
            },
            blastRadius: { count: ready.length, unit: "listings" },
          };
        },
      ),
    { timeout: 20_000, maxWait: 10_000 },
  );

  /*
   * Three statements per five hundred listings, not three per listing. The
   * first version created each business, then updated its staged row, one
   * round trip at a time — 12,000 of them for a 6,000-listing run, inside one
   * transaction, against a pooled database.
   */
  const CHUNK = 500;
  let created = 0;

  for (let i = 0; i < prepared.length; i += CHUNK) {
    const slice = prepared.slice(i, i + CHUNK);
    created += await prisma.$transaction(
      async (tx) => {
        /*
           T4.3 — the constraint decides, and a refused row is renamed rather
           than losing the chunk.

           `claimSlugs` read the index a moment ago, which makes a collision
           rare; it does not make it impossible, because nothing holds a lock
           over a slug between that read and this insert. One `createMany` is
           all-or-nothing, so a single colliding row used to be the whole
           chunk's problem — and under the old whole-table read it was the whole
           *publish's* problem, since the Set was built once.
        */
        const rows = await insertBusinessChunk(tx, slice);
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

        /*
           The staged row is marked published in the **same** transaction as the
           listing it points at. That pairing is the one that must not break: a
           business whose staged row still says `ready` would be published a
           second time by the next attempt, and `business_id` on a row not
           marked `published` is refused by a CHECK.
        */
        const pairs = slice.map((item) => Prisma.sql`(${item.row.id}, ${idBySlug.get(item.slug)!})`);
        await tx.$executeRaw`
          UPDATE "staged_listing" AS s
             SET "disposition" = 'published'::"staged_disposition",
                 "business_id" = v.business_id
            FROM (VALUES ${Prisma.join(pairs)}) AS v(id, business_id)
           WHERE s."id" = v.id`;

        return rows.length;
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
  }

  if (collided.length > 0) {
    await prisma.$transaction(
      async (tx) => {
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
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
  }

  /*
     The figures, recounted from the rows — phase 3.

     `runCounts` reads the staged rows rather than adding up what the loop
     thought it did, which is what makes an interrupted publish's figures
     honest: the cards say how many listings exist, not how many were intended.
  */
  const counts = await runCounts(prisma, run.id);
  await prisma.licenceImportRun.update({
    where: { id: run.id },
    data: {
      ...counts,
      // The window opens on the first listing, not on the decision: a run
      // approved with nothing new has nothing to take back.
      ...(run.reversibleUntil === null && created > 0
        ? { reversibleUntil: new Date(now.getTime() + REVERSIBLE_DAYS * DAY_MS) }
        : {}),
    },
  });

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
  if (!run) return { ok: false, error: "not_found", message: t("ingest.refuse.run_not_found") };
  if (run.status !== "staged") {
    return {
      ok: false,
      error: "not_staged",
      message:
        run.status === "approved"
          ? t("ingest.refuse.discard_published")
          : t("ingest.refuse.already", { status: run.status.replace("_", " ") }),
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
  if (!run) return { ok: false, error: "not_found", message: t("ingest.refuse.run_not_found") };
  if (run.status !== "approved" || run.reversibleUntil === null) {
    return {
      ok: false,
      error: "not_approved",
      message:
        run.status === "rolled_back"
          ? t("ingest.refuse.already_rolled_back")
          : t("ingest.refuse.never_published"),
    };
  }
  if (run.reversibleUntil.getTime() < now.getTime()) {
    return {
      ok: false,
      error: "window_closed",
      message: t("ingest.refuse.window_closed", {
        days: REVERSIBLE_DAYS,
        date: run.reversibleUntil.toISOString().slice(0, 10),
      }),
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
      message: t("ingest.refuse.merges_confirmed", { names: names.join(", ") }),
    };
  }
  // Putting merges back is the merge role's work. A seat that may roll a run
  // back but not merge is refused rather than allowed to undo merges by proxy.
  if (merges.unwind.length + merges.looseMerges.length > 0 && !can(input.actor, "business.merge")) {
    return {
      ok: false,
      error: "merges_need_merge_role",
      message: t("ingest.refuse.merges_need_merge_role", {
        count: merges.unwind.length + merges.looseMerges.length,
      }),
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
