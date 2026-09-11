"use client";

import { useState } from "react";
import { Alert } from "@/components/display";
import { Button, Label, Select, Textarea } from "@/components/primitives";
import { Panel } from "@/components/structure";
import { t } from "@/lib/i18n";
import type { ActionResult } from "./actions";
import type { TradeOption } from "./RenamePanel";

/**
 * Board `4d-s` — how a trade is sold. Decision D5.
 *
 * There are 440 rows to set and nobody is going to open 440 forms, so the bulk
 * primitive is inheritance rather than a multi-select: set a sector once and
 * every trade under it follows, then override only the ones that disagree.
 * Thirteen writes cover the taxonomy and the exceptions are typed after.
 *
 * The count of what moves is shown before the button for the same reason
 * `RenamePanel` shows the address count — somebody about to change how
 * thirty-eight trades are sold should know that before they commit, not after.
 * And the trades that will *not* follow are counted separately, because "38
 * change, 4 keep their own answer" is the sentence that stops a sector write
 * being assumed total.
 */

const MIN_REASON = 4;

/** The three choices, and why clearing is one of them rather than an absence. */
const CHOICES = [
  { value: "goods", label: t("taxonomy.kind_goods") },
  { value: "services", label: t("taxonomy.kind_services") },
  /*
     Clearing is a decision, not a blank. A row set back to null follows its
     sector again — which is a different outcome from "by the item", and the
     only way to undo an override that turned out to be wrong.
  */
  { value: "inherit", label: t("taxonomy.kind_inherit") },
] as const;

export function TradeKindPanel({
  trades,
  setKind,
  preview,
}: {
  trades: readonly TradeOption[];
  setKind: (formData: FormData) => Promise<ActionResult>;
  preview: (categoryId: string, kind: string) => Promise<{ moved: number; overridden: number }>;
}) {
  const [categoryId, setCategoryId] = useState("");
  const [kind, setKindValue] = useState("");
  const [reason, setReason] = useState("");
  const [impact, setImpact] = useState<{ moved: number; overridden: number } | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, setPending] = useState(false);

  const ready = categoryId !== "" && kind !== "" && reason.trim().length >= MIN_REASON;

  function look(nextId: string, nextKind: string) {
    setCategoryId(nextId);
    setKindValue(nextKind);
    setImpact(null);
    if (!nextId || !nextKind) return;
    void preview(nextId, nextKind).then(setImpact);
  }

  function send() {
    const form = new FormData();
    form.set("categoryId", categoryId);
    form.set("kind", kind);
    form.set("reason", reason);

    void (async () => {
      setPending(true);
      try {
        const outcome = await setKind(form);
        setResult(outcome);
        if (outcome.ok) {
          setReason("");
          setKindValue("");
          setImpact(null);
        }
      } finally {
        setPending(false);
      }
    })();
  }

  return (
    <Panel title={t("taxonomy.kind_title")}>
      {result && (
        <Alert tone={result.ok ? "ok" : "bad"}>{result.ok ? result.message : result.error}</Alert>
      )}

      <p className="mt-2 max-w-prose text-body-sm text-prose">{t("taxonomy.kind_body")}</p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="kind-trade">{t("taxonomy.pick")}</Label>
          {/*
             An empty first option, always. A Select that opens on its first
             real value posts that value when somebody fills in the rest of the
             form and never touches this control.
          */}
          <Select
            id="kind-trade"
            value={categoryId}
            onChange={(event) => look(event.target.value, kind)}
            options={[
              { value: "", label: "—" },
              ...trades.map((trade) => ({ value: trade.id, label: trade.label })),
            ]}
          />
        </div>
        <div>
          <Label htmlFor="kind-value">{t("taxonomy.kind")}</Label>
          <Select
            id="kind-value"
            value={kind}
            onChange={(event) => look(categoryId, event.target.value)}
            options={[
              { value: "", label: "—" },
              ...CHOICES.map((choice) => ({ value: choice.value, label: choice.label })),
            ]}
          />
          <p className="mt-1 text-caption text-muted">
            {impact === null
              ? t("taxonomy.kind_hint")
              : `${t("taxonomy.kind_moves", { count: impact.moved })}${
                  impact.overridden > 0
                    ? ` · ${t("taxonomy.kind_keeps", { count: impact.overridden })}`
                    : ""
                }`}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <Label htmlFor="kind-reason">{t("guide_admin.field.reason")}</Label>
        <Textarea
          id="kind-reason"
          rows={2}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>

      <div className="mt-4">
        <Button onClick={send} disabled={!ready || pending}>
          {t("taxonomy.kind_set")}
        </Button>
      </div>
    </Panel>
  );
}
