"use client";

import { useState } from "react";
import { Alert, StatusBadge } from "@/components/display";
import { Button, Input, Label } from "@/components/primitives";
import { remove } from "./actions";

/**
 * The moderation list.
 *
 * A removed question stays, marked, with its reason on it. A list that dropped
 * removals would make a removal look like the question had never been asked,
 * which is the one thing it must not resemble — the same rule the seller's
 * reviews screen states.
 */

export interface QuestionRow {
  id: string;
  business: string;
  businessSlug: string;
  product: string;
  productSlug: string;
  body: string;
  answer: string | null;
  askedAt: string;
  removedAt: string | null;
  removalReason: string | null;
}

export function QuestionList({
  rows,
  labels,
}: {
  rows: readonly QuestionRow[];
  labels: {
    remove: string;
    reasonLabel: string;
    removedTone: string;
    empty: string;
  };
}) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (rows.length === 0) return <p className="text-body-sm text-body">{labels.empty}</p>;

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <Alert tone="bad" live="assertive">
          {error}
        </Alert>
      )}
      {done && (
        <Alert tone="ok" live="polite">
          {done}
        </Alert>
      )}

      {rows.map((row) => (
        <article key={row.id} className="rounded-card border border-line bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="font-mono text-eyebrow uppercase tracking-eyebrow text-faint">
              <a href={`/b/${row.businessSlug}/p/${row.productSlug}`} className="hover:underline">
                {row.business} · {row.product}
              </a>
            </p>
            {row.removedAt && (
              <StatusBadge tone="bad" size="sm">
                {labels.removedTone}
              </StatusBadge>
            )}
          </div>

          <p className="mt-2 text-body text-ink">{row.body}</p>
          {row.answer && <p className="mt-1.5 text-body-sm text-body">{row.answer}</p>}
          <p className="mt-1 font-mono text-eyebrow uppercase text-faint">{row.askedAt}</p>

          {row.removedAt ? (
            <p className="mt-2 border-t border-line pt-2 text-caption text-bad-ink">
              {row.removalReason}
            </p>
          ) : (
            <form
              className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3"
              action={async (formData) => {
                setError(null);
                setDone(null);
                const result = await remove(formData);
                if (result.ok) setDone(result.message);
                else setError(result.error);
              }}
            >
              <input type="hidden" name="questionId" value={row.id} />
              <div className="min-w-[18rem] flex-1">
                <Label htmlFor={`reason-${row.id}`}>{labels.reasonLabel}</Label>
                <Input id={`reason-${row.id}`} name="reason" required minLength={8} />
              </div>
              <Button type="submit" variant="danger" size="sm">
                {labels.remove}
              </Button>
            </form>
          )}
        </article>
      ))}
    </div>
  );
}
