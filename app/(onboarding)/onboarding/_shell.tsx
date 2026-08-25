import "server-only";
import { redirect } from "next/navigation";
import { StepHeader } from "@/components/structure";
import { getActor } from "@/lib/auth/session";
import { STEPS, type Step } from "@/lib/onboarding/service";
import { t } from "@/lib/i18n";

/**
 * The frame every onboarding step shares.
 *
 * A signed-in user is required and an anonymous one is sent to sign up with a
 * `next` back to where they were — the funnel starts *after* an account exists,
 * because a claim has to belong to somebody.
 */

const LABELS: Record<Step, string> = {
  claim: t("onboarding.step.claim"),
  verify: t("onboarding.step.verify"),
  profile: t("onboarding.step.profile"),
  locations: t("onboarding.step.locations"),
  plan: t("onboarding.step.plan"),
};

export async function requireClaimant(step: Step) {
  const actor = await getActor();
  if (!actor) {
    redirect(`/signup?next=${encodeURIComponent(`/onboarding/${step}`)}`);
  }
  return actor;
}

export function OnboardingPage({
  step,
  title,
  intro,
  children,
}: {
  step: Step;
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
   * landmark. A screen-reader user had nothing to jump to on the first screen
   * a supplier ever sees.
   */
  return (
    <main className="mx-auto w-full max-w-[52rem] px-[var(--section-pad)] py-8">
      <div className="overflow-hidden rounded-panel border border-line bg-card">
        <StepHeader
          steps={STEPS.map((key) => ({ key, label: LABELS[key] }))}
          current={STEPS.indexOf(step)}
          label={t("onboarding.sequence")}
          progressLabel={(current, total) =>
            t("rfq.step_of", { current: String(current), total: String(total) })
          }
        />
        <div className="flex flex-col gap-4 p-5">
          <div>
            <h1 className="text-h1 text-ink">{title}</h1>
            {intro && <p className="mt-1 max-w-prose text-body-sm text-muted">{intro}</p>}
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}
