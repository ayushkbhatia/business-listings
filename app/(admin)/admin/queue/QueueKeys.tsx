"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * `J` and `K` through the queue — boards 4c `B15` and 12b `B7`: a queue worked
 * all afternoon is worked from the keyboard. Ignored while somebody is typing,
 * and with any modifier held, so a note never loses a letter to navigation.
 */
export function QueueKeys({ previous, next }: { previous: string | null; next: string | null }) {
  const router = useRouter();
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      if (document.querySelector("dialog[open]")) return;
      const key = event.key.toLowerCase();
      if (key === "j" && next) router.push(next);
      if (key === "k" && previous) router.push(previous);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, previous, next]);
  return null;
}
