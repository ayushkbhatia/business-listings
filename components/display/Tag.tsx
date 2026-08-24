import { cn } from "@/lib/cn";

/**
 * A label on a thing. A category, a material, a certification.
 *
 * Not a FilterChip: a Tag describes, a chip filters. If it can be removed it is
 * a chip, and a reader who has learned that will click a Tag expecting
 * something to happen.
 */
export interface TagProps {
  children: React.ReactNode;
  /** Renders as a link where the tag leads somewhere — a category, an area. */
  href?: string;
  mono?: boolean;
  size?: "sm" | "md";
}

export function Tag({ children, href, mono = false, size = "md" }: TagProps) {
  const classes = cn(
    "inline-flex items-center rounded-tag border border-line bg-fill whitespace-nowrap text-muted",
    size === "sm" ? "px-1.5 py-px text-eyebrow" : "px-2 py-0.5 text-caption",
    mono && "font-mono",
    href &&
      cn(
        "transition-colors duration-120 ease-out",
        "hover:border-line-strong hover:text-ink",
        "focus-visible:outline-none focus-visible:shadow-focus",
      ),
  );

  if (href) {
    return (
      <a href={href} className={classes}>
        {children}
      </a>
    );
  }
  return <span className={classes}>{children}</span>;
}
