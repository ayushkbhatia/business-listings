"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Select, Textarea, buttonClassName } from "@/components/primitives";
import { Modal } from "@/components/structure";
import { assignLeadAction, clearOutcomeAction, markOutcomeAction } from "./actions";

/**
 * Board 3j §4 — the request header's actions.
 *
 * `Assign`, the bridge into the thread, and the two outcome buttons. The board
 * drew `Mark won` missing while the tab bar counted `Won 14`, so nothing on the
 * screen could produce the number it was showing.
 *
 * Every string arrives already translated and every label is a plain value.
 * Nothing here calls `t()`, and nothing imports from `_shell.tsx`, which is
 * `server-only` — a type import alone would fail the build.
 *
 * ## The green one
 *
 * "Message the buyer", not "chat with the seller". The person reading this
 * screen *is* the seller; the counterparty is the buyer, and buyer/seller is the
 * vocabulary `check:vocabulary` and CLAUDE.md both police. It is `primary`
 * because moss marks action, and it is the action a seller reaches for when a
 * line needs a question before it can be priced.
 */

export interface SeatChoice {
  value: string;
  label: string;
}

export interface LeadActionsLabels {
  assign: string;
  assignLabel: string;
  messageBuyer: string;
  markWon: string;
  markLost: string;
  reopen: string;
  lostTitle: string;
  lostReasonLabel: string;
  lostReasonPlaceholder: string;
  lostReasonOptional: string;
  lostConfirm: string;
  cancel: string;
  closeLabel: string;
  noValueNote: string;
}

export function LeadActions({
  enquiryId,
  threadHref,
  seats,
  assignedToId,
  outcome,
  canAssign,
  canMark,
  labels,
}: {
  enquiryId: string;
  threadHref: string;
  seats: readonly SeatChoice[];
  assignedToId: string | null;
  outcome: "won" | "lost" | null;
  canAssign: boolean;
  /** False for a seat that may reply but not close somebody else's lead. */
  canMark: boolean;
  labels: LeadActionsLabels;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [lostOpen, setLostOpen] = useState(false);
  const [reason, setReason] = useState("");

  function run(work: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await work();
      if (result.ok) router.refresh();
      else setError(result.error ?? null);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {canAssign ? (
          <Select
            size="sm"
            aria-label={labels.assignLabel}
            value={assignedToId ?? ""}
            disabled={pending || outcome !== null}
            options={seats}
            onChange={(event) => {
              const next = event.target.value;
              run(() =>
                assignLeadAction({ enquiryId, assignedToId: next === "" ? null : next }),
              );
            }}
          />
        ) : null}

        {/*
          The bridge board 3j §2 requires in both directions: this screen carries
          the way into the conversation, and the thread carries `Revise quote`
          back. A seller who decides an RFQ needs a question answered first must
          not be stuck in a composer.
        */}
        <Link href={threadHref} className={buttonClassName({ size: "sm" })}>
          {labels.messageBuyer}
        </Link>

        {canMark && outcome === null ? (
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={pending}
              onClick={() => run(() => markOutcomeAction({ enquiryId, outcome: "won" }))}
            >
              {labels.markWon}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => {
                setError(null);
                setLostOpen(true);
              }}
            >
              {labels.markLost}
            </Button>
          </>
        ) : null}

        {canMark && outcome !== null ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={pending}
            onClick={() => run(() => clearOutcomeAction(enquiryId))}
          >
            {labels.reopen}
          </Button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="max-w-[42ch] text-right text-caption text-bad-ink">
          {error}
        </p>
      ) : null}

      <Modal
        open={lostOpen}
        onClose={() => setLostOpen(false)}
        title={labels.lostTitle}
        description={labels.noValueNote}
        closeLabel={labels.closeLabel}
        size="sm"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setLostOpen(false)}>
              {labels.cancel}
            </Button>
            <Button
              type="button"
              loading={pending}
              onClick={() => {
                setLostOpen(false);
                run(() => markOutcomeAction({ enquiryId, outcome: "lost", reason }));
              }}
            >
              {labels.lostConfirm}
            </Button>
          </>
        }
      >
        <label className="block space-y-1.5">
          <span className="block text-body-sm text-ink">{labels.lostReasonLabel}</span>
          <Textarea
            rows={3}
            placeholder={labels.lostReasonPlaceholder}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <span className="mt-1 block text-caption text-muted">{labels.lostReasonOptional}</span>
        </label>
      </Modal>
    </div>
  );
}
