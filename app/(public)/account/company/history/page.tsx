import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonClassName } from "@/components/primitives";
import { PublicShell } from "@/components/structure";
import { accountCounts } from "@/lib/account/overview";
import { requireBuyerSeat } from "@/lib/auth/buyer";
import { getViewer } from "@/lib/auth/viewer";
import { historyWords } from "@/lib/buyer-company/history-words";
import { companyHistory } from "@/lib/buyer-company/queue";
import { formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { AccountTabs } from "../../_tabs";

/**
 * Board `7b` `B8` — the company's own history.
 *
 * *Company data appears on seller-issued invoices, so a change here has
 * downstream effect and needs an audit trail of its own.* Every change to the
 * details, the addresses, the team and the rule, and every request and
 * decision, newest first. The rows are append-only in the database; this page
 * reads them and nothing edits them.
 *
 * Paged on `(created_at, id)` through an opaque cursor, so a page never repeats
 * or skips a line however many are written while somebody reads.
 */
export const metadata: Metadata = { title: t("company.history.title") };
export const dynamic = "force-dynamic";

function readCursor(value: string | undefined): { at: Date; id: string } | null {
  if (!value) return null;
  const [stamp, id] = value.split("_");
  const at = new Date(Number(stamp));
  return id && !Number.isNaN(at.getTime()) ? { at, id } : null;
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const before = typeof query["before"] === "string" ? query["before"] : undefined;
  const { actor } = await requireBuyerSeat("/account/company/history");
  const [history, counts, viewer] = await Promise.all([
    companyHistory(actor.id, readCursor(before)),
    accountCounts(actor.id),
    getViewer(),
  ]);
  if (!history) redirect("/account/company");

  return (
    <PublicShell bleed nav={<DirectoryNav viewer={viewer} />} footer={<DirectoryFooter />}>
      <AccountTabs active="company" counts={counts} />
      <div className="mx-auto w-full max-w-4xl px-5 py-8">
        <p className="text-caption">
          <Link
            href="/account/company"
            className="rounded-tag text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          >
            {t("company.approvals.back", { company: history.companyName })}
          </Link>
        </p>
        <h1 className="mt-2 font-serif text-h1-serif text-ink">{t("company.history.title")}</h1>
        <p className="mt-1 max-w-[var(--measure-prose)] text-body-sm text-body">{t("company.history.lede")}</p>

        {history.lines.length === 0 ? (
          <p className="mt-6 text-body-sm text-body">{t("company.history.none")}</p>
        ) : (
          <ol className="mt-6 divide-y divide-line rounded-panel border border-line bg-card">
            {history.lines.map((line) => {
              const words = historyWords(line);
              return (
                <li key={line.id} className="px-4 py-3">
                  <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="text-body-sm text-ink">{words.sentence}</span>
                    <time dateTime={line.at.toISOString()} className="font-mono text-caption tabular-nums text-body">
                      {formatDateTime(line.at)}
                    </time>
                  </p>
                  {words.changes.length > 0 ? (
                    <ul className="mt-1 space-y-0.5 text-caption text-body">
                      {words.changes.map((change) => (
                        <li key={change}>{change}</li>
                      ))}
                    </ul>
                  ) : null}
                  {words.quote ? (
                    <blockquote className="mt-1 border-l-2 border-line-strong pl-3 text-caption text-prose">{words.quote}</blockquote>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}

        {history.next ? (
          <nav aria-label={t("company.history.pages_label")} className="mt-4">
            <Link
              href={`/account/company/history?before=${history.next.at.getTime()}_${encodeURIComponent(history.next.id)}`}
              className={buttonClassName({ variant: "secondary", size: "sm" })}
            >
              {t("company.history.older")}
            </Link>
          </nav>
        ) : null}
      </div>
    </PublicShell>
  );
}
