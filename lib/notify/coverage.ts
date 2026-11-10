import { EVENT_AUDIENCE, isEmitted, type Audience } from "./params";
import {
  BUYER_DEFAULT,
  DEFAULT_ROUTING,
  PLATFORM_FLOOR,
  RETIRED_CHANNELS,
  type NotificationChannel,
  type NotificationEvent,
} from "./routing";
import type { PrimaryState } from "./template-lines";

/**
 * Template coverage — every event × channel, and whether a message can go out
 * on it. Task T7.1, board 12g, prompt P-08.
 *
 * ## Why this is its own module
 *
 * Three readers ask the same question and must not answer it three ways:
 *
 *   · `scripts/check-template-coverage.mts` (T6.7) fails the build on a gap,
 *     reading the committed catalogue;
 *   · board 12g's coverage grid shows each gap with *Write first version*,
 *     reading the database;
 *   · board 7e's *Not sent yet* caption tells a seller their tick reaches
 *     nothing, reading the same database.
 *
 * The board's list showed only pairs that already had a row, so an event with
 * no template never appeared on the one screen that could write it — the gap
 * that silences a notification was the gap the console could not show. A grid
 * built from the event list, not from the rows, cannot have that blind spot.
 *
 * Pure: the caller brings the rows. The rule for what counts as a gap lives here
 * once, and the build check and the screen differ only in where their rows come
 * from.
 */

/** The channels a recipient can be offered. SMS left with decision N10. */
export const COVERAGE_CHANNELS = (["whatsapp", "email", "in_app"] as const).filter(
  (channel) => !RETIRED_CHANNELS.includes(channel),
) as readonly NotificationChannel[];

/**
 * The channels an event reaches without the recipient choosing anything.
 *
 *   · a seller: `DEFAULT_ROUTING` plus `PLATFORM_FLOOR` — what a business that
 *     never opened board 7e receives, and what the floor sends whatever the
 *     matrix says;
 *   · a buyer or a claimant: `BUYER_DEFAULT`, since neither holds a matrix.
 *
 * In `COVERAGE_CHANNELS` order, so a caption reads the same on every row.
 */
export function defaultChannels(event: NotificationEvent): NotificationChannel[] {
  const chosen: readonly NotificationChannel[] =
    EVENT_AUDIENCE[event] === "seller"
      ? [...(DEFAULT_ROUTING.matrix[event] ?? []), ...(PLATFORM_FLOOR[event] ?? [])]
      : [...(BUYER_DEFAULT.matrix[event] ?? [])];
  return COVERAGE_CHANNELS.filter((channel) => chosen.includes(channel));
}

/**
 * One cell, in P-08's six states plus Meta's refusal.
 *
 *   · `live` — a version sends.
 *   · `draft` — written, not published. Nothing sends.
 *   · `with_meta` — a WhatsApp body waiting on Meta's approval. Somebody else's
 *     queue, so not a gap of ours.
 *   · `rejected` — Meta refused the only body there is.
 *   · `gap` — nothing sends, the event is emitted, and this channel is one the
 *     recipient gets by default. A message nobody receives and nothing reports.
 *   · `optional` — nothing sends and nobody gets this channel without choosing
 *     it. Still writable; not urgent.
 *   · `dormant` — nothing in the codebase emits the event yet.
 */
export type CoverageState = "live" | "draft" | "with_meta" | "rejected" | "gap" | "optional" | "dormant";

/** What the caller knows about one pair. A pair with no rows at all is simply absent. */
export interface CoverageInput {
  event: NotificationEvent;
  channel: NotificationChannel;
  state: PrimaryState;
  liveVersion: number | null;
  pendingVersion: number | null;
}

export interface CoverageCell {
  event: NotificationEvent;
  channel: NotificationChannel;
  state: CoverageState;
  /** The live version, or the one with Meta, for the cell's label. */
  version: number | null;
  /** Whether a recipient gets this channel without choosing it. */
  byDefault: boolean;
  /** True where nothing sends on a default route — the build check's failure. */
  silent: boolean;
}

export interface CoverageRow {
  event: NotificationEvent;
  audience: Audience;
  emitted: boolean;
  defaultRoute: NotificationChannel[];
  cells: CoverageCell[];
  /** Default-route cells on which nothing sends. */
  silentCells: number;
}

export interface CoverageGrid {
  rows: CoverageRow[];
  /** Emitted events with no live template on at least one default route — P-08's meta line. */
  silentEvents: number;
  /** Default routes checked, for the build check's summary line. */
  defaultRoutes: number;
  /** Declared events nothing emits. Printed so the silence is a measurement. */
  dormantEvents: number;
}

const AUDIENCE_ORDER: Record<Audience, number> = { seller: 0, buyer: 1, claimant: 2 };

function cellState(input: CoverageInput | undefined, emitted: boolean, byDefault: boolean): CoverageState {
  if (input?.state === "live") return "live";
  if (input?.state === "in_review") return "with_meta";
  if (input?.state === "draft") return "draft";
  if (input?.state === "rejected") return "rejected";
  // `missing`, `retired`, or no row at all: nothing is written that could send.
  if (!emitted) return "dormant";
  return byDefault ? "gap" : "optional";
}

/**
 * The grid. Every declared event, whether or not it has a row.
 *
 * Ordered seller → buyer → claimant, and within each audience the events with a
 * silent default route first (P-08: *"Gap rows sort first"*), then by key, so
 * the order is total and the worst news is at the top of each group.
 */
export function coverageGrid(
  inputs: readonly CoverageInput[],
  events: readonly NotificationEvent[] = Object.keys(EVENT_AUDIENCE) as NotificationEvent[],
): CoverageGrid {
  const byPair = new Map(inputs.map((input) => [`${input.event}.${input.channel}`, input]));
  let defaultRoutes = 0;

  const rows = events.map((event): CoverageRow => {
    const emitted = isEmitted(event);
    const defaultRoute = defaultChannels(event);
    const cells = COVERAGE_CHANNELS.map((channel): CoverageCell => {
      const input = byPair.get(`${event}.${channel}`);
      const byDefault = defaultRoute.includes(channel);
      const state = cellState(input, emitted, byDefault);
      return {
        event,
        channel,
        state,
        version: state === "live" ? (input?.liveVersion ?? null) : state === "with_meta" ? (input?.pendingVersion ?? null) : null,
        byDefault,
        /*
           A default route on which nothing sends. `with_meta` is excluded for
           the reason the build check gives: the body exists and the wait is
           Meta's. A draft is not — it is a body somebody wrote and never
           published, which is a gap of ours.
        */
        silent: emitted && byDefault && state !== "live" && state !== "with_meta",
      };
    });
    if (emitted) defaultRoutes += defaultRoute.length;
    return {
      event,
      audience: EVENT_AUDIENCE[event],
      emitted,
      defaultRoute,
      cells,
      silentCells: cells.filter((cell) => cell.silent).length,
    };
  });

  rows.sort(
    (a, b) =>
      AUDIENCE_ORDER[a.audience] - AUDIENCE_ORDER[b.audience] ||
      Number(b.silentCells > 0) - Number(a.silentCells > 0) ||
      a.event.localeCompare(b.event),
  );

  return {
    rows,
    silentEvents: rows.filter((row) => row.silentCells > 0).length,
    defaultRoutes,
    dormantEvents: rows.filter((row) => !row.emitted).length,
  };
}
