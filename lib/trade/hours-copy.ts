import { t } from "@/lib/i18n";
import type { HoursProblem } from "./hours";

/**
 * What is wrong with a shift, in words.
 *
 * Separate from `lib/listing/service.ts` because that module is `server-only`
 * and the editor showing the same message runs in the browser. Both import
 * this, so a seller cannot be told one thing while typing and another on save.
 */
export function describeProblemText(problem: HoursProblem): string {
  switch (problem.kind) {
    case "bad_time":
      return t("hours.problem.bad_time", { value: problem.value });
    case "backwards":
      return t("hours.problem.backwards", { open: problem.open, close: problem.close });
    case "overlap":
      return t("hours.problem.overlap", {
        first: `${problem.first.open}–${problem.first.close}`,
        second: `${problem.second.open}–${problem.second.close}`,
      });
  }
}
