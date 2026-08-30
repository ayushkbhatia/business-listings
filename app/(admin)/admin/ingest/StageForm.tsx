"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, FileDrop, Input, Label, Select } from "@/components/primitives";
import { Alert } from "@/components/display";
import { Panel } from "@/components/structure";
import { t } from "@/lib/i18n";
import type { ActionResult } from "./actions";

/**
 * Board 12a — staging a licence export.
 *
 * `stageRun` parses, classifies and stages a file and publishes nothing, and
 * it had no way in: the approval half of this screen has always worked and
 * there was no screen anywhere that produced a run to approve. Runs could only
 * arrive from a test.
 *
 * Staging is deliberately not audited — the audited event is the approval — so
 * there is no reason field here. That is the one screen in the console where
 * its absence is correct rather than an oversight.
 */

export interface StageFormProps {
  authorities: readonly { value: string; label: string }[];
  stage: (formData: FormData) => Promise<ActionResult>;
}

export function StageForm({ authorities, stage }: StageFormProps) {
  const router = useRouter();
  const [source, setSource] = useState(authorities[0]?.value ?? "");
  const [filename, setFilename] = useState("");
  const [text, setText] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  async function take(files: FileList) {
    const file = files[0];
    if (!file) return;
    setResult(null);
    // Read in the browser, like the seller's product import: the server action
    // takes the text, so there is no upload endpoint to hold a half-written
    // file and nothing to clean up if somebody changes their mind.
    setText(await file.text());
    setFilename(file.name);
  }

  function submit() {
    const form = new FormData();
    form.set("source", source);
    form.set("filename", filename);
    form.set("text", text);
    startTransition(async () => {
      const outcome = await stage(form);
      setResult(outcome);
      if (outcome.ok && outcome.runId) {
        // Straight to the run, where the approval — the audited half — lives.
        router.push(`/admin/ingest/${outcome.runId}`);
      }
    });
  }

  return (
    <Panel title={t("admin.ingest.stage_title")}>
      <div className="flex flex-col gap-4">
        <p className="max-w-prose text-caption text-muted">{t("admin.ingest.stage_help")}</p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="stage-source" requirement="required">
              {t("admin.ingest.stage_source")}
            </Label>
            <Select
              id="stage-source"
              value={source}
              onChange={(event) => setSource(event.target.value)}
              options={[...authorities]}
            />
          </div>
          <div>
            <Label htmlFor="stage-filename">{t("admin.ingest.stage_filename")}</Label>
            <Input
              id="stage-filename"
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
          state={pending ? "uploading" : filename ? "done" : "idle"}
          onSelect={(files) => void take(files)}
          onRemove={() => {
            setFilename("");
            setText("");
          }}
        />

        <div>
          <Button disabled={!text || !source || pending} onClick={submit}>
            {t("admin.ingest.stage_action")}
          </Button>
        </div>

        {result && !result.ok && (
          <Alert tone="bad" live="assertive">
            {result.error}
          </Alert>
        )}
      </div>
    </Panel>
  );
}
