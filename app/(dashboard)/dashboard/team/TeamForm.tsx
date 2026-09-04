"use client";

import { Alert } from "@/components/display";
import { useState, useTransition } from "react";
import { Button, Input, Radio, Select } from "@/components/primitives";
import { Modal, Panel } from "@/components/structure";
import { formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { InviteActionResult, TeamActionResult } from "./actions";

/**
 * Board 7d — the team, the routing, and the uncomfortable number.
 *
 * The per-person reply times include the owner's, and the board asks for that
 * explicitly. A dashboard that measures everybody except the person reading it
 * is a dashboard nobody trusts about anything else either.
 *
 * Two things the screen used to hide from the owner now sit on it.
 *
 * **The link.** `inviteSeat` minted a token, sent an email with it, and the
 * screen kept neither — so an owner whose invitation landed in a spam folder
 * had no way at all to get their colleague in, not even a resend, because
 * re-inviting mints a new token and the old one stops working. The link is
 * printed whether or not the email left, because the owner needs it in both
 * cases and only learns which case they are in from the line above it.
 *
 * **Removal.** docs/permissions.md §07 has always said the owner may "invite or
 * remove team members" and only the first half existed, so a colleague seated
 * by mistake kept every enquiry, quote and buyer contact on the listing for
 * good.
 */

export interface SeatRow {
  id: string;
  name: string | null;
  email: string | null;
  roles: string[];
  medianReplyMs: number | null;
  isOwner: boolean;
}

export interface InviteRow {
  id: string;
  /** The address or the mobile, whichever the invitation went to. */
  contact: string;
  roles: string[];
}

/** What a successful invitation leaves on the screen. */
interface InviteOutcome {
  acceptUrl: string;
  emailed: boolean;
  email: string;
}

export interface TeamFormProps {
  seats: readonly SeatRow[];
  invites: readonly InviteRow[];
  /**
   * The reader's own user id. Their row offers no remove control — see the
   * comment on `canRemove` for why the screen decides that and the service
   * decides it again.
   */
  currentUserId: string;
  routing: string;
  escalationMinutes: number;
  escalationChoices: readonly number[];
  seatsUsed: number;
  seatCap: number;
  inviteAction: (formData: FormData) => Promise<InviteActionResult>;
  revokeAction: (formData: FormData) => Promise<TeamActionResult>;
  removeAction: (formData: FormData) => Promise<TeamActionResult>;
  routingAction: (formData: FormData) => Promise<TeamActionResult>;
}

const ROLES = ["seller_manager", "seller_sales", "seller_finance"] as const;
const ROUTING = ["everyone", "round_robin", "by_branch"] as const;

/** What to call somebody in their row and in a sentence about them. */
function seatLabel(seat: SeatRow): string {
  return seat.name ?? seat.email ?? "";
}

export function TeamForm(props: TeamFormProps) {
  const [routing, setRouting] = useState(props.routing);
  const [escalation, setEscalation] = useState(props.escalationMinutes);
  const [notice, setNotice] = useState<string | null>(null);
  const [seatNotice, setSeatNotice] = useState<string | null>(null);
  const [invited, setInvited] = useState<InviteOutcome | null>(null);
  const [copied, setCopied] = useState(false);
  const [removing, setRemoving] = useState<SeatRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /*
   * The owner is slowest, and there is somebody to be slower than.
   *
   * With one measured person the owner is trivially the slowest, and printing
   * the line then dresses an arithmetic certainty as a finding. Two is the
   * minimum at which the sentence says anything.
   */
  const measured = [...props.seats]
    .filter((s) => s.medianReplyMs !== null)
    .sort((a, b) => (b.medianReplyMs ?? 0) - (a.medianReplyMs ?? 0));
  const ownerIsSlowest = measured.length > 1 && (measured[0]?.isOwner ?? false);

  /*
     `say` defaults to the notice under the routing form, which is where the
     routing and the revoke confirmations have always landed. A removal happens
     at the top of the page and is told about there instead: a confirmation two
     panels away from the row that changed is a confirmation nobody reads.
  */
  function run(
    action: (f: FormData) => Promise<TeamActionResult>,
    form: FormData,
    ok: string,
    say: (message: string) => void = setNotice,
  ) {
    setError(null);
    startTransition(async () => {
      const result = await action(form);
      if (!result.ok) setError(result.error);
      else say(ok);
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
      setInvited({
        acceptUrl: result.acceptUrl,
        emailed: result.emailed,
        email: result.email,
      });
    });
  }

  function confirmRemove(seat: SeatRow) {
    const form = new FormData();
    form.set("userId", seat.id);
    setRemoving(null);
    run(props.removeAction, form, t("invite.removed", { name: seatLabel(seat) }), setSeatNotice);
  }

  return (
    <div className="flex flex-col gap-5">
      {error && (
        <Alert tone="bad" live="assertive">{error}</Alert>
      )}

      <Panel
        title={t("team.title")}
        description={t("team.seats", {
          used: String(props.seatsUsed),
          cap: String(props.seatCap),
        })}
        padded={false}
      >
        <div className="overflow-x-auto contain-paint">
          <table className="w-full min-w-[40rem] border-collapse text-left">
            <caption className="sr-only">{t("team.caption")}</caption>
            <thead>
              <tr className="bg-paper-sunk">
                <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">
                  {t("team.col.person")}
                </th>
                <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">
                  {t("team.col.role")}
                </th>
                <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">
                  {t("team.col.replies")}
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
              {props.seats.map((seat) => {
                /*
                   Neither the owner's row nor the reader's own offers the
                   control. `removeSeat` refuses both — an owner off their own
                   business leaves nobody who can invite anybody back — and the
                   screen not offering what the service will refuse is the whole
                   point: a button that always errors teaches the reader to
                   distrust the ones that work. The refusals stay where they
                   are. A hidden button is a UI opinion; a server action is a
                   URL, and the URL is what has to hold.
                */
                const canRemove = !seat.isOwner && seat.id !== props.currentUserId;

                return (
                  <tr key={seat.id} className="border-t border-line align-top">
                    <th scope="row" className="px-3 py-3 text-left font-normal">
                      <span className="block text-body-sm text-ink">{seatLabel(seat)}</span>
                      {seat.name && seat.email && (
                        <span className="mt-0.5 block font-mono text-caption text-faint">
                          {seat.email}
                        </span>
                      )}
                    </th>
                    <td className="px-3 py-3 text-body-sm text-ink">
                      {seat.roles
                        .filter((r) => r.startsWith("seller_"))
                        .map((r) => t(`team.role.${r}` as never))
                        .join(", ")}
                    </td>
                    <td className="px-3 py-3 font-mono tabular-nums text-body-sm text-ink">
                      {seat.medianReplyMs === null ? (
                        <span className="font-sans text-caption text-muted">
                          {t("team.unmeasured")}
                        </span>
                      ) : (
                        formatDuration(seat.medianReplyMs)
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {canRemove && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={pending}
                          onClick={() => setRemoving(seat)}
                        >
                          {t("invite.remove_seat")}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}

              {props.invites.map((invite) => (
                <tr key={invite.id} className="border-t border-line align-top">
                  <th scope="row" className="px-3 py-3 text-left font-normal">
                    <span className="block text-body-sm text-muted">{invite.contact}</span>
                    <span className="mt-0.5 block text-caption text-faint">{t("team.pending")}</span>
                  </th>
                  <td className="px-3 py-3 text-body-sm text-muted">
                    {invite.roles.map((r) => t(`team.role.${r}` as never)).join(", ")}
                  </td>
                  {/*
                    Empty on purpose. Nobody who has not taken the seat has
                    replied to anything, and "Not enough replies yet" would
                    imply they were being measured.
                  */}
                  <td className="px-3 py-3" />
                  <td className="px-3 py-3">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => {
                        const form = new FormData();
                        form.set("id", invite.id);
                        run(props.revokeAction, form, t("routing.saved"));
                      }}
                    >
                      {t("team.revoke")}
                    </Button>
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
          {seatNotice && (
            <p className="border-t border-line px-3 py-2.5 text-caption text-muted">{seatNotice}</p>
          )}
        </div>

        {/*
          Said out loud, and only when it is true. The board asks for the
          uncomfortable number; a line that appears whether or not the owner is
          slowest would be a slogan rather than a finding.
        */}
        {ownerIsSlowest && (
          <p className="border-t border-line px-3 py-2.5 text-caption text-muted">
            {t("team.owner_slowest")}
          </p>
        )}
      </Panel>

      <Panel title={t("team.invite")}>
        <div className="flex flex-col gap-4">
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
            <label className="flex w-48 flex-col gap-1">
              <span className="text-body-sm text-ink">{t("team.invite_role")}</span>
              <Select
                name="role"
                defaultValue="seller_sales"
                options={ROLES.map((role) => ({
                  value: role,
                  label: t(`team.role.${role}` as never),
                }))}
              />
            </label>
            <Button type="submit" disabled={pending}>
              {t("team.invite_send")}
            </Button>
          </form>

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

      <Panel title={t("routing.heading")}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            run(props.routingAction, new FormData(event.currentTarget), t("routing.saved"));
          }}
        >
          <fieldset className="min-w-0 border-0 p-0">
            <legend className="sr-only">{t("routing.heading")}</legend>
            <div className="flex flex-col gap-2">
              {ROUTING.map((option) => (
                <Radio
                  key={option}
                  name="routing"
                  value={option}
                  checked={routing === option}
                  onChange={() => setRouting(option)}
                  label={t(`routing.${option}` as never)}
                  description={t(`routing.${option}_hint` as never)}
                />
              ))}
            </div>
          </fieldset>

          <label className="flex max-w-xs flex-col gap-1">
            <span className="text-body-sm text-ink">{t("routing.escalation")}</span>
            <Select
              name="escalationMinutes"
              value={String(escalation)}
              onChange={(e) => setEscalation(Number(e.target.value))}
              options={props.escalationChoices.map((minutes) => ({
                value: String(minutes),
                label:
                  minutes < 60
                    ? t("routing.minutes", { n: String(minutes) })
                    : t("routing.hours", { n: String(minutes / 60) }),
              }))}
            />
            <span className="text-caption text-muted">{t("routing.escalation_hint")}</span>
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending}>
              {t("routing.save")}
            </Button>
            <span aria-live="polite" className="text-body-sm text-muted">
              {notice}
            </span>
          </div>
        </form>
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
        title={t("invite.remove_confirm", { name: removing ? seatLabel(removing) : "" })}
        description={t("invite.remove_body")}
        closeLabel={t("overlay.close")}
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
      />
    </div>
  );
}
