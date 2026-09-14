/**
 * The two lines of versions behind one template, and which of them a message
 * uses. Board 12g `B4` and `B5`.
 *
 * An event on a channel — `enquiry_received` on WhatsApp — carries two lines:
 *
 *   - the **primary** body, whose rows are `goods` or `neutral`;
 *   - its **services** twin, whose rows are `services`.
 *
 * Versions count within a line, so a twin's first version is v1 however many
 * the goods body has had. Inside a line there is no draft flag: *"a draft is
 * just the highest version that is not live"*, and the live one is the highest
 * version whose status says so. That is what lets v3 send while v4 waits on
 * Meta — both rows exist, and only one is live.
 *
 * Pure. The database reads and the audited writes are `templates.ts`; the send
 * path is `service.ts`. Both ask this file what a set of rows means, so the
 * console and the carrier cannot disagree about which body is live.
 */

export type TemplateKind = "neutral" | "goods" | "services";
export type TemplateStatus = "draft" | "pending_meta" | "live" | "retired" | "rejected" | "superseded";
export type Line = "primary" | "services";

export interface VersionRow {
  id: string;
  kind: TemplateKind;
  version: number;
  status: TemplateStatus;
}

export function lineOf(kind: TemplateKind): Line {
  return kind === "services" ? "services" : "primary";
}

function inLine<T extends VersionRow>(rows: readonly T[], line: Line): T[] {
  return rows.filter((row) => lineOf(row.kind) === line).sort((a, b) => b.version - a.version);
}

/** The newest version in a line, whatever its status. Null when the line is empty. */
export function headOf<T extends VersionRow>(rows: readonly T[], line: Line): T | null {
  return inLine(rows, line)[0] ?? null;
}

/** The version that sends. Highest live version, so a stray second live row cannot win on insertion order. */
export function liveOf<T extends VersionRow>(rows: readonly T[], line: Line): T | null {
  return inLine(rows, line).find((row) => row.status === "live") ?? null;
}

/** The version with Meta. At most one survives a save (`Q1`), and the newest wins if history says otherwise. */
export function pendingOf<T extends VersionRow>(rows: readonly T[], line: Line): T | null {
  return inLine(rows, line).find((row) => row.status === "pending_meta") ?? null;
}

/** The newest version Meta refused, if nothing newer has been saved since. */
export function rejectedOf<T extends VersionRow>(rows: readonly T[], line: Line): T | null {
  const head = headOf(rows, line);
  return head && head.status === "rejected" ? head : null;
}

/** The next version number in a line. */
export function nextVersion(rows: readonly VersionRow[], line: Line): number {
  return (headOf(rows, line)?.version ?? 0) + 1;
}

/**
 * Whether the primary body speaks in trade terms, read from the version that
 * decides it: the live one, or the newest where nothing is live.
 */
export function primaryKind(rows: readonly VersionRow[]): "goods" | "neutral" | null {
  const decider = liveOf(rows, "primary") ?? headOf(rows, "primary");
  if (!decider) return null;
  return decider.kind === "neutral" ? "neutral" : "goods";
}

/**
 * The `SERVICES TWIN` column. `B5`: *no trade-kind language* and *not written*
 * are different states and must read differently.
 *
 *   - `neutral`     — the body says nothing about trade; no twin is owed.
 *   - `not_written` — a goods body with no services version that could send.
 *   - `written`     — a services version is live.
 *   - `in_review`   — the twin is with Meta and nothing has been approved.
 *   - `rejected`    — Meta refused the newest twin and no earlier one is live.
 *   - `draft`       — a twin exists and is not live, off WhatsApp.
 *   - `no_body`     — there is no primary body at all, so there is nothing to twin.
 */
export type TwinState = "neutral" | "not_written" | "written" | "in_review" | "rejected" | "draft" | "no_body";

export function twinState(rows: readonly VersionRow[]): TwinState {
  const kind = primaryKind(rows);
  if (kind === null) return "no_body";
  if (kind === "neutral") return "neutral";
  if (liveOf(rows, "services")) return "written";
  if (pendingOf(rows, "services")) return "in_review";
  if (rejectedOf(rows, "services")) return "rejected";
  const head = headOf(rows, "services");
  if (head && head.status === "draft") return "draft";
  return "not_written";
}

/** Does this row owe a twin that does not yet send? The 27 of the handoff's 34, counted rather than typed. */
export function owesTwin(state: TwinState): boolean {
  return state !== "neutral" && state !== "written" && state !== "no_body";
}

/**
 * The `STATE` column, for the primary body.
 *
 *   - `live`       — something sends. A pending or rejected newer version does not change this.
 *   - `in_review`  — nothing sends yet, and a version is with Meta.
 *   - `rejected`   — nothing sends, and Meta refused the newest version.
 *   - `draft`      — nothing sends, and a version exists that nobody has published.
 *   - `retired`    — every version has been retired; the event sends nothing on this channel.
 *   - `missing`    — no row at all, though something fires the event here (see `templates.ts`).
 */
export type PrimaryState = "live" | "in_review" | "rejected" | "draft" | "retired" | "missing";

export function primaryState(rows: readonly VersionRow[]): PrimaryState {
  if (!headOf(rows, "primary")) return "missing";
  if (liveOf(rows, "primary")) return "live";
  if (pendingOf(rows, "primary")) return "in_review";
  if (rejectedOf(rows, "primary")) return "rejected";
  if (inLine(rows, "primary").some((row) => row.status === "draft")) return "draft";
  return "retired";
}

/**
 * Which live body a message uses. The resolver `B5` implies and nothing wrote.
 *
 * A services brief takes the live services twin where one exists. Otherwise it
 * takes the primary body — *"the goods body still sends"* — and says it fell
 * back, which the delivery row records as `trade_kind = services` against a
 * `goods` template: the measured cost of the twin not being written.
 *
 * A goods enquiry, and anything with no trade kind, never takes a twin.
 */
export function pickLive<T extends VersionRow>(
  rows: readonly T[],
  tradeKind: "goods" | "services" | null,
): { row: T; fellBack: boolean } | null {
  const primary = liveOf(rows, "primary");
  if (tradeKind === "services") {
    const twin = liveOf(rows, "services");
    if (twin && (!primary || primary.kind !== "neutral")) return { row: twin, fellBack: false };
    if (primary) return { row: primary, fellBack: primary.kind === "goods" };
    return null;
  }
  return primary ? { row: primary, fellBack: false } : null;
}
