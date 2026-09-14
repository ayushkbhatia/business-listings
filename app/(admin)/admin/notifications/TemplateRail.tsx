import Link from "next/link";
import { buttonClassName } from "@/components/primitives";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { TemplateDetail } from "@/lib/notify/templates";
import type { DetailView, Panel } from "./present";
import { MetaDecisionForm, PublishDraftButton, TemplateEditor } from "./RailControls";

/**
 * Board 12g — the rail: one template, its editor, and the three panels the
 * render stacks beneath it.
 *
 * Layout only. Every sentence arrives from `presentDetail`, and every control
 * that writes lives in `RailControls.tsx`.
 */

const PANEL: Record<Panel["tone"], { box: string; eyebrow: string; body: string }> = {
  warn: { box: "border-warn-line bg-warn-surface", eyebrow: "text-warn-ink", body: "text-warn-ink" },
  bad: { box: "border-bad-line bg-bad-surface", eyebrow: "text-bad-ink", body: "text-bad-ink" },
  neutral: { box: "border-line bg-card", eyebrow: "text-faint", body: "text-body" },
};

function RailPanel({ panel, children }: { panel: Panel; children?: React.ReactNode }) {
  const tone = PANEL[panel.tone];
  return (
    <div className={cn("rounded-panel border p-4", tone.box)}>
      <p className={cn("font-mono text-eyebrow uppercase", tone.eyebrow)}>{panel.eyebrow}</p>
      {panel.body.map((line, index) => (
        <p key={index} className={cn("mt-2 whitespace-pre-line text-body-sm", tone.body)}>
          {line}
        </p>
      ))}
      {children}
    </div>
  );
}

export function TemplateRail({
  view,
  seed,
  origin,
  canWrite,
  landmark = true,
}: {
  view: DetailView;
  seed: TemplateDetail["seed"];
  origin: string;
  canWrite: boolean;
  /** Off in the gallery, for the reason `TemplateList` gives. */
  landmark?: boolean;
}) {
  const Rail = landmark ? "aside" : "div";
  const Lines = landmark ? "nav" : "div";
  const titleId = landmark ? "notification-rail-title" : undefined;
  return (
    <Rail id={landmark ? "template" : undefined} aria-labelledby={titleId} className="flex min-w-0 scroll-mt-6 flex-col gap-[var(--gutter)]">
      <div className="rounded-panel border border-line bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 id={titleId} className="flex items-center gap-2">
            <span className="sr-only">{view.heading}</span>
            <span aria-hidden className="font-mono text-body-sm text-ink">
              {view.event}
            </span>
            <span aria-hidden className="rounded-sm bg-moss-wash px-2 py-0.5 text-caption text-moss-deep">
              {view.channelLabel}
            </span>
          </h2>
          <p className="font-mono text-eyebrow uppercase text-muted">{view.versionsMeta}</p>
        </div>

        {view.lineTabs ? (
          <Lines aria-label={landmark ? t("notifications.line.label") : undefined} className="flex gap-1 border-b border-line px-4 py-2">
            {view.lineTabs.map((tab) => (
              <Link
                key={tab.line}
                href={tab.href}
                scroll={false}
                aria-current={tab.selected ? "page" : undefined}
                className={cn(
                  "rounded-pill px-3 py-1 text-caption focus-visible:outline-none focus-visible:shadow-focus",
                  tab.selected ? "bg-ink-surface text-on-ink" : "text-body hover:bg-fill",
                )}
              >
                {tab.label}
              </Link>
            ))}
          </Lines>
        ) : null}

        {view.dormant ? <p className="border-b border-line bg-fill px-4 py-2 text-caption text-body">{view.dormant}</p> : null}

        <TemplateEditor view={view} seed={seed} origin={origin} canWrite={canWrite} />
      </div>

      {view.meta ? (
        <RailPanel panel={view.meta}>
          {canWrite && view.pendingId ? <MetaDecisionForm templateId={view.pendingId} /> : null}
        </RailPanel>
      ) : null}

      {view.twinPanel ? (
        <RailPanel panel={view.twinPanel}>
          {view.twinPanel.href && view.twinPanel.action ? (
            <Link
              href={view.twinPanel.href}
              scroll={false}
              className={cn("mt-3", buttonClassName({ variant: view.twinPanel.tone === "bad" ? "danger" : "secondary", size: "md" }))}
            >
              {view.twinPanel.action}
            </Link>
          ) : null}
        </RailPanel>
      ) : null}

      <RailPanel panel={view.optOut} />

      <div className="rounded-panel border border-line bg-card">
        <h3 className="border-b border-line px-4 py-3 font-mono text-eyebrow font-normal uppercase text-faint">
          {t("notifications.history.title")}
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-caption">
            <caption className="sr-only">{t("notifications.history.caption", { event: view.event, channel: view.channelLabel })}</caption>
            <thead>
              <tr className="text-left text-faint">
                <th scope="col" className="px-4 py-2 font-normal">{t("notifications.history.col.version")}</th>
                <th scope="col" className="px-2 py-2 font-normal">{t("notifications.history.col.body")}</th>
                <th scope="col" className="px-2 py-2 font-normal">{t("notifications.history.col.status")}</th>
                <th scope="col" className="px-4 py-2 font-normal">{t("notifications.history.col.by")}</th>
              </tr>
            </thead>
            <tbody>
              {view.history.map((row) => (
                <tr key={row.id} className="border-t border-line align-top">
                  <th scope="row" className="px-4 py-2 text-left font-mono font-normal text-ink">
                    {row.version}
                  </th>
                  <td className="px-2 py-2 text-body">{row.line}</td>
                  <td className="px-2 py-2">
                    <span className={cn(row.statusTone === "ok" ? "text-ok-ink" : row.statusTone === "warn" ? "text-warn-ink" : row.statusTone === "bad" ? "text-bad-ink" : "text-body")}>
                      {row.status}
                    </span>
                    {row.note ? <span className="mt-0.5 block text-bad-ink">{row.note}</span> : null}
                    {row.canPublish && canWrite ? <PublishDraftButton templateId={row.id} version={row.version} /> : null}
                  </td>
                  <td className="px-4 py-2 text-body">
                    {row.by}
                    <span className="block text-muted">{row.when}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Rail>
  );
}
