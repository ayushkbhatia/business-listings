"use client";

import { useId, useState, useTransition } from "react";
import { Button, Input, Label } from "@/components/primitives";
import { Alert } from "@/components/display";
import { t } from "@/lib/i18n";
import type { ActionResult } from "./actions";

/**
 * Board 12f — starting a session.
 *
 * The ticket is required and is the first field, because it is the reason. §07
 * calls view-as a privacy event, and a privacy event with no reason recorded is
 * the silent version the matrix says must be impossible.
 */

export interface ViewAsFormProps {
  live: { business: string; ticket: string; minutes: number } | null;
  start: (formData: FormData) => Promise<ActionResult>;
  stop: () => Promise<ActionResult>;
}

const MIN_REASON = 4;

export function ViewAsForm({ live, start, stop }: ViewAsFormProps) {
  const ticketId = useId();
  const slugId = useId();
  const reasonId = useId();

  const [ticket, setTicket] = useState("");
  const [slug, setSlug] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const ready = ticket.trim().length >= 3 && slug.trim() !== "" && reason.trim().length >= MIN_REASON;

  function send() {
    const form = new FormData();
    form.set("ticket", ticket);
    form.set("slug", slug);
    form.set("reason", reason);
    startTransition(async () => {
      const outcome = await start(form);
      setResult(outcome);
      if (outcome.ok) {
        setTicket("");
        setSlug("");
        setReason("");
      }
    });
  }

  if (live) {
    return (
      <div className="flex flex-col gap-3">
        <Alert tone="warn" fix={t("admin.support.end")}>
          {t("admin.support.live", {
            business: live.business,
            ticket: live.ticket,
            minutes: String(live.minutes),
          })}
        </Alert>
        <div>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => startTransition(async () => setResult(await stop()))}
          >
            {t("admin.support.end")}
          </Button>
        </div>
        {result && !result.ok && (
          <Alert tone="bad" live="assertive" fix={t("admin.review.reason_hint")}>
            {result.error}
          </Alert>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Label
          htmlFor={ticketId}
          requirement="required"
          requirementLabel={t("field.required")}
          hint={t("admin.support.ticket_hint")}
        >
          {t("admin.support.ticket_label")}
        </Label>
        <Input id={ticketId} value={ticket} onChange={(e) => setTicket(e.target.value)} />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor={slugId} requirement="required" requirementLabel={t("field.required")}>
          {t("admin.support.business_label")}
        </Label>
        <Input id={slugId} value={slug} onChange={(e) => setSlug(e.target.value)} />
      </div>

      <div className="flex flex-col gap-1">
        <Label
          htmlFor={reasonId}
          requirement="required"
          requirementLabel={t("field.required")}
          hint={t("admin.review.reason_hint")}
        >
          {t("admin.review.reason_label")}
        </Label>
        <Input id={reasonId} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>

      <div>
        <Button disabled={!ready || pending} onClick={send}>
          {t("admin.support.start")}
        </Button>
      </div>

      {result && (
        <Alert
          tone={result.ok ? "ok" : "bad"}
          live={result.ok ? "polite" : "assertive"}
          {...(result.ok ? {} : { fix: t("admin.review.reason_hint") })}
        >
          {result.ok ? result.message : result.error}
        </Alert>
      )}
    </div>
  );
}
