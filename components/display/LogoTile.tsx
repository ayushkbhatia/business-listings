import { cn } from "@/lib/cn";
import { CategoryMark } from "./CategoryMark";

/**
 * A supplier's logo, or an honest stand-in.
 *
 * Most of the directory is unclaimed licence imports with no logo, so the
 * fallback is the common case rather than the exception. It shows the
 * category's two-letter mark: a real fact about the business. Generating
 * initials from the trade name would be a worse copy of the name already
 * sitting beside it, and generating a colour from a hash of the name invents a
 * brand the supplier never chose.
 */
export interface LogoTileProps {
  /** Resolved URL. Absent renders the category mark. */
  src?: string | null;
  /** The business name — the alt text, not a rendered initial. */
  name: string;
  /** The category's two-letter code, for the fallback. */
  categoryCode?: string;
  size?: "sm" | "md" | "lg";
  rounded?: "chip" | "card";
}

const SIZE = { sm: "size-8", md: "size-11", lg: "size-16" } as const;
const MARK = { sm: "sm", md: "md", lg: "lg" } as const;

export function LogoTile({ src, name, categoryCode, size = "md", rounded = "chip" }: LogoTileProps) {
  const radius = rounded === "card" ? "rounded-card" : "rounded-chip";

  if (src) {
    return (
      // A plain img: these are arbitrary seller uploads on a Supabase bucket,
      // and next/image's optimiser is not worth the config here.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        className={cn("shrink-0 border border-line bg-card object-contain", SIZE[size], radius)}
      />
    );
  }

  if (categoryCode) {
    return <CategoryMark code={categoryCode} size={MARK[size]} />;
  }

  return (
    <span
      aria-hidden="true"
      className={cn("shrink-0 border border-line bg-fill", SIZE[size], radius)}
    />
  );
}
