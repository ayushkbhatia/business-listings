"use client";

import { useEffect, useId, useRef } from "react";
import { cn } from "@/lib/cn";
import { Close } from "@/components/primitives/icons";
import { IconButton } from "@/components/primitives";

/**
 * A side panel over the current surface. The filter rail on a phone, a row's
 * detail beside the table it came from, the quote preview.
 *
 * Same native <dialog> as Modal, for the same reasons — the difference is
 * where it sits and that it keeps the context behind it visible, which is the
 * whole point of a drawer rather than a modal.
 *
 * `side` is start/end rather than left/right: no layout may assume LTR.
 */
export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  closeLabel: string;
  side?: "start" | "end";
  size?: "sm" | "md" | "lg";
}

const SIZE = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-2xl" } as const;

export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  closeLabel,
  side = "end",
  size = "md",
}: DrawerProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        "h-dvh max-h-dvh w-[calc(100vw-3rem)] border-line bg-card p-0 text-body shadow-overlay",
        "backdrop:bg-ink/40",
        side === "end" ? "ms-auto me-0 border-s" : "me-auto ms-0 border-e",
        SIZE[size],
      )}
    >
      <div onClick={(event) => event.stopPropagation()} className="flex h-full flex-col">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-h2 text-ink">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-0.5 text-caption text-muted">
                {description}
              </p>
            )}
          </div>
          <IconButton size="sm" label={closeLabel} icon={<Close size={14} />} onClick={onClose} />
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>

        {footer && (
          <footer className="shrink-0 border-t border-line bg-paper-sunk px-4 py-3">{footer}</footer>
        )}
      </div>
    </dialog>
  );
}
