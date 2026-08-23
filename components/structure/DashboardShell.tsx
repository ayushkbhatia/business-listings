/**
 * The seller frame. Comfortable density.
 *
 * 236px sidebar, 58px page header, optional tab row. The sidebar is the shared
 * AppSidebar handed the dashboard config — the same component the admin uses,
 * not a second copy.
 */
export interface DashboardShellProps {
  sidebar: React.ReactNode;
  header: React.ReactNode;
  children: React.ReactNode;
  /** A banner above the page — trial ending, licence expiring, plan limit hit. */
  notice?: React.ReactNode;
}

export function DashboardShell({ sidebar, header, children, notice }: DashboardShellProps) {
  return (
    <div data-density="comfortable" className="flex h-dvh bg-paper">
      <div className="hidden md:block">{sidebar}</div>

      <div className="flex min-w-0 flex-1 flex-col">
        {notice}
        {header}
        <main className="min-h-0 flex-1 overflow-y-auto p-[var(--section-pad)]">{children}</main>
      </div>
    </div>
  );
}
