"use client";

import { useEffect, useRef } from "react";

/**
 * Closes the `<details>` it sits in the way a menu is expected to close: a
 * press outside it, Escape (focus back on the summary), or following one of its
 * links. The disclosure works without this — it is the part JavaScript adds,
 * not the part the menu needs.
 */
export function DetailsDismiss() {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const details = ref.current?.closest("details");
    if (!details) return;

    const close = () => details.removeAttribute("open");
    const onPointer = (event: PointerEvent) => {
      if (details.open && !details.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !details.open) return;
      close();
      details.querySelector("summary")?.focus();
    };
    const onClick = (event: MouseEvent) => {
      if ((event.target as Element).closest("a")) close();
    };

    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    details.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      details.removeEventListener("click", onClick);
    };
  }, []);

  return <span ref={ref} hidden />;
}
