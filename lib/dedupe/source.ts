import "server-only";
import { prisma } from "@/lib/db/client";
import { Prisma } from "@/lib/db/generated/client";
import type { PrismaClient } from "@/lib/db/generated/client";
import { MIN_BLOCK, blockCapFor, keysFor } from "./match";
import { activityKey } from "@/lib/ingest/classify";
import { parseBands } from "./bands";
import type { Bands, Listing } from "./similarity";

/**
 * What the matcher reads from the database, in one place.
 *
 * The importer, the rescan, the tuning preview and the pair screen must agree
 * on what a listing *is* for matching — which fields, which location, which
 * listings count at all — or a pair found at staging is a different pair on
 * screen.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export const BANDS_SETTING_KEY = "dedupe.bands";

/** The tuned lines, or the defaults. Never throws on a malformed row. */
export async function readBands(db: Db = prisma): Promise<Bands> {
  const row = await db.platformSetting.findUnique({
    where: { key: BANDS_SETTING_KEY },
    select: { value: true },
  });
  return parseBands(row?.value);
}

/**
 * Every listing a record can be a duplicate of.
 *
 * Live listings, and claimed ones whatever their state — a claimed listing the
 * owner has not finished publishing is still somebody's company. Not a listing
 * merged into another: the survivor is the one to match. Not an unclaimed
 * listing a rollback or a discard took down: it is not in the directory, and a
 * record pairing with it would be pairing with a ghost.
 *
 * Every location's phone, because a branch's number is how a head office is
 * most often recognised; the first location's area and address, in a fixed
 * order, because "first" has to mean the same thing on every call.
 */
/**
 * What a listing is, for matching — the columns and the location order.
 *
 * Shared by the whole-directory read and T4.4's per-chunk candidate read, so
 * the two cannot disagree about which location is "first" or which phones
 * count. Live locations first, so a branch held for its owner never becomes
 * the area a listing is matched by.
 */
const LISTING_SELECT = {
  id: true,
  tradeName: true,
  licenceNumber: true,
  licenceAuthority: true,
  licenceActivity: true,
  locations: {
    orderBy: [{ published: "desc" }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      emirate: true,
      areaId: true,
      addressLine: true,
      phone: true,
      area: { select: { name: true } },
    },
  },
} satisfies Prisma.BusinessSelect;

type ListingRow = Prisma.BusinessGetPayload<{ select: typeof LISTING_SELECT }>;

function toListing(row: ListingRow): Listing {
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

/** Businesses per batch in the whole-directory read. See `loadMatchListings`. */
const DIRECTORY_BATCH = 2_000;

const MATCHABLE_WHERE = {
  mergedIntoId: null,
  // A closed business (board 11i) is off the directory and waiting to be
  // reopened or forgotten; a registry row is not a branch of it.
  closedAt: null,
  OR: [{ publishedAt: { not: null } }, { claimStatus: { not: "unclaimed" } }],
} satisfies Prisma.BusinessWhereInput;

/**
 * Every listing a record can be a duplicate of.
 *
 * The importer does **not** call this any more — T4.4 gave it
 * `loadCandidateListings`. What still does is board `12b`'s rescan and its
 * tuning preview, both of which really do mean the whole directory: a rescan
 * that skipped a listing would leave a pair nobody will look for again.
 *
 * ## Why it is batched, and it is not about speed
 *
 * It was one `findMany` with the `locations` relation included. Prisma loads a
 * relation with a second query carrying one bound parameter per parent row, and
 * Postgres allows 65,535 — so at 38,687 listings this did not run slowly, it
 * **threw** `P2029`, before a single comparison. Measured on the 41,000-row
 * harness by `pnpm measure:ingest`, which prints the refusal.
 *
 * So the one read that is allowed to be about the whole directory is the one
 * that could not read it. Keyset batches of two thousand, and the locations
 * fetched per batch by id — the same shape `lib/search/directory.ts` uses for
 * the same reason.
 */
export async function loadMatchListings(db: Db = prisma): Promise<Listing[]> {
  const out: Listing[] = [];
  let cursor: string | null = null;

  for (;;) {
    const page: { id: string }[] = await db.business.findMany({
      where: MATCHABLE_WHERE,
      orderBy: { id: "asc" },
      take: DIRECTORY_BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true },
    });
    if (page.length === 0) break;
    out.push(...(await hydrate(page.map((row) => row.id), db)));
    cursor = page[page.length - 1]!.id;
    if (page.length < DIRECTORY_BATCH) break;
  }

  return out;
}

/** A ceiling on one chunk's candidate set, for the two exact reads. */
export const MAX_CANDIDATES = 20_000;

/**
 * How many listings one identifying **word** may contribute — T4.4/T4.5.
 *
 * The same rule `buildMatchIndex` applies in memory, applied in the query
 * instead: a word matching more than this share of the directory identifies
 * nobody. In-process the cut happened *after* every listing had been read; here
 * a useless word costs its cap in index entries rather than nine thousand rows.
 *
 * Dropped whole rather than truncated. An arbitrary few hundred of nine
 * thousand is a different question answered quietly, and a pair that word would
 * have found still shares a licence, a phone, or a rarer word in the same name.
 *
 * `corpus` is the directory's size, counted once per run by the caller rather
 * than per chunk. Zero — the default — gives the floor, which is right for a
 * caller that has not counted: the floor is the cap for any directory small
 * enough that no word identifies nobody.
 */
export async function candidateBlockCap(db: Db = prisma): Promise<number> {
  return blockCapFor(await db.business.count({ where: MATCHABLE_WHERE }));
}

/**
 * Only the listings a chunk of records could possibly be a duplicate of —
 * task T4.4.
 *
 * ## What it replaced
 *
 * `loadMatchListings()`: **every** listing in the directory with **all** of its
 * locations and each location's area, into one array, and then an in-process
 * blocking index over all of it. Twice per run — once at staging and again at
 * publish. At 41,000 listings that is tens of megabytes in a serverless
 * function and a hundred and fifty thousand index keys built to answer
 * questions about a few hundred records, and the cost grows with the directory
 * rather than with the file.
 *
 * ## How the blocking moved into the database
 *
 * `keysFor` is the one definition of "could these two be the same company at
 * all": a shared licence, a shared licence root, a shared phone, or a shared
 * identifying word of the name. Three indexed reads ask for exactly that, and
 * the in-process index is then built from what comes back — so the matcher
 * itself is untouched and a pair found here is the same pair it always was.
 *
 *   1 · **licence digits**, equality against this chunk's digits and roots,
 *       on `business_licence_digits_idx`;
 *   2 · **a branch's phone**, equality on `location_phone_digits_idx`, both
 *       spellings of each key because the index does not strip the country code;
 *   3 · **an identifying word**, `trade_name ILIKE '%word%'` on the trigram
 *       index that is already there.
 *
 * A superset is the correct answer for a blocking step: `compare` decides, and
 * a candidate that scores nothing costs one comparison. The substring match in
 * step 3 is deliberately wider than the token equality the in-process index
 * used, for that reason.
 *
 * ## The one narrowing, stated rather than hidden
 *
 * In-process, a **listing** carrying a branch suffix (`DED-441908-01`) also
 * blocked on its root, so a record for the parent (`DED-441908`) found it on
 * the licence alone. Here the roots in the key list are the *records'*, so that
 * direction is found by the phone or the name instead — which in a register
 * export is nearly always present, since a branch of a company shares both.
 * Reproducing it would need the listing's root as an indexed expression, which
 * means either a generated column `prisma migrate dev` would drop or an index
 * definition reproducing three branches of `licenceParts` in SQL and drifting
 * from it. Board `12b`'s rescan still reads the whole directory and is the
 * place that sweep belongs.
 */
export async function loadCandidateListings(
  records: readonly Listing[],
  db: Db = prisma,
  /** `candidateBlockCap()`, counted once per run. Defaults to the floor. */
  cap: number = MIN_BLOCK,
): Promise<Listing[]> {
  if (records.length === 0) return [];

  const digits = new Set<string>();
  const phones = new Set<string>();
  const words = new Set<string>();
  for (const record of records) {
    for (const key of keysFor(record)) {
      const value = key.slice(key.indexOf(":") + 1);
      if (key.startsWith("licence:") || key.startsWith("root:")) digits.add(value);
      else if (key.startsWith("phone:")) {
        // Both spellings. `phoneKey` takes the country code off and the index
        // does not, so a stored `+9714…` is reached by the `971`-prefixed form.
        phones.add(value);
        phones.add(`971${value}`);
        phones.add(`00971${value}`);
        phones.add(`0${value}`);
      } else if (key.startsWith("name:")) words.add(value);
    }
  }

  const ids = new Set<string>();
  const collect = (rows: readonly { id: string }[]) => {
    for (const row of rows) ids.add(row.id);
  };

  const [byLicence, byPhone, byName] = await Promise.all([
    digits.size === 0
      ? []
      : db.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT b."id" FROM "business" b
           WHERE ${MATCHABLE}
             AND regexp_replace(coalesce(b."licence_number", ''), '[^0-9]', '', 'g')
                 = ANY(${[...digits]}::text[])
           LIMIT ${MAX_CANDIDATES}`),
    phones.size === 0
      ? []
      : db.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT DISTINCT b."id" FROM "business" b
            JOIN "location" l ON l."business_id" = b."id"
           WHERE ${MATCHABLE}
             AND regexp_replace(coalesce(l."phone", ''), '[^0-9]', '', 'g')
                 = ANY(${[...phones]}::text[])
           LIMIT ${MAX_CANDIDATES}`),
    words.size === 0
      ? []
      : /*
           One lateral per word, capped — which is `MAX_BLOCK`'s argument moved
           into SQL.
 
           A word shared by thousands of trade names ("gulf", "trading")
           identifies nobody, and asking for all of them is how a 200-record
           chunk pulled back twenty thousand candidates and spent a second
           doing it. The cap is `MAX_BLOCK + 1` **per word**, and a word that
           comes back over the line is dropped whole rather than truncated:
           an arbitrary two hundred of nine thousand would quietly answer a
           different question, while dropping the word loses nothing that the
           licence, the phone or a rarer word in the same name will not find.
        */
        db.$queryRaw<{ word: string; id: string }[]>(Prisma.sql`
          SELECT w."word", c."id"
            FROM unnest(${[...words]}::text[]) AS w("word")
            CROSS JOIN LATERAL (
              SELECT b."id" FROM "business" b
               WHERE ${MATCHABLE}
                 AND b."trade_name" ILIKE '%' || w."word" || '%'
               LIMIT ${cap + 1}
            ) c`),
  ]);
  collect(byLicence);
  collect(byPhone);

  const perWord = new Map<string, string[]>();
  for (const row of byName) {
    const block = perWord.get(row.word);
    if (block) block.push(row.id);
    else perWord.set(row.word, [row.id]);
  }
  for (const block of perWord.values()) {
    if (block.length > cap) continue;
    for (const id of block) ids.add(id);
  }

  if (ids.size === 0) return [];
  return hydrate([...ids], db);
}

/**
 * The predicate `loadMatchListings` applies, as SQL — one definition, two
 * readers.
 *
 * Live listings, and claimed ones whatever their state. Not merged, not closed.
 * A drift between this and the Prisma `where` above would mean a pair found at
 * staging is not a pair at publish.
 */
const MATCHABLE = Prisma.sql`
  b."merged_into_id" IS NULL
  AND b."closed_at" IS NULL
  AND (b."published_at" IS NOT NULL OR b."claim_status" <> 'unclaimed')`;

/** The full matcher shape for a set of ids, with the same location ordering. */
async function hydrate(ids: readonly string[], db: Db): Promise<Listing[]> {
  const rows = await db.business.findMany({
    where: { id: { in: [...ids] } },
    orderBy: { id: "asc" },
    select: LISTING_SELECT,
  });
  return rows.map(toListing);
}

export interface RecordFields {
  id: string;
  tradeName: string | null;
  licenceNumber: string | null;
  /** The effective authority: the record's own, or its run's. */
  authority: string;
  emirate: string | null;
  areaId: string | null;
  areaName: string | null;
  phone: string | null;
  activityKey: string;
}

/** A staged record, in the shape the matcher compares. */
export function recordAsListing(record: RecordFields): Listing {
  return {
    id: `record:${record.id}`,
    tradeName: record.tradeName ?? "",
    licenceNumber: record.licenceNumber ?? "",
    licenceAuthority: record.authority,
    emirate: record.emirate,
    areaId: record.areaId,
    areaName: record.areaName,
    addressLine: record.areaName,
    phones: record.phone ? [record.phone] : [],
    activityKey: record.activityKey || null,
  };
}
