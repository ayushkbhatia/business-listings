"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, FileDrop, Input, Label, Select, Textarea } from "@/components/primitives";
import { Alert } from "@/components/display";
import { formatBytes } from "@/lib/format";
import { MAX_INGEST_BYTES, checkIngest } from "@/lib/storage/buckets";
import { t } from "@/lib/i18n";
import type { ActionResult, SignResult } from "./actions";

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
 * What one staging request can carry — task T4.1, and it is now the bucket's
 * number rather than the request body's.
 *
 * It was 3,900,000: `serverActions.bodySizeLimit` less room for the form's own
 * encoding. That ceiling cut a register export at about 30,000 rows against a
 * declared limit of 50,000, so the importer refused the file the feature exists
 * for — in the browser, before any code of ours ran. The bytes go to object
 * storage now and `MAX_INGEST_BYTES` is enforced by the bucket as well as here.
 *
 * Imported rather than restated. The old constant was a literal beside a
 * comment pointing at a config file, which is how the two ended up different
 * numbers; `lib/storage/buckets.ts` is free of server imports precisely so a
 * client component can read the real one.
 */

export interface StageFormProps {
  authorities: readonly { value: string; label: string }[];
  stage: (formData: FormData) => Promise<ActionResult>;
  /** T4.1 — mints the signed URL the browser PUTs the export to. */
  sign: (formData: FormData) => Promise<SignResult>;
  /** Rendered inside a dialog, which supplies its own cancel. */
  onCancel?: () => void;
}

export function StageForm({ authorities, stage, sign, onCancel }: StageFormProps) {
  const router = useRouter();
  const ids = { source: useId(), filename: useId(), reason: useId() };
  const [source, setSource] = useState(authorities[0]?.value ?? "");
  const [filename, setFilename] = useState("");
  /*
     T4.1 — the object's path, not the file's text.

     The form used to hold the whole export in React state and send it in the
     action's body. A 10 MB CSV in a `useState` is 10 MB of string in the tab,
     base64-encoded again on submit, and the framework refused it at 4 MB
     anyway.
  */
  const [path, setPath] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();

  /**
   * Check, sign, PUT — T4.1.
   *
   * Three steps rather than one read, and the order matters: the size is
   * refused here with its own number before a signature is minted, the
   * signature is minted by a server that has checked the seat, and the bytes go
   * straight from the tab to storage without passing through our runtime.
   *
   * The file is uploaded on **selection** rather than on submit, so the ops lead
   * writes the reason while a 10 MB export is in flight instead of waiting for
   * it afterwards. An upload nobody goes on to stage leaves one object in a
   * private bucket that no row points at, which is the cost of that and is
   * cheaper than the wait.
   */
  async function take(files: FileList) {
    const file = files[0];
    if (!file) return;
    setResult(null);

    const check = checkIngest(file.type, file.size);
    if (!check.ok) {
      setResult({
        ok: false,
        error:
          file.size > MAX_INGEST_BYTES
            ? t("admin.ingest.stage_too_large", {
                size: formatBytes(file.size),
                limit: formatBytes(MAX_INGEST_BYTES),
              })
            : check.reason,
      });
      return;
    }

    setUploading(true);
    setFilename(file.name);

    const signForm = new FormData();
    signForm.set("filename", file.name);
    signForm.set("type", file.type);
    signForm.set("bytes", String(file.size));
    const signed = await sign(signForm);
    if (!signed.ok) {
      setResult({ ok: false, error: signed.error });
      setFilename("");
      setUploading(false);
      return;
    }

    const response = await fetch(signed.url, {
      method: "PUT",
      headers: { "content-type": file.type || "text/csv" },
      body: file,
    });
    if (!response.ok) {
      // The path is not kept. Staging from a half-written object would stage a
      // truncated register and report a tidy number for it.
      setResult({ ok: false, error: t("admin.ingest.stage_upload_failed") });
      setFilename("");
      setUploading(false);
      return;
    }

    setPath(signed.path);
    setUploading(false);
  }

  function submit() {
    const form = new FormData();
    form.set("source", source);
    form.set("filename", filename);
    form.set("path", path);
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
        state={uploading || pending ? "uploading" : path ? "done" : "idle"}
        onSelect={(files) => void take(files)}
        onRemove={() => {
          /*
             The object stays in the bucket. Removing it would need a second
             action and a second permission check for a file nothing points at,
             and the alternative — a delete the browser can ask for by path — is
             a delete somebody can ask for by any path.
          */
          setFilename("");
          setPath("");
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
          disabled={!path || !source || reason.trim().length < MIN_REASON || pending || uploading}
          onClick={submit}
        >
          {t("admin.ingest.stage_action")}
        </Button>
      </div>
    </div>
  );
}
