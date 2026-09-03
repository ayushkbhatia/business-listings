"use client";

import { useState } from "react";

/**
 * Copy the address to the clipboard, and say so.
 *
 * A button rather than selectable text because the address spans three
 * elements and a buyer copying it by hand gets the line breaks too. The
 * confirmation is `aria-live` rather than only a label change: the whole point
 * of the control is that nothing visible happens, and a reader who cannot see
 * the button change has no other way to know it worked.
 *
 * `navigator.clipboard` is unavailable over plain HTTP and in some embedded
 * browsers. The failure is silent on purpose — an error toast about a
 * convenience nobody asked for is worse than the convenience quietly not being
 * there, and the address is still on the page to read.
 */
export function CopyAddress({
  address,
  label,
  copiedLabel,
}: {
  address: string;
  label: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard. The address is still readable above.
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={copy}
        className="rounded-ctl border border-line px-2.5 py-1.5 text-caption font-medium text-ink hover:bg-paper focus-visible:outline-none focus-visible:shadow-focus"
      >
        {copied ? copiedLabel : label}
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? copiedLabel : ""}
      </span>
    </>
  );
}
