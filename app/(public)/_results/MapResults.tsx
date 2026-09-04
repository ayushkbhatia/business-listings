"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ResultsMap, type FreeZoneMark, type ResultsMapPin } from "@/components/display";
import { cn } from "@/lib/cn";
import { formatBounds, type MapBounds } from "@/lib/search/query";

/**
 * The split layout, and the two-way link between a row and its pin.
 *
 * ## Why the rows are not client components
 *
 * They arrive as `children` — server-rendered `ListingCard`s inside an `ol`.
 * The board's result column is the page's crawlable content and has to work
 * with JavaScript off; making each row a client component to attach a hover
 * handler would ship twenty islands to gain a mouse effect, and criterion 12
 * asks for results present without JS.
 *
 * So this listens once, at the list, and reads `data-business-id` off whatever
 * the pointer is over. Selection is applied as a `data-selected` attribute
 * rather than by re-rendering, for the same reason: the markup is the server's,
 * and this only decorates it.
 *
 * ## What "Search this area" does, and what panning does not
 *
 * Panning changes nothing. Criterion 6 is explicit that only the button
 * re-queries, and it does so by writing `bounds` to the URL — which is also
 * what makes a pasted link reproduce the viewport. A map that re-ranked the
 * list on every drag would fight the reader.
 */

export interface MapResultsProps {
  pins: readonly ResultsMapPin[];
  freeZones: readonly FreeZoneMark[];
  excluded: number;
  excludedLabel: string;
  cappedLabel?: string;
  bounds?: MapBounds;
  mapLabel: string;
  labels: {
    searchArea: string;
    freeZones: string;
    legend: string;
    legendHeadOffice: string;
    legendVerified: string;
    legendUnverified: string;
    empty: string;
    showList: string;
    showMap: string;
  };
  /** The server-rendered result column. */
  children: React.ReactNode;
}

export function MapResults({
  pins,
  freeZones,
  excluded,
  excludedLabel,
  cappedLabel,
  bounds,
  mapLabel,
  labels,
  children,
}: MapResultsProps) {
  const router = useRouter();
  const params = useSearchParams();
  const listRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  /*
     Below 1024 the two are mutually exclusive — criterion 12. A 200px map above
     a list is useless at that size, which the board says in as many words, so
     this is a real switch rather than a stacked layout.
  */
  const [pane, setPane] = useState<"list" | "map">("list");

  /** Paint the selection onto server-rendered markup, without re-rendering it. */
  useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    for (const row of root.querySelectorAll<HTMLElement>("[data-business-id]")) {
      row.toggleAttribute("data-selected", row.dataset["businessId"] === selected);
    }
  }, [selected, children]);

  const onListPointer = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-business-id]");
    setSelected(row?.dataset["businessId"] ?? null);
  }, []);

  const onPinSelect = useCallback((businessId: string) => {
    setSelected(businessId);
    setPane("list");
    /*
       Clicking a pin scrolls its row in — criterion 5's other half. Deferred a
       frame because on a narrow screen the list may have been display:none
       until `setPane` above, and an element with no box cannot be scrolled to.
    */
    requestAnimationFrame(() => {
      listRef.current
        ?.querySelector(`[data-business-id="${CSS.escape(businessId)}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, []);

  const onSearchArea = useCallback(
    (box: MapBounds) => {
      const next = new URLSearchParams(params.toString());
      next.set("bounds", formatBounds(box));
      // Page 1: the buyer has changed the question, and staying on page 3 of
      // the previous answer is how a result set appears to be empty.
      next.delete("page");
      router.push(`/search?${next.toString()}`);
    },
    [params, router],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ── The pane switch, below 1024 only ─────────────────────────────── */}
      <div className="flex gap-1 border-b border-line bg-card px-4 py-2 lg:hidden">
        {(["list", "map"] as const).map((which) => (
          <button
            key={which}
            type="button"
            onClick={() => setPane(which)}
            aria-pressed={pane === which}
            className={cn(
              "flex-1 rounded-ctl px-3 py-1.5 text-body-sm font-medium",
              "focus-visible:outline-none focus-visible:shadow-focus",
              pane === which ? "bg-ink text-on-ink" : "bg-paper text-body hover:text-ink",
            )}
          >
            {which === "list" ? labels.showList : labels.showMap}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 lg:grid lg:grid-cols-[664px_minmax(0,1fr)] xl:grid-cols-[664px_minmax(0,1fr)]">
        {/*
           664px at ≥1280 and again at 1024, which is narrower than the board's
           1024–1279 note asks for. The alternative was a third breakpoint whose
           only effect is 104px of list width; the thumbnail already drops at
           `lg` and that is the change a reader actually feels.
        */}
        <div
          ref={listRef}
          onPointerOver={onListPointer}
          onPointerLeave={() => setSelected(null)}
          className={cn(
            "min-w-0 overflow-y-auto border-line bg-paper lg:block lg:border-r",
            pane === "list" ? "block" : "hidden",
          )}
        >
          {children}
        </div>

        <div className={cn("min-h-[28rem] lg:block", pane === "map" ? "block" : "hidden")}>
          <ResultsMap
            pins={pins}
            freeZones={freeZones}
            excluded={excluded}
            excludedLabel={excludedLabel}
            selectedId={selected}
            onSelect={onPinSelect}
            onHover={setSelected}
            onSearchArea={onSearchArea}
            {...(bounds ? { bounds } : {})}
            label={mapLabel}
            labels={{
              searchArea: labels.searchArea,
              freeZones: labels.freeZones,
              legend: labels.legend,
              legendHeadOffice: labels.legendHeadOffice,
              legendVerified: labels.legendVerified,
              legendUnverified: labels.legendUnverified,
              empty: labels.empty,
              ...(cappedLabel ? { capped: cappedLabel } : {}),
            }}
          />
        </div>
      </div>
    </div>
  );
}
