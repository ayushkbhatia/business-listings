import { t } from "@/lib/i18n";
import type { PasswordAssessment, PasswordProblem } from "@/lib/auth/password-policy";

/**
 * The words for a password — the meter's label and the refusal's sentence.
 *
 * A plain module, imported by the client meter and by the server's failure
 * notice alike, so the meter under the field and the refusal above it are the
 * same sentence. `t()` is pure and runs on either side.
 */

/** One sentence per rule the password broke. */
export function passwordProblem(problem: PasswordProblem | string | undefined, length: number): string {
  switch (problem) {
    case "too_short":
      return t("auth.password.too_short", { count: length });
    case "too_long":
      return t("auth.password.too_long");
    case "repeated":
    case "sequence":
      return t("auth.password.pattern");
    case "common":
      return t("auth.password.common");
    case "contains_identifier":
      return t("auth.password.contains_identifier");
    default:
      return t("auth.password.empty");
  }
}

/** Board 7a: "Strong — 12 characters". */
export function strengthLabel(assessment: PasswordAssessment): string {
  if (assessment.length === 0) return t("auth.password.hint");
  if (assessment.problem) return passwordProblem(assessment.problem, assessment.length);
  return t(assessment.strength === 4 ? "auth.password.very_strong" : "auth.password.strong", {
    count: assessment.length,
  });
}
