import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/display/Alert";
import { ChipLink } from "@/components/display/ChipLink";
import { buttonClassName } from "@/components/primitives";
import { PublicShell } from "@/components/structure";
import { accountCounts } from "@/lib/account/overview";
import { requireBuyerSeat } from "@/lib/auth/buyer";
import { getViewer } from "@/lib/auth/viewer";
import { asBucket, getBuyerInbox } from "@/lib/enquiry/inbox";
import type { InboxBucket } from "@/lib/enquiry/inbox-status";
import { savedSearchesFor } from "@/lib/saved-search/service";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { AccountTabs } from "../_tabs";
import {
  CHIP_LABEL,
  CHIP_ORDER,
  EnquiryTable,
  FirstEnquiry,
  HistoryCard,
  NeedsYouCard,
  SavedPanel,
} from "./_inbox";

/**
 * Board 10e — the buyer's enquiry inbox. Where a buyer comes back to work they
 * have already started.
 *
 * **The gap between SENT TO and QUOTED is the screen.** Every status is a verb
 * derived from those two numbers and the clock (`lib/enquiry/inbox-status.ts`),
 * and every chip counts the same rows the table shows — one read, one set, and
 * every row in exactly one chip (`B1`, `B2`).
 *
 * **NEEDS YOU picks from the table** (`B4`): at most two cards, by what doing
 * nothing costs. When nothing does, there is no card — the history card moves
 * up rather than an *all clear* panel taking its place.
 *
 * **The buyer's own numbers stay the buyer's** (`B9`, `B10`). Nothing on this
 * page is read by a seller surface.
 *
 * Not drawn, and why: *Saved requirements* opens `/account/requirements`, which `routes.md` marks
 * *later* — a card whose button opens nothing is the defect this board's own
 * handoff flags. Re-send is the working half of that promise: an expired
 * requirement goes out again in two clicks.
 */
export const metadata: Metadata = { title: t("account.enquiries.title") };
export const dynamic = "force-dynamic";

export default async function AccountEnquiriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string) => (typeof params[key] === "string" ? params[key] : undefined);

  const bucket = asBucket(one("status"));
  const pageNumber = Number(one("page") ?? "1");
  const here = `/account/enquiries${bucket ? `?status=${bucket}` : ""}`;
  const { actor } = await requireBuyerSeat(here);

  const now = new Date();
  const [inbox, counts, saved, viewer] = await Promise.all([
    getBuyerInbox(actor.id, {
      bucket,
      page: Number.isFinite(pageNumber) ? pageNumber : 1,
      now,
    }),
    accountCounts(actor.id),
    savedSearchesFor(actor.id, { take: 3 }),
    getViewer(),
  ]);

  const nudged = Number(one("nudged"));
  const nudgeError = one("nudge_error");

  return (
    <PublicShell bleed nav={<DirectoryNav viewer={viewer} />} footer={<DirectoryFooter />}>
      <h1 className="sr-only">{t("account.enquiries.title")}</h1>
      <AccountTabs active="enquiries" counts={counts} />

      <div className="mx-auto grid w-full max-w-7xl gap-[var(--gutter)] px-5 py-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-5">
          {Number.isFinite(nudged) && nudged > 0 ? (
            <Alert tone="ok" live="polite">
              {t("account.nudged", { count: nudged, ref: one("ref") ?? "" })}
            </Alert>
          ) : null}
          {nudgeError ? (
            <Alert tone="info" live="polite">
              {t(nudgeError === "closed" ? "account.nudge_closed" : "account.nudge_nothing")}
            </Alert>
          ) : null}

          {inbox.rows.length === 0 ? (
            <FirstEnquiry />
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <nav aria-label={t("account.chips_label")} className="flex flex-wrap gap-2">
                  {CHIP_ORDER.map((key) => (
                    <ChipLink
                      key={key}
                      href={key === "all" ? "/account/enquiries" : `/account/enquiries?status=${key}`}
                      selected={key === "all" ? bucket === null : bucket === key}
                      aria-current={(key === "all" ? bucket === null : bucket === key) ? "page" : undefined}
                    >
                      {t(CHIP_LABEL[key], {
                        n: formatCount(inbox.counts[key]),
                      })}
                    </ChipLink>
                  ))}
                </nav>
                <Link href="/rfq/new" className={buttonClassName({ size: "sm" })}>
                  {t("account.new_enquiry")}
                </Link>
              </div>

              <EnquiryTable rows={inbox.page.rows} now={now} bucket={bucket} />

              {inbox.page.pages > 1 ? (
                <nav
                  aria-label={t("account.pages_label")}
                  className="flex flex-wrap items-center justify-between gap-3"
                >
                  <p className="text-caption text-body">
                    {t("account.range", {
                      from: formatCount(inbox.page.from),
                      to: formatCount(inbox.page.to),
                      total: formatCount(inbox.page.total),
                    })}
                  </p>
                  <span className="flex items-center gap-2">
                    {inbox.page.number > 1 ? (
                      <Link
                        href={pageHref(bucket, inbox.page.number - 1)}
                        className={buttonClassName({
                          variant: "secondary",
                          size: "sm",
                        })}
                      >
                        {t("account.newer")}
                      </Link>
                    ) : null}
                    {inbox.page.number < inbox.page.pages ? (
                      <Link
                        href={pageHref(bucket, inbox.page.number + 1)}
                        className={buttonClassName({
                          variant: "secondary",
                          size: "sm",
                        })}
                      >
                        {t("account.older")}
                      </Link>
                    ) : null}
                  </span>
                </nav>
              ) : null}
            </>
          )}

          <SavedPanel saved={saved} total={counts.saved} />
        </div>

        <aside aria-label={t("account.rail_label")} className="space-y-[var(--gutter)]">
          <NeedsYouCard cards={inbox.needsYou} now={now} />
          <HistoryCard history={inbox.history} since={inbox.historySince} />
        </aside>
      </div>
    </PublicShell>
  );
}

function pageHref(bucket: InboxBucket | null, page: number): string {
  const params = new URLSearchParams();
  if (bucket) params.set("status", bucket);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return `/account/enquiries${query ? `?${query}` : ""}`;
}
