import { t } from "@/lib/i18n";
import { stopViewAs } from "./view-as-actions";

/**
 * Board 12f — the strip above every seller screen under view-as.
 *
 * Loud, on every page, and now with the control that ends it. It said what was
 * happening and offered no way out: a staff member had to navigate back to
 * `/admin/support` to stop looking at an account they were sitting inside.
 *
 * A plain form and a server action, so it works before any JavaScript does —
 * the one control on a read-only surface should be the most reliable thing on
 * the page. The minutes are computed at render and do not tick, which the cap
 * makes safe: the session is over at thirty minutes whether or not this tab is.
 */
export function ViewAsStrip({
  business,
  ticket,
  minutes,
}: {
  business: string;
  ticket: string;
  minutes: number;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-warn-line bg-warn-surface px-[var(--section-pad)] py-2">
      <p className="text-caption text-warn-ink">
        {t("dashboard.viewing_as", { business, ticket, minutes: String(minutes) })}
      </p>
      <form action={stopViewAs}>
        <button
          type="submit"
          className="rounded-tag text-caption font-medium text-warn-ink underline underline-offset-2 focus-visible:outline-none focus-visible:shadow-focus"
        >
          {t("dashboard.viewing_as_stop")}
        </button>
      </form>
    </div>
  );
}
