import Link from "next/link";
import { buttonClassName } from "@/components/primitives";
import { Card } from "@/components/structure";
import { t } from "@/lib/i18n";

/**
 * The cancel entry point on board `3m`, and the banner it becomes.
 *
 * The screens themselves are `11h` (what changes) and `11j` (reason and
 * confirm). What this card states is written as a constraint on those two, so
 * the three cannot contradict each other:
 *
 *   - The seller drops to Free **at the end of the period**. Nothing is charged.
 *   - **The seller picks what stays live** — the Free cap, the rule `3f` §6
 *     owns. Both older boards said all 1,204 "stay saved but hidden", which is a
 *     different decision to put in front of somebody.
 *   - Enquiries drop to the Free allowance, which is the same figure `11f`'s
 *     Free column renders.
 *   - **No retention offer.** A recorded decision, not screen copy.
 *
 * ## The scheduled state is the amendment `11h` needed
 *
 * The board's `Cancellation scheduled` banner said when the subscription ended
 * and offered `Resume Pro`, and that was all — so *"you pick which ten products
 * stay live"*, which both `3m` and `11h` promise, was a sentence with nowhere to
 * act on it. The picker opens on confirming and closes on the last paid day, and
 * **this banner is where it is reached from**. It is `11f`'s own chooser at
 * `/dashboard/billing/change/keep/:kind`, unchanged.
 *
 * Every number arrives pre-formatted. A server component may not hand a client
 * one a function, and this file stays a server component precisely so it can
 * keep reading `t()` — the resume button below it is the only interactive part
 * and it is its own island.
 */
export interface KeepLink {
  kind: string;
  href: string;
  /** `10 of 1,204 products stay live`, already localised and formatted. */
  label: string;
  /** `100 chosen`, or what happens if the seller never opens it. */
  chosenLabel: string;
}

export interface CancelCardProps {
  /** How many products stay live on Free, already formatted. */
  keeps: string;
  used: string;
  enquiries: string;
  /** True when Free already holds everything the seller has live. */
  withinFreeCap: boolean;
  /** Set once a cancellation is scheduled. The card becomes the banner. */
  endsAt: string | null;
  /** The last paid day — when the picker closes. Null outside the banner. */
  chooseBy: string | null;
  /** One row per kind there is anything to choose between. */
  keepLinks: readonly KeepLink[];
  /** The `Resume Pro` island, rendered only in the scheduled state. */
  resume: React.ReactNode;
}

export function CancelCard({
  keeps,
  used,
  enquiries,
  withinFreeCap,
  endsAt,
  chooseBy,
  keepLinks,
  resume,
}: CancelCardProps) {
  /*
     Scheduled: the card is replaced by the banner rather than sitting beside it.

     Board 3m's cancellation-scheduled state. Two controls that both act on the
     same cancellation — one to make it and one to undo it — is a screen asking
     the seller which of them is live.
  */
  if (endsAt) {
    return (
      <Card surface="paper" padded>
        <p className="font-mono text-eyebrow uppercase tracking-[0.11em] text-warn-ink">
          {t("billing.scheduled.eyebrow")}
        </p>
        <p className="mt-2 text-caption leading-relaxed text-body-ink">
          {t("billing.cancelling.banner", { when: endsAt })}
        </p>

        {/*
           The picker, dated. `11h` promises the choice opens on confirming and
           closes on the last paid day, and this is the only place it is reached
           from — the cancel routes stop being reachable once it is scheduled.
        */}
        {keepLinks.length > 0 && chooseBy && (
          <div className="mt-3 border-t border-warn-line pt-3">
            <p className="text-caption leading-relaxed text-body-ink">
              {t("billing.cancelling.choose_intro", { when: chooseBy })}
            </p>
            <ul className="mt-2.5 flex flex-col gap-2.5">
              {keepLinks.map((row) => (
                <li key={row.kind} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 text-caption text-body-ink">
                    {row.label}
                    <span className="mt-0.5 block text-caption text-muted">{row.chosenLabel}</span>
                  </span>
                  <Link
                    href={row.href}
                    className="shrink-0 rounded-tag text-caption font-medium text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                  >
                    {t("billing.cancelling.choose")}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-3.5 border-t border-warn-line pt-3.5">{resume}</div>
      </Card>
    );
  }

  return (
    <Card surface="paper" padded>
      <p className="text-caption font-medium text-ink">{t("billing.cancel.eyebrow")}</p>
      <p className="mt-2 text-caption leading-relaxed text-body-ink">
        {/*
           A seller already inside the Free cap is told nothing is unlisted,
           rather than "10 of 4 products stay live". The board's figures are one
           seller's; the sentence has to hold for every seller.
        */}
        {withinFreeCap
          ? t("billing.cancel.consequence_within", { enquiries })
          : t("billing.cancel.consequence", { keeps, used, enquiries })}
      </p>
      <Link
        href="/dashboard/billing/cancel"
        className={`${buttonClassName({ variant: "secondary", size: "sm" })} mt-3`}
      >
        {t("billing.cancel")}
      </Link>
    </Card>
  );
}
