import Link from "next/link";
import { buttonClassName } from "@/components/primitives";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { CoverageView, Tone } from "./present";

/**
 * Board 12g — the coverage grid. Task T7.1, prompt P-08.
 *
 * Events down, channels across, one cell per pair — including the pairs that
 * have no template at all, which the list below cannot show because it is
 * built from rows. A missing default route is the one gap that silences a
 * notification, so it is drawn as the page's primary action.
 *
 * A real table: the cell's meaning is its row and its column, read aloud
 * together. Grouped by who receives the event, with `<th scope="rowgroup">`, so
 * the buyer-side half of the surface — which had no view at all — is on the
 * same screen as the seller half.
 *
 * Layout only; every sentence is from `presentCoverage`.
 */

const TEXT: Record<Tone, string> = {
  ok: "text-ok-ink",
  warn: "text-warn-ink",
  bad: "text-bad-ink",
  neutral: "text-muted",
};

export function CoverageGrid({ view, landmark = true }: { view: CoverageView; landmark?: boolean }) {
  const Section = landmark ? "section" : "div";
  const titleId = landmark ? "coverage-title" : undefined;
  const span = 2 + view.channels.length;
  return (
    <Section aria-labelledby={titleId} className="mb-[var(--gutter)] rounded-panel border border-line bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
        <h2 id={titleId} className="text-body font-medium text-ink">
          {t("notifications.coverage.title")}
        </h2>
        <p className={cn("text-caption", TEXT[view.metaTone])}>{view.meta}</p>
      </div>
      <div tabIndex={0} aria-label={t("notifications.coverage.caption")} className="overflow-x-auto focus-visible:outline-none focus-visible:shadow-focus">
        <table className="w-full min-w-[46rem] border-collapse text-left text-caption">
          <caption className="sr-only">{t("notifications.coverage.caption")}</caption>
          <thead>
            <tr className="bg-paper-sunk font-mono text-colhead uppercase text-muted">
              <th scope="col" className="sticky left-0 z-[1] bg-paper-sunk px-4 py-2 font-normal">
                {t("notifications.coverage.col.event")}
              </th>
              <th scope="col" className="px-2 py-2 font-normal">
                {t("notifications.coverage.col.default")}
              </th>
              {view.channels.map((channel) => (
                <th key={channel.channel} scope="col" className="w-36 px-2 py-2 font-normal">
                  {channel.label}
                </th>
              ))}
            </tr>
          </thead>
          {view.groups.map((group) => (
            <tbody key={group.audience}>
              <tr className="border-t border-line bg-fill">
                <th scope="rowgroup" colSpan={span} className="px-4 py-2 text-left font-mono text-eyebrow font-normal uppercase text-muted">
                  <span className="sticky left-4 inline-block">{group.label}</span>
                </th>
              </tr>
              {group.rows.map((row) => (
                <tr key={row.event} className="border-t border-line align-top">
                  <th scope="row" className="sticky left-0 z-[1] bg-card px-4 py-2 text-left font-normal">
                    <span className="block text-body-sm text-ink">{row.label}</span>
                    <span className="block font-mono text-muted">{row.event}</span>
                  </th>
                  <td className="px-2 py-2 text-body">{row.defaultRoute}</td>
                  {row.dormant ? (
                    <td colSpan={view.channels.length} className="px-2 py-2 text-muted">
                      {t("notifications.coverage.dormant")}
                    </td>
                  ) : (
                    row.cells.map((cell) => (
                      <td key={cell.key} className={cn("px-2 py-2", cell.selected && "bg-moss-wash")}>
                        <span className={cn("block", TEXT[cell.tone])}>{cell.label}</span>
                        {cell.action && cell.actionLabel ? (
                          <Link
                            href={cell.href}
                            scroll={false}
                            aria-label={cell.actionLabel}
                            aria-current={cell.selected ? "true" : undefined}
                            className={
                              cell.primary
                                ? cn("mt-1", buttonClassName({ variant: "primary", size: "sm" }))
                                : "mt-0.5 block text-moss underline underline-offset-2 hover:text-moss-hover focus-visible:outline-none focus-visible:shadow-focus"
                            }
                          >
                            {cell.action}
                          </Link>
                        ) : null}
                      </td>
                    ))
                  )}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      <p className="border-t border-line px-4 py-3 text-caption text-muted">{view.footnote}</p>
    </Section>
  );
}
