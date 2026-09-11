import { Panel } from "@/components/structure";
import { t } from "@/lib/i18n";
import type { CoverageState } from "@/lib/onboarding/coverage";

/**
 * The right-hand column: what the licence already said, and what this step is
 * not.
 *
 * `2d`'s right column is a map, because on that board the pin is the argument. A
 * services business has no pin, so the column holds the thing the seller might
 * otherwise go looking for — the licensed address — and says plainly that it is
 * not what buyers filter on.
 *
 * Its own file, with no `"use client"`, because it holds no state and takes no
 * input. A component sitting in a client module is in the client bundle whether
 * or not it needs to be.
 */
export function CoverageAside({
  office,
}: {
  office: CoverageState["registeredOffice"];
}) {
  return (
    <div className="flex flex-col gap-4">
      <Panel title={t("coverage_step.office")}>
        {office ? (
          <>
            <p className="text-body-sm text-ink">{office.addressLine}</p>
            <p className="mt-0.5 text-body-sm text-muted">
              {office.areaName}, {t(`emirate.${office.emirate}` as "emirate.dubai")}
            </p>
          </>
        ) : (
          /* Honest thinness. A licensed address we do not hold is not invented
             here, and nothing on this step needs one. */
          <p className="text-body-sm text-muted">{t("coverage_step.office_none")}</p>
        )}
        <p className="mt-2 text-caption text-faint">{t("coverage_step.office_note")}</p>
      </Panel>

      <div className="rounded-card border border-dashed border-line-strong bg-wash px-4 py-3">
        <p className="font-mono text-eyebrow uppercase tracking-wide text-muted">
          {t("coverage_step.not_a_branch_list")}
        </p>
        <p className="mt-1.5 text-caption text-body">
          {t("coverage_step.not_a_branch_list_note")}
        </p>
      </div>

      <p className="text-caption text-muted">{t("coverage_step.default_note")}</p>
    </div>
  );
}
