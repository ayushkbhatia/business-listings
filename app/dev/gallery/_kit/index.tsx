import { cn } from "@/lib/cn";

/**
 * Gallery furniture. Not a design-system component — this is the frame the
 * review happens inside, and it is deliberately plain so nothing in it competes
 * with what is being reviewed.
 */

export function Section({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6 border-t border-line py-8 first:border-t-0">
      <div className="flex items-baseline gap-3">
        <h2 className="font-mono text-eyebrow uppercase text-faint">{title}</h2>
        {note && <span className="text-caption text-muted">{note}</span>}
      </div>
      <div className="mt-4 flex flex-col gap-5">{children}</div>
    </section>
  );
}

/** One labelled row of specimens. The label names the state being shown. */
export function States({
  label,
  children,
  stack = false,
}: {
  label: string;
  children: React.ReactNode;
  stack?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-[9rem_1fr] md:gap-4">
      <div className="pt-1.5 font-mono text-eyebrow uppercase text-faint">{label}</div>
      <div className={cn("flex gap-3", stack ? "flex-col items-start" : "flex-wrap items-center")}>
        {children}
      </div>
    </div>
  );
}

/** A specimen with its own caption, for grids where every cell differs. */
export function Specimen({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div>{children}</div>
      <span className="font-mono text-eyebrow text-faint">{caption}</span>
    </div>
  );
}

/** A boxed area, for controls that need a surface behind them to read. */
export function Frame({ children, width }: { children: React.ReactNode; width?: string }) {
  return (
    <div
      className="rounded-card border border-line bg-card p-4"
      style={width ? { maxWidth: width } : undefined}
    >
      {children}
    </div>
  );
}
