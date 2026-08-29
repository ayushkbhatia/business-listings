import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge, Tag } from "@/components/display";
import { tierSpec, VerificationBadge } from "@/components/domain";
import { buttonClassName } from "@/components/primitives";
import { Breadcrumb, PublicShell } from "@/components/structure";
import { formatCount, formatDate, formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import {
  CRITERIA,
  curatedList,
  MAX_REPLY_MS,
  MIN_REVIEWS,
} from "@/lib/seo/curated";
import { absoluteUrl } from "@/lib/site";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { JsonLd } from "@/app/(public)/_json-ld";
import { Prose } from "@/app/(public)/_landing/Blocks";

/**
 * Board 6b — a curated list, and criterion 4.
 *
 * The criteria are on the page, above the list, with "paid placement — never"
 * among them. That block is not decoration and it is not marketing: it is the
 * only thing that separates this page from every other "best of" in the market,
 * all of which are sold and none of which say so.
 *
 * The rules are rendered from the same `CRITERIA` constant `membersOf` applies,
 * so the page cannot describe a bar the code does not enforce.
 */

export const revalidate = 3600;

interface Props {
  params: Promise<{ slug: string }>;
}

function criterionLabel(key: (typeof CRITERIA)[number]["key"]): string {
  switch (key) {
    case "verified":
      return t("best.criterion.verified");
    case "reply":
      return t("best.criterion.reply", { hours: MAX_REPLY_MS / 3_600_000 });
    case "reviews":
      return t("best.criterion.reviews", { count: MIN_REVIEWS });
    case "visit":
      return t("best.criterion.visit");
    case "placement":
      return t("best.criterion.placement");
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const list = await curatedList((await params).slug);
  if (!list) return {};

  return {
    title: list.title,
    description: t("best.considered", {
      considered: formatCount(list.consideredCount),
      members: formatCount(list.members.length),
    }),
    alternates: { canonical: `/best/${list.slug}` },
    /*
       A list with nobody on it is asked not to be indexed. It is the rules
       working rather than failing — but a "best HVAC suppliers" page showing
       none of them is a thin page whatever the reason, and the whole handoff
       is about not putting those in front of strangers.
    */
    ...(list.members.length > 0 ? {} : { robots: { index: false, follow: true } }),
  };
}

export default async function CuratedListPage({ params }: Props) {
  const list = await curatedList((await params).slug);
  if (!list) notFound();

  const crumbs = [
    { label: t("chrome.directory"), href: "/" },
    { label: list.categoryName, href: `/c/${list.categorySlug}` },
    { label: list.title },
  ];

  return (
    <PublicShell
      nav={<DirectoryNav />}
      breadcrumb={<Breadcrumb label={t("gallery.breadcrumb_label")} items={crumbs} />}
      footer={<DirectoryFooter />}
    >
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: crumbs.map((crumb, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: crumb.label,
            item: crumb.href,
          })),
        }}
      />
      {list.members.length > 0 && (
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "ItemList",
            name: list.title,
            numberOfItems: list.members.length,
            itemListElement: list.members.map((member, i) => ({
              "@type": "ListItem",
              position: i + 1,
              url: absoluteUrl(`/b/${member.slug}`),
              name: member.displayName,
            })),
          }}
        />
      )}

      <header className="border-b border-line pb-4">
        <h1 className="font-serif text-h1-serif text-ink">{list.title}</h1>
        {list.areaName && (
          <p className="mt-2 font-mono text-eyebrow uppercase text-faint">
            {list.areaName}
          </p>
        )}
        {list.intro && <Prose text={list.intro} />}
      </header>

      <Criteria />

      {list.members.length === 0 ? (
        <section className="mt-6 max-w-[var(--measure-prose)] rounded-card border border-line bg-card px-5 py-4">
          <p className="text-body-sm text-ink">{t("best.empty")}</p>
          <p className="mt-1.5 text-body-sm text-prose">{t("best.empty_body")}</p>
          <Link
            href={`/c/${list.categorySlug}`}
            className={`${buttonClassName({ size: "sm" })} mt-3`}
          >
            {t("best.browse", { category: list.categoryName })}
          </Link>
        </section>
      ) : (
        // Named, because the breadcrumb is an ordered list too and a page with
        // two unnamed ones tells a screen-reader user nothing about either.
        <ol aria-label={list.title} className="mt-6 flex flex-col gap-3">
          {list.members.map((member, i) => (
            <li
              key={member.id}
              className="flex flex-wrap items-start gap-4 rounded-card border border-line bg-card px-5 py-4"
            >
              <span className="font-mono text-h3 tabular-nums text-faint">
                {t("best.rank", { position: i + 1 })}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-h3 text-ink">
                  <Link
                    href={`/b/${member.slug}`}
                    className="rounded-tag underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                  >
                    {member.displayName}
                  </Link>
                </h2>
                <p className="mt-1 text-caption text-muted">
                  {member.areaName}
                  {member.areaName && " · "}
                  {t("best.reply", { duration: formatDuration(member.responseTimeMedianMs) })}
                  {" · "}
                  {t("best.reviews", { count: member.reviews })}
                  {" · "}
                  {t("best.rating", { rating: member.averageOverall.toFixed(1) })}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {/* Criterion 8 has no exceptions: the badge says what was
                      checked and when, here as everywhere. */}
                  <VerificationBadge
                    tier={member.verificationTier}
                    label={t(tierSpec(member.verificationTier).labelKey as never)}
                    checked={t(tierSpec(member.verificationTier).checkedKey as never)}
                    {...(member.verifiedAt ? { date: formatDate(member.verifiedAt) } : {})}
                    tierLabel={t("verify.tier", { tier: member.verificationTier })}
                    compact
                  />
                  {member.visited && <Tag>{t("best.visited")}</Tag>}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      <p className="mt-6 max-w-[var(--measure-prose)] text-caption text-muted">
        {t("best.considered", {
          considered: formatCount(list.consideredCount),
          members: formatCount(list.members.length),
        })}
        {list.publishedAt && ` ${t("best.updated", { date: formatDate(list.publishedAt) })}`}
      </p>
    </PublicShell>
  );
}

/**
 * The rules, rendered from the constant the service applies.
 *
 * Above the list, not below it. A reader who scrolls past the names has already
 * decided whether to trust the page, and the criteria are the reason to.
 */
function Criteria() {
  return (
    <section className="mt-6 max-w-[var(--measure-prose)] rounded-card border border-brand-line bg-brand-wash px-5 py-4">
      <h2 className="text-h3 text-ink">{t("best.criteria_title")}</h2>
      <p className="mt-1.5 text-body-sm text-prose">{t("best.criteria_lede")}</p>

      <ul className="mt-3 flex flex-col gap-2">
        {CRITERIA.map((criterion) => (
          <li key={criterion.key} className="flex flex-wrap items-baseline gap-2">
            <StatusBadge tone={criterion.kind === "never" ? "bad" : "ok"}>
              {t(`best.kind.${criterion.kind}` as never)}
            </StatusBadge>
            <span className="text-body-sm text-prose">{criterionLabel(criterion.key)}</span>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-body-sm text-prose">{t("best.no_purchase")}</p>
    </section>
  );
}
