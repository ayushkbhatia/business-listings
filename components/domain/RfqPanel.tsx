import Link from "next/link";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

/**
 * The open-requests panel beside the home page's hero — and the panel that
 * takes its place when nothing can be shown.
 *
 * Board 1a calls this "the most sensitive thing on the page", and everything
 * about the component follows from that. It renders four fields and there is no
 * fifth available to it: a requirement, a trade, an emirate and a quote count.
 * There is no buyer name in the props, no company, no area finer than an
 * emirate, and no id that resolves to a person. The suppression rule and the
 * emirate lookup both live in `lib/db/queries/home.ts`, so a caller cannot
 * assemble a row this component would leak — the shape simply has nowhere to
 * put one.
 *
 * ## Two panels, one slot
 *
 * "If none qualify, replace the whole panel with the trust panel rather than
 * showing an empty state." An empty "no open requests" card on the hero of a
 * marketplace says the marketplace is empty. The verification ladder says
 * something true and useful in the same space, and a young directory is in that
 * state most of the time — so the fallback is a first-class panel here, not a
 * placeholder.
 *
 * The caller decides which by passing rows or not. It does not decide what
 * "enough" means: three rows is a fine panel and two is a fine panel. Never pad.
 */

export interface RfqPanelRow {
  id: string;
  requirement: string;
  categoryName: string;
  /** Already localised — an emirate name, or "UAE". */
  place: string;
  quoteCount: number;
  /**
   * Already formatted, e.g. "11 min ago".
   *
   * Not a `Date`, and this is not ceremony. `formatRelative` measures against
   * the current time, so a component that called it would produce one answer
   * when the HTML was rendered and a different one when React hydrated —
   * React 418, the whole subtree thrown away and rebuilt, and every landmark
   * and computed style in it briefly wrong. That is exactly what happened on
   * /dev/gallery, which is prerendered at build time and hydrated hours later.
   *
   * Formatting in the caller puts the string in the RSC payload, where server
   * and client read the same bytes. `ListingCard.responseDurationLabel` is the
   * same decision for the same reason.
   */
  age: string;
}

export interface RfqPanelProps {
  rows: readonly RfqPanelRow[];
  /**
   * Overrides the region's accessible name. One panel per page in the product,
   * so the default is right there; the gallery renders three side by side and
   * three landmarks called "Open requests for quotes" is a screen reader's
   * landmark list reading the same line three times.
   */
  label?: string;
  /**
   * A signed-in buyer already knows it is free, and the qualifier is one of the
   * things that makes a returning buyer read the panel as marketing.
   */
  signedIn?: boolean;
}

function Shell({ title, label, live, children, footer }: {
  title: string;
  label?: string;
  live?: boolean;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <section
      aria-label={label ?? title}
      className="w-full overflow-hidden rounded-card-lg border border-line bg-card lg:w-[392px] lg:shrink-0"
    >
      <header className="flex items-center justify-between border-b border-line-mid px-4 py-3.5">
        <h2 className="text-body-sm font-medium text-ink">{title}</h2>
        {live && (
          <span className="font-mono text-eyebrow tracking-[.06em] text-ok">{t("home.rfq_live")}</span>
        )}
      </header>
      {children}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-mid bg-paper-sunk px-4 py-3">
        {footer}
      </div>
    </section>
  );
}

export function RfqPanel({ rows, signedIn = false, label }: RfqPanelProps) {
  return (
    <Shell
      label={label}
      title={t("home.rfq_title")}
      live
      footer={
        <>
          <span className="text-caption text-body">
            {signedIn ? t("home.rfq_footer_signed_in") : t("home.rfq_footer")}
          </span>
          <Link
            href="/rfq/new"
            className={cn(
              "rounded-tag text-caption font-medium text-moss underline-offset-2 hover:underline",
              "focus-visible:outline-none focus-visible:shadow-focus",
            )}
          >
            {t("home.rfq_cta")}
          </Link>
        </>
      }
    >
      <ul className="flex flex-col">
        {rows.map((row, index) => (
          <li
            key={row.id}
            className={cn("px-4 py-3", index < rows.length - 1 && "border-b border-line-mid")}
          >
            {/*
              Two lines and then it stops. A requirement can be a paragraph, and
              the panel is a teaser rather than the enquiry — the whole thing is
              on /rfq/new for a supplier who wants it.
            */}
            <p className="line-clamp-2 text-body-sm text-ink">{row.requirement}</p>
            <p className="mt-1.5 font-mono text-eyebrow uppercase tabular-nums text-muted">
              {t("home.rfq_meta", {
                category: row.categoryName,
                place: row.place,
                quotes: t("home.rfq_quotes", { count: row.quoteCount }),
                age: row.age,
              })}
            </p>
          </li>
        ))}
      </ul>
    </Shell>
  );
}

/**
 * What sits in the same slot when no open request can be shown safely.
 *
 * Four lines of the verification ladder. It is the same claim the rest of the
 * page rests on, said once, where a buyer is already looking.
 */
export function TrustPanel({ label }: { label?: string } = {}) {
  const lines = [t("home.trust_1"), t("home.trust_2"), t("home.trust_3"), t("home.trust_4")];
  return (
    <Shell
      label={label}
      title={t("home.trust_title")}
      footer={
        <Link
          href="/verification-policy"
          className={cn(
            "rounded-tag text-caption font-medium text-moss underline-offset-2 hover:underline",
            "focus-visible:outline-none focus-visible:shadow-focus",
          )}
        >
          {t("home.trust_cta")}
        </Link>
      }
    >
      <ul className="flex flex-col">
        {lines.map((line, index) => (
          <li
            key={line}
            className={cn("px-4 py-3", index < lines.length - 1 && "border-b border-line-mid")}
          >
            <p className="text-body-sm text-ink">{line}</p>
          </li>
        ))}
      </ul>
    </Shell>
  );
}
