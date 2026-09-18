import type { Metadata } from "next";
import Link from "next/link";
import { Card, PublicShell } from "@/components/structure";
import { Alert, StatusBadge } from "@/components/display";
import { Button, Input, Label } from "@/components/primitives";
import { getViewer } from "@/lib/auth/viewer";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { checkRate, recordHit, requesterKey } from "@/lib/rate-limit";
import { parseReference } from "@/lib/reports/reference";
import { reportStatus, type ReportStatus } from "@/lib/reports/status";
import { DirectoryFooter, DirectoryNav } from "../_chrome";

/**
 * Board 13c — `/report`, the hub the footer's *Report a listing* opens.
 *
 * The footer link pointed at `/verification-policy` since the storefront
 * shipped, and board 4h left it there because the footer has no listing to
 * report. It still has none, and this page does not pretend otherwise: a
 * report names one business, so it is filed from that business's page, where
 * the form carries the name and cannot land on the wrong listing.
 *
 * What it does do is the two things somebody arriving from the footer is
 * after:
 *
 *   1. **Find the listing.** A search box into the directory's own search,
 *      which is where every storefront is reached from.
 *   2. **Look up a report already sent.** `B4`'s reference, and the only way a
 *      reporter who left no email can hear what happened. The status renders
 *      on this page, under the box, from `?ref=`.
 *
 * `noindex`, and `/report` is disallowed in `robots.txt` — a page that renders
 * one report per query string is not a page to rank.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: t("report_hub.meta_title"),
  robots: { index: false, follow: false },
};

type Lookup =
  | { state: "none" }
  | { state: "malformed"; input: string }
  | { state: "limited" }
  | { state: "unknown"; reference: string }
  | { state: "found"; status: ReportStatus };

async function lookup(raw: string | undefined): Promise<Lookup> {
  if (!raw || raw.trim() === "") return { state: "none" };
  const reference = parseReference(raw);
  if (!reference) return { state: "malformed", input: raw.trim().slice(0, 40) };

  const identifier = await requesterKey(null);
  const decision = await checkRate("report_status", identifier);
  if (!decision.allowed) return { state: "limited" };
  await recordHit("report_status", identifier);

  const status = await reportStatus(reference);
  return status ? { state: "found", status } : { state: "unknown", reference };
}

export default async function ReportHubPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [query, viewer] = await Promise.all([searchParams, getViewer()]);
  const raw = typeof query.ref === "string" ? query.ref : undefined;
  const result = await lookup(raw);

  return (
    <PublicShell nav={<DirectoryNav viewer={viewer} />} footer={<DirectoryFooter />}>
      <div className="mx-auto flex w-full max-w-[var(--measure-prose)] flex-col gap-5 py-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-h1 text-ink">{t("report_hub.title")}</h1>
          <p className="text-body text-prose">{t("report_hub.lede")}</p>
        </header>

        <Card>
          <h2 className="text-h3 text-ink">{t("report_hub.find_title")}</h2>
          <p className="mt-1 text-body-sm text-body">{t("report_hub.find_body")}</p>
          <form action="/search" method="get" className="mt-3 flex flex-wrap items-end gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Label htmlFor="report-hub-q">{t("report_hub.find_label")}</Label>
              <Input id="report-hub-q" name="q" type="search" autoComplete="off" />
            </div>
            <Button type="submit" variant="secondary">
              {t("report_hub.find_submit")}
            </Button>
          </form>
        </Card>

        <Card>
          <h2 className="text-h3 text-ink">{t("report_hub.lookup_title")}</h2>
          <p className="mt-1 text-body-sm text-body">{t("report_hub.lookup_body")}</p>
          <form action="/report" method="get" className="mt-3 flex flex-wrap items-end gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Label htmlFor="report-hub-ref" hint={t("report_hub.lookup_hint")}>
                {t("report_hub.lookup_label")}
              </Label>
              <Input
                id="report-hub-ref"
                name="ref"
                mono
                autoComplete="off"
                spellCheck={false}
                defaultValue={raw ?? ""}
                maxLength={40}
              />
            </div>
            <Button type="submit" variant="secondary">
              {t("report_hub.lookup_submit")}
            </Button>
          </form>

          {result.state !== "none" && (
            <div className="mt-4 border-t border-line pt-4" aria-live="polite">
              <LookupResult result={result} />
            </div>
          )}
        </Card>

        <p className="text-caption text-muted">{t("report_listing.not_a_payment_desk")}</p>
      </div>
    </PublicShell>
  );
}

function LookupResult({ result }: { result: Exclude<Lookup, { state: "none" }> }) {
  if (result.state === "malformed") {
    return (
      <Alert tone="warn" fix={t("report_hub.malformed_fix")}>
        {t("report_hub.malformed")}
      </Alert>
    );
  }
  if (result.state === "limited") {
    return (
      <Alert tone="warn" fix={t("report_hub.limited_fix")}>
        {t("report_hub.limited")}
      </Alert>
    );
  }
  if (result.state === "unknown") {
    return (
      <Alert tone="warn" fix={t("report_hub.unknown_fix")}>
        {t("report_hub.unknown", { reference: result.reference })}
      </Alert>
    );
  }

  const { status } = result;
  return (
    <section aria-labelledby="report-status-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="report-status-heading" className="font-mono text-body text-ink">
          {status.reference}
        </h3>
        {status.outcome ? (
          <StatusBadge tone="neutral">{t("report_hub.state_decided")}</StatusBadge>
        ) : (
          <StatusBadge tone="info">{t("report_hub.state_open")}</StatusBadge>
        )}
      </div>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        <div>
          <dt className="text-caption text-muted">{t("report_hub.listing")}</dt>
          <dd className="text-body-sm text-ink">
            {status.businessSlug ? (
              <Link
                href={`/b/${status.businessSlug}`}
                className="rounded-tag text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
              >
                {status.businessName}
              </Link>
            ) : (
              status.businessName
            )}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-muted">{t("report_hub.reason")}</dt>
          <dd className="text-body-sm text-ink">
            {t(`report_hub.kind.${status.kind}` as "report_hub.kind.closed")}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-muted">{t("report_hub.filed")}</dt>
          <dd className="text-body-sm text-ink">{formatDate(status.filedAt)}</dd>
        </div>
        <div>
          <dt className="text-caption text-muted">{t("report_hub.outcome")}</dt>
          <dd className="text-body-sm text-ink">
            {status.outcome && status.decidedAt
              ? t(`report_hub.outcome.${status.outcome}` as "report_hub.outcome.upheld", {
                  date: formatDate(status.decidedAt),
                })
              : t("report_hub.outcome_open", { days: String(status.slaDays) })}
          </dd>
        </div>
      </dl>
    </section>
  );
}
