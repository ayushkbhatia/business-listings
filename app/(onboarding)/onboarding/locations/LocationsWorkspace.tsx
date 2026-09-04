"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/display";
import { BranchPinMap } from "@/components/display";
import { Button } from "@/components/primitives";
import { EMIRATE_CENTRES } from "@/lib/geo/distance";
import {
  RADIUS_DEFAULT,
  RADIUS_MAX,
  RADIUS_MIN,
  type BranchGap,
} from "@/lib/onboarding/branch-fields";
import type { AreaOption, BranchState, LocationsState } from "@/lib/onboarding/locations";
import { t } from "@/lib/i18n";
import { OnboardingMapSplit } from "../_map-split";
import { useSaved } from "../_saved";
import { BranchCard } from "./BranchCard";
import type {
  ContinueResult,
  countBranchesWithHours,
  createBranch,
  deleteBranch,
  saveBranchField,
  saveHours,
  savePin,
  saveRadius,
} from "./actions";

/**
 * Board 2d's two columns, and the state they share.
 *
 * The left is the branches; the right is the one being edited, on a map. That
 * pairing is the screen's whole argument — a seller who cannot see where the pin
 * lands has no way to tell their gate from the street — so the selected branch
 * lives here, above both, rather than in either.
 *
 * The branch list is held in React state seeded from the server, and every save
 * patches one field. A `router.refresh()` per keystroke would replace what the
 * seller is typing with what the record said a moment ago; the two structural
 * changes that alter what the page is made of — a branch added, a branch removed
 * — do refresh, because there the server is the authority on what exists.
 */

export interface LocationsWorkspaceProps {
  state: LocationsState;
  actions: {
    saveField: typeof saveBranchField;
    savePin: typeof savePin;
    saveRadius: typeof saveRadius;
    saveHours: typeof saveHours;
    countHours: typeof countBranchesWithHours;
    addBranch: typeof createBranch;
    removeBranch: typeof deleteBranch;
    continueToPlan: () => Promise<ContinueResult>;
  };
  /** `Ramadan, about 17 February to 19 March`, already formatted by the server. */
  ramadanWindow: { from: string; to: string; active: boolean } | null;
}

const GAP_LABEL: Record<BranchGap, string> = {
  area: t("locations_step.gap.area"),
  address: t("locations_step.gap.address"),
  contact: t("locations_step.gap.contact"),
  pin: t("locations_step.gap.pin"),
};

export function LocationsWorkspace({ state, actions, ramadanWindow }: LocationsWorkspaceProps) {
  const router = useRouter();
  const { setSaved } = useSaved();

  const [branches, setBranches] = useState<BranchState[]>(state.branches);
  const [selectedId, setSelectedId] = useState(state.branches[0]?.id ?? "");
  const [blocked, setBlocked] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = branches.find((branch) => branch.id === selectedId) ?? branches[0] ?? null;

  /*
     One place that both records a save and updates the header, so the receipt
     and the row can never disagree. Every field, the pin and the radius go
     through it.
  */
  const patched = useCallback(
    (id: string, change: Partial<BranchState>) => {
      setBranches((current) =>
        current.map((branch) => (branch.id === id ? { ...branch, ...change } : branch)),
      );
      setSaved(t("onboarding.saved_now"));
    },
    [setSaved],
  );

  const areasById = useMemo(
    () => new Map(state.areas.map((area) => [area.id, area])),
    [state.areas],
  );

  /*
     Where the map opens on a branch nobody has pinned.

     The area's own centre, and only ever as a viewport. It is never written to
     the row: this platform does not approximate a location to an area centroid,
     because a wrong pin is worse than no pin and the gap is surfaced to the
     seller instead. An area with no coordinates of its own falls back to the
     emirate's centre, which is the same fallback board 1c's origin uses.
  */
  const fallback = useMemo(() => {
    const area = selected ? areasById.get(selected.areaId) : undefined;
    if (area?.lat != null && area.lng != null) return { lat: area.lat, lng: area.lng };
    const centre = selected ? EMIRATE_CENTRES[selected.emirate] : undefined;
    return centre ?? EMIRATE_CENTRES.dubai!;
  }, [selected, areasById]);

  /* ── Continue ──────────────────────────────────────────────────────────── */

  const [continuing, setContinuing] = useState(false);
  const onContinue = () => {
    setBlocked(null);
    setContinuing(true);
    void actions.continueToPlan().then((result) => {
      setContinuing(false);
      if (result.ok) {
        router.push("/onboarding/plan");
        return;
      }
      const first = result.blocking[0];
      if (!first) {
        setBlocked(t("locations_step.blocked_none"));
        return;
      }
      const index = branches.findIndex((branch) => branch.id === first.branchId);
      setSelectedId(first.branchId);
      setBlocked(
        t("locations_step.blocked", {
          n: String(index < 0 ? 1 : index + 1),
          what: listGaps(first.gaps),
        }),
      );
    });
  };

  /* ── Add and remove ────────────────────────────────────────────────────── */

  /*
     A new branch starts in the same area as the first one, unpinned.

     The board's add row carries a counter and a button and no area picker, and
     that is the right shape: the card below has both selects, so asking for the
     area twice is asking for it once too often. What it must not do is drop a
     pin — the area is where to look, never where the branch is.
  */
  const onAdd = () => {
    if (busy) return;
    const areaId = branches[0]?.areaId ?? state.areas[0]?.id;
    if (!areaId) return;
    setBusy(true);
    const form = new FormData();
    form.set("areaId", areaId);
    void actions.addBranch(form).then((result) => {
      setBusy(false);
      if (!result.ok) {
        setBlocked(
          result.reason === "at_cap"
            ? t("locations_step.error.at_cap", {
                plan: state.allowance.planName,
                cap: String(state.allowance.cap ?? 1),
              })
            : t("locations_step.error.area"),
        );
        return;
      }
      // The server is the authority on what branches exist, so the list comes
      // back from it rather than being guessed at here.
      router.refresh();
    });
  };

  const onRemove = (branchId: string) => {
    if (busy) return;
    setBusy(true);
    const form = new FormData();
    form.set("branchId", branchId);
    void actions.removeBranch(form).then((result) => {
      setBusy(false);
      if (!result.ok) {
        setBlocked(t("locations_step.last_branch"));
        return;
      }
      if (branchId === selectedId) setSelectedId("");
      router.refresh();
    });
  };

  /* ── The pin and the radius, both from the map ─────────────────────────── */

  const onPin = (position: { lat: number; lng: number }) => {
    if (!selected) return;
    const branchId = selected.id;
    // Optimistic: the marker is already where the seller dropped it, and a pin
    // that jumped back for a round trip would read as the drag having failed.
    patched(branchId, { lat: position.lat, lng: position.lng, pinned: true });

    const form = new FormData();
    form.set("branchId", branchId);
    form.set("lat", String(position.lat));
    form.set("lng", String(position.lng));
    void actions.savePin(form).then((result) => {
      if (result.ok) {
        setBranches((current) =>
          current.map((branch) =>
            branch.id === branchId
              ? { ...branch, gaps: branch.gaps.filter((gap) => gap !== "pin") }
              : branch,
          ),
        );
        return;
      }
      // Put it back where the record still says it is, and say why.
      setBranches((current) => current.map((branch) => (branch.id === branchId ? selected : branch)));
      setBlocked(
        result.reason === "out_of_bounds"
          ? t("locations_step.error.pin_bounds")
          : t("locations_step.error.save_failed"),
      );
    });
  };

  const onRadius = (km: number) => {
    if (!selected) return;
    const branchId = selected.id;
    patched(branchId, { serviceRadiusKm: km });
    const form = new FormData();
    form.set("branchId", branchId);
    form.set("km", String(km));
    void actions.saveRadius(form);
  };

  /*
     The map half. Built here rather than by the page, because it needs the
     selected branch and the two handlers that write to it — and the alternative
     is a context spanning two halves of a split that nothing else shares.
  */
  const mapHalf = selected ? (
    <BranchPinMap
      key={selected.id}
      lat={selected.lat}
      lng={selected.lng}
      fallback={fallback}
      label={branchLabel(selected)}
      onPin={onPin}
      radiusKm={selected.serviceRadiusKm}
      onRadius={onRadius}
      radiusMin={RADIUS_MIN}
      radiusMax={RADIUS_MAX}
      radiusDefault={RADIUS_DEFAULT}
      mapLabel={t("locations_step.map_label")}
      dragHint={t("locations_step.drag_hint")}
      unpinnedHint={t("locations_step.unpinned_hint")}
      radiusTitle={t("locations_step.radius")}
      radiusNote={t("locations_step.radius_note")}
      radiusEdit={t("locations_step.radius_edit")}
      radiusDone={t("locations_step.radius_done")}
      radiusNone={t("locations_step.radius_none")}
      radiusSliderLabel={t("locations_step.radius_slider")}
      formatRadius={(km) => t("locations_step.radius_km", { km: String(km) })}
      unavailableLabel={t("locations_step.map_unavailable")}
    />
  ) : (
    <div className="size-full bg-map-base" />
  );

  return (
    <OnboardingMapSplit map={mapHalf}>
      <h1 className="font-serif text-h1-serif text-ink sm:text-[2rem]">
        {t("locations_step.title")}
      </h1>
      <p className="mt-2.5 max-w-prose text-body-sm text-body">{t("locations_step.intro")}</p>

      <div className="mt-6 flex flex-col gap-4">
        {blocked && (
          <Alert tone="bad" live="assertive" fix={t("locations_step.not_pinned_help")}>
            {blocked}
          </Alert>
        )}
        {notice && (
          <Alert tone="ok" live="polite">
            {notice}
          </Alert>
        )}

        {branches.length === 0 && (
          <Alert tone="info" live="off">
            {t("locations_step.blocked_none")}
          </Alert>
        )}

        <ul className="flex list-none flex-col gap-4 p-0">
          {branches.map((branch, index) => (
            <li key={branch.id}>
              <BranchCard
                branch={branch}
                index={index + 1}
                areas={state.areas}
                selected={branch.id === selected?.id}
                canRemove={branches.length > 1}
                ramadanWindow={ramadanWindow}
                onSelect={() => setSelectedId(branch.id)}
                onPatched={patched}
                onRemove={() => onRemove(branch.id)}
                onNotice={setNotice}
                actions={{
                  saveField: actions.saveField,
                  saveHours: actions.saveHours,
                  countHours: actions.countHours,
                }}
              />
            </li>
          ))}
        </ul>

        {/*
          The counter and the control beside it. Criterion 2: where the plan's
          cap is reached the control is a link to the plan step, never a dashed
          "+ Add" that would be refused on click — a cap that is real only in the
          API's rejection is a screen that disagrees with its own product.
        */}
        <div className="flex flex-wrap items-center gap-3 rounded-card border border-dashed border-line-strong bg-card px-4 py-3">
          <p className="text-body-sm text-body">{counterLabel(state)}</p>

          {state.allowance.canAddMore ? (
            /* Button deliberately takes no className, so the margin sits on a
               wrapper rather than being smuggled into the primitive. */
            <span className="ms-auto">
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || state.areas.length === 0}
                onClick={onAdd}
              >
                {t("locations_step.add")}
              </Button>
            </span>
          ) : (
            state.upgrade && (
              <Link
                href="/onboarding/plan"
                className="ms-auto inline-flex w-fit items-center rounded-pill border border-dashed border-line-strong px-3 py-1.5 text-caption text-moss hover:bg-fill focus-visible:shadow-focus focus-visible:outline-none"
              >
                {state.upgrade.cap === null
                  ? t("locations_step.upgrade_unlimited", { plan: state.upgrade.planName })
                  : t("locations_step.upgrade", {
                      plan: state.upgrade.planName,
                      cap: String(state.upgrade.cap),
                    })}
              </Link>
            )
          )}
        </div>

        {/*
          Continue and Back. Back exists here and did not on 2c, because this
          step is editable and re-enterable — nothing was proved or submitted.
          Steps 1 and 2 are irreversible, so Back reaches 2c and stops there.
        */}
        <div className="flex flex-wrap items-center gap-2.5">
          <Button size="lg" disabled={continuing} onClick={onContinue}>
            {t("locations_step.continue")}
          </Button>
          <Button size="lg" variant="secondary" onClick={() => router.push("/onboarding/profile")}>
            {t("locations_step.back")}
          </Button>
        </div>
        <p className="text-caption text-muted">{t("locations_step.live_note")}</p>
      </div>
    </OnboardingMapSplit>
  );
}

/** The pill on the pin is the branch, never the company — board 2d's contract. */
function branchLabel(branch: BranchState): string {
  return `${t(`locations.type.${branch.type}` as never)} — ${branch.areaName}`;
}

/** `1 of 3 locations used on Basic`. Singular where the cap is one. */
function counterLabel(state: LocationsState): string {
  const { used, cap, planName } = state.allowance;
  if (cap === null) {
    return t("locations_step.counter_unlimited", { used: String(used), plan: planName });
  }
  const key = cap === 1 ? "locations_step.counter_one" : "locations_step.counter";
  return t(key, { used: String(used), cap: String(cap), plan: planName });
}

/** `an area and a pin on the map`. */
function listGaps(gaps: readonly BranchGap[]): string {
  const words = gaps.map((gap) => GAP_LABEL[gap]);
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")}${t("locations_step.gap_join")}${words.at(-1)}`;
}
