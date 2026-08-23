import { cn } from "@/lib/cn";

/**
 * A field label.
 *
 * Required is a word, never an asterisk — an asterisk is colour-and-symbol
 * shorthand that a screen reader reads as "star" and a first-time user reads as
 * a footnote. Optional is also a word, for the rarer case where most of a form
 * is required and the exceptions need calling out. Never show both conventions
 * in one form.
 */
export interface LabelProps extends Omit<React.ComponentPropsWithoutRef<"label">, "className"> {
  children: React.ReactNode;
  requirement?: "required" | "optional" | "none";
  /** Text for the requirement marker, from t(). */
  requirementLabel?: string;
  /** A short clarification under the label. Not a placeholder. */
  hint?: string;
  disabled?: boolean;
}

export function Label({
  children,
  requirement = "none",
  requirementLabel,
  hint,
  disabled = false,
  ...rest
}: LabelProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <label
        className={cn(
          "flex items-baseline gap-1.5 text-caption font-medium",
          disabled ? "text-disabled-text" : "text-body",
        )}
        {...rest}
      >
        <span>{children}</span>
        {requirement !== "none" && requirementLabel && (
          <span
            className={cn(
              "font-mono text-eyebrow uppercase",
              requirement === "required" ? "text-muted" : "text-faint",
            )}
          >
            {requirementLabel}
          </span>
        )}
      </label>
      {hint && <span className="text-caption text-muted">{hint}</span>}
    </div>
  );
}
