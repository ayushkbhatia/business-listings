import { formatCount, formatDate } from "@/lib/format";
import { pairedSurfaces, type TradeHalf } from "@/lib/i18n/paired";
import { t, type MessageKey } from "@/lib/i18n";
import type { HalfView, PairedBoard, PairedRow } from "@/lib/strings/service";

/**
 * Board `12g-s` — every word and number on the paired view, from the service.
 *
 * Pure, so the gallery renders the presenter over fixtures and the page renders
 * it over the database. The client table receives strings and plain data only.
 */

export const PAIRED_FILTERS = ["all", "unpaired", "suppressed", "staff"] as const;
export type PairedFilter = (typeof PAIRED_FILTERS)[number];

export function readPairedFilter(raw: string | string[] | undefined): PairedFilter {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (PAIRED_FILTERS as readonly string[]).includes(value ?? "") ? (value as PairedFilter) : "all";
}

export interface HalfCellView {
  tone: "written" | "missing" | "suppressed";
  /** The words, the "Not written" label, or the suppressed sentence. */
  text: string;
  /** A caption under it: who wrote it here and when, or that a gap falls back. */
  caption: string | null;
}

export interface HalfEditorView {
  half: TradeHalf;
  label: string;
  /** What the textarea opens on: the words it renders now, or empty when suppressed. */
  seed: string;
  /** The row's version, for the stale check. */
  version: string | null;
  canSuppress: boolean;
  canRestore: boolean;
  restoreNote: string | null;
  suppressedNow: boolean;
}

export interface PairedRowView {
  key: string;
  goods: HalfCellView;
  services: HalfCellView;
  boards: string;
  editLabel: string;
  params: readonly string[];
  editors: [HalfEditorView, HalfEditorView];
}

export interface PairedView {
  meta: string;
  intro: string;
  filters: { key: PairedFilter; label: string; href: string; selected: boolean }[];
  rows: PairedRowView[];
  empty: string | null;
  progress: {
    value: number;
    max: number;
    figure: string;
    label: string;
    lines: string[];
    complete: boolean;
  };
  d9: { title: string; body: string };
  suppressedNote: string;
  catalogueKeys: number;
  pairedTotal: number;
}

function mark(half: HalfView): string | null {
  if (half.source !== "staff" || !half.decidedAt) return null;
  const who = half.decidedBy ?? t("strings.paired.someone");
  const when = formatDate(half.decidedAt);
  return half.state === "suppressed"
    ? t("strings.paired.staff_mark_suppressed", { who, when })
    : t("strings.paired.staff_mark", { who, when });
}

function cell(half: HalfView): HalfCellView {
  if (half.state === "suppressed") return { tone: "suppressed", text: t("strings.paired.suppressed"), caption: mark(half) };
  if (half.state === "missing") return { tone: "missing", text: t("strings.paired.not_written"), caption: t("strings.paired.falls_back") };
  return { tone: "written", text: half.template ?? "", caption: mark(half) };
}

function restoreNote(half: HalfView): string | null {
  if (half.source !== "staff") return null;
  if (half.codeState === "missing") return t("strings.paired.editor.restore_to_missing");
  if (half.codeState === "suppressed") return t("strings.paired.editor.restore_to_suppressed");
  return t("strings.paired.editor.restore_to", { text: half.codeTemplate ?? "" });
}

function editor(row: PairedRow, which: TradeHalf): HalfEditorView {
  const half = row[which];
  return {
    half: which,
    label: t(`strings.paired.editor.half.${which}` as MessageKey),
    seed: half.state === "written" ? (half.template ?? "") : "",
    version: half.version,
    canSuppress: which === "services" && row.suppressible && half.state !== "suppressed",
    canRestore: half.source === "staff",
    restoreNote: restoreNote(half),
    suppressedNow: half.state === "suppressed",
  };
}

function matches(row: PairedRow, filter: PairedFilter): boolean {
  if (filter === "unpaired") return row.services.state === "missing";
  if (filter === "suppressed") return row.services.state === "suppressed";
  if (filter === "staff") return row.goods.source === "staff" || row.services.source === "staff";
  return true;
}

export function presentPaired(board: PairedBoard, filter: PairedFilter, templatesOwingTwin: number | null): PairedView {
  const { count } = board;
  const tally: Record<PairedFilter, number> = {
    all: board.rows.length,
    unpaired: board.rows.filter((row) => matches(row, "unpaired")).length,
    suppressed: board.rows.filter((row) => matches(row, "suppressed")).length,
    staff: board.rows.filter((row) => matches(row, "staff")).length,
  };
  const shown = board.rows.filter((row) => matches(row, filter));
  const complete = count.unpaired === 0;

  const lines: string[] = [];
  if (!complete) {
    lines.push(t("strings.paired.progress.gap", { count: count.unpaired, n: formatCount(count.unpaired) }));
  } else if (count.lastDecidedAt) {
    lines.push(t("strings.paired.progress.receipt", { total: formatCount(count.total), when: formatDate(count.lastDecidedAt) }));
  } else {
    lines.push(t("strings.paired.progress.receipt_code", { total: formatCount(count.total) }));
  }
  if (count.suppressed > 0) {
    lines.push(t("strings.paired.progress.suppressed", { count: count.suppressed, n: formatCount(count.suppressed) }));
  }
  if (templatesOwingTwin !== null) {
    lines.push(
      templatesOwingTwin > 0
        ? t("strings.paired.progress.templates", { count: templatesOwingTwin, n: formatCount(templatesOwingTwin) })
        : t("strings.paired.progress.templates_none"),
    );
  }

  const surfaces = pairedSurfaces().length;

  return {
    meta: t("strings.paired.meta", { count: surfaces, n: formatCount(surfaces) }),
    intro: t("strings.paired.intro"),
    filters: PAIRED_FILTERS.map((key) => ({
      key,
      label: t(`strings.paired.filter.${key}` as MessageKey, { n: formatCount(tally[key]) }),
      href: key === "all" ? "/admin/strings/paired" : `/admin/strings/paired?show=${key}`,
      selected: key === filter,
    })),
    rows: shown.map((row) => ({
      key: row.key,
      goods: cell(row.goods),
      services: cell(row.services),
      boards: row.surfaces.join(" / "),
      editLabel: t("strings.paired.edit", { key: row.key }),
      params: row.params,
      editors: [editor(row, "goods"), editor(row, "services")],
    })),
    empty: shown.length === 0 ? t("strings.paired.filter_empty") : null,
    progress: {
      value: count.paired,
      max: count.total,
      figure: t("strings.paired.progress.value", { paired: formatCount(count.paired), total: formatCount(count.total) }),
      label: t("strings.paired.progress.label"),
      lines,
      complete,
    },
    d9: { title: t("strings.paired.d9.title"), body: t("strings.paired.d9.body") },
    suppressedNote: t("strings.paired.suppressed_note"),
    catalogueKeys: board.catalogueKeys,
    pairedTotal: count.total,
  };
}
