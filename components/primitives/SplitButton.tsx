"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { ChevronDown, Spinner } from "./icons";
import type { ButtonSize, ButtonVariant } from "./Button";

/**
 * One visible action plus a menu of the rest. The design system's rule for a
 * table row — one visible action, the others behind a three-dot menu — applied
 * to a primary control.
 *
 * The two halves are separate buttons on purpose: the common action stays one
 * click, and the menu never swallows it.
 */
export interface SplitButtonItem {
  key: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Rendered in the bad tone and separated from the rest. */
  destructive?: boolean;
}

export interface SplitButtonProps {
  children: React.ReactNode;
  onClick: () => void;
  items: SplitButtonItem[];
  /** Accessible name for the menu half. */
  menuLabel: string;
  variant?: Extract<ButtonVariant, "primary" | "secondary">;
  size?: Extract<ButtonSize, "sm" | "md" | "lg">;
  disabled?: boolean;
  loading?: boolean;
}

const SIZE: Record<"sm" | "md" | "lg", { h: string; px: string; text: string; chev: string }> = {
  sm: { h: "h-8", px: "px-3", text: "text-caption", chev: "w-7" },
  md: { h: "h-9", px: "px-3.5", text: "text-body-sm", chev: "w-8" },
  lg: { h: "h-11", px: "px-5", text: "text-body", chev: "w-10" },
};

const VARIANT = {
  primary: {
    shell: "border-moss bg-moss text-on-ink",
    hover: "hover:bg-moss-hover",
    rule: "border-l border-l-moss-hover",
  },
  secondary: {
    shell: "border-line-strong bg-card text-ink",
    hover: "hover:bg-fill",
    rule: "border-l border-l-line",
  },
} as const;

export function SplitButton({
  children,
  onClick,
  items,
  menuLabel,
  variant = "primary",
  size = "md",
  disabled = false,
  loading = false,
}: SplitButtonProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const s = SIZE[size];
  const v = VARIANT[variant];
  const isDisabled = disabled || loading;

  useEffect(() => {
    if (!open) return;
    const onDocument = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocument);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocument);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-flex">
      <div className={cn("inline-flex rounded-ctl border", v.shell, isDisabled && "opacity-60")}>
        <button
          type="button"
          onClick={onClick}
          disabled={isDisabled}
          aria-busy={loading || undefined}
          className={cn(
            "inline-flex items-center gap-2 rounded-l-ctl font-medium",
            "transition-colors duration-120 ease-out",
            "focus-visible:outline-none focus-visible:shadow-focus",
            "disabled:cursor-not-allowed",
            s.h,
            s.px,
            s.text,
            !isDisabled && v.hover,
          )}
        >
          {loading && <Spinner size={14} />}
          {children}
        </button>

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          disabled={isDisabled}
          aria-label={menuLabel}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          className={cn(
            "inline-flex items-center justify-center rounded-r-ctl",
            "transition-colors duration-120 ease-out",
            "focus-visible:outline-none focus-visible:shadow-focus",
            "disabled:cursor-not-allowed",
            s.h,
            s.chev,
            v.rule,
            !isDisabled && v.hover,
          )}
        >
          <ChevronDown size={14} />
        </button>
      </div>

      {open && (
        <div
          id={menuId}
          role="menu"
          className={cn(
            "absolute right-0 top-full z-20 mt-1 min-w-52 overflow-hidden",
            "rounded-card border border-line bg-card shadow-overlay",
          )}
        >
          {items.map((item, i) => (
            <div key={item.key}>
              {item.destructive && i > 0 && <div className="h-px bg-line" role="none" />}
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className={cn(
                  "block w-full px-3 py-2 text-left text-body-sm",
                  "transition-colors duration-120 ease-out",
                  "focus-visible:outline-none focus-visible:bg-fill",
                  "disabled:cursor-not-allowed disabled:text-disabled-text",
                  item.destructive ? "text-bad-ink hover:bg-bad-wash" : "text-body hover:bg-fill",
                )}
              >
                {item.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
