"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/display";
import { Button, Select } from "@/components/primitives";
import { Panel } from "@/components/structure";
import { Close } from "@/components/primitives/icons";
import { t } from "@/lib/i18n";
import type { CoverageRow } from "@/lib/db/queries/locations";
import type { CoverageActionResult } from "./actions";

/**
 * Board 3c §4 — where the supplier delivers, and how fast.
 *
 * The chips look like tags and are not. They drive `1h`'s RFQ routing and sit
 * beside the facets `1b` and `1c` filter on, which is the whole reason the
 * scope is a select over the taxonomy rather than a text field: a typed area
 * matches nothing, and the seller never learns why the enquiries stopped. Board
 * 2d already holds the rule one screen earlier — "no code path allows free-text
 * area entry" — and criterion 6 restates it here.
 *
 * Two scales in one control. The first option under each emirate is the
 * emirate entire; the rest are its areas. A supplier delivering across Dubai
 * should not have to name forty places to say so, and one stocked only in Al
 * Quoz should not have to claim the emirate to appear at all.
 */

export interface CoverageOption {
  value: string;
  label: string;
  emirate: string;
  /** Empty for the whole-emirate row. */
  areaId: string;
}

export interface CoveragePanelProps {
  rows: readonly CoverageRow[];
  /**
   * Grouped by emirate, each group leading with its own whole-emirate row.
   *
   * The grouping is what makes the two scales legible in one control: the
   * seller opens "Dubai" and the first thing under it is Dubai entire, then the
   * areas inside it. A flat list of fifty-odd entries with seven of them
   * meaning something structurally different is a list nobody reads to the end.
   */
  groups: readonly { label: string; options: readonly CoverageOption[] }[];
  /** The promises the control offers, already worded. */
  leadOptions: readonly { value: string; label: string }[];
  saveAction: (formData: FormData) => Promise<CoverageActionResult>;
  removeAction: (formData: FormData) => Promise<CoverageActionResult>;
  readOnly?: boolean;
}

export function CoveragePanel(props: CoveragePanelProps) {
  const [adding, setAdding] = useState(false);
  const [scope, setScope] = useState("");
  const [hours, setHours] = useState(props.leadOptions[0]?.value ?? "0");
  const [error, setError] = useState<{ error: string; fix: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const options = props.groups.flatMap((group) => group.options);

  function add() {
    const option = options.find((entry) => entry.value === scope);
    if (!option) {
      setError({
        error: t("locations.coverage.unknown_area"),
        fix: t("locations.coverage.unknown_area_fix"),
      });
      return;
    }
    const form = new FormData();
    form.set("emirate", option.emirate);
    form.set("areaId", option.areaId);
    form.set("leadTimeHours", hours);
    setError(null);
    startTransition(async () => {
      const result = await props.saveAction(form);
      if (!result.ok) setError(result);
      else {
        setAdding(false);
        setScope("");
      }
    });
  }

  function remove(id: string) {
    const form = new FormData();
    form.set("id", id);
    startTransition(async () => {
      const result = await props.removeAction(form);
      if (!result.ok) setError(result);
    });
  }

  return (
    <Panel title={t("locations.coverage.title")}>
      <div className="flex flex-col gap-3">
        {error && (
          <Alert tone="bad" live="assertive" fix={error.fix}>
            {error.error}
          </Alert>
        )}

        {props.rows.length === 0 && !adding ? (
          <p className="max-w-prose text-body-sm text-muted">{t("locations.coverage.none")}</p>
        ) : (
          <ul className="flex flex-wrap items-center gap-2">
            {props.rows.map((row) => (
              <li key={row.id}>
                <span className="inline-flex items-center gap-1 rounded-tag border border-line bg-paper-sunk py-1 ps-2.5 pe-1 text-caption text-body">
                  {t("locations.coverage.chip", { scope: row.scope, promise: row.promise })}
                  {!props.readOnly && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => remove(row.id)}
                      aria-label={t("locations.coverage.remove", { scope: row.scope })}
                      className="rounded-pill p-0.5 text-muted hover:text-ink focus-visible:shadow-focus focus-visible:outline-none disabled:cursor-not-allowed"
                    >
                      <Close className="size-3.5" />
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}

        {!props.readOnly &&
          (adding ? (
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex min-w-64 flex-col gap-1">
                <span className="text-body-sm text-ink">{t("locations.coverage.scope_label")}</span>
                <Select
                  value={scope}
                  onChange={(event) => setScope(event.target.value)}
                  placeholder={t("locations.area_placeholder")}
                  options={[]}
                  groups={props.groups.map((group) => ({
                    label: group.label,
                    options: group.options.map((option) => ({
                      value: option.value,
                      label: option.label,
                    })),
                  }))}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-body-sm text-ink">{t("locations.coverage.promise_label")}</span>
                <Select
                  value={hours}
                  onChange={(event) => setHours(event.target.value)}
                  options={props.leadOptions}
                />
              </label>
              <Button size="sm" onClick={add} disabled={pending || scope === ""}>
                {t("locations.coverage.add")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)} disabled={pending}>
                {t("locations.cancel")}
              </Button>
            </div>
          ) : (
            <div>
              <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
                {t("locations.coverage.add")}
              </Button>
            </div>
          ))}

        <p className="max-w-prose text-caption text-muted">{t("locations.coverage.note")}</p>
      </div>
    </Panel>
  );
}
