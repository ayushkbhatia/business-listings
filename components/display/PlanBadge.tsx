import { cn } from "@/lib/cn";

/**
 * Which plan a seller is on. Free, Basic, Pro.
 *
 * Deliberately quiet on a public surface: a buyer choosing a supplier should be
 * reading verification and response time, not who pays us more. It exists for
 * the dashboard and the admin list, and for the one public place it belongs —
 * the pricing page.
 */
export type PlanTier = "free" | "basic" | "pro";

export interface PlanBadgeProps {
  plan: PlanTier;
  /** The plan's display name, from the database rather than hardcoded. */
  label: string;
  size?: "sm" | "md";
}

const PLAN: Record<PlanTier, string> = {
  free: "border-line bg-fill text-muted",
  basic: "border-line-strong bg-card text-body",
  pro: "border-moss bg-moss-wash text-moss-deep",
};

export function PlanBadge({ plan, label, size = "md" }: PlanBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-chip border font-mono uppercase whitespace-nowrap",
        size === "sm" ? "px-1.5 py-px text-eyebrow" : "px-2 py-0.5 text-eyebrow",
        PLAN[plan],
      )}
    >
      {label}
    </span>
  );
}
