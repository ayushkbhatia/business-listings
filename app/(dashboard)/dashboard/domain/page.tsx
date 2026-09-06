import { Alert } from "@/components/display";
import { Panel } from "@/components/structure";
import { effectiveFor } from "@/lib/billing/entitlements-service";
import { domainFor } from "@/lib/domains/service";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../_shell";
import { claimDomain, dropDomain } from "./actions";
import { DomainPanel, type DomainRecordView } from "./DomainPanel";

/**
 * Board 5e, from the seller's side.
 *
 * The entitlement is read from the subscription's snapshot, not the plan row,
 * so a seller grandfathered on a plan that included this keeps it. The locked
 * state names the plan rather than hiding the feature — the same rule the rest
 * of the dashboard follows.
 */
export const metadata = { title: t("domain.meta_title") };
export const dynamic = "force-dynamic";

export default async function DomainPage() {
  const seat = await requireSellerSeat();
  const [caps, domain, badges] = await Promise.all([
    effectiveFor(seat.businessId),
    domainFor(seat.businessId),
    getNavBadges(seat.businessId),
  ]);

  const records: DomainRecordView[] = (domain?.records ?? []).map((record) => ({
    type: record.type,
    name: record.name,
    value: record.value,
    state: record.type === "CNAME" ? (domain?.cnameState ?? "waiting") : (domain?.txtState ?? "waiting"),
  }));

  /*
   * A mailto, not a message we send. It goes from the seller to somebody who
   * will recognise their name — a DNS change request arriving from a directory
   * they have never heard of is a DNS change request that gets deleted.
   */
  const mailtoHref = domain
    ? `mailto:?subject=${encodeURIComponent(
        t("domain.email_subject", { hostname: domain.hostname }),
      )}&body=${encodeURIComponent(
        t("domain.email_body", {
          hostname: domain.hostname,
          records: domain.records
            .map((record) => `${record.type}  ${record.name}  ${record.value}`)
            .join("\n"),
        }),
      )}`
    : "";

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
          <p className="max-w-prose text-body-sm text-prose">{t("domain.add_hint")}</p>
        </Panel>
      ) : (
        <>
          <DomainPanel
            hostname={domain?.hostname ?? null}
            status={domain?.status ?? "pending"}
            records={records}
            failureCause={domain?.failureCause ?? null}
            certificateLive={domain?.certificateLive ?? false}
            lastChecked={domain?.lastCheckedAt ? formatDate(domain.lastCheckedAt) : null}
            mailtoHref={mailtoHref}
            claim={claimDomain}
            drop={dropDomain}
          />

          {domain?.status === "revoked" && (
            <div className="mt-[var(--gutter)]">
              <Alert tone="warn" live="off" fix={t("domain.explain.revoked")}>
                {t("domain.status.revoked")}
              </Alert>
            </div>
          )}
        </>
      )}
    </SellerPage>
  );
}
