"use client";

import Link from "next/link";
import { buttonClassName } from "@/components/primitives";
import { emitEvent } from "@/components/telemetry";

/**
 * The two ways off board 8e, and the one fact worth recording about them.
 *
 * §1 gives this screen two exits and they mean different things: the dashboard
 * is "carry on", the storefront is "let me look at what I just built". Which
 * one a seller reaches for on the only render of this screen they will ever see
 * is worth telling apart, so each emits `setup_done_exit` with its destination.
 *
 * A client component for the handler alone. Both labels arrive translated —
 * nothing here calls `t()`, and the `href` is built by the server, because a
 * slug assembled in the browser is a slug that can disagree with the one the
 * storefront actually answers on.
 *
 * The beacon is `emitEvent` from the telemetry tier rather than a `fetch` of
 * its own: this is precisely the case its `sendBeacon` path exists for, since
 * the click that reports the exit is also the click that takes the page away.
 */

export interface ExitsProps {
  dashboardLabel: string;
  storefrontLabel: string;
  storefrontHref: string;
  /** Whether the primary sits alone, for the header's compact copy. */
  compact?: boolean;
}

export function Exits({ dashboardLabel, storefrontLabel, storefrontHref, compact }: ExitsProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Link
        href="/dashboard"
        onClick={() => emitEvent("setup_done_exit", { to: "dashboard" })}
        className={buttonClassName({ size: compact ? "md" : "lg" })}
      >
        {dashboardLabel}
      </Link>

      {!compact && (
        <Link
          href={storefrontHref}
          onClick={() => emitEvent("setup_done_exit", { to: "storefront" })}
          className={buttonClassName({ variant: "secondary", size: "lg" })}
        >
          {storefrontLabel}
        </Link>
      )}
    </div>
  );
}
