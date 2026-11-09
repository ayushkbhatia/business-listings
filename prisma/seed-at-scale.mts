import { createHash } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../lib/db/generated/client.js";
import { assertLocalTarget, NonLocalTargetError } from "../lib/db/target.js";

/**
 * Task T2.1 — the directory at 41,000 listings, so M1 can be measured.
 *
 * Every claim in milestone M1 of `docs/production-build-plan.md` is a claim
 * about scale: that ranking pages in SQL rather than in Node, that the sitemap
 * splits, that a category shelf renders inside its budget. None of them can be
 * checked against the 430-row curated seed, and none of them can be checked
 * against production either, because production is where the 41,000 real
 * records are going to land and a measurement run there would be a measurement
 * taken after the fact.
 *
 * So this builds a directory of the right size and the right *shape*. Size
 * alone proves nothing: 41,000 identical rows would make every ranking
 * comparison a tie and every page of results the same page. What matters is the
 * distribution — how many are claimed, how many verified, how many carry a
 * response time, how the categories and emirates skew — because that is what
 * decides how many rows a query actually has to sort.
 *
 * ## What it does not touch
 *
 * It **adds**; it never truncates. Every row it writes is marked: a `scale-`
 * slug, a `SCALE-` licence number, `source = licence_import`. `--wipe` removes
 * exactly those and nothing else, so the curated seed — the fixtures the
 * integration and acceptance suites count — survives a run and a wipe.
 *
 * That does not make it safe to run against a database those suites use. Forty
 * thousand extra listings break every count assertion in the product: the
 * homepage's "218 suppliers in Al Quoz", board 4f's header, 6f's matrix, the
 * sitemap's page count. **Use a database of its own**, which is also why the
 * loopback guard below is not negotiable.
 *
 * ## Determinism
 *
 * One seeded PRNG, so two runs of the same size produce the same directory and
 * two measurements are comparable. `--seed` changes it for anybody who wants a
 * different draw.
 *
 * Usage:
 *
 *   pnpm db:seed:scale                  # 41,000, the production target
 *   pnpm db:seed:scale -- --count 5000  # a smaller run, for a laptop
 *   pnpm db:seed:scale -- --wipe        # remove only what this wrote
 */

// `DIRECT_URL` first, as the seed does: tens of thousands of inserts through a
// transaction pooler is the wrong instrument.
const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  }),
});

/** How many listings production is about to hold. The default for a reason. */
const TARGET = 41_000;

/** Rows per `createMany`. Large enough to be fast, small enough to not blow up the statement. */
const CHUNK = 1_000;

const SLUG_PREFIX = "scale-";
const LICENCE_PREFIX = "SCALE-";

/* ── The draw ─────────────────────────────────────────────────────────────── */

/**
 * A small deterministic PRNG — mulberry32.
 *
 * `Math.random()` would make every run a different directory, and a
 * measurement you cannot repeat is an anecdote. Seeded from a string so the
 * seed can be written down in a commit message.
 */
function rng(seed: string): () => number {
  let a = Number.parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One pick from a weighted list. The weights are shares, not percentages. */
function weighted<T>(next: () => number, entries: readonly [T, number][]): T {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = next() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return entries[entries.length - 1]![0];
}

const int = (next: () => number, min: number, max: number) =>
  min + Math.floor(next() * (max - min + 1));

/**
 * Where the listings are, as the UAE's trade registry actually skews.
 *
 * Dubai and Abu Dhabi hold most of it. A uniform spread across seven emirates
 * would make every emirate filter return the same number of rows, which is the
 * one thing a scale fixture must not do: the filters that matter are the ones
 * that return 11,000 rows, not the ones that return 6,000.
 */
const EMIRATE_SHARE: readonly [string, number][] = [
  ["dubai", 55],
  ["abu_dhabi", 18],
  ["sharjah", 12],
  ["ajman", 5],
  ["ras_al_khaimah", 4],
  ["fujairah", 3],
  ["umm_al_quwain", 3],
];

/** The licensing authority that goes with an emirate, for the mainland case. */
const AUTHORITY_OF: Record<string, string> = {
  dubai: "DED",
  abu_dhabi: "ADDED",
  sharjah: "SHJ",
  ajman: "AJM",
  ras_al_khaimah: "RAK",
  fujairah: "FUJ",
  umm_al_quwain: "UAQ",
};

/**
 * Claimed, and then verified, in the proportions a cold directory has.
 *
 * Most of an imported directory is unclaimed — that is the whole premise of
 * board 10g — and the ranking has to be measured against a corpus where most
 * rows score low on everything a seller fills in. A fixture where everybody is
 * claimed and verified would hide exactly the case that hurts: ten thousand
 * rows tied at the bottom, all of which still have to be sorted.
 */
const CLAIM_SHARE: readonly ["unclaimed" | "claimed", number][] = [
  ["unclaimed", 72],
  ["claimed", 28],
];

/** A word bag, so trigram search has something to hit and relevance varies. */
const WORDS = [
  "hydraulic",
  "pneumatic",
  "valves",
  "fittings",
  "bearings",
  "stainless",
  "galvanised",
  "chilled water",
  "fire fighting",
  "ducting",
  "insulation",
  "switchgear",
  "cable tray",
  "scaffolding",
  "formwork",
  "safety",
  "ppe",
  "welding",
  "fasteners",
  "gaskets",
  "couplings",
  "flanges",
  "compressors",
  "pumps",
  "generators",
  "transformers",
  "audit",
  "assurance",
  "vat",
  "corporate tax",
  "payroll",
  "pro services",
  "facilities management",
  "hvac maintenance",
  "fit out",
  "surveying",
  "testing",
  "calibration",
  "logistics",
  "clearance",
];

const SUFFIXES = ["LLC", "FZE", "FZCO", "Trading LLC", "General Trading LLC", "Industries LLC"];
const FIRST = [
  "Al Marwan",
  "Gulf Cool",
  "Desert Line",
  "Emirates Pioneer",
  "Falcon Crest",
  "Arabian Gate",
  "Pearl Coast",
  "Northgate",
  "Summit Edge",
  "Delta Core",
  "Mezzan",
  "Rashid",
  "Zayed Star",
  "Oasis Point",
  "Trident",
  "Meridian",
  "Horizon Peak",
  "Blue Ridge",
  "Silver Sands",
  "Tawazun",
];

/* ── The run ──────────────────────────────────────────────────────────────── */

interface Args {
  count: number;
  seed: string;
  wipe: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const at = (flag: string) => {
    const i = argv.indexOf(flag);
    return i === -1 ? null : (argv[i + 1] ?? null);
  };
  const count = at("--count");
  return {
    count: count === null ? TARGET : Number.parseInt(count, 10),
    seed: at("--seed") ?? "s2",
    wipe: argv.includes("--wipe"),
  };
}

/** Only what this script wrote. Keyed on the slug prefix, which nothing else uses. */
async function wipe(): Promise<void> {
  const where: Prisma.BusinessWhereInput = { slug: { startsWith: SLUG_PREFIX } };
  const doomed = await prisma.business.count({ where });
  if (doomed === 0) {
    console.log("nothing to wipe: no listing carries the scale prefix.");
    return;
  }
  // Products and locations cascade from the business.
  const { count } = await prisma.business.deleteMany({ where });
  console.log(`wiped ${count.toLocaleString()} scale listings and everything cascading from them.`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  /*
     The guard, and the reason it is here rather than in the caller: this writes
     tens of thousands of rows that look like real listings. On production they
     would be indistinguishable from the import this project exists to do, and
     there is no undo that does not also take real rows with it.
  */
  const target = assertLocalTarget(
    args.wipe
      ? "delete every listing carrying the scale prefix"
      : `insert ${args.count.toLocaleString()} synthetic listings`,
  );
  console.log(`→ ${target.description}`);

  if (args.wipe) {
    await wipe();
    return;
  }

  if (!Number.isFinite(args.count) || args.count <= 0) {
    throw new Error(`--count must be a positive number; got ${String(args.count)}`);
  }

  /*
     The taxonomy and the areas are read, never created. A scale fixture that
     invented its own categories would rank against a tree the product does not
     have, and the publish floors, the facet rail and the matrix all read the
     real one.
  */
  const [leaves, areas, plans, existing] = await Promise.all([
    prisma.category.findMany({
      where: { children: { none: {} } },
      orderBy: [{ slug: "asc" }, { id: "asc" }],
      select: { id: true, tradeKind: true, parentId: true },
    }),
    prisma.area.findMany({
      orderBy: [{ slug: "asc" }, { id: "asc" }],
      select: { id: true, emirate: true, lat: true, lng: true },
    }),
    prisma.plan.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true } }),
    prisma.business.count({ where: { slug: { startsWith: SLUG_PREFIX } } }),
  ]);

  if (leaves.length === 0) throw new Error("No leaf categories. Run `pnpm db:seed` first.");
  if (areas.length === 0) throw new Error("No areas. Run `pnpm db:seed` first.");

  const areasByEmirate = new Map<string, typeof areas>();
  for (const area of areas) {
    const list = areasByEmirate.get(area.emirate) ?? [];
    list.push(area);
    areasByEmirate.set(area.emirate, list);
  }
  const emirates = EMIRATE_SHARE.filter(([emirate]) => areasByEmirate.has(emirate));
  if (emirates.length === 0) throw new Error("No area sits in any emirate this script knows.");

  const planIds = new Set(plans.map((plan) => plan.id));
  const planShare: readonly [string, number][] = (
    [
      ["free", 78],
      ["basic", 16],
      ["pro", 6],
    ] as [string, number][]
  ).filter(([id]) => planIds.has(id));

  const next = rng(args.seed);
  const now = Date.now();
  let written = 0;
  let products = 0;
  let locations = 0;

  console.log(
    `→ ${args.count.toLocaleString()} listings across ${leaves.length} leaf categories and ` +
      `${areas.length} areas, seed "${args.seed}"${existing > 0 ? `, on top of ${existing.toLocaleString()} already present` : ""}`,
  );

  for (let from = 0; from < args.count; from += CHUNK) {
    const size = Math.min(CHUNK, args.count - from);
    const businessRows: Prisma.BusinessCreateManyInput[] = [];
    const locationRows: Prisma.LocationCreateManyInput[] = [];
    const productRows: Prisma.ProductCreateManyInput[] = [];

    for (let i = 0; i < size; i += 1) {
      const n = existing + from + i + 1;
      const id = `scl_${n.toString(36).padStart(7, "0")}`;
      const emirate = weighted(next, emirates);
      const pool = areasByEmirate.get(emirate)!;
      const area = pool[int(next, 0, pool.length - 1)]!;
      const leaf = leaves[int(next, 0, leaves.length - 1)]!;
      const claimed = weighted(next, CLAIM_SHARE) === "claimed";

      /*
         Tier, honestly distributed. An unclaimed record can hold tier 2 — the
         licence was checked against the register without anybody claiming it,
         which is 10g's own case — and most hold nothing at all.
      */
      const tier = claimed
        ? weighted(next, [
            [1, 55],
            [2, 45],
          ])
        : weighted(next, [
            [0, 88],
            [1, 6],
            [2, 6],
          ]);

      // One draw, three columns — see the note on `responseTimeMedianMs`.
      const measured = claimed && next() < 0.55;

      const words = [
        WORDS[int(next, 0, WORDS.length - 1)]!,
        WORDS[int(next, 0, WORDS.length - 1)]!,
      ];
      const name = `${FIRST[int(next, 0, FIRST.length - 1)]!} ${words[0]!.replace(/\b\w/g, (c) => c.toUpperCase())}`;
      const tradeName = `${name} ${SUFFIXES[int(next, 0, SUFFIXES.length - 1)]!}`;

      /*
         Spread across three years, one row at a time.

         `createMany` leaves every row on the same `created_at` when the column
         defaults, and an ordered read that ties on it is a read Postgres
         answers differently each time — the project has a whole scan for this
         (`check:ordering`). A scale fixture whose rows all share one timestamp
         would hide exactly the paging defect this milestone is about.
      */
      const createdAt = new Date(now - int(next, 0, 1095) * 86_400_000 - int(next, 0, 86_399_000));

      // 94% live. The rest are drafts and suspensions, which every public
      // query has to filter out — at this size that filter is the index test.
      const published = next() < 0.94;
      const suspended = published && next() < 0.004;

      businessRows.push({
        id,
        tradeName,
        displayName: claimed ? name : tradeName,
        slug: `${SLUG_PREFIX}${n.toString(36)}-${words[0]!.replace(/[^a-z]+/g, "-")}`,
        licenceNumber: `${LICENCE_PREFIX}${(100000 + n).toString()}`,
        licenceAuthority: (AUTHORITY_OF[emirate] ?? "DED") as never,
        // A fifth are lapsed, which is what the expiry sweep and the badge
        // rules have to be measured against.
        licenceExpiry: new Date(now + (next() < 0.2 ? -1 : 1) * int(next, 1, 500) * 86_400_000),
        licenceActivity: words.join(", "),
        sellsKind: (leaf.tradeKind ?? "goods") as never,
        description: claimed ? `Supplier of ${words.join(" and ")} in the UAE.` : null,
        searchText: `${tradeName} ${words.join(" ")}`,
        verificationTier: tier,
        verifiedAt: tier >= 2 ? new Date(now - int(next, 1, 300) * 86_400_000) : null,
        claimStatus: claimed ? "claimed" : "unclaimed",
        planId: claimed ? weighted(next, planShare) : null,
        primaryCategoryId: leaf.id,
        source: "licence_import",
        publishedAt: published ? createdAt : null,
        suspendedAt: suspended ? new Date(now - int(next, 1, 90) * 86_400_000) : null,
        createdAt,
        /*
           Unmeasured for most of them, and that is the point: `scoreResponseTime`
           scores null at half credit, so a corpus where everybody has a median
           would never exercise the unknown branch that most of the directory
           actually sits in.

           One draw for all three, because `business_reply_rate_measured` is a
           CHECK: a rate and a sample are set or cleared together, since "a rate
           with no sample behind it is a number nobody can check". Drawing them
           separately is how the first run of this script failed, and the
           constraint was right to catch it.
        */
        responseTimeMedianMs: measured ? int(next, 20, 7200) * 60_000 : null,
        replyRate: measured ? Number((0.3 + next() * 0.7).toFixed(2)) : null,
        replySample: measured ? int(next, 3, 90) : null,
        specCompleteness: claimed && next() < 0.7 ? Number(next().toFixed(2)) : null,
        profileStrength: claimed ? int(next, 10, 95) : null,
        reviewCount: 0,
      });

      /*
         One branch each, and a quarter of them pinned.

         `measurable()` only counts an exact pin, so the distance weight has to
         be measured against a directory where most rows have no usable
         position — which is the state production is in (116 of 118 pins sat on
         their area's centroid).
      */
      /*
         One boolean, and it requires the area to have a centroid.

         `location_precision_matches_pin` is a CHECK: lat, lng and
         `geocode_precision` are all set or all null. Drawing the pin and the
         precision separately put `exact` on a row with no coordinates whenever
         the area had none — the second constraint this script tripped, and the
         second one that was right to.
      */
      const pinned = next() < 0.25 && area.lat !== null && area.lng !== null;
      locationRows.push({
        id: `scll_${n.toString(36).padStart(7, "0")}`,
        businessId: id,
        type: "head_office",
        emirate: emirate as never,
        areaId: area.id,
        addressLine: `Unit ${int(next, 1, 90)}, Street ${int(next, 1, 40)}`,
        lat: pinned ? area.lat! + (next() - 0.5) * 0.04 : null,
        lng: pinned ? area.lng! + (next() - 0.5) * 0.04 : null,
        geocodePrecision: pinned ? "exact" : null,
        published: published,
      });

      // Only a claimed listing has a catalogue, and most catalogues are small.
      if (claimed && leaf.tradeKind !== "services") {
        const count = weighted(next, [
          [0, 30],
          [int(next, 1, 9), 45],
          [int(next, 10, 40), 20],
          [int(next, 41, 150), 5],
        ]);
        for (let p = 0; p < count; p += 1) {
          const word = WORDS[int(next, 0, WORDS.length - 1)]!;
          productRows.push({
            id: `sclp_${n.toString(36)}_${p.toString(36)}`,
            businessId: id,
            name: `${word.replace(/\b\w/g, (c) => c.toUpperCase())} ${int(next, 10, 900)}`,
            slug: `${word.replace(/[^a-z]+/g, "-")}-${int(next, 10, 900)}-${p}`,
            categoryId: leaf.id,
            availability: weighted(next, [
              ["in_stock", 60],
              ["made_to_order", 25],
              ["indent", 10],
              ["out_of_stock", 5],
            ]) as never,
            specValues: next() < 0.6 ? { application: word } : {},
            searchText: `${word} ${tradeName}`,
            status: published ? "live" : "draft",
            createdAt,
          });
        }
      }
    }

    /*
       Three statements, not one transaction per row. `createMany` with
       `skipDuplicates` so a re-run on top of a partial run completes instead of
       failing on the first id it has already written.
    */
    await prisma.business.createMany({ data: businessRows, skipDuplicates: true });
    await prisma.location.createMany({ data: locationRows, skipDuplicates: true });
    if (productRows.length > 0) {
      await prisma.product.createMany({ data: productRows, skipDuplicates: true });
    }

    written += businessRows.length;
    locations += locationRows.length;
    products += productRows.length;
    if (written % 5_000 === 0 || written === args.count) {
      console.log(`   ${written.toLocaleString()} / ${args.count.toLocaleString()}`);
    }
  }

  /*
     Counted over every scale row, not this run's — a second run adds to the
     first, and the number that matters to a measurement is the size of the
     corpus the queries will see.
  */
  const [corpus, live] = await Promise.all([
    prisma.business.count({ where: { slug: { startsWith: SLUG_PREFIX } } }),
    prisma.business.count({
      where: { slug: { startsWith: SLUG_PREFIX }, publishedAt: { not: null }, suspendedAt: null },
    }),
  ]);

  console.log(
    `\n✓ wrote ${written.toLocaleString()} listings, ${locations.toLocaleString()} branches, ` +
      `${products.toLocaleString()} products.\n` +
      `  the scale corpus is now ${corpus.toLocaleString()} listings, ${live.toLocaleString()} of them public.\n\n` +
      `  Measure against this, do not test against it: forty thousand extra rows\n` +
      `  break every count the curated seed's tests assert. Remove them with\n` +
      `  \`pnpm db:seed:scale -- --wipe\`.`,
  );
}

main()
  .catch((error: unknown) => {
    if (error instanceof NonLocalTargetError) {
      console.error(`\n${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
