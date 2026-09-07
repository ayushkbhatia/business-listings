"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Button, Checkbox } from "@/components/primitives";
import { Card } from "@/components/structure";
import { saveKeepChoice } from "../../../actions";

/**
 * Pick what survives a scheduled plan change.
 *
 * ## Every label arrives resolved
 *
 * Nothing here calls `t()`. The two counters interpolate a number that only
 * exists once the seller has ticked something, so they arrive as templates with
 * a named hole — `{chosen}`, `{over}` — and this substitutes. That is uglier
 * than calling the catalogue and it is the shape that survives translation:
 * assembling a sentence out of fragments in the client is how a locale with a
 * different word order gets an unfixable string.
 */

export interface KeepOption {
  id: string;
  name: string;
  detail: string;
  /** The head office and the owner. Always kept, never deselectable. */
  locked: boolean;
}

export interface KeepChooserProps {
  kind: "products" | "locations" | "seats";
  planName: string;
  /** Null is unlimited, which this screen would not have been reached for. */
  cap: number | null;
  options: KeepOption[];
  preselected: string[];
  intro: string;
  labels: {
    save: string;
    /** Carries `{over}`. */
    over: string;
    /** Carries `{chosen}`. */
    counter: string;
    /** Carries `{count}`. What was saved, and when it takes effect. */
    saved: string;
    /** Why a locked row is locked. Different for a seat and a head office. */
    lockedNote: string;
    colName: string;
    colDetail: string;
    colKeeps: string;
  };
}

export function KeepChooser({
  kind,
  planName,
  cap,
  options,
  preselected,
  intro,
  labels,
}: KeepChooserProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const lockedIds = useMemo(
    () => new Set(options.filter((option) => option.locked).map((option) => option.id)),
    [options],
  );

  const [chosen, setChosen] = useState<Set<string>>(() => {
    // A locked row is kept whatever the stored list says. It cannot be
    // deselected, so it cannot be absent either.
    const initial = new Set(preselected);
    for (const id of lockedIds) initial.add(id);
    return initial;
  });

  const over = cap === null ? 0 : Math.max(0, chosen.size - cap);
  /*
     `replaceAll`, not `replace`.

     `String.replace` with a string pattern substitutes the first match only, so
     "{over} too many. Deselect {over} to continue." rendered the second hole
     verbatim — the screen read "Deselect {over} to continue". A template with a
     hole used twice is the normal case in this kind of sentence, not the
     exception.
  */
  const counter = labels.counter.replaceAll("{chosen}", String(chosen.size));

  return (
    <div className="flex flex-col gap-[var(--gutter)]">
      <Card surface="card" padded>
        <p className="text-caption leading-relaxed text-body-ink">{intro}</p>
        <p
          className={[
            "mt-2 text-caption font-medium",
            over > 0 ? "text-warn-ink" : "text-ink",
          ].join(" ")}
          // The count changes as the seller ticks, and a screen reader should
          // hear it settle rather than be interrupted on every keystroke.
          aria-live="polite"
        >
          {counter}
        </p>
        {over > 0 && (
          <p className="mt-1 text-caption text-warn-ink">
            {labels.over.replaceAll("{over}", String(over))}
          </p>
        )}
      </Card>

      <Card surface="card" padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-caption">
            <caption className="sr-only">{intro}</caption>
            <thead>
              <tr className="border-b border-line bg-paper-sunk">
                <th
                  scope="col"
                  className="w-16 px-4 py-2.5 font-mono text-eyebrow uppercase tracking-[0.09em] text-muted"
                >
                  {labels.colKeeps}
                </th>
                <th
                  scope="col"
                  className="px-3 py-2.5 font-mono text-eyebrow uppercase tracking-[0.09em] text-muted"
                >
                  {labels.colName}
                </th>
                <th
                  scope="col"
                  className="px-3 py-2.5 font-mono text-eyebrow uppercase tracking-[0.09em] text-muted"
                >
                  {labels.colDetail}
                </th>
              </tr>
            </thead>
            <tbody>
              {options.map((option) => (
                <tr key={option.id} className="border-b border-line-soft last:border-0">
                  <td className="px-4 py-2.5">
                    <Checkbox
                      checked={chosen.has(option.id)}
                      disabled={option.locked || pending}
                      // The row's own name, so a screen reader hears which
                      // product it is rather than "checkbox, checkbox".
                      aria-label={option.name}
                      onChange={(event) => {
                        setSaved(false);
                        setChosen((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(option.id);
                          else next.delete(option.id);
                          return next;
                        });
                      }}
                    />
                  </td>
                  <th scope="row" className="px-3 py-2.5 text-left font-normal text-ink">
                    {option.name}
                    {option.locked && (
                      <span className="mt-0.5 block text-caption text-muted">
                        {labels.lockedNote}
                      </span>
                    )}
                  </th>
                  <td className="px-3 py-2.5 text-body-ink">
                    {/*
                       Unfilled data stays visible rather than collapsing the
                       row. A product with no SKU renders an empty cell, not a
                       narrower table.
                    */}
                    {option.detail}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="primary"
          disabled={pending || over > 0}
          onClick={() => {
            setError(null);
            const form = new FormData();
            form.set("kind", kind);
            form.set("planName", planName);
            if (cap !== null) form.set("cap", String(cap));
            for (const id of chosen) form.append("keep", id);

            startTransition(async () => {
              const result = await saveKeepChoice(form);
              if (result.ok) {
                setSaved(true);
                router.refresh();
              } else {
                setError(result.error);
              }
            });
          }}
        >
          {labels.save}
        </Button>

        {saved && (
          /*
             What was saved and when it lands, not the counter again. The line
             above already says how many are ticked; repeating it as a
             confirmation tells the seller nothing they cannot see.
          */
          <p role="status" className="text-caption text-ok-ink">
            {labels.saved.replaceAll("{count}", String(chosen.size))}
          </p>
        )}
        {error && (
          <p role="alert" className="text-caption text-bad-ink">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
