import { t } from "@/lib/i18n";
import type { RequiredField } from "./scope-sheet";

/**
 * The six required fields, in words, and the sentence that lists the missing
 * ones — boards `3f-s` and `8c-s`.
 *
 * Both screens name the gaps rather than counting them. `3f-s` writes *"Chiller
 * overhaul is live at 4 of 6 — no turnaround and no fee basis"*; `8c-s` writes
 * *"Turnaround and fee basis are the ones missing"*. Same six labels, same
 * join, and until this module existed `3f-s` held the only copy — so `8c-s`
 * would have been a second table that agreed until somebody renamed a field on
 * one screen.
 *
 * Resolved at module scope rather than passed in, because a function prop
 * crossing into a client component is this repository's most repeated defect
 * and `tests/unit/client-labels` fails the build on one.
 */
export const FIELD_LABEL: Record<RequiredField, string> = {
  name: t("service_editor.name"),
  engagementType: t("service_editor.engagement"),
  feeBasis: t("service_editor.fee_basis"),
  turnaround: t("service_editor.turnaround"),
  deliveredWhere: t("service_editor.delivered_where"),
  deliverable: t("service_editor.deliverable"),
};

/**
 * `no turnaround and no fee basis` — `3f-s`'s phrasing, inside a sentence.
 *
 * "no" on each item rather than once at the front, because *"no deliverable and
 * delivered where"* reads as one missing field and one present one, which is
 * the opposite of what it says.
 */
export function listGaps(gaps: readonly RequiredField[]): string {
  return join(gaps.map((gap) => t("services.gap_none", { field: FIELD_LABEL[gap].toLowerCase() })));
}

/**
 * `Turnaround and fee basis` — `8c-s`'s phrasing, as a subject.
 *
 * The first word keeps its capital because the callout puts this at the head of
 * a sentence; `listGaps` sits mid-sentence and does not.
 */
export function namedGaps(gaps: readonly RequiredField[]): string {
  const words = gaps.map((gap, index) =>
    index === 0 ? FIELD_LABEL[gap] : FIELD_LABEL[gap].toLowerCase(),
  );
  return join(words);
}

function join(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")}${t("services.gap_join")}${words.at(-1)}`;
}
