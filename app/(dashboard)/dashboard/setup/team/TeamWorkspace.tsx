"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/primitives";
import { cn } from "@/lib/cn";
import { readContact } from "@/lib/team/contact";
import { TaskChrome, type TaskSegment } from "../_task-chrome";
import { TeamRows, type BranchOption, type SentInvite, type TeamRowsLabels } from "./TeamRows";
import type { DraftRow, SendResult } from "./actions";

/**
 * Board 8d, assembled — because the primary and the rows are one state.
 *
 * The send button counts valid draft rows and lives in the chrome; the rows
 * live in the body. Splitting them across a server boundary would have meant
 * either a second header or a round trip per keystroke, so the whole screen is
 * one client component and the page hands it finished strings.
 *
 * Nothing here calls `t()` or formats a number. `readContact` is pure and is
 * the one thing that must run on both sides: the row states its channel as the
 * seller types, and the server resolves it again because a client-side check is
 * a courtesy rather than a rule.
 */

export interface TeamWorkspaceLabels extends TeamRowsLabels {
  name: string;
  skip: string;
  title: string;
  intro: string;
  tickNote: string;
  routingTitle: string;
  routingNote: string;
  escalationNote: string;
  routingOptions: readonly { value: string; label: string }[];
  whatEyebrow: string;
  whatBody: string;
  moneyTitle: string;
  moneyBody: string;
  /** "Send 2 invites & back to setup" for each plausible count, pre-formatted. */
  sendFor: readonly string[];
  sendNone: string;
  someFailedFor: readonly string[];
}

export interface TeamWorkspaceProps {
  labels: TeamWorkspaceLabels;
  segments: readonly TaskSegment[];
  openCount: number;
  done: boolean;
  branches: readonly BranchOption[];
  sent: readonly SentInvite[];
  seatsLeft: number;
  atCap: boolean;
  suspended: boolean;
  routing: string;
  /**
   * Posted back with the routing mode, because `saveRouting` writes both.
   *
   * Sending a constant here would quietly reset a supplier who had chosen 30
   * minutes in Team settings the first time they touched a routing chip.
   */
  escalationMinutes: number;
  send: (rows: DraftRow[]) => Promise<SendResult>;
  resend: (formData: FormData) => Promise<{ ok: boolean; error?: string }>;
  revoke: (formData: FormData) => Promise<{ ok: boolean }>;
  saveRouting: (formData: FormData) => Promise<{ ok: boolean }>;
}

/** §9: first run shows two empty rows, not one. */
const START: DraftRow[] = [
  { contact: "", role: "seller_sales", branchId: null },
  { contact: "", role: "seller_sales", branchId: null },
];

export function TeamWorkspace({
  labels,
  segments,
  openCount,
  done,
  branches,
  sent,
  seatsLeft,
  atCap,
  suspended,
  routing,
  escalationMinutes,
  send,
  resend,
  revoke,
  saveRouting,
}: TeamWorkspaceProps) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [rows, setRows] = useState<DraftRow[]>(START);
  const [failures, setFailures] = useState<SendResult["failed"]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState(routing);

  const valid = rows.filter((row) => readContact(row.contact).ok).length;

  function sendAll(): void {
    setNotice(null);
    startTransition(async () => {
      const result = await send(rows);
      setFailures(result.failed);

      /*
         §4: one invalid row does not block the send. The valid ones go, the
         invalid one stays on screen with its error, and the seller is told how
         many went — rather than being made to retype the rows that were right.
      */
      if (result.failed.length > 0) {
        setNotice(labels.someFailedFor[Math.min(result.sent, labels.someFailedFor.length - 1)] ?? null);
        setRows(rows.filter((_, index) => result.failed.some((entry) => entry.index === index)));
        router.refresh();
        return;
      }

      /*
         Everything went. §4: the one press both sends and returns — and the
         count rides along so the hub confirms what happened rather than the
         seller inferring it from a tick.
      */
      router.push(result.sent > 0 ? `/dashboard/setup?sent=${result.sent}` : "/dashboard/setup");
    });
  }

  const primaryLabel =
    valid === 0 ? labels.sendNone : (labels.sendFor[Math.min(valid, labels.sendFor.length - 1)] ?? labels.sendNone);

  return (
    <TaskChrome
      name={labels.name}
      segments={segments}
      openCount={openCount}
      done={done}
      skipLabel={labels.skip}
      primary={
        /*
           Never disabled at zero. §4: with no valid rows it reads "Back to
           setup" and is secondary-weighted — a disabled primary on a screen a
           seller may legitimately be leaving is a dead end.
        */
        <Button
          variant={valid === 0 ? "secondary" : "primary"}
          size="md"
          loading={busy}
          onClick={() => (valid === 0 ? router.push("/dashboard/setup") : sendAll())}
        >
          {primaryLabel}
        </Button>
      }
    >
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          <div>
            <h2 className="text-h1 text-ink">{labels.title}</h2>
            <p className="mt-2 max-w-prose text-body-sm text-body">{labels.intro}</p>
          </div>

          {notice && (
            <p role="status" className="text-body-sm text-warn-ink">
              {notice}
            </p>
          )}

          <TeamRows
            labels={labels}
            branches={branches}
            sent={sent}
            seatsLeft={seatsLeft}
            atCap={atCap}
            disabled={suspended || busy}
            rows={rows}
            onRowsChange={setRows}
            failures={failures}
            resend={resend}
            revoke={revoke}
          />

          {/*
            §5, stated rather than discovered. The task ticks on send and the
            points wait for an active seat, so the checkbox and the meter
            disagree for as long as an invitation sits unaccepted — which the
            board calls the most likely support ticket on this screen.
          */}
          <p className="text-caption text-muted">{labels.tickNote}</p>

          <section
            aria-labelledby="routing"
            className="rounded-card border border-line bg-card px-5 py-4"
          >
            <h3 id="routing" className="text-body-sm font-medium text-ink">
              {labels.routingTitle}
            </h3>
            <div role="radiogroup" aria-labelledby="routing" className="mt-3 flex flex-wrap gap-2">
              {labels.routingOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={mode === option.value}
                  disabled={suspended || busy}
                  onClick={() => {
                    setMode(option.value);
                    const form = new FormData();
                    form.set("routing", option.value);
                    form.set("escalationMinutes", String(escalationMinutes));
                    startTransition(async () => {
                      await saveRouting(form);
                      router.refresh();
                    });
                  }}
                  className={cn(
                    "rounded-ctl border px-4 py-2 text-body-sm transition-colors duration-120 ease-out focus-visible:outline-none focus-visible:shadow-focus",
                    mode === option.value
                      ? "border-ink bg-ink font-medium text-on-ink"
                      : "border-line-strong bg-card text-ink hover:bg-fill",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="mt-3 text-caption text-muted">
              {labels.routingNote} {labels.escalationNote}
            </p>
          </section>
        </div>

        <aside className="flex w-full shrink-0 flex-col gap-3.5 lg:w-[400px]">
          <div className="rounded-card border border-line bg-card px-5 py-4">
            <p className="font-mono text-eyebrow uppercase text-muted">{labels.whatEyebrow}</p>
            <p className="mt-3 text-body-sm text-body">{labels.whatBody}</p>
          </div>
          <div className="rounded-card border border-line bg-paper-sunk px-5 py-4">
            <p className="text-body-sm font-medium text-ink">{labels.moneyTitle}</p>
            <p className="mt-2 text-body-sm text-body">{labels.moneyBody}</p>
          </div>
        </aside>
      </div>
    </TaskChrome>
  );
}
