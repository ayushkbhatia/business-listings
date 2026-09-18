import { CompareTray } from "./_compare/CompareTray";

// Density is set on PublicShell, which every page in this group renders — one
// data-density scope, not two nested. This layout exists so the route group is
// real and so a group-wide piece has somewhere to live.
//
// Board `10d`'s tray is the first. It is here rather than in `PublicShell`
// because it has to survive a client navigation: a layout stays mounted across
// one and a shell rendered by each page does not, and a tray that blinked out
// and back on every link would read as losing the buyer's comparison.
//
// It reads nothing on the server. The tray is drawn from the `bl_cmp` cookie in
// the browser, so no page in this group is made dynamic by having it.
export default function PublicLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      {children}
      <CompareTray />
    </>
  );
}
