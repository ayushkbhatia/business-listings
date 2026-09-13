"use client";

import { useState } from "react";
import { Alert } from "@/components/display";
import { Button } from "@/components/primitives";
import { Card } from "@/components/structure";
import { CoverageChipGroup } from "@/components/domain";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { ServiceCoverageChip, ServiceCoverageState } from "@/lib/services/coverage";
import type { saveServiceArea, useDefaultCoverage } from "./actions";

/**
 * Board `3c-s` — where one service is available, on the service editor.
 *
 * The business default lives on `2d-s` and answers *where does this firm
 * work*. This card answers the narrower question a multi-service practice
 * actually has: the audit team travels to all seven emirates and the on-site
 * IT desk does not leave Dubai, and before this the two published the same
 * coverage because one row set served both.
 *
 * ## Every chip starts off, and that is the model
 *
 * `2d-s` B5: the default is inherited at read time and never copied down. So
 * the card does not seed itself from the default — it writes the default out
 * beside the chips and leaves them empty. The first chip ticked narrows this
 * service to that one place, which is a big jump from one click and is exactly
 * what the stored rows say; the line under the chips states it before and
 * after, so the seller is never reading a claim the record does not hold.
 *
 * Untick the last chip and the service inherits again. There is no third state
 * and no reset to forget.
 *
 * Optimistic, and it puts things back — `2d-s`'s contract. A chip that waited
 * for the round trip reads as the click having missed, and a refusal restores
 * what the record still holds rather than leaving the browser and the database
 * disagreeing.
 */

export function ServiceCoverageCard({
  state,
  actions,
}: {
  state: ServiceCoverageState;
  actions: {
    saveArea: typeof saveServiceArea;
    useDefault: typeof useDefaultCoverage;
  };
}) {
  const [chips, setChips] = useState<ServiceCoverageChip[]>([...state.chips]);
  const [narrowed, setNarrowed] = useState(state.narrowed);
  const [effective, setEffective] = useState<string[]>([...state.effective]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const settle = (
    result: Awaited<ReturnType<typeof saveServiceArea>>,
    revert: () => void,
  ) => {
    if (result.ok) {
      setError(null);
      setNarrowed(result.narrowed);
      setEffective(result.effective);
      return;
    }
    revert();
    setError(
      result.reason === "unknown_area"
        ? t("service_coverage.error.unknown_area")
        : result.reason === "forbidden"
          ? t("service_coverage.error.forbidden")
          : t("service_coverage.error.save_failed"),
    );
  };

  const onChip = (key: string, on: boolean) => {
    const chip = chips.find((row) => row.key === key);
    if (!chip) return;
    const before = chips;
    setChips(chips.map((row) => (row.key === key ? { ...row, on } : row)));

    const form = new FormData();
    form.set("id", state.serviceId);
    form.set("emirate", chip.scope.emirate);
    form.set("areaId", chip.scope.areaId ?? "");
    form.set("on", on ? "1" : "0");
    void actions.saveArea(form).then((result) => settle(result, () => setChips(before)));
  };

  const onUseDefault = () => {
    const before = chips;
    setBusy(true);
    setChips(chips.map((row) => ({ ...row, on: false })));

    const form = new FormData();
    form.set("id", state.serviceId);
    void actions
      .useDefault(form)
      .then((result) => settle(result, () => setChips(before)))
      .finally(() => setBusy(false));
  };

  return (
    <Card>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-mono text-eyebrow uppercase tracking-wide text-muted">
          {t("service_coverage.title")}
        </h2>
        <span className="ms-auto">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || !narrowed}
            onClick={onUseDefault}
          >
            {t("service_coverage.use_default")}
          </Button>
        </span>
      </div>

      <p className="mt-1 max-w-prose text-caption text-muted">
        {t("service_coverage.hint")}
      </p>

      {error && (
        <div className="mt-3">
          <Alert tone="bad" live="assertive" fix={t("service_coverage.error.fix")}>
            {error}
          </Alert>
        </div>
      )}

      {/*
         Toggle buttons rather than checkboxes, and so a labelled group rather
         than a fieldset — `2d-s`'s note: a `<legend>` has to be the first child
         of its fieldset, which a heading sharing a line with a button cannot
         give it, and a legend nested in a wrapper names nothing.
      */}
      <div
        role="group"
        aria-labelledby="svc-coverage-label"
        aria-describedby="svc-coverage-state"
      >
        <span id="svc-coverage-label" className="sr-only">
          {t("service_coverage.title")}
        </span>
        <CoverageChipGroup className="mt-3" chips={chips} onToggle={onChip} disabled={busy} />

        {/*
           What a buyer sees, said in full rather than as a count. The whole
           point of the card is that this service's coverage can differ from
           the firm's, and "3 areas" is the one phrasing that hides which.
        */}
        <p id="svc-coverage-state" aria-live="polite" className="mt-3 text-caption">
          {effective.length === 0 ? (
            <span className="text-warn-ink">{t("service_coverage.effective_none")}</span>
          ) : narrowed ? (
            <span className="text-body">
              {t("service_coverage.effective_narrowed", {
                places: effective.join(", "),
                count: effective.length,
              })}
            </span>
          ) : (
            <span className="text-muted">
              {t("service_coverage.effective_inherited", { places: effective.join(", ") })}
            </span>
          )}
        </p>
      </div>

      {/*
         The firm's default, written out whether or not it applies — the seller
         is choosing between two claims and can only do that with both on
         screen. Unfilled stays visible: a firm that has not finished `2d-s`
         reads the grey line rather than nothing at all.
      */}
      <dl className="mt-4 border-t border-line pt-3 text-caption">
        <dt className="text-muted">{t("service_coverage.default_label")}</dt>
        <dd className={cn("mt-0.5", state.inherited.length === 0 ? "text-faint" : "text-body")}>
          {state.inherited.length === 0
            ? t("service_coverage.default_none")
            : state.inherited.join(", ")}
        </dd>
      </dl>

      {state.otherScopes.length > 0 && (
        <p className="mt-2 text-caption text-muted">
          {t("service_coverage.other_scopes", {
            places: state.otherScopes.map((row) => row.label).join(", "),
          })}
        </p>
      )}
    </Card>
  );
}
