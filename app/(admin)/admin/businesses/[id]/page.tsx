import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, StatusBadge } from "@/components/display";
import { AuditRow } from "@/components/domain/AuditRow";
import { buttonClassName } from "@/components/primitives";
import { Breadcrumb, KeyValuePanel, Panel } from "@/components/structure";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { readAuditPage } from "@/lib/audit/log";
import { accountDetail } from "@/lib/accounts/detail";
import { CHURN_RISK_BELOW, SLOW_REPLIES_BELOW, STATE_TONE, UPGRADE_WINDOW_DAYS } from "@/lib/accounts/health";
import { formatAED, formatCount, formatDate, formatDateTime, formatDuration, formatPercent } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../../_shell";
import { BusinessDecisions, type DecisionSubject } from "../BusinessDecisions";
import { giveNotice, lift, reopen, setTier, suspend, withdraw } from "../actions";
import { catalogueText, quotedText, replyText, stateLabel } from "../present";

/**
 * Board 4f — one account, opened from the list.
 *
 * The build plan's missing detail route. Everything the list shows in a cell is
 * shown here with what it was computed from: the reply rate with the enquiries
 * it counted, the upgrade candidacy with the dated event behind it (`B6`), the
 * suspension with a link to the audit row that carries its reason rather than
 * the reason inline (states table, "Suspended").
 *
 * `B10`: the page reads; the decision panel writes, through the same audited
 * services the list used to call, and only for the capabilities this seat holds.
 */

export const dynamic = "force-dynamic";

export default async function BusinessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const seat = await requireStaff();
  const now = new Date();

  // A cuid, or it is not a business. Refused before any query.
  if (!/^[a-z0-9]{8,40}$/.test(id)) notFound();

  const [detail, badges, activity] = await Promise.all([
    accountDetail(id, now),
    getAdminNavBadges(seat),
    readAuditPage(seat.actor, { subject: `Business:${id}` }, { size: 8 }),
  ]);
  if (!detail) notFound();

  const { row } = detail;
  const claimed = row.state !== "unclaimed" && row.state !== "merged";

  const decisionState: DecisionSubject["state"] =
    row.state === "suspended" || row.state === "merged" || row.state === "closed" || row.state === "closing" || row.state === "unclaimed"
      ? row.state
      : "live";

  const subject: DecisionSubject = {
    id: row.id,
    displayName: row.displayName,
    tier: row.tier ?? 0,
    state: decisionState,
    mayTier: can(seat.actor, "business.verification_tier.write"),
    maySuspend: can(seat.actor, "business.suspend"),
    mayClose: can(seat.actor, "business.close"),
    closure: detail.closure
      ? detail.closure.appliedAt
        ? { kind: "closing", date: formatDate(detail.closure.finalAt) }
        : { kind: "notice", date: formatDate(detail.closure.effectiveAt) }
      : null,
    licenceLapsed: detail.licenceExpiry.getTime() <= now.getTime(),
  };

  const healthReason = reasonFor(row.state, row.replyRate);

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/businesses"
      title={row.displayName}
      eyebrow={t("admin.businesses.detail.eyebrow")}
      breadcrumb={
        <Breadcrumb
          label={t("admin.businesses.detail.breadcrumb_label")}
          items={[
            { label: t("admin.businesses.title"), href: "/admin/businesses" },
            { label: row.displayName },
          ]}
        />
      }
      meta={
        <span className="flex flex-wrap items-center gap-2 text-caption text-body">
          <span className="font-mono">{row.licenceNumber}</span>
          <StatusBadge tone={STATE_TONE[row.state]} size="sm">
            {stateLabel(row.state)}
          </StatusBadge>
        </span>
      }
      actions={
        <span className="flex flex-wrap items-center gap-2">
          {detail.publishedAt && row.state !== "suspended" && row.state !== "closed" && row.state !== "merged" ? (
            <Link href={`/b/${row.slug}`} className={buttonClassName({ variant: "secondary" })}>
              {t("admin.businesses.detail.storefront")}
            </Link>
          ) : null}
          <Link
            href={`/admin/audit?subject=${encodeURIComponent(`Business:${row.id}`)}`}
            className={buttonClassName({ variant: "secondary" })}
          >
            {t("admin.businesses.detail.audit")}
          </Link>
        </span>
      }
    >
      <div className="grid gap-[var(--gutter)] xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex min-w-0 flex-col gap-[var(--gutter)]">
          {row.state === "suspended" && detail.suspendedAt ? (
            <Alert tone="bad" title={t("admin.businesses.detail.suspended_title", { date: formatDate(detail.suspendedAt) })}>
              <span>
                {t("admin.businesses.detail.suspended_body")}{" "}
                <Link
                  className="underline underline-offset-2"
                  href={`/admin/audit?subject=${encodeURIComponent(`Business:${row.id}`)}&action=suspend`}
                >
                  {t("admin.businesses.detail.suspended_link")}
                </Link>
              </span>
            </Alert>
          ) : null}
          {row.state === "merged" && detail.mergedInto ? (
            <Alert tone="neutral">
              {t("admin.businesses.detail.merged_into")}{" "}
              <Link className="underline underline-offset-2" href={`/admin/businesses/${detail.mergedInto.id}`}>
                {detail.mergedInto.displayName}
              </Link>
            </Alert>
          ) : null}
          {detail.closure ? (
            <Alert tone="warn">
              {detail.closure.appliedAt
                ? t("admin.businesses.detail.closing", { date: formatDate(detail.closure.finalAt) })
                : t("admin.businesses.detail.noticed", { date: formatDate(detail.closure.effectiveAt) })}
            </Alert>
          ) : null}

          <Panel title={t("admin.businesses.detail.health_title")} description={healthReason}>
            <KeyValuePanel
              notProvidedLabel={t("admin.businesses.detail.not_measured")}
              columns={2}
              entries={[
                { key: "rate", label: t("admin.businesses.detail.reply_rate"), value: claimed ? replyText(row) : t("admin.businesses.reply.na") },
                {
                  key: "counted",
                  label: t("admin.businesses.detail.counted"),
                  value: claimed
                    ? t("admin.businesses.detail.counted_value", {
                        replied: formatCount(detail.replies.replied),
                        counted: formatCount(detail.replies.delivered - detail.replies.stillOpen),
                        days: detail.replies.windowDays,
                      })
                    : undefined,
                },
                {
                  key: "open",
                  label: t("admin.businesses.detail.still_open"),
                  value: claimed ? formatCount(detail.replies.stillOpen) : undefined,
                },
                {
                  key: "median",
                  label: t("admin.businesses.detail.median"),
                  value: row.medianMs === null ? undefined : formatDuration(row.medianMs),
                },
                {
                  key: "measured",
                  label: t("admin.businesses.detail.measured_at"),
                  value: detail.replies.measuredAt ? formatDateTime(detail.replies.measuredAt) : undefined,
                },
                {
                  key: "thresholds",
                  label: t("admin.businesses.detail.thresholds"),
                  value: t("admin.businesses.detail.thresholds_value", {
                    risk: formatPercent(CHURN_RISK_BELOW),
                    slow: formatPercent(SLOW_REPLIES_BELOW),
                  }),
                },
              ]}
            />
            <p className="mt-3 text-caption text-body">{t("admin.businesses.detail.measure_note")}</p>
          </Panel>

          <Panel
            title={t("admin.businesses.detail.signals_title")}
            description={t("admin.businesses.detail.signals_description", { days: UPGRADE_WINDOW_DAYS })}
            padded={false}
          >
            {detail.capEvents.length === 0 && detail.missedAtCap.count === 0 ? (
              <p className="px-4 py-4 text-body-sm text-body">{t("admin.businesses.detail.signals_none")}</p>
            ) : (
              <ul className="m-0 list-none p-0">
                {detail.missedAtCap.count > 0 && detail.missedAtCap.latest ? (
                  <li className="border-b border-line px-4 py-3 text-body-sm text-ink">
                    {t("admin.businesses.detail.missed_at_cap", {
                      count: detail.missedAtCap.count,
                      n: formatCount(detail.missedAtCap.count),
                      date: formatDate(detail.missedAtCap.latest),
                    })}
                  </li>
                ) : null}
                {detail.capEvents.map((event, index) => (
                  <li key={`${event.at.toISOString()}-${index}`} className="border-b border-line px-4 py-3 last:border-b-0">
                    <p className="text-body-sm text-ink">
                      {t(`admin.businesses.detail.cap_event.${event.kind}` as MessageKey, {
                        count: event.attempted ?? 1,
                        n: formatCount(event.attempted ?? 1),
                        cap: event.cap === null ? "—" : formatCount(event.cap),
                        plan: event.plan,
                      })}
                    </p>
                    <p className="text-caption text-body">
                      {formatDateTime(event.at)}
                      {event.surface ? ` · ${t(`admin.businesses.detail.surface.${event.surface}` as MessageKey)}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title={t("admin.businesses.detail.activity_title")}
            description={activity?.scope === "own" ? t("admin.businesses.detail.activity_own") : undefined}
            padded={false}
            actions={
              <Link
                href={`/admin/audit?subject=${encodeURIComponent(`Business:${row.id}`)}`}
                className={buttonClassName({ variant: "link", size: "sm" })}
              >
                {t("admin.businesses.detail.activity_full")}
              </Link>
            }
          >
            {activity && activity.entries.length > 0 ? (
              <ul className="m-0 list-none p-0">
                {activity.entries.map((entry) => (
                  <AuditRow
                    key={entry.id}
                    headline={entry.headline}
                    actionLabel={entry.headline}
                    actorName={entry.actorName}
                    subject={entry.subject}
                    blast={entry.blast}
                    at={formatDateTime(entry.at)}
                    reason={entry.reason}
                  />
                ))}
              </ul>
            ) : (
              <p className="px-4 py-4 text-body-sm text-body">{t("admin.businesses.detail.activity_none")}</p>
            )}
          </Panel>

          <Panel title={t("admin.businesses.detail.calls_title")} padded={false}>
            {detail.calls.length === 0 && detail.viewAs.length === 0 ? (
              <p className="px-4 py-4 text-body-sm text-body">{t("admin.businesses.detail.calls_none")}</p>
            ) : (
              <ul className="m-0 list-none p-0">
                {detail.calls.map((call) => (
                  <li key={call.id} className="border-b border-line px-4 py-3 last:border-b-0">
                    <p className="text-body-sm text-ink">
                      {t("admin.businesses.detail.call_line", {
                        who: call.staff.fullName ?? "—",
                        outcome: t(`crm.outcome.${call.kind}` as MessageKey),
                      })}
                    </p>
                    <p className="text-caption text-body">{formatDateTime(call.createdAt)}</p>
                    {call.note ? <p className="mt-1 text-body-sm text-prose">{call.note}</p> : null}
                  </li>
                ))}
                {detail.viewAs.map((session) => (
                  <li key={session.id} className="border-b border-line px-4 py-3 last:border-b-0">
                    <p className="text-body-sm text-ink">
                      {t("admin.businesses.detail.view_as_line", {
                        who: session.staff.fullName ?? "—",
                        ticket: session.ticketRef,
                      })}
                    </p>
                    <p className="text-caption text-body">{formatDateTime(session.startedAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <aside className="flex min-w-0 flex-col gap-[var(--gutter)]" aria-label={t("admin.businesses.detail.rail")}>
          <Panel title={t("admin.businesses.detail.decisions_title")}>
            <BusinessDecisions
              subject={subject}
              setTier={setTier}
              suspend={suspend}
              lift={lift}
              giveNotice={giveNotice}
              withdraw={withdraw}
              reopen={reopen}
            />
          </Panel>

          <Panel title={t("admin.businesses.detail.account_title")}>
            <KeyValuePanel
              notProvidedLabel="—"
              entries={[
                {
                  key: "plan",
                  label: t("admin.businesses.col.plan"),
                  value: detail.plan
                    ? t("admin.businesses.detail.plan_value", {
                        plan: detail.plan.name,
                        price: formatAED(detail.plan.monthlyPriceAed),
                      })
                    : undefined,
                },
                {
                  key: "subscription",
                  label: t("admin.businesses.detail.subscription"),
                  value: detail.subscription
                    ? t(`admin.businesses.detail.sub_status.${detail.subscription.status}` as MessageKey, {
                        renews: formatDate(detail.subscription.renewsAt),
                        ends: detail.subscription.endsAt ? formatDate(detail.subscription.endsAt) : "—",
                        trial: detail.subscription.trialEndsAt ? formatDate(detail.subscription.trialEndsAt) : "—",
                      })
                    : undefined,
                },
                {
                  key: "paying",
                  label: t("admin.businesses.detail.paying"),
                  value: row.paying ? t("admin.businesses.detail.yes") : t("admin.businesses.detail.no"),
                },
                {
                  key: "since",
                  label: t("admin.businesses.detail.claimed_since"),
                  value: row.claimedSince ? formatDate(row.claimedSince) : undefined,
                },
                { key: "seats", label: t("admin.businesses.detail.seats"), value: formatCount(detail.seats) },
                {
                  key: "quoted",
                  label: t("admin.businesses.col.quoted"),
                  value: quotedText(row.quoted) ?? undefined,
                },
              ]}
            />
          </Panel>

          <Panel title={t("admin.businesses.detail.catalogue_title")}>
            <KeyValuePanel
              notProvidedLabel="—"
              entries={[
                { key: "listed", label: t("admin.businesses.detail.listed"), value: catalogueText(row) ?? undefined },
                {
                  key: "product_cap",
                  label: t("admin.businesses.detail.product_cap"),
                  value: detail.plan
                    ? detail.plan.productLimit === null
                      ? t("admin.businesses.detail.unlimited")
                      : t("admin.businesses.detail.of_cap", {
                          used: formatCount(row.liveProducts),
                          cap: formatCount(detail.plan.productLimit),
                        })
                    : undefined,
                },
                {
                  key: "service_cap",
                  label: t("admin.businesses.detail.service_cap"),
                  value: detail.plan
                    ? detail.plan.serviceLimit === null
                      ? t("admin.businesses.detail.unlimited")
                      : t("admin.businesses.detail.of_cap", {
                          used: formatCount(row.liveServices),
                          cap: formatCount(detail.plan.serviceLimit),
                        })
                    : undefined,
                },
              ]}
            />
          </Panel>

          <Panel title={t("admin.businesses.detail.trust_title")}>
            <KeyValuePanel
              notProvidedLabel="—"
              entries={[
                {
                  key: "tier",
                  label: t("admin.businesses.col.tier"),
                  value: row.tier === null ? undefined : t("admin.businesses.tier_option", { tier: String(row.tier) }),
                },
                {
                  key: "verified",
                  label: t("admin.businesses.detail.verified_at"),
                  value: detail.verifiedAt ? formatDate(detail.verifiedAt) : undefined,
                },
                { key: "authority", label: t("admin.businesses.detail.authority"), value: detail.licenceAuthority, mono: true },
                { key: "licence", label: t("admin.businesses.detail.licence"), value: row.licenceNumber, mono: true },
                {
                  key: "expiry",
                  label: t("admin.businesses.detail.licence_expiry"),
                  value: t(
                    subject.licenceLapsed ? "admin.businesses.detail.expired_on" : "admin.businesses.detail.expires_on",
                    { date: formatDate(detail.licenceExpiry) },
                  ),
                },
                { key: "trn", label: t("admin.businesses.detail.trn"), value: detail.trn ?? undefined, mono: true },
                {
                  key: "locations",
                  label: t("admin.businesses.detail.locations"),
                  value:
                    detail.locations.length > 0
                      ? detail.locations
                          .map((location) => `${location.areaName}, ${t(`emirate.${location.emirate}` as MessageKey)}`)
                          .join(" · ")
                      : undefined,
                  wide: true,
                },
              ]}
            />
          </Panel>
        </aside>
      </div>
    </AdminPage>
  );
}

function reasonFor(state: string, rate: number | null): string {
  const pct = rate === null ? "" : formatPercent(rate);
  switch (state) {
    case "churn_risk":
      return t("admin.businesses.reason.churn_risk", { rate: pct, threshold: formatPercent(CHURN_RISK_BELOW) });
    case "slow_replies":
      return t("admin.businesses.reason.slow_replies", { rate: pct, threshold: formatPercent(SLOW_REPLIES_BELOW) });
    default:
      return t(`admin.businesses.reason.${state}` as MessageKey, { rate: pct, days: UPGRADE_WINDOW_DAYS });
  }
}
