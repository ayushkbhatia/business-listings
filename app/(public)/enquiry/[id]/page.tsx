import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicShell } from "@/components/structure";
import { Alert } from "@/components/display/Alert";
import { getBuyerEnquiry, type BuyerEnquiry } from "@/lib/db/queries/enquiry";
import type { EnquiryBrief } from "@/lib/db/queries/enquiry-brief";
import { briefFactWords } from "@/lib/enquiry/service-brief-words";
import { getTrackingByRef } from "@/lib/db/queries/enquiry-tracking";
import {
  additionalWanted,
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
import { ViewerNav } from "@/app/(public)/_account-menu";
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
  title: t("track.meta_title"),
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
  // A URL parameter, so clamped to what an add can actually have written.
  const added = Math.min(8, Math.max(0, Math.floor(Number(one("added")) || 0)));
  const addable = additionalWanted({
    sent: header.sent,
    declined: declinedCount,
    allDeclined: header.mode === "all_declined",
  });

  return (
    <PublicShell nav={<ViewerNav />}>
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

        {/*
           Board `1d-s`. The enquiry went; the file did not. Said once, plainly,
           with the one thing the buyer can do about it.
        */}
        {/* Board 1i: suppliers added from `/rfq/new?from=`, said once. */}
        {added > 0 && (
          <p role="status" className="mt-4 rounded-ctl border border-ok-line bg-ok-wash px-3.5 py-2.5 text-body-sm text-ok-ink">
            {t("track.added", { count: added, word: spell(added) })}
          </p>
        )}

        {one("attachment") === "failed" && (
          <div className="mt-4">
            <Alert tone="warn" live="polite" fix={t("enquiry.attachment_failed")}>
              {t("storefront_services.composer.upload_unavailable")}
            </Alert>
          </div>
        )}

        <div className="mt-6 grid gap-[var(--gutter)] lg:grid-cols-[minmax(0,1fr)_18.75rem] xl:grid-cols-[minmax(0,1fr)_21.25rem]">
          <div className="min-w-0 space-y-5">
            {/* ── Two summary cards ─────────────────────────────────────── */}
            <div className="grid gap-3.5 sm:grid-cols-2">
              {enquiry.brief ? (
                <BriefCard enquiry={enquiry} brief={enquiry.brief} />
              ) : (
                <section className="rounded-card border border-line bg-card p-4">
                  <h2 className="font-mono text-eyebrow uppercase tracking-eyebrow text-faint">
                    {t("track.asked_for")}
                  </h2>
                  <ul className="mt-2 space-y-1">
                    {enquiry.lines.map((line) => (
                      <li key={line.id} className="text-body-sm text-ink">
                        {line.description}
                        {/* `×1` on "Statutory audit" is the platform inventing a
                            unit for work sold as a job. Omitted instead. */}
                        {line.qty !== null && (
                          <span className="ml-1.5 font-mono text-caption tabular-nums text-body">
                            ×{line.qty}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2.5 border-t border-line pt-2 text-caption text-body">
                    {[
                      enquiry.scale ? `${t("enquiry.scale")}: ${enquiry.scale}` : null,
                      enquiry.deliverToArea,
                      enquiry.neededBy ? formatDate(enquiry.neededBy) : null,
                      /*
                         Worded. This printed the stored enum — `net_30` — to the
                         buyer who had picked "Net 30" from a list.
                      */
                      enquiry.termsWanted ? t(`terms.${enquiry.termsWanted}` as "terms.net_30") : null,
                      ...enquiry.attachments.map((file) => `${t("enquiry.attachment")}: ${file.filename}`),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </section>
              )}

              <section className="rounded-card border border-line bg-card p-4">
                <h2 className="font-mono text-eyebrow uppercase tracking-eyebrow text-faint">
                  {t("track.happens_next")}
                </h2>
                <ol className="mt-2 space-y-1.5">
                  {(enquiry.brief
                    ? [t("track.brief.next_1"), t("track.brief.next_2"), t("track.next_3")]
                    : [t("track.next_1"), t("track.next_2"), t("track.next_3")]
                  ).map((line, i) => (
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
                  threadHref={withToken(`/enquiry/${tracking.ref}/thread/${row.slug}`)}
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

              {/*
                 Not on a brief. It went to every firm the matcher found, up to
                 the cap, so "add two more" would offer firms that do not cover
                 the site — the padding `1h-s` refuses.
              */}
              {!tracking.accepted && !closed && !enquiry.brief && canAddRecipients(header.sent) && (
                /*
                   Absent at the cap, not disabled. A disabled control invites a
                   buyer to work out what they are missing when the answer is
                   nothing they can change. Absent once closed too: a supplier
                   added then would receive an enquiry with no time left.

                   The count is the one `/rfq/new?from=` offers, so at seven sent
                   the label says one rather than promising two. The token
                   travels with it, because the page identifies the buyer the
                   same way this one does.
                */
                <a href={withToken(`/rfq/new?from=${tracking.ref}`)} className={SECONDARY}>
                  {header.mode === "all_declined"
                    ? t("track.send_more", { count: addable })
                    : t("track.add_suppliers", { count: addable, word: spell(addable) })}
                </a>
              )}

              {!tracking.accepted && !closed && (
                <a href={withToken(`/rfq/new?revise=${tracking.ref}`)} className={SECONDARY}>
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

            {/* Its copy is about re-buying the same lines, which a brief has none of. */}
            {!enquiry.brief && (
              <section className="rounded-card border border-line bg-card p-4">
                <h2 className="text-body-sm font-medium text-ink">{t("track.template_title")}</h2>
                <p className="mt-1.5 text-caption leading-relaxed text-body">
                  {t("track.template_body")}
                </p>
              </section>
            )}
          </aside>
        </div>
      </div>

      {/*
         Below 768 the action row becomes a sticky bar carrying Compare alone.
         The other two actions are secondary and a phone has no room to offer
         three; losing Compare below the fold is what loses the comparison.
      */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card px-4 py-2.5 shadow-overlay md:hidden">
        {tracking.accepted ? (
          /*
             An accepted enquiry still needs its one action on a phone. The
             first version rendered the bar only while the enquiry was open, so
             a buyer who had accepted a quote had no way to reach it below
             768px — the page became a record with no door.
          */
          <a
            href={withToken(`/enquiry/${tracking.ref}/accepted`)}
            className={cn(PRIMARY, "w-full justify-center")}
          >
            {t("track.view_accepted")}
          </a>
        ) : (
          <>
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
          </>
        )}
      </div>
    </PublicShell>
  );
}

/**
 * Board `1h-s` — the brief as the buyer sent it.
 *
 * The description exactly as typed (B2), with its line breaks, and the facts a
 * supplier prices against in a real definition list. A scale left empty says
 * so in words — B7's null carried to the one page the buyer reads it on, rather
 * than a missing row that looks like a field the page forgot.
 */
function BriefCard({ enquiry, brief }: { enquiry: BuyerEnquiry; brief: EnquiryBrief }) {
  const facts = briefFactWords(brief);
  const rows: { key: string; label: string; value: string; muted?: boolean }[] = [
    { key: "site", label: t("track.brief.site"), value: facts.site },
    { key: "engagement", label: t("track.brief.engagement"), value: facts.engagement },
    { key: "start", label: t("track.brief.start"), value: facts.start },
    enquiry.scale
      ? { key: "scale", label: t("track.brief.scale"), value: enquiry.scale }
      : { key: "scale", label: t("track.brief.scale"), value: t("track.brief.scale_none"), muted: true },
    ...(enquiry.attachments.length > 0
      ? [{ key: "files", label: t("track.brief.files"), value: enquiry.attachments.map((f) => f.filename).join(", ") }]
      : []),
  ];

  return (
    <section className="rounded-card border border-line bg-card p-4">
      <h2 className="font-mono text-eyebrow uppercase tracking-eyebrow text-faint">{t("track.brief_title")}</h2>
      <p className="mt-1 text-body-sm font-medium text-ink">{brief.subcategoryName}</p>
      <p className="mt-2 whitespace-pre-wrap break-words text-body-sm text-body">{enquiry.requirement}</p>
      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-t border-line pt-3 text-caption">
        {rows.map((row) => (
          <div key={row.key} className="contents">
            <dt className="text-muted">{row.label}</dt>
            <dd className={cn("min-w-0 break-words", row.muted ? "text-faint" : "text-ink")}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
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
