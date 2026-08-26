"use client";

import { useState, useTransition } from "react";
import { Alert, StatusBadge } from "@/components/display";
import { Button, Input, Label } from "@/components/primitives";
import { Panel } from "@/components/structure";
import { t } from "@/lib/i18n";
import type { ActionResult } from "./actions";

/**
 * Board 5e, from the seller's side.
 *
 * The two records, their statuses independently, and a way to send them to
 * whoever runs the DNS. Most SME owners do not, which is why the email button
 * is on the board and is not a nicety.
 *
 * `Waiting` is a neutral tone, not a warning. A record that has not propagated
 * yet is the normal state for the first hour and colouring it amber tells
 * somebody to go and fix something that is not broken.
 */

export interface DomainRecordView {
  type: string;
  name: string;
  value: string;
  state: string;
}

export interface DomainPanelProps {
  hostname: string | null;
  status: string;
  records: DomainRecordView[];
  failureCause: string | null;
  certificateLive: boolean;
  lastChecked: string | null;
  mailtoHref: string;
  claim: (formData: FormData) => Promise<ActionResult>;
  drop: () => Promise<ActionResult>;
}

const RECORD_TONE: Record<string, "ok" | "warn" | "bad" | "neutral"> = {
  found: "ok",
  waiting: "neutral",
  wrong_value: "bad",
};

const STATUS_TONE: Record<string, "ok" | "warn" | "bad" | "neutral"> = {
  pending: "neutral",
  partial: "neutral",
  verified: "ok",
  failed: "bad",
  revoked: "warn",
};

export function DomainPanel({
  hostname,
  status,
  records,
  failureCause,
  certificateLive,
  lastChecked,
  mailtoHref,
  claim,
  drop,
}: DomainPanelProps) {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function send(action: () => Promise<ActionResult>) {
    startTransition(async () => setResult(await action()));
  }

  if (!hostname) {
    return (
      <Panel title={t("domain.add_title")} description={t("domain.add_hint")}>
        {result && !result.ok && (
          <div className="mb-3">
            <Alert tone="bad" live="assertive">
              {result.error}
            </Alert>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <Label htmlFor="hostname" hint={t("domain.hostname_hint")}>
            {t("domain.hostname")}
          </Label>
          <Input
            id="hostname"
            mono
            value={input}
            placeholder="shop.yourcompany.ae"
            onChange={(event) => setInput(event.target.value)}
          />
        </div>
        <div className="mt-3">
          <Button
            disabled={pending || input.trim().length === 0}
            onClick={() => {
              const form = new FormData();
              form.set("hostname", input);
              send(() => claim(form));
            }}
          >
            {t("domain.add")}
          </Button>
        </div>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-[var(--gutter)]">
      {result && (
        <Alert tone={result.ok ? "ok" : "bad"} live="assertive">
          {result.ok ? (result.message ?? "") : result.error}
        </Alert>
      )}

      <Panel
        title={hostname}
        actions={<StatusBadge tone={STATUS_TONE[status] ?? "neutral"}>{t(`domain.status.${status}` as never)}</StatusBadge>}
      >
        <p className="max-w-prose text-body-sm text-prose">
          {t(`domain.explain.${status}` as never)}
        </p>

        {failureCause && (
          <div className="mt-3">
            {/*
              The likely cause, named. "DNS lookup failed" is not something a
              seller can act on; "the CNAME is there and the TXT record is not"
              tells them which line to go and add.
            */}
            <Alert tone="bad" live="off" fix={t(`domain.cause.${failureCause}` as never)}>
              {t("domain.failed_lead")}
            </Alert>
          </div>
        )}

        {status === "verified" && !certificateLive && (
          <div className="mt-3">
            {/*
              The records are right and the certificate is not issued. Saying so
              is the whole reason the issuer carries a `live` flag — a padlock
              here would be a claim about TLS nothing has been asked to provide.
            */}
            <Alert tone="warn" live="off" fix={t("domain.no_issuer_fix")}>
              {t("domain.no_issuer")}
            </Alert>
          </div>
        )}

        <table className="mt-4 w-full border-collapse text-body-sm">
          <caption className="sr-only">{t("domain.records_caption")}</caption>
          <thead>
            <tr>
              <th scope="col" className="border-b border-line px-2 py-2 text-start font-mono text-eyebrow uppercase text-muted">
                {t("domain.col.type")}
              </th>
              <th scope="col" className="border-b border-line px-2 py-2 text-start font-mono text-eyebrow uppercase text-muted">
                {t("domain.col.name")}
              </th>
              <th scope="col" className="border-b border-line px-2 py-2 text-start font-mono text-eyebrow uppercase text-muted">
                {t("domain.col.value")}
              </th>
              <th scope="col" className="border-b border-line px-2 py-2 text-start font-mono text-eyebrow uppercase text-muted">
                {t("domain.col.state")}
              </th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={`${record.type}-${record.name}`}>
                <th scope="row" className="border-b border-line px-2 py-2 text-start font-mono text-caption text-ink">
                  {record.type}
                </th>
                <td className="border-b border-line px-2 py-2 font-mono text-caption text-ink">
                  {record.name}
                </td>
                <td className="border-b border-line px-2 py-2 font-mono text-caption text-ink">
                  {record.value}
                </td>
                <td className="border-b border-line px-2 py-2">
                  {/* Per record, independently. Partial propagation is normal. */}
                  <StatusBadge tone={RECORD_TONE[record.state] ?? "neutral"} size="sm">
                    {t(`domain.record.${record.state}` as never)}
                  </StatusBadge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {lastChecked && (
          <p className="mt-2 font-mono text-eyebrow text-faint">
            {t("domain.last_checked", { when: lastChecked })}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {/*
            A real button, because most SME owners do not run their own DNS.
            A mailto rather than us sending it: the message goes from the
            seller, to somebody who will recognise their name.
          */}
          <a
            href={mailtoHref}
            className="rounded-ctl border border-line-strong px-3 py-2 text-body-sm text-ink hover:border-moss focus-visible:outline-none focus-visible:shadow-focus"
          >
            {t("domain.email_records")}
          </a>
          <Button variant="secondary" disabled={pending} onClick={() => send(drop)}>
            {t("domain.remove")}
          </Button>
        </div>
      </Panel>

      <p className="max-w-prose text-caption text-muted">{t("domain.both_addresses")}</p>
    </div>
  );
}
