"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/display";
import { Button, Checkbox, Textarea } from "@/components/primitives";
import { Panel } from "@/components/structure";
import { t } from "@/lib/i18n";
import { saveAutoReply } from "./actions";

/**
 * Board 7e §4 — the out-of-hours acknowledgement.
 *
 * The card states the correction rather than burying it. The board said an
 * auto-reply "counts as a first response"; it does not, and the sentence on
 * screen says so, because a seller who believes it does will switch it on and
 * stop worrying about a clock that is still running.
 *
 * What it may do is tell the buyer when the counter reopens and offer a number
 * for something urgent. Both are true and both help.
 */
export function AutoReplyForm({
  enabled,
  body,
  defaultBody,
}: {
  enabled: boolean;
  /** The seller's own words. Empty means the default copy is sent. */
  body: string;
  defaultBody: string;
}) {
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <Panel title={t("autoreply.heading")} description={t("autoreply.body")}>
      <form
        className="flex flex-col gap-4"
        action={(formData) => {
          setError(null);
          startTransition(async () => {
            const result = await saveAutoReply(formData);
            if (result.ok) setNotice(t("autoreply.saved"));
            else setError(result.error);
          });
        }}
      >
        {error && <Alert tone="bad" live="assertive">{error}</Alert>}

        <Checkbox
          name="autoReplyEnabled"
          defaultChecked={enabled}
          label={t("autoreply.enabled")}
        />

        {/*
          The most consequential correction in either screen, on the screen that
          would otherwise imply the opposite. If a template stamped the first
          reply, the band on every storefront and the reply-time weight in
          ranking would both be won by installing one.
        */}
        <p className="max-w-prose rounded-ctl border border-warn-line bg-warn-surface px-3 py-2 text-caption text-warn-ink">
          {t("autoreply.not_a_reply")}
        </p>

        <label className="flex flex-col gap-1">
          <span className="text-body-sm text-ink">{t("autoreply.template")}</span>
          <Textarea name="autoReplyBody" rows={4} defaultValue={body} placeholder={defaultBody} />
          <span className="text-caption text-muted">
            {/*
              The tokens travel as parameters rather than sitting in the string,
              because `t()` would read the braces as its own placeholders and
              report three missing parameters in production.
            */}
            {t("autoreply.tokens", {
              buyerToken: "{buyer_name}",
              openToken: "{next_open_time}",
              phoneToken: "{whatsapp_number}",
            })}
          </span>
        </label>

        <p className="max-w-prose text-caption text-muted">{t("autoreply.hours_source")}</p>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            {t("autoreply.save")}
          </Button>
          <span aria-live="polite" className="text-body-sm text-muted">
            {notice}
          </span>
        </div>
      </form>
    </Panel>
  );
}
