// Density is set once, here, and inherited. Components read --row-h, --gutter,
// --section-pad and --card-pad; they never take a size prop for this. The shell
// component from checkpoint 5 takes over this element.
export default function PublicLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div data-density="roomy">{children}</div>;
}
