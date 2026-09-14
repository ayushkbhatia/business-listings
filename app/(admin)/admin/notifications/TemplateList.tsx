import Link from "next/link";
import { ChipLink } from "@/components/display";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { BoardView, Filters, Tone } from "./present";
import { SortSelect } from "./SortSelect";

/**
 * Board 12g — the list. The screen, per the spec: *"the last two columns are
 * why."*
 *
 * A real `<table>` (non-negotiable 4). Each row's key is the link that opens
 * the template beside it, so the row is reachable by keyboard and the URL says
 * which template is open.
 */

const INK: Record<Tone, string> = {
  ok: "text-ok-ink",
  warn: "text-warn-ink",
  bad: "text-bad-ink",
  neutral: "text-muted",
};

const DOT: Record<Tone, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  bad: "bg-bad",
  neutral: "bg-line-strong",
};

/**
 * `landmark` is off in the gallery, which renders several of these on one page:
 * a named region and a named nav per specimen would be landmarks the page holds
 * twice, and axe fails the gallery on the second.
 */
export function TemplateList({ view, filters, landmark = true }: { view: BoardView; filters: Filters; landmark?: boolean }) {
  const Region = landmark ? "section" : "div";
  const Chips = landmark ? "nav" : "div";
  return (
    <Region aria-labelledby={landmark ? "notifications-list-title" : undefined} className="min-w-0">
      {landmark ? (
        <h2 id="notifications-list-title" className="sr-only">
          {t("notifications.list.title")}
        </h2>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Chips aria-label={landmark ? t("notifications.filter.label") : undefined} className="flex flex-wrap gap-2">
          {view.chips.map((chip) => (
            <ChipLink key={chip.key} href={chip.href} selected={chip.selected} count={chip.count}>
              {chip.label}
            </ChipLink>
          ))}
        </Chips>
        <SortSelect options={view.sortOptions} filters={filters} />
      </div>

      <div className="overflow-x-auto rounded-panel border border-line bg-card">
        <table className="w-full min-w-[42rem] border-collapse text-body-sm">
          <caption className="sr-only">{t("notifications.caption")}</caption>
          <thead className="bg-fill">
            <tr>
              <th scope="col" className="px-4 py-2.5 text-left font-mono text-eyebrow font-normal uppercase text-faint">
                {t("notifications.col.key")}
              </th>
              <th scope="col" className="px-3 py-2.5 text-left font-mono text-eyebrow font-normal uppercase text-faint">
                {t("notifications.col.channel")}
              </th>
              <th scope="col" className="px-3 py-2.5 text-left font-mono text-eyebrow font-normal uppercase text-faint">
                {t("notifications.col.fired_by")}
              </th>
              <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-eyebrow font-normal uppercase text-faint">
                {t("notifications.col.sent")}
              </th>
              <th scope="col" className="px-3 py-2.5 text-left font-mono text-eyebrow font-normal uppercase text-faint">
                {t("notifications.col.twin")}
              </th>
              <th scope="col" className="px-4 py-2.5 text-left font-mono text-eyebrow font-normal uppercase text-faint">
                {t("notifications.col.state")}
              </th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => (
              <tr
                key={row.key}
                aria-current={row.selected ? "true" : undefined}
                className={cn("border-t border-line", row.selected && "bg-moss-wash")}
              >
                <th scope="row" className="px-4 py-3 text-left font-normal">
                  <Link
                    href={row.href}
                    aria-label={row.openLabel}
                    className="font-mono text-body-sm text-ink underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:shadow-focus"
                  >
                    {row.event}
                  </Link>
                </th>
                <td className="px-3 py-3 text-body">{row.channel}</td>
                <td className={cn("px-3 py-3 font-mono text-caption", row.firedByTone === "neutral" ? "text-body" : INK[row.firedByTone])}>
                  {row.firedBy}
                </td>
                <td className="px-3 py-3 text-right">
                  <span className="block tabular-nums text-ink">{row.sent}</span>
                  {row.notSent ? <span className="block text-caption tabular-nums text-muted">{row.notSent}</span> : null}
                </td>
                <td className="px-3 py-3">
                  {row.twinChip ? (
                    <span className="inline-flex rounded-sm border border-bad-line bg-bad-surface px-2 py-0.5 text-caption text-bad-ink">
                      {row.twin}
                    </span>
                  ) : (
                    <span className={cn("text-caption", INK[row.twinTone])}>{row.twin}</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={cn("inline-flex items-center gap-1.5 text-caption", row.stateTone === "neutral" ? "text-body" : INK[row.stateTone])}>
                    <span aria-hidden className={cn("size-1.5 rounded-full", DOT[row.stateTone])} />
                    {row.state}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {view.empty ? (
          <div className="px-4 py-8 text-center">
            <p className="text-body-sm text-body">{view.empty.title}</p>
            <p className="mx-auto mt-1 max-w-prose text-caption text-muted">{view.empty.body}</p>
          </div>
        ) : null}

        <p className="border-t border-line px-4 py-3 text-caption text-muted">{view.footnote}</p>
      </div>
    </Region>
  );
}
