"use client";

import { useState, useTransition } from "react";
import { Alert, StatusBadge, Tag } from "@/components/display";
import { Button, Label, Textarea } from "@/components/primitives";
import { DataTable, Panel, type Column } from "@/components/structure";
import { countWords } from "@/lib/publish-threshold";
import { formatCount } from "@/lib/format";
import type { MatrixGate } from "@/lib/content/matrix";
import { t } from "@/lib/i18n";
import type { ActionResult } from "./actions";

/**
 * Board 6f — every landing page and whether it has anything on it.
 *
 * The failing column is ordered by what somebody would do about it, and copy
 * comes first: it is the only one of the three gates that is a decision rather
 * than a wait. More listings and more verifications arrive on their own
 * schedule; a paragraph does not.
 */

export interface MatrixRowView {
  id: string;
  path: string;
  name: string;
  parentName: string | null;
  listings: string;
  verifiedShare: string;
  introWords: number;
  intro: string | null;
  publishable: boolean;
  failing: MatrixGate[];
}

const MIN_REASON = 4;
const MIN_WORDS = 250;

export function MatrixTable({
  rows,
  save,
}: {
  rows: readonly MatrixRowView[];
  save: (formData: FormData) => Promise<ActionResult>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [intro, setIntro] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const editing = rows.find((row) => row.id === editingId) ?? null;
  const words = countWords(intro);
  const ready = reason.trim().length >= MIN_REASON;

  function submit() {
    if (!editing) return;
    const form = new FormData();
    form.set("categoryId", editing.id);
    form.set("intro", intro);
    form.set("reason", reason);
    startTransition(async () => {
      const outcome = await save(form);
      setResult(outcome);
      if (outcome.ok) {
        setEditingId(null);
        setReason("");
      }
    });
  }

  const columns: Column<MatrixRowView>[] = [
    {
      key: "path",
      header: t("matrix.col.path"),
      mono: true,
      render: (row) => row.path,
    },
    {
      key: "name",
      header: t("matrix.col.name"),
      render: (row) =>
        row.parentName ? (
          <span>
            <span className="text-muted">{row.parentName} · </span>
            {row.name}
          </span>
        ) : (
          row.name
        ),
    },
    {
      key: "listings",
      header: t("matrix.col.listings"),
      numeric: true,
      width: "7rem",
      render: (row) => row.listings,
    },
    {
      key: "verified",
      header: t("matrix.col.verified"),
      numeric: true,
      width: "7rem",
      render: (row) => row.verifiedShare,
    },
    {
      key: "words",
      header: t("matrix.col.words"),
      numeric: true,
      width: "7rem",
      render: (row) => (
        <span className={row.introWords >= MIN_WORDS ? "text-ink" : "text-bad-ink"}>
          {formatCount(row.introWords)}
        </span>
      ),
    },
    {
      key: "state",
      header: t("matrix.col.state"),
      width: "14rem",
      render: (row) =>
        row.publishable ? (
          <StatusBadge tone="ok">{t("matrix.publishes")}</StatusBadge>
        ) : (
          <span className="flex flex-wrap gap-1">
            {row.failing.map((gate) => (
              <Tag key={gate} size="sm">
                {t(`matrix.gate.${gate}` as never)}
              </Tag>
            ))}
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
        caption={t("matrix.caption")}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        stickyHeader
        rowAction={(row) => ({
          label: t("matrix.write", { page: row.name }),
          onSelect: () => {
            setEditingId(row.id);
            setIntro(row.intro ?? "");
            setResult(null);
          },
        })}
        actionsHeader={t("matrix.col.name")}
        empty={
          <div className="text-center">
            <p className="text-body-sm text-body">{t("matrix.empty")}</p>
          </div>
        }
      />

      {editing && (
        <Panel title={t("matrix.write", { page: editing.name })} description={editing.path}>
          <div className="flex flex-col gap-1">
            <Label htmlFor="matrix-intro" hint={t("matrix.intro_hint")}>
              {t("matrix.intro")}
            </Label>
            <Textarea
              id="matrix-intro"
              rows={8}
              value={intro}
              onChange={(event) => setIntro(event.target.value)}
            />
            <p
              className={
                words >= MIN_WORDS
                  ? "font-mono text-eyebrow text-ok-ink"
                  : "font-mono text-eyebrow text-muted"
              }
            >
              {t("matrix.word_count", { count: formatCount(words) })}
            </p>
          </div>

          <div className="mt-3 flex flex-col gap-1">
            <Label
              htmlFor="matrix-reason"
              requirement="required"
              requirementLabel={t("field.required")}
              hint={t("matrix.reason_hint")}
            >
              {t("builder.reason_label")}
            </Label>
            <Textarea
              id="matrix-reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button disabled={!ready || pending} onClick={submit}>
              {t("matrix.save")}
            </Button>
            <Button variant="secondary" disabled={pending} onClick={() => setEditingId(null)}>
              {t("action.cancel")}
            </Button>
          </div>
        </Panel>
      )}
    </div>
  );
}
