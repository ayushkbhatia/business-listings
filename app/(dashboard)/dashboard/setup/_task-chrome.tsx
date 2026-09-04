import "server-only";
import Link from "next/link";
import { buttonClassName } from "@/components/primitives";
import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { SetupTaskId } from "@/lib/setup/tasks";

/**
 * The frame every setup task wears. Boards 8b to 8e.
 *
 * ## No sidebar, deliberately
 *
 * The dashboard nav is absent so the task is the only thing on screen. A seller
 * who came here from the hub to do one job should not be one click from the
 * catalogue, the leads inbox and the billing screen — board 8b says the shell is
 * full-width and sidebar-less, and that is the whole reason it is not a
 * `SellerPage`.
 *
 * It stays inside the `(dashboard)` route group because everything else about
 * it is a dashboard surface: the seat, the density, the guards. Only the chrome
 * differs.
 *
 * ## The rail shows completion, not position
 *
 * This is the correction the 8b render carries, and it is load-bearing rather
 * than cosmetic. The first draft read `Task 1 of 4` over a four-segment rail
 * with the first segment solid, which is a wizard index — and board 8a's whole
 * premise is that the four tasks are independent, free-order, and abandoned at
 * different rates. A rail that counts steps re-imposes the sequence the hub
 * exists to remove.
 *
 * So each segment is one task's own progress: the task in hand fills pro-rata
 * as work lands (three of five photographs is sixty per cent), and the other
 * three fill only when their done-condition is met. The label says what is
 * still open rather than which number this is.
 */

export interface TaskSegment {
  id: SetupTaskId;
  /** Nought to one. Pro-rata for the task in hand, 0 or 1 for the others. */
  filled: number;
}

export interface TaskChromeProps {
  /** The task's own name, in the bar and in the open-count line. */
  name: string;
  segments: readonly TaskSegment[];
  /** How many of the four are still open, counting this one. */
  openCount: number;
  /**
   * The primary control. It returns to the hub — it does not continue.
   *
   * Every task exits to the hub; there is no next step to continue to, and
   * "Save & continue" would promise one. The copy changes to "Done" once the
   * task's condition is met, which is the only thing about it that moves.
   */
  done: boolean;
  children: React.ReactNode;
}

const HUB = "/dashboard/setup";

export function TaskChrome({ name, segments, openCount, done, children }: TaskChromeProps) {
  return (
    <div data-density="comfortable" className="flex min-h-dvh flex-col bg-paper">
      <header className="flex flex-none flex-wrap items-center gap-4 border-b border-line bg-card px-6 py-3">
        <Link
          href={HUB}
          className="text-body-sm font-medium text-moss underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
        >
          {/*
            The arrow is decorative — "Setup" is the name of where it goes, and
            a screen reader announcing "left arrow Setup" reads a glyph as a
            word. §09.2: never a symbol carrying meaning on its own.
          */}
          <span aria-hidden="true">← </span>
          {t("task.back")}
        </Link>

        <span aria-hidden="true" className="h-5 w-px bg-line" />

        <h1 className="text-h3 font-medium text-ink">{name}</h1>

        {/*
          Decorative, and named by the sentence beside it. The rail is a picture
          of the count that follows it in words, so a reader gets the fact once.
        */}
        <span aria-hidden="true" className="ms-2 flex items-center gap-1.5">
          {segments.map((segment) => (
            <span
              key={segment.id}
              className="h-1.5 w-[22px] overflow-hidden rounded-pill bg-track"
            >
              <span
                className="block h-full rounded-pill bg-moss"
                style={{ width: `${Math.round(Math.min(1, Math.max(0, segment.filled)) * 100)}%` }}
              />
            </span>
          ))}
        </span>

        <p className="text-caption text-muted">
          {openCount === 0
            ? t("task.all_done", { name })
            : t("task.open_count", {
                count: openCount,
                name,
                formatted: formatCount(openCount),
                total: formatCount(segments.length),
              })}
        </p>

        <div className="ms-auto flex items-center gap-4">
          {/*
            No dialog, no penalty. Board 8b: skipping costs nothing, and a
            confirmation on a task that was optional to begin with is a screen
            asking a seller to justify themselves.
          */}
          <Link
            href={HUB}
            className="text-body-sm text-muted underline-offset-2 hover:text-ink hover:underline focus-visible:outline-none focus-visible:shadow-focus"
          >
            {t("task.skip")}
          </Link>
          <Link href={HUB} className={buttonClassName({ size: "md" })}>
            {done ? t("task.done") : t("task.save")}
          </Link>
        </div>
      </header>

      <main className={cn("flex-1 px-8 py-7")}>{children}</main>
    </div>
  );
}
