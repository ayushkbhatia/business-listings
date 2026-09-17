"use client";

import { useState, useTransition } from "react";
import { Button, Input, Label, Toggle } from "@/components/primitives";
import { Alert } from "@/components/display";
import { t } from "@/lib/i18n";
import { DETECTOR_BOUNDS, type DetectorRules } from "@/lib/reports/detector-rules";
import type { ActionResult } from "../actions";

/**
 * Board 4h `B11` — the detector thresholds, with an explicit save.
 *
 * Not autosave. The dashboard autosaves and the console does not where a change
 * reaches beyond the screen: moving either of these numbers changes what lands
 * in front of every moderator tomorrow, and it carries a written reason into
 * the audit log, which is not a thing to write on every keystroke.
 *
 * The toggles apply on save with the rest of the form rather than immediately —
 * the design system's rule is never to mix the two in one section, and a switch
 * that took effect while the number beside it was still being typed would leave
 * a sweep running on half a decision.
 */

const MIN_REASON = 4;

export function DetectorForm({
  rules,
  save,
}: {
  rules: DetectorRules;
  save: (formData: FormData) => Promise<ActionResult>;
}) {
  const [phone, setPhone] = useState(String(rules.sharedPhoneListings));
  const [days, setDays] = useState(String(rules.licenceExpiredDays));
  const [sharedPhone, setSharedPhone] = useState(rules.sweeps.shared_phone);
  const [licence, setLicence] = useState(rules.sweeps.licence_long_expired);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function send() {
    const form = new FormData();
    form.set("sharedPhoneListings", phone);
    form.set("licenceExpiredDays", days);
    if (sharedPhone) form.set("shared_phone", "on");
    if (licence) form.set("licence_long_expired", "on");
    form.set("reason", reason);
    startTransition(async () => {
      const outcome = await save(form);
      setResult(outcome);
      if (outcome.ok) setReason("");
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <Toggle
          checked={sharedPhone}
          onChange={setSharedPhone}
          label={t("admin.detectors.shared_phone")}
          description={t("admin.detectors.shared_phone_hint")}
        />
        <div className="max-w-40">
          <Label htmlFor="shared-phone-listings">{t("admin.detectors.shared_phone_field")}</Label>
          <Input
            id="shared-phone-listings"
            type="number"
            inputMode="numeric"
            min={DETECTOR_BOUNDS.sharedPhoneListings.min}
            max={DETECTOR_BOUNDS.sharedPhoneListings.max}
            value={phone}
            disabled={!sharedPhone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </div>
        <p className="text-caption text-muted">
          {t("admin.detectors.bounds", {
            min: String(DETECTOR_BOUNDS.sharedPhoneListings.min),
            max: String(DETECTOR_BOUNDS.sharedPhoneListings.max),
          })}
        </p>
      </section>

      <section className="flex flex-col gap-2 border-t border-line pt-4">
        <Toggle
          checked={licence}
          onChange={setLicence}
          label={t("admin.detectors.licence")}
          description={t("admin.detectors.licence_hint")}
        />
        <div className="max-w-40">
          <Label htmlFor="licence-expired-days">{t("admin.detectors.licence_field")}</Label>
          <Input
            id="licence-expired-days"
            type="number"
            inputMode="numeric"
            min={DETECTOR_BOUNDS.licenceExpiredDays.min}
            max={DETECTOR_BOUNDS.licenceExpiredDays.max}
            value={days}
            disabled={!licence}
            onChange={(event) => setDays(event.target.value)}
          />
        </div>
        <p className="text-caption text-muted">
          {t("admin.detectors.bounds", {
            min: String(DETECTOR_BOUNDS.licenceExpiredDays.min),
            max: String(DETECTOR_BOUNDS.licenceExpiredDays.max),
          })}
        </p>
      </section>

      <section className="flex flex-col gap-2 border-t border-line pt-4">
        <Label htmlFor="detector-reason" hint={t("admin.detectors.reason_hint")}>
          {t("admin.review.reason_label")}
        </Label>
        <Input
          id="detector-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <div>
          <Button disabled={reason.trim().length < MIN_REASON || pending} onClick={send}>
            {t("admin.detectors.save")}
          </Button>
        </div>
      </section>

      {result && (
        <Alert
          tone={result.ok ? "ok" : "bad"}
          live={result.ok ? "polite" : "assertive"}
          {...(result.ok ? {} : { fix: result.fix })}
        >
          {result.ok ? result.message : result.error}
        </Alert>
      )}
    </div>
  );
}
