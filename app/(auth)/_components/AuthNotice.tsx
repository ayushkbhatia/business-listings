import { cn } from "@/lib/cn";

/**
 * A failure state, said out loud.
 *
 * Board 7a draws three of these and they are screens rather than inline field
 * errors: an expired link, a locked-out number and a suspended account are all
 * "here is what happened and here is the way out", not "you typed this wrong".
 *
 * `role="alert"` only when the notice arrives after an action. A notice that is
 * on the page at first paint is announced by the heading, and an alert on load
 * interrupts a screen reader before it has said what page this is.
 */
export type NoticeTone = "warn" | "bad" | "info";

const TONE: Record<NoticeTone, string> = {
  warn: "border-warn-line bg-warn-surface text-warn-ink",
  bad: "border-bad-line bg-bad-surface text-bad-ink",
  info: "border-info-line bg-info-surface text-info-ink",
};

export function AuthNotice({
  tone = "bad",
  title,
  body,
  action,
  live = false,
}: {
  tone?: NoticeTone;
  title: string;
  body?: string;
  action?: React.ReactNode;
  live?: boolean;
}) {
  return (
    <div
      {...(live ? { role: "alert" } : {})}
      className={cn("rounded-ctl border px-3 py-2.5", TONE[tone])}
    >
      <p className="text-body-sm font-medium">{title}</p>
      {body ? <p className="mt-1 text-caption">{body}</p> : null}
      {action ? <p className="mt-2">{action}</p> : null}
    </div>
  );
}
