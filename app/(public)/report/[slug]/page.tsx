import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PublicShell } from "@/components/structure";
import { prisma } from "@/lib/db/client";
import { getActor } from "@/lib/auth/session";
import { getViewer } from "@/lib/auth/viewer";
import { t } from "@/lib/i18n";
import { MAX_DETAIL, MIN_DETAIL } from "@/lib/reports/file";
import { FIELDS_FOR_KIND, PUBLIC_REPORT_KINDS } from "@/lib/reports/taxonomy";
import { DirectoryFooter, DirectoryNav } from "../../_chrome";
import { fileReport } from "./actions";
import { ReportForm, type ReportKindOption } from "./ReportForm";

/**
 * Board 4h — `/report/:subject`, the route `docs/routes.md` has named since the
 * canvas and nothing has ever served.
 *
 * The storefront carries *Report this listing* twice — on the unclaimed panel
 * and at the foot of the verification rail — and both have pointed at
 * `/verification-policy` since the storefront shipped. A page of prose is a
 * reasonable thing to link to from the word *policy*; it is not what somebody
 * pressing *Report* is asking for, and the consequence is on board 4h: the
 * queue had one producer, and the two rows the board draws as `Public ×3` and
 * `Public ×2` could not have been filed by anybody.
 *
 * ## Four kinds, and not the other four
 *
 * `off_platform_payment` is a detector's, `accepted_quote` is filed from the
 * buyer's own accepted record, `review_integrity` is a staff finding and
 * `claim_conflict` is decided on board 4b. What is left is what a person
 * standing outside a closed unit, or holding a phone that rings the wrong
 * company, actually has to tell us.
 *
 * ## `noindex`
 *
 * One of these pages exists per listing, roughly thirty thousand of them, each
 * a form with nothing on it to rank. `lib/seo/crawl-policy.ts` exists for
 * exactly this shape.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const business = await prisma.business.findUnique({
    where: { slug },
    select: { displayName: true },
  });
  return {
    title: business
      ? t("report_listing.meta_title", { business: business.displayName })
      : t("report_listing.meta_title_generic"),
    robots: { index: false, follow: false },
  };
}

export default async function ReportListingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [business, actor, viewer] = await Promise.all([
    prisma.business.findUnique({
      where: { slug },
      select: { displayName: true, slug: true, publishedAt: true },
    }),
    getActor(),
    getViewer(),
  ]);
  /*
     An unpublished listing has no public page to report, and saying so would
     confirm that a slug exists. The storefront 404s for the same reason.
  */
  if (!business || !business.publishedAt) notFound();

  const kinds: ReportKindOption[] = PUBLIC_REPORT_KINDS.map((kind) => ({
    value: kind,
    label: t(`report_listing.kind.${kind}` as "report_listing.kind.closed"),
    description: t(`report_listing.kind_hint.${kind}` as "report_listing.kind_hint.closed"),
    fields: FIELDS_FOR_KIND[kind].map((field) => ({
      value: field,
      label: t(`report_listing.field.${field}` as "report_listing.field.phone"),
    })),
  }));

  return (
    <PublicShell
      nav={<DirectoryNav viewer={viewer} />}
      footer={<DirectoryFooter />}
      breadcrumb={
        <Link
          href={`/b/${business.slug}`}
          className="rounded-tag text-caption text-muted underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("report_listing.back", { business: business.displayName })}
        </Link>
      }
    >
      <div className="mx-auto flex w-full max-w-[var(--measure-prose)] flex-col gap-5 py-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-h1 text-ink">
            {t("report_listing.title", { business: business.displayName })}
          </h1>
          <p className="text-body text-prose">{t("report_listing.lede")}</p>
        </header>

        <Card>
          <ReportForm
            slug={business.slug}
            kinds={kinds}
            detailLimit={MAX_DETAIL}
            fileReport={fileReport}
          />
        </Card>

        {/*
           What happens next, and what does not. Nobody is told a report was
           filed about them until a moderator decides something, and the person
           filing is told that outright rather than left to assume either way.
        */}
        <Card>
          <h2 className="text-h3 text-ink">{t("report_listing.next_title")}</h2>
          <ul className="mt-2 flex flex-col gap-1.5">
            {[
              t("report_listing.next_1"),
              actor ? t("report_listing.next_2_signed_in") : t("report_listing.next_2_anonymous"),
              t("report_listing.next_3"),
            ].map((line) => (
              <li key={line} className="text-body-sm text-prose">
                {line}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-caption text-muted">
            {t("report_listing.not_a_payment_desk")}
          </p>
        </Card>
      </div>
    </PublicShell>
  );
}
