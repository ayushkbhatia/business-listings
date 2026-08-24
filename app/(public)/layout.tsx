// Density is set on PublicShell, which every page in this group renders — one
// data-density scope, not two nested. This layout exists so the route group is
// real and so a future group-wide provider has somewhere to live.
export default function PublicLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <>{children}</>;
}
