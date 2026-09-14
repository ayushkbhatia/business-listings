"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/primitives";
import { t } from "@/lib/i18n";
import { buildCallListAction, refreshSignalsAction } from "./actions";

/**
 * Board 12d — the two controls outside the table, each a derivation or a
 * hand-over, neither an entry.
 *
 * *Refresh signals* runs the same derivation as the nightly job. *Take these
 * calls* puts a held page's unassigned calls on the reader's list; the rows
 * were already there.
 */

export function RefreshSignals({ primary = false }: { primary?: boolean }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant={primary ? "primary" : "secondary"}
        size="sm"
        loading={pending}
        onClick={() =>
          start(async () => {
            const result = await refreshSignalsAction();
            setMessage(result.ok ? { ok: true, text: result.message } : { ok: false, text: result.error });
          })
        }
      >
        {t("admin.crm.refresh")}
      </Button>
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-caption text-muted" : "text-caption text-bad-ink"}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

export function BuildCallList({ signalRef, label }: { signalRef: string; label: string }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <Button
        variant="primary"
        loading={pending}
        onClick={() =>
          start(async () => {
            const result = await buildCallListAction(signalRef);
            setMessage(result.ok ? { ok: true, text: result.message } : { ok: false, text: result.error });
          })
        }
      >
        {label}
      </Button>
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-caption text-muted" : "text-caption text-bad-ink"}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
