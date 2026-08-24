import type { Metadata } from "next";

/**
 * The onboarding frame.
 *
 * Deliberately without the dashboard sidebar. A supplier three steps into
 * claiming a listing has no business being offered "Sponsored placement" — the
 * funnel is linear and finishes, and everything after it is a loop. Board 9b
 * draws exactly that boundary.
 */
export const metadata: Metadata = { title: { default: "Set up your listing", template: "%s" } };

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-paper">{children}</div>;
}
