"use client";

import { Alert } from "@/components/display";
import { useState, useTransition } from "react";
import { Button, Input, Radio, Select } from "@/components/primitives";
import { Panel } from "@/components/structure";
import { formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { TeamActionResult } from "./actions";

/**
 * Board 7d — the team, the routing, and the uncomfortable number.
 *
 * The per-person reply times include the owner's, and the board asks for that
 * explicitly. A dashboard that measures everybody except the person reading it
 * is a dashboard nobody trusts about anything else either.
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
  email: string;
  roles: string[];
}

export interface TeamFormProps {
  seats: readonly SeatRow[];
  invites: readonly InviteRow[];
  routing: string;
  escalationMinutes: number;
  escalationChoices: readonly number[];
  seatsUsed: number;
  seatCap: number;
  inviteAction: (formData: FormData) => Promise<TeamActionResult>;
  revokeAction: (formData: FormData) => Promise<TeamActionResult>;
  routingAction: (formData: FormData) => Promise<TeamActionResult>;
}

const ROLES = ["seller_manager", "seller_sales", "seller_finance"] as const;
const ROUTING = ["everyone", "round_robin", "by_branch"] as const;

export function TeamForm(props: TeamFormProps) {
  const [routing, setRouting] = useState(props.routing);
  const [escalation, setEscalation] = useState(props.escalationMinutes);
  const [notice, setNotice] = useState<string | null>(null);
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

  function run(action: (f: FormData) => Promise<TeamActionResult>, form: FormData, ok: string) {
    setError(null);
    startTransition(async () => {
      const result = await action(form);
      if (!result.ok) setError(result.error);
      else setNotice(ok);
    });
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
              </tr>
            </thead>
            <tbody>
              {props.seats.map((seat) => (
                <tr key={seat.id} className="border-t border-line align-top">
                  <th scope="row" className="px-3 py-3 text-left font-normal">
                    <span className="block text-body-sm text-ink">{seat.name ?? seat.email}</span>
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
                </tr>
              ))}

              {props.invites.map((invite) => (
                <tr key={invite.id} className="border-t border-line align-top">
                  <th scope="row" className="px-3 py-3 text-left font-normal">
                    <span className="block text-body-sm text-muted">{invite.email}</span>
                    <span className="mt-0.5 block text-caption text-faint">{t("team.pending")}</span>
                  </th>
                  <td className="px-3 py-3 text-body-sm text-muted">
                    {invite.roles.map((r) => t(`team.role.${r}` as never)).join(", ")}
                  </td>
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
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            run(props.inviteAction, new FormData(event.currentTarget), t("team.invited"));
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
    </div>
  );
}
