import { Card } from "@/components/structure";
import { cn } from "@/lib/cn";

/**
 * The frame every auth screen sits in.
 *
 * Centred and carrying nothing else — no nav, no footer links, no category
 * grid. Somebody on this page is doing one thing, usually on a phone, often in a
 * warehouse, and every other affordance is a way to lose them.
 *
 * Board 7a draws each state with a mono eyebrow over a Geist heading, and draws
 * sign-up wider than the other three: two role cards sit side by side, and full
 * name and mobile share a row. `wide` is that one difference; everything else is
 * the same frame, so the four states read as one flow.
 */
export function AuthCard({
  eyebrow,
  title,
  lede,
  children,
  footer,
  wide = false,
}: {
  eyebrow?: string;
  title: string;
  lede?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={cn("mx-auto w-full", wide ? "max-w-[40rem]" : "max-w-[26rem]")}>
      <Card padded as="article">
        {eyebrow ? <p className="mb-3 font-mono text-eyebrow uppercase text-muted">{eyebrow}</p> : null}
        <h1 className="text-h2 text-ink">{title}</h1>
        {lede ? <p className="mt-1.5 max-w-prose text-body-sm text-body">{lede}</p> : null}
        <div className="mt-5">{children}</div>
        {footer ? <div className="mt-5 border-t border-line pt-4 text-body-sm">{footer}</div> : null}
      </Card>
    </div>
  );
}
