"use client";

import { useState } from "react";
import { Alert } from "@/components/display";
import { Button } from "@/components/primitives";
import { Card, Modal } from "@/components/structure";
import { t } from "@/lib/i18n";
import type { SellsChoice } from "@/lib/onboarding/kind";

/**
 * Board `2b-s` B5 — the Settings path the onboarding copy promises.
 *
 * Confirmed rather than a plain control, because after publication this changes
 * which screens a seller gets and what a buyer is asked. And the confirmation
 * says the one thing a seller actually wants to know at that moment: **nothing
 * you have entered is converted or deleted.**
 */

const LABEL: Record<SellsChoice, string> = {
  services: t("kind.services_title"),
  goods: t("kind.goods_title"),
  both: t("kind.both_title"),
};

export function SellsKindCard({
  current,
  published,
  change,
}: {
  current: SellsChoice | null;
  published: boolean;
  change: (formData: FormData) => Promise<{ ok: boolean; message: string }>;
}) {
  const [picked, setPicked] = useState<SellsChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  function commit() {
    if (!picked) return;
    const form = new FormData();
    form.set("kind", picked);
    void (async () => {
      setBusy(true);
      try {
        setResult(await change(form));
        setPicked(null);
      } finally {
        setBusy(false);
      }
    })();
  }

  return (
    <Card>
      {result && <Alert tone={result.ok ? "ok" : "bad"}>{result.message}</Alert>}

      <p className="font-mono text-eyebrow uppercase tracking-wide text-faint">
        {t("kind.settings_title")}
      </p>
      <p className="mt-1 max-w-prose text-body-sm text-prose">{t("kind.settings_body")}</p>
      <p className="mt-2 text-body text-ink">
        {t("kind.settings_current", {
          kind: current ? LABEL[current] : t("kind.settings_unset"),
        })}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {(["services", "goods", "both"] as const)
          .filter((key) => key !== current)
          .map((key) => (
            <Button key={key} variant="secondary" onClick={() => setPicked(key)}>
              {LABEL[key]}
            </Button>
          ))}
      </div>

      <Modal
        open={picked !== null}
        onClose={() => setPicked(null)}
        title={t("kind.settings_confirm_title")}
        closeLabel={t("kind.settings_cancel")}
      >
        <div className="flex flex-col gap-3">
          <p className="max-w-prose text-body-sm text-prose">{t("kind.settings_keeps")}</p>
          {published && (
            <p className="max-w-prose text-body-sm text-prose">{t("kind.settings_published")}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={commit} disabled={busy}>
              {t("kind.settings_go")}
            </Button>
            <Button variant="ghost" onClick={() => setPicked(null)}>
              {t("kind.settings_cancel")}
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
