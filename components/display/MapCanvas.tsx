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
 *   amber pin     a coordinate we know is approximate
 *   circle        a cluster, with its count
 *
 * The amber one is board 3c's addition and it is the only one that describes
 * the *pin* rather than the supplier behind it. A branch geocoded to its area
 * rather than its address is drawn where we believe it is and marked as a
 * belief, which is the honest third option between placing it confidently and
 * hiding it. The ring that would say how approximate is deliberately absent at
 * this zoom: 1.8 km is six pixels across a 110 km view, so the dot carries the
 * state and the caller's issue card carries the sentence.
 *
 * It is a fourth value rather than a second axis because the alternative was a
 * second map component. Board 3c's rail is otherwise this one exactly —
 * multi-pin, read-only, fitted to its bounds — and a fork would be a second pin
 * vocabulary to keep in step with §03.5.
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
  kind: "head_office" | "verified" | "unverified" | "approximate";
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
  /**
   * Off for a map that is orientation rather than a tool — board 6a §3.
   *
   * The hero card on a landing page shows where a trade sits and nothing else:
   * no pan, no zoom, no marker interaction. The interactive map belongs to
   * board 1c, where the buyer is filtering and the map is how they do it.
   *
   * This is a real difference and not a styling one. Interactive, the canvas is
   * keyboard-pannable and every pin is a button, which puts twenty focus stops
   * into the top of a page whose first job is to be read — and the `1c` map
   * earns them because clicking a pin does something. Here it would not.
   *
   * The pins still render, and the `sr-only` list below is unchanged: a static
   * map is still an image, and the information in it is still owed to a reader
   * who cannot see it.
   */
  interactive?: boolean;
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
  /**
   * Draw each pin's name beside it — board 3c's overview rail.
   *
   * Off by default, and it stays off for the three maps that had this component
   * before. On board 1c a label per pin is two hundred labels over a clustered
   * map; on 1f and 6a the names are already in the column beside it. On 3c the
   * map *is* the column — five branches spread over 110 km, where "which of
   * these is Sharjah" is the question the rail exists to answer and a hover
   * title cannot answer it on a touch screen.
   *
   * The names come from `pin.label`, which every caller already sets, so this
   * is a rendering switch rather than a second data path.
   */
  labelled?: boolean;
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
  interactive = true,
  labelled = false,
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
        // Every handler in one flag: drag, scroll zoom, double-click, touch and
        // the keyboard. A static map that still panned on a trackpad gesture
        // would be a tool pretending not to be one.
        interactive,
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
      if (interactive) {
        map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
      } else {
        // A canvas nobody can pan is not a control. Left focusable it is a tab
        // stop that does nothing, which §09's keyboard rule counts as a trap of
        // the quiet kind.
        map.getCanvas().setAttribute("tabindex", "-1");
      }

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
          /*
             `fitBounds` pads the *points*, and a labelled pin is much wider
             than a point.

             48 all round is right for a bare dot. With labels on, the pill runs
             about 150 px to one side of its dot and the attribution plate sits
             over the bottom 50 — so an edge pin fitted to 48 puts its name off
             the frame, and the southernmost one puts it behind the licence
             text. Asymmetric because the overflow is: sideways for the pill,
             downwards for the plate.
          */
          map.fitBounds(bounds, {
            padding: labelled
              ? { top: 56, bottom: 84, left: 72, right: 72 }
              : 48,
            maxZoom: 14,
            animate: false,
          });
        }
      });

      const elements = new Map<string, { dot: HTMLElement; kind: MapPin["kind"] }>();
      const sides = labelled ? labelSides(pins) : null;
      for (const pin of pins) {
        /*
           A button where clicking one does something, a plain element where it
           does not. The `sr-only` list below carries the names either way, so
           nothing is lost by not making twenty decorative marks focusable.
        */
        const element = document.createElement(interactive ? "button" : "span");
        if (interactive) {
          (element as HTMLButtonElement).type = "button";
          element.setAttribute("aria-label", pin.label);
          element.addEventListener("click", () => onSelectRef.current?.(pin.id));
        } else {
          element.setAttribute("aria-hidden", "true");
        }
        element.title = pin.label;

        /*
           Unlabelled, the element *is* the dot — which is what every caller
           before board 3c gets, byte for byte. Labelled, the dot becomes a
           child and the element becomes the row that holds it and its pill, so
           the class swap on selection still has one node to write to.
        */
        let dot = element;
        let anchor: "left" | "right" | "bottom" | undefined;
        const side = sides?.get(pin.id) ?? null;
        if (sides && side) {
          element.className = cn(
            "flex items-center gap-1",
            side === "top" && "flex-col-reverse gap-0.5",
            side === "start" && "flex-row-reverse",
          );
          dot = document.createElement("span");
          const pill = document.createElement("span");
          pill.className = cn(
            "max-w-[9rem] truncate rounded-tag bg-card/95 px-1.5 py-0.5",
            "font-mono text-eyebrow uppercase tracking-wide text-body shadow-raised",
          );
          pill.textContent = pin.label;
          element.append(dot, pill);
          // The dot sits on the coordinate whichever way the pill runs, so the
          // element's anchor is the edge the dot is on.
          anchor = side === "start" ? "right" : side === "end" ? "left" : "bottom";
        }

        dot.className = pinClass(pin.kind, pin.id === selectedIdRef.current);
        elements.set(pin.id, { dot, kind: pin.kind });
        markersRef.current.push(
          new maplibre.Marker({ element, ...(anchor ? { anchor } : {}) })
            .setLngLat([pin.lng, pin.lat])
            .addTo(map),
        );
      }

      applySelectionRef.current = (id) => {
        for (const [pinId, entry] of elements) {
          entry.dot.className = pinClass(entry.kind, pinId === id);
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
  }, [visible, pins, styleUrl, center, zoom, interactive, label, labelled]);

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
    "block size-3.5 shrink-0 cursor-pointer rounded-pill border-2 transition-colors duration-120 ease-out";
  if (selected || kind === "head_office") return `${base} border-moss bg-moss`;
  if (kind === "verified") return `${base} border-ink bg-ink`;
  /*
     Amber before outlined, so a pin that is both approximate and unverified
     reads as approximate. The two say different things and only one of them is
     actionable: "we are not sure where this is" is a fact about the marker the
     reader is looking at, and it is the one that changes whether they should
     trust the position.
  */
  if (kind === "approximate") return `${base} border-warn bg-warn`;
  return `${base} border-line-strong bg-card`;
}

/**
 * Which side of the dot the label sits on.
 *
 * Two jobs, both from board 3c §The map. Neighbours 15 km apart are about 35 px
 * apart at national zoom, so opposing sides keep two labels legible where one
 * side would overlap them. And a pin on the edge of the bounds must point
 * **inward** — an outward label on the easternmost pin is clipped by the rail
 * however the fit is computed, and no amount of padding fixes it because the
 * pin is at the padding.
 *
 * Inward is decided against the midpoint of the spread rather than the map
 * centre, because the two differ once the fit adds padding and it is the pins
 * that have to stay inside.
 */
type LabelSide = "start" | "end" | "top";

/** About 15 km at this latitude — the distance the board calls "neighbours". */
const CROWDED_DEGREES = 0.15;

function labelSides(pins: readonly MapPin[]): Map<string, LabelSide | null> {
  const sides = new Map<string, LabelSide | null>();
  if (pins.length === 0) return sides;

  const lngs = pins.map((pin) => pin.lng);
  const mid = (Math.min(...lngs) + Math.max(...lngs)) / 2;

  const sorted = [...pins].sort((a, b) => a.lat - b.lat || a.lng - b.lng);
  const placed: { pin: MapPin; side: LabelSide }[] = [];

  for (const pin of sorted) {
    /*
       Which sides are already taken in this pin's neighbourhood.

       Degrees rather than pixels, because the pixels depend on a zoom this
       function does not have and the fit is computed later. Two branches 15 km
       apart are about 35 px apart at national zoom, which is closer than one
       label is tall.
    */
    const taken = new Set(
      placed
        .filter(
          (entry) =>
            Math.abs(entry.pin.lat - pin.lat) < CROWDED_DEGREES &&
            Math.abs(entry.pin.lng - pin.lng) < CROWDED_DEGREES,
        )
        .map((entry) => entry.side),
    );

    /*
       Inward first. A pin on the edge of the bounds must point back into them:
       an outward label on the easternmost pin is clipped by the frame however
       the fit is computed, because the pin is *at* the padding.
    */
    const preferred: LabelSide = pin.lng > mid ? "start" : "end";
    const side = ([preferred, "top", preferred === "start" ? "end" : "start"] as const).find(
      (candidate) => !taken.has(candidate),
    );

    /*
       A fourth pin in one neighbourhood gets a dot and no label.

       Two branches half a kilometre apart cannot both be named at a zoom that
       also has to show a branch 110 km away, and a label lying across another
       label is worse than a label that is not there — the same reasoning that
       keeps an unpinned branch off the map rather than at its area's centre.
       Every name is in the table beside this, and in the `sr-only` list below.
    */
    if (!side) {
      sides.set(pin.id, null);
      continue;
    }
    sides.set(pin.id, side);
    placed.push({ pin, side });
  }
  return sides;
}
