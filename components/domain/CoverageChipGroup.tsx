import { cn } from "@/lib/cn";

/**
 * The coverage chips — one component, three screens.
 *
 * `2d-s`'s onboarding step, the per-service card on `3g-s`'s editor and `3c-s`'s
 * coverage manager all draw the same eight toggle buttons, and before this each
 * drew its own. Three copies of a chip is three answers to *what does a pressed
 * chip look like*, which is how one screen ends up with a border the other two
 * do not have.
 *
 * Toggle buttons with `aria-pressed`, in a list, and nothing else. The heading,
 * the counts and the save behaviour belong to the caller, because they differ:
 * onboarding autosaves a chip, the manager stages a set, and neither decision
 * belongs in the thing that draws a pill.
 */

export interface CoverageChipOption {
  key: string;
  label: string;
  on: boolean;
}

export function CoverageChipGroup({
  chips,
  onToggle,
  disabled = false,
  inert = false,
  className,
}: {
  chips: readonly CoverageChipOption[];
  onToggle: (key: string, on: boolean) => void;
  disabled?: boolean;
  /** Drawn faded and unpressable — the chips exist but cannot be answered yet. */
  inert?: boolean;
  className?: string;
}) {
  return (
    <ul className={cn("flex list-none flex-wrap gap-1.5 p-0", inert && "opacity-50", className)}>
      {chips.map((chip) => (
        <li key={chip.key}>
          <button
            type="button"
            aria-pressed={chip.on}
            disabled={disabled || inert}
            onClick={() => onToggle(chip.key, !chip.on)}
            className={cn(
              "rounded-pill border px-3 py-1.5 text-caption",
              "focus-visible:shadow-focus focus-visible:outline-none",
              "disabled:cursor-not-allowed",
              chip.on
                ? "border-moss bg-moss-wash text-moss-deep"
                : "border-line bg-card text-body hover:border-moss-muted",
            )}
          >
            {chip.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
