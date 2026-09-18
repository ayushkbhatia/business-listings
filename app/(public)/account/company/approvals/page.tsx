import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Panel, PublicShell } from "@/components/structure";
import { accountCounts } from "@/lib/account/overview";
import { requireBuyerSeat } from "@/lib/auth/buyer";
import { getViewer } from "@/lib/auth/viewer";
import { approvalQueue, type RequestCard } from "@/lib/buyer-company/queue";
import { requestView } from "@/lib/buyer-company/request-words";
import { authorityLabel, roleLabel } from "@/lib/buyer-company/words";
import { formatAED } from "@/lib/format";
import { t } from "@/lib/i18n";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { AccountTabs } from "../../_tabs";
import { RequestItem } from "../_requests";

/**
 * Board `7b` — every request for approval, and the month's spend by person.
 *
 * `7b` flag 4: *no spend visibility anywhere — no period, no running total, no
 * history of approvals granted.* This is where all three live: what waits on
 * you, what you raised, what waits on others (admins see all of it), the last
 * ninety days of decisions, and each person's month against their limit.
 */
export const metadata: Metadata = { title: t("company.approvals.title") };
export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const { actor } = await requireBuyerSeat("/account/company/approvals");
  const now = new Date();
  const [queue, counts, viewer] = await Promise.all([approvalQueue(actor.id, now), accountCounts(actor.id), getViewer()]);
  if (!queue) redirect("/account/company");

  const view = (card: RequestCard) =>
    requestView(card, { thresholdAed: null, raiserLimit: null, viewerIsAdmin: queue.isAdmin });

  const section = (title: string, cards: RequestCard[], empty: string) => (
    <Panel title={title}>
      {cards.length === 0 ? (
        <p className="text-caption text-body">{empty}</p>
      ) : (
        <ul className="divide-y divide-line">
          {cards.map((card) => (
            <li key={card.id} className="py-3 first:pt-0 last:pb-0">
              <RequestItem view={view(card)} compact />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );

  return (
    <PublicShell bleed nav={<DirectoryNav viewer={viewer} />} footer={<DirectoryFooter />}>
      <AccountTabs active="company" counts={counts} />
      <div className="mx-auto w-full max-w-7xl space-y-[var(--gutter)] px-5 py-8">
        <header>
          <p className="text-caption">
            <Link
              href="/account/company"
              className="rounded-tag text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
            >
              {t("company.approvals.back", { company: queue.companyName })}
            </Link>
          </p>
          <h1 className="mt-2 font-serif text-h1-serif text-ink">{t("company.approvals.title")}</h1>
          <p className="mt-1 text-body-sm text-body">
            {queue.spend.accepted === 0
              ? t("company.team.spend_none")
              : t("company.team.spend", { amount: formatAED(queue.spend.totalAed), count: queue.spend.accepted })}
          </p>
        </header>

        <div className="grid gap-[var(--gutter)] lg:grid-cols-2">
          {section(t("company.approvals.awaiting_you"), queue.awaitingYou, t("company.awaiting.none"))}
          {section(t("company.approvals.yours"), queue.yours, t("company.approvals.yours_none"))}
          {queue.isAdmin || queue.others.length > 0
            ? section(t("company.approvals.others"), queue.others, t("company.approvals.others_none"))
            : null}
          {section(t("company.approvals.decided"), queue.decided, t("company.approvals.decided_none"))}
        </div>

        <Panel title={t("company.approvals.people_title")} description={t("company.approvals.people_description")} padded={false}>
          <div className="overflow-x-auto" tabIndex={0} role="group" aria-label={t("company.approvals.people_title")}>
            <table className="w-full min-w-[36rem] border-collapse text-left">
              <caption className="sr-only">{t("company.approvals.people_caption")}</caption>
              <thead>
                <tr className="border-b border-line bg-paper-sunk">
                  <th scope="col" className="px-4 py-2 font-mono text-eyebrow font-normal uppercase tracking-eyebrow text-muted">
                    {t("company.team.col.person")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-mono text-eyebrow font-normal uppercase tracking-eyebrow text-muted">
                    {t("company.team.col.authority")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-mono text-eyebrow font-normal uppercase tracking-eyebrow text-muted">
                    {t("company.team.col.used")}
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-mono text-eyebrow font-normal uppercase tracking-eyebrow text-muted">
                    {t("company.approvals.col.left")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {queue.people.map((person) => (
                  <tr key={person.name} className="border-b border-line last:border-b-0">
                    <th scope="row" className="px-4 py-2.5 text-left font-normal">
                      <span className="block text-body-sm text-ink">{person.name}</span>
                      <span className="block text-caption text-body">{roleLabel(person.role)}</span>
                    </th>
                    <td className="px-3 py-2.5 text-body-sm text-ink">{authorityLabel(person.role, person.limitAed)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-body-sm tabular-nums text-ink">
                      {person.role === "requester" ? "—" : formatAED(person.usedAed)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-body-sm tabular-nums text-ink">
                      {person.remainingAed === null
                        ? t("company.authority.unlimited")
                        : person.role === "requester"
                          ? "—"
                          : formatAED(person.remainingAed)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </PublicShell>
  );
}
