// Placeholder. Handoff 0 ships no user-facing screens; this route exists so the
// (public) group builds and Vercel has something to serve. It is replaced by the
// directory home [1a] in handoff 1. It also proves the token mapping: every
// class below resolves to a CSS variable, none to a literal.
export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-3 px-6">
      <p className="font-mono text-eyebrow uppercase text-faint">
        handoff&nbsp;0 · foundation
      </p>
      <h1 className="font-serif text-h1-serif text-ink">Business Listings</h1>
      <p className="text-body text-muted">
        <code className="font-mono text-caption">/dev/gallery</code>
      </p>
    </main>
  );
}
