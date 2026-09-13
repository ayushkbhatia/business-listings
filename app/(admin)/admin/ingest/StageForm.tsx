"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, FileDrop, Input, Label, Select, Textarea } from "@/components/primitives";
import { Alert } from "@/components/display";
import { formatBytes } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { ActionResult } from "./actions";

/**
 * Board 12a — staging a licence export.
 *
 * `stageRun` parses, checks each record against the licences already listed,
 * categorises what it can and stages the file whole. It publishes nothing.
 *
 * The reason field is new. Staging used to be the one console action with no
 * audit row, on the argument that an upload changes nothing a buyer sees; B8
 * made it a `staffMutation` like approval and rollback, because "who loaded
 * this file, and why" is the first question asked of a bad run.
 */

const MIN_REASON = 4;

/**
 * What one staging request can carry: `serverActions.bodySizeLimit` in
 * next.config.ts, less room for the form's own encoding. A larger file is
 * refused here, with its size, rather than by the framework with none.
 */
export const MAX_STAGE_BYTES = 3_900_000;

export interface StageFormProps {
  authorities: readonly { value: string; label: string }[];
  stage: (formData: FormData) => Promise<ActionResult>;
  /** Rendered inside a dialog, which supplies its own cancel. */
  onCancel?: () => void;
}

export function StageForm({ authorities, stage, onCancel }: StageFormProps) {
  const router = useRouter();
  const ids = { source: useId(), filename: useId(), reason: useId() };
  const [source, setSource] = useState(authorities[0]?.value ?? "");
  const [filename, setFilename] = useState("");
  const [text, setText] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [reading, setReading] = useState(false);
  const [pending, startTransition] = useTransition();

  async function take(files: FileList) {
    const file = files[0];
    if (!file) return;
    setResult(null);
    if (file.size > MAX_STAGE_BYTES) {
      setResult({
        ok: false,
        error: t("admin.ingest.stage_too_large", {
          size: formatBytes(file.size),
          limit: formatBytes(MAX_STAGE_BYTES),
        }),
      });
      return;
    }
    setReading(true);
    // Read in the browser, like the seller's product import: the server action
    // takes the text, so there is no upload endpoint to hold a half-written
    // file and nothing to clean up if somebody changes their mind.
    setText(await file.text());
    setFilename(file.name);
    setReading(false);
  }

  function submit() {
    const form = new FormData();
    form.set("source", source);
    form.set("filename", filename);
    form.set("text", text);
    form.set("reason", reason);
    startTransition(async () => {
      const outcome = await stage(form);
      setResult(outcome);
      if (outcome.ok && outcome.runId) {
        // Straight to the run, where the decision lives.
        router.push(`/admin/ingest/${outcome.runId}`);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-prose text-caption text-body">{t("admin.ingest.stage_help")}</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label
            htmlFor={ids.source}
            requirement="required"
            requirementLabel={t("field.required")}
            hint={t("admin.ingest.stage_source_hint")}
          >
            {t("admin.ingest.stage_source")}
          </Label>
          <Select
            id={ids.source}
            value={source}
            onChange={(event) => setSource(event.target.value)}
            options={[...authorities]}
          />
        </div>
        <div>
          <Label htmlFor={ids.filename}>{t("admin.ingest.stage_filename")}</Label>
          <Input
            id={ids.filename}
            value={filename}
            onChange={(event) => setFilename(event.target.value)}
          />
        </div>
      </div>

      <FileDrop
        accept=".csv,text/csv"
        idleLabel={t("admin.ingest.stage_drop")}
        idleHint={t("admin.ingest.stage_drop_hint")}
        {...(filename ? { filename } : {})}
        state={reading || pending ? "uploading" : text ? "done" : "idle"}
        onSelect={(files) => void take(files)}
        onRemove={() => {
          setFilename("");
          setText("");
        }}
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

      {result && !result.ok && (
        <Alert tone="bad" live="assertive">
          {result.error}
        </Alert>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={pending}>
            {t("action.cancel")}
          </Button>
        )}
        <Button
          loading={pending}
          disabled={!text || !source || reason.trim().length < MIN_REASON || pending}
          onClick={submit}
        >
          {t("admin.ingest.stage_action")}
        </Button>
      </div>
    </div>
  );
}
