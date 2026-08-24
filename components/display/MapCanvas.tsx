"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import { cn } from "@/lib/cn";

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
  excludedLabel?: (count: number) => string;
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
}

const DEFAULT_STYLE =
  process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/positron";

/** Roughly the centre of the populated UAE, for an empty map. */
const UAE_CENTRE = { lat: 25.05, lng: 55.3 };

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
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(false);
  const id = useId();

  /**
   * MapLibre is ~800 KB and a tile stream that never goes quiet. A storefront
   * with the map below the fold should pay for neither until the reader scrolls
   * to it, so initialisation waits for the frame to come into view.
   */
  useEffect(() => {
    const node = containerRef.current;
    if (!node || visible) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
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
      const maplibre = await import("maplibre-gl");
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

      for (const pin of pins) {
        const element = document.createElement("button");
        element.type = "button";
        element.setAttribute("aria-label", pin.label);
        element.title = pin.label;
        element.className = pinClass(pin.kind, pin.id === selectedId);
        element.addEventListener("click", () => onSelect?.(pin.id));
        markersRef.current.push(
          new maplibre.Marker({ element }).setLngLat([pin.lng, pin.lat]).addTo(map),
        );
      }
    })();

    return () => {
      cancelled = true;
      for (const marker of markersRef.current) marker.remove();
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [visible, pins, styleUrl, center, zoom, selectedId, onSelect]);

  if (pins.length === 0) {
    return (
      <div
        style={{ height }}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-1 rounded-card border border-line",
          "bg-map-base px-4 text-center",
        )}
      >
        <p className="text-caption text-muted">{emptyLabel}</p>
        {excluded > 0 && excludedLabel && (
          <p className="font-mono text-eyebrow text-faint">{excludedLabel(excluded)}</p>
        )}
      </div>
    );
  }

  return (
    <figure className="w-full">
      <div
        ref={containerRef}
        id={id}
        role="img"
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
          {excluded > 0 && excludedLabel ? excludedLabel(excluded) : null}
        </figcaption>
      )}
    </figure>
  );
}

function pinClass(kind: MapPin["kind"], selected: boolean): string {
  const base =
    "block size-3.5 cursor-pointer rounded-pill border-2 transition-colors duration-120 ease-out";
  if (selected || kind === "head_office") return `${base} border-moss bg-moss`;
  if (kind === "verified") return `${base} border-ink bg-ink`;
  return `${base} border-line-strong bg-card`;
}
