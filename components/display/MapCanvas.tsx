"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import { loadMapLibre } from "@/lib/map/loader";
import { cn } from "@/lib/cn";
import { circlePolygon } from "@/lib/geo/distance";

/**
 * A map, wrapping MapLibre.
 *
 * Pin hierarchy is fixed by design-system §03.5 and is not a prop:
 *   moss pin      selected, or the head office
 *   ink pin       verified
 *   outlined pin  unverified or unclaimed
 *   circle        a cluster, with its count
 *
 * A location with no coordinates never appears. It is not dropped at an area
 * centroid and it is not silently omitted from the count either — `excluded`
 * reports how many were held back so the surface above can say so. A wrong pin
 * is worse than no pin, and a seller who is told their branch is unpinned will
 * fix it.
 *
 * The tile style is an env var. The default is keyless so nothing is blocked on
 * a paid account; a token-matched style is a design deliverable, not a config
 * change — see docs/inferred.md.
 */
export interface MapPin {
  id: string;
  lat: number;
  lng: number;
  label: string;
  /** Drives the pin treatment. Never a colour prop. */
  kind: "head_office" | "verified" | "unverified";
  href?: string;
}

export interface MapCanvasProps {
  /** Locations with null coordinates must be filtered out before this. */
  pins: readonly MapPin[];
  /** How many were held back for having no coordinates. */
  excluded?: number;
  /**
   * Already localised and pluralised by the caller. A string, not a formatter:
   * this is a client component, and a function prop cannot cross the boundary
   * from a server component that renders a map.
   */
  excludedLabel?: string;
  selectedId?: string;
  onSelect?: (id: string) => void;
  /** Required: a map is an image and needs a name. */
  label: string;
  /** Falls back to fitting the pins. */
  center?: { lat: number; lng: number };
  zoom?: number;
  height?: number;
  /** Shown instead of the map when there is nothing to plot. */
  emptyLabel?: string;
  styleUrl?: string;
  /**
   * Service-radius rings, drawn under the pins.
   *
   * Off unless the caller passes them, because a shaded circle over a map is a
   * claim about where a supplier delivers and it should appear when a buyer asks
   * for it, not by default. Board 1f's toggle is the caller passing or omitting
   * this — no internal open state, so the button and the overlay cannot disagree.
   */
  radii?: readonly { id: string; lat: number; lng: number; km: number }[];
}

const DEFAULT_STYLE =
  process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/positron";

export function MapCanvas({
  pins,
  excluded = 0,
  excludedLabel,
  selectedId,
  onSelect,
  label,
  center,
  zoom = 9,
  height = 360,
  emptyLabel,
  styleUrl = DEFAULT_STYLE,
  radii,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  /*
     Two handles the initialisation effect publishes, and the select callback.

     They exist so that changing the selection does not rebuild the map.
     `selectedId` and `onSelect` used to sit in the initialisation effect's
     dependency array, which meant every selection tore MapLibre down and
     streamed the tiles again. Board 1f drives the selection from row *hover*,
     so that shape would have re-created the map on every mouse move.

     Functions rather than element maps: the marker elements stay local to the
     effect that made them, and the later effects call in rather than reaching
     in. Mutating DOM nodes held in a ref across effects is what the
     immutability rule refuses, and it is right to — the elements belong to the
     map instance, and the map instance belongs to that effect.
  */
  const applySelectionRef = useRef<(id: string | undefined) => void>(() => {});
  const applyRadiiRef = useRef<(rings: MapCanvasProps["radii"]) => void>(() => {});
  const onSelectRef = useRef(onSelect);
  const selectedIdRef = useRef(selectedId);
  const radiiRef = useRef(radii);

  /*
     Kept current for the initialisation effect below, which creates the map in
     an async import and therefore finishes *after* the effects that own these
     values have already run. Written in an effect rather than during render —
     a ref written during render is torn state under a concurrent re-render, and
     the lint refuses it.

     Declared before the initialisation effect so that on mount it runs first.
  */
  useEffect(() => {
    onSelectRef.current = onSelect;
    selectedIdRef.current = selectedId;
    radiiRef.current = radii;
  });
  const [failed, setFailed] = useState(false);
  // No IntersectionObserver (jsdom, an old browser) means mount immediately
  // rather than never. Decided at initialisation, not from inside an effect.
  const [visible, setVisible] = useState(
    () => typeof IntersectionObserver === "undefined",
  );
  const id = useId();

  /**
   * MapLibre is ~800 KB and a tile stream that never goes quiet. A storefront
   * with the map below the fold should pay for neither until the reader scrolls
   * to it, so initialisation waits for the frame to come into view.
   */
  useEffect(() => {
    const node = containerRef.current;
    if (!node || visible) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible || !containerRef.current || pins.length === 0) return;
    let cancelled = false;

    (async () => {
      const maplibre = await loadMapLibre();
      if (cancelled || !containerRef.current) return;

      const map = new maplibre.Map({
        container: containerRef.current,
        style: styleUrl,
        center: [center?.lng ?? pins[0]!.lng, center?.lat ?? pins[0]!.lat],
        zoom,
        attributionControl: { compact: true },
      });
      mapRef.current = map;

      map.on("error", () => setFailed(true));
      /*
         MapLibre names its own canvas `region "Map"`. One map on a page is fine;
         two are two landmarks with the same name — `landmark-unique`, and a
         screen-reader user given a list of identical destinations. The canvas
         stays a region because it is keyboard-pannable and wants a name; the
         name becomes this map's own.
      */
      map.getCanvas().setAttribute("aria-label", label);
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");

      map.on("load", () => {
        if (cancelled) return;

        // Nudge the provider style toward the map tokens. Layer ids vary
        // between styles, so each is attempted and skipped if absent — the map
        // degrades to the provider's own colours rather than throwing.
        const paint = [
          ["background", "background-color", "--map-base"],
          ["water", "fill-color", "--map-water"],
        ] as const;
        const root = getComputedStyle(document.documentElement);
        for (const [layer, property, token] of paint) {
          const value = root.getPropertyValue(token).trim();
          if (!value || !map.getLayer(layer)) continue;
          try {
            // MapLibre types setPaintProperty against a per-layer union it
            // cannot narrow from a loop. The pairs above are correct for the
            // layer types they name, and the try/catch is the real guard.
            (map.setPaintProperty as (l: string, p: string, v: unknown) => void)(
              layer,
              property,
              value,
            );
          } catch {
            // The style does not expose that layer. Not fatal.
          }
        }

        if (!center && pins.length > 1) {
          const bounds = new maplibre.LngLatBounds();
          for (const pin of pins) bounds.extend([pin.lng, pin.lat]);
          map.fitBounds(bounds, { padding: 48, maxZoom: 14, animate: false });
        }
      });

      const elements = new Map<string, { node: HTMLElement; kind: MapPin["kind"] }>();
      for (const pin of pins) {
        const element = document.createElement("button");
        element.type = "button";
        element.setAttribute("aria-label", pin.label);
        element.title = pin.label;
        element.className = pinClass(pin.kind, pin.id === selectedIdRef.current);
        element.addEventListener("click", () => onSelectRef.current?.(pin.id));
        elements.set(pin.id, { node: element, kind: pin.kind });
        markersRef.current.push(
          new maplibre.Marker({ element }).setLngLat([pin.lng, pin.lat]).addTo(map),
        );
      }

      applySelectionRef.current = (id) => {
        for (const [pinId, entry] of elements) {
          entry.node.className = pinClass(entry.kind, pinId === id);
        }
      };
      applyRadiiRef.current = (rings) => drawRadii(map, rings);

      /*
         A map created while a selection or an overlay is already live catches
         up here. Without this the first paint after a remount would drop both,
         because the effects that own them only fire when their value changes.
      */
      applySelectionRef.current(selectedIdRef.current);
      // `drawRadii` defers on its own when the style is not ready.
      if (radiiRef.current?.length) applyRadiiRef.current(radiiRef.current);
    })();

    return () => {
      cancelled = true;
      const markers = markersRef.current;
      for (const marker of markers) marker.remove();
      markersRef.current = [];
      applySelectionRef.current = () => {};
      applyRadiiRef.current = () => {};
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [visible, pins, styleUrl, center, zoom]);

  /*
     Selection, applied to the markers already on the map.

     A class swap on an existing element, not a rebuild. `selectedIdRef` carries
     the current value into the initialisation effect above so a map created
     while something is already selected draws it selected on first paint.
  */
  useEffect(() => {
    applySelectionRef.current(selectedId);
  }, [selectedId]);

  /*
     The radius rings.

     Circles are drawn as GeoJSON polygons rather than a `circle` layer, because
     a `circle` layer's radius is in screen pixels and would grow and shrink with
     the zoom — a 65 km promise that changes size as the buyer zooms is not a
     promise about distance at all.
  */
  useEffect(() => {
    applyRadiiRef.current(radii);
  }, [radii]);

  if (pins.length === 0) {
    return (
      <div
        role="group"
        aria-label={label}
        style={{ height }}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-1 rounded-card border border-line",
          "bg-map-base px-4 text-center",
        )}
      >
        <p className="text-caption text-muted">{emptyLabel}</p>
        {excluded > 0 && excludedLabel && (
          <p className="font-mono text-eyebrow text-faint">{excludedLabel}</p>
        )}
      </div>
    );
  }

  return (
    <figure className="w-full">
      <div
        ref={containerRef}
        id={id}
        // A group, not an image. role="img" on an element containing focusable
        // pins and the provider's zoom controls is nested-interactive, and it
        // tells a screen reader the contents are decorative when they are not.
        role="group"
        aria-label={label}
        style={{ height }}
        className="w-full overflow-hidden rounded-card border border-line bg-map-base"
      />

      {/*
        The pins as a list, always. A map is an image; this is the same
        information in a form that can be read, tabbed and printed.
      */}
      <ul className="sr-only">
        {pins.map((pin) => (
          <li key={pin.id}>{pin.label}</li>
        ))}
      </ul>

      {(excluded > 0 || failed) && (
        <figcaption className="mt-1.5 font-mono text-eyebrow text-faint">
          {excluded > 0 ? excludedLabel : null}
        </figcaption>
      )}
    </figure>
  );
}

/**
 * Add, update or remove the service-radius rings on a live map.
 *
 * Called through a handle the initialisation effect publishes, so the layer is
 * always added to the map instance that owns it — a module-level function
 * reaching for `mapRef` would race a remount.
 */
function drawRadii(map: MapLibreMap, rings: MapCanvasProps["radii"]): void {
  /*
     Nothing can be added to a style that has not loaded.

     `addSource` and `getSource` both throw on a map whose style is still in
     flight, and this is reachable by hand: the overlay button is live from
     first paint, and a buyer who clicks it while the tiles are still arriving
     took down the whole column. Deferring is the fix rather than a try/catch —
     the ring should appear when the style is ready, not be dropped.

     `once` rather than `on`, so a buyer toggling twice does not accumulate
     handlers that all fire on the next style load.
  */
  if (!map.isStyleLoaded()) {
    map.once("load", () => drawRadii(map, rings));
    return;
  }

  const SOURCE = "service-radius";
  const existing = map.getSource(SOURCE);

  if (!rings || rings.length === 0) {
    if (map.getLayer(`${SOURCE}-fill`)) map.removeLayer(`${SOURCE}-fill`);
    if (map.getLayer(`${SOURCE}-line`)) map.removeLayer(`${SOURCE}-line`);
    if (existing) map.removeSource(SOURCE);
    return;
  }

  const data = {
    type: "FeatureCollection" as const,
    features: rings.map((ring) => ({
      type: "Feature" as const,
      properties: { id: ring.id },
      geometry: { type: "Polygon" as const, coordinates: [circlePolygon(ring, ring.km)] },
    })),
  };

  if (existing) {
    // Only a GeoJSON source has setData, and this source is always one.
    (existing as unknown as { setData: (d: unknown) => void }).setData(data);
    return;
  }

  /*
     The colour comes from the token, and if the token is not there the rings do
     not render. A hard-coded fallback would be a second definition of moss that
     nobody would notice had drifted — and the lint refuses raw hex for exactly
     that reason.
  */
  const moss = getComputedStyle(document.documentElement).getPropertyValue("--moss").trim();
  if (!moss) return;

  map.addSource(SOURCE, { type: "geojson", data });
  map.addLayer({
    id: `${SOURCE}-fill`,
    type: "fill",
    source: SOURCE,
    paint: { "fill-color": moss, "fill-opacity": 0.1 },
  });
  map.addLayer({
    id: `${SOURCE}-line`,
    type: "line",
    source: SOURCE,
    paint: { "line-color": moss, "line-opacity": 0.4, "line-width": 1 },
  });
}

function pinClass(kind: MapPin["kind"], selected: boolean): string {
  const base =
    "block size-3.5 cursor-pointer rounded-pill border-2 transition-colors duration-120 ease-out";
  if (selected || kind === "head_office") return `${base} border-moss bg-moss`;
  if (kind === "verified") return `${base} border-ink bg-ink`;
  return `${base} border-line-strong bg-card`;
}
