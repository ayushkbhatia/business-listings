"use client";

import { MapCanvas, type MapPin } from "@/components/display";

/**
 * The map on an area landing page — board 6a.
 *
 * A thin client wrapper, because `MapCanvas` is a client component and a server
 * page cannot hand it the pins without one. Nothing is computed here: the
 * labels arrive already localised, for the reason `MapCanvasProps` states — a
 * formatter cannot cross the boundary.
 *
 * Renders nothing at all when there is nothing to plot. An empty map on a page
 * about a place is worse than no map: it reads as "we have nothing here" when
 * the truth is usually that the coordinates have not been recorded.
 */
export function AreaMap({
  pins,
  title,
  label,
  excluded,
  excludedLabel,
}: {
  pins: readonly MapPin[];
  title: string;
  /** The map's own accessible name. */
  label: string;
  excluded: number;
  excludedLabel: string;
}) {
  if (pins.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="font-mono text-eyebrow uppercase text-faint">{title}</h2>
      <div className="mt-2">
        <MapCanvas
          label={label}
          pins={pins}
          excluded={excluded}
          excludedLabel={excluded > 0 ? excludedLabel : undefined}
        />
      </div>
    </section>
  );
}
