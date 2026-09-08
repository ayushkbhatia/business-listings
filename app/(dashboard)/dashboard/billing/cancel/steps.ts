import type { Step } from "@/components/structure";
import { t } from "@/lib/i18n";

/**
 * The two steps, named once.
 *
 * Boards 11h and 11j ship as one spec for exactly this reason: two specs for
 * two steps is how a step indicator drifts from a step count. Two *files*
 * writing their own copy of the chain is the same drift one layer down — and
 * the board already had it, with `← What changes` in the header and
 * `← Review the full list` in the rail for one destination.
 *
 * A function rather than a constant because `t()` reads the catalogue at call
 * time, and a module-level constant would freeze the labels at import.
 */
export function CANCEL_STEPS(): Step[] {
  return [
    { key: "changes", label: t("cancel.step.changes"), href: "/dashboard/billing/cancel" },
    { key: "reason", label: t("cancel.step.reason") },
  ];
}
