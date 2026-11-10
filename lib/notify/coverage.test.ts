import { describe, expect, it } from "vitest";
import { COVERAGE_CHANNELS, coverageGrid, defaultChannels, type CoverageInput } from "./coverage";
import { EVENT_AUDIENCE, isEmitted } from "./params";
import { BUYER_DEFAULT, type NotificationEvent } from "./routing";

/**
 * T7.1 — the grid is built from the event list, not from the rows, so an event
 * with no template is on it. The defect it replaces: board 12g listed only pairs
 * that already had a version, and the gap that silences a notification was the
 * one gap the console could not show or fix.
 */

const ALL = Object.keys(EVENT_AUDIENCE) as NotificationEvent[];

const live = (event: NotificationEvent, channel: CoverageInput["channel"], version = 1): CoverageInput => ({
  event,
  channel,
  state: "live",
  liveVersion: version,
  pendingVersion: null,
});

describe("coverageGrid", () => {
  it("has a row for every declared event when no template exists at all", () => {
    const grid = coverageGrid([]);
    expect(grid.rows.map((row) => row.event).sort()).toEqual([...ALL].sort());
    for (const row of grid.rows) expect(row.cells.map((cell) => cell.channel)).toEqual([...COVERAGE_CHANNELS]);
  });

  it("offers no SMS column — the channel is retired", () => {
    expect(COVERAGE_CHANNELS).not.toContain("sms");
  });

  it("counts every emitted event as silent when nothing is written", () => {
    const grid = coverageGrid([]);
    const emittedWithRoute = ALL.filter((event) => isEmitted(event) && defaultChannels(event).length > 0);
    expect(grid.silentEvents).toBe(emittedWithRoute.length);
  });

  it("marks a missing default route as a gap and a missing chosen-only channel as optional", () => {
    const grid = coverageGrid([]);
    const row = grid.rows.find((r) => r.event === "enquiry_received")!;
    const byChannel = Object.fromEntries(row.cells.map((cell) => [cell.channel, cell.state]));
    expect(byChannel).toEqual({ whatsapp: "optional", email: "gap", in_app: "gap" });
  });

  it("does not count a WhatsApp body waiting on Meta as silent, and does count a draft", () => {
    const grid = coverageGrid(
      [
        { event: "quote_received", channel: "whatsapp", state: "in_review", liveVersion: null, pendingVersion: 2 },
        { event: "quote_received", channel: "email", state: "draft", liveVersion: null, pendingVersion: null },
        live("quote_received", "in_app"),
      ],
      ["quote_received"],
    );
    const [row] = grid.rows;
    const cells = Object.fromEntries(row!.cells.map((cell) => [cell.channel, cell]));
    expect(cells.whatsapp!.state).toBe("with_meta");
    expect(cells.whatsapp!.version).toBe(2);
    expect(cells.email!.state).toBe("draft");
    // A buyer's defaults decide which of these are default routes.
    const expectedSilent = (["email"] as const).filter((c) => (BUYER_DEFAULT.matrix.quote_received ?? []).includes(c));
    expect(row!.cells.filter((cell) => cell.silent).map((cell) => cell.channel)).toEqual(expectedSilent);
  });

  it("never counts an event nothing emits", () => {
    const dormant = ALL.filter((event) => !isEmitted(event));
    expect(dormant.length).toBeGreaterThan(0);
    const grid = coverageGrid([], dormant);
    expect(grid.silentEvents).toBe(0);
    expect(grid.dormantEvents).toBe(dormant.length);
    for (const row of grid.rows) for (const cell of row.cells) expect(cell.state).toBe("dormant");
  });

  it("sorts each audience's silent events first, sellers before buyers before claimants", () => {
    const grid = coverageGrid([live("weekly_digest", "email"), live("weekly_digest", "in_app")]);
    const audiences = grid.rows.map((row) => row.audience);
    expect(audiences).toEqual([...audiences].sort((a, b) => ["seller", "buyer", "claimant"].indexOf(a) - ["seller", "buyer", "claimant"].indexOf(b)));
    const sellers = grid.rows.filter((row) => row.audience === "seller");
    const firstQuiet = sellers.findIndex((row) => row.silentCells === 0);
    expect(sellers.slice(firstQuiet).every((row) => row.silentCells === 0)).toBe(true);
  });

  it("reads a live version number into the cell", () => {
    const grid = coverageGrid([live("enquiry_received", "email", 3)], ["enquiry_received"]);
    expect(grid.rows[0]!.cells.find((cell) => cell.channel === "email")).toMatchObject({ state: "live", version: 3, silent: false });
  });
});

describe("defaultChannels", () => {
  it("is email and in-app for a seller event, plus whatever the floor adds", () => {
    expect(defaultChannels("review_posted")).toEqual(["email", "in_app"]);
  });

  it("is BUYER_DEFAULT for a buyer event", () => {
    expect(defaultChannels("quote_received")).toEqual(
      COVERAGE_CHANNELS.filter((c) => (BUYER_DEFAULT.matrix.quote_received ?? []).includes(c)),
    );
  });
});
