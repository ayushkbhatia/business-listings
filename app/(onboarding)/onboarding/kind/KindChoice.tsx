"use client";

import { useState } from "react";
import { Alert } from "@/components/display";
import { Button } from "@/components/primitives";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { SellsChoice } from "@/lib/onboarding/kind";

/**
 * Board `2b-s` — the three options.
 *
 * ## Why this is a radio group and not three buttons
 *
 * Three buttons that each submit would make the choice and the commit one
 * action, which reads as three ways out of the screen rather than one question
 * with three answers. It also removes the seller's chance to change their mind
 * before continuing, and makes the recommendation impossible to express: a
 * pre-selected option is a radio, and a pre-pressed button is nothing.
 *
 * ## Why choosing against the recommendation is silent
 *
 * AC4: *"Choosing against the recommendation is unimpeded — no extra
 * confirmation, no warning copy."* The licence is evidence, not authority. A
 * trading licence held by a consultancy is the exact case this screen exists
 * for, and a seller who has to argue past a warning to describe their own
 * business learns that the form knows better than they do.
 *
 * The button label changes with the choice — "Continue as a services business"
 * — so what is about to happen is legible without a confirmation step.
 */

const OPTIONS: {
  key: SellsChoice;
  title: string;
  lead: string;
  points: [string, string, string];
}[] = [
  {
    key: "services",
    title: t("kind.services_title"),
    lead: t("kind.services_lead"),
    points: [t("kind.services_1"), t("kind.services_2"), t("kind.services_3")],
  },
  {
    key: "goods",
    title: t("kind.goods_title"),
    lead: t("kind.goods_lead"),
    points: [t("kind.goods_1"), t("kind.goods_2"), t("kind.goods_3")],
  },
  {
    key: "both",
    title: t("kind.both_title"),
    lead: t("kind.both_lead"),
    points: [t("kind.both_1"), t("kind.both_2"), t("kind.both_3")],
  },
];

const CONTINUE: Record<SellsChoice, string> = {
  services: t("kind.continue_services"),
  goods: t("kind.continue_goods"),
  both: t("kind.continue_both"),
};

export function KindChoice({
  suggested,
  current,
  choose,
}: {
  /** Null when the licence was not conclusive. Nothing is pre-selected then. */
  suggested: SellsChoice | null;
  /** What they said last time, which wins over the recommendation. */
  current: SellsChoice | null;
  choose: (formData: FormData) => Promise<{ ok: false; error: string } | void>;
}) {
  // Their own previous answer first, then the recommendation, then nothing.
  const [picked, setPicked] = useState<SellsChoice | null>(current ?? suggested);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function send() {
    if (!picked) return;
    const form = new FormData();
    form.set("kind", picked);
    void (async () => {
      setBusy(true);
      setError(null);
      try {
        // Resolves only on refusal; the success path redirects.
        const outcome = await choose(form);
        if (outcome && !outcome.ok) setError(outcome.error);
      } catch {
        setError(t("kind.error_generic"));
      } finally {
        setBusy(false);
      }
    })();
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert tone="bad">{error}</Alert>}

      <fieldset className="flex flex-col gap-3 border-0 p-0">
        <legend className="sr-only">{t("kind.decides_eyebrow")}</legend>

        {OPTIONS.map((option) => {
          const selected = picked === option.key;
          return (
            <label
              key={option.key}
              className={cn(
                "flex cursor-pointer gap-3 rounded-card border-[1.5px] p-4",
                "transition-colors duration-120 ease-out",
                "focus-within:shadow-focus",
                selected ? "border-moss bg-moss-wash" : "border-line bg-card hover:border-moss-muted",
              )}
            >
              <input
                type="radio"
                name="kind"
                value={option.key}
                checked={selected}
                onChange={() => setPicked(option.key)}
                className="mt-1 h-4 w-4 shrink-0 accent-[var(--moss)] focus-visible:outline-none"
              />

              <span className="flex flex-col gap-1.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-h3 text-ink">{option.title}</span>
                  {/*
                     The badge marks the licence's answer, not the current
                     selection — so it stays put when a seller overrules it and
                     they can see exactly what they are disagreeing with.
                  */}
                  {suggested === option.key && (
                    <span className="rounded-pill border border-moss-line bg-moss-wash px-2 py-0.5 font-mono text-eyebrow uppercase tracking-wide text-moss-deep">
                      {t("kind.matches")}
                    </span>
                  )}
                </span>

                <span className="text-body-sm text-prose">{option.lead}</span>

                <ul className="mt-1 flex flex-col gap-1">
                  {option.points.map((point) => (
                    <li key={point} className="text-caption text-muted">
                      {point}
                    </li>
                  ))}
                </ul>
              </span>
            </label>
          );
        })}
      </fieldset>

      <div className="flex flex-col gap-1">
        <Button onClick={send} disabled={!picked || busy}>
          {picked ? CONTINUE[picked] : t("kind.continue_none")}
        </Button>
        <p className="text-caption text-faint">{t("kind.next")}</p>
      </div>
    </div>
  );
}
