import Link from "next/link";
import { StepHeader } from "@/components/structure";
import { cn } from "@/lib/cn";
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
 * One row, never two. Board 2b's criterion 14 is explicit: no mono `STEP 2 OF 5`
 * eyebrow beside the rail and no second header band, because the rail already
 * states both the position and the name of every step and an eyebrow next to it
 * says the same thing twice. The only place a `n / 5` appears is below `md`,
 * where it *replaces* the rail rather than accompanying it.
 *
 * The right-hand slot is the one thing that differs across the five steps: the
 * sign-in offer where nobody is signed in — which is 2a's normal state — and
 * "Save & exit" once there is a half-finished thing worth keeping. A page passes
 * `trailing`; the bar decides nothing for itself.
 *
 * Showing "Already have an account?" to a person who is plainly using theirs is
 * the sort of small dishonesty that makes a product feel like a template, so the
 * default offer is rendered only when signed out.
 */

const LABELS: Record<Step, string> = {
  claim: t("onboarding.step.claim"),
  verify: t("onboarding.step.verify"),
  profile: t("onboarding.step.profile"),
  locations: t("onboarding.step.locations"),
  plan: t("onboarding.step.plan"),
};

export function OnboardingHeader({
  step,
  signedIn,
  trailing,
}: {
  step: Step;
  signedIn: boolean;
  /** The right-hand slot. "Save & exit" on the steps that have state to save. */
  trailing?: React.ReactNode;
}) {
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

      {trailing ? (
        <div className="ms-auto">{trailing}</div>
      ) : (
        !signedIn && (
          <p className="ms-auto text-body-sm text-body">
            {t("onboarding.have_account")}{" "}
            <Link
              href="/signin"
              className="rounded-tag font-medium text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
            >
              {t("onboarding.sign_in")}
            </Link>
          </p>
        )
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
export function OnboardingColumn({
  children,
  wide = false,
}: {
  children: React.ReactNode;
  /**
   * Board 2c's width. That step is a form beside a live preview of the card the
   * form produces, and the preview is the argument rather than an ornament — at
   * 760px the two columns are each too narrow to be what they are.
   */
  wide?: boolean;
}) {
  return (
    <main
      className={cn(
        "mx-auto w-full px-[var(--section-pad)] pb-16 pt-8 md:pt-11",
        wide ? "max-w-[75rem]" : "max-w-[47.5rem]",
      )}
    >
      {children}
    </main>
  );
}

/**
 * Board 2b's frame: a 640px column of work and a 320px column of reassurance.
 *
 * The sidebar falls below the actions under `lg` rather than beside them,
 * because at 768–1023 a 320px rail leaves the form too narrow for a two-up field
 * row — and the sidebar answers a question ("do I lose my reviews?") that is
 * still answered after the form rather than only before it.
 *
 * `aside` rather than a second `div`: it is complementary content, it has a
 * heading, and a screen-reader user should be able to jump past the form to it
 * and back.
 */
export function OnboardingSplit({
  children,
  aside,
}: {
  children: React.ReactNode;
  aside: React.ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-[62rem] px-[var(--section-pad)] pb-16 pt-8 md:pt-10">
      <div className="flex flex-col gap-8 lg:flex-row lg:gap-[2.125rem]">
        <div className="min-w-0 flex-1 lg:max-w-[40rem]">{children}</div>
        <aside className="w-full shrink-0 lg:w-[18.75rem] xl:w-[20rem]">{aside}</aside>
      </div>
    </main>
  );
}
