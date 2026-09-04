import Link from "next/link";
import { StepHeader } from "@/components/structure";
import { STEPS, type Step } from "@/lib/onboarding/service";
import { t } from "@/lib/i18n";

/**
 * The frame every onboarding step wears — board 2a §1, unchanged on `2b`–`2e`.
 *
 * A 60px bar carrying three things and nothing else: the wordmark, the five-step
 * chain, and a way back for somebody who already has an account. No directory
 * nav, no search, no footer. A supplier three steps into claiming a listing has
 * nowhere else to be, and every other affordance on this bar is a way to lose
 * them.
 *
 * The chain is the shared `StepHeader`, at `inline`. Acceptance criterion 1
 * asks that it match across all five steps — same labels, same component, state
 * carried only by tick, colour and weight — which is a property of using one
 * component rather than a thing to check five times.
 *
 * The sign-in offer renders only for somebody signed out. It is what the board
 * draws, because the board draws the state 2a is normally in; showing "Already
 * have an account?" to a person who is plainly using theirs is the sort of
 * small dishonesty that makes a product feel like a template.
 */

const LABELS: Record<Step, string> = {
  claim: t("onboarding.step.claim"),
  verify: t("onboarding.step.verify"),
  profile: t("onboarding.step.profile"),
  locations: t("onboarding.step.locations"),
  plan: t("onboarding.step.plan"),
};

export function OnboardingHeader({ step, signedIn }: { step: Step; signedIn: boolean }) {
  return (
    <header className="flex min-h-[3.75rem] flex-wrap items-center gap-x-5 gap-y-2 border-b border-line bg-card px-[var(--section-pad)] py-2.5">
      <Link
        href="/"
        className="rounded-tag font-serif text-h2 text-ink focus-visible:shadow-focus focus-visible:outline-none"
      >
        {t("site.name")}
      </Link>

      <StepHeader
        variant="inline"
        steps={STEPS.map((key) => ({ key, label: LABELS[key] }))}
        current={STEPS.indexOf(step)}
        label={t("onboarding.sequence")}
        progressLabel={(current, total) =>
          t("onboarding.step_of", { current: String(current), total: String(total) })
        }
      />

      {!signedIn && (
        <p className="ms-auto text-body-sm text-body">
          {t("onboarding.have_account")}{" "}
          <Link
            href="/signin"
            className="rounded-tag font-medium text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          >
            {t("onboarding.sign_in")}
          </Link>
        </p>
      )}
    </header>
  );
}

/**
 * The 760px centred column the funnel reads in.
 *
 * Full width with gutters below `md`, per the board's responsive notes: an
 * outbound recruitment message lands on a phone, and this is the page it opens.
 */
export function OnboardingColumn({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-[47.5rem] px-[var(--section-pad)] pb-16 pt-8 md:pt-11">
      {children}
    </main>
  );
}
