import { Eyebrow } from "@/components/display";
import { Button } from "@/components/primitives";
import { crawlRel } from "@/lib/seo/crawl-policy";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { MAX_RECIPIENTS } from "@/lib/enquiry/fanout";

/**
 * Board 6b §3's rail — two of its three cards. `IN THIS LIST` lives on the page
 * itself, because it reads the members it links to.
 */

/**
 * §4 — the RFQ shortcut, and the promise the board could not keep.
 *
 * The board read **"Send one RFQ to all 12"**. The fan-out cap is 8, it is
 * hard, and `1h` states it on screen. This is the same error that removed
 * "Post an RFQ to 1,842" from `1b`'s category header: a button promising what
 * the engine cannot do.
 *
 * The number here is `MAX_RECIPIENTS` itself rather than a literal, so a button
 * on this page cannot promise a fan-out `1h` would refuse — acceptance 1 in the
 * one form that cannot drift.
 *
 * The card also names the rule, which it is allowed to do because every member
 * is licence verified by construction, so `1h`'s tier ordering cannot
 * discriminate and reply time is the whole of it. See `recipients.ts` for why
 * the copy also says "and can take an enquiry this month" — the engine drops a
 * capped seller even when pinned, and a card naming a rule the engine overrides
 * would be the same failure one level down.
 */
export function RfqCard({
  slug,
  recipients,
  members,
}: {
  slug: string;
  /** How many the composer will actually accept today. */
  recipients: number;
  members: number;
}) {
  if (recipients === 0) return null;

  /*
     The list travels into the composer, so `1h`'s "pinned first · from the page
     you were on" has something to pin and admin can attribute the enquiry to
     this page. The members the cap excluded are not dropped silently — the
     composer renders them as unselected rows the buyer can swap in, which is
     what §4 asks for and what `1h` already does with "N more match your spec".
  */
  const href = `/rfq/new?list=${slug}`;

  return (
    <section
      aria-labelledby="rfq-shortcut"
      className="rounded-card border border-line-strong bg-card p-4"
    >
      <h2 id="rfq-shortcut" className="text-body-sm font-medium text-ink">
        {t("best.rfq_title")}
      </h2>
      <p className="mt-2 text-caption leading-relaxed text-body">
        {t("best.rfq_body", { cap: MAX_RECIPIENTS })}
      </p>
      <a href={href} rel={crawlRel(href)} className="mt-3.5 inline-flex">
        <Button size="md" tabIndex={-1}>
          {t("best.rfq_action", {
            cap: formatCount(Math.min(recipients, MAX_RECIPIENTS)),
            members: formatCount(members),
          })}
        </Button>
      </a>
    </section>
  );
}

/**
 * §3's third card, and it should stay the last thing read.
 *
 * *"This card is the page arguing for its own trustworthiness."* It ends on the
 * flywheel argument — stating the rules is why sellers chase verification
 * instead of chasing us — which is the commercial reason the rest of this file
 * exists and not merely an editorial flourish.
 */
export function WhyWePublish({ intro }: { intro: string }) {
  return (
    <section
      aria-labelledby="why-we-publish"
      className="rounded-card border border-line bg-paper-sunk p-4"
    >
      <h2 id="why-we-publish" className="text-body-sm font-medium text-ink">
        {t("best.why_title")}
      </h2>
      {/*
         Paragraphs, split on blank lines. The seeded copy runs to four of them
         and one wall of text is not the card the board draws.
      */}
      <div className="mt-2 flex flex-col gap-2.5">
        {intro
          .split(/\n{2,}/)
          .map((paragraph) => paragraph.trim().replace(/\s+/g, " "))
          .filter(Boolean)
          .map((paragraph, i) => (
            <p key={i} className="text-caption leading-relaxed text-body">
              {paragraph}
            </p>
          ))}
      </div>
    </section>
  );
}
