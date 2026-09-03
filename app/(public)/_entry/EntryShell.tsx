import Link from "next/link";
import { t } from "@/lib/i18n";

/**
 * The frame both entry surfaces sit in — `/for-buyers` and
 * `/list-your-business`.
 *
 * Shaped like the campaign landing at `/lp/:campaign` rather than like the
 * directory: no `PublicShell`, no search field, no category grid, no footer
 * nav. Somebody on this page is deciding whether to sign in, and every other
 * affordance is a way to lose them.
 *
 * But not a trap either, which is the campaign page's other half. There is
 * always one plain link to the directory, because a page with nowhere else to
 * go converts worse and ranks worse. We would rather lose that click than keep
 * it by having nothing else on offer.
 *
 * The form comes first in the DOM and moves to the right-hand column above
 * `lg`. That order is deliberate: on a phone the form is the first thing under
 * the hero rather than the last thing after four hundred words, and keyboard
 * order follows the DOM, so the thing somebody came to do is the thing they
 * reach first.
 */
export function EntryShell({
  title,
  lede,
  form,
  children,
}: {
  title: string;
  lede: string;
  form: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div data-density="roomy" className="flex min-h-dvh flex-col bg-paper">
      <header className="px-[var(--section-pad)] py-5">
        <Link
          href="/"
          className="rounded-tag font-serif text-h2 text-ink focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("site.name")}
        </Link>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-[var(--section-pad)] pb-16">
        <div className="max-w-[var(--measure-prose)]">
          <h1 className="font-serif text-h1 text-ink">{title}</h1>
          <p className="mt-3 text-prose text-prose">{lede}</p>
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_24rem]">
          <div className="lg:col-start-2 lg:row-start-1">{form}</div>
          <div className="lg:col-start-1 lg:row-start-1">{children}</div>
        </div>
      </main>

      <footer className="border-t border-line px-[var(--section-pad)] py-6">
        <p className="mx-auto max-w-5xl text-body-sm text-muted">
          {t("entry.escape")}{" "}
          <Link
            href="/"
            className="rounded-tag text-moss underline underline-offset-2 focus-visible:shadow-focus focus-visible:outline-none"
          >
            {t("entry.escape_link")}
          </Link>
        </p>
      </footer>
    </div>
  );
}
