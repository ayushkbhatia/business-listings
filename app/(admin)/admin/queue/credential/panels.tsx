import { Panel } from "@/components/structure";
import type { Unlocks } from "@/lib/credentials/review";
import { REJECT_REASONS } from "@/lib/credentials/compare";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Board `4c-s` — the two panels around the comparison. Presentational, so the
 * gallery draws them from the same code.
 */

/**
 * What verifying this changes — counted, and nothing more.
 *
 * The board's card reads *two of their three services … are currently withheld.
 * Approving this publishes both.* No service on this platform is withheld for a
 * credential (`mayPublish()` returns `true`, and a test asserts it), so that
 * card would be a lie on the one screen whose job is checking statements. What
 * a verification does change is what a buyer reads — on the storefront and on
 * any proposal being compared — and this says that, with the counts, and says
 * that nothing was waiting on it. Whether a credential should gate a service is
 * `4c-s` Q2, and it is a decision.
 */
export function UnlocksPanel({ unlocks }: { unlocks: Unlocks }) {
  const lines = [
    unlocks.published
      ? t("admin.credential_review.unlocks.storefront")
      : t("admin.credential_review.unlocks.unpublished"),
    ...(unlocks.openProposals > 0
      ? [t("admin.credential_review.unlocks.proposals", { count: unlocks.openProposals, n: formatCount(unlocks.openProposals) })]
      : []),
    unlocks.liveServices > 0
      ? t("admin.credential_review.unlocks.nothing_withheld", { count: unlocks.liveServices, n: formatCount(unlocks.liveServices) })
      : t("admin.credential_review.unlocks.no_services"),
  ];
  return (
    <Panel title={t("admin.credential_review.unlocks.title")}>
      <ul className="flex list-disc flex-col gap-1.5 ps-5 text-body-sm text-body">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </Panel>
  );
}

/**
 * The rail: why this is a lookup, which registers exist, and the four reasons.
 *
 * The board's first card is headed *Why this is not 4c*. A board number on a
 * staff screen is our filing system rather than the reviewer's vocabulary, so
 * the substance ships under its own name. The second card is told by the
 * deployment rather than by the design: it says whether an FTA register is
 * connected here, because a reviewer reading "trade licence and FTA agent are
 * checkable" on a deployment that checks neither is being told something false.
 */
export function CredentialRail({ registerLive }: { registerLive: boolean }) {
  return (
    <aside aria-label={t("admin.credential_review.rail_label")} className="flex flex-col gap-4">
      <div className="rounded-panel border border-line bg-paper-sunk px-4 py-3.5">
        <h2 className="font-mono text-eyebrow uppercase text-faint">{t("admin.credential_review.rail.lookup_title")}</h2>
        <p className="mt-2 text-caption text-body">{t("admin.credential_review.rail.lookup_body")}</p>
      </div>

      <div className="rounded-panel border border-warn-line bg-warn-surface px-4 py-3.5">
        <h2 className="font-mono text-eyebrow uppercase text-warn-ink">{t("admin.credential_review.rail.registers_title")}</h2>
        <ul className="mt-2 flex flex-col gap-1.5 text-caption text-warn-ink">
          <li>{registerLive ? t("admin.credential_review.rail.fta_live") : t("admin.credential_review.rail.fta_off")}</li>
          <li>{t("admin.credential_review.rail.licence")}</li>
          <li>{t("admin.credential_review.rail.claims")}</li>
        </ul>
      </div>

      <div className="rounded-panel border border-line bg-card px-4 py-3.5">
        <h2 className="font-mono text-eyebrow uppercase text-faint">{t("admin.credential_review.rail.reasons_title")}</h2>
        <ul className="mt-2 flex flex-col gap-1.5 text-body-sm text-body">
          {REJECT_REASONS.map((reason) => (
            <li key={reason}>{t(`admin.credential_review.reject.${reason}` as never)}</li>
          ))}
        </ul>
        <p className="mt-3 border-t border-line pt-3 text-caption text-muted">{t("admin.credential_review.rail.reasons_note")}</p>
      </div>
    </aside>
  );
}
