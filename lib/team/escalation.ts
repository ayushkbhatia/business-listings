import { t } from "@/lib/i18n";

/**
 * How long an unanswered enquiry waits before the owner hears about it.
 *
 * Pure, and in its own module rather than in `lib/team/service.ts`, because two
 * screens set this number and one of them is a client component — a
 * `server-only` import would pull Prisma into the browser bundle, which
 * typecheck and lint both allow and the build catches.
 *
 * One list and one label for both. Board 7d's routing card and board 7e's
 * escalation card are the same setting through two doors, and they were reading
 * it in different units: the alerts screen said "120 minutes" where the team
 * screen said "2 hours". A seller checking one against the other has to do
 * arithmetic to find out whether they agree, which is the point at which they
 * stop believing either.
 */

/** Offered in the intervals a supplier actually thinks in. */
export const ESCALATION_CHOICES = [30, 60, 120, 240, 480] as const;

export type EscalationMinutes = (typeof ESCALATION_CHOICES)[number];

/** "30 minutes", "1 hour", "8 hours". Never "1 hours" and never "120 minutes". */
export function escalationLabel(minutes: number): string {
  return minutes < 60
    ? t("routing.minutes", { count: minutes })
    : t("routing.hours", { count: minutes / 60 });
}

/** The choices, ready for a `Select`. */
export function escalationOptions(): { value: string; label: string }[] {
  return ESCALATION_CHOICES.map((minutes) => ({
    value: String(minutes),
    label: escalationLabel(minutes),
  }));
}
