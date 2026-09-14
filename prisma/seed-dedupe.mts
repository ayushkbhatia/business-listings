import type { Prisma, PrismaClient } from "../lib/db/generated/client.js";
/*
   The pure half of the matcher only, for the same reason the importer seed
   takes the pure half of the importer: the services are `server-only`. Every
   score and signal below is the one `compare` returns for these two records, so
   a seeded pair is a pair the importer would have written.
*/
import { compare, type Listing, type Signal } from "../lib/dedupe/similarity.js";
import { activityKey } from "../lib/ingest/classify.js";

/**
 * Board 12b — the dedupe queue's states, on a fresh database.
 *
 * Before this the queue had pairs only if somebody staged a file that collided
 * with a listing, so `/admin/ingest/dedupe` opened on its empty state and the
 * board's render existed only in a test that deleted it afterwards.
 *
 *   Run E  DED  approved  three records naming listings already on the directory
 *     row 1  Gulf Cool's branch, licence root and suffix: the manual band, the
 *            board's own render
 *     row 2  Technopump's licence, identical: above the certain line, so it is
 *            what `Bulk merge` counts
 *     row 3  a second Gulf Cool branch, merged yesterday and waiting on the
 *            owner (Q2) — the reversible table's row and the seller's panel
 *   Run D  the KIZAD record 12a already marks a duplicate gets its pair
 *
 * Run E is `approved`, not `staged`, so the importer still opens on Run D, and
 * it publishes nothing. No listing is created and no published count moves: the
 * held branch is an unpublished location, and the pairs point at listings the
 * main seed already made.
 *
 * Deterministic and PRNG-free.
 */

type Db = PrismaClient;

const DAY = 86_400_000;
const HEADERS = ["Trade Name", "Licence No", "Authority", "Expiry Date", "Emirate", "Area", "Activity", "Phone"];

interface ListingRow {
  id: string;
  displayName: string;
  tradeName: string;
  licenceNumber: string;
  licenceAuthority: string;
  licenceActivity: string | null;
  locations: { emirate: string; areaId: string; addressLine: string; phone: string | null; area: { name: string } }[];
}

const LISTING_SELECT = {
  id: true,
  displayName: true,
  tradeName: true,
  licenceNumber: true,
  licenceAuthority: true,
  licenceActivity: true,
  locations: {
    orderBy: [{ published: "desc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { emirate: true, areaId: true, addressLine: true, phone: true, area: { select: { name: true } } },
  },
} satisfies Prisma.BusinessSelect;

function asListing(row: ListingRow): Listing {
  const first = row.locations[0];
  return {
    id: row.id,
    tradeName: row.tradeName,
    licenceNumber: row.licenceNumber,
    licenceAuthority: row.licenceAuthority,
    emirate: first?.emirate ?? null,
    areaId: first?.areaId ?? null,
    areaName: first?.area.name ?? null,
    addressLine: first?.addressLine ?? null,
    phones: row.locations.map((location) => location.phone).filter((phone): phone is string => !!phone),
    activityKey: activityKey(row.licenceActivity) || null,
  };
}

interface RecordSeed {
  tradeName: string;
  licenceNumber: string;
  emirate: string;
  areaId: string | null;
  areaName: string | null;
  activity: string | null;
  phone: string | null;
}

function asRecord(id: string, record: RecordSeed): Listing {
  return {
    id: `record:${id}`,
    tradeName: record.tradeName,
    licenceNumber: record.licenceNumber,
    licenceAuthority: "DED",
    emirate: record.emirate,
    areaId: record.areaId,
    areaName: record.areaName,
    addressLine: record.areaName,
    phones: record.phone ? [record.phone] : [],
    activityKey: activityKey(record.activity) || null,
  };
}

const json = (signals: Signal[]) => signals as unknown as Prisma.InputJsonValue;

export async function seedDedupe(db: Db, now: Date): Promise<void> {
  console.log("→ dedupe pairs, for board 12b");

  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  const inFuture = (days: number) => new Date(now.getTime() + days * DAY);

  const [opsLead, gulfCool, technopump, runD] = await Promise.all([
    db.user.findFirst({ where: { roles: { has: "staff_ops_lead" } }, orderBy: { id: "asc" }, select: { id: true } }),
    db.business.findFirst({
      where: { displayName: "Gulf Cool Technical Services", mergedIntoId: null },
      orderBy: { id: "asc" },
      select: LISTING_SELECT,
    }),
    db.business.findFirst({
      where: { displayName: "Technopump Trading", mergedIntoId: null },
      orderBy: { id: "asc" },
      select: LISTING_SELECT,
    }),
    db.licenceImportRun.findFirst({
      where: { filename: "ded-bulk-extract-2026-09.csv" },
      orderBy: { id: "asc" },
      select: {
        id: true,
        rows: {
          where: { disposition: "duplicate", duplicateOfId: { not: null } },
          orderBy: [{ rowNumber: "asc" }, { id: "asc" }],
          select: { id: true, tradeName: true, licenceNumber: true, licenceAuthority: true, emirate: true, areaName: true, phone: true, activityKey: true, duplicateOfId: true },
        },
      },
    }),
  ]);
  if (!opsLead || !gulfCool || !technopump) return;

  const gulfArea = gulfCool.locations[0];

  /* ── Run D's listed duplicate gets the pair it always implied ───────────── */

  const listed = runD?.rows[0];
  if (runD && listed?.duplicateOfId) {
    const target = await db.business.findUnique({ where: { id: listed.duplicateOfId }, select: LISTING_SELECT });
    if (target) {
      const similarity = compare(
        {
          id: `record:${listed.id}`,
          tradeName: listed.tradeName ?? "",
          licenceNumber: listed.licenceNumber ?? "",
          licenceAuthority: listed.licenceAuthority ?? "DED",
          emirate: listed.emirate,
          areaId: null,
          areaName: listed.areaName,
          addressLine: listed.areaName,
          phones: listed.phone ? [listed.phone] : [],
          activityKey: listed.activityKey || null,
        },
        asListing(target),
      );
      if (similarity.band !== "unlikely") {
        await db.mergeCandidate.create({
          data: {
            keepId: target.id,
            stagedListingId: listed.id,
            sourceRunId: runD.id,
            score: similarity.score,
            band: similarity.band,
            signals: json(similarity.signals),
            createdAt: ago(2),
          },
        });
      }
    }
  }

  /* ── Run E ──────────────────────────────────────────────────────────────── */

  const rows: RecordSeed[] = [
    {
      tradeName: "Gulf Cool Technical Services (Branch)",
      licenceNumber: `${gulfCool.licenceNumber}-01`,
      emirate: "dubai",
      areaId: gulfArea?.areaId ?? null,
      areaName: gulfArea?.area.name ?? null,
      activity: gulfCool.licenceActivity,
      phone: gulfArea?.phone ?? null,
    },
    {
      tradeName: technopump.tradeName,
      licenceNumber: technopump.licenceNumber,
      emirate: "dubai",
      areaId: technopump.locations[0]?.areaId ?? null,
      areaName: technopump.locations[0]?.area.name ?? null,
      activity: technopump.licenceActivity,
      phone: technopump.locations[0]?.phone ?? null,
    },
    {
      tradeName: "Gulf Cool Technical Services (Branch 2)",
      licenceNumber: `${gulfCool.licenceNumber}-02`,
      emirate: "dubai",
      areaId: gulfArea?.areaId ?? null,
      areaName: gulfArea?.area.name ?? null,
      activity: gulfCool.licenceActivity,
      phone: gulfArea?.phone ?? null,
    },
  ];

  const runE = await db.licenceImportRun.create({
    data: {
      headers: HEADERS,
      actorId: opsLead.id,
      source: "DED",
      filename: "ded-branch-delta-2026-09.csv",
      status: "approved",
      rowCount: rows.length,
      stagedCount: 0,
      categorisedCount: 0,
      queuedCount: 0,
      rejectedCount: 0,
      duplicateCount: rows.length,
      decisionReason: "September branch delta. Every row names a licence already listed, so nothing publishes from it.",
      decidedAt: ago(5),
      decidedById: opsLead.id,
      reversibleUntil: new Date(ago(5).getTime() + 30 * DAY),
      createdAt: ago(6),
    },
    select: { id: true },
  });

  const keeps = [gulfCool, technopump, gulfCool];
  for (const [index, record] of rows.entries()) {
    const keep = keeps[index]!;
    const merged = index === 2;
    const staged = await db.stagedListing.create({
      data: {
        runId: runE.id,
        rowNumber: index + 1,
        raw: {
          "Trade Name": record.tradeName,
          "Licence No": record.licenceNumber,
          Authority: "DED",
          "Expiry Date": inFuture(400).toISOString().slice(0, 10),
          Emirate: "Dubai",
          Area: record.areaName ?? "",
          Activity: record.activity ?? "",
          Phone: record.phone ?? "",
        },
        tradeName: record.tradeName,
        licenceNumber: record.licenceNumber,
        licenceAuthority: "DED",
        licenceExpiry: inFuture(400),
        emirate: record.emirate,
        areaName: record.areaName,
        activity: record.activity,
        activityKey: activityKey(record.activity),
        phone: record.phone,
        disposition: merged ? "merged" : "duplicate",
        duplicateOfId: keep.id,
        businessId: merged ? keep.id : null,
        createdAt: ago(6),
      },
      select: { id: true },
    });

    const similarity = compare(asRecord(staged.id, record), asListing(keep));
    if (similarity.band === "unlikely") continue;

    if (!merged) {
      await db.mergeCandidate.create({
        data: {
          keepId: keep.id,
          stagedListingId: staged.id,
          sourceRunId: runE.id,
          score: similarity.score,
          band: similarity.band,
          signals: json(similarity.signals),
          createdAt: ago(6),
        },
      });
      continue;
    }

    /*
       Merged yesterday into a claimed listing from the manual band, so the
       branch is held unpublished until the owner answers (Q2). Written as the
       service writes it: the pair, its manifest, the location it added and the
       audit row the today rail and the log read (B6).
    */
    if (!gulfArea) continue;
    const reason = "Merged as a branch: licence root and suffix match, same area as the head office.";
    const pair = await db.mergeCandidate.create({
      data: {
        keepId: keep.id,
        stagedListingId: staged.id,
        sourceRunId: runE.id,
        score: similarity.score,
        band: similarity.band,
        signals: json(similarity.signals),
        state: "merged",
        resolvedAt: ago(1),
        resolvedById: opsLead.id,
        resolutionReason: reason,
        reversibleUntil: new Date(ago(1).getTime() + 30 * DAY),
        ownerConfirmation: "awaiting",
        createdAt: ago(6),
      },
      select: { id: true },
    });
    const location = await db.location.create({
      data: {
        businessId: keep.id,
        type: "sales_office",
        emirate: "dubai",
        areaId: gulfArea.areaId,
        addressLine: "Shop 12",
        phone: record.phone,
        licenceNumber: record.licenceNumber,
        addedByCandidateId: pair.id,
        published: false,
        publishedAt: null,
        createdAt: ago(1),
      },
      select: { id: true },
    });
    await db.mergeCandidate.update({
      where: { id: pair.id },
      data: {
        manifest: { kind: "record", outcome: "merge", locationId: location.id, previousDuplicateOfId: keep.id },
      },
    });
    await db.auditEvent.create({
      data: {
        actorId: opsLead.id,
        action: "pair_merged",
        subject: `Business:${keep.id}`,
        reason,
        before: { state: "pending", disposition: "duplicate" },
        after: {
          candidateId: pair.id,
          kind: "record",
          outcome: "merge",
          recordId: staged.id,
          parentId: keep.id,
          score: similarity.score,
          band: similarity.band,
          locationId: location.id,
          heldForOwner: true,
        },
        createdAt: ago(1),
      },
    });
  }
}
