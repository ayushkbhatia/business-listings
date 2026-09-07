"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Alert } from "@/components/display";
import { BranchPinMap } from "@/components/display/BranchPinMap";
import { Button, Input, Select } from "@/components/primitives";
import { EmirateAreaPicker, type AreaOption } from "@/components/domain";
import { t } from "@/lib/i18n";
import { formatKm } from "@/lib/format";
import { RADIUS_DEFAULT, RADIUS_MAX, RADIUS_MIN } from "@/lib/onboarding/branch-fields";
import type { BranchRow } from "@/lib/db/queries/locations";
import type { DeleteResult, LocationResult, PinActionResult } from "./actions";

/**
 * The branch behind `Edit`, and the map behind `Fix`.
 *
 * Board 3c puts the editor out of scope — *"that is 2d's form in steady state
 * — same fields, and it owns pin dragging"* — so this is that form, moved into
 * a drawer and given the one thing the manager screen cannot do without it.
 *
 * The map is not an extra. The issue card's `Fix` has to arrive somewhere, and
 * `Missing` and `Approx` are only fixable by a person putting the marker on
 * their gate: nothing can look at a pair of floats and decide they are a
 * building rather than an area centre. Without this the two states the screen
 * exists to surface would be surfaced and unactionable.
 *
 * There is no publish toggle. Status is the table's, with `hideConsequence` in
 * front of it — a checkbox here would be a second writer for the same column
 * and the only one that could not say what hiding costs.
 */

const TYPES = ["head_office", "warehouse", "trade_counter", "depot", "sales_office", "workshop"] as const;

/** Where the map looks when there is no pin. Never *as* the pin. */
const UAE_CENTRE = { lat: 25.2048, lng: 55.2708 };

export interface BranchEditorProps {
  /** Null for a branch that does not exist yet. */
  branch: BranchRow | null;
  areas: readonly AreaOption[];
  /** Area centres, so a new branch opens the map where it is going to be. */
  areaCentres: Readonly<Record<string, { lat: number; lng: number }>>;
  /** Opened from the issue card: put the seller on the map, not the form. */
  focusPin: boolean;
  saveAction: (formData: FormData) => Promise<LocationResult>;
  deleteAction: (formData: FormData) => Promise<DeleteResult>;
  pinAction: (formData: FormData) => Promise<PinActionResult>;
  onDone: () => void;
  readOnly?: boolean;
}

export function BranchEditor(props: BranchEditorProps) {
  const { branch } = props;
  const [emirate, setEmirate] = useState<string | null>(branch?.emirate ?? null);
  const [areaId, setAreaId] = useState<string | null>(branch?.areaId ?? null);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(
    branch && branch.lat !== null && branch.lng !== null
      ? { lat: branch.lat, lng: branch.lng }
      : null,
  );
  const [radiusKm, setRadiusKm] = useState<number | null>(branch?.serviceRadiusKm ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<{ error: string; fix: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const mapRef = useRef<HTMLDivElement>(null);

  /*
     Arriving from `Fix` means the pin is the errand.

     The drawer opens at the top of a form whose fields are all fine; scrolling
     the map into view is the difference between "here is the branch you asked
     about" and "here is a form, find the map".
  */
  useEffect(() => {
    if (!props.focusPin) return;
    mapRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [props.focusPin]);

  /**
   * The pin saves on drag end, on its own.
   *
   * Separate from the form submit because it is a different kind of edit: the
   * seller has already expressed the change by letting go of the marker, and a
   * `Save` they then have to find is how a corrected pin gets lost. It is also
   * the one write that sets `geocode_precision` to `exact`, which is a record
   * of *who placed it* rather than a judgement about the coordinates.
   */
  function commitPin(next: { lat: number; lng: number } | null) {
    setPin(next);
    /*
       A branch that does not exist yet cannot carry a pin.

       The marker is still draggable, and the position is held here until the
       first save creates the row — dropping the write silently would be a pin
       the seller placed and watched disappear. `onSubmit` posts it with
       everything else.
    */
    if (!branch) return;
    const form = new FormData();
    form.set("id", branch.id);
    if (next) {
      form.set("lat", String(next.lat));
      form.set("lng", String(next.lng));
    }
    setError(null);
    startTransition(async () => {
      const result = await props.pinAction(form);
      if (!result.ok) setError(result);
      else setNotice(t("locations.saved"));
    });
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (branch) form.set("id", branch.id);
    form.set("areaId", areaId ?? "");
    setError(null);
    startTransition(async () => {
      const result = await props.saveAction(form);
      if (!result.ok) {
        setError(result);
        return;
      }
      // A pin dropped before the row existed, written now that it does.
      if (!branch && pin) {
        const pinForm = new FormData();
        pinForm.set("id", result.id);
        pinForm.set("lat", String(pin.lat));
        pinForm.set("lng", String(pin.lng));
        const pinned = await props.pinAction(pinForm);
        if (!pinned.ok) {
          setError(pinned);
          return;
        }
      }
      setNotice(t("locations.saved"));
      if (!branch) props.onDone();
    });
  }

  const area = props.areas.find((option) => option.id === areaId);

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {error && (
        <Alert tone="bad" live="assertive" fix={error.fix}>
          {error.error}
        </Alert>
      )}

      <div ref={mapRef} className="h-80">
        <BranchPinMap
          lat={pin?.lat ?? null}
          lng={pin?.lng ?? null}
          fallback={
            branch?.areaCentre ??
            (areaId ? props.areaCentres[areaId] : undefined) ??
            UAE_CENTRE
          }
          label={branch?.name ?? t("locations.add")}
          onPin={commitPin}
          radiusKm={radiusKm}
          onRadius={setRadiusKm}
          radiusMin={RADIUS_MIN}
          radiusMax={RADIUS_MAX}
          radiusDefault={RADIUS_DEFAULT}
          mapLabel={t("locations.map.label")}
          dragHint={t("locations.pin_hint")}
          unpinnedHint={t("locations_step.unpinned_hint")}
          radiusTitle={t("locations.radius")}
          radiusNote={t("locations.radius_hint")}
          radiusEdit={t("locations_step.radius_edit")}
          radiusDone={t("locations_step.radius_done")}
          radiusNone={t("locations_step.radius_none")}
          radiusSliderLabel={t("locations.radius")}
          formatRadius={(km) => formatKm(km) ?? String(km)}
          unavailableLabel={t("locations_step.map_unavailable")}
        />
      </div>

      <label className="flex max-w-sm flex-col gap-1">
        <span className="text-body-sm text-ink">{t("locations.type")}</span>
        <Select
          name="type"
          defaultValue={branch?.type ?? "head_office"}
          disabled={props.readOnly}
          options={TYPES.map((type) => ({
            value: type,
            label: t(`locations.type.${type}` as "locations.type.head_office"),
          }))}
        />
      </label>

      <EmirateAreaPicker
        areas={props.areas}
        emirate={emirate}
        areaId={areaId}
        onChange={(next) => {
          setEmirate(next.emirate);
          setAreaId(next.areaId);
        }}
        label={t("locations.where")}
        emirateLabel={t("locations.emirate")}
        areaLabel={t("locations.area")}
        emiratePlaceholder={t("locations.emirate_placeholder")}
        areaPlaceholder={t("locations.area_placeholder")}
        freeZoneFilterLabel={t("locations.free_zone_filter")}
        freeZoneTagLabel={t("locations.free_zone_tag")}
        freeZoneNote={(emirateName, areaName) =>
          t("locations.free_zone_note", { emirate: emirateName, area: areaName })
        }
        searchLabel={t("locations.search_areas")}
        noAreasLabel={t("locations.no_areas")}
        disabled={pending || props.readOnly}
      />

      <label className="flex flex-col gap-1">
        <span className="text-body-sm text-ink">{t("locations.address")}</span>
        <Input
          name="addressLine"
          defaultValue={branch?.addressLine ?? ""}
          disabled={props.readOnly}
          required
        />
        <span className="text-caption text-muted">{t("locations.address_hint")}</span>
      </label>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-body-sm text-ink">{t("locations.phone")}</span>
          <Input name="phone" mono defaultValue={branch?.phone ?? ""} disabled={props.readOnly} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-body-sm text-ink">{t("locations.whatsapp")}</span>
          <Input name="whatsapp" mono defaultValue={branch?.whatsapp ?? ""} disabled={props.readOnly} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-body-sm text-ink">{t("locations.radius")}</span>
          {/* Written by the map's radius editor as well as by hand, so it is
              controlled rather than defaulted — a slider that moved a field the
              form then posted stale would be the two disagreeing on save. */}
          <Input
            name="serviceRadiusKm"
            mono
            inputMode="numeric"
            value={radiusKm ?? ""}
            onChange={(event) => {
              const digits = event.target.value.replace(/[^0-9]/g, "");
              setRadiusKm(digits === "" ? null : Number(digits));
            }}
            disabled={props.readOnly}
          />
          <span className="text-caption text-muted">{t("locations.radius_hint")}</span>
        </label>
      </div>

      {area?.isFreeZone && (
        <p className="max-w-prose text-caption text-muted">
          {t("locations.free_zone_note", {
            emirate: t(`emirate.${area?.emirate ?? "dubai"}` as "emirate.dubai"),
            area: area.name,
          })}
        </p>
      )}

      {!props.readOnly && (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            {t("locations.save")}
          </Button>
          {branch && <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={pending}
            onClick={() => {
              if (!window.confirm(t("locations.confirm_delete"))) return;
              const form = new FormData();
              form.set("id", branch.id);
              startTransition(async () => {
                const result = await props.deleteAction(form);
                if (!result.ok) setError(result);
                else props.onDone();
              });
            }}
          >
            {t("locations.delete")}
          </Button>}
          <span aria-live="polite" className="text-body-sm text-muted">
            {notice}
          </span>
        </div>
      )}
    </form>
  );
}
