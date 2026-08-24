import Link from "next/link";

/**
 * The auth frame. Deliberately bare.
 *
 * No nav, no footer, no category grid. Somebody here is doing one thing,
 * usually on a phone, and every other affordance is a way to lose them. The
 * only link out is the wordmark, because a page with no way back is a trap.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-density="roomy" className="flex min-h-dvh flex-col bg-paper">
      <header className="px-6 py-5">
        <Link
          href="/"
          className="rounded-tag font-serif text-h2 text-ink focus-visible:shadow-focus focus-visible:outline-none"
        >
          Business Listings
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-6 pb-16">
        <div className="w-full max-w-[26rem]">{children}</div>
      </main>
    </div>
  );
}
