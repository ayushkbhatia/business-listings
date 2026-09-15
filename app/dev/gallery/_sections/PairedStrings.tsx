import { PairedStrings } from "@/app/(admin)/admin/strings/paired/PairedStrings";
import { presentPaired, type PairedFilter } from "@/app/(admin)/admin/strings/paired/present";
import { en } from "@/lib/i18n/en";
import { pairingCount, PAIRED_STRINGS, resolveHalf, type EntryRow } from "@/lib/i18n/paired";
import type { HalfView, PairedBoard } from "@/lib/strings/service";
import { Section, States } from "../_kit";

/**
 * Board `12g-s` — the paired view in the states its spec names: as the code
 * ships it, with one missing twin written from the console, and with every twin
 * written so the progress panel becomes a receipt. Every specimen runs through
 * `presentPaired` and the registry's own resolver, rendered without landmarks.
 */

const NOW = new Date("2026-09-15T09:30:00Z");

function half(entry: (typeof PAIRED_STRINGS)[number], which: "goods" | "services", rows: readonly EntryRow[]): HalfView {
  const resolved = resolveHalf(entry, which, rows);
  const code = resolveHalf(entry, which, []);
  const row = rows.find((candidate) => candidate.key === entry.key && candidate.kind === which);
  return {
    ...resolved,
    codeState: code.state,
    codeTemplate: code.template,
    decidedAt: row ? new Date(row.updatedAt) : null,
    decidedBy: row ? "Rania Haddad" : null,
    version: row ? new Date(row.updatedAt).toISOString() : null,
  };
}

function board(rows: readonly EntryRow[]): PairedBoard {
  return {
    rows: PAIRED_STRINGS.map((entry) => ({
      key: entry.key,
      surfaces: entry.surfaces,
      params: entry.params,
      suppressible: entry.suppressible,
      goods: half(entry, "goods", rows),
      services: half(entry, "services", rows),
    })),
    count: pairingCount(rows),
    catalogueKeys: Object.keys(en).length,
  };
}

const ONE_WRITTEN: EntryRow[] = [
  {
    key: "overview.missed_body_one",
    kind: "services",
    state: "written",
    value: "One enquiry matched the services you offer this month after you reached the {cap}-enquiry limit on {plan}. It went to other firms.",
    updatedAt: NOW,
  },
];

const ALL_WRITTEN: EntryRow[] = [
  ...ONE_WRITTEN,
  {
    key: "overview.missed_body",
    kind: "services",
    state: "written",
    value: "{n} enquiries matched the services you offer this month after you reached the {cap}-enquiry limit on {plan}. They went to other firms.",
    updatedAt: NOW,
  },
];

function Specimen({ rows, filter = "all", templates = 13 }: { rows: readonly EntryRow[]; filter?: PairedFilter; templates?: number | null }) {
  return <PairedStrings view={presentPaired(board(rows), filter, templates)} canWrite landmark={false} />;
}

export function PairedStringsGallery() {
  return (
    <Section
      id="paired-strings"
      title="Paired strings"
      note="Board 12g-s. One key, two halves chosen by the business's kind; missing renders the goods words and is counted, suppressed removes the control; the count is a query."
    >
      <States label="As the code ships it · two twins not written, two suppressed" stack>
        <Specimen rows={[]} />
      </States>
      <States label="One twin written from the console · filtered to unpaired" stack>
        <Specimen rows={ONE_WRITTEN} filter="unpaired" />
      </States>
      <States label="Every twin written · the progress panel is a receipt" stack>
        <Specimen rows={ALL_WRITTEN} templates={0} />
      </States>
    </Section>
  );
}
