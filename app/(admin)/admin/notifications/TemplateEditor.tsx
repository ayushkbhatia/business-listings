"use client";

import { useState, useTransition } from "react";
import { Alert, StatusBadge, Tag } from "@/components/display";
import { Button, Input, Label, Textarea } from "@/components/primitives";
import { DataTable, Panel, type Column } from "@/components/structure";
import { placeholdersIn } from "@/lib/notify/params";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { ActionResult } from "./actions";

/**
 * Board 12g — the notification templates.
 *
 * The check that matters runs as you type: a placeholder this event does not
 * supply is a `MissingParamError` at send time, which is a seller not being
 * told something. It found a real one in the seeded copy — the accepted-quote
 * email asked for `{ref}` and the emitter supplied `{quoteRef}`.
 */

export interface TemplateRowView {
  id: string;
  event: string;
  channel: string;
  version: number;
  status: string;
  subject: string | null;
  body: string;
  actionLabel: string | null;
  actionPath: string | null;
  metaTemplateName: string | null;
  unknown: string[];
  available: string[];
  emitted: boolean;
}

const MIN_REASON = 4;

const TONE: Record<string, "ok" | "warn" | "neutral"> = {
  live: "ok",
  draft: "warn",
  pending_meta: "warn",
  retired: "neutral",
};

export function TemplateEditor({
  rows,
  save,
  promote,
}: {
  rows: readonly TemplateRowView[];
  save: (formData: FormData) => Promise<ActionResult>;
  promote: (formData: FormData) => Promise<ActionResult>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TemplateRowView | null>(null);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const editing = draft?.id === editingId ? draft : (rows.find((r) => r.id === editingId) ?? null);
  const ready = reason.trim().length >= MIN_REASON;

  const used = editing
    ? placeholdersIn(editing.body, editing.subject, editing.actionLabel)
    : [];
  const unknown = editing ? used.filter((name) => !editing.available.includes(name)) : [];

  function send(action: (formData: FormData) => Promise<ActionResult>, extra: Record<string, string> = {}) {
    if (!editing) return;
    const form = new FormData();
    form.set("templateId", editing.id);
    form.set("reason", reason);
    for (const [key, value] of Object.entries(extra)) form.set(key, value);
    startTransition(async () => {
      const outcome = await action(form);
      setResult(outcome);
      if (outcome.ok) {
        setReason("");
        setEditingId(null);
      }
    });
  }

  const columns: Column<TemplateRowView>[] = [
    {
      key: "event",
      header: t("notifications.col.event"),
      render: (row) => (
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-caption">{row.event}</span>
          {!row.emitted && <Tag size="sm">{t("notifications.dormant")}</Tag>}
        </span>
      ),
    },
    {
      key: "channel",
      header: t("notifications.col.channel"),
      mono: true,
      width: "8rem",
      render: (row) => row.channel,
    },
    {
      key: "version",
      header: t("notifications.col.version"),
      numeric: true,
      width: "6rem",
      render: (row) => `v${row.version}`,
    },
    {
      key: "status",
      header: t("notifications.col.status"),
      width: "9rem",
      render: (row) => (
        <StatusBadge tone={TONE[row.status] ?? "neutral"}>
          {t(`notifications.status.${row.status}` as never)}
        </StatusBadge>
      ),
    },
    {
      key: "body",
      header: t("notifications.col.body"),
      render: (row) => (
        <span className="flex flex-col gap-1">
          <span className="line-clamp-2 text-caption text-muted">{row.body}</span>
          {row.unknown.length > 0 && (
            <span className="text-caption text-bad-ink">
              {t("notifications.broken", { count: formatCount(row.unknown.length) })}
            </span>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-[var(--gutter)]">
      {result && (
        <Alert tone={result.ok ? "ok" : "bad"} live="assertive">
          {result.ok ? result.message : result.error}
        </Alert>
      )}

      <DataTable
        caption={t("notifications.caption")}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        stickyHeader
        rowAction={(row) => ({
          label: t("notifications.edit", { event: row.event, channel: row.channel }),
          onSelect: () => {
            setEditingId(row.id);
            setDraft(row);
            setResult(null);
          },
        })}
        actionsHeader={t("notifications.col.event")}
        empty={
          <div className="text-center">
            <p className="text-body-sm text-body">{t("notifications.empty")}</p>
          </div>
        }
      />

      {editing && (
        <Panel
          title={t("notifications.edit", { event: editing.event, channel: editing.channel })}
        >
          {!editing.emitted && (
            <div className="mb-3">
              <Alert tone="info" live="off">
                {t("notifications.dormant_hint")}
              </Alert>
            </div>
          )}

          <p className="font-mono text-eyebrow uppercase text-muted">
            {editing.available.length === 0
              ? t("notifications.available_none")
              : t("notifications.available", { params: editing.available.join(", ") })}
          </p>

          {editing.channel === "email" && (
            <div className="mt-3 flex flex-col gap-1">
              <Label htmlFor="tpl-subject">{t("notifications.subject")}</Label>
              <Input
                id="tpl-subject"
                value={editing.subject ?? ""}
                onChange={(event) => setDraft({ ...editing, subject: event.target.value })}
              />
            </div>
          )}

          <div className="mt-3 flex flex-col gap-1">
            <Label htmlFor="tpl-body">{t("notifications.body")}</Label>
            <Textarea
              id="tpl-body"
              rows={5}
              value={editing.body}
              onChange={(event) => setDraft({ ...editing, body: event.target.value })}
            />
            {unknown.length > 0 && (
              /*
                The whole reason this screen exists. A placeholder the event
                does not supply is a notification that throws instead of
                sending, and a seller who is not told something.
              */
              <p className="text-caption text-bad-ink">
                {t("notifications.unknown", { names: unknown.map((n) => `{${n}}`).join(", ") })}
              </p>
            )}
          </div>

          {editing.channel === "whatsapp" && (
            <div className="mt-3 flex flex-col gap-1">
              <Label htmlFor="tpl-meta" hint={t("notifications.meta_name_hint")}>
                {t("notifications.meta_name")}
              </Label>
              <Input
                id="tpl-meta"
                mono
                value={editing.metaTemplateName ?? ""}
                onChange={(event) =>
                  setDraft({ ...editing, metaTemplateName: event.target.value })
                }
              />
            </div>
          )}

          <div className="mt-4 flex flex-col gap-1">
            <Label
              htmlFor="tpl-reason"
              requirement="required"
              requirementLabel={t("field.required")}
            >
              {t("builder.reason_label")}
            </Label>
            <Textarea
              id="tpl-reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              disabled={!ready || pending || unknown.length > 0}
              onClick={() =>
                send(save, {
                  subject: editing.subject ?? "",
                  body: editing.body,
                  actionLabel: editing.actionLabel ?? "",
                  actionPath: editing.actionPath ?? "",
                  metaTemplateName: editing.metaTemplateName ?? "",
                })
              }
            >
              {t("notifications.save")}
            </Button>

            {editing.status !== "live" && (
              <Button variant="secondary" disabled={!ready || pending} onClick={() => send(promote)}>
                {editing.channel === "whatsapp" && editing.status === "draft"
                  ? t("notifications.submit_meta")
                  : t("notifications.publish")}
              </Button>
            )}

            <Button variant="ghost" disabled={pending} onClick={() => setEditingId(null)}>
              {t("action.cancel")}
            </Button>
          </div>
        </Panel>
      )}
    </div>
  );
}
