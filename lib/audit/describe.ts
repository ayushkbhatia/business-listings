import { formatCount } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import { AUDIT_ACTIONS, BLAST_UNITS, RETIRED_AUDIT_ACTIONS, type BlastUnit } from "./types";

/**
 * Board 4i — the log reads as consequence, not clicks.
 *
 * *R. Haddad published spec template Valves & actuators v3 · affected 8,412
 * products.* Every part of that sentence is a fact the row holds: the actor's
 * name, a verb phrase for the action, the subject's own name, and the blast
 * radius where there is one. *User edited record* would pass a compliance
 * checkbox and be useless in the argument the log exists for.
 *
 * Pure: names arrive already resolved (`lib/audit/log.ts`), so the sentence a
 * row becomes is a unit test, and the CSV export and the screen cannot word the
 * same row two ways.
 */

const KNOWN = new Set<string>([...AUDIT_ACTIONS, ...RETIRED_AUDIT_ACTIONS]);

/** The verb phrase, or null for an action this code has no words for. */
export function actionPhrase(action: string): string | null {
  if (!KNOWN.has(action)) return null;
  return t(`audit.action.${action}` as MessageKey);
}

/**
 * The phrase as a label, for a filter menu and the export's label column.
 *
 * Capitalised from the phrase rather than written a second time, so the two
 * cannot drift. `toLocaleUpperCase` is a no-op in a script with no case, which
 * is the right behaviour for Arabic when it arrives.
 */
export function actionLabel(action: string): string {
  const phrase = actionPhrase(action);
  if (!phrase) return action;
  return phrase.charAt(0).toLocaleUpperCase() + phrase.slice(1);
}

export function isBlastUnit(value: string | null): value is BlastUnit {
  return value !== null && (BLAST_UNITS as readonly string[]).includes(value);
}

export function blastPhrase(count: number | null, unit: string | null): string | null {
  if (count === null || !isBlastUnit(unit)) return null;
  return t(`audit.blast.${unit}` as MessageKey, { count, n: formatCount(count) });
}

export interface DescribedEntry {
  /** "R. Haddad removed a review". */
  headline: string;
  /** The subject's own name, or null where it could not be resolved. */
  subjectName: string | null;
  /** "affected 8,412 products", or null. */
  blast: string | null;
  /** True when the action is one this code does not know — the raw key is shown. */
  unknownAction: boolean;
}

export function describeEntry(entry: {
  actorName: string;
  action: string;
  subjectName: string | null;
  blastRadius: number | null;
  blastUnit: string | null;
}): DescribedEntry {
  const phrase = actionPhrase(entry.action);
  return {
    headline: t("audit.line", {
      actor: entry.actorName,
      // An unknown action is shown as its key rather than hidden. The log is
      // append-only and outlives the code that wrote it; a row that rendered
      // blank would be a row nobody could ask about.
      action: phrase ?? entry.action,
    }),
    subjectName: entry.subjectName,
    blast: blastPhrase(entry.blastRadius, entry.blastUnit),
    unknownAction: phrase === null,
  };
}

export interface ChangeLine {
  field: string;
  from: string;
  to: string;
}

const MAX_CHANGE_LINES = 6;
const MAX_VALUE_LENGTH = 80;

function scalar(value: unknown): string | null {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH - 1)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

/**
 * The fields a decision changed, as `field: from → to`. Build plan 7.1.
 *
 * Only the fields whose values are scalars on both sides, and only where they
 * differ. `before` and `after` are whatever each service chose to record, and a
 * nested object rendered as JSON in a table is a blob nobody reads — the export
 * carries both sides whole for anybody who needs them. Capped, because a row is
 * a line in a log, not a document.
 */
export function describeChange(before: unknown, after: unknown): ChangeLine[] {
  const left = before && typeof before === "object" && !Array.isArray(before) ? (before as Record<string, unknown>) : {};
  const right = after && typeof after === "object" && !Array.isArray(after) ? (after as Record<string, unknown>) : {};
  const fields = [...new Set([...Object.keys(left), ...Object.keys(right)])];
  const lines: ChangeLine[] = [];
  for (const field of fields) {
    const from = scalar(left[field]);
    const to = scalar(right[field]);
    if (from === null || to === null || from === to) continue;
    // A field present on one side only is a value set or cleared, not changed
    // from nothing; it still reads correctly as "— → value".
    lines.push({ field, from, to });
    if (lines.length === MAX_CHANGE_LINES) break;
  }
  return lines;
}

/** `Business:clx123` → `["Business", "clx123"]`. Anything else is not a reference. */
export function parseSubject(subject: string): { type: string; id: string } | null {
  const at = subject.indexOf(":");
  if (at <= 0 || at === subject.length - 1) return null;
  return { type: subject.slice(0, at), id: subject.slice(at + 1) };
}
