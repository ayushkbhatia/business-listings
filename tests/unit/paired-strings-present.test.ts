import { describe, expect, it } from "vitest";
import { presentPaired, readPairedFilter } from "@/app/(admin)/admin/strings/paired/present";
import { en } from "@/lib/i18n/en";
import { pairingCount, PAIRED_STRINGS, pairedSurfaces, resolveHalf, type EntryRow } from "@/lib/i18n/paired";
import type { HalfView, PairedBoard } from "@/lib/strings/service";

/**
 * Board `12g-s` — the paired view's words and numbers against the rows under them.
 */

const AT = new Date("2026-09-15T09:30:00Z");

function half(entry: (typeof PAIRED_STRINGS)[number], which: "goods" | "services", rows: readonly EntryRow[]): HalfView {
  const resolved = resolveHalf(entry, which, rows);
  const code = resolveHalf(entry, which, []);
  const row = rows.find((candidate) => candidate.key === entry.key && candidate.kind === which);
  return {
    ...resolved,
    codeState: code.state,
    codeTemplate: code.template,
    decidedAt: row ? AT : null,
    decidedBy: row ? "Rania Haddad" : null,
    version: row ? AT.toISOString() : null,
  };
}

const board = (rows: readonly EntryRow[]): PairedBoard => ({
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
});

const missing = PAIRED_STRINGS.filter((entry) => entry.services === "missing");

describe("presentPaired", () => {
  it("states the gap as the rows hold it, and the filters count the rows they show", () => {
    const view = presentPaired(board([]), "all", 13);
    expect(view.progress).toMatchObject({ value: PAIRED_STRINGS.length - missing.length, max: PAIRED_STRINGS.length, complete: false });
    expect(view.progress.figure).toBe(`${PAIRED_STRINGS.length - missing.length} / ${PAIRED_STRINGS.length}`);
    expect(view.progress.lines[0]).toMatch(new RegExp(`^${missing.length} keys have a goods value and no services twin`));
    expect(view.rows).toHaveLength(PAIRED_STRINGS.length);

    const unpaired = presentPaired(board([]), "unpaired", null);
    expect(unpaired.rows.map((row) => row.key)).toEqual(missing.map((entry) => entry.key));
    expect(view.filters.find((filter) => filter.key === "unpaired")?.label).toBe(`Unpaired · ${missing.length}`);
    expect(view.meta).toBe(`${pairedSurfaces().length} swap boards`);
  });

  it("renders a missing half as not written with its fallback, and a suppressed one as absent — never blank", () => {
    const view = presentPaired(board([]), "all", null);
    const gap = view.rows.find((row) => row.key === "overview.missed_body")!;
    expect(gap.services).toEqual({ tone: "missing", text: "Not written", caption: "Renders the goods words until it is written" });
    const csv = view.rows.find((row) => row.key === "change.row.csv_import")!;
    expect(csv.services.tone).toBe("suppressed");
    expect(csv.services.text).not.toBe("");
    expect(csv.editors[1]).toMatchObject({ canSuppress: false, suppressedNow: true, seed: "" });
  });

  it("marks a half written here, offers to restore it, and says what it goes back to", () => {
    const rows: EntryRow[] = [
      { key: "overview.missed_body", kind: "services", state: "written", value: "{n} enquiries matched your services", updatedAt: AT },
    ];
    const row = presentPaired(board(rows), "staff", null).rows[0]!;
    expect(row.key).toBe("overview.missed_body");
    expect(row.services.caption).toMatch(/^Written here by Rania Haddad, /);
    expect(row.editors[1]).toMatchObject({ canRestore: true, seed: "{n} enquiries matched your services", version: AT.toISOString() });
    expect(row.editors[1]!.restoreNote).toMatch(/not written/);
  });

  it("becomes a receipt when every twin is written, rather than disappearing", () => {
    const rows: EntryRow[] = missing.map((entry) => ({ key: entry.key, kind: "services", state: "written", value: "x", updatedAt: AT }));
    const view = presentPaired(board(rows), "all", 0);
    expect(view.progress.complete).toBe(true);
    expect(view.progress.lines[0]).toMatch(new RegExp(`^${PAIRED_STRINGS.length} of ${PAIRED_STRINGS.length} paired\\. Last written here `));
    expect(view.progress.lines).toContain("Notification template bodies are outside this count, and none owes a services twin on Templates.");
  });

  it("reads only the filters it knows", () => {
    expect(readPairedFilter("unpaired")).toBe("unpaired");
    expect(readPairedFilter(["staff", "x"])).toBe("staff");
    expect(readPairedFilter("drop table")).toBe("all");
  });
});
