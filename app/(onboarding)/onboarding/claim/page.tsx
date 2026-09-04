import { Suspense } from "react";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Alert } from "@/components/display";
import { prisma } from "@/lib/db/client";
import { getActor } from "@/lib/auth/session";
import { getBuyerFacts } from "@/lib/db/queries/entry";
import { checkRate, recordHit, requesterKey, retryAfterSeconds } from "@/lib/rate-limit";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { OnboardingColumn, OnboardingHeader } from "../_chrome";
import { AddBusinessCard, ClaimResults, ClaimResultsSkeleton } from "./ClaimResults";
import { ClaimSearchForm } from "./ClaimSearchForm";

/**
 * Board 2a — the first screen of the supply side.
 *
 * One job: get a supplier to recognise their own business in our data.
 * Everything else follows from that recognition — a supplier who finds their
 * record inherits its reviews, its search position and its enquiry history, and
 * that inheritance is the argument for claiming rather than starting fresh
 * somewhere else.
 *
 * ## Why this route is public
 *
 * Every other step in the funnel requires a seat. This one does not, and that
 * is acceptance criterion 12 rather than an oversight. The search reads the
 * public licence register, and a supplier who must create an account to find
 * out whether we hold their business is a supplier who does not find out. The
 * account is asked for at the point it becomes necessary — choosing a listing —
 * and the chosen listing rides through the sign-up in `next`.
 *
 * Unauthenticated is not unmetered. `claim_search` is rate-limited per caller,
 * and the refusal says the limit and when it clears rather than pretending the
 * search broke.
 *
 * ## Why it is `noindex, follow`
 *
 * A funnel step, not a landing page. It is reached from `1l`, the `1a` call to
 * action, the claim prompt on an unclaimed listing, and outbound recruitment
 * links from the ops CRM that carry a pre-filled `q`. `follow`, because the
 * links out of it are worth crawling.
 */
export const metadata: Metadata = {
  title: "Find your business",
  robots: { index: false, follow: true },
};

export const dynamic = "force-dynamic";

export default async function ClaimPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const [{ q }, actor] = await Promise.all([searchParams, getActor()]);
  const query = (Array.isArray(q) ? q[0] : q)?.trim() ?? "";

  /*
     A seller who already holds a claimed listing is sent to their dashboard,
     with the reason stated when they arrive rather than a silent bounce.

     Read from the record, not from the seat: a seat is attached the moment a
     claim is submitted, so `actor.businessId` alone would also turn away
     somebody whose claim is still undecided — and they are exactly the person
     who might need to come back here.
  */
  if (actor?.businessId) {
    const mine = await prisma.business.findUnique({
      where: { id: actor.businessId },
      select: { claimStatus: true },
    });
    if (mine?.claimStatus === "claimed") redirect("/dashboard?notice=one_business");
  }

  const signedIn = actor !== null;
  const facts = await getBuyerFacts();

  /*
     Metered per search, not per page view. Somebody reading the pitch costs
     nothing; the trigram query over the licence set is the thing worth
     counting, and counting page views would throttle a person who has not yet
     typed anything.
  */
  let refusedFor: number | null = null;
  if (query.length >= 2) {
    const key = await requesterKey(actor?.id);
    const decision = await checkRate("claim_search", key);
    if (decision.allowed) await recordHit("claim_search", key);
    else refusedFor = retryAfterSeconds(decision);
  }

  return (
    <>
      <OnboardingHeader step="claim" signedIn={signedIn} />

      <OnboardingColumn>
        {/*
          A step down on a phone. At the display size this question runs to
          three lines on a 375px screen and pushes the search bar — the one
          thing on the page — below the fold, on the viewport an outbound
          recruitment message lands on.
        */}
        <h1 className="text-center font-serif text-h1-serif text-ink sm:text-display">
          {t("claim.title")}
        </h1>

        {/*
          The count is a query with an hour's cache, shared with the two entry
          surfaces so the directory cannot quote itself two different sizes on
          two pages. The second sentence is the entire pitch and is literally
          true: reviews, enquiry history and the slug all survive a claim, which
          tests/integration/onboarding-claim.test.ts asserts rather than trusts.
        */}
        <p className="mx-auto mt-3 max-w-prose text-center text-prose text-body">
          {t("claim.intro", { count: formatCount(facts.listings) })}
        </p>

        <ClaimSearchForm initialQuery={query} />

        {refusedFor !== null ? (
          <div className="mt-6">
            <Alert
              tone="warn"
              live="assertive"
              fix={t("claim.too_many_fix", { count: refusedFor })}
            >
              {t("claim.too_many")}
            </Alert>
          </div>
        ) : query.length >= 2 ? (
          /*
            Keyed on the query so a second search shows the skeleton again
            rather than holding the previous results while the new ones load.
            Stale rows under a new query is the one loading state that can send
            somebody to the wrong listing.
          */
          <Suspense key={query} fallback={<ClaimResultsSkeleton />}>
            <ClaimResults query={query} signedIn={signedIn} />
          </Suspense>
        ) : (
          /*
            No query yet. The page is the search bar and the pitch, and the one
            other thing on offer. No results card, empty or otherwise.
          */
          <AddBusinessCard signedIn={signedIn} />
        )}
      </OnboardingColumn>
    </>
  );
}
