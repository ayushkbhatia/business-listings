import Link from "next/link";
import { Alert, StatusBadge } from "@/components/display";
import { buttonClassName } from "@/components/primitives";
import { VerificationLadder } from "@/components/domain";
import { TIERS, TOP_ACHIEVABLE_TIER, tierSpec } from "@/components/domain/verification";
import { Panel } from "@/components/structure";
import { getVerification, type CredentialDocument } from "@/lib/db/queries/verification";
import { formatCount, formatDate, formatMonth } from "@/lib/format";
import { t } from "@/lib/i18n";
import {
  CREDENTIAL_REVIEW_DAYS,
  LICENCE_NOTICE_DAYS,
  LICENCE_URGENT_DAYS,
  type LicenceStage,
} from "@/lib/verification";
import { getNavBadges, requireSellerSeat, SellerPage } from "../_shell";
import { deleteDocument, recordDocument, setVisibility, signDocumentUpload } from "./actions";
import { DocumentUpload } from "./DocumentUpload";
import { VisibilityControl } from "./VisibilityControl";

/**
 * Board 3e — verification and documents.
 *
 * Two questions, and the board this was drawn from answered neither cleanly:
 * **what has the platform actually checked**, and **what does it cost you when
 * it lapses**.
 *
 * ## The two tables are the design
 *
 * The board ran one table, five rows and `Verified` on all but one of them. Two
 * of those rows are the trade licence and the TRN, checked against the issuing
 * authority; the other three are certificates the seller uploaded that nobody
 * here has looked at. One `Verified` pill across both is a claim the platform
 * cannot back — the same shape of defect as a provenance label on something
 * never checked, one level up.
 *
 * So it splits, and the split runs all the way down: `Verified by us` sets the
 * tier and is `Badge only` because the badge is platform output; `Uploaded by
 * you` says `On file`, never touches the tier, and its visibility is the
 * seller's own choice. A seller can read the screen and know which documents
 * are load-bearing.
 *
 * ## Read-only about the tier, on purpose and visibly
 *
 * CLAUDE.md non-negotiable 2: `verificationTier` is writable only by an
 * `ops_lead`, with no API path and no seller-editable field. This page says so
 * out loud rather than only being silent about it — a seller who cannot find
 * the control looks for it, and the sentence is the answer.
 *
 * ## Every number here is computed
 *
 * The render hardcodes both figures on it, the 220 days and the 22, and the
 * spec is explicit that both are queries in the build. `getVerification`
 * derives them from the expiry dates at read time; nothing stores a countdown.
 */
export const metadata = { title: t("verify_listing.title") };
export const dynamic = "force-dynamic";

/**
 * Rungs a listing can actually get to. Tier 0 is not a rung — it is "nothing
 * here has been checked", which is a state with no ladder in front of it.
 *
 * This also filtered `!spec.reserved` while trade references sat on the ladder
 * drawn but unbuilt. That rung is cut, so every rung above 0 is now reachable
 * and the count is unchanged at two — the number was already excluding it.
 */
const ACHIEVABLE_RUNGS = TIERS.filter((spec) => spec.tier > 0).length;

export default async function VerificationPage() {
  const seat = await requireSellerSeat();
  const [view, badges] = await Promise.all([
    getVerification(seat.businessId),
    getNavBadges(seat.businessId),
  ]);
  if (!view) return null;

  const lapsed = view.stage === "lapsed";

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/verification"
      eyebrow={t("verify_listing.eyebrow")}
      title={t("verify_listing.title")}
      meta={
        <span className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={view.tier >= TOP_ACHIEVABLE_TIER ? "ok" : "neutral"}>
            {t("verify_listing.rung", {
              tier: String(view.tier),
              label: t(tierSpec(view.tier).labelKey as never),
            })}
          </StatusBadge>
          <span className="text-caption text-muted">
            {view.verifiedAt
              ? t("verify_listing.checked_on", {
                  authority: view.licenceAuthority,
                  when: formatDate(view.verifiedAt),
                })
              : t("verify_listing.never_checked")}
          </span>
        </span>
      }
      actions={
        /*
           The expiry, in the header, on every state.

           It is the single most consequential fact on the screen and the board
           put it here rather than in the body. `Next licence check due` was the
           board's wording and describes a check nobody performs — nothing is
           re-checked on a schedule, the licence expires and the job acts.
        */
        <span className="text-right">
          <span className="block font-mono text-eyebrow uppercase tracking-eyebrow text-muted">
            {t("verify_listing.expires_label")}
          </span>
          <span
            className={`block text-body-sm tabular-nums ${lapsed ? "text-bad-ink" : view.stage === "urgent" ? "text-warn-ink" : "text-ink"}`}
          >
            {lapsed
              ? t("verify_listing.expired_on", { when: formatDate(view.licenceExpiry) })
              : t("verify_listing.expires_days", {
                  count: view.daysToExpiry,
                  when: formatDate(view.licenceExpiry),
                  formatted: formatCount(view.daysToExpiry),
                })}
          </span>
        </span>
      }
    >
      <div className="flex flex-col gap-[var(--gutter)] xl:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          {lapsed && (
            <Alert tone="warn" live="polite" fix={t("verify_listing.licence_expired_fix")}>
              {t("verify_listing.licence_expired", { when: formatDate(view.licenceExpiry) })}
            </Alert>
          )}

          <Ladder tier={view.tier} licenceExpiry={view.licenceExpiry} stage={view.stage} />
          <CheckedByUs view={view} />
          <UploadedByYou credentials={view.credentials} />

          {/*
              The one upload surface, and both buttons above reach it.

              A second uploader inside the credentials panel would be a second
              place a trade licence could be filed, and the kind select is what
              decides which of the two tables a file lands in — so there is one
              of it, named, with an anchor the rail and the panel header point
              at rather than a dialog each.
          */}
          <div id="upload" className="scroll-mt-24">
            <Panel title={t("verify_listing.documents")} description={t("verify_listing.documents_hint")}>
              <DocumentUpload
                documents={view.uploads.map((document) => ({
                  id: document.id,
                  kind: document.kind,
                  filename: document.filename,
                  uploadedAt: formatDate(document.uploadedAt),
                  deletable: document.deletable,
                }))}
                signAction={signDocumentUpload}
                recordAction={recordDocument}
                deleteAction={deleteDocument}
              />
            </Panel>
          </div>
        </div>

        {/*
            340px, and below 1280 it moves under the tables rather than
            narrowing. The expiry card must not compress: it is the only place
            the 60 / 14 / 0 sequence is written down.
        */}
        <div className="flex w-full shrink-0 flex-col gap-5 xl:w-[340px]">
          <ExpiryCard daysToExpiry={view.daysToExpiry} lapsed={lapsed} verified={view.tier >= TOP_ACHIEVABLE_TIER} />
          <ActionNeeded view={view} />
          <WhatBuyersSee />
        </div>
      </div>
    </SellerPage>
  );
}

/* ── 2 · Your verification ───────────────────────────────────────────────── */

function Ladder({
  tier,
  licenceExpiry,
  stage,
}: {
  tier: number;
  licenceExpiry: Date;
  stage: LicenceStage;
}) {
  /*
     Three sentences, because the drop only threatens somebody who has
     something to drop.

     "On 21 Sep 2027 you drop to tier 1" is a warning to a verified supplier and
     nonsense to a listing sitting at 0 that has never been checked — it reads
     as a demotion from a rung they were never on. What that seller needs is
     what tier 2 requires, which is the next thing they can act on.
  */
  const note =
    tier < TOP_ACHIEVABLE_TIER
      ? t("verify_listing.ladder_note_below")
      : stage === "lapsed"
        ? t("verify_listing.ladder_note_lapsed", { when: formatDate(licenceExpiry) })
        : t("verify_listing.ladder_note", { when: formatDate(licenceExpiry) });
  return (
    <Panel
      title={t("verify_listing.ladder")}
      /*
         Counted, not written. `TIERS` decides how many rungs a seller can
         actually reach — everything above 0 — so a rung added or withdrawn
         moves the sentence with the ladder instead of leaving a header saying
         two over three.
      */
      description={t("verify_listing.ladder_lede", {
        count: ACHIEVABLE_RUNGS,
        formatted: formatCount(ACHIEVABLE_RUNGS),
      })}
      footer={<p className="text-caption text-muted">{t("verify_listing.staff_only")}</p>}
    >
      {/*
         A different name from the Panel around it. Both are regions, and two
         landmarks sharing an accessible name are two identical entries in a
         screen reader's landmark list — the exact thing
         tests/e2e/landmarks.spec.ts guards on the gallery.
      */}
      <VerificationLadder
        current={tier}
        label={t("verify_listing.current", { tier: String(tier) })}
        reachedLabel={t("verify_listing.reached")}
        rungs={TIERS.filter((spec) => spec.tier > 0).map((spec) => ({
          tier: spec.tier,
          label: t(spec.labelKey as never),
          requirement: t(`verify.requirement.t${spec.tier}` as never),
          ...(spec.tier === TOP_ACHIEVABLE_TIER ? { badge: t("verify_listing.top_tier") } : {}),
        }))}
      />

      <p className="mt-4 max-w-prose border-t border-line pt-3 text-caption text-muted">{note}</p>
    </Panel>
  );
}

/* ── 3 · Verified by us ──────────────────────────────────────────────────── */

function CheckedByUs({ view }: { view: NonNullable<Awaited<ReturnType<typeof getVerification>>> }) {
  return (
    <Panel title={t("verify_listing.checked_title")} description={t("verify_listing.checked_hint")} padded={false}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-body-sm">
          <caption className="sr-only">{t("verify_listing.checked_caption")}</caption>
          <thead>
            <tr className="border-b border-line bg-paper-sunk">
              <Th>{t("verify_listing.col_document")}</Th>
              <Th width="w-[150px]">{t("verify_listing.col_number")}</Th>
              <Th width="w-[118px]">{t("verify_listing.col_expires")}</Th>
              <Th width="w-[158px]">{t("verify_listing.col_state")}</Th>
              <Th width="w-[168px]">{t("verify_listing.col_who")}</Th>
            </tr>
          </thead>
          <tbody>
            {view.checked.map((row) => {
              const isLicence = row.kind === "trade_licence";
              const rowLapsed = isLicence && view.stage === "lapsed";
              const rowUrgent = isLicence && view.stage === "urgent";
              return (
                <tr
                  key={row.kind}
                  /*
                     The row a deep link from board 3a's queue lands on, and
                     `tabIndex={-1}` is what makes "focused" true rather than
                     only "scrolled to". A browser moves focus to a fragment
                     target only when the target can hold it, and a `tr` cannot
                     by default — so a keyboard user following `Renew` would
                     land with focus still on the document body and tab from the
                     top of the page. Criterion 11 asks for the row.
                  */
                  id={isLicence ? "licence" : undefined}
                  tabIndex={isLicence ? -1 : undefined}
                  className={`border-b border-line last:border-b-0 scroll-mt-24 ${
                    rowLapsed ? "bg-bad-surface" : rowUrgent ? "bg-warn-surface" : ""
                  }`}
                >
                  <th scope="row" className="px-3 py-2.5 text-left font-normal text-ink">
                    {isLicence
                      ? t("verify_listing.row_licence", { authority: view.licenceAuthority })
                      : t("verify_listing.row_trn")}
                  </th>
                  <td className="px-3 py-2.5 font-mono text-caption tabular-nums text-body">
                    {row.number ?? (
                      <span className="text-muted">{t("table.not_provided")}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-body">
                    {row.expiresAt ? (
                      formatDate(row.expiresAt)
                    ) : (
                      <span className="text-muted">{t("verify_listing.no_expiry")}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {row.checkedAt ? (
                      <StatusBadge tone={rowLapsed ? "bad" : "ok"} size="sm" shape="chip">
                        {t("verify_listing.state_checked", { when: formatDate(row.checkedAt) })}
                      </StatusBadge>
                    ) : (
                      <span className="text-caption text-muted">
                        {t("verify_listing.state_unchecked")}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-caption text-muted">
                    {isLicence
                      ? t("verify_listing.who_badge_only")
                      : t("verify_listing.who_badge_masked")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/* ── 4 · Uploaded by you ─────────────────────────────────────────────────── */

function UploadedByYou({ credentials }: { credentials: readonly CredentialDocument[] }) {
  return (
    <Panel
      title={t("verify_listing.uploaded_title")}
      description={t("verify_listing.uploaded_hint")}
      padded={false}
      actions={
        <Link href="#upload" className={buttonClassName({ variant: "secondary", size: "sm" })}>
          {t("verify_listing.upload")}
        </Link>
      }
      footer={
        <p className="max-w-prose text-caption text-muted">
          {t("verify_listing.uploaded_footer", { days: String(CREDENTIAL_REVIEW_DAYS) })}
        </p>
      }
    >
      {credentials.length === 0 ? (
        <p className="max-w-prose px-[var(--panel-pad)] py-4 text-body-sm text-muted">
          {t("verify_listing.uploaded_empty")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-body-sm">
            <caption className="sr-only">{t("verify_listing.uploaded_caption")}</caption>
            <thead>
              <tr className="border-b border-line bg-paper-sunk">
                <Th>{t("verify_listing.col_document")}</Th>
                <Th width="w-[150px]">{t("verify_listing.col_number")}</Th>
                <Th width="w-[118px]">{t("verify_listing.col_expires")}</Th>
                <Th width="w-[158px]">{t("verify_listing.col_state")}</Th>
                <Th width="w-[168px]">{t("verify_listing.col_who")}</Th>
              </tr>
            </thead>
            <tbody>
              {credentials.map((document) => (
                <tr key={document.id} className="border-b border-line last:border-b-0">
                  <th scope="row" className="px-3 py-2.5 text-left font-normal text-ink">
                    {document.name}
                    {document.reviewReason && !document.isPublic && (
                      <span className="mt-0.5 block text-caption text-bad-ink">
                        {t("verify_listing.review_reason", { reason: document.reviewReason })}
                      </span>
                    )}
                  </th>
                  <td className="px-3 py-2.5 font-mono text-caption tabular-nums text-body">
                    {document.reference ?? (
                      <span className="text-muted">{t("table.not_provided")}</span>
                    )}
                  </td>
                  {/*
                     To the month, not the day. Board 1d's rule for a
                     certificate, kept here so the seller reads the same
                     precision a buyer will.
                  */}
                  <td className="px-3 py-2.5 tabular-nums text-body">
                    {document.validUntil ? (
                      formatMonth(document.validUntil)
                    ) : (
                      <span className="text-muted">{t("verify_listing.no_expiry")}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <CredentialState document={document} />
                  </td>
                  <td className="px-3 py-2.5">
                    <VisibilityControl
                      documentId={document.id}
                      name={document.name}
                      isPublic={document.isPublic}
                      onStorefront={document.onStorefront}
                      action={setVisibility}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/**
 * The state pill, and the four states never share a tone by accident.
 *
 * `Expiring` says the number of days rather than the date, because
 * `28 Sep 2026` in a table does not read as urgent. `In review` carries its SLA
 * and names the queue that owns it — the board left it with neither, which made
 * it indistinguishable from a stuck upload.
 */
function CredentialState({ document }: { document: CredentialDocument }) {
  if (document.state === "lapsed") {
    return (
      <StatusBadge tone="bad" size="sm" shape="chip">
        {t("verify_listing.state_lapsed")}
      </StatusBadge>
    );
  }
  if (document.state === "in_review") {
    return (
      <StatusBadge tone="info" size="sm" shape="chip">
        {t("verify_listing.state_in_review", { days: String(CREDENTIAL_REVIEW_DAYS) })}
      </StatusBadge>
    );
  }
  if (document.state === "expiring") {
    return (
      <StatusBadge tone="warn" size="sm" shape="chip">
        {t("verify_listing.state_expiring", {
          count: document.daysLeft ?? 0,
          formatted: formatCount(document.daysLeft ?? 0),
        })}
      </StatusBadge>
    );
  }
  return (
    <StatusBadge tone="neutral" size="sm" shape="chip">
      {t("verify_listing.state_on_file")}
    </StatusBadge>
  );
}

/* ── 5 · When your licence expires ───────────────────────────────────────── */

/**
 * The expiry job, made legible.
 *
 * It is the dependency this board ships with, and the board had no
 * representation of it at all. All three points are always drawn, including the
 * ones already passed — a seller fourteen days out needs to see that the
 * sixty-day email was the first step of a sequence and not a one-off.
 */
function ExpiryCard({
  daysToExpiry,
  lapsed,
  verified,
}: {
  daysToExpiry: number;
  lapsed: boolean;
  /** Holding the badge the expiry would take. */
  verified: boolean;
}) {
  const points = [
    {
      key: "60",
      at: t("verify_listing.expiry_60", { days: String(LICENCE_NOTICE_DAYS) }),
      body: t("verify_listing.expiry_60_body"),
      passed: lapsed || daysToExpiry <= LICENCE_NOTICE_DAYS,
    },
    {
      key: "14",
      at: t("verify_listing.expiry_14", { days: String(LICENCE_URGENT_DAYS) }),
      body: t("verify_listing.expiry_14_body"),
      passed: lapsed || daysToExpiry <= LICENCE_URGENT_DAYS,
    },
    {
      key: "0",
      at: t("verify_listing.expiry_0"),
      /*
         What the day costs, and it is different for a listing that never had
         the badge. "Your tier drops to 1" promises a fall to somebody standing
         at 0 — the sequence still applies to them, because the licence still
         expires, but what it takes is the route to tier 2 rather than a badge
         they hold.
      */
      body: verified
        ? t("verify_listing.expiry_0_body")
        : t("verify_listing.expiry_0_body_unverified"),
      passed: lapsed,
    },
  ];

  return (
    <Panel eyebrow={t("verify_listing.expiry_title")}>
      {!lapsed && (
        <p className="mb-3 font-mono text-h3 tabular-nums text-ink">
          {t("verify_listing.expiry_now", {
            count: daysToExpiry,
            formatted: formatCount(daysToExpiry),
          })}
        </p>
      )}
      <ol className="flex flex-col gap-3">
        {points.map((point) => (
          <li key={point.key} className="grid grid-cols-[72px_1fr] gap-3">
            <span
              className={`font-mono text-eyebrow uppercase tracking-eyebrow tabular-nums ${
                point.passed ? "text-warn-ink" : "text-muted"
              }`}
            >
              {point.at}
            </span>
            <span className="text-caption text-body">{point.body}</span>
          </li>
        ))}
      </ol>
      <p className="mt-4 border-t border-line pt-3 text-caption text-muted">
        {t("verify_listing.expiry_reassurance")}
      </p>
    </Panel>
  );
}

/* ── 6 · Action needed ───────────────────────────────────────────────────── */

/**
 * One item, and it names what specifically breaks.
 *
 * The licence outranks a credential because the blast radius is different: a
 * lapsed credential drops you out of one filter, a lapsed licence takes the
 * badge off every public card. When neither is inside its window the card still
 * renders — its absence would read as breakage, and "nothing needs your
 * attention" with the number behind it is a fact rather than a placeholder.
 */
function ActionNeeded({ view }: { view: NonNullable<Awaited<ReturnType<typeof getVerification>>> }) {
  const credential = view.credentials.find(
    (document) => document.state === "expiring" || document.state === "lapsed",
  );
  const licenceNeedsAction = view.stage === "urgent" || view.stage === "notice" || view.stage === "lapsed";

  if (!licenceNeedsAction && !credential) {
    return (
      <Panel eyebrow={t("verify_listing.action_title")}>
        <p className="text-caption text-body">
          {t("verify_listing.action_none", { days: formatCount(view.daysToExpiry) })}
        </p>
      </Panel>
    );
  }

  const body = licenceNeedsAction
    ? view.stage === "lapsed"
      ? t("verify_listing.action_licence_lapsed", { when: formatDate(view.licenceExpiry) })
      : t("verify_listing.action_licence", { days: formatCount(view.daysToExpiry) })
    : credential!.state === "lapsed"
      ? t("verify_listing.action_credential_lapsed", {
          name: credential!.name,
          when: formatDate(credential!.validUntil!),
        })
      : t("verify_listing.action_credential", {
          name: credential!.name,
          days: formatCount(credential!.daysLeft ?? 0),
        });

  return (
    <Panel eyebrow={t("verify_listing.action_title")}>
      <p className="text-caption text-body">{body}</p>
      <Link href="#upload" className={`mt-3 ${buttonClassName({ size: "sm" })}`}>
        {t("verify_listing.upload_renewal")}
      </Link>
    </Panel>
  );
}

/* ── 7 · What buyers see ─────────────────────────────────────────────────── */

function WhatBuyersSee() {
  const rows = [
    { key: "badge", shown: true, label: t("verify_listing.buyers_badge") },
    { key: "certs", shown: true, label: t("verify_listing.buyers_certs") },
    { key: "files", shown: false, label: t("verify_listing.buyers_no_files") },
    { key: "trn", shown: false, label: t("verify_listing.buyers_no_trn") },
  ];

  return (
    <Panel eyebrow={t("verify_listing.buyers_title")}>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.key} className="flex items-start gap-2">
            {/*
               The word, not only the mark. A tick and a cross in the same
               column are the same shape to anyone reading with their ears.
            */}
            <span
              aria-hidden="true"
              className={`mt-px font-mono text-caption ${row.shown ? "text-ok-ink" : "text-muted"}`}
            >
              {row.shown ? "✓" : "✗"}
            </span>
            <span className="sr-only">
              {row.shown ? t("verify_listing.buyers_shown") : t("verify_listing.buyers_never")}
            </span>
            <span className="text-caption text-body">{row.label}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Th({ children, width }: { children: React.ReactNode; width?: string }) {
  return (
    <th
      scope="col"
      className={`px-3 py-2 text-left font-mono text-eyebrow font-normal uppercase tracking-eyebrow text-muted ${width ?? ""}`}
    >
      {children}
    </th>
  );
}
