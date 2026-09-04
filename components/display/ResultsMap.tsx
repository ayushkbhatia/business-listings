"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { Map as MapLibreMap, MapGeoJSONFeature } from "maplibre-gl";
import { loadMapLibre } from "@/lib/map/loader";
import { cn } from "@/lib/cn";
import type { MapBounds } from "@/lib/search/query";

/**
 * The search results map — board 1c's right-hand column.
 *
 * Separate from `MapCanvas` rather than a mode of it, and the reason is the
 * rendering path. `MapCanvas` places DOM markers, which is right for a
 * storefront's three branches: they are focusable, they carry an accessible
 * name, and there are never many. This map carries up to two hundred and has to
 * cluster them, which means a GeoJSON source and paint layers. Bolting both
 * into one component would give it two renderers and one set of props that only
 * half apply to each.
 *
 * What is shared is the thing that must not drift: the four-level pin hierarchy
 * from design-system §03.5. It is expressed here as data-driven paint rather
 * than CSS classes, but the colours are the same tokens, read from the
 * document — no map layer carries a literal colour.
 *
 *   moss        the hovered or selected result
 *   ink         a verified supplier
 *   outlined    unverified or unclaimed
 *   circle      a cluster, with its count
 *
 * ## Criterion 4, and where it is enforced
 *
 * Not here. A location with no coordinates never reaches this component,
 * because `getMapPins` filters it out in the `where` clause. This component
 * only reports the count it is handed. That is deliberate: a rule enforced in a
 * render is a rule one refactor away from being lost.
 */

export interface ResultsMapPin {
  /** The business id — clicking a pin selects its result row. */
  id: string;
  locationId: string;
  lat: number;
  lng: number;
  label: string;
  kind: "head_office" | "verified" | "unverified";
}

export interface FreeZoneMark {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface ResultsMapProps {
  pins: readonly ResultsMapPin[];
  /** Free-zone area centres. Shaded when the overlay is on. */
  freeZones?: readonly FreeZoneMark[];
  /** Published locations in this result set with no coordinates. */
  excluded?: number;
  /** Already localised and pluralised — a function prop cannot cross the boundary. */
  excludedLabel?: string;
  /** The result the buyer is pointing at, from the list or from a pin. */
  selectedId?: string | null;
  onSelect?: (businessId: string) => void;
  onHover?: (businessId: string | null) => void;
  /** "Search this area" — only fires on the button, never on a pan. */
  onSearchArea?: (bounds: MapBounds) => void;
  /** Where to open the viewport. Falls back to fitting the pins. */
  center?: { lat: number; lng: number };
  bounds?: MapBounds;
  zoom?: number;
  /** Required: a map is an image and needs a name. */
  label: string;
  labels: {
    searchArea: string;
    freeZones: string;
    legend: string;
    legendHeadOffice: string;
    legendVerified: string;
    legendUnverified: string;
    empty: string;
    capped?: string;
  };
  styleUrl?: string;
  className?: string;
}

const DEFAULT_STYLE =
  process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/positron";

/*
   Minimal GeoJSON shapes, declared here rather than imported.

   `@types/geojson` is a transitive dependency of maplibre-gl and is not a
   direct one of this project. Importing from it would mean depending on
   something the package manager is free to hoist differently on the next
   install, for two type names.
*/
interface PointGeometry {
  type: "Point";
  coordinates: number[];
}

interface PinCollection {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    geometry: PointGeometry;
    properties: Record<string, string>;
  }[];
}

const SOURCE = "results";
const FREE_ZONE_SOURCE = "free-zones";

/** Token names, resolved against the document so no layer holds a colour. */
const TOKENS = {
  moss: "--moss",
  ink: "--ink",
  card: "--card",
  lineStrong: "--line-strong",
  base: "--map-base",
  water: "--map-water",
} as const;

function readTokens(): Record<keyof typeof TOKENS, string> {
  const root = getComputedStyle(document.documentElement);
  const out = {} as Record<keyof typeof TOKENS, string>;
  for (const [key, token] of Object.entries(TOKENS)) {
    /*
       A missing token yields "", which MapLibre rejects outright.

       The fallback is the CSS keyword rather than a hex value, deliberately:
       this is a degradation path for a stylesheet that has not loaded, not a
       colour anybody chose, and `check:tokens` is right to refuse a literal
       here. If this ever renders, the map is grey and something is very wrong
       upstream — which is the correct thing for it to look like.
    */
    out[key as keyof typeof TOKENS] = root.getPropertyValue(token).trim() || "grey";
  }
  return out;
}

export function ResultsMap({
  pins,
  freeZones = [],
  excluded = 0,
  excludedLabel,
  selectedId,
  onSelect,
  onHover,
  onSearchArea,
  center,
  bounds,
  zoom = 10,
  label,
  labels,
  styleUrl = DEFAULT_STYLE,
  className,
}: ResultsMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [showFreeZones, setShowFreeZones] = useState(false);
  const id = useId();

  /*
     Callbacks in a ref, so the map is built once.

     The handlers change identity on every render of the page above, and a map
     that tore down and re-created its WebGL context each time would blink, lose
     the viewport, and re-download tiles. The listeners read the current value
     instead of closing over a stale one.
  */
  const handlers = useRef({ onSelect, onHover, onSearchArea });
  useEffect(() => {
    handlers.current = { onSelect, onHover, onSearchArea };
  }, [onSelect, onHover, onSearchArea]);

  const featuresOf = useCallback(
    () => ({
      type: "FeatureCollection" as const,
      features: pins.map((pin) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [pin.lng, pin.lat] },
        properties: {
          id: pin.id,
          locationId: pin.locationId,
          label: pin.label,
          kind: pin.kind,
        },
      })),
    }),
    [pins],
  );

  // ── Build once ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    (async () => {
      const maplibre = await loadMapLibre();
      if (cancelled || !containerRef.current) return;

      const map = new maplibre.Map({
        container: containerRef.current,
        style: styleUrl,
        center: [center?.lng ?? 55.2708, center?.lat ?? 25.2048],
        zoom,
        attributionControl: { compact: true },
      });
      mapRef.current = map;

      /*
         Strip the canvas's own landmark role, at construction and again on
         load.

         MapLibre stamps `role="region" aria-label="Map"` onto the canvas, and
         the figure around it is already a labelled `role="group"` — so one map
         yields two nested landmarks for one thing, and two maps on a page yield
         two landmarks with the identical name "Map". That is `landmark-unique`,
         and the gallery renders two of these.

         Done twice on purpose: doing it only on `load` was not enough, because
         a map whose style is still fetching has a canvas in the DOM and no
         `load` event yet. The canvas keeps its accessible name and its
         focusability; it simply stops claiming to be a landmark.
      */
      const unlandmark = () => {
        const canvas = map.getCanvas();
        canvas.removeAttribute("role");
        canvas.setAttribute("aria-label", label);
      };
      unlandmark();

      map.on("error", () => setFailed(true));
      /*
         MapLibre names its own canvas `region "Map"`. One map on a page is fine;
         two are two landmarks with the same name — `landmark-unique`, and a
         screen-reader user given a list of identical destinations. The canvas
         stays a region because it is keyboard-pannable and wants a name; the
         name becomes this map's own.
      */
      map.getCanvas().setAttribute("aria-label", label);
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), "bottom-right");

      map.on("load", () => {
        if (cancelled) return;
        const colour = readTokens();

        for (const [layer, property, value] of [
          ["background", "background-color", colour.base],
          ["water", "fill-color", colour.water],
        ] as const) {
          if (!map.getLayer(layer)) continue;
          try {
            (map.setPaintProperty as (l: string, p: string, v: unknown) => void)(
              layer,
              property,
              value,
            );
          } catch {
            // The provider style does not expose that layer. Not fatal.
          }
        }

        map.addSource(SOURCE, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
          cluster: true,
          clusterRadius: 44,
          // Past this the cluster is a smear rather than a summary, and a buyer
          // zoomed to a street wants the individual counters.
          clusterMaxZoom: 14,
        });

        map.addSource(FREE_ZONE_SOURCE, {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: freeZones.map((zone) => ({
              type: "Feature",
              geometry: { type: "Point", coordinates: [zone.lng, zone.lat] },
              properties: { name: zone.name },
            })),
          },
        });

        /*
           The overlay, as a shaded mark per zone rather than a filled boundary.

           `Area` carries a centroid and an `isFreeZone` flag; there is no
           boundary geometry in the schema. A filled shape would be drawing a
           line where Jebel Ali Free Zone ends, which we do not know — so this
           shades where the zones are and the legend says "areas".
        */
        map.addLayer({
          id: "free-zones",
          type: "circle",
          source: FREE_ZONE_SOURCE,
          layout: { visibility: "none" },
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 14, 14, 48],
            "circle-color": colour.moss,
            "circle-opacity": 0.14,
            "circle-stroke-width": 1,
            "circle-stroke-color": colour.moss,
            "circle-stroke-opacity": 0.4,
          },
        });

        map.addLayer({
          id: "clusters",
          type: "circle",
          source: SOURCE,
          filter: ["has", "point_count"],
          paint: {
            "circle-color": colour.ink,
            "circle-radius": ["step", ["get", "point_count"], 14, 10, 18, 50, 24],
            "circle-stroke-width": 2,
            "circle-stroke-color": colour.card,
          },
        });

        map.addLayer({
          id: "cluster-count",
          type: "symbol",
          source: SOURCE,
          filter: ["has", "point_count"],
          layout: {
            "text-field": ["get", "point_count_abbreviated"],
            "text-size": 11,
            "text-font": ["Noto Sans Regular"],
          },
          paint: { "text-color": colour.card },
        });

        /*
           The three pin states as one data-driven layer.

           `feature-state` carries the fourth: hovering a card or a pin sets it,
           and the moss treatment wins over whatever the supplier's tier says.
           One layer rather than three because a buyer moving the mouse down a
           list of twenty must not trigger twenty layer rebuilds.
        */
        map.addLayer({
          id: "pins",
          type: "circle",
          source: SOURCE,
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-radius": [
              "case",
              ["boolean", ["feature-state", "active"], false], 9, 7,
            ],
            "circle-color": [
              "case",
              ["boolean", ["feature-state", "active"], false], colour.moss,
              ["==", ["get", "kind"], "head_office"], colour.moss,
              ["==", ["get", "kind"], "verified"], colour.ink,
              colour.card,
            ],
            "circle-stroke-width": 2,
            "circle-stroke-color": [
              "case",
              ["boolean", ["feature-state", "active"], false], colour.moss,
              ["==", ["get", "kind"], "unverified"], colour.lineStrong,
              ["==", ["get", "kind"], "head_office"], colour.moss,
              colour.ink,
            ],
          },
        });

        map.on("click", "pins", (event) => {
          const feature = event.features?.[0] as MapGeoJSONFeature | undefined;
          const businessId = feature?.properties?.["id"];
          if (typeof businessId === "string") handlers.current.onSelect?.(businessId);
        });

        // Clicking a cluster zooms into it rather than selecting anything —
        // there is no single result behind a circle marked 37.
        map.on("click", "clusters", (event) => {
          const feature = event.features?.[0];
          if (!feature) return;
          map.easeTo({
            center: (feature.geometry as PointGeometry).coordinates as [number, number],
            zoom: Math.min(16, map.getZoom() + 2),
          });
        });

        let hovered: string | number | undefined;
        map.on("mousemove", "pins", (event) => {
          const feature = event.features?.[0];
          if (!feature) return;
          map.getCanvas().style.cursor = "pointer";
          if (hovered !== undefined) {
            map.setFeatureState({ source: SOURCE, id: hovered }, { active: false });
          }
          hovered = feature.id;
          if (hovered !== undefined) {
            map.setFeatureState({ source: SOURCE, id: hovered }, { active: true });
          }
          const businessId = feature.properties?.["id"];
          if (typeof businessId === "string") handlers.current.onHover?.(businessId);
        });

        map.on("mouseleave", "pins", () => {
          map.getCanvas().style.cursor = "";
          if (hovered !== undefined) {
            map.setFeatureState({ source: SOURCE, id: hovered }, { active: false });
          }
          hovered = undefined;
          handlers.current.onHover?.(null);
        });

        for (const layer of ["clusters", "free-zones"]) {
          map.on("mouseenter", layer, () => {
            map.getCanvas().style.cursor = layer === "clusters" ? "pointer" : "";
          });
          map.on("mouseleave", layer, () => {
            map.getCanvas().style.cursor = "";
          });
        }

        unlandmark();
        setReady(true);
      });
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      setReady(false);
    };
    // Built once. Pins, selection and the overlay are pushed in below rather
    // than rebuilding the map, which is why they are not dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleUrl]);

  // ── Push the pins in ──────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource(SOURCE);
    if (!source || !("setData" in source)) return;

    (source as { setData: (d: PinCollection) => void }).setData(featuresOf());
  }, [featuresOf, ready]);

  // ── Fit to the pins, or to the bounds the URL carried ─────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    if (bounds) {
      map.fitBounds(
        [
          [bounds.west, bounds.south],
          [bounds.east, bounds.north],
        ],
        { animate: false },
      );
      return;
    }
    if (pins.length === 0) return;

    let west = 180;
    let south = 90;
    let east = -180;
    let north = -90;
    for (const pin of pins) {
      west = Math.min(west, pin.lng);
      east = Math.max(east, pin.lng);
      south = Math.min(south, pin.lat);
      north = Math.max(north, pin.lat);
    }
    map.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding: 56, maxZoom: 13, animate: false },
    );
  }, [bounds, pins, ready]);

  // ── Selection, driven from the list ───────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    /*
       Selection is matched by property rather than feature id.

       Clustering renumbers features, so the id a source hands back is not
       stable across a zoom. The business id is, and it is the thing the list
       and the map actually agree on.
    */
    const features = map.querySourceFeatures(SOURCE);
    for (const feature of features) {
      if (feature.id === undefined) continue;
      map.setFeatureState(
        { source: SOURCE, id: feature.id },
        { active: selectedId != null && feature.properties?.["id"] === selectedId },
      );
    }
  }, [selectedId, ready]);

  // ── The overlay toggle ────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getLayer("free-zones")) return;
    map.setLayoutProperty("free-zones", "visibility", showFreeZones ? "visible" : "none");
  }, [showFreeZones, ready]);

  const searchThisArea = () => {
    const map = mapRef.current;
    if (!map) return;
    const box = map.getBounds();
    handlers.current.onSearchArea?.({
      west: box.getWest(),
      south: box.getSouth(),
      east: box.getEast(),
      north: box.getNorth(),
    });
  };

  return (
    <figure className={cn("relative m-0 h-full w-full", className)}>
      <div
        ref={containerRef}
        id={id}
        // A group, not an image: it contains focusable controls, and role="img"
        // would tell a screen reader the contents are decorative.
        role="group"
        aria-label={label}
        className="h-full min-h-[24rem] w-full bg-map-base"
      />

      {pins.length === 0 && !failed && (
        <p className="absolute inset-x-0 top-1/2 px-6 text-center text-caption text-muted">
          {labels.empty}
        </p>
      )}

      {/* ── Controls, top-right ──────────────────────────────────────────── */}
      <div className="pointer-events-none absolute right-3 top-3 flex flex-col items-end gap-2">
        {onSearchArea && (
          <button
            type="button"
            onClick={searchThisArea}
            className={cn(
              "pointer-events-auto rounded-ctl border border-line bg-card px-3 py-1.5",
              "text-body-sm font-medium text-ink shadow-sm",
              "hover:bg-paper focus-visible:outline-none focus-visible:shadow-focus",
            )}
          >
            {labels.searchArea}
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowFreeZones((on) => !on)}
          aria-pressed={showFreeZones}
          className={cn(
            "pointer-events-auto rounded-ctl border px-3 py-1.5 text-body-sm font-medium shadow-sm",
            "focus-visible:outline-none focus-visible:shadow-focus",
            showFreeZones
              ? "border-moss bg-moss text-on-ink hover:bg-moss-hover"
              : "border-line bg-card text-ink hover:bg-paper",
          )}
        >
          {labels.freeZones}
        </button>
      </div>

      {/* ── Legend, bottom-left, always visible ──────────────────────────── */}
      <div className="absolute bottom-3 left-3 rounded-card border border-line bg-card/95 px-3 py-2.5">
        {/*
             `text-body`, which is the token named for small text.

             Two wrong answers came first. `text-faint` measures 2.68:1 on the
             card and is what the boards draw these labels in — `Eyebrow` carries
             a note about refusing it for exactly that reason. `text-muted` is
             better and still not enough: 4.42:1 on card, under the 4.5 floor by
             a hair, which the gallery's contrast test caught and was right to.
             `--text-body` is documented as "body at small sizes" and clears it
             at 9.78:1.

             A map legend is the last place to argue about this. It is the key,
             and a key nobody can read is a map with three unexplained colours.
          */}
          <p className="mb-1.5 font-mono text-eyebrow uppercase text-body">{labels.legend}</p>
        <ul className="flex flex-col gap-1">
          {[
            { key: "head_office", dot: "border-moss bg-moss", text: labels.legendHeadOffice },
            { key: "verified", dot: "border-ink bg-ink", text: labels.legendVerified },
            { key: "unverified", dot: "border-line-strong bg-card", text: labels.legendUnverified },
          ].map((row) => (
            <li key={row.key} className="flex items-center gap-2 text-caption text-body">
              <span className={cn("block size-2.5 shrink-0 rounded-pill border-2", row.dot)} />
              {row.text}
            </li>
          ))}
        </ul>
      </div>

      {/*
        The pins as a list, always. A map is an image; this is the same
        information in a form that can be read, tabbed and printed — and it is
        what a buyer with JavaScript off gets instead of nothing.
      */}
      <ul className="sr-only">
        {pins.map((pin) => (
          <li key={pin.locationId}>{pin.label}</li>
        ))}
      </ul>

      {(excluded > 0 || labels.capped) && (
        <figcaption className="absolute inset-x-0 bottom-0 bg-card/90 px-3 py-1 font-mono text-eyebrow text-body">
          {excluded > 0 ? excludedLabel : labels.capped}
        </figcaption>
      )}
    </figure>
  );
}
