import type { RfqLine } from "./rfq-state";

/**
 * The draft behind `/rfq/new`, in session storage.
 *
 * Criterion 11: a buyer who navigates back to a product page to check a spec
 * must return to a filled composer, not an empty one.
 *
 * `useSyncExternalStore` rather than a `useState` seeded in an effect. That
 * shape renders once with the wrong value and corrects itself, which is board
 * 1a's hydration bug in a different costume and what the purity lint refuses —
 * board 1e's selection store landed on this same answer for the same reason,
 * and this is deliberately its twin.
 *
 * Session, not local. This is one sitting's work: a buyer who comes back
 * tomorrow is starting a different job, and a week-old requirement quietly
 * reappearing under them is worse than an empty table.
 */

const KEY = "bl.rfq.draft";
const EMPTY: readonly RfqLine[] = [];

/** Snapshots must be referentially stable or `useSyncExternalStore` loops. */
let cache: readonly RfqLine[] | undefined;
const listeners = new Set<() => void>();

function read(): readonly RfqLine[] {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as { lines?: RfqLine[] };
    return Array.isArray(parsed.lines) && parsed.lines.length > 0 ? parsed.lines : EMPTY;
  } catch {
    // A private window, or storage the browser refused. An empty table is a
    // worse start than a filled one, never a broken page.
    return EMPTY;
  }
}

export function subscribeDraft(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) {
      cache = undefined;
      onChange();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function draftSnapshot(): readonly RfqLine[] {
  if (cache === undefined) cache = read();
  return cache;
}

/** The server knows about no draft, and saying so is what avoids the mismatch. */
export function draftServerSnapshot(): readonly RfqLine[] {
  return EMPTY;
}

export function saveDraft(lines: readonly RfqLine[]): void {
  cache = lines;
  try {
    if (lines.length === 0) window.sessionStorage.removeItem(KEY);
    else window.sessionStorage.setItem(KEY, JSON.stringify({ lines }));
  } catch {
    /* see `read` */
  }
  for (const listener of listeners) listener();
}

export function clearDraft(): void {
  saveDraft([]);
}
