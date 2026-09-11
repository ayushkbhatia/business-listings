import "server-only";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/session";
import type { Step } from "@/lib/onboarding/service";
import type { SellsKind } from "@/lib/db/generated/enums";
import { OnboardingColumn, OnboardingHeader } from "./_chrome";

/**
 * The frame every onboarding step shares.
 *
 * `2b`–`2e` require a signed-in user, and an anonymous one is sent to sign up
 * with a `next` back to where they were — a claim has to belong to somebody, and
 * the evidence step is the first that writes a row.
 *
 * **`2a` is the exception, deliberately.** The search is unauthenticated (board
 * 2a, acceptance criterion 12) because it reads the public licence register, and
 * because a supplier who has to create an account to find out whether we hold
 * their business is a supplier who does not find out. The account is asked for
 * at the point it becomes necessary, which is choosing a listing.
 */

export async function requireClaimant(step: Step) {
  const actor = await getActor();
  if (!actor) {
    redirect(`/signup?next=${encodeURIComponent(`/onboarding/${step}`)}`);
  }
  return actor;
}

export function OnboardingPage({
  step,
  signedIn = true,
  sellsKind = "unset",
  title,
  intro,
  children,
}: {
  step: Step;
  /** Drives the sign-in offer in the header. `2b`–`2e` are always signed in. */
  signedIn?: boolean;
  /** Board `2d-s`: renames step 4 on the rail, and nothing else. */
  sellsKind?: SellsKind;
  title: string;
  intro?: string;
  children: React.ReactNode;
}) {
  /*
   * A `<main>`, because the onboarding frame has no shell around it.
   *
   * The dashboard gets one from DashboardShell and the public pages from
   * PublicShell; this layout was written bare and inherited neither, so every
   * step failed `landmark-one-main` and put all its content outside any
   * landmark. A screen-reader user had nothing to jump to on the first screen a
   * supplier ever sees. `OnboardingColumn` is that `<main>`.
   */
  return (
    <>
      <OnboardingHeader step={step} signedIn={signedIn} sellsKind={sellsKind} />
      <OnboardingColumn>
        <div className="flex flex-col gap-4">
          <div>
            <h1 className="text-h1 text-ink">{title}</h1>
            {intro && <p className="mt-1 max-w-prose text-body-sm text-muted">{intro}</p>}
          </div>
          {children}
        </div>
      </OnboardingColumn>
    </>
  );
}
