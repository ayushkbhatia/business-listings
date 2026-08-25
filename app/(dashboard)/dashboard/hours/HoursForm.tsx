"use client";

import { Alert } from "@/components/display";
import { useState, useTransition } from "react";
import { Button, Select } from "@/components/primitives";
import { Panel } from "@/components/structure";
import { HoursEditor } from "@/components/domain";
import { describeProblemText } from "@/lib/trade/hours-copy";
import { everyDay, type Day, type RamadanHours, type WeekHours } from "@/lib/trade/hours";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { HoursActionResult } from "../listing/actions";

/**
 * Board 3d — hours, per branch, with Ramadan.
 *
 * The wrapper exists because HoursEditor takes a `problemLabel` function and a
 * server component cannot pass one. Everything the editor needs in words is
 * resolved here — see tests/unit/client-labels.test.ts, which is what stops
 * this being the sixth time somebody tries.
 */

export interface BranchHours {
  id: string;
  name: string;
  hours: WeekHours;
  ramadanHours: RamadanHours | null;
}

export interface HoursFormProps {
  branches: readonly BranchHours[];
  ramadanWindow: { from: string; to: string; active: boolean } | null;
  action: (formData: FormData) => Promise<HoursActionResult>;
}

const DAY_LABELS: Record<Day, string> = {
  sun: t("storefront.day.sun"),
  mon: t("storefront.day.mon"),
  tue: t("storefront.day.tue"),
  wed: t("storefront.day.wed"),
  thu: t("storefront.day.thu"),
  fri: t("storefront.day.fri"),
  sat: t("storefront.day.sat"),
};

export function HoursForm({ branches, ramadanWindow, action }: HoursFormProps) {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const branch = branches.find((b) => b.id === branchId) ?? branches[0];

  const [hours, setHours] = useState<WeekHours>(branch?.hours ?? {});
  const [ramadan, setRamadan] = useState<RamadanHours | null>(branch?.ramadanHours ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyAll, setCopyAll] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!branch) {
    return <p className="text-body-sm text-muted">{t("hours.no_branches")}</p>;
  }

  function switchBranch(id: string) {
    const next = branches.find((b) => b.id === id);
    if (!next) return;
    setBranchId(id);
    setHours(next.hours);
    setRamadan(next.ramadanHours);
    setNotice(null);
    setCopyAll(false);
  }

  function save() {
    const form = new FormData();
    // "all" is the location id the service understands, so copy-to-all is one
    // save rather than a loop the browser has to keep in step.
    form.set("locationId", copyAll ? "all" : branchId);
    form.set("hours", JSON.stringify(hours));
    form.set("ramadanHours", ramadan ? JSON.stringify(ramadan) : "");

    setError(null);
    startTransition(async () => {
      const result = await action(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice(
        result.applied > 1
          ? t("hours.copied", { count: formatCount(result.applied) })
          : t("hours.saved"),
      );
      setCopyAll(false);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert tone="bad" live="assertive">{error}</Alert>
      )}

      {branches.length > 1 && (
        <label className="flex max-w-sm flex-col gap-1">
          <span className="text-body-sm text-ink">{t("hours.branch")}</span>
          <Select
            value={branchId}
            options={branches.map((b) => ({ value: b.id, label: b.name }))}
            onChange={(e) => switchBranch(e.target.value)}
          />
        </label>
      )}

      <Panel title={t("hours.week")}>
        <HoursEditor
          hours={hours}
          ramadanHours={ramadan}
          onChange={setHours}
          onRamadanChange={setRamadan}
          label={t("hours.week")}
          dayLabels={DAY_LABELS}
          openLabel={t("hours.open")}
          closeLabel={t("hours.close")}
          closedLabel={t("hours.closed")}
          addShiftLabel={t("hours.add_shift")}
          removeShiftLabel={t("hours.remove_shift")}
          copyAllLabel={t("hours.copy_all")}
          publicHolidaysLabel={t("hours.public_holidays")}
          publicHolidayOptions={[
            { value: "closed", label: t("hours.public.closed") },
            { value: "reduced", label: t("hours.public.reduced") },
            { value: "normal", label: t("hours.public.normal") },
          ]}
          ramadanLabel={t("hours.ramadan")}
          ramadanHint={t("hours.ramadan_hint")}
          {...(ramadanWindow
            ? {
                ramadanWindowLabel: t("hours.ramadan_window", {
                  from: ramadanWindow.from,
                  to: ramadanWindow.to,
                }),
              }
            : {})}
          {...(ramadanWindow?.active ? { ramadanActiveLabel: t("hours.ramadan_active") } : {})}
          ramadanOnLabel={t("hours.ramadan_toggle")}
          problemLabel={describeProblemText}
          {...(branches.length > 1
            ? {
                onCopyToAll: () => {
                  setCopyAll(true);
                  setHours((current) => ({ ...current }));
                },
              }
            : {})}
          disabled={pending}
        />
      </Panel>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={pending}>
          {copyAll ? t("hours.copy_all") : t("hours.save")}
        </Button>
        <span aria-live="polite" className="text-body-sm text-muted">
          {notice}
        </span>
      </div>
    </div>
  );
}

export { everyDay };
