"use client";

import { useState } from "react";
import { Button } from "@/components/primitives";
import { t } from "@/lib/i18n";

/**
 * The first card in the rail: the listing's own address.
 *
 * It is first because it is the proof of the header's claim. A page that opens
 * "You're live" and then shows a pricing table has asked the seller to take the
 * first half on trust; the URL, with a button that opens it, is the evidence.
 *
 * On ink, because this is the one card on the page that is a statement rather
 * than an argument — and `--moss-on-ink` is the only accent §01 permits there.
 *
 * A client component for one reason: `navigator.clipboard`. The rest would
 * render happily on the server, and the copy button is the whole cost.
 */
export function LiveRail({ url, href }: { url: string; href: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <section
      aria-label={t("plan_step.live_at")}
      className="rounded-card border border-line bg-ink p-5"
    >
      <h2 className="font-mono text-eyebrow uppercase tracking-wide text-on-ink-faint">
        {t("plan_step.live_at")}
      </h2>

      {/*
        Mono and breakable. A slug is a machine string, and one that overflows
        its card on a narrow rail is a URL the seller cannot read to check.
      */}
      <p className="mt-2.5 break-all font-mono text-body-sm leading-relaxed text-on-ink">{url}</p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <a
          href={href}
          className="inline-flex items-center rounded-ctl bg-paper px-3.5 py-2 text-body-sm font-medium text-ink hover:bg-card focus-visible:shadow-focus-on-ink focus-visible:outline-none"
        >
          {t("plan_step.view_it")}
        </a>

        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            /*
               Optimistic, and it stays said. `navigator.clipboard` is absent on
               an insecure origin and rejects when the document is not focused,
               and neither is worth a red error over a convenience — the URL is
               on screen either way, which is the point of rendering it.
            */
            void navigator.clipboard?.writeText(href).catch(() => {});
            setCopied(true);
          }}
        >
          {copied ? t("plan_step.copied") : t("plan_step.copy_link")}
        </Button>
      </div>
    </section>
  );
}
