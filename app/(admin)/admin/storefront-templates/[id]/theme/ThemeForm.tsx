"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/display";
import { Button, Checkbox, Input, Label, Radio, RadioGroup, Textarea } from "@/components/primitives";
import { Panel } from "@/components/structure";
import { checkBrandHex, THEME_PRESETS } from "@/lib/theme/contrast";
import { t } from "@/lib/i18n";
import type { ActionResult } from "./actions";

/**
 * Board 5b — the theme a sector's storefronts wear.
 *
 * The custom-hex field checks contrast as it is typed, using the same function
 * the service refuses with. That is deliberate duplication of the *call*, not
 * of the logic: the service is the rule and this is the courtesy of finding out
 * before submitting. Criterion 5 asks for the reason to be shown, and a ratio
 * appearing as somebody types is a better answer than one appearing after.
 */

export interface ThemeFormProps {
  templateId: string;
  storeCount: string;
  initial: {
    offeredThemes: string[];
    defaultTheme: string;
    allowCustomHex: boolean;
    typePairing: string;
    density: string;
    cornerRadius: number;
    darkHeader: boolean;
    badgeRemovable: boolean;
  };
  save: (formData: FormData) => Promise<ActionResult>;
}

const MIN_REASON = 4;

export function ThemeForm({ templateId, storeCount, initial, save }: ThemeFormProps) {
  const [offered, setOffered] = useState<string[]>(initial.offeredThemes);
  const [defaultTheme, setDefaultTheme] = useState(initial.defaultTheme);
  const [allowCustomHex, setAllowCustomHex] = useState(initial.allowCustomHex);
  const [typePairing, setTypePairing] = useState(initial.typePairing);
  const [density, setDensity] = useState(initial.density);
  const [cornerRadius, setCornerRadius] = useState(String(initial.cornerRadius));
  const [darkHeader, setDarkHeader] = useState(initial.darkHeader);
  const [badgeRemovable, setBadgeRemovable] = useState(initial.badgeRemovable);
  const [sample, setSample] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const check = sample.trim() ? checkBrandHex(sample) : null;
  const ready = reason.trim().length >= MIN_REASON && offered.length > 0;

  function submit() {
    const form = new FormData();
    form.set("templateId", templateId);
    for (const theme of offered) form.append("offeredThemes", theme);
    form.set("defaultTheme", defaultTheme);
    if (allowCustomHex) form.set("allowCustomHex", "on");
    form.set("typePairing", typePairing);
    form.set("density", density);
    form.set("cornerRadius", cornerRadius);
    if (darkHeader) form.set("darkHeader", "on");
    if (badgeRemovable) form.set("badgeRemovable", "on");
    form.set("reason", reason);

    startTransition(async () => {
      const outcome = await save(form);
      setResult(outcome);
      if (outcome.ok) setReason("");
    });
  }

  return (
    <div className="flex flex-col gap-[var(--gutter)]">
      {result && (
        <Alert tone={result.ok ? "ok" : "bad"} live="assertive">
          {result.ok ? result.message : result.error}
        </Alert>
      )}

      <Panel title={t("theme.offered")} description={t("theme.offered_hint")}>
        <ul className="flex flex-col gap-2">
          {THEME_PRESETS.map((preset) => (
            <li key={preset} className="flex items-center gap-3">
              <Checkbox
                checked={offered.includes(preset)}
                label={t(`theme.preset.${preset}` as never)}
                onChange={(event) =>
                  setOffered((current) =>
                    event.target.checked
                      ? [...current, preset]
                      : current.filter((entry) => entry !== preset),
                  )
                }
              />
              {/*
                A swatch, so somebody choosing is looking at the colour rather
                than at its name. `data-theme` on a storefront root only — this
                is a preview of one, which is the same thing.
              */}
              <span
                data-theme={preset}
                aria-hidden="true"
                className="size-4 shrink-0 rounded-tag border border-line bg-brand"
              />
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title={t("theme.default")} description={t("theme.default_hint")}>
        <RadioGroup legend={t("theme.default")}>
          {offered.map((preset) => (
            <Radio
              key={preset}
              name="defaultTheme"
              value={preset}
              checked={defaultTheme === preset}
              label={t(`theme.preset.${preset}` as never)}
              onChange={() => setDefaultTheme(preset)}
            />
          ))}
        </RadioGroup>
        {offered.length === 0 && (
          <p className="mt-2 text-caption text-bad-ink">{t("theme.none_offered")}</p>
        )}
      </Panel>

      <Panel title={t("theme.custom")} description={t("theme.custom_hint")}>
        <Checkbox
          checked={allowCustomHex}
          label={t("theme.allow_custom")}
          description={t("theme.allow_custom_hint")}
          onChange={(event) => setAllowCustomHex(event.target.checked)}
        />

        {allowCustomHex && (
          <div className="mt-3 flex flex-col gap-1">
            <Label htmlFor="sample-hex" hint={t("theme.try_hint")}>
              {t("theme.try")}
            </Label>
            <Input
              id="sample-hex"
              mono
              value={sample}
              // The shape of the input, not a colour anything renders. A
              // placeholder that did not look like a hex would not show what is
              // being asked for.
              // eslint-disable-next-line no-restricted-syntax
              placeholder="#46584A"
              onChange={(event) => setSample(event.target.value)}
            />
            {check && (
              /*
                Criterion 5: the reason is shown, and the reason is a number.
                "Too light" is not something a seller can act on; "3.1 against
                the page background, and it needs 4.5" is.
              */
              <p className={check.ok ? "text-caption text-ok-ink" : "text-caption text-bad-ink"}>
                {check.reason === "not_a_hex"
                  ? t("theme.not_a_hex")
                  : check.ok
                    ? t("theme.passes", { ratio: String(check.ratio) })
                    : t("theme.below_floor", { ratio: String(check.ratio) })}
              </p>
            )}
          </div>
        )}
      </Panel>

      <Panel title={t("theme.shape")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <RadioGroup legend={t("theme.type_pairing")}>
            {["editorial", "clean", "technical"].map((option) => (
              <Radio
                key={option}
                name="typePairing"
                value={option}
                checked={typePairing === option}
                label={t(`theme.type.${option}` as never)}
                onChange={() => setTypePairing(option)}
              />
            ))}
          </RadioGroup>

          <RadioGroup legend={t("theme.density")}>
            {["compact", "comfortable", "roomy"].map((option) => (
              <Radio
                key={option}
                name="density"
                value={option}
                checked={density === option}
                label={t(`theme.density.${option}` as never)}
                onChange={() => setDensity(option)}
              />
            ))}
          </RadioGroup>

          <div className="flex flex-col gap-1">
            <Label htmlFor="corner-radius" hint={t("theme.radius_hint")}>
              {t("theme.radius")}
            </Label>
            <Input
              id="corner-radius"
              inputMode="numeric"
              suffix="px"
              value={cornerRadius}
              onChange={(event) => setCornerRadius(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-3">
            <Checkbox
              checked={darkHeader}
              label={t("theme.dark_header")}
              onChange={(event) => setDarkHeader(event.target.checked)}
            />
            <Checkbox
              checked={badgeRemovable}
              label={t("theme.badge_removable")}
              description={t("theme.badge_removable_hint")}
              onChange={(event) => setBadgeRemovable(event.target.checked)}
            />
          </div>
        </div>
      </Panel>

      <div className="flex flex-col gap-1">
        <Label
          htmlFor="theme-reason"
          requirement="required"
          requirementLabel={t("field.required")}
          hint={t("theme.reason_hint", { count: storeCount })}
        >
          {t("builder.reason_label")}
        </Label>
        <Textarea
          id="theme-reason"
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>

      <div>
        <Button disabled={!ready || pending} onClick={submit}>
          {t("theme.save", { count: storeCount })}
        </Button>
      </div>
    </div>
  );
}
