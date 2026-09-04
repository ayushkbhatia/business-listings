"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import { circleBounds, circlePolygon } from "@/lib/geo/distance";
import { loadMapLibre } from "@/lib/map/loader";
import { cn } from "@/lib/cn";

/**
 * The branch pin — board 2d's right-hand rail, and the only map on the platform
 * a seller can move.
 *
 * `MapCanvas` and `ResultsMap` are for reading: one places a storefront's three
 * branches as DOM markers, the other clusters two hundred search results through
 * paint layers. This is a third because the interaction is the component, not a
 * mode of one — a single draggable marker, an accuracy ring that follows it, and
 * a radius editor that changes what the map is showing. Bolting an editor into a
 * read-only map would give it two behaviours and one set of props that only half
 * apply to each.
 *
 * ## Real geometry, and why it is not Leaflet
 *
 * The board's render loads Leaflet 1.9.4 from a CDN with pinned integrity
 * hashes, and it is right about *why*: the instruction is "drag the pin to your
 * gate, not the street", and that instruction is meaningless on a decorative
 * grid — a seller cannot tell their gate from the street on a CSS hatch.
 *
 * This app already renders real OpenStreetMap geometry, through MapLibre, on
 * every other map it has. So the constraint the render was solving — a
 * standalone HTML file with no bundler, where a CDN script is the only way to
 * get real streets — does not exist here, and adopting it would mean a second
 * map library, a second pin vocabulary against design-system §03.5, and runtime
 * scripts from a host nothing else in this codebase loads from. What criterion 7
 * asks for in substance is real streets at street zoom with attribution intact,
 * and that is what this renders.
 *
 * The basemap is the app's own style, Positron — grey, desaturated, and already
 * the "muted tiles" the render reaches for a CSS filter to produce. Criterion 10
 * asks that the mute not reach the pin, the ring or the controls; here nothing
 * is muted after the fact, so it cannot. The marker is a DOM element outside the
 * canvas and the ring reads `--moss` from the document, exactly as the other two
 * maps do.
 */

export interface BranchPinMapProps {
  /** Null on a branch nobody has pinned. The map opens on `fallback` instead. */
  lat: number | null;
  lng: number | null;
  /** Where to look when there is no pin — the area's centre, never the pin. */
  fallback: { lat: number; lng: number };
  /** The pill on the pin: the branch's own name, never the company's. */
  label: string;
  /** Fired on drag end, rounded to six decimals. */
  onPin: (position: { lat: number; lng: number }) => void;

  /** Kilometres. Null where this branch makes no delivery promise. */
  radiusKm: number | null;
  onRadius: (km: number) => void;
  radiusMin: number;
  radiusMax: number;
  /** Where the editor starts on a branch that has never set one. */
  radiusDefault: number;

  /* Every string, resolved by the caller — a function prop cannot cross the
     server/client boundary, and `t()` is not available in here. */
  mapLabel: string;
  dragHint: string;
  unpinnedHint: string;
  radiusTitle: string;
  radiusNote: string;
  radiusEdit: string;
  radiusDone: string;
  radiusNone: string;
  radiusSliderLabel: string;
  formatRadius: (km: number) => string;
  unavailableLabel: string;
}

/**
 * Street zoom: the industrial block and the roads that reach it.
 *
 * 15, not the render's 16. MapLibre serves 512px tiles where Leaflet serves
 * 256, so the same integer is one level closer here — at 16 the frame is a
 * couple of buildings and the seller cannot see which gate is theirs, which is
 * the one thing this map exists to let them do.
 */
const STREET_ZOOM = 15;
/** The dashed ring is a real distance, not a decoration. Roughly a city block. */
const ACCURACY_M = 120;

export function BranchPinMap(props: BranchPinMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftKm, setDraftKm] = useState(props.radiusKm ?? props.radiusDefault);
  const id = useId();

  /*
     The current handlers, kept where the initialisation effect can reach them.

     The map is created inside an async import, so it finishes after the render
     that owns these values. Reading them through refs is what stops the map
     being torn down and the tiles re-streamed every time the parent re-renders,
     which on this screen is every keystroke in the address field.
  */
  const onPinRef = useRef(props.onPin);
  useEffect(() => {
    onPinRef.current = props.onPin;
  });

  const centre = {
    lat: props.lat ?? props.fallback.lat,
    lng: props.lng ?? props.fallback.lng,
  };
  const centreKey = `${centre.lat},${centre.lng}`;

  /* ── The map, once ─────────────────────────────────────────────────────── */

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    const [lat, lng] = centreKey.split(",").map(Number) as [number, number];
    const pinned = props.lat !== null && props.lng !== null;

    (async () => {
      const maplibre = await loadMapLibre();
      if (cancelled || !containerRef.current) return;

      const map = new maplibre.Map({
        container: containerRef.current,
        style: process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? DEFAULT_STYLE,
        center: [lng, lat],
        zoom: STREET_ZOOM,
        attributionControl: { compact: false },
        /*
           Criterion 9. The map sits inside a scrolling form, and a
           wheel-grabbing map traps the seller half way down it — they scroll to
           reach the hours rows and zoom out to the Arabian peninsula instead.
           Zoom is the +/− control and the scale bar, both of which are visible.
        */
        scrollZoom: false,
      });
      mapRef.current = map;
      map.on("error", () => setFailed(true));

      /*
         Four corners, one thing in each. The zoom control goes top-left rather
         than top-right — where the other two maps put it — because criterion 9
         makes zoom the only way to zoom, and the drag instruction sits in the
         top-right corner where the seller's eye is. A control behind a label is
         a control that is not there.
      */
      /*
         MapLibre names its own canvas `region "Map"`. One map on a page is fine;
         two are two landmarks with the same name — `landmark-unique`, and a
         screen-reader user given a list of identical destinations. The canvas
         stays a region because it is keyboard-pannable and wants a name; the
         name becomes this map's own.
      */
      map.getCanvas().setAttribute("aria-label", props.mapLabel);
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-left");
      map.addControl(new maplibre.ScaleControl({ unit: "metric" }), "bottom-left");

      /* The pin. A DOM marker, so it keeps the design palette whatever the
         basemap does, and so it can carry an accessible name and a grab cursor. */
      const element = document.createElement("div");
      element.className = "bl-pin";
      element.setAttribute("role", "img");
      element.setAttribute("aria-label", props.label);
      element.innerHTML = pinMarkup(props.label);

      const marker = new maplibre.Marker({ element, draggable: true, anchor: "bottom" })
        .setLngLat([lng, lat])
        .addTo(map);
      markerRef.current = marker;

      // The ring follows the pin while it moves. Criterion 11's first half: a
      // ring left behind describes where the branch used to be.
      marker.on("drag", () => {
        const position = marker.getLngLat();
        drawAccuracy(map, { lat: position.lat, lng: position.lng });
      });

      /*
         Criterion 11's second half. On drag end, not on move: a save per frame
         would be sixty writes a second, and the pin's resting place is the
         answer. Six decimals is about eleven centimetres — the rest of a
         float's digits describe the representation, not the gate.
      */
      marker.on("dragend", () => {
        const position = marker.getLngLat();
        onPinRef.current({
          lat: Number(position.lat.toFixed(6)),
          lng: Number(position.lng.toFixed(6)),
        });
      });

      /*
         The ring is drawn only once there is a real coordinate.

         An unpinned branch still gets a marker, because a marker is the control
         you drag to pin it — but a 120 m precision ring around a point nobody
         has placed is a claim of accuracy about a guess. The map opens on the
         area's centre in that case, and the area's centre is where to look, not
         where the branch is.
      */
      map.on("load", () => {
        if (cancelled || !pinned) return;
        drawAccuracy(map, { lat, lng });
      });
    })();

    return () => {
      cancelled = true;
      markerRef.current?.remove();
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // The map is built once per branch. `props.label` is read at build time and
    // re-set by the effect below rather than rebuilding the map for a rename.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centreKey]);

  /* The pill text, without a rebuild. */
  useEffect(() => {
    const element = markerRef.current?.getElement();
    if (!element) return;
    element.setAttribute("aria-label", props.label);
    element.innerHTML = pinMarkup(props.label);
  }, [props.label]);

  /* ── The radius, drawn only while it is being edited ───────────────────── */

  /**
   * Criterion 12, and the reason the card carries a number rather than a circle.
   *
   * At street zoom a 40 km circle is several screens wide — a shape with no
   * visible edge, which teaches the seller nothing about the distance they are
   * setting. So the circle appears when the editor opens, the map zooms out to
   * fit it, and both go away again on close. A fixed-pixel circle standing in
   * for 40 km was the old placeholder's mistake and it taught the wrong scale.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!editing) {
      clearRadius(map);
      map.easeTo({ center: [centre.lng, centre.lat], zoom: STREET_ZOOM, duration: 300 });
      return;
    }

    drawRadius(map, centre, draftKm);
    map.fitBounds(boundsTuple(centre, draftKm), { padding: 40, duration: 300 });
    // `centre` is rebuilt each render; `centreKey` is the value that changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, draftKm, centreKey]);

  const commit = useCallback(() => {
    props.onRadius(draftKm);
    setEditing(false);
  }, [draftKm, props]);

  return (
    /*
       The group is the whole rail, not just the canvas.

       MapLibre names its own container `region "Map"`, and the radius card is a
       control *about* this map that sits over it — so the accessible group has
       to contain both, or a reader who jumps to "Map of this branch" lands on a
       picture and the only control that changes it is somewhere else.
    */
    <div
      role="group"
      aria-label={props.mapLabel}
      className="relative isolate h-full min-h-[22rem] w-full overflow-hidden bg-map-base"
    >
      <div ref={containerRef} id={id} className="size-full" />

      {failed && (
        <p className="absolute inset-x-4 top-4 z-10 rounded-ctl border border-line bg-card px-3 py-2 text-caption text-body">
          {props.unavailableLabel}
        </p>
      )}

      {/* The instruction, where the seller's eye already is. Mono, uppercase —
          one of the two places §08 allows it. */}
      {!editing && !failed && (
        <p className="pointer-events-none absolute end-3 top-3 z-10 max-w-[16rem] rounded-tag bg-card px-2 py-1.5 font-mono text-eyebrow uppercase tracking-wide text-body shadow-raised">
          {props.lat === null ? props.unpinnedHint : props.dragHint}
        </p>
      )}

      {/*
        Criterion 8: the OSM attribution sits at the bottom right of the canvas
        and this card must not cover it, so the card is inset from the bottom by
        more than the attribution's height rather than flush to it. A licence
        condition is not a credit, and a panel over it is a licence breach with a
        layout reason.
      */}
      <div className="absolute inset-x-3 bottom-9 z-10 rounded-card border border-line bg-card p-3 shadow-raised">
        {editing ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-body-sm font-medium text-ink">{props.radiusTitle}</span>
              <span className="font-mono text-caption tabular-nums text-body">
                {props.formatRadius(draftKm)}
              </span>
            </div>
            <input
              type="range"
              min={props.radiusMin}
              max={props.radiusMax}
              step={1}
              value={draftKm}
              aria-label={props.radiusSliderLabel}
              onChange={(event) => setDraftKm(Number(event.target.value))}
              className={cn(
                "h-6 w-full cursor-pointer appearance-none bg-transparent",
                "[&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-pill",
                "[&::-webkit-slider-runnable-track]:bg-track",
                "[&::-webkit-slider-thumb]:-mt-1.5 [&::-webkit-slider-thumb]:size-4",
                "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-pill",
                "[&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-moss",
                "[&::-webkit-slider-thumb]:bg-moss",
                "[&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-pill [&::-moz-range-track]:bg-track",
                "[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-pill",
                "[&::-moz-range-thumb]:border-moss [&::-moz-range-thumb]:bg-moss",
                "focus-visible:shadow-focus focus-visible:outline-none",
              )}
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-caption text-body">{props.radiusNote}</span>
              <button
                type="button"
                onClick={commit}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-ctl border border-moss bg-moss px-3 sm:min-h-8",
                  "text-caption font-medium text-on-ink hover:bg-moss-hover",
                  "focus-visible:shadow-focus focus-visible:outline-none",
                )}
              >
                {props.radiusDone}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="min-w-0">
              <p className="text-body-sm font-medium text-ink">
                {props.radiusKm === null
                  ? props.radiusNone
                  : `${props.radiusTitle} — ${props.formatRadius(props.radiusKm)}`}
              </p>
              <p className="mt-0.5 text-caption text-body">{props.radiusNote}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                /*
                   The default, not the floor. A branch that has never set a
                   radius opens the editor at the figure the card states —
                   opening at 1 km would show a circle the size of the block and
                   invite the seller to accept it.
                */
                setDraftKm(props.radiusKm ?? props.radiusDefault);
                setEditing(true);
              }}
              className={cn(
                "ms-auto inline-flex min-h-11 shrink-0 items-center rounded-tag px-2 sm:min-h-8",
                "font-mono text-eyebrow uppercase tracking-wide text-moss hover:underline",
                "focus-visible:shadow-focus focus-visible:outline-none",
              )}
            >
              {props.radiusEdit}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const DEFAULT_STYLE = "https://tiles.openfreemap.org/styles/positron";

const ACCURACY_SOURCE = "branch-accuracy";
const RADIUS_SOURCE = "branch-radius";

/**
 * The pin, as markup.
 *
 * Inline styles rather than classes, because MapLibre owns this node and the
 * marker element is created outside React's tree. The two colours it uses are
 * read from the document below rather than written here — nothing in this
 * codebase carries a raw hex, and a pin that quietly drifted from `--moss` would
 * be the first thing on the page to do it.
 */
function pinMarkup(label: string): string {
  return `<span class="bl-pin-pill">${escapeHtml(label)}</span><span class="bl-pin-point"></span>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function moss(): string {
  return getComputedStyle(document.documentElement).getPropertyValue("--moss").trim();
}

/** The dashed precision ring, following the pin. */
function drawAccuracy(map: MapLibreMap, centre: { lat: number; lng: number }): void {
  if (!map.isStyleLoaded()) {
    map.once("load", () => drawAccuracy(map, centre));
    return;
  }

  const data = {
    type: "Feature" as const,
    properties: {},
    geometry: {
      type: "Polygon" as const,
      coordinates: [circlePolygon(centre, ACCURACY_M / 1000)],
    },
  };

  const existing = map.getSource(ACCURACY_SOURCE);
  if (existing) {
    (existing as unknown as { setData: (d: unknown) => void }).setData(data);
    return;
  }

  const colour = moss();
  if (!colour) return;

  map.addSource(ACCURACY_SOURCE, { type: "geojson", data });
  map.addLayer({
    id: `${ACCURACY_SOURCE}-fill`,
    type: "fill",
    source: ACCURACY_SOURCE,
    paint: { "fill-color": colour, "fill-opacity": 0.1 },
  });
  map.addLayer({
    id: `${ACCURACY_SOURCE}-line`,
    type: "line",
    source: ACCURACY_SOURCE,
    paint: { "line-color": colour, "line-opacity": 0.55, "line-width": 1.5, "line-dasharray": [3, 2] },
  });
}

/** The service-radius circle. Only ever drawn inside the editor. */
function drawRadius(map: MapLibreMap, centre: { lat: number; lng: number }, km: number): void {
  if (!map.isStyleLoaded()) {
    map.once("load", () => drawRadius(map, centre, km));
    return;
  }

  const data = {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "Polygon" as const, coordinates: [circlePolygon(centre, km)] },
  };

  const existing = map.getSource(RADIUS_SOURCE);
  if (existing) {
    (existing as unknown as { setData: (d: unknown) => void }).setData(data);
    return;
  }

  const colour = moss();
  if (!colour) return;

  map.addSource(RADIUS_SOURCE, { type: "geojson", data });
  map.addLayer({
    id: `${RADIUS_SOURCE}-fill`,
    type: "fill",
    source: RADIUS_SOURCE,
    paint: { "fill-color": colour, "fill-opacity": 0.08 },
  });
  map.addLayer({
    id: `${RADIUS_SOURCE}-line`,
    type: "line",
    source: RADIUS_SOURCE,
    paint: { "line-color": colour, "line-opacity": 0.45, "line-width": 1 },
  });
}

function clearRadius(map: MapLibreMap): void {
  if (!map.getSource(RADIUS_SOURCE)) return;
  for (const suffix of ["fill", "line"]) {
    const layer = `${RADIUS_SOURCE}-${suffix}`;
    if (map.getLayer(layer)) map.removeLayer(layer);
  }
  map.removeSource(RADIUS_SOURCE);
}

function boundsTuple(
  centre: { lat: number; lng: number },
  km: number,
): [[number, number], [number, number]] {
  const box = circleBounds(centre, km);
  return [
    [box.west, box.south],
    [box.east, box.north],
  ];
}
