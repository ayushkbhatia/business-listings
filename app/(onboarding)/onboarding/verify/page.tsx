import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { t } from "@/lib/i18n";
import { OnboardingPage, requireClaimant } from "../_shell";
import { claimListing, recordLicence, signLicenceUpload } from "../actions";
import { VerifyRoutes } from "./VerifyRoutes";

/**
 * Board 2b — prove it is yours.
 *
 * The business comes from the query string on the way in from board 2a, and
 * from the actor's own seat after that, so a refresh does not lose the step.
 */
export const metadata = { title: "Prove it is yours" };
export const dynamic = "force-dynamic";

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ business?: string }>;
}) {
  const actor = await requireClaimant("verify");
  const { business: fromQuery } = await searchParams;

  const businessId = fromQuery ?? actor.businessId;
  if (!businessId) redirect("/onboarding/claim");

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      tradeName: true,
      claimStatus: true,
      locations: {
        where: { phone: { not: null } },
        take: 1,
        select: { phone: true },
      },
    },
  });
  if (!business) redirect("/onboarding/claim");

  return (
    <OnboardingPage step="verify" title={t("verify.title")} intro={t("verify.intro")}>
      <VerifyRoutes
        businessId={business.id}
        tradeName={business.tradeName}
        recordedPhone={business.locations[0]?.phone ?? null}
        contested={business.claimStatus === "claimed"}
        signAction={signLicenceUpload}
        recordAction={recordLicence}
        claimAction={claimListing}
      />
    </OnboardingPage>
  );
}
