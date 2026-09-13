"use client";

import { useMemo, useState, useTransition } from "react";
import { Alert } from "@/components/display";
import { Button, Label, SegmentedControl, Textarea } from "@/components/primitives";
import { Panel } from "@/components/structure";
import {
  BROWSE_RELEVANCE_MODES,
  PINNED_KEYS,
  PLAN_TIER_CEILING,
  planTierAgrees,
  redistribute,
  WEIGHT_KEYS,
  WEIGHT_TOTAL,
  weightLabelKey,
  weightsForBrowse,
  weightsTotal,
  type BrowseRelevanceMode,
  type RankingKind,
  type RankingWeights,
  type WeightKey,
} from "@/lib/search/ranking";
import { t } from "@/lib/i18n";
import { RankingSlider } from "./RankingSlider";
import type { ActionResult } from "./actions";

/**
 * Board 12c — what decides the order, and what relevance means without a query.
 *
 * ## Two rules that were not on the shipped screen
 *
 * **The six add to 100.** They did not: the panel said *"what matters is the
 * ratio between them, not the total"*, which is true of the ordering and false
 * of everything measured against it. A boost is added to the weighted sum
 * rather than multiplied into it, so a 25-point boost is a quarter of the
 * ranking at a total of 100 and a sixth of it at 150. Moving one slider now
 * lowers the others in proportion, and `redistribute` is the same pure function
 * the service validates against, so the editor cannot drift from the rule.
 *
 * **Pinned factors absorb nothing.** Distance because it scores an unknown at
 * half credit for most buyers and therefore moves everybody equally; plan tier
 * because it is the commercial one, and a redistribution that quietly raised it
 * would be the ceiling defeated sideways. Both stay editable — the cap's copy
 * would be a lie beside a slider nobody can move — they are simply not part of
 * the give and take.
 *
 * ## One editor, two vectors — board `12c-s` B1
 *
 * The same component for both, keyed by `kind`, rather than a services copy
 * beside it. What differs is data: the fourth and fifth slots are named for what
 * they measure, the notes say why the services numbers are what they are, and
 * each slot states the goods vector's number beside it so the difference is read
 * off the screen rather than remembered. Everything that is a rule — the total,
 * the pins, the ceiling, the effective browse vector — runs through the same
 * functions for both.
 */

const PINNED = new Set<WeightKey>(PINNED_KEYS);

export interface RankingEditorProps {
  kind: RankingKind;
  /** The draft where one exists, otherwise the live weights, otherwise the proposal. */
  weights: RankingWeights;
  browseMode: BrowseRelevanceMode;
  /** True when the numbers above are a saved draft rather than the live row. */
  isDraft: boolean;
  /** True when nothing is saved or live for this vector — the numbers are the board's proposal. */
  isProposal: boolean;
  /** The goods vector as it is live, stated beside each services slot. Null on the goods editor. */
  compareWith: RankingWeights | null;
  /** The other vector's plan tier, live and in draft — `12c-s` B5. */
  otherPlanTier: { kind: RankingKind; live: number | null; draft: number | null };
  mayWrite: boolean;
  saveDraft: (formData: FormData) => Promise<ActionResult>;
}

export function RankingEditor({
  kind,
  weights,
  browseMode,
  isDraft,
  isProposal,
  compareWith,
  otherPlanTier,
  mayWrite,
  saveDraft,
}: RankingEditorProps) {
  const [values, setValues] = useState<RankingWeights>(weights);
  const [mode, setMode] = useState<BrowseRelevanceMode>(browseMode);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const total = weightsTotal(values);
  const effective = useMemo(() => weightsForBrowse(values, mode), [values, mode]);
  const ready = reason.trim().length >= 4 && total === WEIGHT_TOTAL;
  const services = kind === "services";

  /*
     `B9`. `redistribute` lifts plan tier's effective weight on every landing
     page without anyone touching the plan slider — to 9 on the live weights,
     and past the ceiling at higher relevance. The service refuses it; the
     editor has to say so before the save, or the refusal arrives attached to a
     slider the staff member did not move.
  */
  const breachesBrowseCeiling = effective.planTier > PLAN_TIER_CEILING;

  /*
     `12c-s` B5. Said here, before the save, and refused only at publish — a
     rule about a pair refused at save would leave neither vector able to move
     first. The number stated is the one the refusal will compare against.
  */
  const planDisagrees = !planTierAgrees(values.planTier, otherPlanTier);
  const otherPlan = otherPlanTier.live ?? otherPlanTier.draft;

  function move(key: WeightKey, next: number) {
    setValues((current) => redistribute(current, key, next));
  }

  function send() {
    const form = new FormData();
    form.set("kind", kind);
    form.set("reason", reason);
    form.set("browseRelevanceMode", mode);
    for (const key of WEIGHT_KEYS) form.set(key, String(values[key]));
    startTransition(async () => {
      const outcome = await saveDraft(form);
      setResult(outcome);
      if (outcome.ok) setReason("");
    });
  }

  const label = (key: WeightKey) => t(weightLabelKey(kind, key) as never);

  return (
    <div className="flex flex-col gap-[var(--gutter)]">
      {result && (
        <Alert tone={result.ok ? "ok" : "bad"} live="assertive">
          {result.ok ? result.message : result.error}
        </Alert>
      )}

      <Panel
        title={t(services ? "ranking.weights.services" : "ranking.weights")}
        description={t(services ? "ranking.weights_hint.services" : "ranking.weights_hint")}
        eyebrow={t(
          isDraft
            ? "ranking.weights_total"
            : isProposal
              ? "ranking.weights_total_proposed"
              : "ranking.weights_total_live",
          { total },
        )}
      >
        <div className="flex flex-col gap-5">
          {WEIGHT_KEYS.map((key) => (
            <RankingSlider
              key={key}
              label={label(key)}
              value={values[key]}
              onChange={(next) => move(key, next)}
              disabled={!mayWrite}
              {...(key === "planTier" ? { ceiling: PLAN_TIER_CEILING } : {})}
              {...(hintFor(kind, key) ? { hint: hintFor(kind, key)! } : {})}
              {...(noteFor(kind, key, compareWith) ? { note: noteFor(kind, key, compareWith)! } : {})}
            />
          ))}
        </div>

        {total !== WEIGHT_TOTAL && (
          <div className="mt-4">
            <Alert tone="bad" live="polite">
              {t("ranking.refuse.total_not_100", { total, expected: WEIGHT_TOTAL })}
            </Alert>
          </div>
        )}

        {planDisagrees && otherPlan !== null && (
          <div className="mt-4">
            <Alert
              tone="warn"
              live="polite"
              fix={t("ranking.plan_disagrees_fix", { planTier: values.planTier })}
            >
              {t("ranking.plan_disagrees", {
                value: otherPlan,
                other: t(`ranking.vector_inline.${otherPlanTier.kind}` as never),
              })}
            </Alert>
          </div>
        )}

        {/*
           Board 6a §Ranking, on the screen that owns the weights.

           The landing pages rank on this same config and have no search box, so
           the relevance weight above has nothing to score against. Left alone it
           multiplies zero: somebody moves a 34-point slider and nothing changes
           on a few hundred pages. The preview is the whole reason this control is
           here rather than in a settings file — "redistribute" is an abstraction
           until you see verification go from 22 to 34.
        */}
        <div className="mt-6 border-t border-line pt-4">
          {/*
             A `p`, not a `Label`. `SegmentedControl` names its own group and a
             `label` pointing at a radio group is a label for one radio — which
             is how a group ends up announced as its first option.
          */}
          <p className="text-caption font-medium text-ink">{t("ranking.browse_mode")}</p>
          <p className="mt-0.5 max-w-prose text-caption text-body">
            {t(services ? "ranking.browse_hint.services" : "ranking.browse_hint")}
          </p>

          <div className="mt-2">
            <SegmentedControl
              label={t("ranking.browse_mode")}
              value={mode}
              onChange={(next) => setMode(next as BrowseRelevanceMode)}
              options={BROWSE_RELEVANCE_MODES.map((option) => ({
                value: option,
                label: t(`ranking.browse.${option}` as never),
              }))}
            />
          </div>

          <div className="mt-3 rounded-panel border border-line bg-fill p-3">
            <p className="font-mono text-eyebrow uppercase text-body">
              {t("ranking.browse_preview")}
            </p>
            <p className="mt-1 font-mono text-body-sm tabular-nums text-ink">
              {WEIGHT_KEYS.filter((key) => effective[key] > 0)
                .map((key) => `${label(key)} ${effective[key]}`)
                .join(" · ")}
            </p>
            <p className="mt-1.5 max-w-prose text-caption text-body">
              {effectiveNote(effective, values, label)}
            </p>
          </div>

          {breachesBrowseCeiling && (
            <div className="mt-3">
              <Alert tone="bad" live="polite">
                {t("ranking.refuse.browse_plan_tier_too_high", {
                  ceiling: PLAN_TIER_CEILING,
                  effective: effective.planTier,
                  authored: values.planTier,
                })}
              </Alert>
            </div>
          )}
        </div>

        {mayWrite ? (
          <div className="mt-6 flex flex-col gap-3 border-t border-line pt-4">
            <div className="flex flex-col gap-1">
              <Label
                htmlFor={`ranking-reason-${kind}`}
                requirement="required"
                requirementLabel={t("field.required")}
              >
                {t("builder.reason_label")}
              </Label>
              <Textarea
                id={`ranking-reason-${kind}`}
                rows={2}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
            <div>
              <Button disabled={!ready || pending || breachesBrowseCeiling} onClick={send}>
                {t("ranking.save")}
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-6 max-w-prose border-t border-line pt-4 text-caption text-body">
            {t("ranking.read_only")}
          </p>
        )}
      </Panel>
    </div>
  );
}

/** "pinned", "replaces distance, pinned", "pinned, ceiling 10" — beside the label. */
function hintFor(kind: RankingKind, key: WeightKey): string | null {
  if (kind === "services" && key === "specCompleteness") return t("ranking.weight.replaces_spec");
  if (kind === "services" && key === "distance") return t("ranking.weight.replaces_distance");
  if (!PINNED.has(key)) return null;
  return key === "planTier"
    ? t("ranking.weight.pinned_capped", { ceiling: PLAN_TIER_CEILING })
    : t("ranking.weight.pinned");
}

/**
 * The line under a slot: why the number is what it is.
 *
 * On the services vector every slot but relevance says the goods vector's live
 * number beside its reason. The board wrote *"up from 22"*, which is true of the
 * proposal on the day it was drawn and false the first time anybody moves the
 * goods vector; the comparison is read from the live row instead.
 */
function noteFor(
  kind: RankingKind,
  key: WeightKey,
  compareWith: RankingWeights | null,
): string | null {
  const compare =
    compareWith && key !== "relevance"
      ? ` ${t("ranking.weight.compare", { value: compareWith[key] })}`
      : "";

  if (kind === "goods") {
    if (key === "responseTime") return t("ranking.weight.response_note");
    if (key === "planTier") return t("ranking.plan_cap");
    return null;
  }

  switch (key) {
    case "verificationTier":
      return `${t("ranking.weight.services.verification_note")}${compare}`;
    case "responseTime":
      return `${t("ranking.weight.services.response_note")} ${t("ranking.weight.response_note")}${compare}`;
    case "specCompleteness":
      return `${t("ranking.weight.services.scope_note")}${compare}`;
    case "distance":
      return `${t("ranking.weight.services.coverage_note")}${compare}`;
    case "planTier":
      return `${t("ranking.weight.services.plan_note")} ${t("ranking.plan_cap")}`;
    default:
      return null;
  }
}

/**
 * The sentence under the effective vector.
 *
 * Two facts, both derived: which factor leads a browse page, and where plan
 * tier landed. The second is the one worth saying — it moves without anybody
 * touching its slider, and that is exactly the property `B9` is about.
 *
 * *Overtakes* is only written where a factor actually overtook another. The
 * first version of this line said it whenever the mode redistributed, which on
 * the live weights read *"Verification tier overtakes Measured reply time"*
 * about a pair that was already in that order and stayed in it. A sentence that
 * describes a change nothing made is the same defect as a padded row.
 */
function effectiveNote(
  effective: RankingWeights,
  authored: RankingWeights,
  label: (key: WeightKey) => string,
): string {
  const others = WEIGHT_KEYS.filter((key) => key !== "relevance");
  const leaderOf = (weights: RankingWeights) =>
    [...others].sort((a, b) => weights[b] - weights[a])[0];

  const was = leaderOf(authored);
  const now = leaderOf(effective);
  const planMoved = effective.planTier !== authored.planTier;

  if (!planMoved && was === now) return t("ranking.effective_flat");

  if (was !== now && was && now) {
    return t("ranking.effective_note", {
      leader: label(now),
      runner_up: label(was),
      authored: authored.planTier,
      effective: effective.planTier,
    });
  }

  return t("ranking.effective_leads", {
    leader: now ? label(now) : "",
    authored: authored.planTier,
    effective: effective.planTier,
  });
}
