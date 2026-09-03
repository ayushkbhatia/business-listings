import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicShell } from "@/components/structure";
import { getBuyerEnquiry } from "@/lib/db/queries/enquiry";
import { getTrackingByRef } from "@/lib/db/queries/enquiry-tracking";
import {
  canAddRecipients,
  compareBlockedBy,
  effectiveState,
  headerState,
  sortRecipients,
} from "@/lib/enquiry/tracking";
import { spell, spellCapitalised } from "@/lib/enquiry/spell";
import { formatCountdown, formatDate, formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { DirectoryNav } from "@/app/(public)/_chrome";
import { resolveBuyerId, trackingTokenFor } from "../_buyer";
import { LiveStatus } from "./LiveStatus";
import { HeaderBadge, RecipientRow } from "./_rows";

/**
 * Board 1i — the buyer's home for one enquiry.
 *
 * Reached twice: once as confirmation the moment it is sent, and then
 * repeatedly over the following days as quotes arrive. **One page, not two** —
 * a separate "thanks for your enquiry" screen would be a dead end the buyer
 * never returns to.
 *
 * ## Access
 *
 * Usually opened by somebody who is not signed in, because a buyer can send an
 * enquiry with no account and then clicks through from an SMS. Requiring a
 * login at that moment loses the enquiry. So access is the tokenised URL, and
 * a reference with no valid token is a **404** rather than a 403 — a 403 would
 * confirm which references exist, and `ENQ-8841` is four digits somebody can
 * walk.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your enquiry",
  /*
     Nothing here should be indexed, and nothing should be followed either: the
     links out carry the token, and a crawler following one would put a bearer
     secret in somebody else's logs.
  */
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function EnquiryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const one = (key: string) => (typeof query[key] === "string" ? query[key] : undefined);

  const buyerId = await resolveBuyerId(one("t"));
  if (!buyerId) notFound();

  const tracking = await getTrackingByRef(buyerId, id);
  if (!tracking) notFound();

  const enquiry = await getBuyerEnquiry(buyerId, tracking.enquiryId);
  if (!enquiry) notFound();

  const token = await trackingTokenFor(buyerId);
  const withToken = (path: string) =>
    token ? `${path}${path.includes("?") ? "&" : "?"}t=${token}` : path;

  const now = new Date();
  const closed = now.getTime() >= tracking.closesAt.getTime();
  const rows = sortRecipients(tracking.recipients);
  const header = headerState(tracking.recipients, {
    accepted: tracking.accepted,
    closesAt: tracking.closesAt,
    now,
  });

  /* One primary per view: the first quoted row, and only that one. */
  const firstQuotedId = rows.find(
    (row) => effectiveState(row, tracking.closesAt, now) === "quoted",
  )?.businessId;

  const compareBlocked = compareBlockedBy(header.quoted, {
    none: t("track.compare_none"),
    one: t("track.compare_one"),
  });

  const declinedCount = rows.filter(
    (row) => effectiveState(row, tracking.closesAt, now) === "declined",
  ).length;

  return (
    <PublicShell nav={<DirectoryNav />}>
      <div className="mx-auto w-full max-w-7xl px-5 pb-24 md:pb-10">
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <header className="pt-10">
          <HeaderBadge mode={header.mode} quoted={header.quoted} sent={header.sent} />
          <h1 className="mt-3 max-w-[26ch] font-serif text-h1-serif text-ink">
            {headline(header)}
          </h1>
          <p className="mt-2 max-w-[var(--measure-prose)] text-body-sm text-body">
            {t("track.sub")}
          </p>
          {tracking.revisedAt && (
            /* Board 1i: a revision is stated, never silent. */
            <p className="mt-2 font-mono text-eyebrow uppercase tracking-eyebrow text-faint">
              {t("track.revised", {
                when: formatDate(tracking.revisedAt),
                revision: tracking.revision,
              })}
            </p>
          )}
        </header>

        <div className="mt-6 grid gap-[var(--gutter)] lg:grid-cols-[minmax(0,1fr)_18.75rem] xl:grid-cols-[minmax(0,1fr)_21.25rem]">
          <div className="min-w-0 space-y-5">
            {/* ── Two summary cards ─────────────────────────────────────── */}
            <div className="grid gap-3.5 sm:grid-cols-2">
              <section className="rounded-card border border-line bg-card p-4">
                <h2 className="font-mono text-eyebrow uppercase tracking-eyebrow text-faint">
                  {t("track.asked_for")}
                </h2>
                <ul className="mt-2 space-y-1">
                  {enquiry.lines.map((line) => (
                    <li key={line.id} className="text-body-sm text-ink">
                      {line.description}
                      <span className="ml-1.5 font-mono text-caption tabular-nums text-body">
                        ×{line.qty}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2.5 border-t border-line pt-2 text-caption text-body">
                  {[
                    enquiry.deliverToArea,
                    enquiry.neededBy ? formatDate(enquiry.neededBy) : null,
                    enquiry.termsWanted,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </section>

              <section className="rounded-card border border-line bg-card p-4">
                <h2 className="font-mono text-eyebrow uppercase tracking-eyebrow text-faint">
                  {t("track.happens_next")}
                </h2>
                <ol className="mt-2 space-y-1.5">
                  {[t("track.next_1"), t("track.next_2"), t("track.next_3")].map((line, i) => (
                    <li key={line} className="flex gap-2 text-caption text-body">
                      <span className="font-mono text-faint">{i + 1}</span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ol>
              </section>
            </div>

            {/*
               All declined is a problem to solve rather than a wait to sit
               through, so it is said above the rows and the primary action
               changes to widening the search.
            */}
            {header.mode === "all_declined" && (
              <p className="rounded-ctl border border-warn-line bg-warn-wash px-3.5 py-2.5 text-body-sm text-warn-ink">
                {t("track.all_declined", { count: header.sent })}
              </p>
            )}

            {closed && header.quoted === 0 && header.mode !== "all_declined" && (
              <p className="rounded-ctl border border-bad-line bg-bad-wash px-3.5 py-2.5 text-body-sm text-bad-ink">
                {t("track.closed_no_quotes")}
              </p>
            )}

            {/* ── Live status ───────────────────────────────────────────── */}
            <LiveStatus
              quotedCount={header.quoted}
              heading={t("track.live_status")}
              listLabel={t("track.recipients_label")}
              announceOne={t("track.new_quote_announced", { count: 1 }).replace("1", "{count}")}
              announceMany={t("track.new_quote_announced", { count: 2 }).replace("2", "{count}")}
              closesLabel={
                closed
                  ? t("track.closed_on", { when: formatDate(tracking.closesAt) })
                  : t("track.closes_in", {
                      duration: formatCountdown(tracking.closesAt, { now }),
                    })
              }
              rows={rows.map((row) => (
                <RecipientRow
                  key={row.businessId}
                  row={row}
                  closesAt={tracking.closesAt}
                  now={now}
                  accepted={tracking.accepted}
                  acceptedBusinessId={enquiry.contactReleasedToBusinessId}
                  isFirstQuoted={row.businessId === firstQuotedId}
                  quoteHref={withToken(`/enquiry/${tracking.ref}/compare`)}
                  enquiryRef={tracking.ref}
                  token={token}
                />
              ))}
            />

            {/* ── Action row ────────────────────────────────────────────── */}
            <div className="hidden flex-wrap items-start gap-2 md:flex">
              {tracking.accepted ? (
                <a href={withToken(`/enquiry/${tracking.ref}/accepted`)} className={PRIMARY}>
                  {t("track.view_accepted")}
                </a>
              ) : (
                <div>
                  <a
                    href={compareBlocked ? undefined : withToken(`/enquiry/${tracking.ref}/compare`)}
                    aria-disabled={Boolean(compareBlocked)}
                    className={cn(PRIMARY, compareBlocked && DISABLED)}
                  >
                    {t("track.compare")}
                  </a>
                  {/* Never a silent dead button. */}
                  {compareBlocked && (
                    <p className="mt-1.5 text-caption text-body">{compareBlocked}</p>
                  )}
                </div>
              )}

              {!tracking.accepted && canAddRecipients(header.sent) && (
                /*
                   Absent at the cap, not disabled. A disabled control invites a
                   buyer to work out what they are missing when the answer is
                   nothing they can change.
                */
                <a
                  href={`/rfq/new?from=${tracking.ref}`}
                  className={SECONDARY}
                >
                  {header.mode === "all_declined"
                    ? t("track.send_more", { count: declinedCount })
                    : t("track.add_suppliers")}
                </a>
              )}

              {!tracking.accepted && !closed && (
                <a href={`/rfq/new?revise=${tracking.ref}`} className={SECONDARY}>
                  {t("track.edit_requirement")}
                </a>
              )}
            </div>
          </div>

          {/* ── Sidebar ─────────────────────────────────────────────────── */}
          <aside className="min-w-0 space-y-3.5">
            {/*
               The privacy card first on a phone, because it is the thing that
               gets read there — ordered rather than duplicated.
            */}
            <section className="order-first rounded-card bg-paper-sunk p-4 lg:order-none">
              <h2 className="text-body-sm font-medium text-ink">{t("track.privacy_title")}</h2>
              <p className="mt-1.5 text-caption leading-relaxed text-body">
                {t("track.privacy_body")}
              </p>
            </section>

            <section className="rounded-card border border-line bg-card p-4">
              <h2 className="font-mono text-eyebrow uppercase tracking-eyebrow text-faint">
                {t("track.reference")}
              </h2>
              <p className="mt-1.5 font-mono text-body-sm text-ink">{tracking.ref}</p>
              <p className="mt-1.5 text-caption text-body">
                {t("track.sent_at", { when: formatDateTime(enquiry.createdAt) })}
              </p>
            </section>

            <section className="rounded-card border border-line bg-card p-4">
              <h2 className="text-body-sm font-medium text-ink">{t("track.template_title")}</h2>
              <p className="mt-1.5 text-caption leading-relaxed text-body">
                {t("track.template_body")}
              </p>
            </section>
          </aside>
        </div>
      </div>

      {/*
         Below 768 the action row becomes a sticky bar carrying Compare alone.
         The other two actions are secondary and a phone has no room to offer
         three; losing Compare below the fold is what loses the comparison.
      */}
      {!tracking.accepted && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card px-4 py-2.5 shadow-overlay md:hidden">
          <a
            href={compareBlocked ? undefined : withToken(`/enquiry/${tracking.ref}/compare`)}
            aria-disabled={Boolean(compareBlocked)}
            className={cn(PRIMARY, "w-full justify-center", compareBlocked && DISABLED)}
          >
            {t("track.compare")}
          </a>
          {compareBlocked && (
            <p className="mt-1 text-center text-caption text-body">{compareBlocked}</p>
          )}
        </div>
      )}
    </PublicShell>
  );
}

/**
 * The `h1`, matching the badge's state, with the number as a word.
 *
 * Both are read from the same `headerState`, so they cannot disagree — which is
 * the defect the spec says this page is most likely to ship with.
 */
function headline(header: ReturnType<typeof headerState>): string {
  if (header.mode === "accepted") return t("track.h1_accepted");
  if (header.mode === "all_declined") return t("track.h1_all_declined");
  if (header.mode === "quoted") {
    return header.quoted === 1
      ? t("track.h1_quoted_one")
      : t("track.h1_quoted", { Word: spellCapitalised(header.quoted) });
  }
  return header.sent === 1
    ? t("track.h1_sent_one")
    : t("track.h1_sent", { word: spell(header.sent) });
}

const PRIMARY = cn(
  "inline-flex min-h-11 items-center rounded-ctl bg-moss px-4",
  "text-body-sm font-medium text-white hover:bg-moss-deep",
  "focus-visible:outline-none focus-visible:shadow-focus",
);
const SECONDARY = cn(
  "inline-flex min-h-11 items-center rounded-ctl border border-line bg-card px-3.5",
  "text-body-sm font-medium text-ink hover:bg-paper",
  "focus-visible:outline-none focus-visible:shadow-focus",
);
const DISABLED = "pointer-events-none bg-line-strong text-muted hover:bg-line-strong";
