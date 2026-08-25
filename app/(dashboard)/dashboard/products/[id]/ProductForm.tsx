"use client";

import { useState, useTransition } from "react";
import { Button, Input, Select, Textarea } from "@/components/primitives";
import { Alert, Tag } from "@/components/display";
import { Panel } from "@/components/structure";
import { t } from "@/lib/i18n";
import type { SaveProductResult } from "../actions";

/**
 * Board 3g — the product editor, driven by the template.
 *
 * The template supplies the rows, not the data, so a field the seller has not
 * filled still appears — the same rule lib/spec.ts applies on the public spec
 * table, for the same reason: a form that hides its empty fields lets a thin
 * product look finished.
 *
 * FILTER is the marker that earns the screen. A seller filling in a body
 * material because it says FILTER next to it is a seller who will be found for
 * "ductile iron", and that is the whole argument for spending an afternoon on
 * a catalogue.
 *
 * There is no price input, and no branch that could add one.
 */

export interface EditorField {
  id: string;
  label: string;
  unit: string | null;
  type: string;
  options: string[];
  isFilterable: boolean;
  value: string;
}

export interface ProductFormProps {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  availability: string;
  status: string;
  stockQty: number | null;
  leadTimeDays: number | null;
  minOrderQty: number | null;
  fields: readonly EditorField[];
  action: (formData: FormData) => Promise<SaveProductResult>;
}

export function ProductForm(props: ProductFormProps) {
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filterable = props.fields.filter((f) => f.isFilterable);
  const filled = filterable.filter((f) => f.value.trim() !== "").length;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await props.action(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice(t("product.saved"));
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <input type="hidden" name="id" value={props.id} />

      {error && (
        <Alert tone="bad" live="assertive">{error}</Alert>
      )}

      <Panel title={t("product.basics")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-body-sm text-ink">{t("product.name_label")}</span>
            <Input name="name" defaultValue={props.name} required />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-body-sm text-ink">{t("product.sku_label")}</span>
            <Input name="sku" mono defaultValue={props.sku ?? ""} aria-describedby="sku-hint" />
            <span id="sku-hint" className="text-caption text-muted">
              {t("product.sku_hint")}
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-body-sm text-ink">{t("product.availability_label")}</span>
            <Select
              name="availability"
              defaultValue={props.availability}
              options={[
                { value: "in_stock", label: t("catalogue.availability.in_stock") },
                { value: "made_to_order", label: t("catalogue.availability.made_to_order") },
                { value: "indent", label: t("catalogue.availability.indent") },
                { value: "out_of_stock", label: t("catalogue.availability.out_of_stock") },
              ]}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-body-sm text-ink">{t("product.stock_label")}</span>
            <Input name="stockQty" mono inputMode="numeric" defaultValue={props.stockQty ?? ""} />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-body-sm text-ink">{t("product.lead_label")}</span>
            <Input
              name="leadTimeDays"
              mono
              inputMode="numeric"
              defaultValue={props.leadTimeDays ?? ""}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-body-sm text-ink">{t("product.moq_label")}</span>
            <Input
              name="minOrderQty"
              mono
              inputMode="numeric"
              defaultValue={props.minOrderQty ?? ""}
              aria-describedby="moq-hint"
            />
            <span id="moq-hint" className="text-caption text-muted">
              {t("product.moq_hint")}
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-body-sm text-ink">{t("product.status_label")}</span>
            <Select
              name="status"
              defaultValue={props.status}
              options={[
                { value: "draft", label: t("catalogue.status.draft") },
                { value: "live", label: t("catalogue.status.live") },
                { value: "out_of_stock", label: t("catalogue.status.out_of_stock") },
              ]}
            />
          </label>

          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-body-sm text-ink">{t("product.description_label")}</span>
            <Textarea name="description" rows={4} defaultValue={props.description ?? ""} />
          </label>
        </div>

        {/*
          Said out loud rather than left as an absence. A supplier looking for
          the price field will look for it, and the sentence is the answer.
        */}
        <p className="mt-4 max-w-prose rounded-ctl border border-line bg-paper-sunk px-3 py-2 text-caption text-muted">
          {t("product.no_price_here")}
        </p>
      </Panel>

      <Panel
        title={t("product.specs")}
        description={t("product.specs_hint")}
        actions={
          <a
            href="/dashboard/templates"
            className="rounded-tag text-caption text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          >
            {t("product.template_link")}
          </a>
        }
        footer={
          filterable.length > 0 ? (
            <p className="text-caption text-muted">
              {t("product.spec_filled", {
                filled: String(filled),
                total: String(filterable.length),
              })}
            </p>
          ) : undefined
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {props.fields.map((field) => (
            <label key={field.id} className="flex flex-col gap-1">
              <span className="flex flex-wrap items-center gap-1.5 text-body-sm text-ink">
                {field.label}
                {field.unit ? <span className="text-caption text-muted">{field.unit}</span> : null}
                {field.isFilterable && (
                  <Tag mono size="sm">
                    {t("import.filter_badge")}
                  </Tag>
                )}
              </span>
              {field.options.length > 0 ? (
                <Select
                  name={`spec.${field.id}`}
                  defaultValue={field.value}
                  placeholder="—"
                  options={field.options.map((option) => ({ value: option, label: option }))}
                />
              ) : (
                <Input
                  name={`spec.${field.id}`}
                  mono={field.type === "number"}
                  defaultValue={field.value}
                />
              )}
            </label>
          ))}
        </div>
      </Panel>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {t("product.save")}
        </Button>
        <span aria-live="polite" className="text-body-sm text-muted">
          {notice}
        </span>
      </div>
    </form>
  );
}
