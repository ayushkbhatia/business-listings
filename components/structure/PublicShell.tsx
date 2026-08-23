import { cn } from "@/lib/cn";

/**
 * The buyer-facing frame. Roomy density, set once here and inherited.
 *
 * 68px nav with the search field in the bar, breadcrumb, an optional results
 * toolbar, then the page, then the footer. Density is never a size prop on the
 * components inside — they read --row-h, --gutter, --section-pad from here.
 */
export interface PublicShellProps {
  nav: React.ReactNode;
  breadcrumb?: React.ReactNode;
  /** Result count, sort control, view switcher. */
  toolbar?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Full-bleed for the home hero and the map. */
  bleed?: boolean;
}

export function PublicShell({
  nav,
  breadcrumb,
  toolbar,
  children,
  footer,
  bleed = false,
}: PublicShellProps) {
  return (
    <div data-density="roomy" className="flex min-h-dvh flex-col bg-paper">
      {nav}

      {(breadcrumb || toolbar) && (
        <div className="border-b border-line bg-paper">
          <div className="mx-auto max-w-7xl px-5">
            {breadcrumb && <div className="py-2">{breadcrumb}</div>}
            {toolbar && (
              <div
                className={cn("flex flex-wrap items-center gap-3 pb-2", Boolean(breadcrumb) && "border-t border-line pt-2")}
              >
                {toolbar}
              </div>
            )}
          </div>
        </div>
      )}

      <main className="flex-1">
        {bleed ? children : <div className="mx-auto max-w-7xl px-5 py-[var(--section-pad)]">{children}</div>}
      </main>

      {footer && <footer className="border-t border-line bg-paper-sunk">{footer}</footer>}
    </div>
  );
}
