import Link from "next/link";
import { StatusBadge } from "@/components/display";
import { cn } from "@/lib/cn";
import { t, type MessageKey } from "@/lib/i18n";
import { AddBusiness } from "./AddBusiness";
import { ChipList } from "./ChipList";
import type { CurationView, NoticeView } from "./present";
import { SlotList } from "./SlotList";

/**
 * Board 6h — the screen, composed from its presenter.
 *
 * The route and the gallery render this one component, so the gallery is the
 * route with fixtures rather than a drawing of it. `landmark` is off in the
 * gallery, which renders more than one specimen on a page: a named region per
 * specimen would be landmarks the page holds twice (the defect `TemplateList`
 * describes).
 */

/** Backticked board codes in a catalogue string, set as code. */
function Codes({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/).map((part, index) =>
        part.startsWith("`") && part.endsWith("`") ? (
          <code key={index} className="mx-0.5 rounded-tag border border-line bg-paper-sunk px-1 font-mono text-caption text-ink">
            {part.slice(1, -1)}
          </code>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

const NOTICE: Record<NoticeView["tone"], { box: string; eyebrow: string; lead: string; body: string }> = {
  warn: { box: "border-warn-line bg-warn-surface", eyebrow: "text-warn-ink", lead: "text-warn-ink", body: "text-warn-ink" },
  neutral: { box: "border-line bg-card", eyebrow: "text-faint", lead: "text-ink", body: "text-body" },
};

function SidePanel({ eyebrow, children, className }: { eyebrow: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-panel border p-4 sm:p-5", className ?? "border-line bg-card")}>
      <h2 className="flex items-baseline justify-between gap-3 font-mono text-eyebrow uppercase">{eyebrow}</h2>
      {children}
    </div>
  );
}

export function HomeCuration({ view, landmark = true }: { view: CurationView; landmark?: boolean }) {
  const Region = landmark ? "section" : "div";
  const Aside = landmark ? "aside" : "div";
  const notice = NOTICE[view.notice.tone];

  return (
    /*
       A container query rather than the viewport's `board:` breakpoint: the
       rail sits beside the slots when the console has room for both, which in
       the admin shell is a 1440 viewport and in the gallery's narrow column is
       never — and a viewport breakpoint would split the gallery specimen into
       two cramped columns.
    */
    <div className="@container">
      <div className="grid items-start gap-[var(--gutter)] @5xl:grid-cols-[minmax(0,1fr)_minmax(0,23rem)]">
        <div className="flex min-w-0 flex-col gap-[var(--gutter)]">
          {/* ── Verified this week ─────────────────────────────────────── */}
          <Region aria-labelledby={landmark ? "curation-slots" : undefined} className="overflow-hidden rounded-panel border border-line bg-card">
            <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line px-4 py-3.5 sm:px-6">
              <h2 id={landmark ? "curation-slots" : undefined} className="text-h2 text-ink">
                {t("home.verified_title")}
              </h2>
              <p className="text-body-sm text-body">{t("curation.slots_description")}</p>
            </header>

            <SlotList slots={view.slots} order={view.order} canWrite={view.canWrite} />

            <footer className="flex flex-col gap-3 border-t border-line px-4 py-3.5 sm:px-6">
              {view.canWrite ? (
                <AddBusiness find={view.find} candidates={view.candidates} suggestions={view.suggestions} firstFree={view.firstFree} canWrite={view.canWrite} />
              ) : null}
              <p className="text-caption text-body">
                <Codes text={t("curation.eligibility")} />
              </p>
            </footer>
          </Region>

          {/* ── Every rail on the home page ─────────────────────────────── */}
          <Region aria-labelledby={landmark ? "curation-rails" : undefined} className="overflow-hidden rounded-panel border border-line bg-card">
            <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3.5 sm:px-6">
              <h2 id={landmark ? "curation-rails" : undefined} className="text-h2 text-ink">
                {t("curation.rails.title")}
              </h2>
              <p className="text-body-sm text-body">{t("curation.rails.description")}</p>
            </header>
            <div tabIndex={0} className="overflow-x-auto focus-visible:shadow-focus focus-visible:outline-none">
              <table className="w-full min-w-[40rem] border-collapse text-body-sm">
                <caption className="sr-only">{t("curation.rails.caption")}</caption>
                <thead className="bg-paper-sunk">
                  <tr>
                    {(["rail", "source", "control", "items"] as const).map((col) => (
                      <th
                        key={col}
                        scope="col"
                        className={cn(
                          "px-3 py-2.5 font-mono text-colhead font-medium uppercase text-muted first:ps-4 last:pe-4 sm:first:ps-6 sm:last:pe-6",
                          col === "items" ? "text-right" : "text-left",
                        )}
                      >
                        {t(`curation.rails.col.${col}` as MessageKey)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {view.rails.map((rail) => (
                    <tr key={rail.key} className="border-t border-line">
                      <th scope="row" className="py-3 ps-4 pe-3 text-left font-normal text-ink sm:ps-6">
                        {rail.name}
                      </th>
                      <td className={cn("px-3 py-3", rail.curated ? "text-warn-ink" : "text-body")}>{rail.source}</td>
                      <td className="px-3 py-3 text-body">
                        {rail.board ? (
                          <span className="inline-flex flex-wrap items-center gap-2">
                            {rail.boardHref ? (
                              <Link href={rail.boardHref} className="rounded-tag border border-line bg-paper-sunk px-1.5 font-mono text-caption text-ink underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none">
                                {rail.board}
                              </Link>
                            ) : (
                              <code className="rounded-tag border border-line bg-paper-sunk px-1.5 font-mono text-caption text-ink">{rail.board}</code>
                            )}
                            <span>{rail.boardNote}</span>
                          </span>
                        ) : (
                          <span className="text-body">{t("curation.rails.this_screen")}</span>
                        )}
                      </td>
                      <td className="py-3 ps-3 pe-4 text-right tabular-nums text-ink sm:pe-6">{rail.items}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-line px-4 py-3 text-caption text-body sm:px-6">
              <Codes text={t("curation.rails.footnote")} />
            </p>
          </Region>
        </div>

        <Aside aria-label={landmark ? t("curation.aside") : undefined} className="flex min-w-0 flex-col gap-[var(--gutter)]">
          <SidePanel
            eyebrow={
              <>
                <span className="text-faint">{t("curation.chips.title")}</span>
                <span className="tabular-nums text-faint">{view.chipCount}</span>
              </>
            }
          >
            <div className="mt-3">
              <ChipList chips={view.chips} full={view.chipFull} canWrite={view.canWrite} />
            </div>
            <p className="mt-3 text-body-sm text-body">{t("curation.chips.note")}</p>

            {view.searched.length > 0 ? (
              <details className="mt-3 border-t border-line pt-3">
                <summary className="cursor-pointer rounded-tag text-body-sm text-ink focus-visible:shadow-focus focus-visible:outline-none">
                  {t("curation.searched.title")}
                </summary>
                <table className="mt-2 w-full border-collapse text-caption">
                  <caption className="sr-only">{t("curation.searched.caption")}</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="py-1.5 text-left font-mono text-colhead font-medium uppercase text-muted">
                        {t("curation.searched.col.term")}
                      </th>
                      <th scope="col" className="py-1.5 text-right font-mono text-colhead font-medium uppercase text-muted">
                        {t("curation.searched.col.searches")}
                      </th>
                      <th scope="col" className="py-1.5 ps-2 text-left font-mono text-colhead font-medium uppercase text-muted">
                        {t("curation.searched.col.state")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.searched.map((term) => (
                      <tr key={term.query} className="border-t border-line">
                        <th scope="row" className="py-1.5 pe-2 text-left font-normal text-ink">
                          {term.query}
                        </th>
                        <td className="py-1.5 text-right tabular-nums text-body">{term.searches}</td>
                        <td className="py-1.5 ps-2">
                          <StatusBadge tone={term.tone} shape="chip" size="sm">
                            {term.state}
                          </StatusBadge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            ) : null}
          </SidePanel>

          <SidePanel eyebrow={<span className={notice.eyebrow}>{view.notice.eyebrow}</span>} className={notice.box}>
            <p className={cn("mt-2 text-body-sm", notice.body)}>
              <strong className={cn("font-medium", notice.lead)}>{view.notice.lead}</strong> <Codes text={view.notice.body} />
            </p>
          </SidePanel>

          <SidePanel eyebrow={<span className="text-faint">{t("curation.pay_title")}</span>}>
            <p className="mt-2 text-body-sm text-body">
              <Codes text={t("curation.pay_body")} />
            </p>
          </SidePanel>

          <SidePanel eyebrow={<span className="text-faint">{t("curation.cost_title")}</span>}>
            <p className="mt-2 text-body-sm text-body">
              <Codes text={view.cost} />
            </p>
          </SidePanel>
        </Aside>
      </div>
    </div>
  );
}
