import Link from "next/link";
import { StatusBadge, type StatusTone } from "@/components/display";
import { KeyValuePanel, Tabs } from "@/components/structure";
import { cn } from "@/lib/cn";
import { formatClock, formatCount, formatDateTime, formatElapsed, formatRelative } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import {
  JOB_RUN_KEEP_DAYS,
  type CronHealth,
  type HistoryRow,
  type MissedSpan,
  type Refusal,
  type RunDigest,
  type RunState,
  type RunTally,
  type StepRow,
  type StepState,
} from "@/lib/jobs/health";
import { isSummarised, type JsonValue } from "@/lib/jobs/outcome";
import type { CronSummary, RefusalLog, RunHistory, StepFailure } from "@/lib/jobs/report";
import { JOB_CRONS, JOB_SCHEDULES, SWEEP_JOB_MINUTE, slotTime, type JobCron } from "@/lib/jobs/schedule";

/**
 * Standing item 9.5 — the screen's parts, as pure renders of what
 * `lib/jobs/report.ts` read and `lib/jobs/health.ts` worked out.
 *
 * Nothing here queries and nothing here computes a state: every badge is chosen
 * from a state the pure layer named, so the gallery can draw each one from a
 * fixture and the page cannot disagree with it. No titled panels and no named
 * sections either — the page owns its landmarks, and the gallery renders these
 * several times over.
 *
 * A run that did not happen is a row of its own, in words. It is never a zero
 * in a count column, because a missing run did not do nothing — it did not
 * happen, and the difference is the whole reason the screen exists.
 */

const LONG_AGO_DAYS = JOB_RUN_KEEP_DAYS + 1;

export function cronName(cron: JobCron): string {
  return t(`admin.jobs.cron.${cron}` as MessageKey);
}

/** The cron as it reads mid-sentence: "the daily job", not "the Daily job". */
export function cronInSentence(cron: JobCron): string {
  return t(`admin.jobs.cron_lower.${cron}` as MessageKey);
}

function ago(at: Date, now: Date): string {
  // Counted in days past a week, rather than falling back to a date: "the
  // nightly has not run for 9 d 4 h" is the sentence this screen is for.
  return formatRelative(at, { now, absoluteAfterDays: LONG_AGO_DAYS });
}

function scheduleText(cron: JobCron): string {
  if (cron === "sweep") return t("admin.jobs.schedule.sweep", { minute: String(SWEEP_JOB_MINUTE).padStart(2, "0") });
  return t("admin.jobs.schedule.daily", { time: formatClock(slotTime(JOB_SCHEDULES.daily, 0)) });
}

const RUN_TONE: Record<RunState, StatusTone> = {
  ok: "ok",
  failed: "bad",
  running: "info",
  unfinished: "bad",
};

export function RunStateBadge({ state }: { state: RunState }) {
  return (
    <StatusBadge tone={RUN_TONE[state]} shape="chip" size="sm" dot>
      {t(`admin.jobs.run_state.${state}` as MessageKey)}
    </StatusBadge>
  );
}

function tallyText(state: RunState, tally: RunTally): string {
  const recorded = tally.ok + tally.failed;
  const params = {
    count: tally.planned,
    planned: formatCount(tally.planned),
    ok: formatCount(tally.ok),
    failed: formatCount(tally.failed),
    recorded: formatCount(recorded),
  };
  switch (state) {
    case "ok":
      return t("admin.jobs.outcome.ok", params);
    case "failed":
      return t("admin.jobs.outcome.failed", params);
    case "running":
      return t("admin.jobs.outcome.running", params);
    case "unfinished":
      return t("admin.jobs.outcome.unfinished", params);
  }
}

/** A finished run whose steps did not all leave a row says so, beside the tally. */
function unrecordedText(state: RunState, tally: RunTally): string | null {
  if ((state !== "ok" && state !== "failed") || tally.unrecorded === 0) return null;
  return t("admin.jobs.outcome.unrecorded", { count: tally.unrecorded, formatted: formatCount(tally.unrecorded) });
}

function took(run: Pick<RunDigest, "startedAt" | "finishedAt">, state: RunState): string {
  if (run.finishedAt) return formatElapsed(run.finishedAt.getTime() - run.startedAt.getTime());
  return t(state === "running" ? "admin.jobs.took.running" : "admin.jobs.took.none");
}

function missedText(span: MissedSpan): string {
  return t("admin.jobs.missed", {
    count: span.count,
    formatted: formatCount(span.count),
    first: formatDateTime(span.first),
  });
}

function refusalText(refusal: Refusal): string {
  return t("admin.jobs.refused_at", {
    date: formatDateTime(refusal.at),
    reason: t(`admin.jobs.refusal.${refusal.refusal}` as MessageKey),
  });
}

function runHref(id: string): string {
  return `/admin/jobs/${id}`;
}

export function cronHref(cron: JobCron): string {
  return `/admin/jobs?cron=${cron}`;
}

/**
 * The 2px meaning bar DataTable draws on a row's first cell, in the bad tone:
 * a cron that wants looking at, a run that did not happen. The bar is the
 * signal; the words beside it say what it means.
 */
const BAD_EDGE =
  "relative before:absolute before:inset-y-0 before:start-0 before:w-0.5 before:bg-bad before:content-['']";

const TABLE_FRAME =
  "overflow-x-auto rounded-panel border border-line bg-card focus-visible:shadow-focus focus-visible:outline-none";
const COLHEAD = "px-3 py-2.5 text-left font-mono text-colhead font-medium uppercase text-muted first:pl-4";
/**
 * Underlined at rest, not only on hover: a cron's name, a run's time and a
 * step's last failure sit in cells beside other text, and a link told apart by
 * colour alone is one nobody without that colour can find (`link-in-text-block`).
 */
const LINK = "rounded-tag underline underline-offset-2 focus-visible:shadow-focus focus-visible:outline-none";

/**
 * The frame every table here sits in. Focusable and named, because a table
 * wider than a phone scrolls inside it and a scroll region nobody can reach by
 * keyboard hides its columns. A group, not a region: a region is a landmark,
 * and the gallery draws this more than once.
 */
function TableFrame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div tabIndex={0} role="group" aria-label={label} className={TABLE_FRAME}>
      {children}
    </div>
  );
}

// ── The crons ───────────────────────────────────────────────────────────────

function Timeliness({ health, refusal }: { health: CronHealth; refusal: Refusal | null }) {
  let badge: { tone: StatusTone; key: MessageKey };
  let line: string | null = null;

  switch (health.state) {
    case "no_record":
      badge = { tone: "neutral", key: "admin.jobs.timeliness.no_record" };
      line = t("admin.jobs.no_record_note");
      break;
    case "never":
      badge = health.missed
        ? { tone: "bad", key: "admin.jobs.timeliness.never" }
        : { tone: "neutral", key: "admin.jobs.timeliness.waiting" };
      line = health.missed
        ? missedText(health.missed)
        : t("admin.jobs.never_since", { date: formatDateTime(health.since) });
      break;
    case "ran":
      badge = health.missed
        ? { tone: "bad", key: "admin.jobs.timeliness.late" }
        : { tone: "ok", key: "admin.jobs.timeliness.on_schedule" };
      line = health.missed ? missedText(health.missed) : null;
      break;
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <StatusBadge tone={badge.tone} shape="chip" size="sm" dot>
        {t(badge.key)}
      </StatusBadge>
      {line ? <span className={cn("text-caption", badge.tone === "bad" ? "text-bad-ink" : "text-body")}>{line}</span> : null}
      {refusal ? <span className="text-caption text-bad-ink">{refusalText(refusal)}</span> : null}
    </div>
  );
}

function LastOutcome({ health }: { health: CronHealth }) {
  if (health.state !== "ran") return <span className="text-body">{t("admin.jobs.last.none")}</span>;
  const unrecorded = unrecordedText(health.lastState, health.tally);
  return (
    <div className="flex flex-col items-start gap-1">
      <RunStateBadge state={health.lastState} />
      <span className="text-caption text-body">{tallyText(health.lastState, health.tally)}</span>
      {unrecorded ? <span className="text-caption text-warn-ink">{unrecorded}</span> : null}
      {/* Only a finished run took a length of time; the badge already says the rest. */}
      {health.last.finishedAt ? (
        <span className="text-caption text-muted">{t("admin.jobs.outcome.took", { duration: took(health.last, health.lastState) })}</span>
      ) : null}
    </div>
  );
}

/**
 * One row per cron: when it last ran and how long ago, what that run did, when
 * the next is due, and whether one is missing. The first question the screen
 * answers is in the last column, and it is never inferred from the others.
 */
export function CronTable({ crons, now }: { crons: readonly CronSummary[]; now: Date }) {
  return (
    <TableFrame label={t("admin.jobs.crons.caption")}>
      <table className="w-full min-w-[60rem] border-collapse text-body-sm">
        <caption className="sr-only">{t("admin.jobs.crons.caption")}</caption>
        <thead className="bg-paper-sunk">
          <tr>
            {(["cron", "schedule", "last", "outcome", "next", "state"] as const).map((col) => (
              <th key={col} scope="col" className={COLHEAD}>
                {t(`admin.jobs.crons.col.${col}` as MessageKey)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {crons.map(({ schedule, health, next, refusal, attention }) => (
            <tr key={schedule.cron} className="border-t border-line align-top">
              <th scope="row" className={cn("py-3 pl-4 pr-3 text-left font-normal", attention && BAD_EDGE)}>
                <Link href={`${cronHref(schedule.cron)}#runs`} className={cn(LINK, "text-ink")}>
                  {cronName(schedule.cron)}
                </Link>
                <span className="mt-0.5 block font-mono text-caption text-muted">{schedule.path}</span>
              </th>
              <td className="px-3 py-3 text-body">
                <span className="block">{scheduleText(schedule.cron)}</span>
                <span className="mt-0.5 block font-mono text-caption text-muted">
                  {t("admin.jobs.expression", { expression: schedule.expression })}
                </span>
              </td>
              <td className="px-3 py-3 text-body">
                {health.state === "ran" ? (
                  <>
                    <Link href={runHref(health.last.id)} className={cn(LINK, "block tabular-nums text-ink")}>
                      {formatDateTime(health.last.startedAt)}
                    </Link>
                    <span className="mt-0.5 block text-caption text-muted">{ago(health.last.startedAt, now)}</span>
                  </>
                ) : (
                  <span>{t("admin.jobs.last.none")}</span>
                )}
              </td>
              <td className="px-3 py-3">
                <LastOutcome health={health} />
              </td>
              <td className="px-3 py-3 text-body">
                <span className="block tabular-nums">{formatDateTime(next)}</span>
                <span className="mt-0.5 block text-caption text-muted">{formatRelative(next, { now })}</span>
              </td>
              <td className="px-3 py-3">
                <Timeliness health={health} refusal={refusal} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableFrame>
  );
}

/** Which cron the history, failures and refusals below are about. Routes, so a colleague can be sent one. */
export function CronTabs({ active }: { active: JobCron }) {
  return (
    <Tabs
      as="a"
      label={t("admin.jobs.tabs")}
      active={active}
      items={JOB_CRONS.map((cron) => ({ key: cron, label: cronName(cron), href: `${cronHref(cron)}#runs` }))}
    />
  );
}

// ── A cron's runs ───────────────────────────────────────────────────────────

function StepNames({ names }: { names: readonly string[] }) {
  return (
    <span className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-caption">
      <span className="text-bad-ink">{t("admin.jobs.history.threw")}</span>
      {names.map((name) => (
        <span key={name} className="font-mono text-bad-ink">
          {name}
        </span>
      ))}
    </span>
  );
}

function RunRow({ row }: { row: Extract<HistoryRow, { kind: "run" }> }) {
  const { run, state, tally, failed } = row;
  const unrecorded = unrecordedText(state, tally);
  return (
    <tr className="border-t border-line align-top">
      <th scope="row" className="whitespace-nowrap py-2.5 pl-4 pr-3 text-left font-normal">
        <Link href={runHref(run.id)} className={cn(LINK, "tabular-nums text-ink")}>
          {formatDateTime(run.startedAt)}
        </Link>
      </th>
      <td className="px-3 py-2.5 text-body">
        {run.schedule ? (
          <>
            <span className="block">{t("admin.jobs.called_by.scheduler")}</span>
            <span className="block font-mono text-caption text-muted">{run.schedule}</span>
          </>
        ) : (
          t("admin.jobs.called_by.hand")
        )}
      </td>
      <td className="px-3 py-2.5 tabular-nums text-body">{took(run, state)}</td>
      <td className="px-3 py-2.5 text-body">
        <span className="block">{tallyText(state, tally)}</span>
        {unrecorded ? <span className="block text-caption text-warn-ink">{unrecorded}</span> : null}
        {failed.length > 0 ? <StepNames names={failed} /> : null}
      </td>
      <td className="px-3 py-2.5">
        <RunStateBadge state={state} />
      </td>
    </tr>
  );
}

function MissedRow({ span }: { span: MissedSpan }) {
  return (
    <tr className="border-t border-line bg-bad-surface align-top">
      <th scope="row" className={cn("whitespace-nowrap py-2.5 pl-4 pr-3 text-left font-normal tabular-nums text-bad-ink", BAD_EDGE)}>
        {formatDateTime(span.last)}
      </th>
      <td colSpan={3} className="px-3 py-2.5 text-bad-ink">
        {t("admin.jobs.history.missed", {
          count: span.count,
          formatted: formatCount(span.count),
          first: formatDateTime(span.first),
          last: formatDateTime(span.last),
        })}
      </td>
      <td className="px-3 py-2.5">
        <StatusBadge tone="bad" shape="chip" size="sm" dot>
          {t("admin.jobs.history.missing")}
        </StatusBadge>
      </td>
    </tr>
  );
}

/**
 * A cron's runs, newest first, with every gap in the schedule drawn as a row.
 * `olderHref` and `newestHref` are the keyset links; either is absent when
 * there is nowhere to go.
 */
export function RunHistoryTable({
  cron,
  history,
  next,
  olderHref,
  newestHref,
}: {
  cron: JobCron;
  history: Pick<RunHistory, "rows" | "total" | "shown">;
  next: Date;
  olderHref: string | null;
  newestHref: string | null;
}) {
  const caption = t("admin.jobs.history.caption", { cron: cronInSentence(cron) });
  return (
    <TableFrame label={caption}>
      <table className="w-full min-w-[52rem] border-collapse text-body-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-paper-sunk">
          <tr>
            {(["started", "called_by", "took", "steps", "state"] as const).map((col) => (
              <th key={col} scope="col" className={COLHEAD}>
                {t(`admin.jobs.history.col.${col}` as MessageKey)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {history.rows.map((row) =>
            row.kind === "run" ? (
              <RunRow key={row.run.id} row={row} />
            ) : (
              <MissedRow key={`missed-${row.span.first.toISOString()}`} span={row.span} />
            ),
          )}
        </tbody>
      </table>

      {history.rows.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <p className="text-body-sm text-body">{t("admin.jobs.history.empty.title", { cron: cronInSentence(cron) })}</p>
          <p className="mx-auto mt-1 max-w-prose text-caption text-body">
            {t("admin.jobs.history.empty.body", { next: formatDateTime(next) })}
          </p>
        </div>
      ) : null}

      {/* No count line over no runs: "0 of 0" says nothing the rows above do not. */}
      {history.total > 0 || newestHref || olderHref ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
          <p className="text-caption text-muted">
            {t("admin.jobs.history.showing", {
              count: history.total,
              shown: formatCount(history.shown),
              formatted: formatCount(history.total),
            })}
          </p>
          <div className="flex gap-2">
            {newestHref ? (
              <Link href={newestHref} className={cn(LINK, "text-caption text-ink")}>
                {t("admin.jobs.history.newest")}
              </Link>
            ) : null}
            {olderHref ? (
              <Link href={olderHref} className={cn(LINK, "text-caption text-ink")}>
                {t("admin.jobs.history.older")}
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </TableFrame>
  );
}

// ── What keeps failing ──────────────────────────────────────────────────────

export function StepFailureTable({ cron, failures }: { cron: JobCron; failures: readonly StepFailure[] }) {
  const caption = t("admin.jobs.failures.caption", { cron: cronInSentence(cron), days: formatCount(JOB_RUN_KEEP_DAYS) });
  if (failures.length === 0) {
    return (
      <p className="rounded-panel border border-line bg-card px-4 py-4 text-body-sm text-body">
        {t("admin.jobs.failures.empty", { cron: cronInSentence(cron), days: formatCount(JOB_RUN_KEEP_DAYS) })}
      </p>
    );
  }
  return (
    <TableFrame label={caption}>
      <table className="w-full min-w-[48rem] border-collapse text-body-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-paper-sunk">
          <tr>
            {(["step", "count", "last", "error"] as const).map((col) => (
              <th key={col} scope="col" className={cn(COLHEAD, col === "count" && "text-right")}>
                {t(`admin.jobs.failures.col.${col}` as MessageKey)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {failures.map((failure) => (
            <tr key={failure.name} className="border-t border-line align-top">
              <th scope="row" className="py-2.5 pl-4 pr-3 text-left font-mono text-caption font-normal text-ink">
                {failure.name}
              </th>
              <td className="px-3 py-2.5 text-right tabular-nums text-bad-ink">{formatCount(failure.failures)}</td>
              <td className="whitespace-nowrap px-3 py-2.5">
                <Link href={runHref(failure.lastRunId)} className={cn(LINK, "tabular-nums text-ink")}>
                  {formatDateTime(failure.lastAt)}
                </Link>
              </td>
              <td className="px-3 py-2.5 font-mono text-caption text-body">
                <span className="line-clamp-3 break-words">{failure.lastError}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableFrame>
  );
}

// ── Refused calls ───────────────────────────────────────────────────────────

export function RefusalTable({ cron, refusals }: { cron: JobCron; refusals: RefusalLog }) {
  const days = formatCount(JOB_RUN_KEEP_DAYS);
  const caption = t("admin.jobs.refusals.caption", { cron: cronInSentence(cron) });
  if (refusals.rows.length === 0) {
    return (
      <p className="rounded-panel border border-line bg-card px-4 py-4 text-body-sm text-body">
        {t("admin.jobs.refusals.empty", { cron: cronInSentence(cron), days })}
      </p>
    );
  }
  return (
    <TableFrame label={caption}>
      <table className="w-full min-w-[40rem] border-collapse text-body-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-paper-sunk">
          <tr>
            {(["when", "why"] as const).map((col) => (
              <th key={col} scope="col" className={COLHEAD}>
                {t(`admin.jobs.refusals.col.${col}` as MessageKey)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {refusals.rows.map((refusal) => (
            <tr key={refusal.at.toISOString()} className="border-t border-line align-top">
              <th scope="row" className="whitespace-nowrap py-2.5 pl-4 pr-3 text-left font-normal tabular-nums text-body">
                {formatDateTime(refusal.at)}
              </th>
              <td className="px-3 py-2.5 text-bad-ink">{t(`admin.jobs.refusal.${refusal.refusal}` as MessageKey)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-line px-4 py-3 text-caption text-muted">
        {t("admin.jobs.refusals.showing", {
          count: refusals.total,
          shown: formatCount(refusals.rows.length),
          formatted: formatCount(refusals.total),
        })}
      </p>
    </TableFrame>
  );
}

// ── One run ─────────────────────────────────────────────────────────────────

/** The run's own facts, above its steps. */
export function RunFacts({ run, state, tally }: { run: RunDigest; state: RunState; tally: RunTally }) {
  const unrecorded = unrecordedText(state, tally);
  return (
    <KeyValuePanel
      notProvidedLabel={t("admin.jobs.run.not_recorded")}
      entries={[
        { key: "outcome", label: t("admin.jobs.run.outcome"), value: <RunStateBadge state={state} /> },
        {
          key: "steps",
          label: t("admin.jobs.run.steps"),
          value: unrecorded ? `${tallyText(state, tally)} · ${unrecorded}` : tallyText(state, tally),
        },
        { key: "started", label: t("admin.jobs.run.started"), value: formatDateTime(run.startedAt) },
        {
          key: "finished",
          label: t("admin.jobs.run.finished"),
          value: run.finishedAt ? formatDateTime(run.finishedAt) : t("admin.jobs.run.no_finish"),
        },
        { key: "took", label: t("admin.jobs.run.took"), value: took(run, state) },
        {
          key: "called_by",
          label: t("admin.jobs.run.called_by"),
          value: run.schedule
            ? t("admin.jobs.run.scheduler_with", { expression: run.schedule })
            : t("admin.jobs.called_by.hand"),
        },
      ]}
    />
  );
}

const STEP_TONE: Record<StepState, StatusTone> = {
  ok: "ok",
  failed: "bad",
  in_progress: "info",
  no_finish: "bad",
  not_reached: "neutral",
  not_recorded: "warn",
};

function scalarText(value: JsonValue): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return t("admin.jobs.result.items", { count: value.length, formatted: formatCount(value.length) });
  if (typeof value === "object") return t("admin.jobs.result.fields", { count: Object.keys(value).length, formatted: formatCount(Object.keys(value).length) });
  return String(value);
}

/**
 * What a step returned: its top-level fields in a line, and the whole value
 * under a disclosure. The keys are the module's own identifiers — machine
 * strings, so mono and untranslated, the way a column head names a field.
 */
export function StepResult({ result }: { result: unknown }) {
  const value = (result ?? null) as JsonValue;
  if (value === null) return <span className="text-muted">{t("admin.jobs.result.none")}</span>;

  const summarised = isSummarised(value);
  const entries =
    typeof value === "object" && !Array.isArray(value)
      ? Object.entries(value).filter(([key]) => key !== "_summarised")
      : null;

  return (
    <div className="flex flex-col items-start gap-1">
      {entries ? (
        <dl className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-caption">
          {entries.map(([key, item]) => (
            <div key={key} className="flex gap-1">
              <dt className="text-muted">{key}</dt>
              <dd className="text-ink">{scalarText(item)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <span className="font-mono text-caption text-ink">{scalarText(value)}</span>
      )}
      {summarised ? <span className="text-caption text-warn-ink">{t("admin.jobs.result.summarised")}</span> : null}
      {typeof value === "object" ? (
        <details className="text-caption">
          <summary className="cursor-pointer rounded-tag text-body underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none">
            {t("admin.jobs.result.raw")}
          </summary>
          <pre className="mt-1 max-h-64 max-w-[48rem] overflow-auto whitespace-pre-wrap break-words rounded-tag bg-paper-sunk p-2 font-mono text-caption text-body">
            {JSON.stringify(value, null, 2)}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

export function StepTable({ steps, caption }: { steps: readonly StepRow[]; caption: string }) {
  return (
    <TableFrame label={caption}>
      <table className="w-full min-w-[56rem] border-collapse text-body-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-paper-sunk">
          <tr>
            {(["position", "step", "outcome", "took", "detail"] as const).map((col) => (
              <th key={col} scope="col" className={cn(COLHEAD, (col === "position" || col === "took") && "text-right")}>
                {t(`admin.jobs.steps.col.${col}` as MessageKey)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {steps.map((row) => (
            <tr
              key={row.name}
              className={cn(
                "border-t border-line align-top",
                row.state === "not_reached" || row.state === "not_recorded" ? "bg-paper-sunk" : null,
              )}
            >
              <td className="py-2.5 pl-4 pr-3 text-right font-mono text-caption tabular-nums text-muted">
                {formatCount(row.position + 1)}
              </td>
              <th scope="row" className="px-3 py-2.5 text-left font-mono text-caption font-normal text-ink">
                {row.name}
              </th>
              <td className="px-3 py-2.5">
                <StatusBadge tone={STEP_TONE[row.state]} shape="chip" size="sm" dot>
                  {t(`admin.jobs.step_state.${row.state}` as MessageKey)}
                </StatusBadge>
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-body">
                {row.step ? formatElapsed(row.step.finishedAt.getTime() - row.step.startedAt.getTime()) : null}
              </td>
              <td className="px-3 py-2.5 text-body">
                {row.step === null ? (
                  <span className="text-caption text-body">{t(`admin.jobs.step_note.${row.state}` as MessageKey)}</span>
                ) : row.step.ok ? (
                  <StepResult result={row.step.result} />
                ) : (
                  <span className="whitespace-pre-wrap break-words font-mono text-caption text-bad-ink">{row.step.error}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableFrame>
  );
}
