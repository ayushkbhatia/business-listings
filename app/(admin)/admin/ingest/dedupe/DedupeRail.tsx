import { useId } from "react";
import { cn } from "@/lib/cn";
import type { TodayTally } from "@/lib/dedupe/queue";
import { EN_DASH, formatCount, formatPercent } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { SignalRow } from "./signals";

/**
 * Board 12b's right rail: what matched, why a person decides this band, and
 * what this person has decided today.
 *
 * Plain markup rather than client components, so the gallery draws exactly
 * what the page draws.
 */

function RailCard({
  title,
  children,
  sunk = false,
}: {
  title: string;
  children: React.ReactNode;
  sunk?: boolean;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className={cn("rounded-panel border border-line px-5 py-4", sunk ? "bg-paper-sunk" : "bg-card")}
    >
      <h2 id={id} className={sunk ? "text-body font-medium text-ink" : "font-mono text-eyebrow uppercase text-muted"}>
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

const TONE: Record<SignalRow["tone"], string> = {
  ok: "text-ok-ink",
  warn: "text-warn-ink",
  muted: "text-muted",
};

export function SignalsCard({ rows }: { rows: readonly SignalRow[] }) {
  return (
    <RailCard title={t("admin.dedupe.signals.title")}>
      <dl className="flex flex-col gap-2.5">
        {rows.map((row) => (
          <div key={row.key} className="flex items-baseline justify-between gap-3 text-body-sm">
            <dt className="text-ink">{row.label}</dt>
            <dd className={cn("text-end tabular-nums", TONE[row.tone])}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </RailCard>
  );
}

export function WhyCard({ score, bands }: { score: number | null; bands: { floor: number; certain: number } }) {
  return (
    <RailCard
      sunk
      title={t("admin.dedupe.why.title", {
        percent: score === null ? `${formatPercent(bands.floor)}${EN_DASH}${formatPercent(bands.certain)}` : formatPercent(score),
      })}
    >
      <p className="text-body-sm text-body">
        {t("admin.dedupe.why.body", { floor: formatPercent(bands.floor), certain: formatPercent(bands.certain) })}
      </p>
    </RailCard>
  );
}

export function TodayCard({ tally }: { tally: TodayTally }) {
  const rows = [
    { key: "reviewed", label: t("admin.dedupe.today.reviewed"), value: tally.reviewed },
    { key: "merged", label: t("admin.dedupe.today.merged"), value: tally.merged },
    { key: "separated", label: t("admin.dedupe.today.separated"), value: tally.separated },
    { key: "discarded", label: t("admin.dedupe.today.discarded"), value: tally.discarded },
  ];
  return (
    <RailCard title={t("admin.dedupe.today.title")}>
      <dl className="flex flex-col gap-2.5">
        {rows.map((row) => (
          <div key={row.key} className="flex items-baseline justify-between gap-3 text-body-sm">
            <dt className="text-ink">{row.label}</dt>
            <dd className="font-mono tabular-nums text-ink">{formatCount(row.value)}</dd>
          </div>
        ))}
        {tally.bulkBatches > 0 && (
          <div className="flex items-baseline justify-between gap-3 border-t border-line pt-2.5 text-body-sm">
            <dt className="text-ink">{t("admin.dedupe.today.bulk")}</dt>
            <dd className="font-mono tabular-nums text-ink">{formatCount(tally.bulkPairs)}</dd>
          </div>
        )}
      </dl>
    </RailCard>
  );
}

/** B10 / Q1: the pairs nobody will see, counted where a badly set floor shows. */
export function BelowFloorNote({ count, floor }: { count: number; floor: number }) {
  if (count === 0) return null;
  return (
    <p className="rounded-panel border border-line bg-card px-5 py-4 text-body-sm text-body">
      {t("admin.dedupe.below_floor", { count, n: formatCount(count), floor: formatPercent(floor) })}
    </p>
  );
}

export function QueueEmpty({
  certain,
  bands,
}: {
  certain: number;
  bands: { floor: number; certain: number };
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="rounded-panel border border-line bg-card px-6 py-10 text-center">
      <h2 id={id} className="text-h3 text-ink">
        {t("admin.dedupe.empty.title")}
      </h2>
      <p className="mx-auto mt-2 max-w-prose text-body-sm text-body">
        {t("admin.dedupe.empty.body", { floor: formatPercent(bands.floor), certain: formatPercent(bands.certain) })}
      </p>
      {certain > 0 && (
        <p className="mx-auto mt-2 max-w-prose text-body-sm text-body">
          {t("admin.dedupe.empty.bulk", { count: certain, n: formatCount(certain), certain: formatPercent(bands.certain) })}
        </p>
      )}
    </section>
  );
}
