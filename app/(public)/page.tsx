// Placeholder. Handoff 0 ships no user-facing screens; this route exists so the
// (public) group builds and Vercel has something to serve. It is replaced by the
// directory home [1a] in handoff 1.
export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-3 px-6">
      <p className="font-mono text-xs uppercase tracking-widest text-neutral-500">
        handoff&nbsp;0 · foundation
      </p>
      <h1 className="text-3xl">Business Listings</h1>
      <p className="text-sm text-neutral-500">
        <code className="font-mono">/dev/gallery</code>
      </p>
    </main>
  );
}
