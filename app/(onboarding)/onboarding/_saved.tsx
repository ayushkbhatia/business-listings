"use client";

import { createContext, useContext, useMemo, useState } from "react";

/**
 * When this step last saved, held above the header and the form.
 *
 * Boards `2c` and `2d` both put the timestamp in the chrome — "`Saved 20 seconds
 * ago` in the header" — and it is the promise the autosave steps rest on: a
 * seller can close the tab at any point and come back to everything intact. It
 * lives beside the shell rather than inside either step for that reason; two
 * copies of a receipt is two receipts to keep in agreement.
 *
 * The form is what knows a save landed and the header is what says so, and they
 * are siblings under the page. A context spans them, the same way board 2b's
 * "Save & exit" reaches the form it saves.
 *
 * There was briefly a second indicator beside the Continue button. Two places
 * telling a seller the same thing is one place too many to keep in agreement,
 * and the one the boards ask for is the header.
 */

interface SavedValue {
  label: string;
  setSaved: (label: string) => void;
}

const SavedContext = createContext<SavedValue | null>(null);

export function useSaved(): SavedValue {
  const value = useContext(SavedContext);
  if (!value) throw new Error("useSaved was called outside SavedProvider");
  return value;
}

export function SavedProvider({
  initial,
  children,
}: {
  /** Server-rendered, so the first paint carries a real time rather than nothing. */
  initial: string;
  children: React.ReactNode;
}) {
  const [label, setSaved] = useState(initial);
  const value = useMemo<SavedValue>(() => ({ label, setSaved }), [label]);
  return <SavedContext.Provider value={value}>{children}</SavedContext.Provider>;
}

/** The chrome's right-hand slot. Quiet — it is a receipt, not a control. */
export function SavedIndicator() {
  const { label } = useSaved();
  return (
    <span aria-live="polite" className="text-caption text-muted">
      {label}
    </span>
  );
}
