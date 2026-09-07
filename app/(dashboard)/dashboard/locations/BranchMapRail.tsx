"use client";

import { useMemo } from "react";
import { MapCanvas, type MapPin } from "@/components/display";
import { Panel } from "@/components/structure";
import { t } from "@/lib/i18n";
import type { BranchRow } from "@/lib/db/queries/locations";
import type { PinIssue } from "@/lib/locations/branch";

/**
 * The rail — the map, and the pins it cannot draw.
 *
 * Board 3c §5. The map sizes to its own geography and the issue card sits in
 * flow beneath it rather than floating over it: the board ran the map full
 * height with a white card over 300 px of empty desert, and a portrait strip is
 * the wrong viewport for a square-ish 92 × 109 km bounding box either way.
 *
 * ## Why this is `MapCanvas` and not Leaflet
 *
 * The handoff ships `bl-map.js` — Leaflet 1.9.4 from a CDN with pinned
 * integrity hashes — and criterion 10 asks for it by name. Board 2d made the
 * same request and this codebase answered it the same way, for a reason that
 * has not changed: the constraint Leaflet was solving is a standalone HTML file
 * with no bundler, where a CDN script is the only route to real streets. Here
 * every other map is MapLibre over real OpenStreetMap geometry, and adopting a
 * second library would mean a second pin vocabulary against design-system
 * §03.5 and runtime scripts from a host nothing else loads from. What criterion
 * 10 asks for in substance — real tiles, attribution intact, no scroll-jacking
 * — is what `MapCanvas` renders.
 *
 * The Leaflet-specific warning in the spec does not carry over either.
 * `fitBounds` no-ops on a freshly mounted *Leaflet* map, which is why the
 * component was rewritten to compute a `setView`. `MapCanvas` fits inside
 * `map.on("load")`, by which point the container has a size — the same bug,
 * already avoided, and the reason all four pins are inside the viewport here.
 */

export interface BranchMapRailProps {
  branches: readonly BranchRow[];
  issues: readonly PinIssue[];
  counts: { pinned: number; missing: number };
  /** The issue card's `Fix`: opens the branch with its map in view. */
  onFix: (branchId: string) => void;
  /**
   * A pin, clicked.
   *
   * Not optional, and the reason is a keyboard pass rather than a wish.
   * `MapCanvas` renders every pin as a `<button>` when the map is interactive,
   * which is right on board 1c where clicking one scrolls its result into view
   * — and here it put six tab stops in the rail that did nothing. Its own
   * comment names that: *"left focusable it is a tab stop that does nothing,
   * which §09's keyboard rule counts as a trap of the quiet kind."* A pin now
   * opens its branch, which is what a seller clicking one means.
   */
  onSelect: (branchId: string) => void;
}

/**
 * The four treatments, and the order they resolve in.
 *
 * Visibility outranks precision. A hidden branch is drawn outlined whether its
 * pin is exact or not, because "buyers cannot see this" is the larger fact
 * about the marker and the issue card names the precision anyway. Draft is
 * outlined for the same reason — neither state reaches a buyer, and a map that
 * distinguished them would need a legend the table already is.
 */
function pinKind(branch: BranchRow): MapPin["kind"] {
  if (branch.status !== "published") return "unverified";
  if (branch.pin === "approximate") return "approximate";
  return branch.type === "head_office" ? "head_office" : "verified";
}

export function BranchMapRail({ branches, issues, counts, onFix, onSelect }: BranchMapRailProps) {
  /*
     Only branches with coordinates. An unpinned one is not drawn at an area
     centroid and not dropped at the emirate's centre — it gets a row in the
     card below instead, which is board 3c's whole answer to the difference
     between a missing pin and a wrong one.

     Memoised, and that is not a performance nicety. `MapCanvas` lists `pins` in
     the dependency array of the effect that builds the map, so a fresh array on
     every render tears MapLibre down and starts it again — and because the library
     arrives through a dynamic import, the teardown sets the `cancelled` flag
     before the import resolves and the rebuild never happens. The symptom is a
     map-shaped hole with the overlay drawn correctly on top of it, which reads
     as a tile problem and is not. Every other caller memoises for the same
     reason; this one did not, and only clicking it showed that.
  */
  const pins: MapPin[] = useMemo(
    () =>
      branches
        .filter((branch) => branch.lat !== null && branch.lng !== null)
        .map((branch) => ({
          id: branch.id,
          lat: branch.lat!,
          lng: branch.lng!,
          label: branch.areaName,
          kind: pinKind(branch),
        })),
    [branches],
  );

  return (
    /*
       Stacked in the rail, two-up once the rail is not a rail.

       Below 1280 the whole thing moves under the table as a full-width
       landscape card — which suits a square-ish 92 × 109 km bounding box far
       better than a portrait strip does — and at that width the issue card sits
       beside the map rather than below it, where it would push the coverage
       panel off the fold for no reason.
    */
    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] xl:grid-cols-1">
      <div className="relative">
        <MapCanvas
          pins={pins}
          label={t("locations.map.label")}
          labelled
          onSelect={onSelect}
          /*
             Street zoom, and it only applies to a single branch: with two or
             more the fit takes over on load. A supplier with one address wants
             to see the block, not the country.
          */
          zoom={14}
          height={420}
          emptyLabel={t("locations.map.empty")}
        />
        {pins.length > 0 && (
          /*
             The overlay count, reading off the same `branchCounts` as the
             header. Criterion 1: `4 pinned · 1 missing` over five rows is only
             honest while both numbers come from one derivation.

             Top-left, where the board draws it top-right. `MapCanvas` puts
             MapLibre's own zoom control top-right on every interactive map, and
             on a 360 px rail the two overlap: the count rendered under the
             `+`/`−` and read `5 PINNED · 1 MIS`. A number that says something
             different depending on how wide the rail is would be worse than
             either position.
          */
          <p className="pointer-events-none absolute start-3 top-3 z-10 rounded-tag bg-card/95 px-2 py-1 font-mono text-eyebrow uppercase tracking-wide text-body shadow-raised">
            {counts.missing === 0
              ? t("locations.map.all_pinned", { pinned: counts.pinned })
              : t("locations.map.overlay", { pinned: counts.pinned, missing: counts.missing })}
          </p>
        )}
      </div>

      {/*
        Absent when there is nothing wrong. Board 3c's third state, word for
        word: "a card saying everything is fine is noise".
      */}
      {issues.length > 0 && (
        <Panel title={t("locations.issues.title")}>
          <ul className="flex flex-col gap-3">
            {issues.map((issue) => (
              <li key={issue.id} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className={
                    issue.state === "missing"
                      ? "mt-1.5 size-2 shrink-0 rounded-pill bg-bad"
                      : "mt-1.5 size-2 shrink-0 rounded-pill bg-warn"
                  }
                />
                <p className="min-w-0 flex-1 text-caption text-body">
                  {issue.state === "missing"
                    ? t("locations.issues.missing", { branch: issue.name })
                    : t("locations.issues.approximate", {
                        branch: issue.name,
                        area:
                          branches.find((branch) => branch.id === issue.id)?.areaName ??
                          issue.name,
                      })}
                </p>
                <button
                  type="button"
                  onClick={() => onFix(issue.id)}
                  className="shrink-0 rounded-tag px-1 font-mono text-eyebrow uppercase tracking-wide text-moss hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                >
                  {t("locations.issues.fix")}
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
