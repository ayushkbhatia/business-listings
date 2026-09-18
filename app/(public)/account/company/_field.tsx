"use client";

import { useId } from "react";
import { Alert } from "@/components/display/Alert";
import { FieldError, Label } from "@/components/primitives";
import { t } from "@/lib/i18n";

/**
 * A label, a control and its error, wired together — the three things every
 * field on `/account/company` needs and each form would otherwise re-wire.
 *
 * `children` is a render function given the ids, so the control stays a real
 * `<input>` or `<select>` with its own name and the error is announced from the
 * control it belongs to.
 */
export function Field({
  label,
  hint,
  error,
  requirement = "none",
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  requirement?: "required" | "optional" | "none";
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => React.ReactNode;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label
        htmlFor={id}
        requirement={requirement}
        requirementLabel={requirement === "required" ? t("company.field.required_marker") : t("company.field.optional_marker")}
        {...(hint ? { hint } : {})}
      >
        {label}
      </Label>
      {children({ id, describedBy: error ? errorId : undefined, invalid: Boolean(error) })}
      <FieldError id={errorId} reserveSpace={false}>
        {error}
      </FieldError>
    </div>
  );
}

/**
 * Submit without letting React reset the form. A form `action` clears every
 * uncontrolled field when it settles, so a refusal — a TRN one digit short —
 * would hand the person back an empty form with an error over it.
 */
export function keep(run: (form: FormData) => void) {
  return (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    run(new FormData(event.currentTarget));
  };
}

/**
 * What a write came back with. A refusal is a `bad` notice, which the design
 * system requires to carry its fix (§05.1): the lead says it did not happen and
 * the fix line is the refusal's own sentence — what is wrong, and what right
 * looks like. A success is a polite confirmation.
 */
export function Outcome({ tone, text }: { tone: "ok" | "bad"; text: string }) {
  return tone === "bad" ? (
    <Alert tone="bad" live="assertive" fix={text}>
      {t("company.error.not_done")}
    </Alert>
  ) : (
    <Alert tone="ok" live="polite">
      {text}
    </Alert>
  );
}
