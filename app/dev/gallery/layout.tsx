// The gallery is the one surface that shows all three densities at once, so it
// sets none of its own. Each section wraps its samples in its own data-density.
export default function GalleryLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div data-density="comfortable">{children}</div>;
}
