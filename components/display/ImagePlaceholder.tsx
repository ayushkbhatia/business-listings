import { cn } from "@/lib/cn";
import { ImageIcon } from "./icons";

/**
 * Two different absences, and they must not look alike.
 *
 * `loading` is a real image that has not arrived — diagonal stripes, no border,
 * it will be replaced in a moment. `empty` is a thing with no image at all —
 * a dashed border, because a dashed border means "add something here" and this
 * is where a seller adds a photo.
 *
 * Confusing the two makes a slow gallery look broken and an empty one look
 * broken in a different way.
 */
export type PlaceholderKind = "loading" | "empty";

export interface ImagePlaceholderProps {
  kind?: PlaceholderKind;
  /** Aspect ratio as a CSS value, e.g. "4 / 3". */
  ratio?: string;
  /** Shown inside an empty placeholder. Nothing renders for loading. */
  label?: string;
  rounded?: "card" | "chip" | "none";
  className?: string;
}

export function ImagePlaceholder({
  kind = "loading",
  ratio = "4 / 3",
  label,
  rounded = "card",
  className,
}: ImagePlaceholderProps) {
  const radius =
    rounded === "card" ? "rounded-card" : rounded === "chip" ? "rounded-chip" : undefined;

  if (kind === "loading") {
    return (
      <div
        aria-hidden="true"
        style={{
          aspectRatio: ratio,
          backgroundImage:
            "repeating-linear-gradient(135deg, var(--placeholder-stripe-a) 0 8px, var(--placeholder-stripe-b) 8px 16px)",
        }}
        className={cn("w-full motion-safe:animate-pulse", radius, className)}
      />
    );
  }

  return (
    <div
      style={{
        aspectRatio: ratio,
        backgroundImage:
          "repeating-linear-gradient(135deg, var(--placeholder-empty-a) 0 10px, var(--placeholder-empty-b) 10px 20px)",
      }}
      className={cn(
        "flex w-full flex-col items-center justify-center gap-1.5 border-2 border-dashed border-line-strong",
        radius,
        className,
      )}
    >
      <ImageIcon size={18} className="text-faint" />
      {label && <span className="px-2 text-center text-caption text-muted">{label}</span>}
    </div>
  );
}
