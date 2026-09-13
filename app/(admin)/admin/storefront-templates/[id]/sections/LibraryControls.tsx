"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/display";
import { Button, Checkbox, IconButton, Radio, RadioGroup, Textarea } from "@/components/primitives";
import { t } from "@/lib/i18n";
import type { SettingControl } from "@/lib/storefront/section-settings";
import type { LibraryActionResult } from "./actions";

/**
 * Board `5c-s` — the library's two controls.
 *
 * Both ask for the reason before they act, as every builder control does: the
 * write lands in the audit log with the store count, and `assertReason` refuses
 * a blank. The button is dead until there is something to write, and the hint
 * under the field says so rather than leaving a disabled button to explain
 * itself.
 */

const MIN_REASON = 4;

type Action = (formData: FormData) => Promise<LibraryActionResult>;

function ReasonField({
  id,
  value,
  onChange,
  autoFocus = false,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  /** Where focus goes when the field is opened by a button rather than already on the page. */
  autoFocus?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-mono text-eyebrow uppercase text-muted">
        {t("builder.reason_label")}
      </label>
      <Textarea
        id={id}
        rows={2}
        value={value}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="text-caption text-faint">{t("builder.reason_hint")}</p>
    </div>
  );
}

/**
 * *Add to page.*
 *
 * Opens the reason in place rather than a modal: it is one field and one
 * button, and a modal for it would take focus away from the preview the reader
 * is deciding about.
 */
export function AddToPage({
  templateId,
  type,
  label,
  storeCount,
  doneHref,
  action,
}: {
  templateId: string;
  type: string;
  label: string;
  /** Already formatted. */
  storeCount: string;
  /**
   * Where to land once it is added. The button is replaced by *On the page*
   * when the page re-renders, so the confirmation has to live on the page and
   * not in this component's state — the page reads it from the address.
   */
  doneHref: string;
  action: Action;
}) {
  const id = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<LibraryActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} aria-expanded={false}>
        {t("section.library.add")}
      </Button>
    );
  }

  return (
    <div id={`${id}-panel`} className="flex w-full max-w-md flex-col gap-3 rounded-card border border-line bg-card p-4">
      <p className="text-body-sm text-body">
        {t("section.library.add_confirm", { section: label, count: storeCount })}
      </p>
      <ReasonField id={`${id}-reason`} value={reason} onChange={setReason} autoFocus />
      {result && !result.ok && (
        <Alert tone="bad" live="assertive">
          {result.error}
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={pending || reason.trim().length < MIN_REASON}
          onClick={() => {
            const form = new FormData();
            form.set("templateId", templateId);
            form.set("type", type);
            form.set("reason", reason);
            startTransition(async () => {
              const outcome = await action(form);
              setResult(outcome);
              if (outcome.ok) {
                router.replace(doneHref, { scroll: false });
                router.refresh();
              }
            });
          }}
        >
          {t("section.library.add")}
        </Button>
        <Button variant="secondary" disabled={pending} onClick={() => setOpen(false)}>
          {t("builder.cancel")}
        </Button>
      </div>
    </div>
  );
}

/**
 * The settings for one section on the template — configuration, never content.
 *
 * Every control is a closed list: radios, or checkboxes with a move up and a
 * move down. There is no text input in this component and there must never be
 * one (B4) — the headings of the scope grid's columns are ours, and a column a
 * seller could rename is how a fee gets published under another word (Q2).
 */
export function SectionSettingsForm({
  templateId,
  sectionId,
  controls,
  initial,
  optionLabels,
  legends,
  action,
}: {
  templateId: string;
  sectionId: string;
  controls: readonly SettingControl[];
  initial: Record<string, unknown>;
  /** `${controlKey}.${option}` to its words. Worded on the server. */
  optionLabels: Record<string, string>;
  legends: Record<string, { legend: string; hint: string }>;
  action: Action;
}) {
  const id = useId();
  const router = useRouter();
  const [values, setValues] = useState<Record<string, unknown>>(initial);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<LibraryActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const changed = JSON.stringify(values) !== JSON.stringify(initial);

  function save() {
    const form = new FormData();
    form.set("templateId", templateId);
    form.set("sectionId", sectionId);
    form.set("settings", JSON.stringify(values));
    form.set("reason", reason);
    startTransition(async () => {
      const outcome = await action(form);
      setResult(outcome);
      if (outcome.ok) {
        setReason("");
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {controls.map((control) => {
        const words = legends[control.key]!;

        if (control.kind === "choice") {
          return (
            <RadioGroup key={control.key} legend={words.legend} hint={words.hint}>
              {control.options.map((option) => (
                <Radio
                  key={option}
                  name={`${id}-${control.key}`}
                  value={option}
                  checked={values[control.key] === option}
                  onChange={() => setValues((current) => ({ ...current, [control.key]: option }))}
                  label={optionLabels[`${control.key}.${option}`]}
                />
              ))}
            </RadioGroup>
          );
        }

        /*
           Columns: the chosen ones first, in their order, then the rest. Moving
           is buttons rather than a drag, for the reason the builder gives — a
           drag-only list is a list somebody using a keyboard cannot reorder.
        */
        const chosen = (values[control.key] as string[]) ?? [];
        const rest = control.options.filter((option) => !chosen.includes(option));
        const set = (next: string[]) => setValues((current) => ({ ...current, [control.key]: next }));

        return (
          <fieldset key={control.key} className="flex flex-col gap-2">
            <legend className="text-body-sm font-medium text-ink">{words.legend}</legend>
            <p className="text-caption text-muted">{words.hint}</p>
            <ol className="flex flex-col gap-1">
              {[...chosen, ...rest].map((option) => {
                const index = chosen.indexOf(option);
                const on = index !== -1;
                const label = optionLabels[`${control.key}.${option}`]!;
                return (
                  <li
                    key={option}
                    className="flex items-center justify-between gap-2 rounded-chip border border-line px-2 py-1.5"
                  >
                    <Checkbox
                      checked={on}
                      label={label}
                      onChange={(event) =>
                        set(event.target.checked ? [...chosen, option] : chosen.filter((c) => c !== option))
                      }
                    />
                    {on && (
                      <span className="flex shrink-0 gap-0.5">
                        <IconButton
                          size="sm"
                          label={t("builder.move_up", { section: label })}
                          icon={<span aria-hidden="true">↑</span>}
                          disabled={index === 0}
                          onClick={() => {
                            const next = [...chosen];
                            next.splice(index - 1, 0, next.splice(index, 1)[0]!);
                            set(next);
                          }}
                        />
                        <IconButton
                          size="sm"
                          label={t("builder.move_down", { section: label })}
                          icon={<span aria-hidden="true">↓</span>}
                          disabled={index === chosen.length - 1}
                          onClick={() => {
                            const next = [...chosen];
                            next.splice(index + 1, 0, next.splice(index, 1)[0]!);
                            set(next);
                          }}
                        />
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </fieldset>
        );
      })}

      <ReasonField id={`${id}-reason`} value={reason} onChange={setReason} />

      {result && (
        <Alert tone={result.ok ? "ok" : "bad"} live={result.ok ? "polite" : "assertive"}>
          {result.ok ? result.message : result.error}
        </Alert>
      )}

      <div>
        <Button disabled={pending || !changed || reason.trim().length < MIN_REASON} onClick={save}>
          {changed ? t("section.library.settings_save") : t("section.library.settings_unchanged")}
        </Button>
      </div>
    </div>
  );
}
