"use client";

import { useState, useTransition } from "react";
import { Alert, StatusBadge } from "@/components/display";
import { Button, Input } from "@/components/primitives";
import { Panel } from "@/components/structure";
import { t } from "@/lib/i18n";
import type { ChannelActionResult } from "./actions";

/**
 * Board 7e §8.1 — your own channels, and proving one.
 *
 * Without this the amber row on board 7d is a dead end: a seat told it is not a
 * routing target, with nothing on any screen that would make it one.
 *
 * Yours alone. 7d §6.1 — "not show one seat's numbers to another seat" — so this
 * card renders the reader's own addresses and the service takes no parameter
 * that could point it at anybody else. The rail above shows colleagues by kind.
 */
export interface ChannelRow {
  kind: string;
  kindLabel: string;
  address: string;
  verified: boolean;
  awaitingCode: boolean;
}

export interface ChannelsCardProps {
  rows: readonly ChannelRow[];
  /** Kinds a seat can actually prove today. SMS has no carrier. */
  addable: readonly string[];
  smsNote: string | null;
  sendAction: (formData: FormData) => Promise<ChannelActionResult>;
  confirmAction: (formData: FormData) => Promise<ChannelActionResult>;
  removeAction: (formData: FormData) => Promise<ChannelActionResult>;
}

export function ChannelsCard(props: ChannelsCardProps) {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  function run(action: (f: FormData) => Promise<ChannelActionResult>, form: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await action(form);
      if (!result.ok) setError(result.error);
      else setNotice(result.message);
    });
  }

  return (
    <Panel title={t("channels.heading")} description={t("channels.body")}>
      <div className="flex flex-col gap-4">
        {error && <Alert tone="bad" live="assertive">{error}</Alert>}

        <ul className="flex flex-col gap-3">
          {props.rows.map((row) => (
            <li key={row.kind} className="flex flex-col gap-2 border-b border-line pb-3 last:border-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-body-sm text-ink">{row.kindLabel}</span>
                {/*
                  The seat's own address, on the seat's own screen. It is the
                  only place in the product this string is rendered to anybody.
                */}
                <span className="font-mono text-caption text-faint">{row.address}</span>
                <StatusBadge tone={row.verified ? "ok" : "warn"} size="sm" shape="chip">
                  {row.verified ? t("channels.verified") : t("channels.unverified")}
                </StatusBadge>
              </div>

              <div className="flex flex-wrap items-end gap-2">
                {!row.verified && (
                  <>
                    <label className="flex w-40 flex-col gap-1">
                      <span className="text-caption text-muted">{t("channels.code")}</span>
                      <Input
                        mono
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        value={codes[row.kind] ?? ""}
                        onChange={(event) =>
                          setCodes((current) => ({ ...current, [row.kind]: event.target.value }))
                        }
                      />
                    </label>
                    <Button
                      size="sm"
                      disabled={pending || !(codes[row.kind] ?? "").trim()}
                      aria-label={t("channels.confirm_aria", { channel: row.kindLabel })}
                      onClick={() => {
                        const form = new FormData();
                        form.set("kind", row.kind);
                        form.set("code", codes[row.kind] ?? "");
                        run(props.confirmAction, form);
                      }}
                    >
                      {t("channels.confirm")}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => {
                        const form = new FormData();
                        form.set("kind", row.kind);
                        form.set("address", row.address);
                        run(props.sendAction, form);
                      }}
                    >
                      {row.awaitingCode ? t("channels.resend") : t("channels.send_code")}
                    </Button>
                  </>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  aria-label={t("channels.remove_aria", { channel: row.kindLabel })}
                  onClick={() => {
                    const form = new FormData();
                    form.set("kind", row.kind);
                    run(props.removeAction, form);
                  }}
                >
                  {t("channels.remove")}
                </Button>
              </div>
            </li>
          ))}
        </ul>

        <form
          className="flex flex-wrap items-end gap-3 border-t border-line pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            /*
               The kind is sniffed from the address by the same function the
               invite box uses — an `@` means email and a UAE mobile means
               WhatsApp — rather than asked for with a radio. One box, and the
               hint says which way it will go.
            */
            const address = String(form.get("address") ?? "");
            form.set("kind", address.includes("@") ? "email" : "whatsapp");
            run(props.sendAction, form);
            event.currentTarget.reset();
          }}
        >
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-body-sm text-ink">{t("channels.address")}</span>
            <Input name="address" required aria-describedby="channel-hint" />
            <span id="channel-hint" className="text-caption text-muted">
              {t("channels.address_hint")}
            </span>
          </label>
          <Button type="submit" disabled={pending}>
            {t("channels.send_code")}
          </Button>
        </form>

        {props.smsNote && <p className="max-w-prose text-caption text-muted">{props.smsNote}</p>}
        <p className="max-w-prose text-caption text-muted">{t("channels.privacy")}</p>

        {/*
          Always in the DOM, contents only changing. Mounting an aria-live
          element together with its first message is how a confirmation goes
          unannounced in most screen readers.
        */}
        <div aria-live="polite">
          {notice && <p className="text-caption text-muted">{notice}</p>}
        </div>
      </div>
    </Panel>
  );
}
