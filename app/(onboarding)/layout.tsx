import type { Metadata } from "next";

/**
 * The onboarding frame.
 *
 * Deliberately without the dashboard sidebar. A supplier three steps into
 * claiming a listing has no business being offered "Sponsored placement" — the
 * funnel is linear and finishes, and everything after it is a loop. Board 9b
 * draws exactly that boundary.
 *
 * `comfortable` is the tenant density board 2a specifies, set once here and
 * inherited. It was missing, so every control in the funnel was reading the
 * unset defaults rather than the density the rest of the tenant surface uses.
 */
export const metadata: Metadata = { title: { default: "Set up your listing", template: "%s" } };

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-density="comfortable" className="flex min-h-dvh flex-col bg-paper">
      {children}
    </div>
  );
}
