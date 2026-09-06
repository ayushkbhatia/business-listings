import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * What a finished import run is called, in one place.
 *
 * Two screens report the same run — the wizard's own last step and the
 * catalogue's undo banner — and both said `64 products imported` over
 * `0 new · 64 updated`. Fixing one of them is how the two came to disagree
 * about a run in the first place, so the sentence lives here and neither screen
 * owns it.
 *
 * No `server-only` marker and no function props: a client component calls `t`
 * directly, and this returns a string rather than something that has to cross
 * the boundary. See `tests/unit/client-labels.test.ts`.
 */
export function runHeadline(run: { createdCount: number; updatedCount: number }): string {
  if (run.createdCount === 0) {
    return t("import.done_title_updated", {
      count: run.updatedCount,
      n: formatCount(run.updatedCount),
    });
  }
  if (run.updatedCount === 0) {
    return t("import.done_title", { count: formatCount(run.createdCount) });
  }
  return t("import.done_title_mixed", {
    created: formatCount(run.createdCount),
    updated: formatCount(run.updatedCount),
  });
}
