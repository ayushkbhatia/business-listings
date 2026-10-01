import Link from "next/link";
import { StatusBadge } from "@/components/display";
import { buttonClassName } from "@/components/primitives";
import { t } from "@/lib/i18n";
import type { OverviewScreen } from "./present";

/**
 * The two things board 4a puts in the shell's header beside its title, shared
 * by the page and the gallery so both draw the same states.
 */

/**
 * B9 — the status chip. It reads the health source `13e`'s maintenance mode
 * reads, names any system a window takes down, and links to what the public
 * sees. A word beside the dot, never the dot alone.
 */
export function StatusChip({ status }: { status: OverviewScreen["status"] }) {
  const badge = (
    <StatusBadge tone={status.tone} dot>
      {status.label}
    </StatusBadge>
  );
  if (!status.href) return badge;
  return (
    <Link href={status.href} className="rounded-pill focus-visible:shadow-focus focus-visible:outline-none">
      {badge}
    </Link>
  );
}

/**
 * When the month's figures were computed, and a way to compute them again —
 * the §States row *snapshot stale*. `refresh` is the server action; the gallery
 * passes none and draws the line alone.
 */
export function SnapshotLine({ note, refresh }: { note: string; refresh?: () => Promise<void> }) {
  if (!refresh) return <span className="text-caption text-muted">{note}</span>;
  return (
    <form action={refresh} className="flex items-center gap-2">
      <span className="text-caption text-muted">{note}</span>
      <button type="submit" className={buttonClassName({ variant: "ghost", size: "sm" })}>
        {t("overview.refresh")}
      </button>
    </form>
  );
}
