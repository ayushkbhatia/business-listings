"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Alert } from "@/components/display/Alert";
import { StatusBadge } from "@/components/display/StatusBadge";
import { Button, Input, Select } from "@/components/primitives";
import { Modal, Panel } from "@/components/structure";
import { BUYER_COMPANY_ROLES, type BuyerCompanyRole } from "@/lib/buyer-company/authority";
import { authorityLabel, roleLabel } from "@/lib/buyer-company/words";
import { formatAED, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import {
  changeSeatAction,
  deactivateAction,
  inviteAction,
  leaveAction,
  resendInviteAction,
  revokeInviteAction,
  type FieldErrors,
} from "./actions";
import { Field, keep, Outcome } from "./_field";

export type TeamRow =
  | {
      kind: "member";
      memberId: string;
      name: string;
      email: string | null;
      isYou: boolean;
      role: BuyerCompanyRole;
      monthlyLimitAed: number | null;
      usedAed: string;
      isApprover: boolean;
    }
  | {
      kind: "invite";
      inviteId: string;
      name: string;
      email: string;
      role: BuyerCompanyRole;
      monthlyLimitAed: number | null;
      state: "invited" | "expired";
      expiresAt: Date;
    };

/**
 * Board `7b` — *Team & approvals: who can raise a requirement, and who can
 * commit money.*
 *
 * A real table (CLAUDE.md, rule 4). Two columns the board did not draw and
 * `B5` asks for: the limit states its period, and *Used this month* is the
 * counter beside it — derived from accepted quotes, so it cannot be typed.
 *
 * Invited is its own state and it expires (`B11`); an expired row offers the
 * one thing that fixes it. Deactivate exists (flag 7) and says what it keeps.
 */
export function TeamCard({
  rows,
  editable,
  spend,
}: {
  rows: readonly TeamRow[];
  editable: boolean;
  spend: { totalAed: string; withoutTotal: number; accepted: number };
}) {
  const router = useRouter();
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<Extract<TeamRow, { kind: "member" }> | null>(null);
  const [removing, setRemoving] = useState<Extract<TeamRow, { kind: "member" }> | null>(null);
  const [link, setLink] = useState<{ url: string; emailed: boolean; email: string } | null>(null);
  const [status, setStatus] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const captionId = useId();

  function run(work: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    setStatus(null);
    start(async () => {
      const result = await work();
      setStatus(result.ok ? (result.message ? { tone: "ok", text: result.message } : null) : { tone: "bad", text: result.error ?? "" });
      router.refresh();
    });
  }

  function resend(inviteId: string, email: string) {
    setStatus(null);
    start(async () => {
      const result = await resendInviteAction(inviteId);
      if (result.ok) setLink({ url: result.acceptUrl, emailed: result.emailed, email });
      else setStatus({ tone: "bad", text: result.error });
      router.refresh();
    });
  }

  return (
    <Panel
      title={t("company.team.title")}
      description={t("company.team.description")}
      padded={false}
      actions={
        editable ? (
          <Button variant="ghost" size="sm" onClick={() => setInviting(true)}>
            {t("company.team.invite")}
          </Button>
        ) : undefined
      }
      footer={
        <p className="text-caption text-body">
          {spend.accepted === 0
            ? t("company.team.spend_none")
            : t("company.team.spend", { amount: formatAED(spend.totalAed), count: spend.accepted })}
          {spend.withoutTotal > 0 ? ` ${t("company.team.spend_no_total", { count: spend.withoutTotal })}` : ""}{" "}
          {/* Underlined: a link inside a sentence is found by its shape, not only its colour. */}
          <Link href="/account/company/approvals" className="rounded-tag text-moss underline underline-offset-2 focus-visible:shadow-focus focus-visible:outline-none">
            {t("company.team.approvals_link")}
          </Link>
        </p>
      }
    >
      <div className="overflow-x-auto" tabIndex={0} role="group" aria-labelledby={captionId}>
        <table className="w-full min-w-[44rem] border-collapse text-left">
          <caption id={captionId} className="sr-only">
            {t("company.team.caption")}
          </caption>
          <thead>
            <tr className="border-b border-line bg-paper-sunk">
              <th scope="col" className="px-4 py-2 font-mono text-eyebrow font-normal uppercase tracking-eyebrow text-muted">
                {t("company.team.col.person")}
              </th>
              <th scope="col" className="px-3 py-2 font-mono text-eyebrow font-normal uppercase tracking-eyebrow text-muted">
                {t("company.team.col.role")}
              </th>
              <th scope="col" className="px-3 py-2 font-mono text-eyebrow font-normal uppercase tracking-eyebrow text-muted">
                {t("company.team.col.authority")}
              </th>
              <th scope="col" className="px-3 py-2 font-mono text-eyebrow font-normal uppercase tracking-eyebrow text-muted">
                {t("company.team.col.used")}
              </th>
              <th scope="col" className="px-3 py-2 font-mono text-eyebrow font-normal uppercase tracking-eyebrow text-muted">
                {t("company.team.col.status")}
              </th>
              <th scope="col" className="px-4 py-2">
                <span className="sr-only">{t("company.team.col.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) =>
              row.kind === "member" ? (
                <tr key={row.memberId} className="border-b border-line last:border-b-0">
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    <span className="block text-body-sm text-ink">
                      {row.name}
                      {row.isYou ? <span className="text-muted"> · {t("company.team.you")}</span> : null}
                    </span>
                    {row.email ? <span className="block text-caption text-body">{row.email}</span> : null}
                  </th>
                  <td className="px-3 py-3 text-body-sm text-ink">
                    {roleLabel(row.role)}
                    {row.isApprover ? (
                      <span className="mt-0.5 block font-mono text-eyebrow uppercase tracking-eyebrow text-muted">
                        {t("company.team.approver")}
                      </span>
                    ) : null}
                  </td>
                  <td className={row.role === "requester" ? "whitespace-nowrap px-3 py-3 text-body-sm text-body" : "whitespace-nowrap px-3 py-3 text-body-sm text-ink"}>
                    {authorityLabel(row.role, row.monthlyLimitAed)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 font-mono text-body-sm tabular-nums text-ink">
                    {row.role === "requester" ? <span className="text-muted">—</span> : formatAED(row.usedAed)}
                  </td>
                  <td className="px-3 py-3">
                    <StatusBadge tone="ok" shape="chip">
                      {t("company.team.active")}
                    </StatusBadge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {editable ? (
                      <span className="inline-flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditing(row)}
                          aria-label={t("company.team.edit_named", { name: row.name })}
                        >
                          {t("company.team.edit")}
                        </Button>
                        {!row.isYou ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setRemoving(row)}
                            aria-label={t("company.team.deactivate_named", { name: row.name })}
                          >
                            {t("company.team.deactivate")}
                          </Button>
                        ) : null}
                      </span>
                    ) : null}
                    {row.isYou ? (
                      <Button variant="ghost" size="sm" onClick={() => setRemoving(row)}>
                        {t("company.team.leave")}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ) : (
                <tr key={row.inviteId} className="border-b border-line last:border-b-0">
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    <span className="block text-body-sm text-ink">{row.name}</span>
                    <span className="block text-caption text-body">{row.email}</span>
                  </th>
                  <td className="px-3 py-3 text-body-sm text-ink">{roleLabel(row.role)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-body-sm text-body">{authorityLabel(row.role, row.monthlyLimitAed)}</td>
                  <td className="px-3 py-3 text-body-sm text-muted">—</td>
                  <td className="px-3 py-3">
                    <StatusBadge tone={row.state === "expired" ? "bad" : "warn"} shape="chip">
                      {row.state === "expired" ? t("company.team.expired") : t("company.team.invited")}
                    </StatusBadge>
                    <span className="mt-1 block text-caption text-body">
                      {row.state === "expired"
                        ? t("company.team.expired_on", { date: formatDate(row.expiresAt) })
                        : t("company.team.expires_on", { date: formatDate(row.expiresAt) })}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {editable ? (
                      <span className="inline-flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          onClick={() => resend(row.inviteId, row.email)}
                          aria-label={t("company.team.resend_named", { email: row.email })}
                        >
                          {t("company.team.resend")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          onClick={() => run(() => revokeInviteAction(row.inviteId))}
                          aria-label={t("company.team.revoke_named", { email: row.email })}
                        >
                          {t("company.team.revoke")}
                        </Button>
                      </span>
                    ) : null}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>

      {status ? (
        <div className="border-t border-line px-4 py-3">
          <Outcome tone={status.tone} text={status.text} />
        </div>
      ) : null}
      {link ? <InviteLink {...link} onDismiss={() => setLink(null)} /> : null}

      {inviting ? (
        <InviteDialog
          onClose={() => setInviting(false)}
          onSent={(sent) => {
            setInviting(false);
            setLink(sent);
            router.refresh();
          }}
        />
      ) : null}
      {editing ? (
        <SeatDialog
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            setStatus({ tone: "ok", text: message });
            router.refresh();
          }}
        />
      ) : null}
      {removing ? (
        <RemoveDialog
          row={removing}
          onClose={() => setRemoving(null)}
          onDone={(message) => {
            setRemoving(null);
            setStatus({ tone: "ok", text: message });
            router.refresh();
          }}
        />
      ) : null}
    </Panel>
  );
}

/** The link, for when the email did not go — or for the admin who would rather send it themselves. */
function InviteLink({ url, emailed, email, onDismiss }: { url: string; emailed: boolean; email: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  const id = useId();
  return (
    <div className="border-t border-line px-4 py-3">
      <Alert
        tone={emailed ? "ok" : "warn"}
        live="polite"
        action={
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            {t("company.dialog.close")}
          </Button>
        }
      >
        <p>{emailed ? t("company.team.link_emailed", { email: email || t("company.team.the_invitee") }) : t("company.team.link_not_emailed")}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label htmlFor={id} className="sr-only">
            {t("company.team.link_label")}
          </label>
          <div className="min-w-0 flex-1">
            <Input id={id} value={url} readOnly mono size="sm" onFocus={(event) => event.currentTarget.select()} />
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? t("company.team.copied") : t("company.team.copy")}
          </Button>
        </div>
      </Alert>
    </div>
  );
}

function roleOptions() {
  return BUYER_COMPANY_ROLES.map((role) => ({ value: role, label: roleLabel(role) }));
}

function InviteDialog({
  onClose,
  onSent,
}: {
  onClose: () => void;
  onSent: (sent: { url: string; emailed: boolean; email: string }) => void;
}) {
  const formId = useId();
  const [role, setRole] = useState<BuyerCompanyRole>("procurement");
  const [fields, setFields] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const err = (key: string) => (fields[key] ? { error: fields[key]! } : {});

  function submit(form: FormData) {
    setError(null);
    start(async () => {
      const result = await inviteAction(form);
      if (result.ok) onSent({ url: result.acceptUrl, emailed: result.emailed, email: result.email });
      else {
        setFields(result.fields ?? {});
        setError(result.error);
      }
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("company.team.invite_title")}
      description={t("company.team.invite_description")}
      closeLabel={t("company.dialog.close")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {t("company.dialog.cancel")}
          </Button>
          <Button type="submit" form={formId} loading={pending}>
            {t("company.team.invite_submit")}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={keep(submit)} noValidate className="grid gap-3 sm:grid-cols-2">
        <Field label={t("company.team.full_name")} hint={t("company.team.full_name_hint")} requirement="required" {...err("fullName")}>
          {({ id, describedBy, invalid }) => (
            <Input id={id} name="fullName" autoComplete="off" maxLength={120} invalid={invalid} aria-describedby={describedBy} />
          )}
        </Field>
        <Field label={t("company.team.email")} requirement="required" {...err("email")}>
          {({ id, describedBy, invalid }) => (
            <Input id={id} name="email" type="email" autoComplete="off" maxLength={254} invalid={invalid} aria-describedby={describedBy} />
          )}
        </Field>
        <SeatFields role={role} onRole={setRole} limit={null} fields={fields} />
      </form>
      {error ? (
        <div className="mt-3">
          <Outcome tone="bad" text={error} />
        </div>
      ) : null}
    </Modal>
  );
}

/** Role, and a monthly limit when the role has one. Shared by the invitation and the seat editor. */
function SeatFields({
  role,
  onRole,
  limit,
  fields,
}: {
  role: BuyerCompanyRole;
  onRole: (role: BuyerCompanyRole) => void;
  limit: number | null;
  fields: FieldErrors;
}) {
  return (
    <>
      <Field
        label={t("company.team.role")}
        hint={t(`company.role_hint.${role}` as "company.role_hint.procurement")}
        requirement="required"
        {...(fields.role ? { error: fields.role } : {})}
      >
        {({ id, describedBy, invalid }) => (
          <Select
            id={id}
            name="role"
            value={role}
            onChange={(event) => onRole(event.target.value as BuyerCompanyRole)}
            options={roleOptions()}
            invalid={invalid}
            aria-describedby={describedBy}
          />
        )}
      </Field>
      {role === "procurement" ? (
        <Field
          label={t("company.team.limit")}
          hint={t("company.team.limit_hint")}
          requirement="required"
          {...(fields.monthlyLimitAed ? { error: fields.monthlyLimitAed } : {})}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              name="monthlyLimitAed"
              inputMode="numeric"
              suffix="AED"
              defaultValue={limit === null ? "" : String(limit)}
              invalid={invalid}
              aria-describedby={describedBy}
            />
          )}
        </Field>
      ) : (
        <input type="hidden" name="monthlyLimitAed" value="" />
      )}
    </>
  );
}

function SeatDialog({
  row,
  onClose,
  onSaved,
}: {
  row: Extract<TeamRow, { kind: "member" }>;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const formId = useId();
  const [role, setRole] = useState<BuyerCompanyRole>(row.role);
  const [fields, setFields] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(form: FormData) {
    setError(null);
    start(async () => {
      const result = await changeSeatAction(form);
      if (result.ok) onSaved(result.message ?? "");
      else {
        setFields(result.fields ?? {});
        setError(result.error);
      }
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("company.team.edit_title", { name: row.name })}
      description={t("company.team.edit_description")}
      closeLabel={t("company.dialog.close")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {t("company.dialog.cancel")}
          </Button>
          <Button type="submit" form={formId} loading={pending}>
            {t("company.team.seat_save")}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={keep(submit)} noValidate className="grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="memberId" value={row.memberId} />
        <SeatFields role={role} onRole={setRole} limit={row.monthlyLimitAed} fields={fields} />
      </form>
      {error ? (
        <div className="mt-3">
          <Outcome tone="bad" text={error} />
        </div>
      ) : null}
    </Modal>
  );
}

/** Deactivate somebody, or leave. Not reversible from here, so a dialog that repeats the verb. */
function RemoveDialog({
  row,
  onClose,
  onDone,
}: {
  row: Extract<TeamRow, { kind: "member" }>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function confirm() {
    setError(null);
    start(async () => {
      const result = row.isYou ? await leaveAction() : await deactivateAction(row.memberId);
      if (result.ok) onDone(result.message ?? "");
      else setError(result.error);
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={row.isYou ? t("company.team.leave_title") : t("company.team.deactivate_title", { name: row.name })}
      description={row.isYou ? t("company.team.leave_body") : t("company.team.deactivate_body", { name: row.name })}
      closeLabel={t("company.dialog.close")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {t("company.dialog.cancel")}
          </Button>
          <Button variant="danger" onClick={confirm} loading={pending}>
            {row.isYou ? t("company.team.leave_confirm") : t("company.team.deactivate_confirm")}
          </Button>
        </>
      }
    >
      {error ? (
        <Outcome tone="bad" text={error} />
      ) : null}
    </Modal>
  );
}
