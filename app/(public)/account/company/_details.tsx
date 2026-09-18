"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@/components/primitives";
import { formatTRN } from "@/lib/format/trn";
import { t } from "@/lib/i18n";
import { createCompanyAction, saveDetailsAction, type FieldErrors } from "./actions";
import { Field, keep, Outcome } from "./_field";

export interface DetailsValue {
  name: string;
  trn: string | null;
  licenceNumber: string | null;
  accountsEmail: string | null;
}

/**
 * The four company details — board `7b`, *Company details*.
 *
 * One form for setting a company up and for changing it, because they are the
 * same four facts. Explicit save rather than autosave: the supplier puts these
 * on a tax invoice, each save is a line in the company's history (`B8`), and a
 * half-typed TRN autosaved is a wrong TRN on the record.
 *
 * The TRN is shown in full (`7b` flag 8). It is the buyer's own number on the
 * buyer's own screen; the board masked it beside a licence number it printed
 * whole. And nothing says `Matched` or `TRN verified` (`B7`): the format is
 * checked, the FTA register is not, and the hint says exactly that.
 */
export function DetailsForm({
  mode,
  initial,
}: {
  mode: "create" | "edit";
  initial: DetailsValue;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [fields, setFields] = useState<FieldErrors>({});
  const [status, setStatus] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  function submit(form: FormData) {
    setStatus(null);
    start(async () => {
      const result = mode === "create" ? await createCompanyAction(form) : await saveDetailsAction(form);
      if (result.ok) {
        setFields({});
        setStatus(result.message ? { tone: "ok", text: result.message } : null);
        router.refresh();
      } else {
        setFields(result.fields ?? {});
        setStatus({ tone: "bad", text: result.error });
      }
    });
  }

  return (
    <form onSubmit={keep(submit)} noValidate className="space-y-4">
      <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
        <Field label={t("company.details.name")} requirement="required" {...(fields.name ? { error: fields.name } : {})}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              name="name"
              defaultValue={initial.name}
              autoComplete="organization"
              maxLength={160}
              invalid={invalid}
              aria-describedby={describedBy}
              required
            />
          )}
        </Field>
        <Field
          label={t("company.details.trn")}
          hint={t("company.details.trn_hint")}
          requirement="optional"
          {...(fields.trn ? { error: fields.trn } : {})}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              name="trn"
              mono
              inputMode="numeric"
              defaultValue={initial.trn ? formatTRN(initial.trn) : ""}
              maxLength={24}
              invalid={invalid}
              aria-describedby={describedBy}
            />
          )}
        </Field>
        <Field
          label={t("company.details.licence")}
          hint={t("company.details.licence_hint")}
          requirement="optional"
          {...(fields.licenceNumber ? { error: fields.licenceNumber } : {})}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              name="licenceNumber"
              mono
              defaultValue={initial.licenceNumber ?? ""}
              maxLength={40}
              invalid={invalid}
              aria-describedby={describedBy}
            />
          )}
        </Field>
        <Field
          label={t("company.details.accounts_email")}
          hint={t("company.details.accounts_email_hint")}
          requirement="optional"
          {...(fields.accountsEmail ? { error: fields.accountsEmail } : {})}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              name="accountsEmail"
              type="email"
              autoComplete="email"
              defaultValue={initial.accountsEmail ?? ""}
              maxLength={254}
              invalid={invalid}
              aria-describedby={describedBy}
            />
          )}
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending}>
          {mode === "create" ? t("company.create.submit") : t("company.details.save")}
        </Button>
        {status ? (
          <div className="min-w-0 flex-1">
            <Outcome tone={status.tone} text={status.text} />
          </div>
        ) : null}
      </div>
    </form>
  );
}

/** The same four facts for a member who cannot change them. */
export function DetailsReadOnly({ value }: { value: DetailsValue }) {
  const rows: [string, string | null, boolean][] = [
    [t("company.details.name"), value.name, false],
    [t("company.details.trn"), value.trn ? formatTRN(value.trn) : null, true],
    [t("company.details.licence"), value.licenceNumber, true],
    [t("company.details.accounts_email"), value.accountsEmail, false],
  ];
  return (
    <dl className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
      {rows.map(([label, content, mono]) => (
        <div key={label} className="min-w-0">
          <dt className="text-caption text-body">{label}</dt>
          <dd className={content ? `mt-0.5 break-words text-body-sm text-ink ${mono ? "font-mono" : ""}` : "mt-0.5 text-body-sm text-muted"}>
            {content ?? t("table.not_provided")}
          </dd>
        </div>
      ))}
    </dl>
  );
}
