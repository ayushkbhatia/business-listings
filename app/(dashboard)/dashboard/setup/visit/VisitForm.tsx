"use client";

import { useState, useTransition } from "react";
import { Button, Textarea } from "@/components/primitives";
import { t } from "@/lib/i18n";
import type { VisitResult } from "../actions";

/**
 * Board 8e — asking for a visit.
 *
 * Not a booking calendar. We call to arrange, because a field team's day is
 * built around which emirate they are already in and a self-service slot picker
 * would be a promise we break. The seller says what suits them and we work
 * around it, which is honest about how it actually happens.
 */

export interface VisitFormProps {
  pending: { id: string; requestedAt: string } | null;
  requestAction: (formData: FormData) => Promise<VisitResult>;
  cancelAction: (formData: FormData) => Promise<VisitResult>;
}

export function VisitForm({ pending, requestAction, cancelAction }: VisitFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  if (pending) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-body-sm text-ink">
          {t("visit.pending", { when: pending.requestedAt })}
        </p>
        {error && (
          <p role="alert" className="text-body-sm text-bad-ink">
            {error}
          </p>
        )}
        <div>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              const form = new FormData();
              form.set("id", pending.id);
              startTransition(async () => {
                const result = await cancelAction(form);
                if (!result.ok) setError(result.error);
                else window.location.reload();
              });
            }}
          >
            {t("visit.cancel")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setError(null);
        startTransition(async () => {
          const result = await requestAction(form);
          if (!result.ok) setError(result.error);
          else window.location.reload();
        });
      }}
    >
      {error && (
        <p role="alert" className="text-body-sm text-bad-ink">
          {error}
        </p>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-body-sm text-ink">{t("visit.note_label")}</span>
        <Textarea name="note" rows={3} />
        <span className="text-caption text-muted">{t("visit.note_hint")}</span>
      </label>

      <div>
        <Button type="submit" disabled={busy}>
          {t("visit.request")}
        </Button>
      </div>
    </form>
  );
}
