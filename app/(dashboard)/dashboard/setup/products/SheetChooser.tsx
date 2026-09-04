"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/primitives";
import { Modal } from "@/components/structure";
import { cn } from "@/lib/cn";
import type { RowResult } from "./actions";

/**
 * Step 1 — which spec sheet fits what you sell. Board 8c §2.
 *
 * Every label arrives translated and every number formatted. This component
 * calls no `t()` and formats nothing: a client component that formatted a count
 * renders one string on the server and another in the browser, which is the
 * defect this codebase names first.
 *
 * ## Why the change is confirmed and the first choice is not
 *
 * Picking a sheet with no products is free. Changing it once rows exist stops
 * showing values stored against fields the new sheet does not have — nothing is
 * deleted, but from where the seller stands the columns go quiet, and §7 asks
 * for a confirm listing what will be lost, by name and count. The cost is
 * computed on the server when the card is clicked, not guessed here.
 */

export interface SheetCard {
  id: string;
  name: string;
  /** "22 fields · 9 required · 8 filterable", already assembled. */
  meta: string;
  /** "used by 341 suppliers", or empty where nobody uses it yet. */
  adoption: string;
  matches: boolean;
}

export interface SheetChooserLabels {
  matches: string;
  browseAll: string;
  browseBody: string;
  browseTitle: string;
  browseClose: string;
  choose: string;
  chosen: string;
  changeTitle: string;
  changeBody: string;
  changeConfirm: string;
  changeCancel: string;
}

export interface SheetChooserProps {
  cards: readonly SheetCard[];
  /** Everything, for the browse modal. */
  all: readonly SheetCard[];
  selectedId: string | null;
  /** True once any product exists, which is what makes a change costly. */
  hasRows: boolean;
  labels: SheetChooserLabels;
  choose: (formData: FormData) => Promise<RowResult>;
  /** A Server Action. Returns finished sentences — see actions.ts. */
  cost: (templateId: string) => Promise<string[]>;
}

export function SheetChooser({
  cards,
  all,
  selectedId,
  hasRows,
  labels,
  choose,
  cost,
}: SheetChooserProps) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [browsing, setBrowsing] = useState(false);
  const [pending, setPending] = useState<{ id: string; losing: string[] } | null>(null);

  function apply(id: string): void {
    const form = new FormData();
    form.set("templateId", id);
    startTransition(async () => {
      await choose(form);
      setPending(null);
      setBrowsing(false);
      router.refresh();
    });
  }

  function pick(id: string): void {
    if (id === selectedId) return;
    if (!hasRows) {
      apply(id);
      return;
    }
    startTransition(async () => {
      const losing = await cost(id);
      // Nothing to lose is not a decision worth interrupting for.
      if (losing.length === 0) apply(id);
      else setPending({ id, losing });
    });
  }

  return (
    <>
      <ul className="grid list-none grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <li key={card.id}>
            <SheetTile
              card={card}
              selected={card.id === selectedId}
              busy={busy}
              matchesLabel={labels.matches}
              onPick={() => pick(card.id)}
            />
          </li>
        ))}

        <li>
          {/*
            Dashed, because it is a way out of the three rather than a fourth
            option — the design system reserves a dashed border for "add or drop
            something here" and this is the only tile that opens rather than
            selects.
          */}
          <button
            type="button"
            disabled={busy}
            onClick={() => setBrowsing(true)}
            className="flex h-full w-full flex-col items-start justify-center gap-1.5 rounded-card border border-dashed border-line-strong bg-card px-5 py-4 text-start transition-colors duration-120 ease-out hover:bg-fill focus-visible:outline-none focus-visible:shadow-focus disabled:cursor-not-allowed"
          >
            <span className="text-body-sm font-medium text-ink">{labels.browseAll}</span>
            <span className="text-caption text-muted">{labels.browseBody}</span>
          </button>
        </li>
      </ul>

      {browsing && (
        <Modal
          open
          title={labels.browseTitle}
          onClose={() => setBrowsing(false)}
          closeLabel={labels.browseClose}
        >
          <ul className="flex max-h-[60vh] list-none flex-col gap-2 overflow-y-auto">
            {all.map((card) => (
              <li key={card.id}>
                <SheetTile
                  card={card}
                  selected={card.id === selectedId}
                  busy={busy}
                  matchesLabel={labels.matches}
                  onPick={() => pick(card.id)}
                />
              </li>
            ))}
          </ul>
        </Modal>
      )}

      {pending && (
        <Modal
          open
          size="sm"
          title={labels.changeTitle}
          description={labels.changeBody}
          onClose={() => setPending(null)}
          closeLabel={labels.changeCancel}
          /*
             Cancel first, then confirm, left to right — Modal renders the
             footer in that order and design-system §05 asks for it: cancel on
             the left, never red, and the confirm repeats the verb rather than
             saying OK.
          */
          footer={
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPending(null)}
                disabled={busy}
              >
                {labels.changeCancel}
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => apply(pending.id)}
                disabled={busy}
              >
                {labels.changeConfirm}
              </Button>
            </>
          }
        >
          <ul className="flex list-none flex-col gap-1.5">
            {pending.losing.map((line) => (
              <li key={line} className="text-caption text-warn-ink">
                {line}
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </>
  );
}

function SheetTile({
  card,
  selected,
  busy,
  matchesLabel,
  onPick,
}: {
  card: SheetCard;
  selected: boolean;
  busy: boolean;
  matchesLabel: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={busy}
      onClick={onPick}
      className={cn(
        "flex h-full w-full flex-col items-start gap-2 rounded-card border bg-card px-5 py-4 text-start transition-colors duration-120 ease-out focus-visible:outline-none focus-visible:shadow-focus disabled:cursor-not-allowed",
        // The design system's selection treatment: a 1.5px moss border and a
        // moss-tinted fill. Never a shadow.
        selected ? "border-[1.5px] border-moss bg-moss-wash" : "border-line hover:bg-fill",
      )}
    >
      <span className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className={cn(
            "flex size-4 shrink-0 items-center justify-center rounded-pill border-[1.5px]",
            selected ? "border-moss" : "border-line-strong",
          )}
        >
          {selected && <span className="size-2 rounded-pill bg-moss" />}
        </span>
        <span className="text-body-sm font-medium text-ink">{card.name}</span>
      </span>

      <span className="text-caption text-muted">
        {card.meta}
        {card.adoption ? ` · ${card.adoption}` : ""}
      </span>

      {card.matches && (
        <span className="font-mono text-eyebrow uppercase text-ok-ink">{matchesLabel}</span>
      )}
    </button>
  );
}
