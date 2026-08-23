// The acceptance surface for handoff 0. Every tier 1 and tier 2 component lands
// here in every documented state, per handoffs/handoff-0-foundation/README.md §1.
export default function Gallery() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <p className="font-mono text-xs uppercase tracking-widest text-neutral-500">
        component gallery
      </p>
      <ul className="mt-6 space-y-1 font-mono text-sm text-neutral-500">
        <li>tier&nbsp;1 primitives · 0/18</li>
        <li>tier&nbsp;2 structure · 0/17</li>
        <li>shells · 0/4</li>
      </ul>
    </main>
  );
}
