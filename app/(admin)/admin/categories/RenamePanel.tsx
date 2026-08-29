"use client";

import { useState } from "react";
import { Alert } from "@/components/display";
import { Button, Input, Label, Select, Textarea } from "@/components/primitives";
import { Panel } from "@/components/structure";
import { t } from "@/lib/i18n";
import type { ActionResult } from "./actions";

/**
 * Criterion 7 — "renaming a category produces a working 301".
 *
 * The count of addresses that will move is shown before the button, because one
 * rename of a sector moves its page, every subcategory under it and every area
 * page for it — and somebody about to move forty addresses should know that
 * before they do rather than after.
 */

const MIN_REASON = 4;

export interface TradeOption {
  id: string;
  label: string;
}

export function RenamePanel({
  trades,
  rename,
  remove,
  preview,
}: {
  trades: readonly TradeOption[];
  rename: (formData: FormData) => Promise<ActionResult>;
  remove: (formData: FormData) => Promise<ActionResult>;
  preview: (categoryId: string, slug: string) => Promise<number>;
}) {
  const [categoryId, setCategoryId] = useState("");
  const [slug, setSlug] = useState("");
  const [reason, setReason] = useState("");
  const [moves, setMoves] = useState<number | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, setPending] = useState(false);

  const ready = reason.trim().length >= MIN_REASON;

  function look(nextId: string, nextSlug: string) {
    setCategoryId(nextId);
    setSlug(nextSlug);
    setMoves(null);
    if (!nextId || !nextSlug) return;
    void preview(nextId, nextSlug).then(setMoves);
  }

  function send(action: (formData: FormData) => Promise<ActionResult>) {
    const form = new FormData();
    form.set("categoryId", categoryId);
    form.set("slug", slug);
    form.set("reason", reason);

    void (async () => {
      setPending(true);
      try {
        const outcome = await action(form);
        setResult(outcome);
        if (outcome.ok) {
          setReason("");
          setSlug("");
          setMoves(null);
        }
      } finally {
        setPending(false);
      }
    })();
  }

  return (
    <Panel title={t("taxonomy.rename_title")}>
      {result && (
        <Alert tone={result.ok ? "ok" : "bad"}>
          {result.ok ? result.message : result.error}
        </Alert>
      )}

      <p className="mt-2 max-w-prose text-body-sm text-prose">{t("taxonomy.rename_body")}</p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="rename-trade">{t("taxonomy.pick")}</Label>
          <Select
            id="rename-trade"
            value={categoryId}
            onChange={(event) => look(event.target.value, slug)}
            options={[{ value: "", label: "—" }, ...trades.map((trade) => ({ value: trade.id, label: trade.label }))]}
          />
        </div>
        <div>
          <Label htmlFor="rename-slug">{t("taxonomy.new_slug")}</Label>
          <Input
            id="rename-slug"
            mono
            value={slug}
            onChange={(event) => look(categoryId, event.target.value)}
          />
          <p className="mt-1 text-caption text-muted">
            {moves === null ? t("taxonomy.new_slug_hint") : t("taxonomy.affected", { count: moves })}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <Label htmlFor="rename-reason">{t("guide_admin.field.reason")}</Label>
        <Textarea
          id="rename-reason"
          rows={2}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <Button onClick={() => send(rename)} disabled={!ready || pending || !categoryId || !slug}>
          {t("taxonomy.rename")}
        </Button>
        <Button
          variant="ghost"
          onClick={() => send(remove)}
          disabled={!ready || pending || !categoryId}
        >
          {t("taxonomy.remove")}
        </Button>
      </div>

      <p className="mt-3 max-w-prose text-caption text-muted">{t("taxonomy.remove_hint")}</p>
    </Panel>
  );
}
