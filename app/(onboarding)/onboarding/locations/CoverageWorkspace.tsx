"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/display";
import { Button } from "@/components/primitives";
import { t } from "@/lib/i18n";
import type { CoverageGap } from "@/lib/locations/service-coverage";
import type { CoverageState } from "@/lib/onboarding/coverage";
import { CoverageSection } from "./CoverageSection";
import type { ContinueResult } from "./actions";
import type {
  saveAllCoverageAreas,
  saveCoverageArea,
  saveDeliveryModes,
  saveFreeZone,
} from "./coverage-actions";

/**
 * Board `2d-s` — the services body of step 4.
 *
 * `2d`'s left column is a branch list and its right column is a map, because on
 * that board the pin is the argument: a seller who cannot see where it lands has
 * no way to tell their gate from the street. Here there is no pin, so there is
 * no map, and the right column is what the licence already told us — the
 * registered office, read-only, and the sentence explaining why it is not the
 * answer to the question above it.
 *
 * The Continue gate is re-read on the server. This component only renders what
 * came back, so a second tab that cleared the last area is caught rather than
 * being let through on a stale count.
 */

export interface CoverageWorkspaceProps {
  state: CoverageState;
  actions: {
    saveModes: typeof saveDeliveryModes;
    saveArea: typeof saveCoverageArea;
    saveAll: typeof saveAllCoverageAreas;
    saveZone: typeof saveFreeZone;
    continueToPlan: () => Promise<ContinueResult>;
  };
}

const GAP_TEXT: Record<CoverageGap, string> = {
  delivery_mode: t("coverage_step.blocked.delivery_mode"),
  coverage_area: t("coverage_step.blocked.coverage_area"),
};

export function CoverageWorkspace({ state, actions }: CoverageWorkspaceProps) {
  const router = useRouter();
  const [blocked, setBlocked] = useState<CoverageGap[]>([]);
  const [continuing, setContinuing] = useState(false);

  const onContinue = () => {
    if (continuing) return;
    setContinuing(true);
    void actions.continueToPlan().then((result) => {
      setContinuing(false);
      if (result.ok) {
        router.push("/onboarding/plan");
        return;
      }
      setBlocked(result.coverage);
    });
  };

  return (
    <>
      <h1 className="font-serif text-h1-serif text-ink sm:text-[2rem]">
        {t("coverage_step.title")}
      </h1>
      <p className="mt-2.5 max-w-prose text-body-sm text-body">{t("coverage_step.intro")}</p>

      <div className="mt-6 flex flex-col gap-5">
        {blocked.length > 0 && (
          <Alert tone="bad" live="assertive">
            {blocked.map((gap) => GAP_TEXT[gap]).join(t("coverage_step.blocked_join"))}
          </Alert>
        )}

        <CoverageSection
          modes={state.deliveryModes}
          chips={state.chips}
          otherScopes={state.otherScopes}
          freeZones={state.freeZones}
          registrations={state.registrations}
          actions={actions}
          /* Clearing the refusal as soon as the seller fixes it, rather than
             leaving a red alert above a screen that no longer has the problem. */
          onReadiness={({ modes, areas }) => {
            if (blocked.length === 0) return;
            setBlocked((current) =>
              current.filter(
                (gap) =>
                  (gap === "delivery_mode" && modes === 0) ||
                  (gap === "coverage_area" && areas === 0),
              ),
            );
          }}
        />

        {/*
          Continue and Back, in the same place and with the same words as `2d`.
          Same step, same contract — only the check behind the button differs.
        */}
        <div className="flex flex-wrap items-center gap-2.5">
          <Button size="lg" disabled={continuing} onClick={onContinue}>
            {t("coverage_step.continue")}
          </Button>
          <Button size="lg" variant="secondary" onClick={() => router.push("/onboarding/profile")}>
            {t("coverage_step.back")}
          </Button>
        </div>
        <p className="text-caption text-muted">{t("coverage_step.continue_note")}</p>
        <p className="text-caption text-muted">{t("coverage_step.live_note")}</p>
      </div>
    </>
  );
}
