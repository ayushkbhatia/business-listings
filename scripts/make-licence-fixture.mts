/**
 * A licence-authority export, generated.
 *
 * Criterion 1 asks for an import run of 8,000 records. The seed has 40
 * businesses and a name pool that caps at 40, so nothing in the repo produced
 * them — and 8,000 is not decoration: it is the difference between an importer
 * that works and one that falls over, and it is the only way the dedupe bands
 * in step 2b have anything to band.
 *
 * Deterministic. The same seed gives the same file, so a count asserted in a
 * test stays asserted. Written to `tmp/` and gitignored: it is 8,000 rows of
 * plausible company names and generating it takes under a second, which is
 * cheaper than carrying it in the repository.
 *
 *   pnpm fixture:licences            8,000 rows to tmp/licences.csv
 *   pnpm fixture:licences 200 out.csv
 *
 * Every name here is invented. The shapes are real: the authorities, the
 * emirates, the areas and the activity phrasing all come from the same tables
 * the seed uses, and the distribution of bad rows is what an authority export
 * actually looks like — mostly fine, with a tail of blanks, expiries and
 * businesses that are not suppliers.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { AREAS, AUTHORITY_BY_EMIRATE, NAME_PREFIX, NAME_SUFFIX } from "../prisma/seed-data.mjs";

/** Same generator the seed uses, so the two behave the same way. */
function mulberry32(seed: number) {
  let state = seed;
  return () => {
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    state = (state + 0x6d2b79f5) | 0;
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry32(0x11cef1e);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));

/**
 * Activity phrasing, per category, as a licence actually words it.
 *
 * A licence activity is a legal phrase rather than a description — "Trading in
 * Valves & Pipe Fittings", not "we sell valves" — and the classifier reads the
 * nouns out of it. Getting this wrong would make the fixture easier to
 * categorise than the real thing.
 */
const ACTIVITIES: readonly string[] = [
  "Trading in Valves & Pipe Fittings",
  "Valves & Flanges Trading",
  "GI Pipe and Tube Trading",
  "Seamless Pipe & Tubing Trading",
  "Air Conditioning Equipment Trading",
  "Ventilation & Duct Works Materials Trading",
  "Electrical Cable & Accessories Trading",
  "Switchgear & Busbar Trading",
  "Safety Equipment & Protective Clothing Trading",
  "Fire Extinguisher Trading",
  "Packaging Materials Trading",
  "Carton & Pallet Trading",
];

/** Licences that name a trade we do not serve. A real export is full of them. */
const OUT_OF_SCOPE_ACTIVITIES: readonly string[] = [
  "Restaurant & Cafeteria",
  "Ladies Beauty Salon",
  "Gents Barber Shop",
  "Laundry Services",
  "Tailoring Workshop",
  "Travel Agency",
  "Real Estate Broker",
  "Legal Consultancy",
  "Car Rental",
  "Money Exchange",
];

/** Activities that are plainly in trade and name no specific category. */
const UNCATEGORISABLE: readonly string[] = [
  "General Trading",
  "Building Materials Trading",
  "Trading in Industrial Equipment",
  "Hardware & Tools Trading",
  "Marine Equipment Trading",
];

const OUTSIDE_UAE = ["Doha", "Riyadh", "Manama", "Kuwait City", "Muscat"];
const UNREADABLE = ["", " ", "-", "--", "N/A", "n/a", "NIL", "unknown", "."];

const EMIRATES = Object.keys(AUTHORITY_BY_EMIRATE) as (keyof typeof AUTHORITY_BY_EMIRATE)[];

function csvCell(value: string): string {
  // Quote anything that would otherwise break a row. Trade names carry commas
  // and the odd quotation mark, and an importer that trips on them is an
  // importer that silently drops real companies.
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function isoDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

interface Row {
  tradeName: string;
  licenceNumber: string;
  authority: string;
  expiry: string;
  emirate: string;
  area: string;
  activity: string;
  phone: string;
}

function makeRow(index: number): Row {
  const emirate = pick(EMIRATES);
  const authority = pick(AUTHORITY_BY_EMIRATE[emirate]);
  const areasHere = AREAS.filter((a) => a.emirate === emirate);
  const area = areasHere.length > 0 ? pick(areasHere).name : "Industrial Area";

  const name = `${pick(NAME_PREFIX)} ${pick(NAME_SUFFIX)}`;
  const licenceNumber = `${authority}-${int(100000, 999999)}`;
  const phone = `0${pick(["4", "6", "2", "9", "7"])}${int(2000000, 8999999)}`;

  /*
   * The distribution. Roughly one row in twelve is a rejection and one in six
   * needs a person — which is close to what a real authority export looks like
   * once it has been through a spreadsheet and back.
   */
  const roll = rnd();

  if (roll < 0.03) {
    return {
      tradeName: pick(UNREADABLE),
      licenceNumber,
      authority,
      expiry: isoDay(int(30, 700)),
      emirate,
      area,
      activity: pick(ACTIVITIES),
      phone,
    };
  }

  if (roll < 0.055) {
    // Expired well beyond the 24-month floor.
    return {
      tradeName: name,
      licenceNumber,
      authority,
      expiry: isoDay(-int(760, 2000)),
      emirate,
      area,
      activity: pick(ACTIVITIES),
      phone,
    };
  }

  if (roll < 0.075) {
    return {
      tradeName: name,
      licenceNumber,
      authority,
      expiry: isoDay(int(30, 700)),
      emirate: pick(OUTSIDE_UAE),
      area,
      activity: pick(ACTIVITIES),
      phone,
    };
  }

  if (roll < 0.1) {
    return {
      tradeName: name,
      licenceNumber,
      authority,
      expiry: isoDay(int(30, 700)),
      emirate,
      area,
      activity: pick(OUT_OF_SCOPE_ACTIVITIES),
      phone,
    };
  }

  if (roll < 0.27) {
    // In trade, and the activity names no category. This is the queue.
    return {
      tradeName: name,
      licenceNumber,
      authority,
      expiry: isoDay(int(30, 700)),
      emirate,
      area,
      activity: pick(UNCATEGORISABLE),
      phone,
    };
  }

  // Recently expired, and kept: a late renewal is ordinary here.
  const expiry = rnd() < 0.08 ? isoDay(-int(1, 400)) : isoDay(int(30, 900));

  return {
    tradeName: index % 997 === 0 ? `${name} ` : name,
    licenceNumber,
    authority,
    expiry,
    emirate,
    area,
    activity: pick(ACTIVITIES),
    phone,
  };
}

const HEADER = [
  "Trade Name",
  "Licence No",
  "Authority",
  "Expiry Date",
  "Emirate",
  "Area",
  "Activity",
  "Phone",
] as const;

function main() {
  const count = Number(process.argv[2] ?? 8000);
  const out = process.argv[3] ?? "tmp/licences.csv";

  if (!Number.isInteger(count) || count < 1) {
    console.error("usage: pnpm fixture:licences [count] [path]");
    process.exit(1);
  }

  const lines: string[] = [HEADER.join(",")];
  for (let i = 0; i < count; i += 1) {
    const row = makeRow(i);
    lines.push(
      [
        row.tradeName,
        row.licenceNumber,
        row.authority,
        row.expiry,
        row.emirate,
        row.area,
        row.activity,
        row.phone,
      ]
        .map(csvCell)
        .join(","),
    );
  }

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${lines.join("\n")}\n`, "utf8");
  console.log(`${count} licence records → ${out}`);
}

main();
