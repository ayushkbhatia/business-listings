import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Panel, PublicShell } from "@/components/structure";
import { StatusBadge, type StatusTone } from "@/components/display/StatusBadge";
import { getBuyerEnquiry } from "@/lib/db/queries/enquiry";
import { formatAED, formatCountdown, formatDate, formatRelative, isWithinRelativeWindow } from "@/lib/format";
import { t } from "@/lib/i18n";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { resolveBuyerId, trackingTokenFor } from "../_buyer";

/**
 * Board 1i — sent, and live tracking.
 *
 * Including the state the acceptance criteria call out by name: no quotes yet.
 * It is the state this page is in for most of its life, and a spinner or an
 * empty table would make a working enquiry look broken.
 */
export const dynamic = "force-dynamic";

const STATE_TONE: Record<string, StatusTone> = {
  delivered: "info",
  opened: "warn",
  quoted: "ok",
  declined: "neutral",
  no_response: "neutral",
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

  const enquiry = await getBuyerEnquiry(buyerId, id);
  if (!enquiry) notFound();

  const token = await trackingTokenFor(buyerId);
  const withToken = (path: string) => (token ? `${path}${path.includes("?") ? "&" : "?"}t=${token}` : path);

  const now = new Date();
  const open = enquiry.closesAt.getTime() > now.getTime();
  const quoted = enquiry.quotes.filter((q) => q.status !== "lost");

  return (
    <PublicShell nav={<DirectoryNav />} footer={<DirectoryFooter />}>
      <div className="mx-auto w-full max-w-[52rem] px-[var(--section-pad)] py-8">
      <p className="font-mono text-eyebrow uppercase text-faint">{t("enquiry.ref", { ref: enquiry.ref })}</p>

      {one("sent") ? (
        <Card padded>
          <h1 className="text-h2 text-ink">{t("enquiry.sent_title")}</h1>
          <p className="mt-1.5 text-body-sm text-muted">
            {t("enquiry.sent_body", { count: enquiry.recipients.length })}
          </p>
        </Card>
      ) : (
        <h1 className="mt-2 font-serif text-h1-serif text-ink">{t("enquiry.track")}</h1>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <StatusBadge tone={enquiry.contactReleasedToBusinessId ? "ok" : open ? "info" : "neutral"} shape="chip">
          {enquiry.contactReleasedToBusinessId
            ? t("account.enquiries.status.accepted")
            : open
              ? t("account.enquiries.status.open")
              : t("account.enquiries.status.closed")}
        </StatusBadge>
        <span className="text-caption text-muted">
          {!open
            ? t("enquiry.closed_on", { when: formatDate(enquiry.closesAt) })
            : isWithinRelativeWindow(enquiry.closesAt, { now })
              ? t("enquiry.closes_in", { duration: formatCountdown(enquiry.closesAt, { now }) })
              : t("enquiry.closes_on", { when: formatDate(enquiry.closesAt) })}
        </span>
      </div>

      <div className="mt-6 grid gap-[var(--gutter)] lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-[var(--gutter)]">
          {quoted.length === 0 ? (
            <Panel title={t("enquiry.no_quotes_title")}>
              <p className="max-w-[var(--measure-prose)] text-body-sm text-muted">
                {t("enquiry.no_quotes_body")}
              </p>
            </Panel>
          ) : (
            <Panel
              title={t("enquiry.quotes_heading", { count: quoted.length })}
              actions={
                quoted.length > 0 ? (
                  <Link
                    href={withToken(`/enquiry/${enquiry.id}/compare`)}
                    className="rounded-tag text-body-sm text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                  >
                    {t("enquiry.compare")}
                  </Link>
                ) : undefined
              }
            >
              <ul className="space-y-3">
                {quoted.map((quote) => (
                  <li key={quote.id} className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="min-w-0">
                      <Link
                        href={`/b/${quote.business.slug}`}
                        className="rounded-tag text-body-sm text-ink underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                      >
                        {quote.business.displayName}
                      </Link>
                      <span className="mt-0.5 block font-mono text-caption text-muted">{quote.ref}</span>
                    </span>
                    <span className="font-mono tabular-nums text-body text-ink">
                      {formatAED(quote.totalAed)}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title={t("enquiry.requirement")}>
            <p className="max-w-[var(--measure-prose)] text-prose text-prose">{enquiry.requirement}</p>
            <h3 className="mt-4 text-body-sm text-ink">{t("enquiry.your_lines")}</h3>
            <ul className="mt-1.5 space-y-1">
              {enquiry.lines.map((line) => (
                <li key={line.id} className="text-body-sm text-muted">
                  <span className="text-ink">{line.description}</span>
                  {" · "}
                  <span className="font-mono">{line.qty}</span>
                  {line.unit ? ` ${line.unit}` : ""}
                  {line.size ? ` · ${line.size}` : ""}
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <aside className="space-y-[var(--gutter)]">
          <Panel title={t("enquiry.recipients_heading")}>
            <ul className="space-y-2">
              {enquiry.recipients.map((r) => (
                <li key={r.businessId} className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link
                    href={`/b/${r.slug}`}
                    className="rounded-tag text-body-sm text-ink underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                  >
                    {r.displayName}
                  </Link>
                  <StatusBadge tone={STATE_TONE[r.state] ?? "neutral"} size="sm" shape="chip">
                    {t(`enquiry.recipient_state.${r.state}` as "enquiry.recipient_state.delivered")}
                  </StatusBadge>
                </li>
              ))}
            </ul>
          </Panel>

          <Card padded>
            <p className="text-caption text-muted">{t("rfq.privacy")}</p>
            <p className="mt-2 text-caption text-faint">
              {formatRelative(enquiry.createdAt, { now })}
            </p>
          </Card>
        </aside>
      </div>
      </div>
    </PublicShell>
  );
}
