import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { Card } from "@/components/structure";
import { recommendKind, type SellsChoice } from "@/lib/onboarding/kind";
import { t } from "@/lib/i18n";
import { OnboardingPage, requireClaimant } from "../_shell";
import { KindChoice } from "./KindChoice";
import { chooseKind } from "./actions";

/**
 * Board `2b-s` — the fork, asked once, right after ownership is proven.
 *
 * **It adds no numbered step.** `step="verify"` keeps the indicator on 2 of 5,
 * because this is not a task the seller performs — it is the question that
 * decides what the remaining tasks are. Adding a sixth step would make the
 * funnel look longer for every seller in order to describe a screen most of
 * them pass in one click.
 *
 * It is not in `STEPS` for the same reason, so nothing else in the funnel has
 * to learn about it.
 */

export const dynamic = "force-dynamic";

/** What each decided category answered, as one phrase for the evidence card. */
function readAs(read: { kind: "goods" | "services"; decided: boolean }[]): string | null {
  const decided = read.filter((row) => row.decided);
  if (decided.length === 0) return null;
  const goods = decided.some((row) => row.kind === "goods");
  const services = decided.some((row) => row.kind === "services");
  if (goods && services) return t("kind.read_both");
  return services ? t("kind.read_services") : t("kind.read_goods");
}

export default async function KindPage() {
  const actor = await requireClaimant("verify");
  if (!actor.businessId) redirect("/onboarding/claim");

  const [recommendation, business] = await Promise.all([
    recommendKind(actor.businessId),
    prisma.business.findUnique({
      where: { id: actor.businessId },
      select: { displayName: true },
    }),
  ]);
  if (!recommendation || !business) redirect("/onboarding/claim");

  /*
     A published listing changes this in Settings, where it is confirmed and
     says what it costs. Redirected rather than rendered read-only: a screen
     that looks answerable and is not is worse than not being here.
  */
  if (recommendation.published) redirect("/dashboard/settings");

  const phrase = readAs(recommendation.read);

  return (
    <OnboardingPage
      step="verify"
      title={t("kind.title", { name: business.displayName })}
      intro={t("kind.intro")}
    >
      <div className="flex flex-col gap-[var(--gutter)]">
        <Card>
          <p className="font-mono text-eyebrow uppercase tracking-wide text-faint">
            {t("kind.evidence_eyebrow")}
          </p>

          {/*
             B3: the licence's own words, verbatim. The seller recognises their
             own licence and does not recognise our taxonomy, so paraphrasing
             register prose into our category names would stop this card being
             evidence of anything.
          */}
          {recommendation.licenceActivity ? (
            <>
              <p className="mt-1 text-body text-ink">{recommendation.licenceActivity}</p>
              <p className="mt-1 text-caption text-muted">
                {t("kind.evidence_source", {
                  number: recommendation.licenceNumber,
                  authority: recommendation.licenceAuthority,
                })}
                {phrase ? ` ${t("kind.read_as", { kinds: phrase })}` : ""}
              </p>
            </>
          ) : (
            <p className="mt-1 max-w-prose text-body-sm text-prose">
              {t("kind.evidence_none")}
            </p>
          )}

          {/*
             Three silences, said apart. "We have not read your licence yet" and
             "you have no trades yet" send a seller to different places, and a
             single "we could not tell" would describe neither.
          */}
          {recommendation.licenceActivity && recommendation.because === "taxonomy_undecided" && (
            <p className="mt-2 max-w-prose text-body-sm text-prose">
              {t("kind.evidence_undecided")}
            </p>
          )}
          {recommendation.because === "no_categories" && (
            <p className="mt-2 max-w-prose text-body-sm text-prose">
              {t("kind.evidence_no_categories")}
            </p>
          )}
        </Card>

        <KindChoice
          suggested={recommendation.suggested as SellsChoice | null}
          current={
            recommendation.current === "unset" ? null : (recommendation.current as SellsChoice)
          }
          choose={chooseKind}
        />

        <Card>
          <p className="font-mono text-eyebrow uppercase tracking-wide text-faint">
            {t("kind.decides_eyebrow")}
          </p>
          <dl className="mt-2 grid gap-3 sm:grid-cols-2">
            {[
              [t("kind.decides_setup"), t("kind.decides_setup_body")],
              [t("kind.decides_dashboard"), t("kind.decides_dashboard_body")],
              [t("kind.decides_storefront"), t("kind.decides_storefront_body")],
              [t("kind.decides_enquiries"), t("kind.decides_enquiries_body")],
            ].map(([term, detail]) => (
              <div key={term}>
                <dt className="font-mono text-eyebrow uppercase tracking-wide text-muted">
                  {term}
                </dt>
                <dd className="mt-0.5 text-body-sm text-prose">{detail}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card>
          <p className="font-mono text-eyebrow uppercase tracking-wide text-faint">
            {t("kind.cost_eyebrow")}
          </p>
          {/*
             Said before the choice, not after. B5 is explicit that this copy
             must not ship without the behaviour, so the Settings control it
             promises lands in the same change.
          */}
          <p className="mt-1 max-w-prose text-body-sm text-prose">{t("kind.cost_body")}</p>
          <p className="mt-2 max-w-prose text-body-sm text-prose">{t("kind.agree_body")}</p>
        </Card>
      </div>
    </OnboardingPage>
  );
}
