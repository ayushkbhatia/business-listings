import { cn } from "@/lib/cn";
import { Warning } from "./icons";

/**
 * A validation message under a field.
 *
 * Says what is wrong and what correct looks like, and never blames the user —
 * "Enter a UAE number, for example 04 883 4120", not "Invalid phone number".
 *
 * Announced politely, not assertively: a field error appears while the user is
 * still working, and an assertive live region interrupts them mid-sentence.
 * Only a failed save is assertive.
 *
 * Rendered even when empty, so the layout does not jump the first time a field
 * fails. `reserveSpace` turns that off where a form is dense enough that the
 * reserved line costs more than the jump.
 */
export interface FieldErrorProps {
  /** The message. Nothing renders when this is absent. */
  children?: React.ReactNode;
  /** The id an input points at with aria-describedby. */
  id?: string;
  reserveSpace?: boolean;
  /** A mono reference code, for an error the user must quote to support. */
  code?: string;
}

export function FieldError({ children, id, reserveSpace = true, code }: FieldErrorProps) {
  if (!children) {
    return reserveSpace ? <div id={id} className="min-h-4" aria-live="polite" /> : null;
  }

  return (
    <div
      id={id}
      role="alert"
      aria-live="polite"
      className={cn("flex items-start gap-1.5 text-caption text-bad-ink")}
    >
      <Warning size={13} className="mt-0.5 shrink-0" />
      <span>
        {children}
        {code && <span className="ml-1.5 font-mono text-eyebrow text-muted">{code}</span>}
      </span>
    </div>
  );
}
