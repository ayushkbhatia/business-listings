"use client";

import { MapCanvas, type MapPin } from "@/components/display";

/**
 * Board 6a §3 — the map card in the hero's right column.
 *
 * A thin client wrapper, because `MapCanvas` is a client component and a server
 * page cannot hand it pins without one. Nothing is computed here: the labels
 * arrive already localised, for the reason `MapCanvasProps` states — a
 * formatter cannot cross the boundary.
 *
 * 180px and static. *"It is orientation, not a tool; the interactive map is
 * `1c`'s."*
 *
 * Renders nothing when there is nothing to plot, and the card above it collapses
 * to the nearby-areas list. An empty map on a page about a place reads as "we
 * have nothing here" when the truth is almost always that the coordinates have
 * not been recorded — and the excluded count says which.
 */
export function AreaMapCard({
  pins,
  label,
  extent,
  excluded,
  excludedLabel,
}: {
  pins: readonly MapPin[];
  /** The map's accessible name. */
  label: string;
  /** `AL QUOZ IND. 1–4` — the sub-districts covered. */
  extent?: string;
  excluded: number;
  excludedLabel: string;
}) {
  if (pins.length === 0) return null;

  return (
    <div className="relative">
      <MapCanvas
        label={label}
        pins={pins}
        height={180}
        interactive={false}
        excluded={excluded}
        excludedLabel={excluded > 0 ? excludedLabel : undefined}
      />
      {extent && (
        /*
           Over the map rather than above it, as the board draws it, and on a
           `--card` wash so the mono reads against whatever tile is underneath.
           `pointer-events-none` because it is a label, and a static map has
           nothing for a click to reach anyway.
        */
        <span className="pointer-events-none absolute left-3 top-3 rounded-tag bg-card/85 px-1.5 py-1 font-mono text-eyebrow uppercase text-muted">
          {extent}
        </span>
      )}
    </div>
  );
}
