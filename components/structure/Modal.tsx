"use client";

import { useEffect, useId, useRef } from "react";
import { cn } from "@/lib/cn";
import { Close } from "@/components/primitives/icons";
import { IconButton } from "@/components/primitives";

/**
 * A native <dialog>, opened with showModal().
 *
 * The platform gives the focus trap, the inert background, Escape, and the
 * top-layer stacking. Hand-rolling those is how a modal ends up with the page
 * behind it still tabbable.
 *
 * Confirm repeats the verb — "Remove review", never "OK". Cancel sits on the
 * left and is never styled red: the destructive control should not be the one
 * a hurried thumb lands on.
 */
export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** A line under the title, saying what will happen. */
  description?: string;
  children?: React.ReactNode;
  /** Cancel first, then confirm. Rendered left to right in that order. */
  footer?: React.ReactNode;
  closeLabel: string;
  size?: "sm" | "md" | "lg";
  /** Turns the escape and backdrop routes off. For a step that must be finished. */
  dismissible?: boolean;
}

const SIZE = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl" } as const;

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  closeLabel,
  size = "md",
  dismissible = true,
}: ModalProps) {
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
      onCancel={(event) => {
        if (!dismissible) {
          event.preventDefault();
          return;
        }
        onClose();
      }}
      onClick={(event) => {
        // Clicking the backdrop means clicking the dialog element itself; the
        // panel inside stops the event.
        if (dismissible && event.target === ref.current) onClose();
      }}
      className={cn(
        "m-auto w-[calc(100vw-2rem)] rounded-panel border border-line bg-card p-0",
        "text-body shadow-overlay backdrop:bg-ink/40",
        "open:motion-safe:animate-in",
        SIZE[size],
      )}
    >
      <div onClick={(event) => event.stopPropagation()}>
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
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
          {dismissible && (
            <IconButton size="sm" label={closeLabel} icon={<Close size={14} />} onClick={onClose} />
          )}
        </header>

        {children && <div className="px-4 py-4">{children}</div>}

        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-line bg-paper-sunk px-4 py-3">
            {footer}
          </footer>
        )}
      </div>
    </dialog>
  );
}
