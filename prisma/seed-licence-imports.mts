import type { PrismaClient, Prisma } from "../lib/db/generated/client.js";
/*
   The pure half of the importer only. `lib/ingest/service.ts` is `server-only`
   and the seed runs in plain node, so it cannot stage through the service — but
   every record below is classified by the same functions the service calls, so
   a seeded rejection is a rejection the importer would have made.
*/
import { activityKey, classify } from "../lib/ingest/classify.js";

/**
 * Board 12a — four runs, one in each state a run can end in.
 *
 * The importer's screens read nothing the rest of the seed writes. Before this
 * a fresh database opened `/admin/ingest` on an empty table, the categorisation
 * queue on its empty state, and every run state the board specifies — awaiting
 * review, published inside its window, rolled back, discarded — existed only in
 * a test that deleted it afterwards.
 *
 *   Run A  SAIF   rolled back    two listings withdrawn, the window long shut
 *   Run B  ADDED  discarded      a wrong month's file, nothing published
 *   Run C  DED    published      inside the window, two listings from the
 *                                 existing seed, one of them claimed since — so
 *                                 the rollback preview has something to keep
 *   Run D  DED    awaiting       the board's render: every bucket, every
 *                                 rejection ground, a queue with repeated phrases
 *
 * Run C links **existing** listings rather than creating new ones. A published
 * listing added here would move every directory count a dozen e2e files pin,
 * and `licenceImportRunId` is read by the importer and nothing else — so the
 * two are told where they came from and nothing any other board shows moves.
 *
 * Deterministic and PRNG-free. Nothing here draws from the shared generator,
 * so adding it renames no business generated after it.
 */

type Db = PrismaClient;

const DAY = 86_400_000;

interface RecordSeed {
  tradeName: string | null;
  licenceNumber: string | null;
  authority: string | null;
  expiry: Date | null;
  emirate: string | null;
  area: string | null;
  activity: string | null;
  phone: string | null;
}

/** The seeded files' header row, in the order `raw` below writes it. */
const HEADERS = ["Trade Name", "Licence No", "Authority", "Expiry Date", "Emirate", "Area", "Activity", "Phone"];

function raw(record: RecordSeed): Prisma.InputJsonValue {
  return {
    "Trade Name": record.tradeName ?? "",
    "Licence No": record.licenceNumber ?? "",
    Authority: record.authority ?? "",
    "Expiry Date": record.expiry ? record.expiry.toISOString().slice(0, 10) : "",
    Emirate: record.emirate ?? "",
    Area: record.area ?? "",
    Activity: record.activity ?? "",
    Phone: record.phone ?? "",
  };
}

/** The emirate key the importer stores, from the export's spelling. */
function emirateKey(value: string | null): string | null {
  const key = (value ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  return ["dubai", "abu_dhabi", "sharjah", "ajman", "umm_al_quwain", "ras_al_khaimah", "fujairah"].includes(key)
    ? key
    : null;
}

export async function seedLicenceImports(db: Db, now: Date): Promise<void> {
  console.log("→ licence import runs, for board 12a");

  const [opsLead, moderator, categories, linked, duplicateOf] = await Promise.all([
    db.user.findFirst({
      where: { roles: { has: "staff_ops_lead" } },
      orderBy: { id: "asc" },
      select: { id: true },
    }),
    db.user.findFirst({ where: { roles: { has: "staff_moderator" } }, select: { id: true } }),
    db.category.findMany({
      where: { slug: { in: ["valves-and-fittings", "pipes-and-tubing", "hvac-and-ventilation", "electrical-and-cable", "marine-safety"] } },
      select: { id: true, slug: true },
    }),
    // Run C's two: DED listings from the main seed, one unclaimed and one claimed.
    Promise.all([
      db.business.findFirst({
        where: { licenceAuthority: "DED", source: "licence_import", claimStatus: "unclaimed", publishedAt: { not: null }, mergedIntoId: null },
        orderBy: { slug: "asc" },
        select: { id: true, tradeName: true, licenceNumber: true, licenceExpiry: true, primaryCategoryId: true, slug: true },
      }),
      db.business.findFirst({
        where: { licenceAuthority: "DED", source: "licence_import", claimStatus: "claimed", publishedAt: { not: null }, mergedIntoId: null },
        orderBy: { slug: "asc" },
        select: { id: true, tradeName: true, licenceNumber: true, licenceExpiry: true, primaryCategoryId: true, slug: true },
      }),
    ]),
    // A licence Run D repeats, named by its own authority column.
    db.business.findFirst({
      where: { licenceAuthority: "KIZAD", source: "licence_import", mergedIntoId: null },
      orderBy: { slug: "asc" },
      select: { id: true, tradeName: true, licenceNumber: true },
    }),
  ]);
  if (!opsLead || !moderator) return;

  const category = (slug: string) => categories.find((row) => row.slug === slug)?.id ?? null;
  const valves = category("valves-and-fittings");
  const pipes = category("pipes-and-tubing");
  const hvac = category("hvac-and-ventilation");
  const cable = category("electrical-and-cable");
  const marineSafety = category("marine-safety");
  if (!valves || !pipes || !hvac || !cable) return;

  const inFuture = (days: number) => new Date(now.getTime() + days * DAY);
  const ago = (days: number) => new Date(now.getTime() - days * DAY);

  /* ── Run A: rolled back ─────────────────────────────────────────────────── */

  const runA = await db.licenceImportRun.create({
    data: {
      headers: HEADERS,
      actorId: opsLead.id,
      source: "SAIF",
      filename: "saif-register-2026-07.csv",
      status: "rolled_back",
      rowCount: 4,
      stagedCount: 2,
      categorisedCount: 2,
      queuedCount: 0,
      rejectedCount: 1,
      duplicateCount: 1,
      decisionReason: "SAIF July register, checked against June before approving.",
      decidedAt: ago(49),
      decidedById: opsLead.id,
      reversibleUntil: ago(19),
      rolledBackAt: ago(47),
      rolledBackById: opsLead.id,
      rollbackReason: "The source file carried the whole free zone twice; withdrawn before anybody claimed.",
      rollbackManifest: { withdrawn: [], kept: [] },
      createdAt: ago(50),
    },
    select: { id: true },
  });

  const withdrawn: string[] = [];
  const runARecords: { record: RecordSeed; categoryId: string }[] = [
    {
      record: { tradeName: "Hamriyah Valve Stockists LLC", licenceNumber: "SAIF-40119", authority: "SAIF", expiry: inFuture(300), emirate: "Sharjah", area: null, activity: "Valves & Flanges Trading", phone: "065571102" },
      categoryId: valves,
    },
    {
      record: { tradeName: "Saif Line Pipe Supply FZE", licenceNumber: "SAIF-40127", authority: "SAIF", expiry: inFuture(210), emirate: "Sharjah", area: null, activity: "GI Pipe and Tube Trading", phone: "065571188" },
      categoryId: pipes,
    },
  ];
  for (const [index, { record, categoryId }] of runARecords.entries()) {
    const business = await db.business.create({
      data: {
        tradeName: record.tradeName!,
        displayName: record.tradeName!.replace(/ (LLC|FZE)$/, ""),
        slug: `import-seed-${record.licenceNumber!.toLowerCase()}`,
        licenceNumber: record.licenceNumber!,
        licenceAuthority: "SAIF",
        licenceExpiry: record.expiry!,
        licenceActivity: record.activity,
        primaryCategoryId: categoryId,
        claimStatus: "unclaimed",
        source: "licence_import",
        licenceImportRunId: runA.id,
        verificationTier: 0,
        // Withdrawn by the rollback: live for two days, then taken down.
        publishedAt: null,
        createdAt: ago(49),
      },
      select: { id: true },
    });
    withdrawn.push(business.id);
    await db.stagedListing.create({
      data: {
        runId: runA.id,
        rowNumber: index + 1,
        raw: raw(record),
        tradeName: record.tradeName,
        licenceNumber: record.licenceNumber,
        licenceAuthority: record.authority,
        licenceExpiry: record.expiry,
        emirate: emirateKey(record.emirate),
        activity: record.activity,
        activityKey: activityKey(record.activity),
        phone: record.phone,
        categoryId,
        categorySource: "signal",
        disposition: "published",
        businessId: business.id,
        createdAt: ago(50),
      },
    });
  }
  const repeated = runARecords[0]!.record;
  await db.stagedListing.createMany({
    data: [
      {
        runId: runA.id,
        rowNumber: 3,
        raw: raw(repeated),
        tradeName: repeated.tradeName,
        licenceNumber: repeated.licenceNumber,
        licenceAuthority: repeated.authority,
        licenceExpiry: repeated.expiry,
        emirate: emirateKey(repeated.emirate),
        activity: repeated.activity,
        activityKey: activityKey(repeated.activity),
        phone: repeated.phone,
        disposition: "duplicate",
        duplicateOfRow: 1,
        createdAt: ago(50),
      },
      {
        runId: runA.id,
        rowNumber: 4,
        raw: raw({ ...repeated, tradeName: "Gulf Marine Traders", licenceNumber: "SAIF-40133", emirate: "Doha" }),
        tradeName: "Gulf Marine Traders",
        licenceNumber: "SAIF-40133",
        licenceAuthority: "SAIF",
        licenceExpiry: repeated.expiry,
        emirate: null,
        activity: repeated.activity,
        activityKey: activityKey(repeated.activity),
        disposition: "rejected",
        rejectionGround: "address_outside_uae",
        createdAt: ago(50),
      },
    ],
  });
  await db.licenceImportRun.update({
    where: { id: runA.id },
    data: { rollbackManifest: { withdrawn, kept: [] } },
  });

  /* ── Run B: discarded ───────────────────────────────────────────────────── */

  const runB = await db.licenceImportRun.create({
    data: {
      headers: HEADERS,
      actorId: moderator.id,
      source: "ADDED",
      filename: "added-extract-2026-07.csv",
      status: "discarded",
      rowCount: 2,
      stagedCount: 2,
      categorisedCount: 1,
      queuedCount: 1,
      decisionReason: "July's extract uploaded in place of August's. Staging the right file next.",
      decidedAt: ago(29),
      decidedById: opsLead.id,
      createdAt: ago(30),
    },
    select: { id: true },
  });
  const runBRecords: RecordSeed[] = [
    { tradeName: "Mussafah Cable Centre LLC", licenceNumber: "ADDED-771020", authority: null, expiry: inFuture(120), emirate: "Abu Dhabi", area: "Mussafah", activity: "Electrical Cable & Accessories Trading", phone: "025551020" },
    { tradeName: "Capital General Trading LLC", licenceNumber: "ADDED-771031", authority: null, expiry: inFuture(400), emirate: "Abu Dhabi", area: "Mussafah", activity: "General Trading", phone: "025551031" },
  ];
  await db.stagedListing.createMany({
    data: runBRecords.map((record, index) => ({
      runId: runB.id,
      rowNumber: index + 1,
      raw: raw(record),
      tradeName: record.tradeName,
      licenceNumber: record.licenceNumber,
      licenceAuthority: record.authority,
      licenceExpiry: record.expiry,
      emirate: emirateKey(record.emirate),
      areaName: record.area,
      activity: record.activity,
      activityKey: activityKey(record.activity),
      phone: record.phone,
      categoryId: index === 0 ? cable : null,
      categorySource: index === 0 ? ("signal" as const) : null,
      disposition: index === 0 ? ("ready" as const) : ("needs_category" as const),
      createdAt: ago(30),
    })),
  });

  /* ── Run C: published, inside the window ────────────────────────────────── */

  const [unclaimed, claimed] = linked;
  if (unclaimed && claimed) {
    const runC = await db.licenceImportRun.create({
      data: {
        headers: HEADERS,
        actorId: opsLead.id,
        source: "DED",
        filename: "ded-monthly-2026-08.csv",
        status: "approved",
        rowCount: 5,
        stagedCount: 4,
        categorisedCount: 3,
        queuedCount: 1,
        rejectedCount: 1,
        decisionReason: "August DED delta. Spot-checked twenty licences against the DED portal.",
        decidedAt: ago(12),
        decidedById: opsLead.id,
        reversibleUntil: new Date(ago(12).getTime() + 30 * DAY),
        createdAt: ago(13),
      },
      select: { id: true },
    });

    // The listings are told which run created them, and nothing else changes.
    await db.business.updateMany({
      where: { id: { in: [unclaimed.id, claimed.id] } },
      data: { licenceImportRunId: runC.id },
    });

    const published = [unclaimed, claimed].map((business, index) => ({
      runId: runC.id,
      rowNumber: index + 1,
      raw: raw({
        tradeName: business.tradeName,
        licenceNumber: business.licenceNumber,
        authority: "DED",
        expiry: business.licenceExpiry,
        emirate: "Dubai",
        area: null,
        activity: "Trading in Valves & Pipe Fittings",
        phone: null,
      }),
      tradeName: business.tradeName,
      licenceNumber: business.licenceNumber,
      licenceAuthority: "DED",
      licenceExpiry: business.licenceExpiry,
      emirate: "dubai",
      activity: "Trading in Valves & Pipe Fittings",
      activityKey: activityKey("Trading in Valves & Pipe Fittings"),
      categoryId: business.primaryCategoryId,
      categorySource: "signal" as const,
      disposition: "published" as const,
      businessId: business.id,
      createdAt: ago(13),
    }));

    const later: RecordSeed = { tradeName: "Ras Al Khor Pipe Supply LLC", licenceNumber: "DED-884310", authority: null, expiry: inFuture(330), emirate: "Dubai", area: "Ras Al Khor Industrial 2", activity: "Hardware & Tools Trading", phone: "043388431" };
    const waiting: RecordSeed = { tradeName: "Jebel Ali Ship Stores LLC", licenceNumber: "DED-884322", authority: null, expiry: inFuture(260), emirate: "Dubai", area: "Jebel Ali Industrial 1", activity: "Marine Equipment Trading", phone: "048812232" };
    const expired: RecordSeed = { tradeName: "Old Town Fittings LLC", licenceNumber: "DED-110022", authority: null, expiry: ago(900), emirate: "Dubai", area: "Deira", activity: "Valves & Flanges Trading", phone: null };

    await db.stagedListing.createMany({
      data: [
        ...published,
        {
          // Categorised by a person after the run was approved: the "1 more
          // ready to publish" the published state has to be able to say.
          runId: runC.id,
          rowNumber: 3,
          raw: raw(later),
          tradeName: later.tradeName,
          licenceNumber: later.licenceNumber,
          licenceExpiry: later.expiry,
          emirate: "dubai",
          areaName: later.area,
          activity: later.activity,
          activityKey: activityKey(later.activity),
          phone: later.phone,
          categoryId: pipes,
          categorySource: "staff",
          categorisedById: opsLead.id,
          categorisedAt: ago(5),
          disposition: "ready",
          createdAt: ago(13),
        },
        {
          runId: runC.id,
          rowNumber: 4,
          raw: raw(waiting),
          tradeName: waiting.tradeName,
          licenceNumber: waiting.licenceNumber,
          licenceExpiry: waiting.expiry,
          emirate: "dubai",
          areaName: waiting.area,
          activity: waiting.activity,
          activityKey: activityKey(waiting.activity),
          phone: waiting.phone,
          disposition: "needs_category",
          createdAt: ago(13),
        },
        {
          runId: runC.id,
          rowNumber: 5,
          raw: raw(expired),
          tradeName: expired.tradeName,
          licenceNumber: expired.licenceNumber,
          licenceExpiry: expired.expiry,
          emirate: "dubai",
          areaName: expired.area,
          activity: expired.activity,
          activityKey: activityKey(expired.activity),
          disposition: "rejected",
          rejectionGround: "licence_expired_24_months",
          createdAt: ago(13),
        },
      ],
    });
  }

  /* ── Run D: awaiting review — the board's render ────────────────────────── */

  const dubai = (area: string) => ({ emirate: "Dubai", area });
  const d: RecordSeed[] = [
    // Matched by the keyword signals.
    { tradeName: "Al Quoz Valve House LLC", licenceNumber: "DED-902101", authority: null, expiry: inFuture(410), ...dubai("Al Quoz Industrial 1"), activity: "Trading in Valves & Pipe Fittings", phone: "043470101" },
    { tradeName: "Qusais Flange & Fittings LLC", licenceNumber: "DED-902102", authority: null, expiry: inFuture(380), ...dubai("Al Qusais Industrial 4"), activity: "Valves & Flanges Trading", phone: "042670102" },
    { tradeName: "Deira Pipe Traders LLC", licenceNumber: "DED-902103", authority: null, expiry: inFuture(520), ...dubai("Deira"), activity: "GI Pipe and Tube Trading", phone: "042210103" },
    { tradeName: "Seamless Tube Supply LLC", licenceNumber: "DED-902104", authority: null, expiry: inFuture(300), ...dubai("Al Quoz Industrial 3"), activity: "Seamless Pipe & Tubing Trading", phone: "043470104" },
    { tradeName: "Cool Air Systems Trading LLC", licenceNumber: "DED-902105", authority: null, expiry: inFuture(640), ...dubai("Al Quoz Industrial 3"), activity: "Air Conditioning Equipment Trading", phone: "043470105" },
    { tradeName: "Ductline Ventilation LLC", licenceNumber: "DED-902106", authority: null, expiry: inFuture(250), ...dubai("Al Qusais Industrial 4"), activity: "Ventilation & Duct Works Materials Trading", phone: "042670106" },
    { tradeName: "Bright Cable Trading LLC", licenceNumber: "DED-902107", authority: null, expiry: inFuture(700), ...dubai("Deira"), activity: "Electrical Cable & Accessories Trading", phone: "042210107" },
    { tradeName: "Switchgear Point LLC", licenceNumber: "DED-902108", authority: null, expiry: inFuture(90), ...dubai("Al Quoz Industrial 1"), activity: "Switchgear & Busbar Trading", phone: "043470108" },
    // A late renewal, kept: expired, and inside the 24-month floor (B6).
    { tradeName: "Karama Valve Works LLC", licenceNumber: "DED-902109", authority: null, expiry: new Date(now.getTime() - 60 * DAY), ...dubai("Deira"), activity: "Trading in Valves & Pipe Fittings", phone: "042210109" },
    // Held: no expiry the importer could read.
    { tradeName: "Hatta Pipe Centre LLC", licenceNumber: "DED-902110", authority: null, expiry: null, ...dubai("Deira"), activity: "GI Pipe and Tube Trading", phone: "042210110" },
    // Held: an authority the schema has no code for.
    { tradeName: "Meydan Air Solutions FZE", licenceNumber: "XFZ-7710", authority: "XFZ", expiry: inFuture(365), ...dubai("Al Quoz Industrial 1"), activity: "Air Conditioning Equipment Trading", phone: "043470111" },
    // The queue: three phrases that repeat, and one record with none.
    { tradeName: "Emirates Star General Trading LLC", licenceNumber: "DED-902112", authority: null, expiry: inFuture(450), ...dubai("Deira"), activity: "General Trading", phone: "042210112" },
    { tradeName: "Blue Line General Trading LLC", licenceNumber: "DED-902113", authority: null, expiry: inFuture(330), ...dubai("Al Qusais Industrial 4"), activity: "General Trading", phone: "042670113" },
    { tradeName: "Noor Al Madina General Trading LLC", licenceNumber: "DED-902114", authority: null, expiry: inFuture(610), ...dubai("Deira"), activity: "general  trading", phone: "042210114" },
    { tradeName: "Silver Sands General Trading LLC", licenceNumber: "DED-902115", authority: null, expiry: inFuture(200), ...dubai("Al Quoz Industrial 3"), activity: "General Trading", phone: "043470115" },
    { tradeName: "Crescent Building Materials LLC", licenceNumber: "DED-902116", authority: null, expiry: inFuture(540), ...dubai("Al Quoz Industrial 1"), activity: "Building Materials Trading", phone: "043470116" },
    { tradeName: "Stone & Block Trading LLC", licenceNumber: "DED-902117", authority: null, expiry: inFuture(310), ...dubai("Al Qusais Industrial 4"), activity: "Building Materials Trading", phone: "042670117" },
    { tradeName: "Foundation Supply Co LLC", licenceNumber: "DED-902118", authority: null, expiry: inFuture(480), ...dubai("Al Quoz Industrial 3"), activity: "Building Materials Trading", phone: "043470118" },
    { tradeName: "Creek Marine Supplies LLC", licenceNumber: "DED-902119", authority: null, expiry: inFuture(270), ...dubai("Deira"), activity: "Marine Equipment Trading", phone: "042210119" },
    { tradeName: "Harbour Chandlery LLC", licenceNumber: "DED-902120", authority: null, expiry: inFuture(390), ...dubai("Deira"), activity: "Marine Equipment Trading", phone: "042210120" },
    { tradeName: "Anchor Point Trading LLC", licenceNumber: "DED-902121", authority: null, expiry: inFuture(150), ...dubai("Al Quoz Industrial 1"), activity: null, phone: "043470121" },
    // Duplicates: a licence already listed (by its own authority column), and a
    // row this file repeats.
    { tradeName: duplicateOf?.tradeName ?? "Existing Listing LLC", licenceNumber: duplicateOf?.licenceNumber ?? "KIZAD-000000", authority: "KIZAD", expiry: inFuture(365), emirate: "Abu Dhabi", area: "KIZAD", activity: "Valves & Flanges Trading", phone: null },
    { tradeName: "Qusais Flange & Fittings LLC", licenceNumber: "DED-902102", authority: null, expiry: inFuture(380), ...dubai("Al Qusais Industrial 4"), activity: "Valves & Flanges Trading", phone: "042670102" },
    // Rejections, every ground represented.
    { tradeName: "Old Souk Valves LLC", licenceNumber: "DED-120301", authority: null, expiry: new Date(now.getTime() - 1100 * DAY), ...dubai("Deira"), activity: "Valves & Flanges Trading", phone: null },
    { tradeName: "Karama Cable House LLC", licenceNumber: "DED-120302", authority: null, expiry: new Date(now.getTime() - 900 * DAY), ...dubai("Deira"), activity: "Electrical Cable & Accessories Trading", phone: null },
    { tradeName: "N/A", licenceNumber: "DED-902124", authority: null, expiry: inFuture(300), ...dubai("Deira"), activity: "General Trading", phone: null },
    { tradeName: "-", licenceNumber: "DED-902125", authority: null, expiry: inFuture(300), ...dubai("Deira"), activity: "Hardware & Tools Trading", phone: null },
    { tradeName: "Jumeirah Beauty Lounge LLC", licenceNumber: "DED-902126", authority: null, expiry: inFuture(300), ...dubai("Deira"), activity: "Ladies Beauty Salon", phone: null },
    { tradeName: "Doha Pipe Trading WLL", licenceNumber: "DED-902127", authority: null, expiry: inFuture(300), emirate: "Doha", area: null, activity: "GI Pipe and Tube Trading", phone: null },
  ];

  const signal: Record<string, string> = {
    "valves-and-fittings": valves,
    "pipes-and-tubing": pipes,
    "hvac-and-ventilation": hvac,
    "electrical-and-cable": cable,
  };

  const runD = await db.licenceImportRun.create({
    data: {
      headers: HEADERS,
      actorId: moderator.id,
      source: "DED",
      filename: "ded-bulk-extract-2026-09.csv",
      status: "staged",
      rowCount: d.length,
      createdAt: ago(2),
    },
    select: { id: true },
  });

  // Found by content rather than by position, so a record added above does not
  // silently turn a different row into the duplicate.
  const listedIndex = d.findIndex((record) => record.authority === "KIZAD");
  const repeatIndex = d.findIndex(
    (record, index) => index > 0 && record.licenceNumber === "DED-902102" && d.findIndex((r) => r.licenceNumber === "DED-902102") !== index,
  );
  const staged = d.map((record, index) => {
    const verdict = classify(
      {
        tradeName: record.tradeName,
        licenceNumber: record.licenceNumber,
        licenceAuthority: record.authority,
        licenceExpiry: record.expiry,
        emirate: record.emirate,
        areaName: record.area,
        activity: record.activity,
        phone: record.phone,
      },
      now,
    );
    const rowNumber = index + 1;
    const isListed = index === listedIndex && duplicateOf !== null;
    const isRepeat = index === repeatIndex;
    const disposition =
      verdict.disposition === "rejected"
        ? ("rejected" as const)
        : isListed || isRepeat
          ? ("duplicate" as const)
          : verdict.categorySlug
            ? ("ready" as const)
            : ("needs_category" as const);
    const categoryId = disposition === "ready" ? (signal[verdict.categorySlug!] ?? null) : null;

    return {
      runId: runD.id,
      rowNumber,
      raw: raw(record),
      tradeName: record.tradeName,
      licenceNumber: record.licenceNumber,
      licenceAuthority: record.authority,
      licenceExpiry: record.expiry,
      emirate: emirateKey(record.emirate),
      areaName: record.area,
      activity: record.activity,
      activityKey: activityKey(record.activity),
      phone: record.phone,
      categoryId,
      categorySource: categoryId ? ("signal" as const) : null,
      disposition: categoryId === null && disposition === "ready" ? ("needs_category" as const) : disposition,
      rejectionGround: verdict.ground,
      duplicateOfId: isListed ? duplicateOf!.id : null,
      duplicateOfRow: isRepeat ? 2 : null,
      createdAt: ago(2),
    };
  });

  await db.stagedListing.createMany({ data: staged });

  const tally = (disposition: string) => staged.filter((row) => row.disposition === disposition).length;
  await db.licenceImportRun.update({
    where: { id: runD.id },
    data: {
      stagedCount: tally("ready") + tally("needs_category"),
      categorisedCount: tally("ready"),
      queuedCount: tally("needs_category"),
      rejectedCount: tally("rejected"),
      duplicateCount: tally("duplicate"),
    },
  });

  /* ── A remembered decision ──────────────────────────────────────────────── */

  // "Ship stores" was decided last month, so it arrives filed and never queues.
  // A subcategory whose trade kind is inherited, so the queue's flag has a real
  // row to be shown against.
  if (marineSafety) {
    await db.licenceActivityMapping.create({
      data: {
        activityKey: activityKey("Ship Stores & Marine Safety Equipment Trading"),
        activity: "Ship Stores & Marine Safety Equipment Trading",
        categoryId: marineSafety,
        actorId: opsLead.id,
        reason: "Ship stores licences in DED exports are marine safety suppliers; checked eight of them.",
        createdAt: ago(20),
        updatedAt: ago(20),
      },
    });
  }
}
