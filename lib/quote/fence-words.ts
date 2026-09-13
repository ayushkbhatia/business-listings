import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { QuoteFenceReason } from "./fence";

/**
 * The sentence a supplier reads when the fence refuses.
 *
 * Kept out of `fence.ts` so the rule stays free of wording, and out of the
 * services so a refusal is a code until the moment it is shown — the same split
 * `lib/reports/service.ts` settled on: a service returns the fact as a key, the
 * caller does the wording.
 *
 * Each says what happened and what, if anything, is still open to them. None
 * says the seller did something wrong, because none of these are mistakes.
 */
export function quoteFenceMessage(reason: QuoteFenceReason, closesAt: Date): string {
  switch (reason) {
    case "accepted_yours":
      return t("quote.error.accepted_yours");
    case "accepted_elsewhere":
      return t("quote.error.accepted_elsewhere");
    case "declined":
      return t("quote.error.declined");
    case "marked":
      return t("quote.error.marked");
    case "suspended":
      return t("quote.error.suspended");
    case "closed":
      return t("quote.error.closed", { when: formatDate(closesAt) });
  }
}
