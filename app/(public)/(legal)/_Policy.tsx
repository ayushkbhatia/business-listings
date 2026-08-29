import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumb, PublicShell } from "@/components/structure";
import { prisma } from "@/lib/db/client";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { JsonLd } from "@/app/(public)/_json-ld";
import { Prose } from "@/app/(public)/_landing/Blocks";

/**
 * Board 10j — the four policies, one renderer.
 *
 * Four routes rather than one `[policy]` segment, because a second dynamic
 * segment at the root of the app collides with `[emirate]/[area]/[category]`:
 * Next refuses with "you cannot use different slug names for the same dynamic
 * path", and it refuses at request time rather than at build time, so the build
 * was clean and every page 500ed. Four files that share this renderer is the
 * shape the router allows, and `docs/routes.md` names exactly four anyway.
 *
 * The wording lives in the database for the reason `CLAUDE.md` gives: the
 * person who writes a review policy is not the person who can push, and a
 * change to one should cost a revalidation rather than a build and a cold
 * cache for every page on the site.
 *
 * Each page shows the date its wording took effect. A policy with no date is a
 * policy that has always said whatever it says now.
 */

/** The four addresses, and the row each one reads. */
const POLICIES = {
  terms: "terms",
  privacy: "privacy",
  "verification-policy": "verification_policy",
  "review-policy": "review_policy",
} as const;

export type Slug = keyof typeof POLICIES;

async function find(slug: Slug) {
  return prisma.legalPage.findUnique({
    where: { kind: POLICIES[slug] },
    select: { title: true, body: true, effectiveFrom: true, updatedAt: true },
  });
}

export async function policyMetadata(policy: Slug): Promise<Metadata> {
  const page = await find(policy);

  return {
    title: page?.title ?? t(`legal.kind.${POLICIES[policy]}` as never),
    alternates: { canonical: `/${policy}` },
  };
}

export async function PolicyPage({ policy }: { policy: Slug }) {
  const page = await find(policy);
  const title = page?.title ?? t(`legal.kind.${POLICIES[policy]}` as never);

  const crumbs = [{ label: t("chrome.directory"), href: "/" }, { label: title }];
  const others = (Object.keys(POLICIES) as Slug[]).filter((slug) => slug !== policy);

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

      <header className="border-b border-line pb-4">
        <h1 className="font-serif text-h1-serif text-ink">{title}</h1>
        {page && (
          <p className="mt-2 font-mono text-eyebrow uppercase text-faint">
            {t("legal.effective", { date: formatDate(page.effectiveFrom) })}
            {page.updatedAt.getTime() !== page.effectiveFrom.getTime() &&
              ` · ${t("legal.updated", { date: formatDate(page.updatedAt) })}`}
          </p>
        )}
      </header>

      {page ? (
        <Prose text={page.body} />
      ) : (
        /*
           An unwritten policy says so. The alternative — a 404 on `/privacy` —
           reads as having something to hide, and the footer links here from
           every page on the site.
        */
        <div className="mt-5 max-w-[var(--measure-prose)] rounded-card border border-line bg-card px-5 py-4">
          <p className="text-body-sm text-ink">{t("legal.missing")}</p>
          <p className="mt-1.5 text-body-sm text-prose">{t("legal.missing_body")}</p>
        </div>
      )}

      <nav aria-label={t("legal.others")} className="mt-8 border-t border-line pt-5">
        <h2 className="font-mono text-eyebrow uppercase text-faint">{t("legal.others")}</h2>
        <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
          {others.map((slug) => (
            <li key={slug}>
              <Link
                href={`/${slug}`}
                className="rounded-tag text-body-sm text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
              >
                {t(`legal.kind.${POLICIES[slug]}` as never)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </PublicShell>
  );
}
