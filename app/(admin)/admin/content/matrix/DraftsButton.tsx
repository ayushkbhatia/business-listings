"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/display";
import { Button, Label, Textarea } from "@/components/primitives";
import { Panel } from "@/components/structure";
import { t } from "@/lib/i18n";
import type { ActionResult } from "./actions";

/**
 * Board 6f §2 — "Generate 38 drafts", not "Generate queued pages".
 *
 * The count is live and it is the same query the action runs, so the number on
 * the button is the number the click produces. Human review of copy is
 * required, so this cannot publish: it creates an empty page for every scope
 * that is above its floors and unwritten, and a writer takes it from there.
 *
 * A reason, because it is a staff state change like any other — thirty-eight
 * rows appearing in a queue is something the next person to open the log should
 * be able to find an explanation for.
 */
export function DraftsButton({
  count,
  categoryId,
  action,
}: {
  count: number;
  categoryId: string;
  action: (formData: FormData) => Promise<ActionResult>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} disabled={count === 0}>
        {count === 0
          ? t("matrix.generate_none")
          : t("matrix.generate_drafts", { count })}
      </Button>

      {open && (
        <Panel title={t("matrix.generate_drafts", { count })}>
          <p className="max-w-prose text-caption text-muted">{t("matrix.generate_hint")}</p>

          <div className="mt-3">
            <Label htmlFor="drafts-reason">{t("rules.reason")}</Label>
            <Textarea
              id="drafts-reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              disabled={pending || reason.trim().length < 4}
              onClick={() => {
                const form = new FormData();
                form.set("categoryId", categoryId);
                form.set("reason", reason);
                startTransition(async () => {
                  const outcome = await action(form);
                  setResult(outcome);
                  if (outcome.ok) setOpen(false);
                });
              }}
            >
              {t("matrix.generate_confirm")}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              {t("action.cancel")}
            </Button>
          </div>
        </Panel>
      )}

      {result && (
        <Alert tone={result.ok ? "ok" : "bad"} live="assertive">
          {result.ok ? result.message : result.error}
        </Alert>
      )}
    </>
  );
}
