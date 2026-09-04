"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * Board 1i's live status card.
 *
 * The one region of the page that revalidates. The requirement, the lines and
 * the sidebar beside it do not change while a buyer watches, and re-fetching
 * them every thirty seconds would be thirty seconds of work to redraw the same
 * page.
 *
 * Every row arrives already rendered from the server. The state machine, the
 * latency arithmetic, the sort and the nudge eligibility are all decided there,
 * where they are tested without a browser — this file decides only when to ask
 * again and how to announce what came back.
 */

const POLL_MS = 30_000;

export interface LiveStatusProps {
  /** The rows, server-rendered. Replaced wholesale by each poll. */
  rows: React.ReactNode;
  /** How many have quoted right now, so a change can be noticed. */
  quotedCount: number;
  heading: string;
  closesLabel: string;
  listLabel: string;
  /**
   * The announcement, as templates rather than a formatter.
   *
   * A function cannot cross from a server component to a client one, and this
   * page is the sixth in this repo to prove it. The server hands over both
   * plural forms with a `{count}` placeholder; the client picks and substitutes,
   * which is the only arithmetic it does.
   */
  announceOne: string;
  announceMany: string;
}

export function LiveStatus({
  rows,
  quotedCount,
  heading,
  closesLabel,
  listLabel,
  announceOne,
  announceMany,
}: LiveStatusProps) {
  const router = useRouter();
  const [announcement, setAnnouncement] = useState("");
  const [pulsing, setPulsing] = useState(false);
  const seen = useRef(quotedCount);

  /*
     Poll while the tab is visible, stop when it is hidden.

     Criterion 7, and it is not only politeness: a buyer leaves this tab open
     for days, and a page that keeps asking every thirty seconds in a background
     tab is a page that drains a phone to tell nobody anything.
  */
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      /*
         `router.refresh()` re-runs the server components for this route and
         reconciles the result into the live tree. Client state survives it, so
         the buyer's scroll position and anything they have open stay put — the
         rows change and nothing else moves.

         The first version fetched the URL and dispatched an event, which asked
         the server for a page and then threw the answer away.
      */
      timer = setInterval(() => router.refresh(), POLL_MS);
    };

    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => (document.hidden ? stop() : start());
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router]);

  /*
     A new quote is announced politely and pulsed once.

     The motion rules permit exactly one exception on this page and this is it:
     a single moss pulse on the count. No sound, and no badge count in the tab
     title — a buyer with this open in a background tab has not asked to be
     interrupted, only to be able to find out.
  */
  useEffect(() => {
    if (quotedCount <= seen.current) {
      seen.current = quotedCount;
      return;
    }
    const arrived = quotedCount - seen.current;
    seen.current = quotedCount;
    const template = arrived === 1 ? announceOne : announceMany;
    setAnnouncement(template.replace("{count}", String(arrived)));
    setPulsing(true);
    const timer = setTimeout(() => setPulsing(false), 900);
    return () => clearTimeout(timer);
  }, [quotedCount, announceOne, announceMany]);

  return (
    <section className="rounded-card border border-line bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="text-h3 text-ink">{heading}</h2>
        <span
          className={cn(
            "font-mono text-eyebrow uppercase tracking-eyebrow text-faint",
            pulsing && "text-moss transition-colors duration-180",
          )}
        >
          {closesLabel}
        </span>
      </div>

      {/*
         Polite, not assertive. A quote arriving is good news that can wait for
         a gap in what the buyer is already reading; interrupting them
         mid-sentence to say so is worse than telling them a moment later.
      */}
      <p aria-live="polite" role="status" className="sr-only">
        {announcement}
      </p>

      <ul aria-label={listLabel}>{rows}</ul>
    </section>
  );
}
