import type { Authority, Emirate } from "@/lib/db/generated/enums";

/**
 * Where each licensing authority sits — board `12a` B10.
 *
 * The sources panel is "the coverage map for supply and must not hide an empty
 * row". The board draws five rows with a posture on each — two monthly and
 * automatic, two manual, one not connected. **None of that posture exists in
 * this codebase**: no registry is connected, nothing fetches on a schedule, and
 * every run in the table arrived through the upload form. Rendering "Monthly ·
 * auto" beside DED would be the interface claiming an integration nobody
 * built.
 *
 * So the panel is derived from what is true: every authority the schema knows,
 * grouped by the emirate it licenses in, with the date of its last import or
 * the plain statement that there has not been one. The empty rows are the
 * point. Northern Emirates supply is thin because nothing has been imported
 * from there, and the panel says so in the same place it says what has.
 *
 * Pure, so the grouping is unit-tested without a database. Proper nouns, like
 * `lib/uae.ts`: an authority's code is its name in every locale.
 */

export const AUTHORITY_EMIRATE: Record<Authority, Emirate> = {
  DED: "dubai",
  ADDED: "abu_dhabi",
  SHJ: "sharjah",
  AJM: "ajman",
  UAQ: "umm_al_quwain",
  RAK: "ras_al_khaimah",
  FUJ: "fujairah",
  DMCC: "dubai",
  JAFZA: "dubai",
  SAIF: "sharjah",
  DAFZA: "dubai",
  DSO: "dubai",
  DIC: "dubai",
  DMC: "dubai",
  DHCC: "dubai",
  DWC: "dubai",
  DIFC: "dubai",
  ADGM: "abu_dhabi",
  KIZAD: "abu_dhabi",
  HFZA: "sharjah",
  RAKEZ: "ras_al_khaimah",
  UAQFTZ: "umm_al_quwain",
  FCC: "fujairah",
  MFZ: "dubai",
  DUQE: "dubai",
  IFZA: "dubai",
  SPCFZ: "sharjah",
  AFZ: "ajman",
  TWOFOUR54: "abu_dhabi",
  MASDAR: "abu_dhabi",
  ADAFZ: "abu_dhabi",
  DPC: "dubai",
  DTEC: "dubai",
  IMPZ: "dubai",
  JLT: "dubai",
  TECOM: "dubai",
};

/** The seven emirate departments, which every other authority sits beside. */
export const EMIRATE_DEPARTMENTS: ReadonlySet<Authority> = new Set([
  "DED",
  "ADDED",
  "SHJ",
  "AJM",
  "UAQ",
  "RAK",
  "FUJ",
]);

export interface SourceRun {
  source: string;
  createdAt: Date;
}

export interface EmirateCoverage {
  emirate: Emirate;
  /** Every authority licensing here, department first. */
  authorities: Authority[];
  /** Authorities with at least one run that was not discarded. */
  imported: Authority[];
  lastRunAt: Date | null;
  lastSource: Authority | null;
}

/**
 * One row per emirate, in the federal order `lib/uae.ts` uses.
 *
 * A discarded run is not supply: nothing from it ever reached the directory,
 * so it does not make an emirate "imported". The caller filters those out
 * before passing runs in, because the rule is about what the panel means.
 */
export function coverageByEmirate(
  emirates: readonly Emirate[],
  runs: readonly SourceRun[],
): EmirateCoverage[] {
  const latest = new Map<string, Date>();
  for (const run of runs) {
    const code = run.source.trim().toUpperCase();
    const seen = latest.get(code);
    if (!seen || run.createdAt > seen) latest.set(code, run.createdAt);
  }

  return emirates.map((emirate) => {
    const authorities = (Object.keys(AUTHORITY_EMIRATE) as Authority[])
      .filter((code) => AUTHORITY_EMIRATE[code] === emirate)
      .sort((a, b) => Number(EMIRATE_DEPARTMENTS.has(b)) - Number(EMIRATE_DEPARTMENTS.has(a)));
    const imported = authorities.filter((code) => latest.has(code));

    let lastRunAt: Date | null = null;
    let lastSource: Authority | null = null;
    for (const code of imported) {
      const at = latest.get(code)!;
      if (!lastRunAt || at > lastRunAt) {
        lastRunAt = at;
        lastSource = code;
      }
    }

    return { emirate, authorities, imported, lastRunAt, lastSource };
  });
}
