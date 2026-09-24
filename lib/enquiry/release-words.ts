import { t } from "@/lib/i18n";

/**
 * What accepting a quote hands the supplier, named — board `1n` `B9`.
 *
 * The comparison said *your contact details are released*, the thread said
 * *your name, mobile and company*, and the accept screen said *your contact
 * details*: three screens, three answers, none of them what the query layer
 * does. `lib/db/queries/seller-visibility.ts` is the release, and it selects:
 *
 * - the buyer's full name, mobile and email — always;
 * - on a company enquiry (`7b`), the company's registered name, TRN, trade
 *   licence number and accounts email, for the tax invoice the supplier issues;
 * - where the enquiry was sent for a saved delivery address, its street line
 *   and the person to ask for there (`7b` B6).
 *
 * Each is one sentence, so a screen can list them as facts or run them together
 * as a paragraph, and every screen says the same thing the query does.
 */
export interface ReleaseFacts {
  /** The company the enquiry was raised for. Null on a personal enquiry. */
  companyName: string | null;
  hasDeliveryAddress: boolean;
}

export function releaseSentences(facts: ReleaseFacts, supplier: string | null): string[] {
  return [
    supplier ? t("release.person_named", { supplier }) : t("release.person"),
    ...(facts.companyName ? [t("release.company", { company: facts.companyName })] : []),
    ...(facts.hasDeliveryAddress ? [t("release.address")] : []),
  ];
}
