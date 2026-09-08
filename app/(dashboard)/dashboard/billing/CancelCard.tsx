import Link from "next/link";
import { buttonClassName } from "@/components/primitives";
import { Card } from "@/components/structure";
import { t } from "@/lib/i18n";

/**
 * The cancel entry point on board `3m`.
 *
 * The screen itself is `11h` and the reason step is `11j`; neither is exported.
 * What this card states is written as a constraint on those two, so the three
 * cannot contradict each other when they land:
 *
 *   - The seller drops to Free **at the end of the period**. Nothing is charged.
 *   - **Ten products stay live and the seller picks which** — the Free cap, the
 *     rule `3f` §6 owns. Both older boards said all 1,204 "stay saved but
 *     hidden", which is a different decision to put in front of somebody.
 *   - Enquiries drop to the Free allowance, which is the same figure `11f`'s
 *     Free column renders.
 *   - **No retention offer.** A recorded decision, not screen copy. The old
 *     board printed the rationale in the seller's own interface — *"if the
 *     product is not worth it we would rather know than discount our way through
 *     it"* — addressed to us rather than to them.
 *
 * Every number arrives pre-formatted. A server component may not hand a client
 * one a function, and this file stays a server component precisely so it can
 * keep reading `t()` — the resume button below it is the only interactive part
 * and it is its own island.
 */
export interface CancelCardProps {
  /** How many products stay live on Free, already formatted. */
  keeps: string;
  used: string;
  enquiries: string;
  /** True when Free already holds everything the seller has live. */
  withinFreeCap: boolean;
  /** Set once a cancellation is scheduled. The card becomes the banner. */
  endsAt: string | null;
  /** The `Resume Pro` island, rendered only in the scheduled state. */
  resume: React.ReactNode;
}

export function CancelCard({
  keeps,
  used,
  enquiries,
  withinFreeCap,
  endsAt,
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
        <p className="mt-2 text-caption text-body-ink">
          {t("billing.cancelling.banner", { when: endsAt })}
        </p>
        <div className="mt-3">{resume}</div>
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
