import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumb, Card, PublicShell } from "@/components/structure";
import { ReportListingForm } from "@/components/domain";
import { getActor } from "@/lib/auth/session";
import { getViewer } from "@/lib/auth/viewer";
import { t } from "@/lib/i18n";
import { reportFormData } from "@/lib/reports/form";
import { reportSubject } from "@/lib/reports/subject";
import { DirectoryFooter, DirectoryNav } from "../../_chrome";
import { fileReport } from "../actions";

/**
 * Boards 4h and 13c — `/report/:slug`, the page the modal degrades to.
 *
 * Board 13c puts the report form in a modal over the storefront, at
 * `/b/:slug?report=1`. This page stays, for three readers the modal cannot
 * serve: a browser without JavaScript (the storefront's *Report this listing*
 * is a real link to here, which the modal intercepts when it can), somebody
 * who middle-clicks the link into a tab, and the footer's *Report a listing*
 * hub, which lists a slug rather than a storefront.
 *
 * It is the modal's form and nothing else — the same `reportFormData`, the same
 * `ReportListingForm`, the same `fileReport`. The layout prop moves the footer
 * and changes nothing a reporter can fill in.
 *
 * ## `noindex`
 *
 * One of these pages exists per listing, roughly thirty thousand of them, each
 * a form with nothing on it to rank. `lib/seo/crawl-policy.ts` disallows the
 * prefix for exactly this shape.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const subject = await reportSubject(slug);
  return {
    title: subject
      ? t("report_listing.meta_title", { business: subject.displayName })
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
  const [subject, actor, viewer] = await Promise.all([reportSubject(slug), getActor(), getViewer()]);
  /*
     `B6` — degrades to `13d`. An unpublished, suspended, closed or merged
     listing has no public page to report, and saying so would confirm that a
     slug exists. The storefront 404s for the same reason, so this is the same
     not-found either way.
  */
  if (!subject) notFound();

  const data = await reportFormData(subject, actor !== null);

  return (
    <PublicShell
      nav={<DirectoryNav viewer={viewer} />}
      footer={<DirectoryFooter />}
      /*
         A `Breadcrumb`, not a bare link. `PublicShell` renders this slot in a
         plain div above `main`, so a link on its own is page content outside
         every landmark — axe's `region` rule.
      */
      breadcrumb={
        <Breadcrumb
          label={t("report_listing.breadcrumb_label")}
          items={[
            { label: subject.displayName, href: `/b/${subject.slug}` },
            { label: t("report_listing.crumb") },
          ]}
        />
      }
    >
      <div className="mx-auto flex w-full max-w-[var(--measure-prose)] flex-col gap-5 py-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-h1 text-ink">
            {t("report_listing.title", { business: subject.displayName })}
          </h1>
          <p className="text-body text-prose">{t("report_listing.lede")}</p>
        </header>

        <Card>
          <ReportListingForm data={data} fileReport={fileReport} layout="page" />
        </Card>

        <p className="text-caption text-muted">{t("report_listing.not_a_payment_desk")}</p>
      </div>
    </PublicShell>
  );
}
