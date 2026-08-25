/**
 * The console's route group.
 *
 * Density is no longer set here — `AdminShell` owns it, because a density
 * attribute on a wrapper that does not render the shell is a promise about
 * layout that nothing keeps. Components read `--row-h`, `--gutter`,
 * `--section-pad` and `--card-pad`; they never take a size prop for this.
 *
 * There is deliberately no auth check at this level. Next runs a layout for
 * every matching route, but a layout cannot stop a page's own data fetching
 * from running — the two are rendered concurrently. A guard here would look
 * like protection and provide none. Every page calls `requireStaff()` itself,
 * and the acceptance walk asserts that each one does.
 */
export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
