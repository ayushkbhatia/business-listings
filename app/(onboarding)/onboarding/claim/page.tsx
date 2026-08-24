import { t } from "@/lib/i18n";
import { OnboardingPage, requireClaimant } from "../_shell";
import { searchListings } from "../actions";
import { ClaimSearch } from "./ClaimSearch";

/**
 * Board 2a — the first step.
 *
 * Search over the imported licence records, because the alternative is 41,000
 * suppliers each creating a second listing beside the one buyers already
 * review.
 */
export const metadata = { title: "Find your business" };
export const dynamic = "force-dynamic";

export default async function ClaimPage() {
  await requireClaimant("claim");

  return (
    <OnboardingPage step="claim" title={t("claim.title")} intro={t("claim.intro")}>
      <ClaimSearch searchAction={searchListings} />
    </OnboardingPage>
  );
}
