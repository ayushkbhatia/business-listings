"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Alert, StatusBadge, type StatusTone } from "@/components/display";
import { Button, Input, Radio, Select } from "@/components/primitives";
import { Modal, Panel } from "@/components/structure";
import { t } from "@/lib/i18n";
import type { InviteActionResult, TeamActionResult } from "./actions";

/**
 * Board 7d — the seat table, and the three things a seller does to it.
 *
 * Six columns, and the two that are new are the two the pair of screens exists
 * for. `OPEN` is board 3j's own count of that seat's unquoted leads, so the
 * column and the inbox are the same query — 7d §3 is explicit that if the two
 * disagree, "one of the screens is lying and the seller will find out".
 * `REACHABLE ON` is the other half: a seat with nothing verified is not a
 * routing target, and until this column existed the only way to discover that
 * was a lead that went nowhere.
 *
 * ## Everything is pre-resolved
 *
 * Labels arrive as strings and never as functions. A prop that is a function
 * cannot cross from a server component into this one — the repeated defect in
 * this codebase, and the one board 3k shipped a runtime error on.
 *
 * ## Removal asks where the leads go
 *
 * 7d §6.3: "not remove a seat with open leads silently — removal reassigns
 * first". The dialog states the count and makes the destination a choice, so
 * the confirm cannot be pressed without answering it. `removeSeat` refuses a
 * destination that cannot open an enquiry, which is the same orphan one door
 * along.
 */

export interface SeatRow {
  userId: string;
  name: string;
  /** The address or mobile under the name. Absent where the name is one. */
  contact: string | null;
  roleLabel: string;
  isOwner: boolean;
  isYou: boolean;
  /** Pre-resolved: "All 4 branches" or "Al Quoz only". */
  branchLabel: string;
  open: number;
  reachLabel: string;
  reachTone: StatusTone;
  /** "WhatsApp entered, not yet verified", or absent. */
  unverifiedNote: string | null;
  statusLabel: string;
  statusTone: StatusTone;
  removable: boolean;
  /** Whether this seat may be handed somebody else's leads. */
  canTakeLeads: boolean;
}

export interface InviteRow {
  id: string;
  /** The address or the mobile, whichever the invitation went to. */
  contact: string;
  roleLabel: string;
  branchLabel: string;
  statusLabel: string;
  statusTone: StatusTone;
  /** "Expires in 5 days", or the expired sentence. */
  timerLabel: string;
  expired: boolean;
}

/** What a successful invitation leaves on the screen. */
interface InviteOutcome {
  acceptUrl: string;
  emailed: boolean;
  email: string;
}

export interface TeamBoardProps {
  seats: readonly SeatRow[];
  invites: readonly InviteRow[];
  /** "1 invite pending", or absent when none is. The seat count is in the
   * page header, where 7d §1 puts it, and is not repeated here. */
  pendingLabel: string | null;
  /** Set when the plan has no seat left. The form is disabled and says why. */
  atCap: { reason: string; billingLabel: string } | null;
  /** Hidden entirely on a single-branch business — 8d §2, product-wide. */
  showBranchColumn: boolean;
  branches: readonly { id: string; label: string }[];
  roles: readonly { value: string; label: string }[];
  /** The reconciliation sentence, and the unassigned one under it. */
  openNote: string;
  unassignedNote: string | null;
  reachRule: string | null;
  inviteAction: (formData: FormData) => Promise<InviteActionResult>;
  revokeAction: (formData: FormData) => Promise<TeamActionResult>;
  resendAction: (formData: FormData) => Promise<TeamActionResult>;
  removeAction: (formData: FormData) => Promise<TeamActionResult>;
}

export function TeamBoard(props: TeamBoardProps) {
  const [notice, setNotice] = useState<string | null>(null);
  const [invited, setInvited] = useState<InviteOutcome | null>(null);
  const [copied, setCopied] = useState(false);
  const [removing, setRemoving] = useState<SeatRow | null>(null);
  const [takerId, setTakerId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: (f: FormData) => Promise<TeamActionResult>, form: FormData, fallback: string) {
    setError(null);
    startTransition(async () => {
      const result = await action(form);
      if (!result.ok) setError(result.error);
      else setNotice(result.message ?? fallback);
    });
  }

  function submitInvite(form: FormData) {
    setError(null);
    setInvited(null);
    setCopied(false);
    startTransition(async () => {
      const result = await props.inviteAction(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setInvited({ acceptUrl: result.acceptUrl, emailed: result.emailed, email: result.email });
    });
  }

  function openRemove(seat: SeatRow) {
    /*
       The queue is pre-selected rather than a colleague. Handing twelve leads
       to whoever happens to sort first is a decision the screen would be making
       on the seller's behalf; the unassigned queue is the one destination that
       claims nothing about who should pick them up.
    */
    setTakerId("");
    setRemoving(seat);
  }

  function confirmRemove(seat: SeatRow) {
    const form = new FormData();
    form.set("userId", seat.userId);
    if (takerId) form.set("reassignToId", takerId);
    setRemoving(null);
    run(props.removeAction, form, t("invite.removed", { name: seat.name }));
  }

  const takers = removing
    ? props.seats.filter((seat) => seat.canTakeLeads && seat.userId !== removing.userId)
    : [];

  return (
    <div className="flex flex-col gap-[var(--gutter)]">
      {error && <Alert tone="bad" live="assertive">{error}</Alert>}

      <Panel
        /*
           "Your team" rather than "Team", which is the page's own title eighty
           pixels above it. Two headings reading the same word is a screen that
           looks like it lost its layout.
        */
        title={t("team.caption")}
        {...(props.pendingLabel ? { description: props.pendingLabel } : {})}
        padded={false}
      >
        <div className="overflow-x-auto contain-paint">
          <table className="w-full min-w-[52rem] border-collapse text-left">
            <caption className="sr-only">{t("team.caption")}</caption>
            <thead>
              <tr className="bg-paper-sunk">
                <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">
                  {t("team.col.person")}
                </th>
                <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">
                  {t("team.col.role")}
                </th>
                {props.showBranchColumn && (
                  <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">
                    {t("team.col.branch")}
                  </th>
                )}
                <th scope="col" className="w-16 px-3 py-2 text-caption font-normal text-muted">
                  {t("team.col.open")}
                </th>
                <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">
                  {t("team.col.reachable")}
                </th>
                <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">
                  {t("team.col.status")}
                </th>
                {/*
                  A column of its own. The revoke button used to sit in the
                  reply-time cell, under a head that said "Median reply time" —
                  a column head that names something other than what is under it
                  is the sort of small untruth a directory cannot afford.
                */}
                <th scope="col" className="w-28 px-3 py-2 text-caption font-normal text-muted">
                  <span className="sr-only">{t("table.actions_header")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {props.seats.map((seat) => (
                <tr key={seat.userId} className="border-t border-line align-top">
                  <th scope="row" className="px-3 py-3 text-left font-normal">
                    <span className="block text-body-sm text-ink">
                      {seat.name}
                      {seat.isYou && (
                        <span className="ml-1.5 font-mono text-eyebrow uppercase text-faint">
                          {t("team.you")}
                        </span>
                      )}
                    </span>
                    {seat.contact && (
                      <span className="mt-0.5 block font-mono text-caption text-faint">
                        {seat.contact}
                      </span>
                    )}
                  </th>
                  <td className="px-3 py-3 text-body-sm text-ink">{seat.roleLabel}</td>
                  {props.showBranchColumn && (
                    <td className="px-3 py-3 text-body-sm text-ink">{seat.branchLabel}</td>
                  )}
                  <td className="px-3 py-3 font-mono tabular-nums text-body-sm text-ink">
                    {seat.open}
                  </td>
                  <td className="px-3 py-3">
                    <StatusBadge tone={seat.reachTone} size="sm" shape="chip">
                      {seat.reachLabel}
                    </StatusBadge>
                    {seat.unverifiedNote && (
                      <span className="mt-1 block text-caption text-muted">
                        {seat.unverifiedNote}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <StatusBadge tone={seat.statusTone} size="sm" shape="chip">
                      {seat.statusLabel}
                    </StatusBadge>
                  </td>
                  <td className="px-3 py-3">
                    {/*
                      Named with the person it acts on. A table of seven rows
                      otherwise offers seven buttons called "Remove the seat",
                      which is seven controls a screen-reader user cannot tell
                      apart — the fault board 3k fixed on its own row actions.
                    */}
                    {seat.removable && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={pending}
                        aria-label={t("team.remove_aria", { name: seat.name })}
                        onClick={() => openRemove(seat)}
                      >
                        {t("invite.remove_seat")}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}

              {props.invites.map((invite) => (
                <tr key={invite.id} className="border-t border-line align-top">
                  <th scope="row" className="px-3 py-3 text-left font-normal">
                    <span className="block text-body-sm text-muted">{invite.contact}</span>
                    <span className="mt-0.5 block text-caption text-faint">{invite.timerLabel}</span>
                  </th>
                  <td className="px-3 py-3 text-body-sm text-muted">{invite.roleLabel}</td>
                  {props.showBranchColumn && (
                    <td className="px-3 py-3 text-body-sm text-muted">{invite.branchLabel}</td>
                  )}
                  {/*
                    Empty on purpose. Nobody who has not taken the seat holds a
                    lead, and a zero here would read as a seat that is being
                    given nothing rather than one that does not exist yet.
                  */}
                  <td className="px-3 py-3" />
                  <td className="px-3 py-3 text-caption text-muted">
                    {t("team.reach.not_lead_seat")}
                  </td>
                  <td className="px-3 py-3">
                    <StatusBadge tone={invite.statusTone} size="sm" shape="chip">
                      {invite.statusLabel}
                    </StatusBadge>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col gap-1.5">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={pending}
                        aria-label={t("team.resend_aria", { contact: invite.contact })}
                        onClick={() => {
                          const form = new FormData();
                          form.set("id", invite.id);
                          form.set("contact", invite.contact);
                          form.set("expired", String(invite.expired));
                          run(props.resendAction, form, t("routing.saved"));
                        }}
                      >
                        {t("team.resend")}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={pending}
                        aria-label={t("team.revoke_aria", { contact: invite.contact })}
                        onClick={() => {
                          const form = new FormData();
                          form.set("id", invite.id);
                          run(props.revokeAction, form, t("routing.saved"));
                        }}
                      >
                        {t("team.revoke")}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/*
          The region is always in the DOM and only its contents change.
          Mounting an aria-live element together with its first message is how a
          confirmation goes unannounced in most screen readers.
        */}
        <div aria-live="polite">
          {notice && (
            <p className="border-t border-line px-3 py-2.5 text-caption text-muted">{notice}</p>
          )}
        </div>

        <div className="flex flex-col gap-1 border-t border-line px-3 py-2.5">
          <p className="text-caption text-muted">
            {props.openNote}{" "}
            <Link
              href="/dashboard/leads"
              className="underline underline-offset-2 focus-visible:outline-none focus-visible:shadow-focus"
            >
              {t("team.open_link")}
            </Link>
          </p>
          {props.unassignedNote && (
            <p className="text-caption text-muted">{props.unassignedNote}</p>
          )}
          {props.reachRule && <p className="text-caption text-warn-ink">{props.reachRule}</p>}
        </div>
      </Panel>

      <Panel title={t("team.invite")}>
        <div className="flex flex-col gap-4">
          {/*
            Disabled with the reason and a way out, rather than a form that
            opens and fails on submit. 7d §3: "do not let the form open and fail
            on submit" — the refusal is the same either way, and only one of the
            two tells the seller before they have typed a colleague's address.
          */}
          {props.atCap ? (
            <Alert
              tone="warn"
              title={props.atCap.reason}
              action={
                <Link
                  href="/dashboard/billing"
                  className="text-body-sm underline underline-offset-2 focus-visible:outline-none focus-visible:shadow-focus"
                >
                  {props.atCap.billingLabel}
                </Link>
              }
            >
              {t("team.at_cap_billing")}
            </Alert>
          ) : (
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                submitInvite(new FormData(event.currentTarget));
              }}
            >
              <label className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-body-sm text-ink">{t("team.invite_email")}</span>
                <Input name="email" type="email" required />
              </label>
              <label className="flex w-44 flex-col gap-1">
                <span className="text-body-sm text-ink">{t("team.invite_role")}</span>
                <Select name="role" defaultValue="seller_sales" options={[...props.roles]} />
              </label>
              {/*
                Only where there is more than one branch to choose between.
                8d §2 hides branch pickers product-wide on a single-branch
                business, and a select with one option is a question with one
                answer.
              */}
              {props.showBranchColumn && (
                <label className="flex w-44 flex-col gap-1">
                  <span className="text-body-sm text-ink">{t("team.invite_branch")}</span>
                  <Select
                    name="branchId"
                    defaultValue=""
                    options={[
                      { value: "", label: t("team.invite_branch_all") },
                      ...props.branches.map((branch) => ({
                        value: branch.id,
                        label: branch.label,
                      })),
                    ]}
                  />
                </label>
              )}
              <Button type="submit" disabled={pending}>
                {t("team.invite_send")}
              </Button>
            </form>
          )}

          {invited && (
            <div className="flex flex-col gap-3 border-t border-line pt-4">
              {/*
                The invitation exists either way, which is what the lead-in
                says; the sentence under it says what became of the email. The
                copy control is the notice's action rather than a second button
                beside the link, because on the failed path it is literally the
                fix the tone owes the reader — see components/display/Alert.tsx.
              */}
              <Alert
                tone={invited.emailed ? "ok" : "warn"}
                live="polite"
                title={t("team.invited")}
                action={
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      /*
                         Optimistic, and the failure is silent.
                         `navigator.clipboard` is absent on an insecure origin
                         and rejects when the document is not focused, and
                         neither is worth a red notice over a convenience — the
                         link is printed below in full either way, which is the
                         reason it is printed rather than hidden behind the
                         button.
                      */
                      void navigator.clipboard?.writeText(invited.acceptUrl).catch(() => {});
                      setCopied(true);
                    }}
                  >
                    {copied ? t("invite.link_copied") : t("invite.copy")}
                  </Button>
                }
              >
                {invited.emailed
                  ? t("invite.email_sent", { email: invited.email })
                  : t("invite.email_failed")}
              </Alert>

              <div className="flex flex-col gap-1">
                <p className="font-mono text-eyebrow uppercase text-faint">
                  {t("invite.link_label")}
                </p>
                {/*
                  Mono and breakable. The token is a machine string, and a link
                  that overflows its panel is a link the owner cannot check
                  against the one they pasted.
                */}
                <p className="break-all font-mono text-body-sm text-ink">{invited.acceptUrl}</p>
                {/*
                  The warning is the point of the line, not a footnote to it.
                  The token is the whole authority — anybody holding it can take
                  the seat — so the copy says to send it to that person and
                  nobody else.
                */}
                <p className="max-w-prose text-caption text-muted">{t("invite.link_hint")}</p>
              </div>
            </div>
          )}
        </div>
      </Panel>

      {/*
        Removal is reversible only by inviting the person back, so it asks
        first. Cancel sits left and is never red, and the confirm repeats the
        verb rather than saying OK — design-system §05, and the same shape as
        the destructive confirm in the gallery.
      */}
      <Modal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        size="sm"
        title={t("invite.remove_confirm", { name: removing?.name ?? "" })}
        description={t("invite.remove_body")}
        closeLabel={t("lead.close")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              {t("action.cancel")}
            </Button>
            <Button
              variant="danger"
              disabled={pending}
              onClick={() => {
                if (removing) confirmRemove(removing);
              }}
            >
              {t("invite.remove_seat")}
            </Button>
          </>
        }
      >
        {removing && (
          <div className="flex flex-col gap-3">
            <p className="text-body-sm text-ink">
              {removing.open > 0
                ? t("team.remove_open", { name: removing.name, count: removing.open })
                : t("team.remove_none", { name: removing.name })}
            </p>
            <fieldset className="min-w-0 border-0 p-0">
              <legend className="mb-2 text-body-sm text-ink">{t("team.remove_heading")}</legend>
              <div className="flex flex-col gap-2">
                <Radio
                  name="reassign"
                  value=""
                  checked={takerId === ""}
                  onChange={() => setTakerId("")}
                  label={t("team.remove_to_queue")}
                />
                {takers.map((taker) => (
                  <Radio
                    key={taker.userId}
                    name="reassign"
                    value={taker.userId}
                    checked={takerId === taker.userId}
                    onChange={() => setTakerId(taker.userId)}
                    label={t("team.remove_to_seat", { name: taker.name })}
                  />
                ))}
              </div>
            </fieldset>
          </div>
        )}
      </Modal>
    </div>
  );
}
