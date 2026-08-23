/**
 * The staff frame. Compact density — an approval queue is read a hundred rows
 * at a time and every pixel of row height is a row somebody has to scroll past.
 *
 * Identical structure to the dashboard, deliberately: the same AppSidebar, the
 * same PageHeader, a different config and a different density attribute. The
 * admin mark in the sidebar is the only visual tell, and that is the point —
 * staff should never be unsure which surface they are on.
 */
export interface AdminShellProps {
  sidebar: React.ReactNode;
  header: React.ReactNode;
  children: React.ReactNode;
  notice?: React.ReactNode;
  /** Shown while an ops_lead is viewing as somebody else. Audited, and loud. */
  impersonation?: React.ReactNode;
}

export function AdminShell({
  sidebar,
  header,
  children,
  notice,
  impersonation,
}: AdminShellProps) {
  return (
    <div data-density="compact" className="flex h-dvh bg-paper">
      <div className="hidden md:block">{sidebar}</div>

      <div className="flex min-w-0 flex-1 flex-col">
        {impersonation}
        {notice}
        {header}
        <main className="min-h-0 flex-1 overflow-y-auto p-[var(--section-pad)]">{children}</main>
      </div>
    </div>
  );
}
