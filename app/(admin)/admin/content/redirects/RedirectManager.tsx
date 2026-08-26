"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/display";
import { Button, Input, Label, Textarea } from "@/components/primitives";
import { DataTable, Panel, type Column } from "@/components/structure";
import { t } from "@/lib/i18n";
import type { ActionResult } from "./actions";

/** Board 12g — the redirects nobody wrote automatically. */

export interface RedirectRowView {
  id: string;
  fromPath: string;
  toPath: string;
  statusCode: string;
  businessName: string;
  added: string;
}

const MIN_REASON = 4;

export function RedirectManager({
  rows,
  create,
  remove,
}: {
  rows: readonly RedirectRowView[];
  create: (formData: FormData) => Promise<ActionResult>;
  remove: (formData: FormData) => Promise<ActionResult>;
}) {
  const [fromPath, setFrom] = useState("");
  const [toPath, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const ready = reason.trim().length >= MIN_REASON;

  function send(action: (formData: FormData) => Promise<ActionResult>, fields: Record<string, string>) {
    const form = new FormData();
    form.set("reason", reason);
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    startTransition(async () => {
      const outcome = await action(form);
      setResult(outcome);
      if (outcome.ok) {
        setReason("");
        setFrom("");
        setTo("");
      }
    });
  }

  const columns: Column<RedirectRowView>[] = [
    { key: "from", header: t("redirects.col.from"), mono: true, render: (row) => row.fromPath },
    { key: "to", header: t("redirects.col.to"), mono: true, render: (row) => row.toPath },
    {
      key: "code",
      header: t("redirects.col.code"),
      numeric: true,
      width: "5rem",
      render: (row) => row.statusCode,
    },
    {
      key: "business",
      header: t("redirects.col.business"),
      hideBelow: "md",
      render: (row) => row.businessName,
    },
    {
      key: "added",
      header: t("redirects.col.added"),
      mono: true,
      width: "8rem",
      hideBelow: "lg",
      render: (row) => row.added,
    },
  ];

  return (
    <div className="flex flex-col gap-[var(--gutter)]">
      {result && (
        <Alert tone={result.ok ? "ok" : "bad"} live="assertive">
          {result.ok ? result.message : result.error}
        </Alert>
      )}

      <Panel title={t("redirects.add")} description={t("redirects.add_hint")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="from-path" hint={t("redirects.from_hint")}>
              {t("redirects.from")}
            </Label>
            <Input
              id="from-path"
              mono
              value={fromPath}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="to-path">{t("redirects.to")}</Label>
            <Input id="to-path" mono value={toPath} onChange={(event) => setTo(event.target.value)} />
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-1">
          <Label
            htmlFor="redirect-reason"
            requirement="required"
            requirementLabel={t("field.required")}
          >
            {t("builder.reason_label")}
          </Label>
          <Textarea
            id="redirect-reason"
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>

        <div className="mt-3">
          <Button
            disabled={!ready || pending || !fromPath.trim() || !toPath.trim()}
            onClick={() => send(create, { fromPath, toPath })}
          >
            {t("redirects.create")}
          </Button>
        </div>
      </Panel>

      <DataTable
        caption={t("redirects.caption")}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        stickyHeader
        rowAction={(row) => ({
          label: t("redirects.remove", { path: row.fromPath }),
          onSelect: () => send(remove, { id: row.id }),
        })}
        actionsHeader={t("redirects.col.from")}
        empty={
          <div className="text-center">
            <p className="text-body-sm text-body">{t("redirects.empty")}</p>
          </div>
        }
      />

      <p className="max-w-prose text-caption text-muted">{t("redirects.remove_hint")}</p>
    </div>
  );
}
