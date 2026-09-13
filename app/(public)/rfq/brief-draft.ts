import type { BriefValue } from "@/components/domain/ServiceBriefComposer";

/**
 * The draft behind a brief on `/rfq/new`, in session storage.
 *
 * *Not signed in: composed freely, draft preserved* — and the same for a buyer
 * who steps back to a firm's storefront to check its coverage and returns. The
 * goods composer's store (`rfq-draft.ts`) is the pattern and the reasons are
 * its reasons: `useSyncExternalStore` so a restore lands on the first client
 * render, and session rather than local, because a week-old brief reappearing
 * under a new one is worse than a blank page.
 *
 * **Keyed to the trade and the named firm.** A brief half-written for Hard FM
 * must not fill the page when the buyer opens one for pest control, or for a
 * different firm's storefront.
 *
 * Files are not kept — a `File` does not survive storage — but their names
 * are, so the page can say which ones to attach again rather than silently
 * sending a brief without them.
 */

export interface BriefDraft {
  scope: string;
  value: BriefValue;
  widen: boolean;
  fileNames: string[];
  warned: boolean;
}

const KEY = "bl.brief.draft";

let cache: BriefDraft | null | undefined;
const listeners = new Set<() => void>();

function read(): BriefDraft | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BriefDraft>;
    return typeof parsed.scope === "string" && parsed.value ? (parsed as BriefDraft) : null;
  } catch {
    // Private window, or storage refused. A blank brief, never a broken page.
    return null;
  }
}

export function briefDraftScope(categoryId: string, pinned: string | null): string {
  return `${categoryId}:${pinned ?? ""}`;
}

export function subscribeBriefDraft(onChange: () => void): () => void {
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

export function briefDraftSnapshot(): BriefDraft | null {
  if (cache === undefined) cache = read();
  return cache;
}

/** The server holds no draft, and saying so is what avoids the mismatch. */
export function briefDraftServerSnapshot(): BriefDraft | null {
  return null;
}

export function saveBriefDraft(draft: BriefDraft | null): void {
  cache = draft;
  try {
    if (draft) window.sessionStorage.setItem(KEY, JSON.stringify(draft));
    else window.sessionStorage.removeItem(KEY);
  } catch {
    /* see `read` */
  }
  for (const listener of listeners) listener();
}
