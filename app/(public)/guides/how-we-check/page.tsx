import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumb, PublicShell } from "@/components/structure";
import { Eyebrow } from "@/components/display";
import { formatCount, formatDate } from "@/lib/format";
import { guideIndex } from "@/lib/guides/queries";
import { t } from "@/lib/i18n";
import { absoluteUrl } from "@/lib/site";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";

/**
 * Board 10b — where the index's author strip goes.
 *
 * The board names a `Who writes these` page and leaves it unspecced, because
 * the question it answers is board 6d Q1: who the author is. That decision has
 * not been taken, and this page does not take it. What it does instead is state
 * the thing the strip actually claims — that the regulatory detail is checked
 * against the source — and show the record backing it, which is real: every
 * date here is an audited `recordRegulatoryCheck`, and the overdue count is the
 * same computation board 6f's queue works.
 *
 * A page naming an invented author would be the first false thing on a page
 * about checking facts. So the authorship section says plainly that the
 * articles carry no individual byline and why, and it is the paragraph that
 * gets rewritten the day somebody is named.
 *
 * It is a static sibling of `[slug]`, so Next matches it before the dynamic
 * segment. `guideSlugCollision` keeps a guide or a subject from taking the
 * slug from underneath it.
 */

export const revalidate = 3600;

export const metadata: Metadata = {
  title: t("guides.how_h1"),
  description: t("guides.how_lede"),
  alternates: { canonical: absoluteUrl("/guides/how-we-check") },
};

export default async function HowWeCheckPage() {
  const index = await guideIndex();
  const overdue = index.all.filter((card) => card.freshness.overdue).length;
  const withCadence = index.all.filter((card) => card.freshness.dueAt !== null).length;

  const crumbs = [
    { label: t("chrome.directory"), href: "/" },
    { label: t("guides.title"), href: "/guides" },
    { label: t("guides.how_h1") },
  ];

  const steps = [
    t("guides.how_step_source"),
    t("guides.how_step_date"),
    t("guides.how_step_cadence"),
    t("guides.how_step_overdue"),
  ];

  return (
    <PublicShell
      nav={<DirectoryNav />}
      breadcrumb={<Breadcrumb label={t("gallery.breadcrumb_label")} items={crumbs} />}
      footer={<DirectoryFooter />}
    >
      <header className="border-b border-line pb-5">
        <Eyebrow as="p">{t("guides.eyebrow")}</Eyebrow>
        <h1 className="mt-3 max-w-[var(--measure-prose)] font-serif text-h1-serif text-ink">
          {t("guides.how_h1")}
        </h1>
        <p className="mt-3 max-w-[var(--measure-prose)] text-prose text-prose">
          {t("guides.how_lede")}
        </p>
      </header>

      <section className="mt-7" aria-labelledby="how-process">
        <h2 id="how-process" className="text-h2 text-ink">
          {t("guides.how_process")}
        </h2>
        <ol className="mt-3 max-w-[var(--measure-prose)] list-decimal space-y-2.5 pl-5">
          {steps.map((step) => (
            <li key={step} className="text-body-sm leading-relaxed text-prose">
              {step}
            </li>
          ))}
        </ol>
      </section>

      {/*
         The record, and every figure is a query.

         Including the unflattering ones: board 10b §States is explicit that the
         quarter count is not suppressed when it reads nought, because that is
         the number that makes the queue on 6f get worked. The same reasoning
         applies to the overdue count on the page that explains the process.
      */}
      <section className="mt-8" aria-labelledby="how-record">
        <h2 id="how-record" className="text-h2 text-ink">
          {t("guides.how_record")}
        </h2>
        <table className="mt-3 w-full max-w-[var(--measure-prose)] border-collapse">
          <caption className="sr-only">{t("guides.how_record")}</caption>
          <tbody>
            <Row label={t("guides.how_row_guides")} value={formatCount(index.all.length)} />
            <Row
              label={t("guides.how_row_last")}
              value={
                index.lastReviewPass ? formatDate(index.lastReviewPass) : t("table.not_provided")
              }
            />
            <Row
              label={t("guides.how_row_quarter")}
              value={`${formatCount(index.reviewedThisQuarter)} / ${formatCount(withCadence)}`}
            />
            <Row label={t("guides.how_row_overdue")} value={formatCount(overdue)} />
          </tbody>
        </table>
      </section>

      <section className="mt-8" aria-labelledby="how-author">
        <h2 id="how-author" className="text-h2 text-ink">
          {t("guides.how_author")}
        </h2>
        <p className="mt-3 max-w-[var(--measure-prose)] text-body-sm leading-relaxed text-prose">
          {t("guides.how_author_body")}
        </p>
      </section>

      <p className="mt-8">
        <Link
          href="/guides"
          className="rounded-tag text-body-sm text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
        >
          ← {t("guides.how_back")}
        </Link>
      </p>
    </PublicShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-b border-line">
      <th scope="row" className="py-2 text-left text-body-sm font-normal text-prose">
        {label}
      </th>
      <td className="py-2 text-right text-body-sm tabular-nums text-ink">{value}</td>
    </tr>
  );
}
