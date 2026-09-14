"use client";

import { useId, useState, useTransition } from "react";
import { Alert } from "@/components/display";
import { Button, FieldError, Input, Label, Radio, RadioGroup, Textarea } from "@/components/primitives";
import { Modal } from "@/components/structure";
import { cn } from "@/lib/cn";
import type { Capability } from "@/lib/auth/capabilities";
import type { StaffRole } from "@/lib/auth/roles";
import { t, type MessageKey } from "@/lib/i18n";
import { grantCount, roleDelta } from "@/lib/staff/matrix";
import type { StaffActionResult } from "./actions";

/**
 * Board 4i's dialogs. One shape, five uses.
 *
 * Every change on the staff screen is a decision about who may do what, and
 * each carries a written reason the service layer refuses to go without (`B3`).
 * The dialog asks for it, says what the change does before the click — what a
 * role gains and loses, which link stops working — and repeats the verb on the
 * confirm button, never "OK". Cancel sits left and is never red (§05).
 *
 * The reason box's floor mirrors `assertReason` (four characters, with a letter
 * or digit) so the button is honest about when it will work. The service is
 * still the rule; this only saves a round trip.
 */

const MIN_REASON = 4;

export function reasonReady(reason: string): boolean {
  const trimmed = reason.trim();
  return trimmed.length >= MIN_REASON && /[\p{Letter}\p{Number}]/u.test(trimmed);
}

export const ROLE_ORDER: readonly StaffRole[] = ["staff_ops_lead", "staff_moderator", "staff_finance"];

export function roleLabel(role: StaffRole): string {
  return t(`staff.role.${role}` as MessageKey);
}

function capabilityLabel(capability: Capability): string {
  return t(`staff.capability.${capability}` as MessageKey);
}

// ── The frame ───────────────────────────────────────────────────────────────

interface DecisionDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  /** Extra fields. Their values travel through `extra` on submit. */
  children?: React.ReactNode;
  /** Whether the fields above the reason are complete. */
  ready?: boolean;
  onSubmit: (reason: string) => Promise<StaffActionResult>;
  onDone: (result: Extract<StaffActionResult, { ok: true }>) => void;
  /** Field-level errors from the last attempt, handed to the fields above. */
  onFieldError?: (field: "email" | "role" | null, message: string | null) => void;
}

export function DecisionDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  destructive = false,
  children,
  ready = true,
  onSubmit,
  onDone,
  onFieldError,
}: DecisionDialogProps) {
  const reasonId = useId();
  const reasonErrorId = `${reasonId}-error`;
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    if (pending) return;
    setReason("");
    setError(null);
    setReasonError(null);
    onFieldError?.(null, null);
    onClose();
  }

  function submit() {
    if (!reasonReady(reason)) {
      // Required-field errors on submit, per §02 — never on first keystroke.
      setReasonError(t("admin.staff.reason_short"));
      return;
    }
    setError(null);
    setReasonError(null);
    onFieldError?.(null, null);
    startTransition(async () => {
      const result = await onSubmit(reason);
      if (result.ok) {
        setReason("");
        onDone(result);
        return;
      }
      if (result.field === "reason") setReasonError(result.error);
      else if (result.field) onFieldError?.(result.field, result.error);
      else setError(result.error);
    });
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      description={description}
      closeLabel={t("overlay.close")}
      dismissible={!pending}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={pending}>
            {t("action.cancel")}
          </Button>
          <Button
            variant={destructive ? "danger" : "primary"}
            onClick={submit}
            loading={pending}
            disabled={!ready || pending}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {/*
         A <div>, not a <form>. The footer's confirm is the one control that
         submits, and it sits outside this body in the dialog's footer; an
         unnamed <form> here would add a landmark per dialog with nothing to
         call it, and implicit Enter-to-submit from the email field would skip
         the button that says what is about to happen.
      */}
      <div className="flex flex-col gap-4">
        {children}

        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor={reasonId}
            requirement="required"
            requirementLabel={t("field.required")}
            hint={t("admin.staff.reason_hint")}
          >
            {t("admin.staff.reason_label")}
          </Label>
          <Textarea
            id={reasonId}
            name="reason"
            rows={3}
            value={reason}
            invalid={reasonError !== null}
            aria-describedby={reasonErrorId}
            onChange={(event) => {
              setReason(event.target.value);
              // Revalidate as they type once it has failed, per §02.
              if (reasonError && reasonReady(event.target.value)) setReasonError(null);
            }}
          />
          <FieldError id={reasonErrorId}>{reasonError}</FieldError>
        </div>

        {/* A failed save is the one assertive announcement §09 allows. */}
        {error ? (
          <Alert tone="bad" live="assertive">
            {error}
          </Alert>
        ) : null}

      </div>
    </Modal>
  );
}

// ── Role picker and what a change does ──────────────────────────────────────

export function RolePicker({
  value,
  onChange,
  current,
  error,
}: {
  value: StaffRole | null;
  onChange: (role: StaffRole) => void;
  current?: StaffRole | null;
  error?: string | null;
}) {
  const name = useId();
  return (
    <div className="flex flex-col gap-1">
      <RadioGroup legend={t("admin.staff.role_legend")} hint={t("admin.staff.role_hint")}>
        {ROLE_ORDER.map((role) => (
          <Radio
            key={role}
            name={name}
            value={role}
            checked={value === role}
            onChange={() => onChange(role)}
            label={
              current === role
                ? t("admin.staff.role_current", { role: roleLabel(role) })
                : roleLabel(role)
            }
            description={t(`admin.staff.role_summary.${role}` as MessageKey, {
              count: grantCount(role),
            })}
          />
        ))}
      </RadioGroup>
      <FieldError reserveSpace={false}>{error}</FieldError>
    </div>
  );
}

export function RoleDelta({ from, to }: { from: StaffRole | null; to: StaffRole | null }) {
  if (from === to) return null;
  const { gains, loses } = roleDelta(from, to);
  // Deactivation gains nothing by definition, and an invitation loses nothing;
  // a column that can only say "Nothing" says it for no reason.
  const columns = [
    ...(to !== null ? [{ key: "gains", label: t("admin.staff.gains"), items: gains }] : []),
    ...(from !== null ? [{ key: "loses", label: t("admin.staff.loses"), items: loses }] : []),
  ];
  return (
    <div
      className={cn(
        "grid gap-3 rounded-card border border-line bg-paper-sunk p-3",
        columns.length > 1 && "sm:grid-cols-2",
      )}
    >
      {columns.map((column) => (
        <div key={column.key}>
          <p className="font-mono text-eyebrow uppercase text-body">{column.label}</p>
          {column.items.length === 0 ? (
            <p className="mt-1 text-body-sm text-body">{t("admin.staff.nothing")}</p>
          ) : (
            <ul className="mt-1 flex list-none flex-col gap-0.5 p-0">
              {column.items.map((capability) => (
                <li key={capability} className="text-body-sm text-ink">
                  {capabilityLabel(capability)}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

// ── A link to hand over ─────────────────────────────────────────────────────

/**
 * Shown only when the email did not go. The copy says whose mailbox redeems it,
 * so nobody pastes it into a group chat thinking the link is the permission.
 */
export function HandoverLink({ link }: { link: string }) {
  const id = useId();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} hint={t("admin.staff.link_hint")}>
        {t("admin.staff.link_label")}
      </Label>
      <div className="flex gap-2">
        <Input id={id} readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
        <Button
          variant="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? t("admin.staff.link_copied") : t("admin.staff.link_copy")}
        </Button>
      </div>
    </div>
  );
}

// ── Invite ──────────────────────────────────────────────────────────────────

export function InviteDialog({
  open,
  onClose,
  onDone,
  action,
  domains,
  hours,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (result: Extract<StaffActionResult, { ok: true }>) => void;
  action: (form: FormData) => Promise<StaffActionResult>;
  domains: string;
  hours: number;
}) {
  const emailId = useId();
  const emailErrorId = `${emailId}-error`;
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);

  function reset() {
    setEmail("");
    setRole(null);
    setEmailError(null);
    setRoleError(null);
  }

  return (
    <DecisionDialog
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={t("admin.staff.invite_title")}
      description={t("admin.staff.invite_description", { hours })}
      confirmLabel={t("admin.staff.invite_confirm")}
      ready={email.trim() !== "" && role !== null}
      onFieldError={(field, message) => {
        setEmailError(field === "email" ? message : null);
        setRoleError(field === "role" ? message : null);
      }}
      onSubmit={(reason) => {
        const form = new FormData();
        form.set("email", email);
        form.set("role", role ?? "");
        form.set("reason", reason);
        return action(form);
      }}
      onDone={(result) => {
        reset();
        onDone(result);
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label
          htmlFor={emailId}
          requirement="required"
          requirementLabel={t("field.required")}
          hint={t("admin.staff.email_hint", { domains })}
        >
          {t("admin.staff.email_label")}
        </Label>
        <Input
          id={emailId}
          type="email"
          name="email"
          autoComplete="off"
          spellCheck={false}
          value={email}
          invalid={emailError !== null}
          aria-describedby={emailErrorId}
          onChange={(event) => setEmail(event.target.value)}
        />
        <FieldError id={emailErrorId}>{emailError}</FieldError>
      </div>

      <RolePicker value={role} onChange={setRole} error={roleError} />
      {role ? <RoleDelta from={null} to={role} /> : null}
    </DecisionDialog>
  );
}
