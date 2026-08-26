import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import type { Actor } from "@/lib/auth/roles";
import { parseCsv } from "@/lib/import/csv";
import { classify, normaliseEmirate, tally, type LicenceRecord } from "./classify";
import { $Enums } from "@/lib/db/generated/client";

/**
 * `Business.licenceAuthority` is an enum and a staged authority is free text.
 *
 * An export from an authority we have not seen is a real thing — a new free
 * zone opens and its code is not in our enum — and it must not stop the import.
 * An unrecognised code stages fine and only blocks the row from becoming a
 * listing, where the enum would refuse it anyway.
 */
const AUTHORITIES = new Set(Object.values($Enums.Authority) as string[]);

function toAuthority(value: string | null): $Enums.Authority | null {
  if (!value) return null;
  const key = value.trim().toUpperCase();
  return AUTHORITIES.has(key) ? (key as $Enums.Authority) : null;
}

/**
 * Board 12a — the licence-record importer.
 *
 * Criterion 1: *"an import run of 8,000 records stages without publishing,
 * categorises what it can, queues what it cannot, and lists rejections by
 * countable reason."*
 *
 * The order of those clauses is the design. **Nothing publishes itself** — a
 * run parses and stages, and a person approves. That is the second of the three
 * rules the README says make this console trustworthy, and it is enforced twice
 * over: `stageRun` has no path that writes a `Business`, and `StagedListing`
 * has a CHECK refusing a `business_id` on any row not marked `published`.
 *
 * `parseCsv` is reused from handoff 3's catalogue importer. The parsing of a
 * quoted CSV is the same problem whoever is importing, and it is already
 * tested against the shapes a spreadsheet produces.
 */

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
  if (iso) return new Date(Date.UTC(+iso[1]!, +iso[2]! - 1, +iso[3]!));

  const dayFirst = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  if (dayFirst) return new Date(Date.UTC(+dayFirst[3]!, +dayFirst[2]! - 1, +dayFirst[1]!));

  return null;
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
}

/**
 * Parse, classify, stage. Publishes nothing.
 *
 * Not wrapped in `staffMutation`: staging changes no platform state a buyer or
 * a seller can see, and the audited event is the *approval*. Writing an audit
 * row here would put "somebody uploaded a file" in the same log as "somebody
 * decided who owns a listing", which makes the log harder to read rather than
 * more complete.
 */
export async function stageRun(input: StageInput, now = new Date()): Promise<StageResult> {
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

  const categories = await prisma.category.findMany({ select: { id: true, slug: true } });
  const categoryBySlug = new Map(categories.map((category) => [category.slug, category.id]));

  const staged = body.map((row, index) => {
    const record: LicenceRecord = {
      tradeName: at(row, "tradeName")?.trim() ?? null,
      licenceNumber: at(row, "licenceNumber")?.trim() ?? null,
      licenceAuthority: at(row, "licenceAuthority")?.trim() ?? null,
      licenceExpiry: parseLicenceDate(at(row, "licenceExpiry")),
      emirate: at(row, "emirate")?.trim() ?? null,
      areaName: at(row, "areaName")?.trim() ?? null,
      activity: at(row, "activity")?.trim() ?? null,
      phone: at(row, "phone")?.trim() ?? null,
    };

    const verdict = classify(record, now);

    return {
      rowNumber: index + 1,
      // Everything as it arrived. A rejection has to be arguable, and it is not
      // if we threw away what we were arguing about.
      raw: Object.fromEntries(headers.map((header, i) => [header, row[i] ?? ""])),
      tradeName: record.tradeName,
      licenceNumber: record.licenceNumber,
      licenceAuthority: record.licenceAuthority,
      licenceExpiry: record.licenceExpiry,
      emirate: normaliseEmirate(record.emirate),
      areaName: record.areaName,
      activity: record.activity,
      phone: record.phone,
      categoryId: verdict.categorySlug ? (categoryBySlug.get(verdict.categorySlug) ?? null) : null,
      disposition: verdict.disposition,
      rejectionGround: verdict.ground,
      verdict,
    };
  });

  const totals = tally(staged.map((row) => row.verdict));

  const run = await prisma.licenceImportRun.create({
    data: {
      actorId: input.actor.id,
      source: input.source,
      filename: input.filename,
      status: "staged",
      rowCount: totals.rows,
      stagedCount: totals.staged,
      categorisedCount: totals.categorised,
      queuedCount: totals.queued,
      rejectedCount: totals.rejected,
    },
    select: { id: true },
  });

  /*
   * Chunked. `createMany` with 8,000 rows in one statement is a parameter count
   * Postgres refuses, and finding that out at 8,000 rather than at 40 is the
   * whole reason criterion 1 names a real number.
   */
  const CHUNK = 500;
  for (let i = 0; i < staged.length; i += CHUNK) {
    await prisma.stagedListing.createMany({
      data: staged.slice(i, i + CHUNK).map((row) => ({
        runId: run.id,
        rowNumber: row.rowNumber,
        raw: row.raw,
        tradeName: row.tradeName,
        licenceNumber: row.licenceNumber,
        licenceAuthority: row.licenceAuthority,
        licenceExpiry: row.licenceExpiry,
        emirate: row.emirate,
        areaName: row.areaName,
        activity: row.activity,
        phone: row.phone,
        categoryId: row.categoryId,
        disposition: row.disposition,
        rejectionGround: row.rejectionGround,
      })),
    });
  }

  return { ok: true, runId: run.id, totals, truncated };
}

/** What the run screen shows: counts, and rejections by countable ground. */
export async function runSummary(runId: string) {
  const run = await prisma.licenceImportRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      source: true,
      filename: true,
      status: true,
      rowCount: true,
      stagedCount: true,
      categorisedCount: true,
      queuedCount: true,
      rejectedCount: true,
      decisionReason: true,
      decidedAt: true,
      createdAt: true,
      actor: { select: { fullName: true } },
    },
  });
  if (!run) return null;

  const grounds = await prisma.stagedListing.groupBy({
    by: ["rejectionGround"],
    where: { runId, disposition: "rejected" },
    _count: true,
  });

  return {
    ...run,
    byGround: grounds
      .filter((row) => row.rejectionGround !== null)
      .map((row) => ({ ground: row.rejectionGround!, count: row._count }))
      .sort((a, b) => b.count - a.count),
  };
}

export async function recentRuns(limit = 20) {
  return prisma.licenceImportRun.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      source: true,
      filename: true,
      status: true,
      rowCount: true,
      stagedCount: true,
      rejectedCount: true,
      createdAt: true,
    },
  });
}

export type ApproveResult =
  | { ok: true; created: number }
  | { ok: false; error: "not_found" | "not_staged" | "nothing_ready"; message: string };

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Approve a run: the staged rows that are ready become listings.
 *
 * The audited event, because this is the one that changes what a buyer sees.
 * Rows still queued for a category are **not** published — they stay staged
 * until somebody categorises them, which is what "queues what it cannot" means.
 *
 * A listing created here is unpublished and tier 0. Nothing has been checked
 * about it; it has a licence number and an address and that is all, and the
 * claim funnel is what turns it into a supplier.
 */
export async function approveRun(
  input: { actor: Actor; runId: string; reason: string },
  now = new Date(),
): Promise<ApproveResult> {
  const run = await prisma.licenceImportRun.findUnique({
    where: { id: input.runId },
    select: { id: true, status: true },
  });
  if (!run) return { ok: false, error: "not_found", message: "That run is not in the importer." };
  if (run.status !== "staged") {
    return {
      ok: false,
      error: "not_staged",
      message: `That run is already ${run.status}.`,
    };
  }

  const ready = await prisma.stagedListing.findMany({
    where: { runId: run.id, disposition: "ready", categoryId: { not: null } },
    select: {
      id: true,
      tradeName: true,
      licenceNumber: true,
      licenceAuthority: true,
      licenceExpiry: true,
      categoryId: true,
    },
  });
  if (ready.length === 0) {
    return {
      ok: false,
      error: "nothing_ready",
      message: "Nothing in this run is categorised yet. Categorise the queue first.",
    };
  }

  // Slugs must be free on arrival, and two rows of one export can want the same
  // one. Resolved against the database and against each other.
  const taken = new Set(
    (await prisma.business.findMany({ select: { slug: true } })).map((b) => b.slug),
  );

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
          let count = 0;

          for (const row of ready) {
            const authority = toAuthority(row.licenceAuthority);
            // An authority we do not have a code for cannot become a listing.
            // It stays staged, which is the honest place for it.
            if (!authority) continue;

            const base = slugify(row.tradeName ?? "") || `listing-${row.id.slice(-8)}`;
            let slug = base;
            for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;
            taken.add(slug);

            const business = await tx.business.create({
              data: {
                tradeName: row.tradeName!,
                displayName: (row.tradeName ?? "").replace(/ (LLC|FZE)$/, ""),
                slug,
                licenceNumber: row.licenceNumber ?? `PENDING-${row.id.slice(-8).toUpperCase()}`,
                licenceAuthority: authority,
                licenceExpiry: row.licenceExpiry ?? new Date(now.getTime() + 365 * 86_400_000),
                primaryCategoryId: row.categoryId!,
                claimStatus: "unclaimed",
                source: "licence_import",
                licenceImportRunId: run.id,
                // Nothing has been checked. Tier 0 and no publish date say so.
                verificationTier: 0,
                publishedAt: null,
              },
              select: { id: true },
            });

            await tx.stagedListing.update({
              where: { id: row.id },
              data: { disposition: "published", businessId: business.id },
            });
            count += 1;
          }

          await tx.licenceImportRun.update({
            where: { id: run.id },
            data: { status: "approved", decisionReason: input.reason, decidedAt: now },
          });

          return {
            result: count,
            before: { status: "staged" },
            after: { status: "approved", listingsCreated: count },
          };
        },
      ),
    // 8,000 rows is a long transaction. The default 5s timeout is for a
    // request, not for an import somebody kicked off and walked away from.
    { timeout: 120_000, maxWait: 10_000 },
  );

  return { ok: true, created };
}
