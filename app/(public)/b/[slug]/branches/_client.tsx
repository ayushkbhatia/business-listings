"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { MapCanvas, type MapPin } from "@/components/display";
import { SegmentedControl } from "@/components/primitives";
import { haversineKm } from "@/lib/geo/distance";
import { cn } from "@/lib/cn";

/**
 * The interactive half of board 1f: the order, the selection and the overlay.
 *
 * Every branch arrives as two already-rendered nodes — expanded and compact —
 * rather than as data this component formats. That is the lesson boards 1d and
 * 1e both paid for: a function cannot cross the server/client boundary, and the
 * first version of each page passed one and rendered nothing at all. Elements
 * serialise, so the server does the formatting, the localisation and the
 * open-now evaluation, and this file decides only what to show and in what
 * order.
 *
 * It also means the Dubai clock stays on the server. An "Open now" computed in
 * the browser would be computed against the reader's timezone, which is the
 * exact bug criterion 2 exists to prevent.
 */

export interface ClientBranch {
  id: string;
  lat: number | null;
  lng: number | null;
  radiusKm: number | null;
  /** For the map pin's accessible name. Already localised. */
  label: string;
  kind: MapPin["kind"];
  expanded: React.ReactNode;
  compact: React.ReactNode;
}

export interface BranchesClientProps {
  branches: readonly ClientBranch[];
  /** The map's empty and excluded states, pre-localised. */
  mapLabel: string;
  excluded: number;
  excludedLabel: string;
  noPinsLabel: string;
  /** The strip, the toggle and the overlay button. */
  countEyebrow: string;
  sortedEmirateLabel: string;
  sortedDistanceLabel: string;
  nearestLabel: string;
  locatingLabel: string;
  declinedLabel: string;
  radiusLabel: string;
  listLabel: string;
  mapViewLabel: string;
  distanceTemplate: string;
  /** Pinned to the bottom of the column when the window is open. */
  ramadanStrip?: React.ReactNode;
  /** Sits on the map, and survives the map being replaced by the no-pins panel. */
  deliveryCard?: React.ReactNode;
}

export function BranchesClient({
  branches,
  mapLabel,
  excluded,
  excludedLabel,
  noPinsLabel,
  countEyebrow,
  sortedEmirateLabel,
  sortedDistanceLabel,
  nearestLabel,
  locatingLabel,
  declinedLabel,
  radiusLabel,
  listLabel,
  mapViewLabel,
  distanceTemplate,
  ramadanStrip,
  deliveryCard,
}: BranchesClientProps) {
  const [selectedId, setSelectedId] = useState(branches[0]?.id);
  const [hoverId, setHoverId] = useState<string | undefined>(undefined);
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [radiusOn, setRadiusOn] = useState(false);
  const [view, setView] = useState<"list" | "map">("list");
  const rowsRef = useRef(new Map<string, HTMLLIElement>());

  /*
     The server's order is the emirate order, and it stays that way until the
     buyer asks otherwise. Re-sorting on the client only happens once an origin
     exists, so the first paint and the hydrated tree always agree.
  */
  const { ordered, distances } = useMemo(() => {
    if (!origin) return { ordered: branches, distances: new Map<string, number>() };
    const distances = new Map<string, number>();
    for (const branch of branches) {
      if (branch.lat == null || branch.lng == null) continue;
      distances.set(branch.id, haversineKm(origin, { lat: branch.lat, lng: branch.lng }));
    }
    const ordered = [...branches].sort((a, b) => {
      const left = distances.get(a.id);
      const right = distances.get(b.id);
      if (left == null && right == null) return 0;
      // An unpinned branch cannot be measured, so it sits at the end rather than
      // being given a centroid it would then be sorted by.
      if (left == null) return 1;
      if (right == null) return -1;
      return left - right;
    });
    return { ordered, distances };
  }, [branches, origin]);

  const pins = useMemo(
    () =>
      branches
        .filter((branch) => branch.lat != null && branch.lng != null)
        .map((branch) => ({
          id: branch.id,
          lat: branch.lat!,
          lng: branch.lng!,
          label: branch.label,
          kind: branch.kind,
        })),
    [branches],
  );

  const radii = useMemo(
    () =>
      radiusOn
        ? branches
            .filter((b) => b.lat != null && b.lng != null && b.radiusKm != null)
            .map((b) => ({ id: b.id, lat: b.lat!, lng: b.lng!, km: b.radiusKm! }))
        : undefined,
    [branches, radiusOn],
  );

  /*
     Criterion 11, the map half: a pin click selects the branch and brings it
     into view. Without the scroll, clicking pin 4 on a supplier with nine
     branches expands a card the reader cannot see.
  */
  const select = useCallback((id: string) => {
    setSelectedId(id);
    rowsRef.current.get(id)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  /*
     Criterion 8. On click, never on load — a page that asks for a location the
     moment it opens trains people to refuse, and this one only needs it if the
     buyer says "which of these is closest to me".
  */
  const locate = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setDeclined(true);
      return;
    }
    setLocating(true);
    setDeclined(false);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setOrigin({ lat: position.coords.latitude, lng: position.coords.longitude });
        setLocating(false);
      },
      () => {
        // Declined, blocked or timed out. All three leave the emirate order in
        // place and say so — never a silent no-op.
        setLocating(false);
        setDeclined(true);
      },
      { timeout: 8000, maximumAge: 300_000 },
    );
  }, []);

  const hasPins = pins.length > 0;

  return (
    <div className="grid gap-0 lg:grid-cols-[minmax(0,37.5rem)_minmax(0,1fr)]">
      {/* ── Detail column ─────────────────────────────────────────────────── */}
      <div
        className={cn(
          "flex min-w-0 flex-col border-line bg-paper lg:border-r",
          view === "map" && "hidden md:max-lg:hidden",
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4 md:px-7">
          <span className="font-mono text-eyebrow uppercase tracking-eyebrow text-faint">
            {origin ? sortedDistanceLabel : branches.length > 1 ? sortedEmirateLabel : countEyebrow}
          </span>
          {/*
             Hidden for a single-location supplier: "nearest to me" among one
             branch is a question with no answer, and asking for a location to
             produce it is a permission prompt for nothing.
          */}
          {branches.length > 1 && (
            <button
              type="button"
              onClick={locate}
              disabled={locating}
              className={cn(
                "rounded-ctl px-1 text-body-sm font-medium text-moss",
                "hover:underline focus-visible:outline-none focus-visible:shadow-focus",
                "disabled:cursor-progress disabled:text-muted",
              )}
            >
              {locating ? locatingLabel : nearestLabel}
            </button>
          )}
        </div>

        {declined && (
          <p role="status" className="border-b border-line bg-paper-sunk px-5 py-2 text-caption text-muted md:px-7">
            {declinedLabel}
          </p>
        )}

        <ul className="flex flex-col">
          {ordered.map((branch, index) => {
            const isSelected = branch.id === selectedId;
            const km = distances.get(branch.id);
            return (
              <li
                key={branch.id}
                ref={(node) => {
                  if (node) rowsRef.current.set(branch.id, node);
                  else rowsRef.current.delete(branch.id);
                }}
                /*
                   Criterion 11, the list half. Hover raises the pin; focus does
                   the same so the link between the two is not mouse-only.
                */
                onMouseEnter={() => setHoverId(branch.id)}
                onMouseLeave={() => setHoverId(undefined)}
                onFocus={() => setHoverId(branch.id)}
                onBlur={() => setHoverId(undefined)}
                className={cn(
                  "border-b border-line",
                  isSelected ? "bg-card" : "bg-transparent",
                )}
              >
                <div className="flex items-start gap-3 px-5 py-4 md:px-7">
                  <button
                    type="button"
                    onClick={() => setSelectedId(branch.id)}
                    aria-expanded={isSelected}
                    aria-label={branch.label}
                    className={cn(
                      "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-pill",
                      "font-mono text-eyebrow text-white",
                      "focus-visible:outline-none focus-visible:shadow-focus",
                      isSelected ? "bg-moss" : "bg-ink",
                    )}
                  >
                    {index + 1}
                  </button>
                  <div className="min-w-0 flex-1">
                    {isSelected ? branch.expanded : branch.compact}
                    {km != null && (
                      <p className="mt-2 font-mono text-eyebrow tabular-nums text-faint">
                        {distanceTemplate.replace("{km}", km.toFixed(1))}
                      </p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {/*
           The delivery card, for the widths where there is no map to put it on.

           Below `lg` the map column is behind a toggle or gone entirely, and
           the card would go with it — on a phone, which is where "can I get it
           today" is asked most often. Rendered twice with `display` at opposite
           breakpoints so exactly one is ever in the accessibility tree; that is
           the same trick board 1d used for the mobile action bar, and for the
           same reason: `visibility` would leave two of them for a screen reader.
        */}
        {deliveryCard && <div className="border-t border-line px-5 py-4 lg:hidden md:px-7">{deliveryCard}</div>}

        {ramadanStrip && <div className="mt-auto">{ramadanStrip}</div>}
      </div>

      {/* ── Map column ────────────────────────────────────────────────────── */}
      <div
        className={cn(
          "relative min-w-0",
          // 768–1023: one at a time, driven by the segmented toggle.
          view === "list" && "hidden lg:block",
        )}
      >
        {hasPins ? (
          <MapCanvas
            label={mapLabel}
            height={686}
            pins={pins}
            radii={radii}
            /*
               Hover wins over selection, because hover is the more recent
               intent and it is transient — the raised pin follows the finger
               down the list and settles back on the selected branch.
            */
            selectedId={hoverId ?? selectedId}
            onSelect={select}
            excluded={excluded}
            excludedLabel={excludedLabel}
            emptyLabel={noPinsLabel}
          />
        ) : (
          /*
             Criterion 5: every branch unpinned replaces the map with a sentence
             that explains the absence, and keeps the delivery card — which
             answers "can I get it today" and does not need a map to be true.
          */
          <div
            role="group"
            aria-label={mapLabel}
            className="flex h-full min-h-[20rem] items-center justify-center rounded-none border-line bg-paper-sunk p-6 lg:border-l-0"
          >
            <p className="max-w-[22rem] text-center text-body-sm text-muted">{noPinsLabel}</p>
          </div>
        )}

        {/* Overlay toggle. The button owns no state the map cannot see. */}
        {hasPins && branches.some((b) => b.radiusKm != null) && (
          <button
            type="button"
            onClick={() => setRadiusOn((on) => !on)}
            aria-pressed={radiusOn}
            className={cn(
              "absolute right-4 top-4 z-[1] rounded-ctl border border-line px-3 py-1.5",
              "bg-card text-body-sm font-medium text-ink shadow-overlay",
              "hover:bg-paper focus-visible:outline-none focus-visible:shadow-focus",
              radiusOn && "border-moss text-moss",
            )}
          >
            {radiusLabel}
          </button>
        )}

        {deliveryCard && (
          <div className="absolute bottom-4 left-4 z-[1] hidden max-w-[15.625rem] lg:block">
            {deliveryCard}
          </div>
        )}
      </div>

      {/*
         The 768–1023 segmented toggle. Below 768 the list is the whole page and
         each branch carries its own native-maps hand-off, so this is hidden at
         both ends of the range rather than only the top.
      */}
      <div className="order-first hidden border-b border-line bg-card px-5 py-2 md:max-lg:block">
        <SegmentedControl
          label={mapLabel}
          value={view}
          onChange={setView}
          block
          options={[
            { value: "list", label: listLabel },
            { value: "map", label: mapViewLabel },
          ]}
        />
      </div>
    </div>
  );
}
