"use client";

import { StatusBadge } from "@/components/display";
import { ImpactTable } from "@/app/(admin)/admin/search/ImpactTable";
import { PublishStrip } from "@/app/(admin)/admin/search/PublishStrip";
import { RankingSlider } from "@/app/(admin)/admin/search/RankingSlider";
import {
  DEFAULT_WEIGHTS,
  PLAN_TIER_CEILING,
  redistribute,
  WEIGHT_KEYS,
  weightsForBrowse,
  weightsTotal,
} from "@/lib/search/ranking";
import { t } from "@/lib/i18n";
import { Section, States } from "../_kit";
import type { ActionResult } from "@/app/(admin)/admin/search/actions";

/**
 * Board `12c`, second pass — the states the publish strip owes.
 *
 * The strip is the reason this section exists rather than a screenshot. Its
 * four states are the whole of criterion 7, and three of them are refusals: a
 * preview that has not run, one that is running, and one the draft has moved
 * past. They only regress silently if nobody ever sees them side by side.
 *
 * The effective-weight rows underneath are `B9`, drawn as arithmetic. The
 * numbers come from `weightsForBrowse` — the same pure function the ranker runs
 * — rather than being typed out, because a gallery that hardcodes the values it
 * exists to check will keep showing the old ones for a year after the maths
 * changed.
 */

/** The strip is interactive; in the gallery its actions do nothing and say so. */
const inert = async (): Promise<ActionResult> => ({
  ok: false,
  error: "The gallery does not publish anything.",
});

const DRAFT = redistribute(DEFAULT_WEIGHTS, "responseTime", 24);

const IMPACT_ROWS = [
  {
    key: "hvac-dubai",
    scopeLabel: "HVAC · Dubai",
    moving: 128,
    total: 412,
    fallName: "Skyline Air Systems",
    fallPlaces: 9,
    gains: t("ranking.impact.gains.responseTime"),
  },
  {
    key: "valves-dubai",
    scopeLabel: "Valves & actuators · Dubai",
    moving: 31,
    total: 88,
    fallName: "Gulf Flow Trading",
    fallPlaces: 6,
    gains: t("ranking.impact.gains.responseTime"),
  },
  {
    key: "marine-uae",
    scopeLabel: "Marine & oilfield · UAE",
    moving: 3,
    total: 22,
    fallName: "Technopump Trading",
    fallPlaces: 2,
    gains: t("ranking.impact.gains.none"),
  },
];

function strip(
  over: Partial<React.ComponentProps<typeof PublishStrip>>,
): React.ComponentProps<typeof PublishStrip> {
  return {
    hasDraft: true,
    draftSummary: "Measured reply time 18 → 24, Relevance to the query 34 → 28",
    draftAuthor: "r.haddad",
    draftWhen: "14:31",
    previewState: "fresh",
    previewWhen: "14:32",
    previewSummary: t("ranking.step.preview_body", {
      categories: t("ranking.count.categories", { count: 4 }),
      listings: t("ranking.count.listings", { count: 180 }),
    }),
    sellerCount: t("ranking.count.sellers", { count: 431 }),
    mayWrite: true,
    runPreview: inert,
    publish: inert,
    discard: inert,
    ...over,
  };
}

export function Ranking() {
  const effective = weightsForBrowse(DRAFT, "redistribute");
  const breach = weightsForBrowse(
    {
      relevance: 50,
      verificationTier: 22,
      responseTime: 12,
      specCompleteness: 6,
      distance: 4,
      planTier: 6,
    },
    "redistribute",
  );

  return (
    <Section
      id="ranking"
      title="12c · ranking"
      note="Save, preview, publish — and the ceiling that holds on the browse vector"
    >
      <div className="flex flex-col gap-8">
        <States label="no draft" stack>
          <PublishStrip
            {...strip({
              hasDraft: false,
              draftSummary: null,
              draftAuthor: null,
              draftWhen: null,
              previewState: "none",
              previewWhen: null,
              previewSummary: null,
              sellerCount: null,
            })}
          />
        </States>

        <States label="preview not run" stack>
          <PublishStrip
            {...strip({
              previewState: "none",
              previewWhen: null,
              previewSummary: null,
              sellerCount: null,
            })}
          />
        </States>

        <States label="preview running" stack>
          <PublishStrip
            {...strip({
              previewState: "running",
              previewWhen: null,
              previewSummary: null,
              sellerCount: null,
            })}
          />
        </States>

        <States label="preview stale" stack>
          <PublishStrip
            {...strip({
              previewState: "stale",
              previewWhen: null,
              previewSummary: null,
              sellerCount: null,
            })}
          />
        </States>

        <States label="ready to publish" stack>
          <PublishStrip {...strip({})} />
        </States>

        <States label="read only" stack>
          <PublishStrip {...strip({ mayWrite: false })} />
        </States>

        <States label="sliders" stack>
          <div className="flex w-full max-w-2xl flex-col gap-5">
            {WEIGHT_KEYS.map((key) => (
              <RankingSlider
                key={key}
                label={t(`ranking.weight.${key}` as never)}
                value={DRAFT[key]}
                onChange={() => undefined}
                {...(key === "planTier"
                  ? {
                      ceiling: PLAN_TIER_CEILING,
                      hint: t("ranking.weight.pinned_capped", { ceiling: PLAN_TIER_CEILING }),
                    }
                  : {})}
                {...(key === "distance" ? { hint: t("ranking.weight.pinned") } : {})}
              />
            ))}
            <p className="font-mono text-eyebrow uppercase text-faint">
              {t("ranking.weights_total", { total: weightsTotal(DRAFT) })}
            </p>
          </div>
        </States>

        <States label="effective, B9" stack>
          <div className="flex w-full max-w-2xl flex-col gap-2">
            <p className="font-mono text-body-sm tabular-nums text-ink">
              {WEIGHT_KEYS.filter((key) => effective[key] > 0)
                .map((key) => `${t(`ranking.weight.${key}` as never)} ${effective[key]}`)
                .join(" · ")}
            </p>
            <p className="flex items-center gap-2 text-caption text-body">
              <StatusBadge tone="bad">{t("ranking.weight.pinned_capped", {
                ceiling: PLAN_TIER_CEILING,
              })}</StatusBadge>
              {t("ranking.refuse.browse_plan_tier_too_high", {
                ceiling: PLAN_TIER_CEILING,
                effective: breach.planTier,
                authored: 6,
              })}
            </p>
          </div>
        </States>

        {/*
           No `Panel` around either. It is the page's chrome, and two of them
           here would be two landmarks called "What publishing would change".
        */}
        <States label="impact" stack>
          <div className="w-full">
            <ImpactTable rows={IMPACT_ROWS} unread={0} />
          </div>
        </States>

        <States label="impact, empty" stack>
          <div className="w-full">
            <ImpactTable rows={[]} unread={0} />
          </div>
        </States>
      </div>
    </Section>
  );
}
