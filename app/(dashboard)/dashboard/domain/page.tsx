import { Panel } from "@/components/structure";
import { effectiveFor } from "@/lib/billing/entitlements-service";
import { proposedFor, subdomainFor } from "@/lib/domains/service";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../_shell";
import { claimAddress, dropAddress } from "./actions";
import { AddressPanel } from "./DomainPanel";

/**
 * Board 5e, from the seller's side.
 *
 * The entitlement is read from the subscription's snapshot, not the plan row,
 * so a seller grandfathered on a plan that included this keeps it. The locked
 * state names the plan rather than hiding the feature — the same rule the rest
 * of the dashboard follows.
 *
 * Two states, where there used to be six. The address is a label under our own
 * zone, so there is nothing to verify and no waiting: a seller either has it or
 * has not asked for it yet. The screen this replaced spent most of its height
 * on DNS records to copy, per-record propagation, a 24-hour clock and a named
 * failure cause — all of which belonged to a domain somebody else controlled.
 */
export const metadata = { title: t("domain.meta_title") };
export const dynamic = "force-dynamic";

export default async function DomainPage() {
  const seat = await requireSellerSeat();
  const [caps, held, badges] = await Promise.all([
    effectiveFor(seat.businessId),
    subdomainFor(seat.businessId),
    getNavBadges(seat.businessId),
  ]);

  /*
     What they would get, computed only when they might take it.

     `proposedFor` runs the same derivation and the same refusals as the claim
     does, so the address on the screen is the address the button produces — a
     preview computed a second way is how a screen comes to promise something
     the write then refuses.
  */
  const proposed = !held && caps?.customDomain ? await proposedFor(seat.businessId) : null;

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/domain"
      title={t("domain.title")}
      eyebrow={t("domain.eyebrow")}
    >
      {!caps?.customDomain ? (
        // Named, not hidden. A feature somebody cannot see is a feature they
        // cannot decide they want.
        <Panel title={t("domain.title")} locked={{ label: t("domain.locked") }}>
          <p className="max-w-prose text-body-sm text-prose">{t("domain.explain")}</p>
        </Panel>
      ) : (
        <AddressPanel
          hostname={held?.hostname ?? null}
          proposedHostname={proposed?.hostname ?? null}
          // A refusal is shown before the button rather than after it. The two
          // that can happen — the label is taken, or the slug cannot make one —
          // are both things a seller can do nothing about, so offering a button
          // that will refuse would be offering a dead control.
          refusal={proposed?.refusal ?? null}
          claim={claimAddress}
          drop={dropAddress}
        />
      )}
    </SellerPage>
  );
}
