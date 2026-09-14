import { t } from "@/lib/i18n";

/**
 * The unplanned error — build plan step 9.2, "the 500 that has no board".
 *
 * Drawn in board 13e's grammar because the two are the pair a visitor meets
 * when something is wrong: the wordmark, a mono eyebrow, a serif heading, two
 * sentences. What it deliberately does not borrow is 13e's substance. It never
 * says *planned work*, carries no end time and no status table — 13e's states
 * table calls an unplanned outage "a different page", and says using the
 * maintenance page for one is a lie the visitor can check.
 *
 * Presentational and server-safe. The retry is a click handler, which cannot
 * cross from a server component, so the boundary files render their own button
 * and hand it in as `action` — the gallery hands in an inert one.
 */
export interface ErrorStateProps {
  /** Next's hash of a server-side error. Absent for an error thrown in the browser. */
  digest?: string;
  action: React.ReactNode;
}

export function ErrorState({ digest, action }: ErrorStateProps) {
  return (
    <div className="mx-auto flex w-full max-w-[36rem] flex-col gap-7 px-5 py-16">
      <p className="font-serif text-[20px] tracking-[-0.01em] text-ink">
        {t("maintenance.wordmark.business")} <em>{t("maintenance.wordmark.listings")}</em>
      </p>
      <div>
        <p className="font-mono text-eyebrow font-medium uppercase tracking-[0.12em] text-bad-ink">
          {t("errorpage.eyebrow")}
        </p>
        <h1 className="mt-3.5 font-serif text-[40px] leading-[1.1] tracking-[-0.02em] text-ink">
          {t("errorpage.title")}
        </h1>
        <p className="mt-4 max-w-prose text-[13.5px] leading-[1.7] text-body">{t("errorpage.body")}</p>
        {digest && (
          <div className="mt-5 rounded-card border border-line-strong bg-card px-4 py-3">
            <p className="text-caption text-body">{t("errorpage.reference_hint")}</p>
            <p className="mt-1 font-mono text-body-sm text-ink">{t("errorpage.reference", { digest })}</p>
          </div>
        )}
        <div className="mt-6 flex flex-wrap items-center gap-2">{action}</div>
      </div>
    </div>
  );
}
