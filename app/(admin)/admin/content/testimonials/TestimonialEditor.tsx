"use client";

import { useState, useTransition } from "react";
import { Alert, StatusBadge } from "@/components/display";
import { Button, Input, Label, Select, Textarea } from "@/components/primitives";
import { Panel } from "@/components/structure";
import { t } from "@/lib/i18n";
import type { ActionResult } from "./actions";

/**
 * The quotes on the two entry surfaces.
 *
 * Explicit Save rather than autosave, and a reason on every write. §05 puts
 * autosave in the dashboard and explicit Save "where a change goes to
 * moderation"; a quote going on a public page is that, and the audit row it
 * writes needs a sentence a person typed anyway.
 *
 * Publishing is a separate control from saving, for the same reason the guides
 * screen separates them: a draft somebody is still wording should be storable
 * without going live, and the floor is checked on the way out rather than on
 * the way in.
 */

export interface TestimonialRowView {
  id: string;
  audience: "buyer" | "supplier";
  body: string;
  attribution: string;
  context: string;
  sortOrder: number;
  published: boolean;
  words: number;
}

const MIN_REASON = 4;

export function TestimonialEditor({
  rows,
  minWords,
  save,
  publish,
  remove,
}: {
  rows: readonly TestimonialRowView[];
  minWords: number;
  save: (formData: FormData) => Promise<ActionResult>;
  publish: (formData: FormData) => Promise<ActionResult>;
  remove: (formData: FormData) => Promise<ActionResult>;
}) {
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const ready = reason.trim().length >= MIN_REASON;

  function run(action: (formData: FormData) => Promise<ActionResult>, form: FormData) {
    form.set("reason", reason);
    startTransition(async () => {
      const outcome = await action(form);
      setResult(outcome);
      if (outcome.ok) setReason("");
    });
  }

  return (
    <div className="space-y-[var(--gutter)]">
      {result ? (
        <Alert tone={result.ok ? "ok" : "bad"}>
          {result.ok ? result.message : result.error}
        </Alert>
      ) : null}

      <Panel title={t("testimonial.reason")} description={t("testimonial.reason_hint")} padded>
        <Label htmlFor="testimonial-reason">{t("testimonial.reason")}</Label>
        <Textarea
          id="testimonial-reason"
          name="reason"
          rows={2}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Panel>

      {rows.length === 0 ? (
        <Panel title={t("testimonial.empty_title")} padded>
          <p className="max-w-prose text-body-sm text-muted">{t("testimonial.empty_body")}</p>
        </Panel>
      ) : null}

      {rows.map((row) => (
        <QuoteForm
          key={row.id}
          row={row}
          minWords={minWords}
          disabled={!ready || pending}
          onSave={(form) => run(save, form)}
          onPublish={(form) => run(publish, form)}
          onRemove={(form) => run(remove, form)}
        />
      ))}

      <QuoteForm
        minWords={minWords}
        disabled={!ready || pending}
        onSave={(form) => run(save, form)}
      />
    </div>
  );
}

function QuoteForm({
  row,
  minWords,
  disabled,
  onSave,
  onPublish,
  onRemove,
}: {
  row?: TestimonialRowView;
  minWords: number;
  disabled: boolean;
  onSave: (formData: FormData) => void;
  onPublish?: (formData: FormData) => void;
  onRemove?: (formData: FormData) => void;
}) {
  const id = row?.id ?? "new";

  function collect(form: HTMLFormElement): FormData {
    const data = new FormData(form);
    if (row) data.set("id", row.id);
    return data;
  }

  return (
    <Panel
      title={row ? row.attribution : t("testimonial.add")}
      eyebrow={row ? t(`testimonial.audience_${row.audience}` as never) : undefined}
      actions={
        row ? (
          <div className="flex items-center gap-2">
            <StatusBadge tone={row.published ? "ok" : "info"}>
              {row.published ? t("testimonial.published") : t("testimonial.draft")}
            </StatusBadge>
            <span className="font-mono text-caption tabular-nums text-muted">
              {t("testimonial.words", { count: row.words })}
            </span>
          </div>
        ) : undefined
      }
      padded
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(collect(event.currentTarget));
        }}
      >
        <div>
          <Label htmlFor={`audience-${id}`}>{t("testimonial.audience")}</Label>
          <Select
            id={`audience-${id}`}
            name="audience"
            defaultValue={row?.audience ?? "buyer"}
            options={[
              { value: "buyer", label: t("testimonial.audience_buyer") },
              { value: "supplier", label: t("testimonial.audience_supplier") },
            ]}
          />
        </div>

        <div>
          <Label htmlFor={`body-${id}`}>{t("testimonial.body")}</Label>
          <Textarea id={`body-${id}`} name="body" rows={3} defaultValue={row?.body ?? ""} />
          <p className="mt-1.5 text-caption text-muted">
            {t("testimonial.body_hint", { count: minWords })}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor={`attribution-${id}`}>{t("testimonial.attribution")}</Label>
            <Input
              id={`attribution-${id}`}
              name="attribution"
              defaultValue={row?.attribution ?? ""}
            />
            <p className="mt-1.5 text-caption text-muted">{t("testimonial.attribution_hint")}</p>
          </div>
          <div>
            <Label htmlFor={`context-${id}`}>{t("testimonial.context")}</Label>
            <Input id={`context-${id}`} name="context" defaultValue={row?.context ?? ""} />
            <p className="mt-1.5 text-caption text-muted">{t("testimonial.context_hint")}</p>
          </div>
        </div>

        <div className="max-w-[10rem]">
          <Label htmlFor={`order-${id}`}>{t("testimonial.order")}</Label>
          <Input
            id={`order-${id}`}
            name="sortOrder"
            type="number"
            inputMode="numeric"
            defaultValue={String(row?.sortOrder ?? 0)}
          />
          <p className="mt-1.5 text-caption text-muted">{t("testimonial.order_hint")}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={disabled}>
            {t("testimonial.save")}
          </Button>

          {row && onPublish ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={disabled}
              onClick={() => {
                const data = new FormData();
                data.set("id", row.id);
                if (!row.published) data.set("published", "on");
                onPublish(data);
              }}
            >
              {row.published ? t("testimonial.unpublish") : t("testimonial.publish")}
            </Button>
          ) : null}

          {row && onRemove ? (
            <Button
              type="button"
              size="sm"
              variant="danger"
              disabled={disabled}
              onClick={() => {
                const data = new FormData();
                data.set("id", row.id);
                onRemove(data);
              }}
            >
              {t("testimonial.delete")}
            </Button>
          ) : null}
        </div>
      </form>
    </Panel>
  );
}
