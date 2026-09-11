"use client";

import { useState } from "react";
import { Alert } from "@/components/display";
import { CoverageFields, type CoverageChipView, type FreeZoneView } from "@/components/domain";
import { t } from "@/lib/i18n";
import type { CoverageWrite } from "@/lib/onboarding/coverage";
import type { DeliveryMode } from "@/lib/db/generated/enums";
import { useSaved } from "../_saved";

/**
 * Board `2d-s` — the coverage field set with its save behaviour.
 *
 * The fields themselves live in `components/domain/CoverageFields`, which the
 * dashboard mounts too. This is only the writing, and it is here rather than in
 * the shared component so the shared component can be shared.
 *
 * ## Why there is no debounce
 *
 * `2d`'s autosave waits 800ms because its fields are typed: an address arrives
 * one character at a time and a save per keystroke is a save per keystroke.
 * Every control on this step is discrete — a checkbox, a chip, a zone — so the
 * value is complete the moment it changes, and a timer would only create a
 * window in which a seller who closes the tab loses the click they just made.
 * "Patch only the changed field" is the half of `2d`'s contract that matters
 * here, and it is kept: one control, one row.
 *
 * ## Optimistic, and it puts things back
 *
 * The chip fills before the round trip, because a chip that waited would read as
 * the click having missed. A refusal restores the value the record still holds
 * and says what happened — the seller never ends up looking at a chip that is on
 * in the browser and off in the database.
 */

export interface CoverageSectionProps {
  modes: readonly DeliveryMode[];
  chips: readonly CoverageChipView[];
  otherScopes?: readonly { id: string; label: string }[];
  freeZones: readonly FreeZoneView[];
  registrations: readonly FreeZoneView[];
  actions: {
    saveModes: (formData: FormData) => Promise<CoverageWrite>;
    saveArea: (formData: FormData) => Promise<CoverageWrite>;
    saveAll: () => Promise<CoverageWrite>;
    saveZone: (formData: FormData) => Promise<CoverageWrite>;
  };
  /** Reported upward so the step's Continue knows without a round trip. */
  onReadiness?: (ready: { modes: number; areas: number }) => void;
  grouped?: boolean;
}

export function CoverageSection({
  modes: initialModes,
  chips: initialChips,
  otherScopes,
  freeZones,
  registrations: initialRegistrations,
  actions,
  onReadiness,
  grouped,
}: CoverageSectionProps) {
  const { setSaved } = useSaved();
  const [modes, setModes] = useState<DeliveryMode[]>([...initialModes]);
  const [chips, setChips] = useState<CoverageChipView[]>([...initialChips]);
  const [registrations, setRegistrations] = useState<FreeZoneView[]>([...initialRegistrations]);
  const [error, setError] = useState<string | null>(null);

  const report = (nextModes: readonly DeliveryMode[], nextChips: readonly CoverageChipView[]) => {
    onReadiness?.({
      modes: nextModes.length,
      areas: nextChips.filter((chip) => chip.on).length,
    });
  };

  const settle = (result: CoverageWrite, revert: () => void) => {
    if (result.ok) {
      setError(null);
      setSaved(t("onboarding.saved_now"));
      return;
    }
    revert();
    setError(
      result.reason === "unknown_area"
        ? t("coverage_step.error.unknown_area")
        : t("coverage_step.error.save_failed"),
    );
  };

  const onModes = (next: DeliveryMode[]) => {
    const before = modes;
    setModes(next);
    report(next, chips);
    const form = new FormData();
    form.set("modes", next.join(","));
    void actions.saveModes(form).then((result) =>
      settle(result, () => {
        setModes(before);
        report(before, chips);
      }),
    );
  };

  const onChip = (key: string, on: boolean) => {
    const chip = chips.find((row) => row.key === key);
    if (!chip) return;
    const next = chips.map((row) => (row.key === key ? { ...row, on } : row));
    setChips(next);
    report(modes, next);

    const form = new FormData();
    form.set("emirate", chip.scope.emirate);
    form.set("areaId", chip.scope.areaId ?? "");
    form.set("on", on ? "1" : "0");
    void actions.saveArea(form).then((result) =>
      settle(result, () => {
        setChips(chips);
        report(modes, chips);
      }),
    );
  };

  const onSelectAll = () => {
    const before = chips;
    const next = chips.map((row) => ({ ...row, on: true }));
    setChips(next);
    report(modes, next);
    void actions.saveAll().then((result) =>
      settle(result, () => {
        setChips(before);
        report(modes, before);
      }),
    );
  };

  const onFreeZone = (areaId: string, on: boolean) => {
    const before = registrations;
    const zone = freeZones.find((row) => row.id === areaId);
    setRegistrations(
      on
        ? zone
          ? [...registrations, zone].sort((a, b) => a.name.localeCompare(b.name))
          : registrations
        : registrations.filter((row) => row.id !== areaId),
    );

    const form = new FormData();
    form.set("areaId", areaId);
    form.set("on", on ? "1" : "0");
    void actions.saveZone(form).then((result) => settle(result, () => setRegistrations(before)));
  };

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <Alert tone="bad" live="assertive">
          {error}
        </Alert>
      )}

      <CoverageFields
        modes={modes}
        onModes={onModes}
        chips={chips}
        onChip={onChip}
        onSelectAll={onSelectAll}
        otherScopes={otherScopes}
        freeZones={freeZones}
        registrations={registrations}
        onFreeZone={onFreeZone}
        grouped={grouped}
        disabled={false}
      />
    </div>
  );
}
