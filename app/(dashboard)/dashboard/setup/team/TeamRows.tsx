"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, buttonClassName } from "@/components/primitives";
import { cn } from "@/lib/cn";
import { readContact } from "@/lib/team/contact";
import type { DraftRow, SendResult } from "./actions";

/**
 * The draft rows on board 8d, and the one button that reaches anybody.
 *
 * Every label arrives translated. This component calls no `t()` and formats
 * nothing — the repeated defect in this codebase is a formatter crossing the
 * server/client boundary, and a count rendered here would differ between
 * prerender and hydration.
 *
 * `readContact` is the exception and is safe: it is pure, has no database and no
 * `server-only`, and the whole point is that the row states the channel **as
 * the seller types** rather than after a round trip. The server runs the same
 * function again, because a client-side check is a courtesy rather than a rule.
 */

export interface BranchOption {
  id: string;
  label: string;
}

export interface SentInvite {
  id: string;
  contact: string;
  role: string;
  /** "Sent 2 days ago", formatted by the caller. */
  sentAgo: string;
}

export interface TeamRowsLabels {
  contact: string;
  contactPlaceholder: string;
  role: string;
  branch: string;
  allBranches: string;
  removeRow: string;
  addPerson: string;
  byWhatsApp: string;
  byEmail: string;
  ambiguous: string;
  sentRows: string;
  resend: string;
  resent: string;
  revoke: string;
  roleManager: string;
  roleSales: string;
  /** "2 of 5 seats used on Pro", already assembled. */
  seatsUsed: string;
  seePricing: string;
}

export interface TeamRowsProps {
  labels: TeamRowsLabels;
  branches: readonly BranchOption[];
  sent: readonly SentInvite[];
  /** How many more rows the plan has room for. Zero disables adding. */
  seatsLeft: number;
  atCap: boolean;
  disabled: boolean;
  onRowsChange: (rows: DraftRow[]) => void;
  rows: DraftRow[];
  failures: SendResult["failed"];
  resend: (formData: FormData) => Promise<{ ok: boolean; error?: string }>;
  revoke: (formData: FormData) => Promise<{ ok: boolean }>;
}

export function TeamRows({
  labels,
  branches,
  sent,
  seatsLeft,
  atCap,
  disabled,
  rows,
  onRowsChange,
  failures,
  resend,
  revoke,
}: TeamRowsProps) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);

  /*
     Hidden entirely on a single-branch business. §2 says so and gives the
     reason: it is noise, and it makes "Nearest branch" below meaningless too.
  */
  const showBranch = branches.length > 1;

  function update(index: number, patch: Partial<DraftRow>): void {
    onRowsChange(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  }

  return (
    <div className="flex flex-col gap-3">
      {sent.length > 0 && (
        <section aria-labelledby="sent-invites" className="flex flex-col gap-2">
          <h3 id="sent-invites" className="font-mono text-eyebrow uppercase text-muted">
            {labels.sentRows}
          </h3>
          {notice && (
            <p role="status" className="text-caption text-warn-ink">
              {notice}
            </p>
          )}
          <ul className="flex list-none flex-col gap-2">
            {sent.map((invite) => (
              <li
                key={invite.id}
                className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-paper-sunk px-4 py-3"
              >
                <span className="text-body-sm text-ink">{invite.contact}</span>
                <span className="text-caption text-muted">{invite.role}</span>
                <span className="text-caption text-faint">{invite.sentAgo}</span>
                <span className="ms-auto flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      const form = new FormData();
                      form.set("id", invite.id);
                      startTransition(async () => {
                        const result = await resend(form);
                        setNotice(result.ok ? labels.resent : (result.error ?? null));
                        router.refresh();
                      });
                    }}
                  >
                    {labels.resend}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      const form = new FormData();
                      form.set("id", invite.id);
                      // The notice belongs to the action that raised it. A
                      // "you can send it again in an hour" left standing over a
                      // revoked row describes nothing on screen.
                      setNotice(null);
                      startTransition(async () => {
                        await revoke(form);
                        router.refresh();
                      });
                    }}
                  >
                    {labels.revoke}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {rows.map((row, index) => {
        const read = readContact(row.contact);
        const failure = failures.find((entry) => entry.index === index);
        const channelLine =
          read.ok && read.channel === "whatsapp"
            ? labels.byWhatsApp
            : read.ok
              ? labels.byEmail
              : null;

        return (
          <div
            key={index}
            className="flex flex-wrap items-end gap-3 rounded-card border border-line bg-card px-4 py-4"
          >
            <label className="min-w-[200px] flex-1">
              <span className="block text-caption text-body">{labels.contact}</span>
              <input
                type="text"
                value={row.contact}
                placeholder={labels.contactPlaceholder}
                disabled={disabled}
                onChange={(event) => update(index, { contact: event.target.value })}
                className="mt-1 w-full rounded-ctl border border-line-strong bg-card px-3 py-2 text-body-sm text-ink focus-visible:outline-none focus-visible:shadow-focus disabled:text-disabled-text"
              />
              {/*
                Stated per row and resolved live. The board's rail used to
                promise "a WhatsApp with a link" while the field took an
                address — and the two channels cost different money, so the
                honest version is also the cheaper one to get wrong.
              */}
              {channelLine && (
                <span className="mt-1 block text-caption text-muted">{channelLine}</span>
              )}
              {!read.ok && read.reason === "ambiguous" && (
                <span className="mt-1 block text-caption text-bad-ink">{labels.ambiguous}</span>
              )}
              {failure && (
                <span role="alert" className="mt-1 block text-caption text-bad-ink">
                  {failure.error}
                </span>
              )}
            </label>

            <label className="w-[150px]">
              <span className="block text-caption text-body">{labels.role}</span>
              <select
                value={row.role}
                disabled={disabled}
                onChange={(event) => update(index, { role: event.target.value })}
                className="mt-1 w-full rounded-ctl border border-line-strong bg-card px-3 py-2 text-body-sm text-ink focus-visible:outline-none focus-visible:shadow-focus"
              >
                <option value="seller_sales">{labels.roleSales}</option>
                <option value="seller_manager">{labels.roleManager}</option>
              </select>
            </label>

            {showBranch && (
              <label className="w-[190px]">
                <span className="block text-caption text-body">{labels.branch}</span>
                <select
                  value={row.branchId ?? ""}
                  disabled={disabled}
                  onChange={(event) =>
                    update(index, { branchId: event.target.value === "" ? null : event.target.value })
                  }
                  className="mt-1 w-full rounded-ctl border border-line-strong bg-card px-3 py-2 text-body-sm text-ink focus-visible:outline-none focus-visible:shadow-focus"
                >
                  <option value="">{labels.allBranches}</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <Button
              variant="secondary"
              size="md"
              disabled={disabled || rows.length === 1}
              aria-label={labels.removeRow}
              onClick={() => onRowsChange(rows.filter((_, at) => at !== index))}
            >
              ×
            </Button>
          </div>
        );
      })}

      <div
        className={cn(
          "flex flex-wrap items-center gap-3 rounded-card border border-dashed border-line-strong px-4 py-3",
          atCap && "opacity-70",
        )}
      >
        <button
          type="button"
          disabled={disabled || atCap || seatsLeft <= rows.length}
          onClick={() =>
            onRowsChange([...rows, { contact: "", role: "seller_sales", branchId: null }])
          }
          className="text-body-sm font-medium text-moss underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus disabled:text-disabled-text disabled:no-underline"
        >
          {labels.addPerson}
        </button>
        <span className="ms-auto text-caption text-muted">{labels.seatsUsed}</span>
        {atCap && (
          <Link href="/pricing" className={buttonClassName({ variant: "link", size: "sm" })}>
            {labels.seePricing}
          </Link>
        )}
      </div>
    </div>
  );
}
