import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumb, PublicShell } from "@/components/structure";
import { prisma } from "@/lib/db/client";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { siblingsOf } from "@/lib/legal/pages";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { JsonLd } from "@/app/(public)/_json-ld";
import { Prose } from "@/app/(public)/_landing/Blocks";

/**
 * Board 10j — the two remaining policies, one renderer.
 *
 * It rendered four. Boards 13f and 13g replaced `/terms` and `/privacy` with
 * the `LegalPage` template beside this file, which draws a numbered document
 * with a section nav, a rail and real tables; the verification and review
 * policies are still the wording-in-a-row shape this was built for, and they
 * keep it until their own boards land.
 *
 * Separate routes rather than one `[policy]` segment, because a second dynamic
 * segment at the root of the app collides with `[emirate]/[area]/[category]`:
 * Next refuses with "you cannot use different slug names for the same dynamic
 * path", and it refuses at request time rather than at build time, so the build
 * was clean and every page 500ed.
 *
 * The wording lives in the database for the reason `CLAUDE.md` gives: the
 * person who writes a review policy is not the person who can push, and a
 * change to one should cost a revalidation rather than a build and a cold
 * cache for every page on the site.
 *
 * Each page shows the date its wording took effect. A policy with no date is a
 * policy that has always said whatever it says now.
 */

/** The addresses this renderer still serves, and the row each one reads. */
const POLICIES = {
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
  /*
     All four siblings, from the one list the legal pages share. Building this
     from `POLICIES` was right while this file rendered every policy and became
     wrong the moment it stopped: it would have offered a reader on the review
     policy exactly one other page, and none of the three the board draws.
  */
  const others = siblingsOf(policy);

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
           An unwritten policy says so. The alternative — a 404 on
           `/review-policy` — reads as having something to hide, and the footer
           links here from every page on the site.
        */
        <div className="mt-5 max-w-[var(--measure-prose)] rounded-card border border-line bg-card px-5 py-4">
          <p className="text-body-sm text-ink">{t("legal.missing")}</p>
          <p className="mt-1.5 text-body-sm text-prose">{t("legal.missing_body")}</p>
        </div>
      )}

      <nav aria-label={t("legal.others")} className="mt-8 border-t border-line pt-5">
        <h2 className="font-mono text-eyebrow uppercase text-faint">{t("legal.others")}</h2>
        <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
          {others.map((other) => (
            <li key={other.href}>
              <Link
                href={other.href}
                className="rounded-tag text-body-sm text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
              >
                {other.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </PublicShell>
  );
}
