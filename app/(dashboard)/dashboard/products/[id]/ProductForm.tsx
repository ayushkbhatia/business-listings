"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { Button, Input, Select, Textarea } from "@/components/primitives";
import { Alert } from "@/components/display";
import { Panel } from "@/components/structure";
import { missingFrom } from "@/lib/catalogue/overlay";
import { isMultiselect, selectedMulti } from "@/lib/products/spec-values";
import type { TemplateField } from "@/lib/spec";
import { t } from "@/lib/i18n";
import type { SaveProductResult } from "../actions";
import { CompletenessCard } from "./CompletenessCard";
import { PreviewRail } from "./PreviewRail";
import { SpecGrid, isGap, type Scope } from "./SpecGrid";
import type { EditorField } from "./fields";

export type { EditorField };

/**
 * Board 3g — one product, and the fields its template says it has.
 *
 * ## Why the Save is explicit, when the design system says autosave
 *
 * docs/design-system.md: "autosave everywhere in the dashboard … explicit Save
 * exists only where a change goes to moderation." This save goes to no
 * moderation queue and is still explicit, because it can be **refused**: board
 * 3h's model is that a product missing a required field is flagged and blocked
 * on its next save. A refused autosave is a save the seller did not know
 * failed, which is worse than a button.
 *
 * ## The disabled button is a courtesy; the server is the guarantee
 *
 * `missingFrom` runs here and in `saveProduct`, from one definition in
 * lib/catalogue/overlay.ts. The button spares the seller a round trip. It is
 * not the fence — a server action is a URL — and the known gap is stated where
 * the predicate lives: a `requiredFrom` that passes while this tab sits open
 * leaves Save enabled until the page re-renders, and the server refuses it.
 *
 * ## The product stays live while it cannot be saved
 *
 * That is deliberate and it is the surprising half. A new requirement never
 * delists anything; it bites at the next edit. So the publish pill above still
 * reads Live while the card below says saving is blocked, and the copy says so
 * out loud rather than leaving the seller to reconcile two signals.
 *
 * There is no price input, and no branch that could add one.
 */

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
  /** The buyer's own resolved field set, for the rail. */
  previewFields: readonly TemplateField[];
  /** Editor fields with no row on the buyer's page — the seller's own. */
  ownFieldCount: number;
  /** Board 3h, for `Edit your template` and the required-set explanation. */
  templateHref: string;
  action: (formData: FormData) => Promise<SaveProductResult>;
}

export function ProductForm(props: ProductFormProps) {
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("all");
  const formRef = useRef<HTMLFormElement>(null);

  /*
     One state object for every spec value, controlled.

     Not `defaultValue`: the scope chips hide fields rather than unmounting
     them, but a remount for any other reason would reseed an uncontrolled input
     from props and silently drop whatever had been typed into it.
  */
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(props.fields.map((field) => [field.fieldId, field.value])),
  );

  const fieldDomId = (fieldId: string) => `spec-${fieldId}`;

  const missing = useMemo(
    () =>
      missingFrom(
        props.fields.map((field) => ({
          fieldId: field.fieldId,
          label: field.label,
          requiredNow: field.requiredNow,
        })),
        // The same shape the server merges into `specValues`, so the two
        // answers about one product come from one predicate over one input.
        Object.fromEntries(
          props.fields.map((field) => {
            const raw = values[field.fieldId] ?? "";
            return [field.fieldId, isMultiselect(field.type) ? selectedMulti(raw) : raw];
          }),
        ),
      ),
    [props.fields, values],
  );

  const gaps = props.fields.filter((field) => isGap(field, values));
  const filterableGaps = gaps.filter((field) => field.facet === "platform").length;
  const filled = props.fields.length - gaps.length;

  /**
   * Reach the first field that is blocking the save.
   *
   * The scope resets first, and that is not tidiness: a `hidden` element is out
   * of the accessibility tree and cannot take focus, so a required field that
   * is not a facet is unreachable while the Filterable chip is on. Focus, not
   * scroll — CLAUDE.md's pre-flight list is a keyboard pass, and a scrolled-to
   * field a keyboard user is not standing in has not been reached.
   */
  function goToFirstMissing() {
    setScope("all");
    const target = props.fields.find(
      (field) => field.requiredNow && missing.missing.includes(field.label),
    );
    if (!target) return;
    requestAnimationFrame(() => {
      const el = formRef.current?.querySelector<HTMLElement>(`#${CSS.escape(fieldDomId(target.fieldId))}`);
      el?.focus();
      el?.scrollIntoView({ block: "center" });
    });
  }

  function goToGaps() {
    setScope("gaps");
  }

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
    <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <input type="hidden" name="id" value={props.id} />

      {error && (
        <Alert tone="bad" live="assertive">
          {error}
        </Alert>
      )}

      {/*
        The rail sits beside the work at 1440 and below it under that, which is
        also the order a screen reader and a keyboard get: the boxes first, the
        preview of what they produce second.
      */}
      <div className="flex flex-col gap-5 min-[1440px]:flex-row min-[1440px]:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-5">
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
              Said out loud rather than left as an absence. A supplier looking
              for the price field will look for it, and the sentence is the
              answer.
            */}
            <p className="mt-4 max-w-prose rounded-ctl border border-line bg-paper-sunk px-3 py-2 text-caption text-muted">
              {t("product.no_price_here")}
            </p>
          </Panel>

          <Panel
            title={t("product.specs")}
            description={t("product.specs_hint")}
            actions={
              <Link
                href={props.templateHref}
                className="rounded-tag text-caption text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
              >
                {t("product.template_link")}
              </Link>
            }
          >
            <SpecGrid
              fields={props.fields}
              values={values}
              onChange={(fieldId, value) =>
                setValues((current) => ({ ...current, [fieldId]: value }))
              }
              scope={scope}
              onScope={setScope}
              fieldDomId={fieldDomId}
            />

            {/*
              Where a field the template does not have goes.

              A link, not a write. `saveDraft` replaces the whole overlay rather
              than merging into it, so a partial post from here would erase every
              override it did not carry — the same failure class as the spec-value
              bug, one layer up. And the seller thinks they are annotating one
              product when they are changing a definition every product on the
              template shares.
            */}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-ctl border border-dashed border-line-strong px-3 py-3">
              <p className="max-w-prose text-caption text-muted">{t("product.add_field_body")}</p>
              <Link
                href={props.templateHref}
                className="rounded-tag text-caption text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
              >
                {t("product.add_field_link")}
              </Link>
            </div>
          </Panel>
        </div>

        <aside className="flex w-full shrink-0 flex-col gap-5 min-[1440px]:w-[400px]">
          <PreviewRail
            fields={props.previewFields}
            values={values}
            ownFieldCount={props.ownFieldCount}
            isDraft={props.status === "draft"}
          />
          <CompletenessCard
            filled={filled}
            total={props.fields.length}
            filterableGaps={filterableGaps}
            missing={missing.missing}
            onGoToGaps={goToGaps}
            templateHref={props.templateHref}
          />
        </aside>
      </div>

      <div className="flex flex-col gap-3">
        {!missing.ok && (
          /*
            `action` is not decoration: Alert refuses a warn tone with neither
            an action nor a fix, so the component itself enforces the rule that
            a blocked save names a way out in one click.
          */
          <Alert
            tone="warn"
            action={
              <Button type="button" variant="secondary" size="sm" onClick={goToFirstMissing}>
                {t("product.go_to_first_missing")}
              </Button>
            }
          >
            {t("product.save_blocked", { fields: missing.missing.join(", ") })}
          </Alert>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending || !missing.ok}>
            {t("product.save")}
          </Button>
          <span aria-live="polite" className="text-body-sm text-muted">
            {notice}
          </span>
        </div>
      </div>
    </form>
  );
}
