"use client";

import { useState, useTransition } from "react";
import { Button, Checkbox, Input } from "@/components/primitives";
import { Tag } from "@/components/display";
import { Modal } from "@/components/structure";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { SaveTemplateActionResult } from "../products/actions";

/**
 * Board 3h — the seller's spec template.
 *
 * Criterion 6: "renaming a cloned field warns before saving and keeps the
 * mapping". The keeping is structural — the label is a value and the platform
 * field id is the key it hangs off, so a rename physically cannot drop it — and
 * the warning is here, because a seller does not know that.
 *
 * What the warning says matters more than that it exists. The fear when
 * renaming a field is that the products already filled in against it lose their
 * values, so the sentence names how many products are affected and says they
 * keep them. "Are you sure?" would answer nothing.
 */

export interface TemplateFieldRow {
  platformFieldId: string;
  platformLabel: string;
  label: string;
  isFilterable: boolean;
  hidden: boolean;
  /** How many of this seller's products have a value for it. */
  productCount: number;
}

export interface TemplateFormProps {
  sellerTemplateId: string;
  fields: readonly TemplateFieldRow[];
  action: (formData: FormData) => Promise<SaveTemplateActionResult>;
}

export function TemplateForm({ sellerTemplateId, fields, action }: TemplateFormProps) {
  const [labels, setLabels] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.platformFieldId, f.label])),
  );
  const [hidden, setHidden] = useState<Record<string, boolean>>(
    Object.fromEntries(fields.map((f) => [f.platformFieldId, f.hidden])),
  );
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const renames = fields.filter(
    (field) => (labels[field.platformFieldId] ?? field.label).trim() !== field.platformLabel,
  );

  function submit() {
    const form = new FormData();
    form.set("sellerTemplateId", sellerTemplateId);
    for (const field of fields) {
      form.append("fieldId", field.platformFieldId);
      form.set(`label.${field.platformFieldId}`, labels[field.platformFieldId] ?? field.label);
      if (hidden[field.platformFieldId]) form.set(`hidden.${field.platformFieldId}`, "on");
    }

    setError(null);
    setConfirming(false);
    startTransition(async () => {
      const result = await action(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice(
        result.renamed > 0
          ? t("template.saved", { count: formatCount(result.renamed) })
          : t("template.saved_none"),
      );
    });
  }

  function onSave() {
    // Warn only where there is something to warn about. A save that changed
    // nothing but a hidden toggle does not need a modal in front of it.
    if (renames.length > 0) setConfirming(true);
    else submit();
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div
          role="alert"
          className="rounded-ctl border border-bad-line bg-bad-surface px-3 py-2 text-body-sm text-bad-ink"
        >
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-card border border-line bg-card">
        <div className="overflow-x-auto contain-paint">
          <table className="w-full min-w-[46rem] border-collapse text-left">
            <caption className="sr-only">{t("template.caption")}</caption>
            <thead>
              <tr className="bg-paper-sunk">
                <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">
                  {t("template.col_yours")}
                </th>
                <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">
                  {t("template.col_ours")}
                </th>
                <th scope="col" className="w-24 px-3 py-2 text-caption font-normal text-muted">
                  {t("template.col_filter")}
                </th>
                <th scope="col" className="w-24 px-3 py-2 text-caption font-normal text-muted">
                  {t("template.col_hidden")}
                </th>
              </tr>
            </thead>
            <tbody>
              {fields.map((field) => (
                <tr key={field.platformFieldId} className="border-t border-line align-middle">
                  <td className="px-3 py-2">
                    <Input
                      size="sm"
                      aria-label={t("template.label_for", { field: field.platformLabel })}
                      value={labels[field.platformFieldId] ?? field.label}
                      onChange={(e) =>
                        setLabels((current) => ({
                          ...current,
                          [field.platformFieldId]: e.target.value,
                        }))
                      }
                    />
                  </td>
                  {/*
                    Always shown, never hidden behind a tooltip. The pairing is
                    the thing that makes a rename safe, and a seller who cannot
                    see it has no reason to believe it.
                  */}
                  <th scope="row" className="px-3 py-2 text-left font-normal">
                    <span className="font-mono text-caption text-muted">
                      {field.platformLabel}
                    </span>
                  </th>
                  <td className="px-3 py-2">
                    {field.isFilterable ? (
                      <Tag mono size="sm">
                        {t("template.filter_yes")}
                      </Tag>
                    ) : (
                      <span className="text-caption text-faint">{t("template.filter_no")}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Checkbox
                      checked={hidden[field.platformFieldId] ?? false}
                      aria-label={t("template.hidden_label", { field: field.platformLabel })}
                      onChange={(e) =>
                        setHidden((current) => ({
                          ...current,
                          [field.platformFieldId]: e.target.checked,
                        }))
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onSave} disabled={pending}>
          {t("template.save")}
        </Button>
        <span aria-live="polite" className="text-body-sm text-muted">
          {notice}
        </span>
      </div>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t("template.save")}
        closeLabel={t("template.cancel")}
        footer={
          <div className="flex flex-wrap gap-2">
            <Button onClick={submit}>{t("template.confirm")}</Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {t("template.cancel")}
            </Button>
          </div>
        }
      >
        <ul className="space-y-3">
          {renames.map((field) => {
            const to = (labels[field.platformFieldId] ?? field.label).trim();
            return (
              <li key={field.platformFieldId} className="max-w-prose text-body-sm text-prose">
                {field.productCount > 0
                  ? t("template.rename_warning", {
                      from: field.platformLabel,
                      to,
                      count: formatCount(field.productCount),
                    })
                  : t("template.rename_warning_none", { from: field.platformLabel, to })}
              </li>
            );
          })}
        </ul>
      </Modal>
    </div>
  );
}
