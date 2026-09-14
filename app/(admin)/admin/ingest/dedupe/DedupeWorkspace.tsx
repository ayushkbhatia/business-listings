"use client";

import { useState } from "react";
import { Alert } from "@/components/display";
import type { PairView } from "@/lib/dedupe/queue";
import { t } from "@/lib/i18n";
import type { ActionResult } from "./actions";
import { PairWorkspace } from "./PairWorkspace";

/**
 * The manual queue's frame: the pair, or the empty state, under the sentence
 * about the last decision.
 *
 * The sentence lives here rather than in the pair's panel because resolving
 * the last pair replaces the panel with the empty state, and "Kept separate
 * from Gulf Cool" should still be on the screen when that happens.
 */
export function DedupeWorkspace({
  pair,
  position,
  total,
  runId,
  reversibleDays,
  resolve,
  empty,
}: {
  pair: PairView | null;
  position: number;
  total: number;
  runId: string | null;
  reversibleDays: number;
  resolve: (formData: FormData) => Promise<ActionResult>;
  empty: React.ReactNode;
}) {
  const [result, setResult] = useState<ActionResult | null>(null);

  return (
    <div className="flex flex-col gap-3">
      {result && (
        <Alert
          tone={result.ok ? "ok" : "bad"}
          live={result.ok ? "polite" : "assertive"}
          {...(result.ok ? {} : { fix: t("admin.dedupe.error.fix") })}
        >
          {result.ok ? result.message : result.error}
        </Alert>
      )}
      {pair ? (
        <PairWorkspace
          pair={pair}
          position={position}
          total={total}
          runId={runId}
          reversibleDays={reversibleDays}
          resolve={resolve}
          onResult={setResult}
        />
      ) : (
        empty
      )}
    </div>
  );
}
