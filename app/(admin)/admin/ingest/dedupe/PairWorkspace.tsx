"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, StatusBadge } from "@/components/display";
import { Button, Label, Select, Textarea } from "@/components/primitives";
import { cn } from "@/lib/cn";
import type { PairSide, PairView } from "@/lib/dedupe/queue";
import type { Signal } from "@/lib/dedupe/similarity";
import { formatCount, formatPercent, formatPhone, formatRating } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { ActionResult } from "./actions";

/**
 * Board 12b — one pair filling the frame, decided from the keyboard.
 *
 * 432 pairs is a shift of work, so the interface is built for someone doing it
 * all afternoon (B7): J and K move, 1, 2 and 3 choose, Ctrl+Enter confirms, S
 * skips. Skip is navigation and nothing else — the pair stays pending (B3).
 *
 * The consequence is drawn before the buttons. Licence, address and phone are
 * there for the match; reviews, products and plan are there for what a wrong
 * merge would destroy. Record A is always the side B1 keeps, so the reviewer
 * never has to work out which way round the merge goes.
 */

const MIN_REASON = 4;

type Outcome = "merge" | "separate" | "discard";
const OUTCOMES: Outcome[] = ["merge", "separate", "discard"];

export interface PairWorkspaceProps {
  pair: PairView;
  position: number;
  total: number;
  runId: string | null;
  reversibleDays: number;
  resolve: (formData: FormData) => Promise<ActionResult>;
  /** Held by the parent, so the sentence outlives the last pair leaving. */
  onResult: (result: ActionResult) => void;
  /** Off in the gallery, where several specimens share one window. */
  keyboard?: boolean;
}

export function PairWorkspace({
  pair,
  position,
  total,
  runId,
  reversibleDays,
  resolve,
  onResult,
  keyboard = true,
}: PairWorkspaceProps) {
  const router = useRouter();
  const ids = { title: useId(), reason: useId(), area: useId(), keys: useId() };
  const recordPair = pair.kind === "record";

  const discardBlocked =
    !recordPair && (pair.b.claimed || pair.b.paying || pair.b.reviews + pair.b.products + pair.b.enquiries > 0);
  const mergeBlocked = pair.bothClaimed;
  const disabled = useMemo<Record<Outcome, boolean>>(
    () => ({ merge: mergeBlocked, separate: false, discard: discardBlocked }),
    [mergeBlocked, discardBlocked],
  );
  const initial: Outcome = mergeBlocked ? "separate" : "merge";

  const [outcome, setOutcome] = useState<Outcome>(initial);
  const [reason, setReason] = useState(() => suggestedReason(initial, pair.signals));
  const [edited, setEdited] = useState(false);
  const [areaId, setAreaId] = useState(pair.resolvedAreaId ?? "");
  const [pending, startTransition] = useTransition();
  const radios = useRef<Record<Outcome, HTMLInputElement | null>>({ merge: null, separate: null, discard: null });

  // A new pair is a new decision: nothing carries over from the last one but
  // the sentence saying how the last one went. Adjusted while rendering rather
  // than in an effect, so the old pair's choice never paints over the new pair.
  const [shownPair, setShownPair] = useState(pair.id);
  if (shownPair !== pair.id) {
    setShownPair(pair.id);
    setOutcome(initial);
    setReason(suggestedReason(initial, pair.signals));
    setEdited(false);
    setAreaId(pair.resolvedAreaId ?? "");
  }

  const needsArea = recordPair && outcome === "merge" && !pair.resolvedAreaId;
  const ready = !disabled[outcome] && reason.trim().length >= MIN_REASON && (!needsArea || areaId !== "") && !pending;

  const go = useCallback(
    (to: number) => {
      const next = ((to - 1 + total) % total) + 1;
      const params = new URLSearchParams();
      if (runId) params.set("run", runId);
      if (next > 1) params.set("pair", String(next));
      const query = params.toString();
      router.push(query ? `?${query}` : "?", { scroll: false });
    },
    [router, runId, total],
  );

  const choose = useCallback(
    (next: Outcome) => {
      if (disabled[next]) return;
      setOutcome(next);
      if (!edited) setReason(suggestedReason(next, pair.signals));
      radios.current[next]?.focus();
    },
    [disabled, edited, pair.signals],
  );

  const confirm = useCallback(() => {
    if (!ready) return;
    const form = new FormData();
    form.set("candidateId", pair.id);
    form.set("outcome", outcome);
    form.set("reason", reason);
    form.set("childName", pair.b.name);
    if (recordPair && outcome === "merge" && areaId) form.set("areaId", areaId);
    startTransition(async () => {
      onResult(await resolve(form));
      // The resolved pair has left the queue, so the same position is now the
      // next pair. Refreshing in place is the "next" a reviewer expects.
      router.refresh();
    });
  }, [ready, pair.id, pair.b.name, outcome, reason, recordPair, areaId, resolve, onResult, router]);

  useEffect(() => {
    if (!keyboard) return;
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey) return;
      if (document.querySelector("dialog[open]")) return;
      const target = event.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.isContentEditable || ["TEXTAREA", "SELECT"].includes(target.tagName) ||
          (target.tagName === "INPUT" && (target as HTMLInputElement).type !== "radio"));

      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        confirm();
        return;
      }
      if (typing || event.ctrlKey || event.metaKey) return;

      switch (event.key.toLowerCase()) {
        case "j":
          event.preventDefault();
          go(position + 1);
          break;
        case "k":
          event.preventDefault();
          go(position - 1);
          break;
        case "s":
          event.preventDefault();
          go(position + 1);
          break;
        case "1":
        case "2":
        case "3":
          event.preventDefault();
          choose(OUTCOMES[Number(event.key) - 1]!);
          break;
        case "enter":
          if (target?.tagName === "INPUT") {
            event.preventDefault();
            confirm();
          }
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keyboard, choose, confirm, go, position]);

  const a = pair.a;
  const b = pair.b;
  const differs = {
    licence: !!b.licenceNumber && b.licenceNumber !== a.licenceNumber,
    address: !!b.address && b.address !== a.address,
    phone: !!b.phone && !!a.phone && digits(b.phone) !== digits(a.phone),
  };

  const mergeLabel = recordPair ? "admin.dedupe.outcome.merge" : "admin.dedupe.outcome.merge_listing";
  const mergeHelp = recordPair
    ? a.claimed
      ? "admin.dedupe.outcome.merge_help_claimed"
      : "admin.dedupe.outcome.merge_help"
    : "admin.dedupe.outcome.merge_listing_help";
  const actionLabel = {
    merge: t(recordPair ? "admin.dedupe.action.merge" : "admin.dedupe.action.merge_listing"),
    separate: t("admin.dedupe.action.separate"),
    discard: t("admin.dedupe.action.discard"),
  }[outcome];

  return (
    <section aria-labelledby={ids.title} className="overflow-hidden rounded-panel border border-line bg-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id={ids.title} className="text-h3 text-ink">
            {t("admin.dedupe.pair_title", { position: formatCount(position), total: formatCount(total) })}
          </h2>
          <StatusBadge tone="warn">{t("admin.dedupe.confidence", { percent: formatPercent(pair.score) })}</StatusBadge>
        </div>
        <div className="flex items-center gap-2">
          <span id={ids.keys} className="font-mono text-eyebrow uppercase text-muted">
            {t("admin.dedupe.keys")}
          </span>
          <span className="sr-only">{t("admin.dedupe.keys_help")}</span>
          {total > 1 && (
            <>
              <Button size="sm" variant="ghost" onClick={() => go(position - 1)} aria-describedby={ids.keys}>
                {t("admin.dedupe.previous")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => go(position + 1)} aria-describedby={ids.keys}>
                {t("admin.dedupe.next")}
              </Button>
            </>
          )}
        </div>
      </header>

      <div className="grid md:grid-cols-2">
        <SideCard
          side={a}
          eyebrow={t(a.claimed ? "admin.dedupe.side.a_claimed" : "admin.dedupe.side.a_unclaimed")}
          highlight={{ licence: false, address: false, phone: false }}
          note={
            pair.bothClaimed ? (
              <Alert tone="warn" fix={t("admin.dedupe.outcome.separate_help")}>
                {t("admin.dedupe.both_claimed")}
              </Alert>
            ) : (
              <p className="rounded-card bg-ok-surface px-4 py-3 text-body-sm text-ok-ink">
                {t(
                  a.paying
                    ? "admin.dedupe.keeps_everything"
                    : a.reviews + a.products > 0
                      ? "admin.dedupe.keeps_history"
                      : "admin.dedupe.keeps_nothing",
                )}
              </p>
            )
          }
        />
        <SideCard
          side={b}
          className="border-t border-line md:border-l md:border-t-0"
          eyebrow={
            b.kind === "record"
              ? t("admin.dedupe.side.b_run", { number: b.runNumber ?? "" })
              : t(b.claimed ? "admin.dedupe.side.b_listing_claimed" : "admin.dedupe.side.b_listing")
          }
          highlight={differs}
          note={
            pair.hint ? (
              <p className="rounded-card bg-warn-surface px-4 py-3 text-body-sm text-warn-ink">
                {pair.hint.kind === "branch_suffix"
                  ? t("admin.dedupe.hint.branch_suffix", { suffix: pair.hint.suffix })
                  : t("admin.dedupe.hint.same_licence")}
              </p>
            ) : null
          }
        />
      </div>

      <div className="border-t border-line bg-paper-sunk px-5 py-5">
        <fieldset className="min-w-0 border-0 p-0">
          <legend className="mb-3 text-body font-medium text-ink">{t("admin.dedupe.resolve_legend")}</legend>
          <div className="grid gap-3 lg:grid-cols-3">
            {OUTCOMES.map((key, index) => {
              const label =
                key === "merge" ? t(mergeLabel) : key === "separate" ? t("admin.dedupe.outcome.separate") : t("admin.dedupe.outcome.discard");
              const help =
                key === "merge"
                  ? t(mergeHelp)
                  : key === "separate"
                    ? t("admin.dedupe.outcome.separate_help")
                    : t(discardBlocked ? "admin.dedupe.outcome.discard_blocked" : "admin.dedupe.outcome.discard_help");
              const selected = outcome === key;
              return (
                <label
                  key={key}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-card border bg-card px-4 py-3.5",
                    "transition-colors duration-120 ease-out has-[:focus-visible]:shadow-focus",
                    selected ? "border-ink" : "border-line hover:border-line-strong",
                    disabled[key] && "cursor-not-allowed bg-fill",
                  )}
                >
                  <span className="relative mt-0.5 flex size-5 shrink-0 items-center justify-center">
                    <input
                      ref={(node) => {
                        radios.current[key] = node;
                      }}
                      type="radio"
                      name={`outcome-${pair.id}`}
                      value={key}
                      checked={selected}
                      disabled={disabled[key]}
                      onChange={() => choose(key)}
                      aria-keyshortcuts={String(index + 1)}
                      className={cn(
                        "peer size-4 cursor-pointer appearance-none rounded-pill border bg-card focus-visible:outline-none",
                        "checked:border-moss disabled:cursor-not-allowed disabled:border-line disabled:bg-disabled-fill",
                        "border-line-strong",
                      )}
                    />
                    <span className="pointer-events-none absolute size-2 rounded-pill bg-moss opacity-0 peer-checked:opacity-100" />
                  </span>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className={cn("text-body", disabled[key] ? "text-disabled-text" : "text-ink")}>{label}</span>
                    <span className="text-body-sm text-muted">{help}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {needsArea && (
          <div className="mt-4 flex max-w-md flex-col gap-1">
            <Label
              htmlFor={ids.area}
              requirement="required"
              requirementLabel={t("field.required")}
              hint={t("admin.dedupe.branch_area_hint", { area: b.address ?? "" })}
            >
              {t("admin.dedupe.branch_area")}
            </Label>
            <Select
              id={ids.area}
              value={areaId}
              placeholder={t("admin.dedupe.choose_area")}
              onChange={(event) => setAreaId(event.target.value)}
              options={pair.areaOptions.map((area) => ({ value: area.id, label: area.name }))}
            />
          </div>
        )}

        <div className="mt-4 flex flex-col gap-1">
          <Label
            htmlFor={ids.reason}
            requirement="required"
            requirementLabel={t("field.required")}
            hint={t("admin.dedupe.reason_hint")}
          >
            {t("admin.review.reason_label")}
          </Label>
          <Textarea
            id={ids.reason}
            rows={2}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setEdited(true);
            }}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button size="lg" loading={pending} disabled={!ready} onClick={confirm} aria-keyshortcuts="Control+Enter">
            {actionLabel}
          </Button>
          <Button size="lg" variant="secondary" onClick={() => go(position + 1)} disabled={pending || total < 2} aria-keyshortcuts="S">
            {t("admin.dedupe.skip")}
          </Button>
          <p className="ms-auto text-body-sm text-muted">{t("admin.dedupe.footnote", { days: formatCount(reversibleDays) })}</p>
        </div>

      </div>
    </section>
  );
}

function SideCard({
  side,
  eyebrow,
  highlight,
  note,
  className,
}: {
  side: PairSide;
  eyebrow: string;
  highlight: { licence: boolean; address: boolean; phone: boolean };
  note: React.ReactNode;
  className?: string;
}) {
  const none = <span className="text-muted">{t("admin.dedupe.value.none")}</span>;
  const missing = <span className="text-muted">{t("admin.dedupe.value.not_provided")}</span>;
  const rows: { key: string; label: string; value: React.ReactNode; mono?: boolean; warn?: boolean }[] = [
    {
      key: "licence",
      label: t("admin.dedupe.field.licence"),
      value: side.licenceNumber ?? missing,
      mono: !!side.licenceNumber,
      warn: highlight.licence,
    },
    { key: "address", label: t("admin.dedupe.field.address"), value: side.address ?? missing, warn: highlight.address },
    {
      key: "phone",
      label: t("admin.dedupe.field.phone"),
      value: side.phone ? formatPhone(side.phone) : missing,
      mono: !!side.phone,
      warn: highlight.phone,
    },
    {
      key: "reviews",
      label: t("admin.dedupe.field.reviews"),
      value:
        side.reviews === 0 ? (
          none
        ) : (
          <span className="text-ok-ink">
            {side.rating === null
              ? t("admin.dedupe.value.reviews_unrated", { count: side.reviews, n: formatCount(side.reviews) })
              : t("admin.dedupe.value.reviews", {
                  count: side.reviews,
                  n: formatCount(side.reviews),
                  rating: formatRating(side.rating),
                })}
          </span>
        ),
    },
    {
      key: "products",
      label: t("admin.dedupe.field.products"),
      value: side.products === 0 ? <span className="text-muted">{formatCount(0)}</span> : formatCount(side.products),
      mono: true,
    },
    {
      key: "plan",
      label: t("admin.dedupe.field.plan"),
      value: !side.claimed ? (
        <span className="text-muted">{t("admin.dedupe.value.unclaimed")}</span>
      ) : side.paying && side.planName ? (
        t("admin.dedupe.value.plan_paying", { plan: side.planName })
      ) : side.planName ? (
        t("admin.dedupe.value.plan", { plan: side.planName })
      ) : (
        t("admin.dedupe.value.claimed_free")
      ),
    },
  ];

  return (
    <div className={cn("flex flex-col gap-4 px-5 py-5", className)}>
      <div>
        <p className="font-mono text-eyebrow uppercase text-muted">{eyebrow}</p>
        <h3 className="mt-1.5 text-h3 text-ink">{side.name}</h3>
      </div>
      <dl className="flex flex-col gap-2">
        {rows.map((row) => (
          <div key={row.key} className="flex items-baseline justify-between gap-4 text-body-sm">
            <dt className="shrink-0 text-muted">{row.label}</dt>
            <dd
              className={cn(
                "min-w-0 text-end",
                row.mono && "font-mono tabular-nums",
                row.warn ? "text-warn-ink" : "text-ink",
              )}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      {note}
    </div>
  );
}

function digits(value: string): string {
  return value.replace(/\D/g, "").slice(-9);
}

/**
 * The reason, prefilled from what matched. The hint under the field asks for
 * what was actually checked; a sentence to edit is faster than a blank one and
 * still has to be read to be sent.
 */
function suggestedReason(outcome: Outcome, signals: readonly Signal[]): string {
  const words = signals
    .filter((signal) => signal.strength > 0)
    .map((signal) => t(`admin.dedupe.signals_reason.${signal.key}`, { detail: signal.detail }));
  const list = words.length > 0 ? words.join(", ") : t("admin.dedupe.value.none");
  return t(`admin.dedupe.reason.${outcome}`, { signals: list });
}
