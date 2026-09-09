"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/display";
import { Button } from "@/components/primitives";
import { Panel } from "@/components/structure";
import { t } from "@/lib/i18n";
import type { ActionResult } from "./actions";

/**
 * Board 5e, from the seller's side — the second design.
 *
 * The first drew a form for a hostname, two DNS records to copy, a status
 * badge per record, a propagation explainer, a named failure cause and a button
 * that emailed the records to whoever runs the seller's DNS. All of it existed
 * because the address belonged to somebody else and had to be proved.
 *
 * The address is ours now. There is nothing to type, nothing to copy, nothing
 * to prove and nothing to wait for — so the screen is a sentence, an address
 * and one button, and the whole of the old flow's honesty problem (a
 * certificate step we could not perform) goes with it.
 *
 * The address is shown before it is taken. A seller reads what they are about
 * to be given rather than agreeing to a surprise, and where it cannot be given
 * they are told which of the two reasons applies instead of being handed a
 * button that refuses.
 */

export interface AddressPanelProps {
  /** The address they hold, or null where they hold none. */
  hostname: string | null;
  /** The address they would be given. Null once they hold one, or when locked. */
  proposedHostname: string | null;
  /** Why they cannot be given it, or null where they can. */
  refusal: string | null;
  claim: () => Promise<ActionResult>;
  drop: () => Promise<ActionResult>;
}

export function AddressPanel({
  hostname,
  proposedHostname,
  refusal,
  claim,
  drop,
}: AddressPanelProps) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function send(action: () => Promise<ActionResult>) {
    setResult(null);
    startTransition(async () => setResult(await action()));
  }

  return (
    <Panel title={t("domain.title")}>
      <p className="max-w-prose text-body-sm text-prose">{t("domain.explain")}</p>

      {hostname ? (
        <>
          <div className="mt-4 rounded-chip border border-line bg-paper-sunk p-4">
            <p className="font-mono text-eyebrow uppercase text-faint">{t("domain.hostname")}</p>
            {/*
               A link, because the first thing anybody does with an address is
               check that it works. `rel="noreferrer"` and a new tab: this is
               the seller's own storefront, and losing the dashboard to it is a
               step backwards from a screen they are still working on.
            */}
            <a
              href={`https://${hostname}`}
              target="_blank"
              rel="noreferrer"
              className="mt-1 block break-all font-mono text-body text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
            >
              {hostname}
            </a>
            <p className="mt-2 max-w-prose text-caption text-body">{t("domain.live_note")}</p>
          </div>

          <div className="mt-4">
            <Button variant="secondary" loading={pending} onClick={() => send(drop)}>
              {t("domain.remove")}
            </Button>
            <p className="mt-1.5 max-w-prose text-caption text-body">{t("domain.remove_hint")}</p>
          </div>
        </>
      ) : refusal ? (
        <div className="mt-4">
          <Alert tone="warn" live="off">
            {refusal === "taken" ? t("domain.error.taken") : t("domain.error.unusable")}
          </Alert>
        </div>
      ) : (
        <>
          <div className="mt-4 rounded-chip border border-line bg-paper-sunk p-4">
            <p className="font-mono text-eyebrow uppercase text-faint">{t("domain.proposed")}</p>
            <p className="mt-1 break-all font-mono text-body text-ink">{proposedHostname}</p>
            <p className="mt-2 max-w-prose text-caption text-body">{t("domain.proposed_hint")}</p>
          </div>

          <div className="mt-4">
            <Button loading={pending} onClick={() => send(claim)}>
              {t("domain.claim")}
            </Button>
          </div>
        </>
      )}

      {result && (
        <div className="mt-4">
          <Alert tone={result.ok ? "ok" : "bad"} live={result.ok ? "polite" : "assertive"}>
            {result.ok ? (result.message ?? t("domain.added")) : result.error}
          </Alert>
        </div>
      )}
    </Panel>
  );
}
