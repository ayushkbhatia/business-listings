"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/display";
import { Button } from "@/components/primitives";
import { Modal } from "@/components/structure";
import {
  CoverageChipGroup,
  CoverageFields,
  type CoverageChipView,
  type FreeZoneView,
} from "@/components/domain";
import { formatCount, formatList } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import type { DeliveryMode } from "@/lib/db/generated/enums";
import { coverageMarker } from "@/lib/locations/service-coverage";
import type { ManagerRefusal, ManagerWrite } from "@/lib/services/coverage-manager";

/**
 * Board `3c-s` — the two editors, and both of them stage.
 *
 * `2d-s`, the onboarding half, saves each chip as it is clicked, which is right
 * for a seller filling in an empty listing. Here each click on the default
 * moves every inheriting service at once — B11 calls that a consequential
 * write, and **the number of those services is the blast radius** — so nothing
 * is written until the seller has seen the count and pressed Save.
 *
 * The fields are `2d-s`'s own component, `CoverageFields`, so the two halves
 * cannot drift into asking different questions. Only the save behaviour
 * differs, which is the reason that component owns no save behaviour at all.
 */

const REFUSAL: Record<ManagerRefusal, MessageKey> = {
  forbidden: "coverage_manager.error.forbidden",
  not_found: "coverage_manager.error.not_found",
  unknown_area: "coverage_manager.error.unknown_area",
  unknown_mode: "coverage_manager.error.unknown_mode",
  not_a_free_zone: "coverage_manager.error.not_a_free_zone",
  live_needs_mode: "coverage_manager.error.live_needs_mode",
  live_needs_area: "coverage_manager.error.live_needs_area",
};

/* ── The default ─────────────────────────────────────────────────────────── */

export function DefaultCoverageEditor({
  modes: initialModes,
  chips: initialChips,
  otherScopes,
  freeZones,
  registrations: initialRegistrations,
  inheriting,
  editable,
  save,
}: {
  modes: readonly DeliveryMode[];
  chips: readonly CoverageChipView[];
  otherScopes: readonly { id: string; label: string }[];
  freeZones: readonly FreeZoneView[];
  registrations: readonly FreeZoneView[];
  inheriting: { total: number; live: number };
  editable: boolean;
  save: (formData: FormData) => Promise<ManagerWrite>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [modes, setModes] = useState<DeliveryMode[]>([...initialModes]);
  const [chips, setChips] = useState<CoverageChipView[]>([...initialChips]);
  const [zones, setZones] = useState<FreeZoneView[]>([...initialRegistrations]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setModes([...initialModes]);
    setChips([...initialChips]);
    setZones([...initialRegistrations]);
    setError(null);
  };

  const changed =
    modes.join("|") !== initialModes.join("|") ||
    chips.some((chip, index) => chip.on !== initialChips[index]?.on) ||
    zones.map((zone) => zone.id).sort().join("|") !==
      initialRegistrations.map((zone) => zone.id).sort().join("|");

  const onSave = () => {
    const form = new FormData();
    for (const mode of modes) form.append("mode", mode);
    for (const chip of chips) if (chip.on) form.append("area", chip.key);
    for (const zone of zones) form.append("zone", zone.id);
    startTransition(async () => {
      const result = await save(form);
      if (!result.ok) {
        setError(t(REFUSAL[result.reason]));
        return;
      }
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <Button
        variant="secondary"
        disabled={!editable}
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        {t("coverage_manager.edit_default")}
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t("coverage_manager.default_dialog_title")}
        description={t("coverage_manager.default_dialog_lede")}
        closeLabel={t("coverage_manager.close")}
        size="lg"
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            {/*
               B11, said beside the button rather than after it. The count is
               read off the rows on the server, not guessed from the table the
               seller is looking at — a service somebody narrowed in another tab
               a minute ago no longer moves, and this number knows that.
            */}
            <p aria-live="polite" className="max-w-prose text-caption text-body">
              {inheriting.total === 0
                ? t("coverage_manager.moves_none")
                : t("coverage_manager.moves", {
                    count: inheriting.total,
                    formatted: formatCount(inheriting.total),
                    live: formatCount(inheriting.live),
                  })}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
                {t("coverage_manager.cancel")}
              </Button>
              <Button onClick={onSave} disabled={!changed || pending}>
                {inheriting.total === 0
                  ? t("coverage_manager.save_default")
                  : t("coverage_manager.save_default_moves", {
                      count: inheriting.total,
                      formatted: formatCount(inheriting.total),
                    })}
              </Button>
            </div>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          {error && (
            <Alert tone="bad" live="assertive" fix={t("coverage_manager.error.fix")}>
              {error}
            </Alert>
          )}
          <CoverageFields
            modes={modes}
            onModes={setModes}
            chips={chips}
            onChip={(key, on) =>
              setChips((current) => current.map((chip) => (chip.key === key ? { ...chip, on } : chip)))
            }
            onSelectAll={() => setChips((current) => current.map((chip) => ({ ...chip, on: true })))}
            otherScopes={otherScopes}
            freeZones={freeZones}
            registrations={zones}
            onFreeZone={(areaId, on) => {
              const zone = freeZones.find((row) => row.id === areaId);
              setZones((current) =>
                on
                  ? zone && !current.some((row) => row.id === areaId)
                    ? [...current, zone]
                    : current
                  : current.filter((row) => row.id !== areaId),
              );
            }}
            disabled={pending}
          />
        </div>
      </Modal>
    </>
  );
}

/* ── One service's row ───────────────────────────────────────────────────── */

export function ServiceCoverageEditor({
  serviceId,
  serviceName,
  chips: initialChips,
  defaultKeys,
  defaultPlaces,
  ownOther,
  editable,
  save,
}: {
  serviceId: string;
  serviceName: string;
  chips: readonly CoverageChipView[];
  /** The default's chip keys, so the marker can be previewed before saving. */
  defaultKeys: readonly string[];
  defaultPlaces: readonly string[];
  ownOther: readonly string[];
  editable: boolean;
  save: (formData: FormData) => Promise<ManagerWrite>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [chips, setChips] = useState<CoverageChipView[]>([...initialChips]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = chips.filter((chip) => chip.on);
  const changed = chips.some((chip, index) => chip.on !== initialChips[index]?.on);

  /*
     The marker the row will carry once saved, computed with the same function
     the server uses — so the seller sees *wider than default* before pressing
     Save rather than discovering it in the table afterwards.
  */
  const marker = useMemo(() => {
    const scopes = (keys: readonly string[]) =>
      initialChips.filter((chip) => keys.includes(chip.key)).map((chip) => chip.scope);
    return coverageMarker(scopes(defaultKeys), selected.map((chip) => chip.scope));
  }, [initialChips, defaultKeys, selected]);

  const onSave = () => {
    const form = new FormData();
    form.set("serviceId", serviceId);
    for (const chip of selected) form.append("area", chip.key);
    startTransition(async () => {
      const result = await save(form);
      if (!result.ok) {
        setError(t(REFUSAL[result.reason]));
        return;
      }
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        disabled={!editable}
        aria-label={t("coverage_manager.edit_row_label", { service: serviceName })}
        onClick={() => {
          setChips([...initialChips]);
          setError(null);
          setOpen(true);
        }}
      >
        {t("coverage_manager.edit_row")}
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={serviceName}
        description={t("coverage_manager.row_dialog_lede")}
        closeLabel={t("coverage_manager.close")}
        footer={
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setChips((current) => current.map((chip) => ({ ...chip, on: false })))}
              disabled={pending || selected.length === 0}
            >
              {t("coverage_manager.use_default")}
            </Button>
            <Button onClick={onSave} disabled={!changed || pending}>
              {t("coverage_manager.save_row")}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          {error && (
            <Alert tone="bad" live="assertive" fix={t("coverage_manager.error.fix")}>
              {error}
            </Alert>
          )}

          <CoverageChipGroup
            chips={chips}
            onToggle={(key, on) =>
              setChips((current) => current.map((chip) => (chip.key === key ? { ...chip, on } : chip)))
            }
            disabled={pending}
          />

          {/*
             What the row will say, in words. With nothing ticked it inherits,
             and the line names what it inherits — an empty chip row on its own
             reads as *no coverage*, which is the one thing it is not.
          */}
          <p aria-live="polite" className="text-caption text-body">
            {selected.length === 0 && ownOther.length === 0
              ? defaultPlaces.length === 0
                ? t("coverage_manager.row_inherits_nothing")
                : t("coverage_manager.row_inherits", { places: formatList(defaultPlaces) })
              : t(`coverage_manager.row_preview.${marker}` as MessageKey, {
                  places: formatList([...selected.map((chip) => chip.label), ...ownOther]),
                })}
          </p>

          {ownOther.length > 0 && (
            <p className="text-caption text-muted">
              {t("coverage_manager.row_other", { places: formatList(ownOther) })}
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}
