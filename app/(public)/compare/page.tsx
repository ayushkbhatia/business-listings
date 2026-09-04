import type { Metadata } from "next";
import Link from "next/link";
import { buttonClassName } from "@/components/primitives";
import { Close } from "@/components/primitives/icons";
import { Breadcrumb, PublicShell } from "@/components/structure";
import { Tag } from "@/components/display";
import { ResponseTime, VerificationBadge, tierSpec } from "@/components/domain";
import { COMPARE_LIMIT, getBusinessesForCompare, type CompareBusiness } from "@/lib/db/queries";
import { formatCount, formatDate, formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";

/** Per-buyer, and disallowed in robots.txt. Nothing to cache across visitors. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: t("compare.title"),
  robots: { index: false, follow: false },
};

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function slugsFrom(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value])
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, COMPARE_LIMIT);
}

export default async function ComparePage({ searchParams }: Props) {
  const params = await searchParams;
  const slugs = slugsFrom(params.p);
  const businesses = await getBusinessesForCompare(slugs);

  return (
    <PublicShell
      nav={<DirectoryNav />}
      breadcrumb={
        <Breadcrumb
          label={t("gallery.breadcrumb_label")}
          items={[{ label: t("chrome.directory"), href: "/" }, { label: t("compare.title") }]}
        />
      }
      footer={<DirectoryFooter />}
    >
      <header className="border-b border-line pb-4">
        <h1 className="font-serif text-h1-serif text-ink">{t("compare.title")}</h1>
        <p className="mt-1 font-mono text-eyebrow text-muted">
          {t("compare.limit", { limit: COMPARE_LIMIT })}
        </p>
      </header>

      {businesses.length === 0 ? (
        <div className="mt-6 max-w-[var(--measure-prose)]">
          <h2 className="text-h2 text-ink">{t("compare.empty_title")}</h2>
          <p className="mt-2 text-prose text-prose">{t("compare.empty_body")}</p>
          <div className="mt-4">
            <Link
              href="/"
              className="inline-flex items-center rounded-ctl border border-line-strong bg-card px-3 py-1.5 text-body-sm text-ink transition-colors duration-120 ease-out hover:bg-fill focus-visible:outline-none focus-visible:shadow-focus"
            >
              {t("compare.browse")}
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-5 overflow-x-auto rounded-card border border-line bg-card">
            <ComparisonTable businesses={businesses} slugs={slugs} />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {/*
              Board 10d's "Enquire with all 4", live from handoff 2 step 3.
              Every compared supplier is pinned, so the fan-out keeps them and
              tops up with whoever else can answer.
            */}
            <a
              href={`/rfq/new?to=${businesses.map((b) => b.slug).join(",")}`}
              className={buttonClassName()}
            >
              {t("compare.enquire_all", { count: businesses.length })}
            </a>
            <p className="text-caption text-muted">{t("compare.no_price")}</p>
          </div>
        </>
      )}
    </PublicShell>
  );
}

/**
 * The comparison, as a real table.
 *
 * Transposed against every other table in the product: suppliers are columns
 * and attributes are rows, because four suppliers across is what fits and
 * because a buyer reads down one attribute at a time. That means a
 * `<th scope="col">` per supplier and a `<th scope="row">` per attribute, which
 * is exactly what a screen reader needs to announce "Al Marwan, verification,
 * site visited" from any cell.
 *
 * No prices. There is nothing to compare on price because no price exists on a
 * public surface — the line under the table says so rather than leaving a
 * column-shaped hole.
 */
function ComparisonTable({
  businesses,
  slugs,
}: {
  businesses: CompareBusiness[];
  slugs: string[];
}) {
  const rows: { key: string; label: string; render: (b: CompareBusiness) => React.ReactNode }[] = [
    {
      key: "verification",
      label: t("compare.verification"),
      render: (b) => {
        const spec = tierSpec(b.verificationTier);
        const date =
          spec.dateField === "none" || !b.verifiedAt
            ? undefined
            : formatDate(b.verifiedAt);
        return (
          <VerificationBadge
            tier={b.verificationTier}
            label={t(spec.labelKey as never)}
            checked={t(spec.checkedKey as never)}
            date={date}
            tierLabel={t("verify.tier", { tier: b.verificationTier })}
          />
        );
      },
    },
    {
      key: "response",
      label: t("compare.response"),
      render: (b) => (
        <ResponseTime
          medianMs={b.responseTimeMedianMs}
          durationLabel={b.responseTimeMedianMs ? formatDuration(b.responseTimeMedianMs) : undefined}
          label={
            b.responseTimeMedianMs
              ? t("response.median", { duration: formatDuration(b.responseTimeMedianMs) })
              : undefined
          }
          unmeasuredLabel={t("response.unmeasured")}
        />
      ),
    },
    {
      key: "products",
      label: t("compare.products"),
      render: (b) => formatCount(b._count.products),
    },
    {
      key: "reviews",
      label: t("compare.reviews"),
      render: (b) =>
        b._count.reviews > 0 ? formatCount(b._count.reviews) : t("listing.no_reviews"),
    },
    {
      key: "branches",
      label: t("compare.branches"),
      render: (b) => formatCount(b.locations.length),
    },
    {
      key: "emirates",
      label: t("compare.emirates"),
      render: (b) => {
        const emirates = [...new Set(b.locations.map((l) => l.emirate))];
        return emirates.map((e) => t(`emirate.${e}` as never)).join(", ") || t("table.not_provided");
      },
    },
    {
      key: "established",
      label: t("compare.established"),
      render: (b) => b.establishedYear ?? t("table.not_provided"),
    },
    {
      key: "team",
      label: t("compare.team"),
      render: (b) =>
        b.teamSize ? t(`storefront.team_band.${b.teamSize}` as never) : t("table.not_provided"),
    },
    {
      key: "languages",
      label: t("compare.languages"),
      render: (b) => (b.languages.length > 0 ? b.languages.join(", ") : t("table.not_provided")),
    },
    {
      key: "licence",
      label: t("compare.licence"),
      render: (b) => <span className="font-mono">{b.licenceNumber}</span>,
    },
  ];

  return (
    <table className="w-full border-collapse text-left">
      <caption className="sr-only">{t("compare.caption")}</caption>
      <thead>
        <tr className="bg-paper-sunk">
          <th scope="col" className="w-40 px-3 py-2 font-mono text-colhead uppercase text-muted">
            {t("compare.attribute")}
          </th>
          {businesses.map((business) => {
            const without = slugs.filter((slug) => slug !== business.slug);
            return (
              <th
                key={business.id}
                scope="col"
                className="min-w-52 border-s border-line px-3 py-2 align-top"
              >
                <div className="flex items-start justify-between gap-2">
                  <a
                    href={`/b/${business.slug}`}
                    className="rounded-tag text-body-sm font-medium text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                  >
                    {business.displayName}
                  </a>
                  <a
                    href={without.length > 0 ? `/compare?p=${without.join(",")}` : "/compare"}
                    aria-label={t("compare.remove", { name: business.displayName })}
                    title={t("compare.remove", { name: business.displayName })}
                    className="flex size-6 shrink-0 items-center justify-center rounded-chip text-muted transition-colors duration-120 ease-out hover:bg-fill hover:text-ink focus-visible:outline-none focus-visible:shadow-focus"
                  >
                    <Close size={12} />
                  </a>
                </div>
                <div className="mt-1">
                  <Tag size="sm">{business.primaryCategory.name}</Tag>
                </div>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={row.key} className={i % 2 === 1 ? "bg-paper-sunk" : undefined}>
            <th
              scope="row"
              className="border-t border-line px-3 py-2 align-top text-caption font-normal text-muted"
            >
              {row.label}
            </th>
            {businesses.map((business) => (
              <td
                key={business.id}
                className="border-s border-t border-line px-3 py-2 align-top text-body-sm text-body"
              >
                {row.render(business)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
