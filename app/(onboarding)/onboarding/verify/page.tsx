import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/client";
import Link from "next/link";
import type { Metadata } from "next";
import { Alert } from "@/components/display";
import { buttonClassName } from "@/components/primitives";
import { formatDate, formatRelative } from "@/lib/format";
import { t } from "@/lib/i18n";
import {
  alreadyVerified,
  CLAIM_REVIEW_SLA_HOURS,
  countPublishedReviews,
  verifyStateFor,
  type VerifyState,
} from "@/lib/onboarding/verify";
import { OnboardingHeader, OnboardingSplit } from "../_chrome";
import { requireClaimant } from "../_shell";
import {
  claimListing,
  loadVerifyDraft,
  recordLicence,
  saveAndExit,
  scanLicence,
  signLicenceUpload,
} from "../actions";
import { SaveExitButton, VerifyFormProvider } from "./VerifyFormState";
import { VerifyRoutes } from "./VerifyRoutes";
import { VerifySidebar } from "./VerifySidebar";

/**
 * Board 2b — prove ownership.
 *
 * The gate. Everything before it is a search; everything after it is a listing
 * under somebody's control. This is the screen that decides whether a stranger
 * gets to speak for a licensed UAE business, so it is the one place in
 * onboarding where friction is correct — and the screen where a supplier is most
 * likely to abandon, which is why "Save & exit" is real and why verification
 * never blocks the next step.
 *
 * The business comes from the query string on the way in from board 2a, and from
 * the actor's own seat after that, so a refresh does not lose the step.
 */
export const metadata: Metadata = {
  title: t("verify.meta_title"),
  robots: { index: false, follow: true },
};

export const dynamic = "force-dynamic";

/**
 * Where verify hands off — board `2b-s`.
 *
 * The fork only where it is unanswered. A seller who has already said what they
 * sell continues to profile as they always did, and a published one is never
 * routed into a funnel screen whose only job would be to bounce them to
 * Settings.
 */
async function afterVerify(businessId: string): Promise<string> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { sellsKind: true, publishedAt: true },
  });
  const unanswered = business?.sellsKind === "unset" && business.publishedAt === null;
  return unanswered ? "/onboarding/kind" : "/onboarding/profile";
}

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ business?: string }>;
}) {
  const actor = await requireClaimant("verify");
  const { business: fromQuery } = await searchParams;

  // An id from 2a, a slug from a link somebody wrote, or the seat's own business
  // on a refresh. `verifyStateFor` resolves the first two to a row.
  const businessRef = fromQuery ?? actor.businessId;
  if (!businessRef) redirect("/onboarding/claim");

  const state = await verifyStateFor(businessRef, actor.id);
  if (!state) redirect("/onboarding/claim");

  // Where this step hands off, computed once and used by both the redirect
  // below and the Continue link at the bottom, so the two cannot disagree.
  const next = await afterVerify(state.businessId);

  /*
     Criterion 11. A supplier who reaches this URL on the back button after being
     verified must not be able to submit again: a second queue row on a settled
     listing is work for a reviewer that answers a question already answered.
  */
  /*
     Board 2b-s sits here: at the end of verify, after ownership is proven and
     before profile. It is not a step — it is the fork, and nothing in profile
     can be configured until it is answered.

     Only where it is unanswered. A seller who has already been through it goes
     straight on as before, and a published one is not dragged through a funnel
     screen that would only bounce them to Settings.
  */
  if (await alreadyVerified(state.businessId)) redirect(await afterVerify(state.businessId));

  // The one figure with a cache, composed here rather than inside the service —
  // `unstable_cache` only runs inside a request.
  const [reviewCount, draft, kindRow] = await Promise.all([
    countPublishedReviews(state.businessId),
    loadVerifyDraft(state.businessId),
    /*
       Board `2d-s`: the rail calls step 4 "Coverage" for a seller who sells
       work, and a shared component renders identically on every screen that
       carries it — so the name has to be the same here as it is two steps
       later. A seller arriving at verify for the first time has not answered
       yet and reads "Locations"; one who answered and came back reads their own
       answer, rather than the rail changing under them between steps.
    */
    prisma.business.findUnique({
      where: { id: state.businessId },
      select: { sellsKind: true },
    }),
  ]);
  const sellsKind = kindRow?.sellsKind ?? "unset";

  /*
     Once submitted the page is a status card, and there is no form left for
     "Save & exit" to save — so the chrome drops it rather than offering a
     control that would write an empty draft over nothing.
  */
  if (state.submittedAt) {
    return (
      <>
        <OnboardingHeader step="verify" sellsKind={sellsKind} signedIn />
        <OnboardingSplit aside={<VerifySidebar reviewCount={reviewCount} contested={state.contested} />}>
          <Heading state={state} />
          <div className="mt-6">
            <Submitted state={state} next={next} />
          </div>
        </OnboardingSplit>
      </>
    );
  }

  return (
    <VerifyFormProvider
      businessId={state.businessId}
      hasPhoneRoute={state.hasPhoneRoute}
      draft={draft}
      saveAction={saveAndExit}
    >
      {/*
        One 60px row, and "Save & exit" is the third thing in it — criterion 14.
        No mono step eyebrow, and no second header band: the rail already states
        both the position and the name of every step.
      */}
      <OnboardingHeader step="verify" sellsKind={sellsKind} signedIn trailing={<SaveExitButton />} />

      <OnboardingSplit aside={<VerifySidebar reviewCount={reviewCount} contested={state.contested} />}>
        <Heading state={state} />

        <div className="mt-6">
          <VerifyRoutes
            licenceAuthority={state.licenceAuthority}
            maskedPhone={state.maskedPhone}
            hasPhoneRoute={state.hasPhoneRoute}
            contested={state.contested}
            signAction={signLicenceUpload}
            recordAction={recordLicence}
            scanAction={scanLicence}
            claimAction={claimListing}
          />
        </div>
      </OnboardingSplit>
    </VerifyFormProvider>
  );
}

/**
 * The heading, and the one place on this page a legal name belongs.
 *
 * The claimant is proving ownership of a licensed entity, and the name here has
 * to match the name printed on the document they are about to upload — a
 * friendly display name would be actively confusing at the moment of matching,
 * and on an unclaimed record nobody has chosen one anyway.
 */
function Heading({ state }: { state: VerifyState }) {
  return (
    <>
      <h1 className="font-serif text-h1-serif text-ink sm:text-[2rem]">
        {t("verify.title", { name: state.tradeName /* licence-locked */ })}
      </h1>
      <p className="mt-3 max-w-prose text-body-sm text-body">
        {t("verify.intro", { hours: CLAIM_REVIEW_SLA_HOURS })}
      </p>

      {/*
        An expired licence is accepted, and says so before anybody uploads
        anything. The claim is taken and the badge withheld — an expired licence
        usually means a business under pressure, not a fake, and refusing it here
        would turn a renewal into a lost supplier.
      */}
      {state.licenceHasExpired && (
        <div className="mt-4">
          {/*
            The fix line is not decoration: `Alert` refuses a warn notice with no
            action and no fix, in development, on purpose — "something is wrong"
            with nothing to do about it is an apology rather than a notice.
          */}
          <Alert
            tone="warn"
            title={t("verify.expired_heading", { date: formatDate(state.licenceExpiry) })}
            fix={t("verify.expired_fix")}
          >
            {t("verify.expired_body")}
          </Alert>
        </div>
      )}
    </>
  );
}

/**
 * Submitted, awaiting review. Criterion 12.
 *
 * The page becomes a status card: what was submitted, when, the promise, and one
 * primary action onwards. **Verification does not block progress** — a supplier
 * fills in their profile while the queue works, and a screen that made them wait
 * would turn four working hours into four hours of nothing happening.
 */
function Submitted({ state, next }: { state: VerifyState; next: string }) {
  const routeLabel =
    state.submittedRoute === "phone_callback"
      ? t("verify.submitted_route.phone_callback")
      : t("verify.submitted_route.licence_upload");

  return (
    <div className="flex flex-col gap-4">
      <section
        aria-labelledby="submitted-heading"
        className="rounded-card-lg border border-ok-line bg-ok-surface p-5"
      >
        <h2 id="submitted-heading" className="text-h3 text-ink">
          {t("verify.submitted")}
        </h2>
        <p className="mt-2 max-w-prose text-body-sm text-body">
          {t("verify.submitted_body", {
            when: formatRelative(state.submittedAt ?? new Date()),
            hours: CLAIM_REVIEW_SLA_HOURS,
          })}
        </p>
        <p className="mt-2 font-mono text-eyebrow uppercase text-muted">{routeLabel}</p>
      </section>

      {/*
        Where two claims collide the confirmation states the path explicitly
        rather than leaving somebody to wonder why nothing has happened.
      */}
      {state.contested && (
        <Alert
          tone="warn"
          title={t("verify.contested_heading")}
          fix={t("verify.contested_after_fix")}
        >
          {t("verify.contested_after")}
        </Alert>
      )}

      <div>
        <Link href={next} className={buttonClassName({ size: "lg" })}>
          {t("verify.continue")}
        </Link>
      </div>
    </div>
  );
}
