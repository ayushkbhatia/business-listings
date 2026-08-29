"use client";

import { useState } from "react";
import { Alert } from "@/components/display";
import { Button, Input, Label } from "@/components/primitives";
import { Panel } from "@/components/structure";
import { t } from "@/lib/i18n";

/**
 * Criterion 8's visible half — the alert a buyer sets from a zero-result page.
 *
 * A mobile number and nothing else. No account, because the whole population
 * reaching this page is people whose search failed, and asking them to sign up
 * first would lose almost all of them — the same reason the RFQ flow mints a
 * provisional identity rather than demanding one.
 */

export type AlertActionResult = { ok: true; message: string } | { ok: false; error: string };

export function AlertForm({
  query,
  categoryId,
  emirate,
  create,
}: {
  query: string;
  categoryId?: string;
  emirate?: string;
  create: (formData: FormData) => Promise<AlertActionResult>;
}) {
  const [contact, setContact] = useState("");
  const [name, setName] = useState("");
  const [result, setResult] = useState<AlertActionResult | null>(null);
  const [pending, setPending] = useState(false);

  function send() {
    const form = new FormData();
    form.set("query", query);
    if (categoryId) form.set("categoryId", categoryId);
    if (emirate) form.set("emirate", emirate);
    form.set("contact", contact);
    form.set("fullName", name);

    void (async () => {
      setPending(true);
      try {
        const outcome = await create(form);
        setResult(outcome);
        if (outcome.ok) {
          setContact("");
          setName("");
        }
      } finally {
        setPending(false);
      }
    })();
  }

  return (
    <Panel title={t("alert.title")}>
      {result && (
        <Alert tone={result.ok ? "ok" : "bad"}>
          {result.ok ? result.message : result.error}
        </Alert>
      )}

      <p className="mt-2 max-w-[var(--measure-prose)] text-body-sm text-prose">{t("alert.body")}</p>

      <p className="mt-3 font-mono text-eyebrow uppercase text-faint">
        {t("alert.watching")}: {query}
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="alert-contact">{t("alert.contact")}</Label>
          <Input
            id="alert-contact"
            type="tel"
            value={contact}
            onChange={(event) => setContact(event.target.value)}
          />
          <p className="mt-1 text-caption text-muted">{t("alert.contact_hint")}</p>
        </div>
        <div>
          <Label htmlFor="alert-name">{t("alert.name")}</Label>
          <Input id="alert-name" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
      </div>

      {/* Button takes no className — variants are props, §09. */}
      <div className="mt-4">
        <Button onClick={send} disabled={pending || contact.trim().length < 5}>
          {t("alert.submit")}
        </Button>
      </div>
    </Panel>
  );
}
