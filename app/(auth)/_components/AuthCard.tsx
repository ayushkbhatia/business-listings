import { Card } from "@/components/structure";

/**
 * The frame every auth screen sits in.
 *
 * Centred, narrow, and carrying nothing else — no nav, no footer links, no
 * category grid. Somebody on this page is doing one thing, usually on a phone,
 * often in a warehouse, and every other affordance is a way to lose them.
 */
export function AuthCard({
  title,
  lede,
  children,
  footer,
}: {
  title: string;
  lede?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Card padded as="article">
      <h1 className="text-h2 text-ink">{title}</h1>
      {lede ? <p className="mt-1.5 text-body-sm text-muted">{lede}</p> : null}
      <div className="mt-5">{children}</div>
      {footer ? <div className="mt-5 border-t border-line pt-4 text-body-sm">{footer}</div> : null}
    </Card>
  );
}
