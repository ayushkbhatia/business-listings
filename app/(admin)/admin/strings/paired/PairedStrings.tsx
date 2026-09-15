import { ChipLink, ProgressBar } from "@/components/display";
import { t } from "@/lib/i18n";
import { PairedTable } from "./PairedTable";
import type { PairedView } from "./present";

/**
 * Board `12g-s` — the paired view, composed from its presenter.
 *
 * The route and the gallery render this one component. `landmark` is off in the
 * gallery, which renders several specimens on one page: a named region or nav
 * per specimen would be landmarks the page holds more than once.
 */
export function PairedStrings({ view, canWrite, landmark = true }: { view: PairedView; canWrite: boolean; landmark?: boolean }) {
  const Region = landmark ? "section" : "div";
  const Aside = landmark ? "aside" : "div";
  const Filters = landmark ? "nav" : "div";

  return (
    <div className="@container">
      <div className="grid items-start gap-[var(--gutter)] @5xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="flex min-w-0 flex-col gap-3">
          <p className="max-w-[var(--measure-prose)] text-body text-body">{view.intro}</p>

          <Filters aria-label={landmark ? t("strings.paired.filter") : undefined} className="flex flex-wrap gap-2">
            {view.filters.map((filter) => (
              <ChipLink key={filter.key} size="sm" href={filter.href} selected={filter.selected}>
                {filter.label}
              </ChipLink>
            ))}
          </Filters>

          <Region
            aria-label={landmark ? t("strings.paired.caption") : undefined}
            className="overflow-hidden rounded-panel border border-line bg-card"
          >
            <PairedTable rows={view.rows} caption={t("strings.paired.caption")} empty={view.empty} canWrite={canWrite} />
            <p className="border-t border-warn-line bg-warn-surface px-4 py-3 text-body-sm text-warn-ink sm:px-5">{view.suppressedNote}</p>
          </Region>
        </div>

        <Aside aria-label={landmark ? t("strings.paired.progress.title") : undefined} className="flex min-w-0 flex-col gap-[var(--gutter)]">
          <div className="rounded-panel border border-line bg-card p-4 sm:p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-h3 text-ink">{t("strings.paired.progress.title")}</h2>
              <span className="font-mono text-h3 tabular-nums text-ink">{view.progress.figure}</span>
            </div>
            <div className="mt-3">
              <ProgressBar
                value={view.progress.value}
                max={view.progress.max}
                label={view.progress.label}
                tone={view.progress.complete ? "ok" : "moss"}
                size="lg"
              />
            </div>
            {view.progress.lines.map((line) => (
              <p key={line} className="mt-3 text-body-sm text-body">
                {line}
              </p>
            ))}
          </div>

          <div className="rounded-panel border border-warn-line bg-warn-surface p-4 sm:p-5">
            <h2 className="font-mono text-eyebrow uppercase text-warn-ink">{view.d9.title}</h2>
            <p className="mt-2 text-body-sm text-warn-ink">{view.d9.body}</p>
          </div>
        </Aside>
      </div>
    </div>
  );
}
