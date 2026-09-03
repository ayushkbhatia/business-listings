"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { StepHeader } from "@/components/structure";
import { Button, Checkbox, IconButton, Input } from "@/components/primitives";
import { EnquiryComposer, type EnquiryComposerValue, type RecipientPreview } from "@/components/domain";
import { cn } from "@/lib/cn";
import { enquiryLabels, rfqLabels } from "./_labels";
import { previewRecipients, sendEnquiry, routeUnmatched } from "./actions";
import { clearDraft, draftServerSnapshot, draftSnapshot, saveDraft, subscribeDraft } from "./rfq-draft";
import {
  MAX_LINES,
  filledLines,
  hasLine,
  sendBlockedBy,
  stepOf,
  type RfqLine,
} from "./rfq-state";

/**
 * Composer B — board 1h's `/rfq/new`.
 *
 * One route, three steps, no reload. The stepper is a progress statement read
 * off the form by `stepOf`; there is no step to set and nothing gates
 * backwards, which is the composer model's correction to the wizard this
 * replaced.
 *
 * The page owns three things the inline composer does not: the items table with
 * its three row types, the recipient picker with the 1–8 cap, and Send with its
 * live count. `EnquiryComposer` is mounted in `panel` shape for the requirement
 * and contact fields, so both composers ask the same questions in the same
 * words and submit through the same action.
 */

export interface RfqComposerLabels {
  h1: string;
  singleH1: string;
  sub: string;
  stepItems: string;
  stepRequirement: string;
  stepSend: string;
  stepCompact: (current: number, total: number) => string;
  sequence: string;

  itemsTitle: string;
  itemsCaption: string;
  addAnother: string;
  colProduct: string;
  colQty: string;
  colTarget: string;
  colRemove: string;
  targetHint: string;
  unmatched: string;
  linePlaceholder: string;
  lineDescription: (n: number) => string;
  lineQty: (n: number) => string;
  lineTarget: (n: number) => string;
  removeLine: (n: number) => string;

  requirementTitle: string;
  seededNotice: string;

  recipientsTitle: (count: number) => string;
  recipientsMatchedOn: string;
  recipientsEmpty: string;
  recipientsMore: (count: number) => string;
  recipientsAddAll: string;
  recipientPick: (name: string) => string;
  fromPage: string;
  capNote: string;
  onlyOneMatch: string;
  zeroMatches: string;
  routeForMe: string;
  routed: string;

  howTitle: string;
  how: readonly string[];
  send: (count: number) => string;
  sendIdle: string;
  sendNote: string;
  blockedNoLines: string;
  blockedNoArea: string;
  blockedNoRecipients: string;
  sending: string;
}

let seq = 0;
const blankLine = (): RfqLine => ({
  key: `rfq-${(seq += 1)}`,
  description: "",
  qty: 1,
  targetUnitPriceAed: "",
  productId: null,
  sku: null,
  sellerName: null,
});

export function RfqComposer({
  emirateName,
  categoryId,
  emirates,
  initialLines,
  initialRequirement = "",
  initialRecipients,
  pinnedBusinessIds = [],
  askForContact,
  seeded = false,
}: {
  /**
   * Built here, not passed in.
   *
   * Several labels take an argument, and a function cannot cross from a server
   * component to a client one — `_labels.ts` says so at the top and this page
   * proved it again by rendering a server error on every one of them. The page
   * hands over the data the strings need; the client makes the strings.
   */
  emirateName: string;
  categoryId: string;
  emirates: readonly { value: string; label: string }[];
  initialLines?: readonly RfqLine[];
  initialRequirement?: string;
  /** Up to 8. The first five are ticked; the rest sit behind "Add all". */
  initialRecipients: readonly RecipientPreview[];
  pinnedBusinessIds?: readonly string[];
  askForContact: boolean;
  /** Query-seeded from 1c, which gets a notice above the items card. */
  seeded?: boolean;
}) {
  const labels = useMemo(() => rfqLabels({ emirateName }), [emirateName]);
  /*
     The lines live in the draft store, not in component state.

     Mirroring the store into `useState` did not work and could not: during
     hydration `useSyncExternalStore` returns the *server* snapshot, which is
     empty by design — that is what avoids the mismatch — and a `useState`
     initialiser runs once, against exactly that empty value. So the restored
     draft never landed and criterion 11 failed while looking implemented.

     With the store as the source of truth the value is read on every render,
     the restore happens the moment the client snapshot is available, and there
     is no second copy to drift.

     A seeded arrival still wins: a buyer who just clicked "add to an RFQ" means
     the thing they clicked, not what they were typing an hour ago.
  */
  const stored = useSyncExternalStore(subscribeDraft, draftSnapshot, draftServerSnapshot);
  /*
     Memoised so the identity is stable. Both are derived arrays, and a fresh
     one each render would make every hook that depends on them re-run — which
     for the recipient effect means re-matching on keystrokes that changed
     nothing.
  */
  const seededLines = useMemo(
    () => (initialLines && initialLines.length > 0 ? [...initialLines] : null),
    [initialLines],
  );
  const lines: RfqLine[] = useMemo(
    () => seededLines ?? (stored.length > 0 ? [...stored] : [blankLine()]),
    [seededLines, stored],
  );
  const setLines = useCallback(
    (next: RfqLine[] | ((current: RfqLine[]) => RfqLine[])) => {
      const current = draftSnapshot();
      const base = seededLines ?? (current.length > 0 ? [...current] : [blankLine()]);
      saveDraft(typeof next === "function" ? next(base) : next);
    },
    [seededLines],
  );
  const [recipients, setRecipients] = useState<readonly RecipientPreview[]>(initialRecipients);
  const [showAll, setShowAll] = useState(false);
  const [value, setValue] = useState<EnquiryComposerValue | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [routed, setRouted] = useState(false);

  /*
     Default selection is the top five, and the pinned seller is always in it.
     Board 1h: a buyer arriving from a product page finds that seller pre-ticked
     and pinned first, because they came from its page and unticking it should
     be their decision rather than the default's.
  */
  const [picked, setPicked] = useState<string[]>(() => {
    /*
       Nothing is picked until something is asked for.

       The page fetches candidates before it knows what the buyer wants, so at
       step 1 there are eight in hand and no reason to have chosen any. Ticking
       five anyway made Send read "Send to 5 sellers" under a card saying "add
       items to see matching sellers" — two statements about the same thing,
       disagreeing, on first paint.
    */
    if (!initialLines || initialLines.length === 0) return [];
    const pinned = initialRecipients.filter((r) => r.pinned).map((r) => r.businessId);
    const rest = initialRecipients
      .filter((r) => !r.pinned)
      .map((r) => r.businessId)
      .slice(0, Math.max(0, 5 - pinned.length));
    return [...pinned, ...rest];
  });

  const shown = showAll ? recipients : recipients.slice(0, 5);
  const more = Math.max(0, recipients.length - shown.length);

  const state = useMemo(
    () => ({
      lines,
      emirate: value?.emirate ?? "",
      area: value?.deliverToArea ?? "",
      picked,
    }),
    [lines, value, picked],
  );
  const step = stepOf(state);
  const linesExist = hasLine(lines);

  /*
     Recipients are re-matched when the lines change, through the same matcher
     the send uses — so what the buyer is shown and what is delivered cannot
     disagree. Only once a line exists: matching needs a category and, on a cold
     arrival, there is nothing to match on yet.
  */
  const lineCount = filledLines(lines).length;
  useEffect(() => {
    if (lineCount === 0) return;
    let cancelled = false;
    void previewRecipients({
      categoryId,
      emirate: value?.emirate ?? null,
      lineCount,
      fanoutTo: 8,
      ...(pinnedBusinessIds.length ? { pinnedBusinessIds: [...pinnedBusinessIds] } : {}),
    }).then((next) => {
      if (cancelled) return;
      setRecipients(next);
      // Keep a tick the buyer made; drop one for a seller who no longer matches.
      setPicked((current) => {
        const live = new Set(next.map((r) => r.businessId));
        const kept = current.filter((id) => live.has(id));
        if (kept.length > 0) return kept;
        const pinned = next.filter((r) => r.pinned).map((r) => r.businessId);
        const rest = next.filter((r) => !r.pinned).map((r) => r.businessId);
        return [...pinned, ...rest].slice(0, 5);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [categoryId, lineCount, value?.emirate, pinnedBusinessIds]);

  /*
     A seeded arrival is written to the draft once, so that leaving the page and
     coming back keeps the seeded lines rather than dropping to a blank row.
  */
  useEffect(() => {
    if (seededLines && draftSnapshot().length === 0) saveDraft(seededLines);
    // Once per seeded mount; derived from a prop that does not change.
  }, [seededLines]);

  const updateLine = useCallback(
    (key: string, patch: Partial<RfqLine>) => {
      setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    },
    [setLines],
  );

  const blocked = sendBlockedBy(state, {
    noLines: labels.blockedNoLines,
    noArea: labels.blockedNoArea,
    noRecipients: labels.blockedNoRecipients,
  });

  /*
     Fewer than two matches and the fan-out framing collapses: the header
     becomes "Send an enquiry" and the card explains rather than padding the
     list. Never pad with unverified or capped sellers to reach five — the
     spec says so, and a padded list is a promise the engine cannot keep.
  */
  const single = linesExist && recipients.length === 1;
  const none = linesExist && recipients.length === 0;

  function submit() {
    if (blocked || !value) return;
    setError(null);
    startTransition(async () => {
      const result = await sendEnquiry({
        requirement: value.requirement,
        lines: filledLines(lines).map((l) => ({
          description: l.description.trim(),
          qty: l.qty,
          unit: "pcs",
          size: null,
          targetUnitPriceAed: l.targetUnitPriceAed.trim() || null,
          productId: l.productId,
        })),
        categoryId,
        emirate: value.emirate,
        deliverToArea: value.deliverToArea,
        neededBy: value.neededBy,
        termsWanted: value.termsWanted,
        closesInDays: value.closesInDays,
        /*
           The picker is the truth: one Enquiry, one recipient row per tick.
           `chosenBusinessIds` rather than pinning, because pinning only sorts —
           a seller who became ineligible between the preview and the send would
           have been silently replaced by whoever ranked next.
        */
        fanoutTo: picked.length,
        contactPhone: value.contactPhone,
        contactName: value.contactName,
        chosenBusinessIds: picked,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Sent. Leaving the draft would refill the next RFQ with the last one.
      clearDraft();
    });
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-5 pb-24 md:pb-8">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line py-6">
        <div className="min-w-0">
          <h1 className="font-serif text-h1-serif text-ink">
            {single || none ? labels.singleH1 : labels.h1}
          </h1>
          <p className="mt-2 max-w-[var(--measure-prose)] text-body-sm text-body">{labels.sub}</p>
        </div>
        <div className="w-full md:w-auto">
          <StepHeader
            label={labels.sequence}
            current={step - 1}
            progressLabel={labels.stepCompact}
            steps={[
              { key: "items", label: labels.stepItems },
              { key: "requirement", label: labels.stepRequirement },
              { key: "send", label: labels.stepSend },
            ]}
          />
        </div>
      </header>

      <div className="grid gap-[var(--gutter)] py-6 lg:grid-cols-[minmax(0,1fr)_21.25rem] xl:grid-cols-[minmax(0,1fr)_24.25rem]">
        {/* ── Left column ───────────────────────────────────────────────── */}
        <div className="min-w-0 space-y-5">
          {seeded && (
            <p className="rounded-ctl border border-info-line bg-info-wash px-3.5 py-2.5 text-body-sm text-info-ink">
              {labels.seededNotice}
            </p>
          )}

          <section className="rounded-card border border-line bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-h3 text-ink">{labels.itemsTitle}</h2>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={lines.length >= MAX_LINES}
                onClick={() => setLines((current) => [...current, blankLine()])}
              >
                {labels.addAnother}
              </Button>
            </div>

            {/*
               A real table. Non-negotiable 4, and the row types are the point:
               a matched line carries its SKU and seller, a free-text line says
               it matched nothing. Never force a catalogue match — the spec
               calls that the fastest way to lose an RFQ.
            */}
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[30rem] border-collapse text-body-sm">
                <caption className="sr-only">{labels.itemsCaption}</caption>
                <thead>
                  <tr className="border-b border-line">
                    <Th>{labels.colProduct}</Th>
                    <Th className="w-24">{labels.colQty}</Th>
                    <Th className="w-36">{labels.colTarget}</Th>
                    <th scope="col" className="w-10">
                      <span className="sr-only">{labels.colRemove}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => (
                    <tr key={line.key} className="border-b border-line last:border-0 align-top">
                      <td className="py-2 pr-3">
                        <Input
                          aria-label={labels.lineDescription(index + 1)}
                          value={line.description}
                          placeholder={labels.linePlaceholder}
                          onChange={(e) => updateLine(line.key, { description: e.target.value })}
                        />
                        {line.description.trim() && (
                          <p className="mt-1 font-mono text-eyebrow uppercase tracking-eyebrow text-faint">
                            {line.productId && line.sellerName
                              ? [line.sku, `FROM ${line.sellerName.toUpperCase()}`]
                                  .filter(Boolean)
                                  .join(" · ")
                              : labels.unmatched}
                          </p>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <Input
                          type="number"
                          min={1}
                          inputMode="numeric"
                          aria-label={labels.lineQty(index + 1)}
                          value={String(line.qty)}
                          onChange={(e) =>
                            updateLine(line.key, { qty: Math.max(1, Number(e.target.value) || 1) })
                          }
                        />
                      </td>
                      <td className="py-2 pr-3">
                        {/*
                           The buyer's own budget, on their own line, inside a
                           private composer. `TARGET PRICE`, never `PRICE` and
                           never `BUDGET`. Optional, never validated, never
                           aggregated, never public — the no-price rule governs
                           what sellers publish, not what a buyer may state.
                        */}
                        <Input
                          inputMode="decimal"
                          aria-label={labels.lineTarget(index + 1)}
                          value={line.targetUnitPriceAed}
                          placeholder="—"
                          onChange={(e) =>
                            updateLine(line.key, { targetUnitPriceAed: e.target.value })
                          }
                        />
                      </td>
                      <td className="py-2">
                        {lines.length > 1 && (
                          <IconButton
                            label={labels.removeLine(index + 1)}
                            size="sm"
                            variant="ghost"
                            icon="×"
                            onClick={() =>
                              setLines((current) => current.filter((l) => l.key !== line.key))
                            }
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-caption text-body">{labels.targetHint}</p>
          </section>

          {/*
             Step 1: rendered, dimmed, disabled. The buyer sees what is coming
             and cannot fill it out of order. `disabled` rather than hidden, so
             the state reaches a screen reader too.
          */}
          <section
            className={cn(
              "rounded-card border border-line bg-card p-4 transition-opacity duration-120",
              !linesExist && "opacity-55",
            )}
          >
            <h2 className="text-h3 text-ink">{labels.requirementTitle}</h2>
            <div className="mt-3">
              <EnquiryComposer
                shape="panel"
                labels={enquiryLabels({ emirates })}
                initialRequirement={initialRequirement}
                askForContact={askForContact}
                disabled={!linesExist}
                onChange={setValue}
              />
            </div>
          </section>
        </div>

        {/* ── Right column ──────────────────────────────────────────────── */}
        <div className="min-w-0 space-y-4">
          <section className="rounded-card border border-line-strong bg-card">
            <div className="border-b border-line p-4">
              <h2 className="text-h3 text-ink">
                {linesExist ? labels.recipientsTitle(picked.length) : labels.recipientsEmpty}
              </h2>
              {linesExist && !none && (
                <p className="mt-1 text-caption text-body">{labels.recipientsMatchedOn}</p>
              )}
            </div>

            {none ? (
              <div className="space-y-2.5 p-4">
                <p className="text-body-sm text-body">{labels.zeroMatches}</p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={routed}
                  onClick={() =>
                    startTransition(async () => {
                      await routeUnmatched({
                        categoryId,
                        requirement: value?.requirement ?? "",
                        lines: filledLines(lines).map((l) => l.description.trim()),
                        emirate: value?.emirate ?? null,
                      });
                      setRouted(true);
                    })
                  }
                >
                  {routed ? labels.routed : labels.routeForMe}
                </Button>
              </div>
            ) : single ? (
              <div className="p-4">
                <p className="text-body-sm text-body">{labels.onlyOneMatch}</p>
              </div>
            ) : linesExist ? (
              <>
                <ul>
                  {shown.map((recipient) => (
                    <li key={recipient.businessId} className="border-b border-line px-4 py-2.5 last:border-0">
                      <Checkbox
                        checked={picked.includes(recipient.businessId)}
                        label={
                          <span className="flex flex-wrap items-baseline gap-x-2">
                            <span className="font-medium text-ink">{recipient.displayName}</span>
                            {recipient.pinned && (
                              <span className="text-caption text-muted">{labels.fromPage}</span>
                            )}
                          </span>
                        }
                        aria-label={labels.recipientPick(recipient.displayName)}
                        onChange={(e) =>
                          setPicked((current) =>
                            e.target.checked
                              ? // The cap is hard and it is stated on screen.
                                current.length >= 8
                                ? current
                                : [...current, recipient.businessId]
                              : current.filter((id) => id !== recipient.businessId),
                          )
                        }
                      />
                      <p className="ml-7 font-mono text-eyebrow uppercase tracking-eyebrow text-faint">
                        {recipient.verificationTier >= 3 ? "VISITED · " : ""}
                        {recipient.responseLabel}
                      </p>
                    </li>
                  ))}
                </ul>

                {more > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 bg-paper-sunk px-4 py-2.5">
                    <span className="text-caption text-body">{labels.recipientsMore(more)}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAll(true);
                        setPicked((current) => {
                          const next = [...current];
                          for (const r of recipients) {
                            if (next.length >= 8) break;
                            if (!next.includes(r.businessId)) next.push(r.businessId);
                          }
                          return next;
                        });
                      }}
                      className="rounded-tag text-caption font-medium text-moss underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                    >
                      {labels.recipientsAddAll}
                    </button>
                  </div>
                )}
                {picked.length >= 8 && (
                  <p className="px-4 py-2 text-caption text-body">{labels.capNote}</p>
                )}
              </>
            ) : null}
          </section>

          <section className="rounded-card bg-paper-sunk p-4">
            <h2 className="font-mono text-eyebrow uppercase tracking-eyebrow text-faint">
              {labels.howTitle}
            </h2>
            <ol className="mt-2 space-y-1.5">
              {labels.how.map((line, i) => (
                <li key={line} className="flex gap-2 text-caption text-body">
                  <span className="font-mono text-faint">{i + 1}</span>
                  <span>{line}</span>
                </li>
              ))}
            </ol>
          </section>

          {/* Desktop Send. Below 768 it is the sticky bar at the foot. */}
          <div className="hidden md:block">
            <SendBlock
              labels={labels}
              count={picked.length}
              blocked={blocked}
              pending={pending}
              error={error}
              onSend={submit}
            />
          </div>
        </div>
      </div>

      {/*
         Criterion 15: below 768 Send is a sticky 44px bar carrying the live
         count. This page is long on a phone and the action must travel with the
         buyer, exactly as board 1g's product page does.
      */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card px-4 py-2.5 shadow-overlay md:hidden">
        <SendBlock
          labels={labels}
          count={picked.length}
          blocked={blocked}
          pending={pending}
          error={error}
          onSend={submit}
          compact
        />
      </div>
    </div>
  );
}

function SendBlock({
  labels,
  count,
  blocked,
  pending,
  error,
  onSend,
  compact = false,
}: {
  labels: RfqComposerLabels;
  count: number;
  blocked: string | null;
  pending: boolean;
  error: string | null;
  onSend: () => void;
  compact?: boolean;
}) {
  return (
    <div>
      {error && (
        <p role="alert" className="mb-2 rounded-ctl border border-bad-line bg-bad-wash px-3 py-2 text-caption text-bad-ink">
          {error}
        </p>
      )}
      {/*
         Criterion 15: 44px on a phone. The default control height is 36, and a
         thumb does not get smaller because the button is in a bar.
      */}
      <Button
        type="button"
        block
        size={compact ? "lg" : "md"}
        loading={pending}
        disabled={Boolean(blocked)}
        onClick={onSend}
      >
        {/*
           The count appears once there is one. "Send to 0 sellers" is honest and
           reads like a bug; the plain label plus the reason underneath says the
           same thing without the arithmetic.
        */}
        {pending ? labels.sending : count > 0 ? labels.send(count) : labels.sendIdle}
      </Button>
      {/*
         Never a silent dead button. When Send is off the reason sits under it,
         which is the spec's rule for zero recipients and the right one for
         every other reason too.
      */}
      <p className={cn("mt-1.5 text-center text-caption", blocked ? "text-warn-ink" : "text-body")}>
        {blocked ?? labels.sendNote}
      </p>
      {compact && <span className="sr-only">{labels.sequence}</span>}
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cn(
        "py-2 pr-3 text-left font-mono text-eyebrow uppercase tracking-eyebrow text-faint",
        className,
      )}
    >
      {children}
    </th>
  );
}
