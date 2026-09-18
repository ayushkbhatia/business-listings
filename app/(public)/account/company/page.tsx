import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/display/Alert";
import { Panel, PublicShell } from "@/components/structure";
import { accountCounts } from "@/lib/account/overview";
import { requireBuyerSeat } from "@/lib/auth/buyer";
import { getViewer } from "@/lib/auth/viewer";
import { historyWords } from "@/lib/buyer-company/history-words";
import {
  areaChoices,
  companyAccount,
  invitationsFor,
  type CompanyAccount,
  type RequestCard,
} from "@/lib/buyer-company/queue";
import { requestView } from "@/lib/buyer-company/request-words";
import { ruleSentences } from "@/lib/buyer-company/words";
import { formatDate, formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { AccountTabs } from "../_tabs";
import { AddressesCard } from "./_addresses";
import { DetailsForm, DetailsReadOnly } from "./_details";
import { RequestItem } from "./_requests";
import { RuleCard } from "./_rule";
import { TeamCard } from "./_team";

/**
 * Board `7b` — the buying company's account. `/account/company`.
 *
 * *The screen that decides whether a procurement team can use the platform
 * instead of email.* Four cards on the left — details, delivery addresses, the
 * team — and the rule on the right with what waits on this person under it.
 *
 * What changed from the board, and why, is in `lib/buyer-company/*`; the short
 * version is that every sentence and number here is read from the record: the
 * rule from its settings (`B2`), every hold it can place stated (`B3`), limits
 * with a period and a counter (`B5`), no toggle that promises blocking (`B4`),
 * no `TRN verified` nothing performs (`B7`), and a history of every change
 * (`B8`).
 *
 * A buyer with no company is not an error: it is how every account starts,
 * and the page offers to set one up — the first writer `buyerCompanyId` has had.
 */
export const metadata: Metadata = { title: t("company.title") };
export const dynamic = "force-dynamic";

export default async function CompanyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const { actor } = await requireBuyerSeat("/account/company");
  const now = new Date();
  const [account, counts, viewer] = await Promise.all([
    companyAccount(actor.id, now),
    accountCounts(actor.id),
    getViewer(),
  ]);

  return (
    <PublicShell bleed nav={<DirectoryNav viewer={viewer} />} footer={<DirectoryFooter />}>
      <h1 className="sr-only">{account ? t("company.title_named", { company: account.details.name }) : t("company.title")}</h1>
      <AccountTabs active="company" counts={counts} />
      {/*
         Read back off the record, not the query string: `?joined=1` only says
         the person came from the join action; the company named is theirs.
      */}
      {account && query["joined"] === "1" ? (
        <div className="mx-auto w-full max-w-7xl px-5 pt-6">
          <Alert tone="ok" live="polite">
            {t("company.joined", { company: account.details.name })}
          </Alert>
        </div>
      ) : null}
      {account ? <CompanyBoard account={account} /> : <NoCompany userId={actor.id} now={now} />}
    </PublicShell>
  );
}

async function NoCompany({ userId, now }: { userId: string; now: Date }) {
  const invitations = await invitationsFor(userId, now);
  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-5 py-8">
      <header>
        <p className="font-serif text-h1-serif text-ink" aria-hidden="true">
          {t("company.create.title")}
        </p>
        <p className="mt-2 max-w-[var(--measure-prose)] text-body-sm text-body">{t("company.create.lede")}</p>
      </header>

      {invitations.map((invitation) => (
        <Alert key={invitation.companyName} tone="info" live="off">
          {t("company.create.invited", { company: invitation.companyName, date: formatDate(invitation.expiresAt) })}
        </Alert>
      ))}

      <ul className="grid gap-3 sm:grid-cols-3">
        {(["details", "addresses", "team"] as const).map((key) => (
          <li key={key} className="rounded-card border border-line bg-card px-4 py-3">
            <p className="text-body-sm text-ink">{t(`company.create.why_${key}_title` as "company.create.why_details_title")}</p>
            <p className="mt-1 text-caption text-body">{t(`company.create.why_${key}` as "company.create.why_details")}</p>
          </li>
        ))}
      </ul>

      <Panel title={t("company.details.title")} description={t("company.details.description")}>
        <DetailsForm mode="create" initial={{ name: "", trn: null, licenceNumber: null, accountsEmail: null }} />
      </Panel>
    </div>
  );
}

function limitContext(account: CompanyAccount, card: RequestCard) {
  const raiser = account.team.find((row) => row.kind === "member" && row.userId === card.raisedById);
  return {
    thresholdAed: account.policy.thresholdAed,
    raiserLimit:
      raiser && raiser.kind === "member" && raiser.role === "procurement" && raiser.monthlyLimitAed !== null
        ? { usedAed: raiser.usedAed, limitAed: raiser.monthlyLimitAed }
        : null,
    viewerIsAdmin: account.viewer.isAdmin,
  };
}

async function CompanyBoard({ account }: { account: CompanyAccount }) {
  const editable = account.viewer.isAdmin;
  const areas = editable ? await areaChoices() : [];
  const sentences = ruleSentences(account.ruleFacts);
  const awaiting = account.awaitingYou.map((card) => requestView(card, limitContext(account, card)));
  const yours = account.yourRequests.map((card) => requestView(card, limitContext(account, card)));

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-[var(--gutter)] px-5 py-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-[var(--gutter)]">
        <Panel
          title={t("company.details.title")}
          description={t("company.details.description")}
          footer={
            account.detailsChanged ? (
              <p className="text-caption text-body">
                {t("company.details.changed", {
                  name: account.detailsChanged.by,
                  date: formatDateTime(account.detailsChanged.at),
                })}
              </p>
            ) : undefined
          }
        >
          {editable ? (
            <DetailsForm mode="edit" initial={account.details} />
          ) : (
            <DetailsReadOnly value={account.details} />
          )}
        </Panel>

        <AddressesCard addresses={account.addresses} areas={areas} editable={editable} />

        <TeamCard
          rows={account.team.map((row) =>
            row.kind === "member"
              ? {
                  kind: "member" as const,
                  memberId: row.memberId,
                  name: row.name,
                  email: row.email,
                  isYou: row.isYou,
                  role: row.role,
                  monthlyLimitAed: row.monthlyLimitAed,
                  usedAed: row.usedAed,
                  isApprover: row.isApprover,
                }
              : {
                  kind: "invite" as const,
                  inviteId: row.inviteId,
                  name: row.name,
                  email: row.email,
                  role: row.role,
                  monthlyLimitAed: row.monthlyLimitAed,
                  state: row.state,
                  expiresAt: row.expiresAt,
                },
          )}
          editable={editable}
          spend={account.spend}
        />
      </div>

      <aside className="min-w-0 space-y-[var(--gutter)]" aria-label={t("company.rail_label")}>
        <RuleCard
          sentences={sentences}
          flags={{
            requirePoNumber: account.policy.requirePoNumber,
            requireCostCode: account.policy.requireCostCode,
            unverifiedNeedsApproval: account.policy.unverifiedNeedsApproval,
            tellAdminsOffPlatform: account.policy.tellAdminsOffPlatform,
          }}
          editable={editable}
          thresholdAed={account.policy.thresholdAed}
          approverId={account.policy.approverId}
          admins={account.admins}
        />

        <Panel
          eyebrow={t("company.awaiting.eyebrow")}
          footer={
            <Link
              href="/account/company/approvals"
              className="rounded-tag text-caption text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
            >
              {account.awaitingYouCount > awaiting.length
                ? t("company.awaiting.more", { count: account.awaitingYouCount - awaiting.length })
                : t("company.awaiting.all")}
            </Link>
          }
        >
          {awaiting.length === 0 ? (
            <p className="text-caption text-body">{t("company.awaiting.none")}</p>
          ) : (
            <ul className="space-y-4">
              {awaiting.map((view) => (
                <li key={view.id}>
                  <RequestItem view={view} compact />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {yours.length > 0 ? (
          <Panel eyebrow={t("company.yours.eyebrow")}>
            <ul className="space-y-4">
              {yours.map((view) => (
                <li key={view.id}>
                  <RequestItem view={view} compact />
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        {editable && account.flagged.length > 0 ? (
          <Panel eyebrow={t("company.flagged.eyebrow")} description={t("company.flagged.description")}>
            <ul className="space-y-2">
              {account.flagged.map((flag) => (
                <li key={`${flag.enquiryRef}-${flag.at.toISOString()}`} className="text-caption text-body">
                  <span className="text-ink">{flag.supplierName}</span>
                  {" · "}
                  <span className="font-mono">{flag.enquiryRef}</span>
                  {" · "}
                  {formatDate(flag.at)}
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        <Panel
          eyebrow={t("company.history.eyebrow")}
          footer={
            <Link
              href="/account/company/history"
              className="rounded-tag text-caption text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
            >
              {t("company.history.all")}
            </Link>
          }
        >
          {account.history.length === 0 ? (
            <p className="text-caption text-body">{t("company.history.none")}</p>
          ) : (
            <ol className="space-y-2.5">
              {account.history.map((line) => {
                const words = historyWords(line);
                return (
                  <li key={line.id} className="text-caption text-body">
                    <span className="text-ink">{words.sentence}</span>{" "}
                    <time dateTime={line.at.toISOString()} className="text-muted">
                      {formatDate(line.at)}
                    </time>
                  </li>
                );
              })}
            </ol>
          )}
        </Panel>
      </aside>
    </div>
  );
}
