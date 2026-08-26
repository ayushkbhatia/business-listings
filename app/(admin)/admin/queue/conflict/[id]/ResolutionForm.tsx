"use client";

import { useId, useState, useTransition } from "react";
import { Button, Input, Label, Radio, Textarea } from "@/components/primitives";
import { Alert } from "@/components/display";
import { t } from "@/lib/i18n";
import type { ActionResult } from "../../actions";

/**
 * The four outcomes, as four radios rather than four buttons.
 *
 * Four buttons would each be a decision one click away, and two of these create
 * or restructure businesses. A radio plus one confirm makes the choice and the
 * commit two separate acts, which is the shape a consequential decision should
 * have — the same argument board 5a makes for a two-step publish.
 *
 * Each option carries what it does in a sentence, because the difference
 * between "split" and "merge" is obvious to whoever wrote the queue and not at
 * all obvious at four in the afternoon.
 *
 * The second trade name appears only for a split, and it is required there: a
 * split creates a listing, and a listing needs a name and an address. The field
 * is absent rather than disabled for the other three — a disabled control
 * invites somebody to look for the permission to enable it.
 */

const OPTIONS = [
  { value: "award_to_a", label: "admin.conflict.award_to_a", hint: "admin.conflict.award_to_a_hint" },
  { value: "award_to_b", label: "admin.conflict.award_to_b", hint: "admin.conflict.award_to_b_hint" },
  {
    value: "split_into_two",
    label: "admin.conflict.split_into_two",
    hint: "admin.conflict.split_into_two_hint",
  },
  {
    value: "merge_as_branches",
    label: "admin.conflict.merge_as_branches",
    hint: "admin.conflict.merge_as_branches_hint",
  },
] as const;

export interface ResolutionFormProps {
  conflictId: string;
  resolve: (formData: FormData) => Promise<ActionResult>;
}

const MIN_REASON = 4;

export function ResolutionForm({ conflictId, resolve }: ResolutionFormProps) {
  const group = useId();
  const nameId = useId();
  const reasonId = useId();

  const [choice, setChoice] = useState<string | null>(null);
  const [secondName, setSecondName] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const isSplit = choice === "split_into_two";
  const ready =
    choice !== null && reason.trim().length >= MIN_REASON && (!isSplit || secondName.trim() !== "");

  function send() {
    const form = new FormData();
    form.set("conflictId", conflictId);
    form.set("resolution", choice ?? "");
    form.set("reason", reason);
    if (isSplit) form.set("secondTradeName", secondName);
    startTransition(async () => {
      setResult(await resolve(form));
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="min-w-0 border-0 p-0">
        <legend className="text-body-sm font-medium text-ink">
          {t("admin.conflict.resolution_heading")}
        </legend>

        <div className="mt-2 flex flex-col gap-2">
          {OPTIONS.map((option) => (
            <Radio
              key={option.value}
              name={group}
              value={option.value}
              checked={choice === option.value}
              onChange={() => setChoice(option.value)}
              label={t(option.label as never)}
              description={t(option.hint as never)}
            />
          ))}
        </div>
      </fieldset>

      {isSplit && (
        <div className="flex flex-col gap-1">
          <Label
            htmlFor={nameId}
            requirement="required"
            requirementLabel={t("field.required")}
            hint={t("admin.conflict.second_name_hint")}
          >
            {t("admin.conflict.second_name_label")}
          </Label>
          <Input
            id={nameId}
            value={secondName}
            onChange={(event) => setSecondName(event.target.value)}
          />
        </div>
      )}

      <div className="flex flex-col gap-1">
        <Label
          htmlFor={reasonId}
          requirement="required"
          requirementLabel={t("field.required")}
          hint={t("admin.review.reason_hint")}
        >
          {t("admin.review.reason_label")}
        </Label>
        <Textarea
          id={reasonId}
          value={reason}
          rows={3}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>

      <div>
        <Button disabled={!ready || pending} onClick={send}>
          {t("admin.conflict.settle")}
        </Button>
      </div>

      {result && (
        <Alert
          tone={result.ok ? "ok" : "bad"}
          live={result.ok ? "polite" : "assertive"}
          {...(result.ok ? {} : { fix: t("admin.review.reason_hint") })}
        >
          {result.ok ? result.message : result.error}
        </Alert>
      )}
    </div>
  );
}
