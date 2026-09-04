import { Alert, Eyebrow } from "@/components/display";
import { Check } from "@/components/primitives/icons";
import { t } from "@/lib/i18n";

/**
 * Board 2b's 320px column. Three cards, and each answers a different hesitation.
 *
 * The order is the order the questions arrive in. *What do I get?* first,
 * because it is the reason to keep going. *What do I lose?* second, because it
 * is the reason to stop — "does claiming reset my rating" is the single most
 * common fear at this step. *What if somebody beat me to it?* last, because it
 * applies to a minority and reading it first would suggest a fight where there
 * is usually none.
 */

export function VerifySidebar({
  reviewCount,
  contested,
}: {
  reviewCount: number;
  contested: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="unlock-heading" className="rounded-card-lg border border-line bg-card p-5">
        <Eyebrow as="h2" id="unlock-heading">
          {t("verify.unlock_heading")}
        </Eyebrow>
        <ul className="mt-3 flex flex-col gap-2.5">
          {[
            t("verify.unlock.edit"),
            t("verify.unlock.reply"),
            t("verify.unlock.badge"),
            /*
               The commercial one, and the reason it is on this card rather than
               a page about plans: a claimed-but-unverified listing is excluded
               from RFQ fan-outs, so verification is the moment a supplier starts
               receiving demand rather than a badge they can take or leave.
            */
            t("verify.unlock.fanout"),
          ].map((line) => (
            <li key={line} className="flex items-start gap-2 text-body-sm text-body">
              <Check size={13} className="mt-1 shrink-0 text-ok-ink" aria-hidden="true" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </section>

      {/*
        Replaced, never zeroed. On a listing with no reviews there is nothing to
        reassure anybody about, and "Already 0 reviews on this listing" is a
        worse thing to say than nothing — so the card becomes the explainer that
        answers the other question this screen raises.
      */}
      {reviewCount > 0 ? (
        <section
          aria-labelledby="reviews-heading"
          className="rounded-card-lg border border-line bg-paper-sunk p-5"
        >
          <h2 id="reviews-heading" className="text-body-sm font-medium text-ink">
            {t("verify.reviews_heading", { count: reviewCount })}
          </h2>
          <p className="mt-2 text-body-sm text-body">{t("verify.reviews_body")}</p>
        </section>
      ) : (
        <section
          aria-labelledby="ladder-heading"
          className="rounded-card-lg border border-line bg-paper-sunk p-5"
        >
          <h2 id="ladder-heading" className="text-body-sm font-medium text-ink">
            {t("verify.ladder_heading")}
          </h2>
          <p className="mt-2 text-body-sm text-body">{t("verify.ladder_body")}</p>
        </section>
      )}

      {/*
        A warn notice where it is actually happening, a quiet card where it is
        only a possibility. The words are the same either way — the conflict path
        does not become friendlier or harsher depending on who is reading it.
      */}
      {contested ? (
        <Alert tone="warn" title={t("verify.conflict_heading")} fix={t("verify.contested_after")}>
          {t("verify.conflict_body")}
        </Alert>
      ) : (
        <section
          aria-labelledby="conflict-heading"
          className="rounded-card-lg border border-line bg-card p-5"
        >
          <h2 id="conflict-heading" className="text-body-sm font-medium text-ink">
            {t("verify.conflict_heading")}
          </h2>
          <p className="mt-2 text-body-sm text-body">{t("verify.conflict_body")}</p>
        </section>
      )}
    </div>
  );
}
