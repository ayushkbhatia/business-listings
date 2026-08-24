"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/primitives";
import { StatusBadge } from "@/components/display";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { PromoteResult } from "./actions";

export interface SlotRow {
  categoryId: string;
  categoryName: string;
  mine: boolean;
  takenUntil: string | null;
  queued: boolean;
  ahead: number;
  monthlyPriceAed: number;
}

export interface SlotListProps {
  slots: readonly SlotRow[];
  takeAction: (formData: FormData) => Promise<PromoteResult>;
  leaveAction: (formData: FormData) => Promise<PromoteResult>;
}

export function SlotList({ slots, takeAction, leaveAction }: SlotListProps) {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: (f: FormData) => Promise<PromoteResult>, categoryId: string) {
    const form = new FormData();
    form.set("categoryId", categoryId);
    setError(null);
    startTransition(async () => {
      const result = await action(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice(result.queued ? t("promote.joined") : null);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <div
          role="alert"
          className="rounded-ctl border border-bad-line bg-bad-surface px-3 py-2 text-body-sm text-bad-ink"
        >
          {error}
        </div>
      )}
      <span aria-live="polite" className="text-body-sm text-muted">
        {notice}
      </span>

      <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-card">
        {slots.map((slot) => (
          <li
            key={slot.categoryId}
            className="flex flex-wrap items-center justify-between gap-3 px-3 py-3"
          >
            <div className="min-w-0">
              <span className="block text-body-sm text-ink">{slot.categoryName}</span>
              <span className="mt-0.5 block text-caption text-muted">
                {slot.mine
                  ? t("promote.yours", { when: slot.takenUntil ?? "—" })
                  : slot.takenUntil
                    ? t("promote.taken", { when: slot.takenUntil })
                    : t("promote.available", { price: formatCount(slot.monthlyPriceAed) })}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {slot.mine ? (
                <StatusBadge tone="ok" shape="chip" size="sm">
                  {t("plan.current")}
                </StatusBadge>
              ) : slot.queued ? (
                <>
                  <span className="text-caption text-muted">
                    {t("promote.queue_position", { n: formatCount(slot.ahead) })}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => run(leaveAction, slot.categoryId)}
                  >
                    {t("promote.leave")}
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant={slot.takenUntil ? "secondary" : "primary"}
                  disabled={pending}
                  onClick={() => run(takeAction, slot.categoryId)}
                >
                  {slot.takenUntil ? t("promote.join") : t("promote.buy")}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
