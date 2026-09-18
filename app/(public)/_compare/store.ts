"use client";

import { useCallback, useState, useSyncExternalStore, type FormEvent } from "react";
import { COMPARE_COOKIE, EMPTY_TRAY, parseTray, type CompareChange, type Tray } from "@/lib/compare/tray";

/**
 * Board `10d` — the tray, as every tick and the sticky bar read it.
 *
 * The cookie is the one source. `/api/compare` writes it on its response, and
 * this module re-reads `document.cookie` whenever something says it may have
 * changed: a tick's post returning, the tab coming back into view (so a tray
 * changed in another tab is not stale here), or a page load. Nothing holds a
 * second copy in React state, because a second copy is a thing that can
 * disagree with the first.
 *
 * `useSyncExternalStore` with an empty server snapshot is what keeps a
 * statically rendered page statically rendered: the server draws every tick
 * unpressed and no tray, and the browser redraws both from the cookie after
 * hydration. The tray is `position: fixed`, so its arrival moves nothing on the
 * page.
 */

const CHANGED = "bl:compare-changed";
export const COMPARE_ENDPOINT = "/api/compare";

/** The last change's result, for the tray's one-line notice. */
let lastNotice: CompareChange | null = null;

let cachedRaw: string | null | undefined;
let cachedTray: Tray = EMPTY_TRAY;

function rawCookie(): string | null {
  const prefix = `${COMPARE_COOKIE}=`;
  for (const part of document.cookie.split("; ")) {
    if (part.startsWith(prefix)) return part.slice(prefix.length);
  }
  return null;
}

/**
 * `document.cookie` is the value as sent — percent-encoded by the server's
 * cookie store. Decoded once here, as the server's own `cookies().get` does,
 * so both sides hand `parseTray` the same JSON.
 */
function decoded(raw: string | null): string | null {
  if (raw === null) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/** A stable snapshot: the same tray object until the cookie's bytes change. */
function snapshot(): Tray {
  const raw = rawCookie();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedTray = parseTray(decoded(raw));
  }
  return cachedTray;
}

function serverSnapshot(): Tray {
  return EMPTY_TRAY;
}

function subscribe(onChange: () => void): () => void {
  const onVisible = () => {
    if (document.visibilityState === "visible") onChange();
  };
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("focus", onChange);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("focus", onChange);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

export function useTray(): Tray {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

function noticeSnapshot(): CompareChange | null {
  return lastNotice;
}

function noticeServerSnapshot(): CompareChange | null {
  return null;
}

/** The last add or remove, so the tray can say what just happened to it. */
export function useTrayNotice(): CompareChange | null {
  return useSyncExternalStore(subscribe, noticeSnapshot, noticeServerSnapshot);
}

/** The cookie on the response is the new tray; tell every reader to look again. */
export function trayChanged(change: CompareChange | null) {
  lastNotice = change;
  window.dispatchEvent(new Event(CHANGED));
}

/**
 * One change at a time.
 *
 * Each post carries the cookie as it stood when it left, and its answer
 * replaces it whole. Two ticks pressed in quick succession would both leave
 * holding the tray before either, and the second answer would overwrite the
 * first — the buyer ticks two products and the tray holds one. Chained, each
 * post leaves after the previous answer has set the cookie it reads.
 */
let inflight: Promise<unknown> = Promise.resolve();

/**
 * Posting a tick or a tray control, with JavaScript on.
 *
 * The form's own `action` is `/api/compare` and works without any of this: the
 * browser posts it and the route sends the buyer back with the cookie set. This
 * does the same post without leaving the page, and reads the answer. If the
 * request fails the form is submitted the plain way, so a flaky connection gets
 * the page reload rather than a control that silently did nothing.
 */
export function useCompareSubmit(): { pending: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void } {
  const [pending, setPending] = useState(false);
  const onSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = new FormData(form);
    setPending(true);
    const run = inflight.then(async () => {
      try {
        const response = await fetch(COMPARE_ENDPOINT, {
          method: "POST",
          body,
          headers: { Accept: "application/json" },
          credentials: "same-origin",
        });
        if (!response.ok) throw new Error(String(response.status));
        trayChanged((await response.json()) as CompareChange);
      } catch {
        form.submit();
      } finally {
        setPending(false);
      }
    });
    inflight = run;
  }, []);
  return { pending, onSubmit };
}
