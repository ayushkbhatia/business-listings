import { performance } from "node:perf_hooks";
import { prisma } from "../lib/db/client.js";
import {
  candidateBlockCap,
  loadCandidateListings,
  loadMatchListings,
  recordAsListing,
} from "../lib/dedupe/source.js";
import { bestMatch, buildMatchIndex } from "../lib/dedupe/match.js";
import { readBands } from "../lib/dedupe/source.js";

/**
 * What the dedupe matcher costs at 41,000 listings — task T4.4.
 *
 *   DATABASE_URL=…/bl_scale DIRECT_URL=…/bl_scale \
 *     NODE_OPTIONS=--conditions=react-server pnpm measure:ingest
 *
 * Two ways of answering one question — *which listings could this chunk of
 * records be duplicates of* — against the same corpus:
 *
 *   **A · the whole directory.** `loadMatchListings()`, every listing with all
 *   of its locations and each location's area, and an in-process blocking index
 *   over all of it. What the importer did, twice per run.
 *   **B · the candidates.** `loadCandidateListings()`, three indexed reads for
 *   the licences, phones and words this chunk actually carries, and the same
 *   index built over what comes back.
 *
 * It prints both, and the candidate count, because the number that matters is
 * not only the time: A holds the whole directory in a serverless function's
 * memory and grows with the directory, while B grows with the file.
 *
 * The records are drawn from the corpus itself and perturbed, so the chunk
 * looks like next month's export of companies already listed — the worst case
 * for B, since every record has a candidate to find.
 */

const CHUNK = 200;
const RUNS = 3;

function ms(from: number): number {
  return Math.round((performance.now() - from) * 10) / 10;
}

/** A chunk of records shaped like a register export of listed companies. */
async function sampleRecords(size: number) {
  const rows = await prisma.business.findMany({
    where: { publishedAt: { not: null }, suspendedAt: null },
    orderBy: { id: "asc" },
    take: size,
    select: {
      id: true,
      tradeName: true,
      licenceNumber: true,
      licenceAuthority: true,
      licenceActivity: true,
      locations: { orderBy: { id: "asc" }, take: 1, select: { emirate: true, areaId: true, phone: true } },
    },
  });

  return rows.map((row, index) =>
    recordAsListing({
      id: String(index + 1),
      // The branch spelling, which is the shape that made the matcher necessary.
      tradeName: row.tradeName,
      licenceNumber: `${row.licenceNumber}-0${String((index % 8) + 1)}`,
      authority: row.licenceAuthority,
      emirate: row.locations[0]?.emirate ?? null,
      areaId: row.locations[0]?.areaId ?? null,
      areaName: null,
      phone: row.locations[0]?.phone ?? null,
      activityKey: "",
    }),
  );
}

async function main(): Promise<void> {
  const [listings, products] = await Promise.all([
    prisma.business.count({ where: { publishedAt: { not: null }, suspendedAt: null } }),
    prisma.location.count(),
  ]);
  console.log(`\nThe corpus: ${listings.toLocaleString("en-GB")} public listings, ${products.toLocaleString("en-GB")} branches.\n`);

  const records = await sampleRecords(CHUNK);
  console.log(`One chunk: ${String(records.length)} records, each carrying a branch licence of a listed company.\n`);

  // A · the whole directory, which is what the importer used to do twice.
  const wholeTimes: number[] = [];
  let wholeSize = 0;
  let wholeDropped = 0;
  let wholeFailed: string | null = null;
  for (let run = 0; run < RUNS; run += 1) {
    const at = performance.now();
    try {
      const all = await loadMatchListings();
      const index = buildMatchIndex(all);
      wholeSize = index.blocks.size;
      wholeDropped = index.droppedKeys.length;
      wholeTimes.push(ms(at));
    } catch (error) {
      /*
         Not a timing result. At this size the whole-directory read does not
         finish slowly — it **throws**: the nested `locations` include makes
         Prisma issue one `IN (…)` over every business id, and Postgres's bound
         parameter limit is 65,535. So the read the importer did twice per run
         could never have run against the directory the importer exists to
         build, and nothing in the product would have said why.
      */
      wholeFailed = error instanceof Error ? `${(error as { code?: string }).code ?? ""} ${error.message.split("\n")[0] ?? ""}`.trim() : String(error);
      break;
    }
  }
  if (wholeFailed) {
    console.log(`A · whole directory   REFUSED — ${wholeFailed}`);
  } else {
    console.log(`A · whole directory   ${wholeTimes.map((t) => `${String(t)} ms`).join("  ")}`);
    console.log(`    ${wholeSize.toLocaleString("en-GB")} blocking keys built, every run; ${String(wholeDropped)} words dropped as too common.`);
  }

  // B · the candidates for this chunk.
  const cap = await candidateBlockCap();
  console.log(`\n    The block cap for this directory is ${String(cap)} listings a word (T4.5).`);
  const chunkTimes: number[] = [];
  let candidates = 0;
  let chunkKeys = 0;
  for (let run = 0; run < RUNS; run += 1) {
    const at = performance.now();
    const found = await loadCandidateListings(records, undefined, cap);
    const index = buildMatchIndex(found, cap);
    candidates = found.length;
    chunkKeys = index.blocks.size;
    chunkTimes.push(ms(at));
  }
  console.log(`\nB · this chunk's      ${chunkTimes.map((t) => `${String(t)} ms`).join("  ")}`);
  console.log(`    ${candidates.toLocaleString("en-GB")} candidate listings, ${chunkKeys.toLocaleString("en-GB")} blocking keys.`);

  /*
     Fast is not the point on its own. Every record here carries a branch
     licence of a company that is really in the directory, so the matcher should
     pair every one of them — and if the candidate query narrowed too far, this
     is the line that says so.
  */
  const found = await loadCandidateListings(records, undefined, cap);
  const index = buildMatchIndex(found, cap);
  const bands = await readBands();
  let paired = 0;
  for (const record of records) {
    if (bestMatch(record, index, bands).match) paired += 1;
  }
  console.log(
    `\nPaired ${String(paired)} of ${String(records.length)} records whose licence is a branch of a listed company.`,
  );

  const chunk = Math.min(...chunkTimes);
  const chunks = Math.ceil(41_000 / CHUNK);
  console.log(
    `\nA 41,000-row run costs B ${String(Math.round(chunks * chunk))} ms across ${String(chunks)} chunks,` +
      ` and never holds more than ${candidates.toLocaleString("en-GB")} listings in memory.`,
  );
  if (wholeFailed) {
    console.log(`A does not cost anything, because at this size it does not run.\n`);
  } else {
    console.log(`A costs ${String(Math.min(...wholeTimes))} ms twice, plus the whole directory in memory each time.\n`);
  }

  await prisma.$disconnect();
}

await main();
