"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { Alert, StatusBadge } from "@/components/display";
import { Button, IconButton, Icons, Label, Textarea } from "@/components/primitives";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { removeAction, reorderAction, type ActionResult } from "./actions";
import type { SlotView } from "./present";

/**
 * Board 6h — the four slots, in the order a buyer meets them.
 *
 * Drag writes the order (`B6`), and so do the move buttons, because a drag
 * handle is not a keyboard control. Nothing is saved on drop: the new order is
 * held here until somebody gives a reason and saves it, since the reorder is an
 * audit row like any other change to the rail (`B3`).
 *
 * A slot held by a business that lost Tier 2 is drawn in the bad tone with the
 * failed condition and its next step. It is *held*, not empty — the home page
 * shows nothing in its place, and nobody else moves into it until a person
 * removes it (`B2`).
 */

const MIN_REASON = 4;

function Result({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return (
    <Alert tone={result.ok ? "ok" : "bad"} live={result.ok ? "polite" : "assertive"}>
      {result.ok ? result.message : result.error}
    </Alert>
  );
}

function ReasonField({ id, value, onChange, label }: { id: string; value: string; onChange: (value: string) => void; label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} requirement="required" requirementLabel={t("field.required")}>
        {label}
      </Label>
      <Textarea id={id} rows={2} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

export function SlotList({
  slots,
  order: savedOrder,
  canWrite,
}: {
  slots: readonly SlotView[];
  order: readonly (string | null)[];
  canWrite: boolean;
}) {
  const ids = { reorder: useId(), remove: useId() };
  const savedKey = JSON.stringify(savedOrder);
  const [basedOn, setBasedOn] = useState(savedKey);
  const [order, setOrder] = useState<(string | null)[]>([...savedOrder]);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeReason, setRemoveReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  // A save — here or in another tab — re-renders the page with a new order. Adopt it, keep the message.
  if (savedKey !== basedOn) {
    setBasedOn(savedKey);
    setOrder([...savedOrder]);
    setRemoving(null);
  }

  const byId = new Map(slots.flatMap((slot) => (slot.business ? [[slot.business.id, slot] as const] : [])));
  const dirty = JSON.stringify(order) !== savedKey;
  const movable = canWrite && !pending;

  function swap(from: number, to: number) {
    if (from === to || to < 0 || to >= order.length) return;
    setOrder((current) => {
      const next = [...current];
      [next[from], next[to]] = [next[to]!, next[from]!];
      return next;
    });
    setResult(null);
  }

  function saveOrder() {
    const form = new FormData();
    form.set("order", JSON.stringify(order));
    form.set("basedOn", savedKey);
    form.set("reason", reason);
    startTransition(async () => {
      const outcome = await reorderAction(form);
      setResult(outcome);
      if (outcome.ok) setReason("");
    });
  }

  function remove(businessId: string) {
    const form = new FormData();
    form.set("businessId", businessId);
    form.set("reason", removeReason);
    startTransition(async () => {
      const outcome = await removeAction(form);
      setResult(outcome);
      if (outcome.ok) {
        setRemoveReason("");
        setRemoving(null);
      }
    });
  }

  return (
    <div>
      <ol className="divide-y divide-line">
        {order.map((businessId, index) => {
          const position = index + 1;
          const slot = businessId ? byId.get(businessId) : undefined;
          const business = slot?.business ?? null;
          const blocked = Boolean(business && !business.eligible);
          const positionLabel = t("curation.slot", { position: String(position) });

          return (
            <li
              key={businessId ?? `empty-${position}`}
              aria-label={business ? t("curation.slot_named", { position: String(position), business: business.name }) : positionLabel}
              draggable={movable && business !== null}
              onDragStart={(event) => {
                setDragFrom(index);
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(event) => {
                if (dragFrom !== null) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragFrom !== null) swap(dragFrom, index);
                setDragFrom(null);
              }}
              onDragEnd={() => setDragFrom(null)}
              className={cn(
                "flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:px-6",
                blocked && "bg-bad-surface",
                dragFrom === index && "opacity-60",
              )}
            >
              <span aria-hidden="true" className={cn("hidden w-3 select-none font-mono text-caption text-body sm:block", movable && business ? "cursor-grab" : "invisible")}>
                ⠿
              </span>
              <span className="w-4 font-mono text-body-sm tabular-nums text-body" aria-hidden="true">
                {position}
              </span>

              {business ? (
                <>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-chip border font-mono text-body-sm",
                      blocked ? "border-bad-line bg-bad-surface text-bad-ink" : "border-line bg-paper-sunk text-ink",
                    )}
                  >
                    {business.initials}
                  </span>
                  <div className="min-w-0 flex-1 basis-64">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={business.storefrontHref} className="text-body font-medium text-ink underline-offset-2 hover:underline focus-visible:rounded-tag focus-visible:shadow-focus focus-visible:outline-none">
                        {business.name}
                      </Link>
                      <StatusBadge tone={blocked ? "bad" : "ok"} shape="chip" size="sm">
                        {business.tierLabel}
                      </StatusBadge>
                    </div>
                    {blocked ? (
                      <>
                        <p className="mt-1 text-body-sm text-bad-ink">{business.block}</p>
                        <p className="mt-0.5 text-caption text-body">{slot?.emptyOnHome}</p>
                      </>
                    ) : (
                      <p className="mt-1 text-body-sm text-body">{business.signals}</p>
                    )}
                  </div>
                  <span className="font-mono text-caption uppercase tabular-nums text-body">{business.licence}</span>
                  <div className="flex items-center gap-1.5">
                    {canWrite ? (
                      <>
                        <IconButton label={t("curation.move_up", { business: business.name })} icon={<Icons.ChevronUp />} size="sm" variant="ghost" disabled={!movable || index === 0} onClick={() => swap(index, index - 1)} />
                        <IconButton label={t("curation.move_down", { business: business.name })} icon={<Icons.ChevronDown />} size="sm" variant="ghost" disabled={!movable || index === order.length - 1} onClick={() => swap(index, index + 1)} />
                      </>
                    ) : null}
                    {blocked && business.action ? (
                      <Link href={business.action.href} className="inline-flex h-8 items-center rounded-ctl border border-bad-line bg-card px-3 text-body-sm text-bad-ink hover:bg-bad-surface focus-visible:shadow-focus focus-visible:outline-none">
                        {business.action.label}
                      </Link>
                    ) : null}
                    {canWrite ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={pending || dirty}
                        aria-expanded={removing === business.id}
                        aria-label={slot?.removeLabel ?? undefined}
                        onClick={() => {
                          setRemoving(removing === business.id ? null : business.id);
                          setRemoveReason("");
                          setResult(null);
                        }}
                      >
                        {t("curation.remove")}
                      </Button>
                    ) : null}
                  </div>

                  {removing === business.id ? (
                    <div className="basis-full rounded-card border border-line bg-card p-3 sm:ms-8">
                      <ReasonField id={ids.remove} value={removeReason} onChange={setRemoveReason} label={t("curation.remove_reason")} />
                      <p className="mt-1.5 text-caption text-body">{t("curation.remove_hint", { position: String(position) })}</p>
                      <div className="mt-2.5 flex flex-wrap gap-2">
                        <Button variant="danger" size="sm" disabled={pending || removeReason.trim().length < MIN_REASON} loading={pending} onClick={() => remove(business.id)}>
                          {t("curation.remove_confirm", { position: String(position) })}
                        </Button>
                        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setRemoving(null)}>
                          {t("curation.cancel")}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="min-w-0 flex-1 text-body-sm text-body">
                  <span className="text-ink">{t("curation.empty")}</span> {t("curation.empty_body")}
                </p>
              )}
            </li>
          );
        })}
      </ol>

      {dirty ? (
        <div className="border-t border-line bg-card px-4 py-3.5 sm:px-6">
          <p className="text-body-sm text-ink">{t("curation.order_changed")}</p>
          <div className="mt-2 max-w-lg">
            <ReasonField id={ids.reorder} value={reason} onChange={setReason} label={t("curation.reorder_reason")} />
          </div>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button size="sm" disabled={pending || reason.trim().length < MIN_REASON} loading={pending} onClick={saveOrder}>
              {t("curation.save_order")}
            </Button>
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => setOrder([...savedOrder])}>
              {t("curation.discard_order")}
            </Button>
          </div>
        </div>
      ) : null}

      {result ? (
        <div className="border-t border-line px-4 py-3 sm:px-6">
          <Result result={result} />
        </div>
      ) : null}
    </div>
  );
}
