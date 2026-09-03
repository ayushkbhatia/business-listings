/**
 * The catalogue selection, as an external store.
 *
 * `sessionStorage` is exactly what `useSyncExternalStore` is for: state that
 * lives outside React, does not exist on the server, and must not be read
 * during render. Seeding `useState` from it in an effect works and is what this
 * was first written as — the lint rule that refuses it is right, because that
 * shape renders once with the wrong value and then corrects itself, which is
 * the hydration mismatch board 1a already produced once.
 *
 * `getServerSnapshot` returns the empty selection, so the HTML and the first
 * client paint agree; the stored selection arrives on the subscription instead.
 *
 * Keyed by seller. Board 1e is emphatic that this is not a basket: nothing
 * crosses storefronts, nothing survives the session, and the clearing when a
 * buyer leaves is silent because nothing of value is lost.
 */

const EMPTY: readonly string[] = [];

/** Snapshots must be referentially stable or `useSyncExternalStore` loops. */
const cache = new Map<string, readonly string[]>();
const listeners = new Map<string, Set<() => void>>();

export function selectionKey(businessSlug: string): string {
  return `bl.catalogue.selection.${businessSlug}`;
}

function read(key: string): readonly string[] {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : EMPTY;
  } catch {
    // A private window, or storage the browser refuses. The page works without
    // a remembered selection; it just does not remember one.
    return EMPTY;
  }
}

function notify(key: string): void {
  for (const listener of listeners.get(key) ?? []) listener();
}

export function subscribeSelection(key: string): (onChange: () => void) => () => void {
  return (onChange) => {
    const set = listeners.get(key) ?? new Set();
    set.add(onChange);
    listeners.set(key, set);

    // Another tab on the same storefront is a legitimate second view of the
    // same scratchpad.
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) {
        cache.delete(key);
        onChange();
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      set.delete(onChange);
      window.removeEventListener("storage", onStorage);
    };
  };
}

export function selectionSnapshot(key: string): readonly string[] {
  if (!cache.has(key)) cache.set(key, read(key));
  return cache.get(key)!;
}

/** The server has no session storage, and neither does the first paint. */
export function selectionServerSnapshot(): readonly string[] {
  return EMPTY;
}

export function setSelection(key: string, next: readonly string[]): void {
  cache.set(key, next);
  try {
    if (next.length === 0) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, JSON.stringify(next));
  } catch {
    // As above — the selection still works for this page view.
  }
  notify(key);
}
