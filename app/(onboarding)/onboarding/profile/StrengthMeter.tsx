"use client";

import { CompletenessMeter } from "@/components/domain";
import { Check } from "@/components/primitives/icons";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";
import type { StrengthItem, WeightKey } from "@/lib/metrics/profile-strength";

/**
 * Board 2c's meter, and the property that makes it worth trusting.
 *
 * Criterion 13: the named levers and the current percentage sum to exactly a
 * hundred. There is no fourth hidden item, so the meter can never show a seller
 * at 96% with nothing left to do — the state that makes a completeness meter
 * feel like a trick, and the state board 8a was in before the weights were
 * corrected.
 *
 * The rows come from `strengthItems`, which reads the same config the nightly
 * job and the dashboard read. One source, three surfaces, identical number.
 */

/**
 * What each bucket is called.
 *
 * The label has to name the **bucket**, not one thing inside it. `identity`
 * covers the description, the year founded, the team size, the languages and the
 * extra categories — labelling it "Describe the business" made the row read as
 * incomplete to a seller who had written one, which is the meter looking broken
 * for the one reason a meter must not.
 */
const LABEL: Record<WeightKey, { todo: MessageKey; done: MessageKey }> = {
  identity: { todo: "profile_step.item.identity", done: "profile_step.item.identity_done" },
  photos: { todo: "profile_step.item.photos", done: "profile_step.item.photos_done" },
  catalogue: { todo: "profile_step.item.catalogue", done: "profile_step.item.catalogue_done" },
  filterableSpecs: {
    todo: "profile_step.item.filterableSpecs",
    done: "profile_step.item.filterableSpecs_done",
  },
  team: { todo: "profile_step.item.team", done: "profile_step.item.team_done" },
};

export function StrengthMeter({
  strength,
  items,
  threshold,
  lift,
}: {
  strength: number;
  items: readonly StrengthItem[];
  threshold: number;
  /**
   * The measured cohort line, or null. Never a placeholder for the other —
   * board 2c is explicit that the 2.4× never ships as one.
   */
  lift: { multiple: number; threshold: number } | null;
}) {
  /*
     Done items first, then the biggest lever. A seller reading this wants to
     know what is left and which of it is worth most; ordering by the config's
     own key order would put the answer wherever the weights happened to sit.
  */
  const rows = [...items].sort((a, b) =>
    a.done === b.done ? b.remaining - a.remaining : a.done ? -1 : 1,
  );

  return (
    <section
      aria-labelledby="strength-heading"
      className="rounded-card-lg border border-line bg-card p-5"
    >
      <h2 id="strength-heading" className="sr-only">
        {t("profile_step.strength")}
      </h2>
      <CompletenessMeter
        filled={strength}
        total={100}
        valueLabel={`${strength}%`}
        label={t("profile_step.strength")}
      />

      <ul className="mt-4 flex flex-col gap-2">
        {rows.map((item) => (
          <li key={item.key} className="flex items-baseline gap-2 text-body-sm">
            <span
              aria-hidden="true"
              className={cn(
                "flex size-4 shrink-0 translate-y-0.5 items-center justify-center rounded-pill",
                item.done ? "text-ok-ink" : "border border-line-strong",
              )}
            >
              {item.done && <Check size={11} />}
            </span>
            <span className={cn("min-w-0 flex-1", item.done ? "text-body" : "text-ink")}>
              {t(item.done ? LABEL[item.key].done : LABEL[item.key].todo)}
            </span>
            {/*
              The points still on the table, not the points the item is worth.
              Showing the weight would tell a seller who has done half of
              something that they can earn it all again.
            */}
            {!item.done && (
              <span className="shrink-0 font-mono text-eyebrow tabular-nums text-muted">
                {t("profile_step.lever", { points: item.remaining })}
              </span>
            )}
          </li>
        ))}
      </ul>

      <p className="mt-4 border-t border-line pt-3 text-caption text-body">
        {lift
          ? t("profile_step.lift_measured", {
              threshold: lift.threshold,
              multiple: lift.multiple,
            })
          : t("profile_step.lift_mechanism")}
      </p>
      {/*
        The threshold the page argues towards, stated under whichever callout is
        above it. The number is interpolated from the shared config rather than
        written into the copy, so the sentence cannot outlive a change to it.
      */}
      <p className="mt-1 text-caption text-muted">
        {t("profile_step.threshold", { threshold })}
      </p>
    </section>
  );
}
