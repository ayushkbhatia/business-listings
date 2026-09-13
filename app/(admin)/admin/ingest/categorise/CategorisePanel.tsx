"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { Alert, StatusBadge } from "@/components/display";
import { Button, Checkbox, Label, SearchField, Select, Textarea } from "@/components/primitives";
import { Modal } from "@/components/structure";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { CategoryOption } from "@/lib/ingest/queue";
import type { ActionResult } from "../actions";

/**
 * One categorisation decision: a category, its trade kind, a reason.
 *
 * Board 12a B7 is the reason this is a dialog with a paragraph in it rather
 * than a dropdown on a row. The category resolves `Category.tradeKind`, which
 * decides whether the business is offered a product catalogue or a scope list
 * — and the onboarding, dashboard and enquiry form that go with each. So the
 * kind the chosen category resolves to is shown the moment it is chosen, with
 * where it came from, and a kind that is only inherited has to be confirmed
 * before the decision can be sent. The service refuses it unconfirmed too; the
 * checkbox is the same rule where a person can see it.
 *
 * Used by the queue, for activities, and by a record's own page, for one
 * record. The copy is the same because the decision is.
 */

const MIN_REASON = 4;

export type PanelTarget =
  | { kind: "activities"; keys: string[]; labels: string[]; records: number; runId?: string | null }
  | { kind: "records"; ids: string[]; labels: string[]; records: number };

export interface CategorisePanelProps {
  open: boolean;
  onClose: () => void;
  target: PanelTarget | null;
  options: readonly CategoryOption[];
  initialCategoryId?: string | null;
  categorise: (formData: FormData) => Promise<ActionResult>;
  onDone: (result: ActionResult) => void;
}

const SHOWN_LABELS = 5;

export function CategorisePanel({
  open,
  onClose,
  target,
  options,
  initialCategoryId = null,
  categorise,
  onDone,
}: CategorisePanelProps) {
  const ids = { category: useId(), reason: useId() };
  const [filter, setFilter] = useState("");
  const [categoryId, setCategoryId] = useState(initialCategoryId ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [remember, setRemember] = useState(target?.kind === "activities");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const chosen = options.find((option) => option.id === categoryId) ?? null;

  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const bySector = new Map<string, { label: string; value: string }[]>();
    for (const option of options) {
      const sector = option.sectorName ?? option.name;
      if (
        needle &&
        !option.name.toLowerCase().includes(needle) &&
        !sector.toLowerCase().includes(needle) &&
        option.id !== categoryId
      ) {
        continue;
      }
      const list = bySector.get(sector) ?? [];
      list.push({ value: option.id, label: option.name });
      bySector.set(sector, list);
    }
    return [...bySector.entries()].map(([label, list]) => ({ label, options: list }));
  }, [options, filter, categoryId]);

  const blockedByDefault = chosen?.from === "default";
  const needsConfirm = chosen?.from === "inherited";
  const ready =
    !!chosen && !blockedByDefault && (!needsConfirm || confirmed) && reason.trim().length >= MIN_REASON;

  function close() {
    if (pending) return;
    setError(null);
    onClose();
  }

  function send() {
    if (!target || !chosen) return;
    const form = new FormData();
    form.set("categoryId", chosen.id);
    form.set("reason", reason);
    if (remember) form.set("remember", "on");
    if (confirmed) form.set("confirmInherited", "on");
    if (target.kind === "activities") {
      for (const key of target.keys) form.append("key", key);
      if (target.runId) form.set("runId", target.runId);
    } else {
      for (const id of target.ids) form.append("id", id);
    }
    startTransition(async () => {
      const result = await categorise(form);
      if (result.ok) {
        setReason("");
        setConfirmed(false);
        setError(null);
        onDone(result);
      } else {
        setError(result.error);
      }
    });
  }

  if (!target) return null;

  const kindWord = chosen ? t(`admin.categorise.kind_word.${chosen.kind}`) : "";
  const count = { count: target.records, n: formatCount(target.records) };

  return (
    <Modal
      open={open}
      onClose={close}
      title={t("admin.categorise.panel_title", count)}
      description={t("admin.categorise.panel_description")}
      closeLabel={t("action.cancel")}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={pending}>
            {t("action.cancel")}
          </Button>
          <Button loading={pending} disabled={!ready || pending} onClick={send}>
            {t("admin.categorise.confirm", count)}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <p className="font-mono text-eyebrow uppercase text-body">{t("admin.categorise.panel_activities")}</p>
          <ul className="mt-1 flex flex-col gap-0.5 text-body-sm text-ink">
            {target.labels.slice(0, SHOWN_LABELS).map((label, index) => (
              <li key={`${label}-${index}`}>{label}</li>
            ))}
            {target.labels.length > SHOWN_LABELS && (
              <li className="text-caption text-body">+{formatCount(target.labels.length - SHOWN_LABELS)}</li>
            )}
          </ul>
        </div>

        <div className="flex flex-col gap-2">
          <Label
            htmlFor={ids.category}
            requirement="required"
            requirementLabel={t("field.required")}
            hint={t("admin.categorise.category_hint")}
          >
            {t("admin.categorise.category")}
          </Label>
          <SearchField
            size="sm"
            label={t("admin.categorise.category_filter")}
            clearLabel={t("admin.categorise.clear")}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onClear={() => setFilter("")}
          />
          <Select
            id={ids.category}
            value={categoryId}
            placeholder={t("admin.categorise.category_placeholder")}
            onChange={(event) => {
              setCategoryId(event.target.value);
              setConfirmed(false);
            }}
            options={[]}
            groups={groups}
          />
          {groups.length === 0 && (
            <p className="text-caption text-body">{t("admin.categorise.category_none_match")}</p>
          )}
        </div>

        {chosen && (
          <div className="flex flex-col gap-2" aria-live="polite">
            <p className="flex flex-wrap items-center gap-2 text-body-sm text-body">
              <StatusBadge tone={chosen.kind === "services" ? "info" : "neutral"}>
                {t(`admin.categorise.kind.${chosen.kind}`)}
              </StatusBadge>
              {chosen.from === "own" && <span>{t("admin.categorise.kind_own")}</span>}
            </p>
            {needsConfirm && (
              <Alert
                tone="warn"
                action={
                  <Checkbox
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                    label={t("admin.categorise.confirm_inherited", { kind: kindWord })}
                  />
                }
              >
                {t("admin.categorise.kind_inherited", {
                  category: chosen.name,
                  kind: kindWord,
                  ancestor: chosen.inheritedFrom ?? chosen.sectorName ?? "",
                })}
              </Alert>
            )}
            {blockedByDefault && (
              <Alert tone="bad" fix={t("admin.categorise.kind_default_fix")}>
                {t("admin.categorise.kind_default", { category: chosen.name })}
              </Alert>
            )}
          </div>
        )}

        <Checkbox
          checked={remember}
          onChange={(event) => setRemember(event.target.checked)}
          label={t("admin.categorise.remember")}
          description={t("admin.categorise.remember_hint")}
        />

        <div className="flex flex-col gap-1">
          <Label
            htmlFor={ids.reason}
            requirement="required"
            requirementLabel={t("field.required")}
            hint={t("admin.ingest.reason_hint")}
          >
            {t("admin.review.reason_label")}
          </Label>
          <Textarea id={ids.reason} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
        </div>

        {error && (
          <Alert tone="bad" live="assertive" fix={t("admin.ingest.reason_hint")}>
            {error}
          </Alert>
        )}
      </div>
    </Modal>
  );
}
