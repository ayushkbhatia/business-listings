"use client";

import { useEffect, useRef } from "react";
import { requiresSession, type EventName, type EventPropValue } from "@/lib/telemetry/events";
import { sessionId } from "@/lib/telemetry/session";

/**
 * Fires one event when a page opens, and optionally one when the reader stops
 * looking at it. Renders nothing.
 *
 * ## Why it is a component and not a hook
 *
 * The pages that need it are server components. A component can be dropped into
 * their tree with plain data props; a hook would force the whole screen across
 * the client boundary for a counter. Every prop here is data for that reason —
 * `hiddenName` is an event *name*, not a callback, because a server component
 * cannot pass a function to a client one (the repeated defect this codebase has
 * a rule about).
 *
 * ## Why `visibilitychange` and not `unload`
 *
 * `unload` does not fire reliably on mobile Safari, and it is excluded from the
 * back/forward cache besides — which means the one event that matters most,
 * `setup_hub_abandoned`, is the one it would lose. `visibilitychange` to hidden
 * fires when a tab is switched away from, when an app is backgrounded, and when
 * a phone is locked.
 *
 * The consequence is worth stating rather than hiding: a tab switch counts as
 * leaving. The event means "the reader stopped looking at this page", and
 * coming back does not produce a second one — it fires at most once per mount.
 */

const ENDPOINT = "/api/events";

export interface PageEventProps {
  /** Fired once, on mount. */
  name: EventName;
  /**
   * Carried as a prop on the event.
   *
   * Only `listing_viewed` reads it: for every other event the server takes the
   * business from the actor's own seat and ignores whatever a body claims.
   */
  businessId?: string;
  /**
   * Plain scalars. `/api/events` drops any key the event does not declare in
   * `lib/telemetry/events.ts`, so a prop left behind by a rename is discarded
   * rather than stored.
   */
  props?: Readonly<Record<string, EventPropValue>>;
  /** Fired once when the reader leaves. Omit it and nothing is sent on leaving. */
  hiddenName?: EventName;
  hiddenProps?: Readonly<Record<string, EventPropValue>>;
}

type Payload = {
  sessionId?: string;
  events: { name: EventName; props: Record<string, EventPropValue> }[];
};

/**
 * Send one event now.
 *
 * Exported so a click handler can reach it — board 8e's two exits emit
 * `setup_done_exit` on the way out, and a page leaving is exactly the case the
 * beacon below exists for. A second copy of this function in a page component
 * would be a second thing to get wrong about the Blob and the fallback.
 */
export function emitEvent(name: EventName, props: Record<string, EventPropValue>): void {
  const payload: Payload = { events: [{ name, props }] };
  // Minted only where the event declares it needs one. A storefront that emits
  // `listing_viewed` alone never creates an identifier at all — see
  // docs/telemetry.md, which is also why there is no consent banner.
  if (requiresSession(name)) payload.sessionId = sessionId();

  const body = JSON.stringify(payload);

  /*
     `sendBeacon` where it exists, because it survives the page going away and a
     plain fetch does not. Behind a feature check rather than assumed: it is not
     in every browser this directory is read in, and a missing counter must
     never be a thrown error on a supplier's screen.

     A Blob, not the string — a bare string is sent as `text/plain` and the
     route parses JSON. A false return means the browser's queue is full, which
     is a reason to try the other path rather than to give up.
  */
  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    if (navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }))) return;
  }

  void fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {
    // Nothing to do and nothing to tell anybody. The page is the product; this
    // is a count, and a failed count must not reach a reader.
  });
}

export function PageEvent({
  name,
  businessId,
  props,
  hiddenName,
  hiddenProps,
}: PageEventProps): null {
  const firedRef = useRef(false);
  const leftRef = useRef(false);
  const pendingRef = useRef<number | null>(null);

  useEffect(() => {
    // A remount cancels the departure queued by the teardown below.
    if (pendingRef.current !== null) {
      window.clearTimeout(pendingRef.current);
      pendingRef.current = null;
    }

    const openedAt = Date.now();
    const withBusiness = (extra?: Readonly<Record<string, EventPropValue>>) => ({
      ...(businessId ? { businessId } : {}),
      ...extra,
    });

    if (!firedRef.current) {
      firedRef.current = true;
      emitEvent(name, withBusiness(props));
    }

    if (!hiddenName) return;

    const leave = () => {
      if (leftRef.current) return;
      leftRef.current = true;
      /*
         `msOnScreen` is sent on every departure and declared only by
         `setup_hub_abandoned`; the server drops it from the rest. That is what
         the prop stripping is for, and it keeps this component from having to
         know which events want it.

         Computing a number in a client component is not the hydration bug the
         house rules are about — that one is about *formatting* for render.
         Nothing here reaches the markup.
      */
      emitEvent(hiddenName, { ...withBusiness(hiddenProps), msOnScreen: Date.now() - openedAt });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") leave();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      /*
         Queued rather than sent, by one tick.

         React's development StrictMode mounts, tears down and immediately
         remounts. Firing here synchronously would report that the seller
         abandoned the hub in the same instant they opened it, on every local
         page load. A remount clears the timer; a real unmount — the seller
         navigating to another screen without hiding the tab — lets it run.
      */
      pendingRef.current = window.setTimeout(leave, 0);
    };
    /*
       Once per mount, by design. The event describes the page opening, and
       re-firing it because a score prop changed would count one visit twice.
       A caller that wants a new event on new data should give this a `key`.
    */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
