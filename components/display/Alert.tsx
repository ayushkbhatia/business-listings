import { cn } from "@/lib/cn";

/**
 * Alert — component 65, the inline notice from design-system §05.1.
 *
 * Approved as an addition to tier 3, replacing the hand-rolled notice blocks
 * this repo had grown twenty-one of. Every one of them was the same four
 * classes and a `role="alert"`, copied from the last screen, so nothing
 * governed how a validation message looked or how it announced itself — and a
 * validation message is one of the highest-traffic surfaces in the product.
 *
 * **No icon.** The copy carries the tone. An icon on a notice is a second
 * channel saying the same thing to people who can already read the sentence,
 * and nothing at all to the ones who cannot — a red triangle is not a reason.
 * The five tones are colour and wording; the wording is the part that works
 * everywhere.
 *
 * **A notice describing a problem must carry the action that fixes it.** This
 * is the one rule the inventory states outright, and it is enforced here rather
 * than left to a review: a `bad` or `warn` Alert with no `action` and no
 * `fix` line is refused in development. "Something went wrong" is not a
 * notice, it is an apology.
 *
 * One action, never two. A notice offering a choice is a dialog wearing a
 * notice's clothes, and it belongs in a Modal where the choice can be read
 * before either half is clicked.
 */

export type AlertTone = "ok" | "warn" | "bad" | "info" | "neutral";

export interface AlertProps {
  tone?: AlertTone;
  /** The notice. One or two sentences; the tone lives in these words. */
  children: React.ReactNode;
  /**
   * What to do about it. Required in spirit for `warn` and `bad` — see `fix`
   * for the case where the answer is a sentence rather than a control.
   */
  action?: React.ReactNode;
  /**
   * The fix, where it is something the reader does rather than something they
   * click. Satisfies the same rule as `action`.
   */
  fix?: string;
  /**
   * Announced to assistive technology as it appears.
   *
   * `assertive` interrupts and is right for a validation failure the reader
   * caused by submitting. `polite` waits for a pause and is right for a
   * confirmation. Off entirely for a notice that was on the page before they
   * were — announcing static content on load is noise.
   */
  live?: "assertive" | "polite" | "off";
  /** A short lead-in, e.g. "Not imported". Rendered in the tone's ink. */
  title?: string;
}

const TONE: Record<AlertTone, { surface: string; line: string; ink: string }> = {
  ok: { surface: "bg-ok-surface", line: "border-ok-line", ink: "text-ok-ink" },
  warn: { surface: "bg-warn-surface", line: "border-warn-line", ink: "text-warn-ink" },
  bad: { surface: "bg-bad-surface", line: "border-bad-line", ink: "text-bad-ink" },
  // Info borrows the moss wash rather than a blue this palette does not have.
  info: { surface: "bg-moss-wash", line: "border-moss-muted", ink: "text-moss-deep" },
  neutral: { surface: "bg-paper-sunk", line: "border-line", ink: "text-prose" },
};

/** Tones that describe a problem, and therefore owe the reader a way out. */
const OWES_A_FIX: readonly AlertTone[] = ["warn", "bad"];

export function Alert({
  tone = "neutral",
  children,
  action,
  fix,
  live,
  title,
}: AlertProps) {
  if (process.env.NODE_ENV !== "production" && OWES_A_FIX.includes(tone) && !action && !fix) {
    // Loud in development, silent in production: a notice that reaches a
    // supplier without its fix is bad, and a page that crashes instead of
    // showing it is worse.
    console.error(
      `[Alert] a "${tone}" notice must carry the action that fixes it — pass \`action\` or \`fix\`. ` +
        "design-system §05.1, component 65.",
    );
  }

  const palette = TONE[tone];
  const role = live === "assertive" ? "alert" : live === "polite" ? "status" : undefined;

  return (
    <div
      role={role}
      // `aria-live` on the same node as role=alert is redundant but harmless,
      // and it is what makes role=status announce politely in Safari.
      {...(live && live !== "off" ? { "aria-live": live } : {})}
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 rounded-ctl border px-3 py-2",
        palette.surface,
        palette.line,
      )}
    >
      <div className="min-w-0">
        {title && <p className={cn("text-body-sm font-medium", palette.ink)}>{title}</p>}
        <div className={cn("max-w-prose text-body-sm", palette.ink, title && "mt-0.5")}>
          {children}
        </div>
        {fix && <p className={cn("mt-1 max-w-prose text-caption", palette.ink)}>{fix}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
